// L'installation, la vérification d'une instance (scripts/install/verifier.mjs). Le fetch est simulé par une « instance » qui répond
// avec le VRAI code de l'application : /api/sante (lib/sante.ts), les réceptions de webhooks (lib/telephonie/reception.ts et
// lib/agenda/webhook.ts, avec les vrais adaptateurs), les tâches planifiées (lib/agenda/synchro-google.ts, autoriseCron) et les en-têtes
// (lib/securite/entetes.ts). On vérifie que chaque webhook accepte l'événement de test signé avec le bon secret, refuse un mauvais
// secret, que rien n'est écrit en base, et que la sortie ne porte jamais une valeur.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { creerRegistreAgenda } from "../lib/agenda/registre.ts";
import { recevoirSyncGoogle } from "../lib/agenda/synchro-google.ts";
import { recevoirWebhookAgenda } from "../lib/agenda/webhook.ts";
import { VERSION_SCHEMA, etatSante } from "../lib/sante.ts";
import { entetesSecurite } from "../lib/securite/entetes.ts";
import { LONGUEURS_MIN_SECRETS } from "../lib/telephonie/outils.ts";
import { recevoirWebhookTelephonie } from "../lib/telephonie/reception.ts";
import { autoriseCron } from "../lib/telephonie/recuperation.ts";
import { adaptateurTelephonie, originesMicro } from "../lib/telephonie/registre.ts";
import { MODES_PAR_FOURNISSEUR } from "../lib/telephonie/types.ts";
import { chargerRegistres, origineValide, requeteWebhook, secretsLocaux, verifierInstance, WEBHOOKS } from "../scripts/install/verifier.mjs";
import { exemple } from "./aides.mjs";

const ORIGINE = "https://atelier-demo.example.org";
const MAINTENANT_S = 1_794_000_000;
const registres = await chargerRegistres();

function niche(telephonie, agenda) {
  const n = exemple();
  n.telephonie = { fournisseur: telephonie, mode: MODES_PAR_FOURNISSEUR[telephonie][0], copierNumero: true, enregistrement: false };
  n.agenda = { fournisseur: agenda, prefill: false, champLead: "utm_content" };
  if (agenda === "calendly" || agenda === "iclosed") n.agenda.lienReservation = "https://example.org/reserver";
  return chargerNiche(n);
}

/** Des secrets tirés à chaque test (jamais écrits en dur dans le dépôt). */
function secretsTires() {
  const s = () => randomBytes(32).toString("base64url");
  return {
    ONOFF_WEBHOOK_TOKEN: s(),
    AIRCALL_WEBHOOK_TOKEN: s(),
    RINGOVER_WEBHOOK_SECRET: s(),
    CALENDLY_WEBHOOK_SIGNING_KEY: s(),
    ICLOSED_WEBHOOK_SECRET: s(),
    CRON_SECRET: s(),
  };
}

/**
 * Une instance déployée, simulée avec le code réel. `env` : les variables posées dans Vercel ; `deploye` : la config déployée (par
 * défaut la même que la config locale) ; `base` : compte les appels à la base (il ne doit jamais y en avoir).
 */
