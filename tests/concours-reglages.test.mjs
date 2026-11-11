// Le branchement à la session commune depuis l'écran Réglages : lecture du lien collé, pseudo, réponses des fonctions SQL, choix de la
// configuration d'envoi (la base d'abord, les variables ensuite), début d'appel, et les actions serveur exécutées pour de vrai avec le vrai
// client Supabase dont seul le réseau est simulé (comme tests/reglages-actions.test.mjs). Le service de la session est un faux fetch.
// Le SQL de la migration 0002 est joué par supabase/tests/concours_branchement.sql (npm run test:sql), pas ici.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register(
  "data:text/javascript," +
    encodeURIComponent(`
let faux = "";
let factices = "";
export async function initialize(d) { faux = d.faux; factices = d.factices; }
export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  if (specifier === "../supabase/server" && parent.endsWith("/lib/server/action-kit.ts")) return { url: faux, shortCircuit: true };
  if (specifier === "@/lib/supabase/service" && (parent.endsWith("/reglages/actions.ts") || parent.endsWith("/lib/concours/serveur.ts"))) return { url: factices, shortCircuit: true };
  if (specifier === "next/cache") return { url: factices, shortCircuit: true };
  return next(specifier, context);
}`),
  {
    parentURL: import.meta.url,
    data: { faux: new URL("./poste-base-factice.mjs", import.meta.url).href, factices: new URL("./reglages-factices.mjs", import.meta.url).href },
  },
);

const base = await import("./poste-base-factice.mjs");
const factices = await import("./reglages-factices.mjs");
const actions = await import("../app/(app)/reglages/actions.ts");
const { enregistrerIssue, signalerDebutAppel } = await import("../app/_actions/issue.ts");
const { configurationEnvoi } = await import("../lib/concours/serveur.ts");
const { ErreurLien, configurationEffective, lireEtatBranchement, lireJetonServeur, lireLienSession, pseudoSessionValide } = await import("../lib/concours/branchement.ts");
const { compteursConcours, envoyerDebut, remettreCompteurs } = await import("../lib/concours/client.ts");
const { lireConfigConcours } = await import("../lib/concours/configuration.ts");
const { ERR_REFUS } = await import("../lib/server/contexte.ts");
const { lire } = await import("./aides.mjs");

const WS = "a0000000-0000-4000-8000-000000000000";
const MOI = "a1000000-0000-4000-8000-000000000001";
const LEAD = "ca100000-0000-4000-8000-000000000001";
const JETON = "jeton-secret-de-test-0123456789";
const URL_SERVICE = "https://concours.example.org";
const LIEN = `${URL_SERVICE}/concours/abcd1234`;

const messageDe = (f) => {
  try {
    f();
  } catch (e) {
    assert.ok(e instanceof ErreurLien, "une ErreurLien, jamais une autre exception");
    return e.message;
  }
  return null;
};

function session(role, routes = {}) {
  base.repondre((r) => {
    if (r.methode === "POST" && r.chemin === "rpc/contexte") return { corps: role ? { uid: MOI, workspace_id: WS, role, nom: "Camille Démo" } : {} };
    const f = routes[`${r.methode} ${r.chemin}`];
    return typeof f === "function" ? f(r) : (f ?? { corps: [] });
  });
}
function service(routes = {}) {
  factices.repondreService((r) => {
    const f = routes[`${r.methode} ${r.chemin}`];
    return typeof f === "function" ? f(r) : (f ?? { corps: [] });
  });
}
const ecritures = () => base.requetes.filter((r) => r.chemin !== "rpc/contexte");
const attendre = () => new Promise((fin) => setTimeout(fin, 30));

/** Le service de la session, simulé sur le fetch global : { statut, corps } par chemin ; les requêtes sont notées. */
function faux(t, reponses = {}) {
  const requetes = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const r = { url: String(url), methode: init.method ?? "GET", corps: typeof init.body === "string" ? JSON.parse(init.body) : null };
    requetes.push(r);
    const [statut, corps] = reponses[new URL(r.url).pathname] ?? [200, {}];
    return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });
  });
  return requetes;
}

