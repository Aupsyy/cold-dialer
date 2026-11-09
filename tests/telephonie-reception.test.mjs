// La réception d'un webhook de téléphonie (lib/telephonie/reception.ts), le chemin commun à tous les fournisseurs : 404, 503 sans rien
// lire, 413, 400, 401, 200 ignoré, une écriture evenement_appel par événement (les seules clés lues par la base, le numéro en E.164),
// 500 si la base refuse, la suite planifiée APRÈS la réponse, un journal sans aucune donnée.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TAILLE_MAX_CORPS } from "../lib/integrations/base.ts";
import { evenementPourBase, recevoirWebhookTelephonie } from "../lib/telephonie/reception.ts";
import { REGISTRE_TELEPHONIE } from "../lib/telephonie/registre.ts";
import { CHAMPS_EVENEMENT_APPEL } from "../lib/telephonie/types.ts";
import { EMAIL, ENV_BASE, WS, fausseBase, journalPropre } from "./telephonie-faux.mjs";

const JETON = "jeton-onoff-de-test-0123456789";
const ENV = { ...ENV_BASE, ONOFF_WEBHOOK_TOKEN: JETON };
const URL_AUDIO = "https://stockage.example.org/audio/demo.mp4?signature=inventee";
const CDR = {
  id: "demo-0001",
  eventName: "CDR",
  onoffUserEmail: EMAIL,
  externalNumber: "01 99 00 01 01",
  callStarted: "2026-11-09T09:00:00Z",
  callEnded: "2026-11-09T09:03:05Z",
  callDuration: 185,
  callDirection: "OUTBOUND",
  callStatus: "ANSWERED",
};
const RECORDING = { ...CDR, eventName: "RECORDING", callRecordingUrl: URL_AUDIO };

function requete(corps, { entetes = { "x-api-key": JETON }, url = "https://poste.example.org/api/telephonie/onoff/webhook" } = {}) {
  const brut = typeof corps === "string" || corps instanceof Uint8Array ? corps : JSON.stringify(corps);
  return new Request(url, { method: "POST", body: brut, headers: { "content-type": "application/json", ...entetes } });
}

function recepteur({ env = ENV, base = fausseBase(), actif = "onoff", indicatif = "+33", registre, dependances } = {}) {
  const journal = [];
  const suites = [];
  const d = {
    env,
    fournisseurActif: actif,
    indicatif,
    base: () => base.rpc,
    journal: (code, grave = false) => journal.push({ code, grave }),
    planifier: (suite) => suites.push(suite),
    dependances: dependances ?? (() => ({ env, base: () => base.rpc, journal: () => {}, fetch: async () => new Response("", { status: 404 }), deposer: async () => ({ ok: true }), maintenant: () => 0, attendre: async () => {} })),
    registre,
  };
  return { d, base, journal, suites, recevoir: (f, req) => recevoirWebhookTelephonie(f, req, d) };
}

test("404 : fournisseur inconnu, sans webhook, ou autre que celui de la config ; rien n'est lu", async () => {
  for (const [f, actif] of [["autre", "onoff"], ["telephone", "telephone"], ["softphone", "softphone"], ["onoff", "aircall"], ["__proto__", "onoff"]]) {
    const r = recepteur({ actif });
    const req = requete(CDR);
    const rep = await r.recevoir(f, req);
    assert.equal(rep.statut, 404, `${f} (actif : ${actif})`);
    assert.equal(req.bodyUsed, false);
    assert.equal(r.base.rpcs.length, 0);
  }
});

test("503 sans rien lire : variable du fournisseur absente, variable de la base absente, secret trop court", async () => {
  for (const env of [{ ...ENV, ONOFF_WEBHOOK_TOKEN: "" }, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: " " }, { ONOFF_WEBHOOK_TOKEN: JETON }]) {
    const r = recepteur({ env });
    const req = requete(CDR);
    const rep = await r.recevoir("onoff", req);
    assert.equal(rep.statut, 503);
    assert.deepEqual(rep.corps, { ok: false, code: "non_configure" });
    assert.equal(req.bodyUsed, false, "le corps n'est pas lu");
    assert.equal(r.base.rpcs.length, 0);
    assert.match(r.journal[0].code, /non_configure:/);
  }
  const court = recepteur({ env: { ...ENV, ONOFF_WEBHOOK_TOKEN: "trop-court" } });
  const rep = await court.recevoir("onoff", requete(CDR, { entetes: { "x-api-key": "trop-court" } }));
  assert.deepEqual([rep.statut, rep.corps.code], [503, "secret_trop_court"]);
  journalPropre(assert, court.journal, ["trop-court"]);
});