function instance({ env, deploye, sante = {}, entetes = null, protection = false }) {
  const appelsBase = [];
  const base = () => {
    appelsBase.push("base");
    return async () => ({ data: null, error: { code: "XX000" } });
  };
  const journal = () => {};
  const requetes = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    requetes.push({ chemin: u.pathname, methode: init.method ?? "GET" });
    if (protection) return new Response("Authentication Required", { status: 401 });
    const req = new Request(url, { method: init.method ?? "GET", headers: init.headers, body: init.body });
    const json = (corps, statut) => Response.json(corps, { status: statut });
    if (u.pathname === "/api/sante") {
      const e = etatSante({
        env,
        sondage: { baseJoignable: sante.baseJoignable ?? true, versionSchema: sante.versionSchema === undefined ? VERSION_SCHEMA : sante.versionSchema },
        configValide: sante.configValide ?? true,
        variablesTelephonie: adaptateurTelephonie(deploye.telephonie.fournisseur)?.webhook?.variables ?? [],
        variablesAgenda: registres.variablesAgenda(deploye.agenda.fournisseur),
      });
      return json(e, e.ok ? 200 : 503);
    }
    let m = /^\/api\/telephonie\/([a-z]+)\/webhook$/.exec(u.pathname);
    if (m) {
      const r = await recevoirWebhookTelephonie(m[1], req, {
        env,
        fournisseurActif: deploye.telephonie.fournisseur,
        indicatif: deploye.pays.indicatif,
        base,
        journal,
        planifier: () => {},
        dependances: () => {
          throw new Error("aucune suite attendue");
        },
      });
      return json(r.corps, r.statut);
    }
    m = /^\/api\/agenda\/([a-z]+)\/webhook$/.exec(u.pathname);
    if (m) {
      const r = await recevoirWebhookAgenda(m[1], req, { env, base, journal, maintenantS: () => MAINTENANT_S, registre: creerRegistreAgenda() });
      return json(r.corps, r.statut);
    }
    if (u.pathname === "/api/agenda/google/sync") {
      const r = await recevoirSyncGoogle(req, {
        env,
        fetch: async () => {
          throw new Error("Google ne doit pas être appelé");
        },
        base,
        journal,
        maintenant: () => MAINTENANT_S * 1000,
        emailsEquipe: async () => new Set(),
        dejaTraites: async () => new Set(),
        fournisseurActif: deploye.agenda.fournisseur,
      });
      return json(r.corps, r.statut);
    }
    if (u.pathname === "/api/telephonie/recuperation") {
      // Les deux premiers contrôles de la route (app/api/telephonie/recuperation/route.ts).
      if ((env.CRON_SECRET ?? "").trim().length < LONGUEURS_MIN_SECRETS.CRON_SECRET) return json({ ok: false, code: "non_configure" }, 503);
      if (!autoriseCron(req.headers.get("authorization"), env)) return json({ ok: false, code: "refuse" }, 401);
      return json({ ok: true, rien: "fournisseur_sans_reprise" }, 200);
    }
    if (u.pathname === "/login") {
      const h = new Headers();
      for (const { key, value } of entetes ?? entetesSecurite(originesMicro(deploye.telephonie.fournisseur))) h.set(key, value);
      return new Response("<!doctype html>", { status: 200, headers: h });
    }
    return new Response("introuvable", { status: 404 });
  };
  return { fetch, appelsBase, requetes };
}

const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: "https://projet-demo.example.org", NEXT_PUBLIC_SUPABASE_ANON_KEY: "cle-publique-demo", SUPABASE_SERVICE_ROLE_KEY: "cle-service-demo" };

async function verifier(n, { env, secrets = {}, ...autres }) {
  const inst = instance({ env, deploye: autres.deploye ?? n, ...autres });
  const r = await verifierInstance({ origine: ORIGINE, niche: n, secrets, fetch: inst.fetch, maintenantS: () => MAINTENANT_S, registres });
  return { ...r, ...inst, texte: r.lignes.join("\n") };
}

function aucuneValeur(texte, secrets) {
  for (const v of Object.values(secrets)) assert.ok(!texte.includes(v), "une valeur est affichée");
  assert.ok(!texte.includes("atelier-demo.example.org"), "le domaine n'est pas affiché");
}

test("chaque webhook accepte l'événement de test signé avec le bon secret, refuse un mauvais secret, et rien n'est écrit en base", async () => {
  for (const [tel, ag] of [
    ["onoff", "calendly"],
    ["aircall", "iclosed"],
    ["ringover", "aucun"],
  ]) {
    const secrets = secretsTires();
    const env = { ...SUPABASE, ...secrets };
    const n = niche(tel, ag);
    const r = await verifier(n, { env, secrets });
    assert.equal(r.code, 0, `${tel} + ${ag} :\n${r.texte}`);
    for (const f of [tel, ag].filter((x) => WEBHOOKS[x])) {
      assert.match(r.texte, new RegExp(`OK : ${WEBHOOKS[f].libelle} : un mauvais secret est refusé \\(401\\)`));
      assert.match(r.texte, new RegExp(`OK : ${WEBHOOKS[f].libelle} : un événement de test signé avec le bon secret est accepté \\(200\\)`));
    }
    assert.deepEqual(r.appelsBase, [], "aucun appel à la base : l'événement de test est ignoré par l'application");
    aucuneValeur(r.texte, secrets);
  }
});