/** Les variables CONCOURS_* posées pour le temps du test. */
function variables(t, valeurs) {
  const noms = ["CONCOURS_URL", "CONCOURS_CODE", "CONCOURS_JETON"];
  const avant = Object.fromEntries(noms.map((n) => [n, process.env[n]]));
  for (const n of noms) delete process.env[n];
  Object.assign(process.env, valeurs);
  t.after(() => {
    for (const n of noms) {
      if (avant[n] === undefined) delete process.env[n];
      else process.env[n] = avant[n];
    }
  });
}

test("lien : le lien public, avec ou sans « / » final, paramètres ignorés, code en majuscules", () => {
  assert.deepEqual(lireLienSession(LIEN), { url: URL_SERVICE, code: "ABCD1234" });
  assert.deepEqual(lireLienSession(`${LIEN}/?utm=x#haut`), { url: URL_SERVICE, code: "ABCD1234" });
  assert.deepEqual(lireLienSession("  https://example.org/service/concours/ZZ99AA  "), { url: "https://example.org/service", code: "ZZ99AA" });
  assert.deepEqual(lireLienSession(LIEN, "abcd1234"), { url: URL_SERVICE, code: "ABCD1234" }, "un code identique à celui du lien est accepté");
  assert.deepEqual(lireLienSession("http://localhost:3000/concours/ABCD"), { url: "http://localhost:3000", code: "ABCD" });
});

test("lien : adresse et code séparés", () => {
  assert.deepEqual(lireLienSession("https://example.org", " ab12cd "), { url: "https://example.org", code: "AB12CD" });
  assert.deepEqual(lireLienSession("https://example.org/", "AB12CD"), { url: "https://example.org", code: "AB12CD" });
});