test("413 : taille annoncée (sans lire) ou réelle (lecture arrêtée) au-delà de 256 Ko", async () => {
  const r = recepteur();
  const annonce = new Request("https://poste.example.org/api/telephonie/onoff/webhook", {
    method: "POST",
    body: "{}",
    headers: { "x-api-key": JETON, "content-length": String(TAILLE_MAX_CORPS + 1) },
  });
  assert.equal((await r.recevoir("onoff", annonce)).statut, 413);
  let envoyes = 0;
  const flux = new ReadableStream({
    pull(c) {
      envoyes += 1;
      if (envoyes > 100) c.close();
      else c.enqueue(new Uint8Array(64 * 1024).fill(32));
    },
  });
  const sansLongueur = new Request("https://poste.example.org/api/telephonie/onoff/webhook", { method: "POST", body: flux, duplex: "half", headers: { "x-api-key": JETON } });
  assert.equal((await r.recevoir("onoff", sansLongueur)).statut, 413);
  assert.ok(envoyes < 10, `lecture arrêtée tôt (${envoyes} morceaux)`);
  assert.equal(r.base.rpcs.length, 0);
});

test("400 : pas du JSON, ou pas de l'UTF-8 ; 401 : jeton faux ou absent ; rien d'écrit", async () => {
  const r = recepteur();
  assert.equal((await r.recevoir("onoff", requete("{pas du json"))).statut, 400);
  assert.equal((await r.recevoir("onoff", requete(new Uint8Array([0x7b, 0xff, 0x7d])))).statut, 400);
  assert.equal((await r.recevoir("onoff", requete(CDR, { entetes: { "x-api-key": `${JETON}x` } }))).statut, 401);
  assert.equal((await r.recevoir("onoff", requete(CDR, { entetes: {} }))).statut, 401);
  assert.equal(r.base.rpcs.length, 0);
  journalPropre(assert, r.journal, [JETON]);
});

test("200 sans écrire : l'essai d'Onoff à la création de l'intégration, un événement non suivi, un identifiant illisible", async () => {
  const r = recepteur();
  for (const corps of [{}, { test: true }, { eventName: "SMS", id: "x1" }, { ...CDR, id: "pas valable !" }, [], { ...CDR, id: undefined }]) {
    const rep = await r.recevoir("onoff", requete(corps));
    assert.deepEqual([rep.statut, rep.corps], [200, { ok: true, ignore: true }], JSON.stringify(corps));
  }
  assert.equal(r.base.rpcs.length, 0);
  assert.equal(r.suites.length, 0);
});

test("200 : UNE écriture evenement_appel, avec les seules clés lues par la base, le numéro en E.164 ; la suite est planifiée après", async () => {
  const r = recepteur();
  const rep = await r.recevoir("onoff", requete(RECORDING));
  assert.deepEqual([rep.statut, rep.corps], [200, { ok: true, evenements: 1 }]);
  assert.equal(r.base.rpcs.length, 1);
  const { fonction, args } = r.base.rpcs[0];
  assert.equal(fonction, "evenement_appel");
  assert.deepEqual(Object.keys(args), ["p_evenement"]);
  assert.deepEqual(Object.keys(args.p_evenement).sort(), [...CHAMPS_EVENEMENT_APPEL].sort());
  assert.ok(!JSON.stringify(args).includes("stockage.example.org"), "l'URL de l'audio ne va jamais à la base");
  assert.equal(args.p_evenement.numeroExterne, "+33199000101", "numéro national lu avec l'indicatif de l'instance");
  assert.equal(args.p_evenement.emailAppelant, EMAIL);
  assert.equal(r.suites.length, 1, "une suite, planifiée (after())");
  journalPropre(assert, r.journal, [JETON, "0101", "demo-0001", WS]);
  assert.match(r.journal.at(-1).code, /^onoff:repondu:nouveau:fiche:appelant:audio_permis/);
});