test("chaque requête de test passe la vérification de l'adaptateur réel, et un autre secret ne la passe pas", async () => {
  const secrets = secretsTires();
  const env = { ...SUPABASE, ...secrets };
  const registreAgenda = creerRegistreAgenda();
  for (const f of ["onoff", "aircall", "ringover", "calendly", "iclosed"]) {
    const w = WEBHOOKS[f];
    const adaptateur = adaptateurTelephonie(f) ?? registreAgenda[f];
    assert.deepEqual([...adaptateur.webhook.variables], [w.variable], f);
    for (const [secret, attendu] of [
      [secrets[w.variable], true],
      [randomBytes(32).toString("base64url"), false],
    ]) {
      const { url, init } = requeteWebhook(f, ORIGINE, secret, MAINTENANT_S);
      const corps = new TextEncoder().encode(init.body);
      const req = new Request(url, init);
      assert.equal(await adaptateur.webhook.verifier(req, corps, env, MAINTENANT_S), attendu, `${f} : ${attendu ? "accepté" : "refusé"}`);
      // L'événement de test ne produit aucun événement à écrire.
      assert.deepEqual(adaptateur.webhook.lire(JSON.parse(init.body)), [], `${f} : événement ignoré`);
    }
  }
  // Calendly : une signature trop ancienne (plus de 3 minutes) est refusée.
  const { url, init } = requeteWebhook("calendly", ORIGINE, secrets.CALENDLY_WEBHOOK_SIGNING_KEY, MAINTENANT_S - 600);
  assert.equal(await registreAgenda.calendly.webhook.verifier(new Request(url, init), new TextEncoder().encode(init.body), env, MAINTENANT_S), false);
});

test("sans secret local : le refus seulement (pas d'à faire), l'acceptation est dite non testée", async () => {
  const secrets = secretsTires();
  const r = await verifier(niche("onoff", "iclosed"), { env: { ...SUPABASE, ...secrets } });
  assert.equal(r.code, 0, r.texte);
  assert.match(r.texte, /OK : webhook Onoff : un mauvais secret est refusé \(401\)/);
  assert.match(r.texte, /OK : webhook Onoff : acceptation non testée \(ONOFF_WEBHOOK_TOKEN inconnue ici : --env-file\)/);
  assert.match(r.texte, /OK : webhook iClosed : acceptation non testée/);
  aucuneValeur(r.texte, secrets);
});

test("un secret local différent de celui de Vercel, une variable absente : À FAIRE, code 1", async () => {
  const vercel = secretsTires();
  const local = secretsTires();
  const r = await verifier(niche("ringover", "calendly"), { env: { ...SUPABASE, ...vercel }, secrets: local });
  assert.equal(r.code, 1);
  assert.match(r.texte, /À FAIRE : webhook Ringover : le bon secret est refusé \(401\)/);
  assert.match(r.texte, /À FAIRE : webhook Calendly : le bon secret est refusé \(401\)/);
  aucuneValeur(r.texte, { ...vercel, ...local });

  const sansVariable = { ...SUPABASE, ...vercel };
  delete sansVariable.RINGOVER_WEBHOOK_SECRET;
  delete sansVariable.CRON_SECRET;
  const s = await verifier(niche("ringover", "aucun"), { env: sansVariable });
  assert.equal(s.code, 1);
  assert.match(s.texte, /À FAIRE : \/api\/sante : il manque une variable de la téléphonie dans Vercel \(RINGOVER_WEBHOOK_SECRET\)/);
  assert.match(s.texte, /À FAIRE : webhook Ringover : 503, RINGOVER_WEBHOOK_SECRET manque dans Vercel/);
  assert.match(s.texte, /À FAIRE : tâche planifiée \/api\/telephonie\/recuperation : CRON_SECRET manque dans Vercel/);
  assert.match(s.texte, /À FAIRE : tâche planifiée \/api\/agenda\/google\/sync : CRON_SECRET manque dans Vercel/);
});

test("les tâches planifiées : 401 avec un mauvais secret quand CRON_SECRET est posée ; elles ne sont jamais lancées", async () => {
  const secrets = secretsTires();
  const r = await verifier(niche("telephone", "google"), {
    env: { ...SUPABASE, ...secrets, GOOGLE_CLIENT_ID: "id-demo", GOOGLE_CLIENT_SECRET: "secret-demo", GOOGLE_REFRESH_TOKEN: "jeton-demo" },
  });
  assert.equal(r.code, 0, r.texte);
  assert.match(r.texte, /OK : tâche planifiée \/api\/telephonie\/recuperation : protégée, CRON_SECRET est posée/);
  assert.match(r.texte, /OK : tâche planifiée \/api\/agenda\/google\/sync : protégée, CRON_SECRET est posée/);
  assert.match(r.texte, /OK : téléphonie « telephone » : pas de webhook à vérifier/);
  assert.match(r.texte, /OK : agenda « google » : pas de webhook à vérifier/);
  assert.deepEqual(r.appelsBase, []);
});

