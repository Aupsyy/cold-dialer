// La téléphonie contre la VRAIE base (migration 0001) : la chaîne du webhook et sa suite appellent les vraies fonctions SQL
// (evenement_appel, etat_recuperation_appel, enregistrement_appel, transcription_appel), dans une transaction ANNULÉE à la fin.
// Convention des tests qui ont besoin de la base : ils se sautent eux-mêmes si SUPABASE_DB_URL est absente ou n'est pas une adresse
// LOCALE (127.0.0.1, localhost) ; ils tournent par `npm run test:base` (la variable lue dans .env.local), et en CI après
// `supabase db reset`.
// Ce qui est vérifié : les clés et les types envoyés par le code sont ceux que la base lit ; la fiche et l'appelant sont retrouvés ;
// l'annonce lue au Poste rend l'appel conservable ; le chemin de l'audio est accepté ; un renvoi ne crée rien ; sans annonce, rien
// n'est téléchargé ; la reprise compte ses tentatives. Données de la fixture : fictives.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lireAircall, suiteAircall } from "../lib/telephonie/aircall.ts";
import { lireOnoff, recuperateurOnoff, suiteOnoff } from "../lib/telephonie/onoff.ts";
import { recevoirWebhookTelephonie } from "../lib/telephonie/reception.ts";
import { recupererAppel } from "../lib/telephonie/recuperation.ts";
import { lire } from "./aides.mjs";
import { ENV_BASE, fauxFetch, reponseAudio, reponseJson, routesStockage } from "./telephonie-faux.mjs";

const URL_BASE = process.env.SUPABASE_DB_URL ?? "";
const BASE_LOCALE = /@(127\.0\.0\.1|localhost)[:/]/.test(URL_BASE);
const EQUIPE_A = "a0000000-0000-4000-8000-000000000000";
const FICHE_A2 = "ca200000-0000-4000-8000-000000000002";
const APPELANT_A = "a3000000-0000-4000-8000-000000000003";
const JETON = "jeton-onoff-de-test-0123456789";
const ENV = { ...ENV_BASE, ONOFF_WEBHOOK_TOKEN: JETON, ONOFF_API_KEY: "cle-api-onoff-de-test" };

const TYPES = { p_evenement: "jsonb", p_lignes: "jsonb", p_compter: "boolean", p_workspace_id: "uuid" };

/** Un Rpc comme supabase.rpc, sur une connexion pg (rôle service_role déjà posé). */
function rpcPg(client) {
  return async (fonction, args) => {
    const noms = Object.keys(args);
    const sql = `select public.${fonction}(${noms.map((n, i) => `${n} => $${i + 1}::${TYPES[n] ?? "text"}`).join(", ")}) as r`;
    const valeurs = noms.map((n) => (TYPES[n] === "jsonb" ? JSON.stringify(args[n]) : args[n]));
    await client.query("savepoint rpc");
    try {
      const { rows } = await client.query(sql, valeurs);
      await client.query("release savepoint rpc");
      return { data: rows[0].r, error: null };
    } catch (e) {
      await client.query("rollback to savepoint rpc");
      return { data: null, error: { code: e.code } };
    }
  };
}