test("la suite reçoit l'événement complet (URL de l'audio comprise) et le résultat de la base ; une erreur de la suite ne remonte pas", async () => {
  const vus = [];
  const registre = {
    ...REGISTRE_TELEPHONIE,
    onoff: {
      ...REGISTRE_TELEPHONIE.onoff,
      webhook: {
        ...REGISTRE_TELEPHONIE.onoff.webhook,
        apres: async (e, res) => {
          vus.push([e, res]);
          throw new Error("panne inventée");
        },
      },
    },
  };
  const r = recepteur({ registre });
  await r.recevoir("onoff", requete(RECORDING));
  await r.suites[0]();
  assert.equal(vus.length, 1);
  assert.equal(vus[0][0].urlEnregistrement, URL_AUDIO);
  assert.equal(vus[0][0].numeroExterne, "+33199000101");
  assert.equal(vus[0][1].workspaceId, WS);
  assert.equal(vus[0][1].conserverAudio, true);
  assert.ok(r.journal.some((l) => l.code === "onoff:suite_erreur" && l.grave));
});

test("500 si la base refuse (le fournisseur réessaiera), avec un code et rien d'autre ; 503 si la base n'est pas configurée", async () => {
  const r = recepteur({ base: fausseBase({ erreur: { code: "XX000", message: "détail interne à ne pas montrer" } }) });
  const rep = await r.recevoir("onoff", requete(CDR));
  assert.deepEqual([rep.statut, rep.corps], [500, { ok: false, code: "base_XX000" }]);
  assert.equal(r.suites.length, 0);
  journalPropre(assert, r.journal, ["détail interne"]);
  const sansBase = recepteur();
  sansBase.d.base = () => {
    throw new Error("Client service non configuré.");
  };
  assert.equal((await sansBase.recevoir("onoff", requete(CDR))).statut, 503);
});

test("evenementPourBase : un numéro international garde son pays ; un numéro illisible devient null", () => {
  const e = { fournisseur: "onoff", externeId: "x", direction: "sortant", statut: "inconnu", debut: null, fin: null, dureeS: null, emailAppelant: null, annonceJouee: false, urlEnregistrement: URL_AUDIO };
  assert.equal(evenementPourBase({ ...e, numeroExterne: "+41220000000" }, "+33").numeroExterne, "+41220000000");
  assert.equal(evenementPourBase({ ...e, numeroExterne: "0220000001" }, "+32").numeroExterne, "+32220000001");
  assert.equal(evenementPourBase({ ...e, numeroExterne: "02 000 00 01" }, "+32").numeroExterne, "+3220000001");
  assert.equal(evenementPourBase({ ...e, numeroExterne: "n'importe" }, "+33").numeroExterne, null);
  assert.ok(!("urlEnregistrement" in evenementPourBase({ ...e, numeroExterne: null }, "+33")));
});

test("téléchargement de l'audio : https seulement, hôte public, redirections vérifiées une à une (3 au plus)", async () => {
  const { telechargerAudio, urlTelechargeable } = await import("../lib/telephonie/audio.ts");
  for (const ko of ["http://cdn.example.org/a.mp3", "https://127.0.0.1/a.mp3", "https://[::1]/a.mp3", "https://localhost/a.mp3", "https://serveur.internal/a.mp3", "https://intranet/a.mp3", "file:///etc/passwd"]) {
    assert.equal(urlTelechargeable(ko), null, ko);
  }
  assert.equal(urlTelechargeable("https://cdn.example.org/a.mp3?x=1"), "https://cdn.example.org/a.mp3?x=1");
  const redirection = (vers) => () => new Response(null, { status: 302, headers: { location: vers } });
  const audio = () => new Response(new Uint8Array(4).fill(1), { status: 200, headers: { "content-type": "audio/mpeg" } });
  const appels = [];
  const fetchSuivi = (routes) => async (url) => {
    appels.push(url);
    return (routes[url] ?? (() => new Response("", { status: 404 })))();
  };
  const ok = await telechargerAudio("https://a.example.org/1", { fetch: fetchSuivi({ "https://a.example.org/1": redirection("/2"), "https://a.example.org/2": redirection("https://b.example.org/3.mp3"), "https://b.example.org/3.mp3": audio }) }, "mp4");
  assert.equal(ok.ok, true);
  assert.equal(ok.ext, "mp3");
  const versHttp = await telechargerAudio("https://a.example.org/1", { fetch: fetchSuivi({ "https://a.example.org/1": redirection("http://169.254.169.254/latest") }) }, "mp4");
  assert.deepEqual(versHttp, { ok: false, code: "redirection_refusee" });
  const boucle = await telechargerAudio("https://a.example.org/x", { fetch: fetchSuivi({ "https://a.example.org/x": redirection("/x") }) }, "mp4");
  assert.deepEqual(boucle, { ok: false, code: "redirection_refusee" });
  assert.ok(!appels.some((u) => u.startsWith("http://")), "aucune requête hors https");
});