test("/api/sante : chaque faux est expliqué en une phrase", async () => {
  const secrets = secretsTires();
  const env = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL, ...secrets };
  const r = await verifier(niche("onoff", "aucun"), { env, sante: { baseJoignable: false, versionSchema: null, configValide: false } });
  assert.equal(r.code, 1);
  for (const motif of [
    /À FAIRE : \/api\/sante : la base ne répond pas : .*pause/,
    /À FAIRE : \/api\/sante : le schéma n'est pas à jour/,
    /À FAIRE : \/api\/sante : la config déployée est refusée : « npm test »/,
    /OK : \/api\/sante : NEXT_PUBLIC_SUPABASE_URL est posée/,
    /À FAIRE : \/api\/sante : NEXT_PUBLIC_SUPABASE_ANON_KEY manque dans Vercel/,
    /À FAIRE : \/api\/sante : SUPABASE_SERVICE_ROLE_KEY manque dans Vercel/,
    /OK : \/api\/sante : les variables du webhook de téléphonie sont posées \(ONOFF_WEBHOOK_TOKEN\)/,
  ]) {
    assert.match(r.texte, motif);
  }
});

test("les en-têtes : le micro doit aller au fournisseur de la config (un déploiement avec un autre fournisseur est signalé)", async () => {
  const secrets = secretsTires();
  const env = { ...SUPABASE, ...secrets };
  const bon = await verifier(niche("aircall", "aucun"), { env });
  assert.match(bon.texte, /OK : Permissions-Policy : le micro est permis à l'application et à aircall/);
  assert.match(bon.texte, /OK : X-Frame-Options : DENY/);
  assert.match(bon.texte, /OK : X-Content-Type-Options : nosniff/);
  assert.match(bon.texte, /OK : Content-Security-Policy : frame-ancestors 'none'/);

  // La config locale dit Onoff, mais l'instance a été construite avec « telephone » (pas redéployée).
  const decale = await verifier(niche("onoff", "aucun"), { env, deploye: niche("telephone", "aucun") });
  assert.equal(decale.code, 1);
  assert.match(decale.texte, /À FAIRE : Permissions-Policy : le micro n'est pas donné à onoff/);
  assert.match(decale.texte, /À FAIRE : webhook Onoff : 404/);

  const sansEntetes = await verifier(niche("telephone", "aucun"), { env, entetes: [] });
  assert.match(sansEntetes.texte, /À FAIRE : Permissions-Policy : le micro n'est pas réglé/);
  assert.match(sansEntetes.texte, /À FAIRE : X-Frame-Options : DENY attendu/);
  assert.match(sansEntetes.texte, /OK : Content-Security-Policy : absente \(permis\)/);
});

test("une adresse protégée par Vercel (401) ou injoignable : arrêt avec une explication", async () => {
  const p = await verifier(niche("onoff", "aucun"), { env: SUPABASE, protection: true });
  assert.equal(p.code, 1);
  assert.match(p.texte, /À FAIRE : \/api\/sante répond 401 : la protection des déploiements de Vercel/);
  assert.equal(p.requetes.length, 1, "on s'arrête là");

  const r = await verifierInstance({
    origine: ORIGINE,
    niche: niche("onoff", "aucun"),
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
    maintenantS: () => MAINTENANT_S,
    registres,
  });
  assert.equal(r.code, 1);
  assert.match(r.lignes.join("\n"), /À FAIRE : l'adresse ne répond pas/);
});

test("l'adresse et les secrets locaux : https seulement (localhost permis), --env-file lu sans rien afficher", () => {
  assert.equal(origineValide("https://atelier-demo.example.org/chemin?x=1"), "https://atelier-demo.example.org");
  assert.equal(origineValide("http://localhost:3000"), "http://localhost:3000");
  assert.equal(origineValide("http://atelier-demo.example.org"), null);
  assert.equal(origineValide("https://utilisateur:motdepasse@example.org"), null);
  assert.equal(origineValide("pas une adresse"), null);

  const dossier = mkdtempSync(join(tmpdir(), "verifier-"));
  try {
    const secrets = secretsTires();
    const fichier = join(dossier, "secrets.env");
    writeFileSync(fichier, `ONOFF_WEBHOOK_TOKEN=${secrets.ONOFF_WEBHOOK_TOKEN}\nAUTRE=ignoree\n`);
    const lus = secretsLocaux(fichier, { ICLOSED_WEBHOOK_SECRET: secrets.ICLOSED_WEBHOOK_SECRET, PATH: "/bin" });
    assert.deepEqual(Object.keys(lus).sort(), ["ICLOSED_WEBHOOK_SECRET", "ONOFF_WEBHOOK_TOKEN"]);
    assert.equal(lus.ONOFF_WEBHOOK_TOKEN, secrets.ONOFF_WEBHOOK_TOKEN);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