test("webhook Onoff et sa suite contre la vraie base (transaction annulée)", { skip: BASE_LOCALE ? false : "SUPABASE_DB_URL absente ou pas locale" }, async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: URL_BASE, ssl: false });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(lire("supabase/tests/_fixture.sql"));
    await client.query("select pg_temp.admin()");
    await client.query("update public.reglages set enregistrement_complet = true, annonce_lue_le = now() where workspace_id = $1", [EQUIPE_A]);
    const { rows } = await client.query("select extract(epoch from now()) * 1000 as ms");
    const maintenant = Number(rows[0].ms);
    const iso = (decalageS) => new Date(maintenant + decalageS * 1000).toISOString();
    // L'appelant A lit l'annonce au Poste pendant l'appel (activité « annonce », horodatée par la base).
    await client.query("select pg_temp.connecter($1)", [APPELANT_A]);
    await client.query("insert into public.lead_activities (lead_id, type) values ($1, 'annonce')", [FICHE_A2]);
    await client.query("select pg_temp.service()");
    const rpc = rpcPg(client);

    const corps = {
      id: "demo-base-0001",
      eventName: "RECORDING",
      onoffUserEmail: "Appelant.A@example.com",
      externalNumber: "01 99 00 01 02",
      // L'annonce a été cochée pendant l'appel : il s'est terminé 5 secondes après (une annonce cochée après la fin ne vaut rien).
      callStarted: iso(-180),
      callEnded: iso(5),
      callDuration: 185,
      callDirection: "OUTBOUND",
      callStatus: "ANSWERED",
      callRecordingUrl: "https://stockage.example.org/audio/demo-base.mp4?signature=inventee",
    };
    const suites = [];
    const journal = [];
    const recevoir = (o) =>
      recevoirWebhookTelephonie(
        "onoff",
        new Request("https://poste.example.org/api/telephonie/onoff/webhook", { method: "POST", body: JSON.stringify(o), headers: { "x-api-key": JETON } }),
        { env: ENV, fournisseurActif: "onoff", indicatif: "+33", base: () => rpc, journal: (c) => journal.push(c), planifier: (s) => suites.push(s), dependances: () => null },
      );

    const r1 = await recevoir(corps);
    assert.deepEqual([r1.statut, r1.corps], [200, { ok: true, evenements: 1 }]);
    assert.match(journal.at(-1), /^onoff:repondu:nouveau:fiche:appelant:audio_permis/);
    const ligne = (await client.query("select * from public.appels where externe_id = 'demo-base-0001'")).rows;
    assert.equal(ligne.length, 1);
    assert.equal(ligne[0].lead_id, FICHE_A2, "fiche retrouvée par les 9 chiffres (numéro national lu avec +33)");
    assert.equal(ligne[0].appelant_id, APPELANT_A, "appelant retrouvé par son e-mail");
    assert.equal(ligne[0].numero_externe, "+33199000102");
    assert.equal(ligne[0].duree_s, 185);
    assert.equal(ligne[0].annonce_lue, true);

    // La suite : l'audio téléchargé, déposé, noté ; puis la transcription par l'API.
    const { f } = fauxFetch([
      ["stockage.example.org", () => reponseAudio(16, "video/mp4")],
      ["/logs", () => reponseJson({ callTranscription: { summarization: "Résumé fictif.", diarization: [{ speakerIndex: 0, text: "Bonjour.", startTime: "00:00:01" }] } })],
      ...routesStockage(),
    ]);
    const depots = [];
    const d = {
      env: ENV,
      base: () => rpc,
      journal: () => {},
      fetch: f,
      deposer: async (chemin) => (depots.push(chemin), { ok: true }),
      maintenant: () => maintenant,
      attendre: async () => {},
    };
    const res = { id: ligne[0].id, workspaceId: EQUIPE_A, leadId: FICHE_A2, appelantId: APPELANT_A, nouveau: true, conserverAudio: true };
    const [e] = lireOnoff(corps);
    assert.deepEqual(await suiteOnoff(e, res, d), ["audio_garde", "transcription_gardee"]);
    const apres = (await client.query("select enregistrement_chemin, resume, transcription from public.appels where externe_id = 'demo-base-0001'")).rows[0];
    assert.equal(apres.enregistrement_chemin, `${EQUIPE_A}/onoff/demo-base-0001.mp4`);
    assert.deepEqual(depots, [apres.enregistrement_chemin], "le chemin déposé est celui que la base a accepté");
    assert.equal(apres.resume, "Résumé fictif.");
    assert.deepEqual(apres.transcription, [{ t: 1, locuteur: "appelant", texte: "Bonjour." }]);

    // Un renvoi : la même ligne, rien de retéléchargé.
    const r2 = await recevoir(corps);
    assert.equal(r2.statut, 200);
    assert.match(journal.at(-1), /:connu:/);
    assert.equal((await client.query("select count(*)::int as n from public.appels where externe_id = 'demo-base-0001'")).rows[0].n, 1);
    assert.deepEqual(await suiteOnoff(e, { ...res, nouveau: false }, d), ["audio_deja_la"]);

    // Un autre appel de la même fiche, sans nouvelle annonce : pas conservable, rien n'est téléchargé.
    const r3 = await recevoir({ ...corps, id: "demo-base-0002", callStarted: iso(-20), callEnded: iso(-5) });
    assert.equal(r3.statut, 200);
    assert.match(journal.at(-1), /audio_non/);

    // La reprise différée compte ses tentatives dans la base.
    const { f: f2 } = fauxFetch([[/\/recording$/, () => reponseJson({}, 404)], ["/logs", () => reponseJson({}, 404)]]);
    await client.query("update public.appels set enregistrement_chemin = null where externe_id = 'demo-base-0001'");
    const codes = await recupererAppel("onoff", { externeId: "demo-base-0001", workspaceId: EQUIPE_A, tentatives: 0, derniereTentative: null }, recuperateurOnoff, { ...d, fetch: f2 });
    assert.deepEqual(codes, ["enregistrement_pas_pret"]);
    assert.equal((await client.query("select tentatives from public.appels where externe_id = 'demo-base-0001'")).rows[0].tentatives, 1);

    // Aircall : un appel terminé, avec l'annonce jouée par personne : pas conservable ; la suite ne télécharge rien.
    const { f: f3, vus } = fauxFetch([["", () => reponseAudio(8)]]);
    const evenement = {
      event: "call.ended",
      token: "x",
      data: { id: 900001, direction: "outbound", status: "done", started_at: Math.round(maintenant / 1000) - 120, answered_at: Math.round(maintenant / 1000) - 110, ended_at: Math.round(maintenant / 1000) - 10, duration: 100, raw_digits: "+33 1 99 00 01 01", user: { email: "membre.a@example.com" }, recording: "https://cdn.example.org/a.mp3" },
    };
    const [ea] = lireAircall(evenement);
    const ra = (await rpc("evenement_appel", { p_evenement: Object.fromEntries(Object.entries(ea).filter(([k]) => k !== "urlEnregistrement")) })).data;
    assert.equal(ra.conserverAudio, false);
    assert.deepEqual(await suiteAircall(ea, ra, { ...d, fetch: f3 }), ["audio_ignore"]);
    assert.equal(vus.length, 0);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
});