test("lien : chaque erreur est dite en français simple, sans lever autre chose qu'une ErreurLien", () => {
  assert.match(messageDe(() => lireLienSession("")), /Colle le lien complet/);
  assert.match(messageDe(() => lireLienSession(undefined)), /Colle le lien complet/);
  assert.match(messageDe(() => lireLienSession("pas un lien")), /Colle le lien complet/);
  assert.match(messageDe(() => lireLienSession("http://concours.example.org/concours/ABCD1234")), /https:\/\//);
  assert.match(messageDe(() => lireLienSession("ftp://example.org/concours/ABCD1234")), /Colle le lien complet|https/);
  assert.match(messageDe(() => lireLienSession("https://u:p@example.org/concours/ABCD1234")), /identifiant/);
  assert.match(messageDe(() => lireLienSession("https://example.org")), /Colle le lien complet/, "ni code dans le lien ni code saisi");
  assert.match(messageDe(() => lireLienSession("https://example.org", "a")), /4 à 12 caractères/);
  assert.match(messageDe(() => lireLienSession("https://example.org", "AB-12!")), /4 à 12 caractères/);
  assert.match(messageDe(() => lireLienSession(LIEN, "ZZZZ9999")), /ne correspond pas/);
  assert.match(messageDe(() => lireLienSession("https://example.org/concours/AB")), /Colle le lien complet|4 à 12/);
});

test("pseudo : 1 à 40 caractères sans retour à la ligne", () => {
  assert.equal(pseudoSessionValide("  Équipe Soleil "), "Équipe Soleil");
  assert.match(messageDe(() => pseudoSessionValide("   ")), /Choisis un pseudo/);
  assert.match(messageDe(() => pseudoSessionValide(undefined)), /Choisis un pseudo/);
  assert.match(messageDe(() => pseudoSessionValide("a".repeat(41))), /40 caractères/);
  assert.match(messageDe(() => pseudoSessionValide("a\nb")), /40 caractères/);
  assert.equal(pseudoSessionValide("a".repeat(40)).length, 40);
});

test("réponses SQL : l'état n'a jamais le jeton, la lecture serveur le demande entier, une réponse bancale ne donne rien", () => {
  const etat = lireEtatBranchement({ url: URL_SERVICE, code: "ABCD1234", pseudo: "Soleil", rejoint_le: "2026-11-11T09:00:00Z", jeton: JETON });
  assert.deepEqual(etat, { url: URL_SERVICE, code: "ABCD1234", pseudo: "Soleil", rejointLe: "2026-11-11T09:00:00Z" });
  assert.doesNotMatch(JSON.stringify(etat), /jeton|secret/, "même si la base en rendait un par erreur, il n'est pas relayé");
  assert.equal(lireEtatBranchement(null), null);
  assert.equal(lireEtatBranchement([]), null);
  assert.equal(lireEtatBranchement({ url: "http://example.org", code: "ABCD1234", pseudo: "x" }), null);
  assert.equal(lireEtatBranchement({ url: URL_SERVICE, code: "ab", pseudo: "x" }), null);
  assert.deepEqual(lireJetonServeur({ url: URL_SERVICE, code: "ABCD1234", jeton: JETON }), { url: URL_SERVICE, code: "ABCD1234", jeton: JETON });
  assert.equal(lireJetonServeur({ url: URL_SERVICE, code: "ABCD1234", jeton: "court" }), null);
  assert.equal(lireJetonServeur({ url: URL_SERVICE, code: "ABCD1234" }), null);
  assert.equal(lireJetonServeur("x"), null);
});

test("configuration d'envoi : la base d'abord, les variables ensuite, sinon rien", () => {
  const env = { CONCOURS_URL: "https://autre.example.org", CONCOURS_CODE: "ENVV1234", CONCOURS_JETON: "jeton-des-variables-123" };
  const enBase = { url: URL_SERVICE, code: "ABCD1234", jeton: JETON };
  assert.deepEqual(configurationEffective(enBase, env), enBase);
  assert.deepEqual(configurationEffective(null, env), lireConfigConcours(env));
  assert.equal(configurationEffective(null, {}), null);
});

test("envoyerDebut : { jeton, debut: true } vers …/evenement, rien de la fiche, 400 toléré, ne lève jamais", async () => {
  remettreCompteurs();
  const config = { url: URL_SERVICE, code: "ABCD1234", jeton: JETON };
  const appels = [];
  const f = (statut, corps = {}) => async (url, init) => {
    appels.push({ url, init, corps: JSON.parse(init.body) });
    return { status: statut, json: async () => corps };
  };
  assert.equal(await envoyerDebut(config, { fetch: f(200) }), "envoye");
  assert.equal(appels[0].url, `${URL_SERVICE}/api/concours/ABCD1234/evenement`);
  assert.equal(appels[0].init.method, "POST");
  assert.equal(appels[0].init.redirect, "error");
  assert.deepEqual(appels[0].corps, { jeton: JETON, debut: true });
  assert.equal(await envoyerDebut(config, { fetch: f(400, { erreur: "issue_invalide" }) }), "ignore", "un service qui ne connaît pas « debut » ne casse rien");
  assert.equal(await envoyerDebut(config, { fetch: f(401, { erreur: "jeton_inconnu" }) }), "echec");
  assert.equal(await envoyerDebut(config, { fetch: f(500) }), "echec");
  assert.equal(await envoyerDebut(config, { fetch: async () => { throw new Error(`${URL_SERVICE} ${JETON}`); } }), "echec");
  assert.equal(await envoyerDebut(config, { fetch: () => { throw new TypeError("synchrone"); } }), "echec");
  const suspendu = (_u, init) => new Promise((_, rejeter) => init.signal.addEventListener("abort", () => rejeter(init.signal.reason)));
  const t0 = Date.now();
  assert.equal(await envoyerDebut(config, { fetch: suspendu, delaiMs: 50 }), "echec");
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(appels.length, 4, "pas de nouvelle tentative");
  assert.deepEqual({ envoyes: compteursConcours.envoyes, echecs: compteursConcours.echecs }, { envoyes: 0, echecs: 0 }, "les compteurs d'issues ne bougent pas");
});

test("lireSessionCommune : l'état sans jeton ; sans la migration, « base pas à jour » au lieu d'une erreur", async () => {
  service();
  session("appelant", { "POST rpc/concours_etat": { corps: { url: URL_SERVICE, code: "ABCD1234", pseudo: "Soleil", rejoint_le: "2026-11-11T09:00:00Z" } } });
  const r = await actions.lireSessionCommune();
  assert.equal(r.ok, true);
  assert.equal(r.data.baseAJour, true);
  assert.equal(r.data.branchement.pseudo, "Soleil");
  assert.doesNotMatch(JSON.stringify(r), /jeton/);
  session("appelant", { "POST rpc/concours_etat": { status: 404, corps: { code: "PGRST202", message: "fonction absente" } } });
  assert.deepEqual(await actions.lireSessionCommune(), { ok: true, data: { branchement: null, baseAJour: false } });
  session("appelant", { "POST rpc/concours_etat": { corps: null } });
  assert.deepEqual(await actions.lireSessionCommune(), { ok: true, data: { branchement: null, baseAJour: true } });
  session(null);
  assert.deepEqual(await actions.lireSessionCommune(), { ok: false, error: "Tu dois être connecté." });
});

test("rejoindreSession : refusé à un appelant avant tout appel ; une saisie invalide s'arrête avant le service", async (t) => {
  service();
  const requetes = faux(t);
  session("appelant");
  assert.deepEqual(await actions.rejoindreSession({ lien: LIEN, pseudo: "Soleil" }), { ok: false, error: ERR_REFUS });
  assert.deepEqual(await actions.quitterSession(), { ok: false, error: ERR_REFUS });
  assert.deepEqual(ecritures(), []);
  session("membre");
  for (const entree of [{ lien: "pas un lien", pseudo: "Soleil" }, { lien: "http://example.org/concours/ABCD1234", pseudo: "Soleil" }, { lien: LIEN, pseudo: " " }, "n'importe quoi", null]) {
    const r = await actions.rejoindreSession(entree);
    assert.equal(r.ok, false);
  }
  assert.deepEqual(ecritures(), [], "rien n'est demandé à la base");
  assert.deepEqual(requetes, [], "rien n'est demandé au service");
});

test("rejoindreSession : sonde la base, rejoint le service, range le résultat ; le jeton ne revient jamais", async (t) => {
  service();
  const requetes = faux(t, { "/api/concours/ABCD1234/rejoindre": [200, { participant: "p1", jeton: JETON, pseudo: "Soleil" }] });
  session("membre", { "POST rpc/concours_etat": { corps: null }, "POST rpc/concours_poser": { corps: null } });
  const r = await actions.rejoindreSession({ lien: `${LIEN}?x=1`, code: "", pseudo: "  Soleil " });
  assert.deepEqual(r, { ok: true, data: { pseudo: "Soleil" } });
  assert.doesNotMatch(JSON.stringify(r), /jeton|secret/);
  assert.equal(requetes.length, 1);
  assert.equal(requetes[0].url, `${URL_SERVICE}/api/concours/ABCD1234/rejoindre`);
  assert.deepEqual(requetes[0].corps, { pseudo: "Soleil", source: "dialer" });
  assert.deepEqual(ecritures().map((x) => x.chemin), ["rpc/concours_etat", "rpc/concours_poser"], "la base est sondée AVANT de rejoindre");
  assert.deepEqual(ecritures()[1].corps, { p_url: URL_SERVICE, p_code: "ABCD1234", p_pseudo: "Soleil", p_jeton: JETON });
  assert.ok(factices.revalidations.includes("/reglages"));
  assert.deepEqual(factices.requetesService, [], "la clé service ne sert pas à ranger : c'est la session du gestionnaire");
});

test("rejoindreSession : sans la migration 0002, on ne prend pas de pseudo au service", async (t) => {
  service();
  const requetes = faux(t);
  const journal = t.mock.method(console, "error", () => {});
  session("proprietaire", { "POST rpc/concours_etat": { status: 404, corps: { code: "PGRST202", message: "adresse https://secret.example.org" } } });
  const r = await actions.rejoindreSession({ lien: LIEN, pseudo: "Soleil" });
  assert.equal(r.ok, false);
  assert.match(r.error, /0002_concours_branchement\.sql/);
  assert.deepEqual(requetes, []);
  assert.doesNotMatch(journal.mock.calls.map((c) => c.arguments.join(" ")).join("\n"), /secret\.exemple|https|jeton/, "des codes seulement");
});

test("rejoindreSession : chaque refus du service est dit, rien n'est rangé", async (t) => {
  service();
  const cas = [
    [404, "session_inconnue", /n'existe pas/],
    [403, "session_fermee", /fermée/],
    [403, "session_pleine", /pleine/],
    [409, "pseudo_pris", /déjà pris/],
    [400, "pseudo_invalide", /pas accepté/],
  ];
  for (const [statut, erreur, mot] of cas) {
    faux(t, { "/api/concours/ABCD1234/rejoindre": [statut, { erreur }] });
    session("membre", { "POST rpc/concours_etat": { corps: null } });
    const r = await actions.rejoindreSession({ lien: LIEN, pseudo: "Soleil" });
    assert.equal(r.ok, false);
    assert.match(r.error, mot);
    assert.deepEqual(ecritures().map((x) => x.chemin), ["rpc/concours_etat"], "aucune écriture");
    t.mock.restoreAll();
  }
  faux(t, { "/api/concours/ABCD1234/rejoindre": [200, { jeton: JETON, pseudo: "Soleil" }] });
  const journal = t.mock.method(console, "error", () => {});
  session("membre", { "POST rpc/concours_etat": { corps: null }, "POST rpc/concours_poser": { status: 400, corps: { code: "23514", message: JETON } } });
  const r = await actions.rejoindreSession({ lien: LIEN, pseudo: "Soleil" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Soleil/);
  assert.doesNotMatch(r.error + journal.mock.calls.map((c) => c.arguments.join(" ")).join("\n"), /jeton-secret|23514\b.*jeton/, "ni le jeton ni le message de la base");
});

test("quitterSession : retire le branchement ; dit si des variables CONCOURS_* continuent d'envoyer", async (t) => {
  service();
  variables(t, {});
  session("membre", { "POST rpc/concours_retirer": { corps: true } });
  assert.deepEqual(await actions.quitterSession(), { ok: true, data: { variablesRestantes: false } });
  assert.deepEqual(ecritures().map((x) => x.chemin), ["rpc/concours_retirer"]);
  variables(t, { CONCOURS_URL: URL_SERVICE, CONCOURS_CODE: "ABCD1234", CONCOURS_JETON: JETON });
  session("proprietaire", { "POST rpc/concours_retirer": { corps: true } });
  assert.deepEqual(await actions.quitterSession(), { ok: true, data: { variablesRestantes: true } });
  session("membre", { "POST rpc/concours_retirer": { status: 500, corps: { code: "XX000" } } });
  t.mock.method(console, "error", () => {});
  assert.equal((await actions.quitterSession()).ok, false);
});

test("envoi : le branchement en base d'abord, puis les variables ; l'issue part vers la bonne session, sans rien de la fiche", async (t) => {
  remettreCompteurs();
  variables(t, { CONCOURS_URL: "https://variables.example.org", CONCOURS_CODE: "ENVV1234", CONCOURS_JETON: "jeton-des-variables-123" });
  const requetes = faux(t, { "/api/concours/ABCD1234/evenement": [200, { appels: 1 }], "/api/concours/ENVV1234/evenement": [200, { appels: 1 }] });
  const issue = { "POST rpc/enregistrer_issue": { corps: { leadId: LEAD, statut: "rdv_fixe", rappelLe: null, tentatives: 1, activiteId: "act-1" } } };
  // 1) un branchement en base : il prend le pas sur les variables
  service({ "POST rpc/concours_jeton_serveur": { corps: { url: URL_SERVICE, code: "ABCD1234", jeton: JETON } } });
  session("appelant", issue);
  assert.equal((await enregistrerIssue({ leadId: LEAD, issue: "rdv_fixe", note: "Texte privé", dureeS: 30 })).ok, true);
  await attendre();
  assert.equal(requetes.length, 1);
  assert.equal(requetes[0].url, `${URL_SERVICE}/api/concours/ABCD1234/evenement`);
  assert.deepEqual(requetes[0].corps, { jeton: JETON, issue: "rdv" });
  assert.doesNotMatch(JSON.stringify(requetes), /Texte privé|Atelier|000000001|\+33/);
  // 2) rien en base : l'ancienne méthode (variables) continue de marcher
  requetes.length = 0;
  service({ "POST rpc/concours_jeton_serveur": { corps: null } });
  session("appelant", issue);
  await enregistrerIssue({ leadId: LEAD, issue: "rdv_fixe" });
  await attendre();
  assert.equal(requetes[0].url, "https://variables.example.org/api/concours/ENVV1234/evenement");
  assert.deepEqual(requetes[0].corps, { jeton: "jeton-des-variables-123", issue: "rdv" });
  // 3) base en panne (migration pas jouée, clé service absente) : les variables aussi
  requetes.length = 0;
  service({ "POST rpc/concours_jeton_serveur": { status: 404, corps: { code: "PGRST202" } } });
  session("appelant", issue);
  await enregistrerIssue({ leadId: LEAD, issue: "rdv_fixe" });
  await attendre();
  assert.equal(requetes[0].url, "https://variables.example.org/api/concours/ENVV1234/evenement");
  requetes.length = 0;
  factices.repondreService(() => ({ corps: [] }), { sansCle: true });
  session("appelant", issue);
  assert.equal((await enregistrerIssue({ leadId: LEAD, issue: "rdv_fixe" })).ok, true, "jamais d'exception qui remonte");
  await attendre();
  assert.equal(requetes.length, 1);
  // 4) ni base ni variables : rien ne part
  requetes.length = 0;
  variables(t, {});
  service({ "POST rpc/concours_jeton_serveur": { corps: null } });
  session("appelant", issue);
  assert.equal((await enregistrerIssue({ leadId: LEAD, issue: "rdv_fixe" })).ok, true);
  await attendre();
  assert.deepEqual(requetes, []);
});

test("envoi : l'enregistrement de l'issue réussit même quand le service de la session est en panne", async (t) => {
  remettreCompteurs();
  variables(t, {});
  service({ "POST rpc/concours_jeton_serveur": { corps: { url: URL_SERVICE, code: "ABCD1234", jeton: JETON } } });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error(`réseau coupé ${URL_SERVICE} ${JETON}`);
  });
  session("appelant", { "POST rpc/enregistrer_issue": { corps: { leadId: LEAD, statut: "rdv_fixe", rappelLe: null, tentatives: 1, activiteId: "act-1" } } });
  const r = await enregistrerIssue({ leadId: LEAD, issue: "rdv_fixe" });
  assert.equal(r.ok, true);
  await attendre();
  assert.equal(compteursConcours.echecs, 1);
  assert.doesNotMatch(JSON.stringify(compteursConcours), /jeton|exemple|coupé/);
});

test("signalerDebutAppel : { jeton, debut: true } vers la session branchée, rien sans branchement, aucune donnée reçue", async (t) => {
  variables(t, {});
  const requetes = faux(t, { "/api/concours/ABCD1234/evenement": [400, { erreur: "issue_invalide" }] });
  service({ "POST rpc/concours_jeton_serveur": { corps: { url: URL_SERVICE, code: "ABCD1234", jeton: JETON } } });
  session("appelant");
  assert.deepEqual(await signalerDebutAppel(), { ok: true, data: null }, "un 400 du service ne casse rien");
  await attendre();
  assert.equal(requetes.length, 1);
  assert.deepEqual(requetes[0].corps, { jeton: JETON, debut: true });
  requetes.length = 0;
  service({ "POST rpc/concours_jeton_serveur": { corps: null } });
  session("appelant");
  assert.equal((await signalerDebutAppel()).ok, true);
  await attendre();
  assert.deepEqual(requetes, []);
  session(null);
  assert.deepEqual(await signalerDebutAppel(), { ok: false, error: "Tu dois être connecté." });
});

test("configurationEnvoi : ne lève jamais", async (t) => {
  variables(t, {});
  factices.repondreService(() => ({ corps: [] }), { sansCle: true });
  assert.equal(await configurationEnvoi({}), null);
  service({ "POST rpc/concours_jeton_serveur": { corps: { url: URL_SERVICE, code: "ABCD1234", jeton: JETON } } });
  assert.deepEqual(await configurationEnvoi({}), { url: URL_SERVICE, code: "ABCD1234", jeton: JETON });
});

test("câblage : le bouton d'appel signale le début après l'appel lancé ; le jeton n'est jamais dans un composant ni une réponse", () => {
  const appel = lire("app/(app)/poste/AppelFiche.tsx");
  assert.match(appel, /if \(resultat === "lance" \|\| resultat === "repli_tel"\) void signalerDebutAppel\(\)/);
  const action = lire("app/_actions/issue.ts");
  assert.match(action, /export async function signalerDebutAppel\(\)[\s\S]*?return run\(/);
  const corps = /function signalerDebutAuConcours[\s\S]*?\n}\n/.exec(action)[0];
  assert.match(corps, /after\(tache\)/);
  assert.doesNotMatch(corps, /leadId|note|telephone|entreprise|siren/);
  const encart = lire("app/(app)/reglages/_composants/SessionCommune.tsx");
  assert.doesNotMatch(encart, /jeton/i, "le composant ne connaît pas le jeton");
  assert.doesNotMatch(lire("app/(app)/reglages/page.tsx"), /jeton/i);
  assert.match(lire("app/(app)/reglages/page.tsx"), /lireSessionCommune\(\)/);
  assert.doesNotMatch(lire("lib/concours/branchement.ts"), /console\.|process\.env|fetch\(/);
});
