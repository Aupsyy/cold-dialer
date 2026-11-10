// La session commune (lib/concours) : inactive sans ses trois variables, https obligatoire, traduction des issues, envoi qui n'attend
// jamais plus que son délai et ne lève jamais, rien de la fiche dans la requête. Le réseau est simulé.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { compteursConcours, envoyerEvenement, lireClassement, lireSession, rejoindre, remettreCompteurs } from "../lib/concours/client.ts";
import { baseApi, codeSessionValide, lireConfigConcours, pagePublique, urlServiceValide } from "../lib/concours/configuration.ts";
import { issueConcours } from "../lib/concours/traduction.ts";
import { exemple, lire } from "./aides.mjs";

const ENV = { CONCOURS_URL: "https://concours.example.org", CONCOURS_CODE: "abcd1234", CONCOURS_JETON: "jeton-de-test-0123456789" };
const CONFIG = lireConfigConcours(ENV);

/** Un faux fetch : garde les appels et répond avec la file de réponses [statut, corps]. */
function faux(reponses) {
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url, init, corps: init.body ? JSON.parse(init.body) : null });
    const [statut, corps] = reponses.shift() ?? [200, {}];
    return { status: statut, json: async () => corps };
  };
  return { f, appels };
}

test("configuration : inactive si l'une des trois variables manque ou est invalide", () => {
  assert.ok(CONFIG);
  assert.equal(CONFIG.code, "ABCD1234", "le code est mis en majuscules");
  for (const nom of Object.keys(ENV)) assert.equal(lireConfigConcours({ ...ENV, [nom]: undefined }), null, `${nom} manquante`);
  assert.equal(lireConfigConcours({}), null);
  assert.equal(lireConfigConcours({ ...ENV, CONCOURS_JETON: "" }), null);
  assert.equal(lireConfigConcours({ ...ENV, CONCOURS_CODE: "ab" }), null);
  assert.equal(lireConfigConcours({ ...ENV, CONCOURS_CODE: "ABCD-1234" }), null);
  assert.equal(lireConfigConcours({ ...ENV, CONCOURS_CODE: "ABCDEFGHIJKLM" }), null);
});

test("configuration : https obligatoire, sauf http://localhost pour les essais", () => {
  assert.equal(urlServiceValide("https://concours.example.org/"), "https://concours.example.org");
  assert.equal(urlServiceValide("http://concours.example.org"), null);
  assert.equal(urlServiceValide("http://localhost:3000"), "http://localhost:3000");
  assert.equal(urlServiceValide("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(urlServiceValide("http://localhost.example.org"), null);
  assert.equal(urlServiceValide("ftp://example.org"), null);
  assert.equal(urlServiceValide("https://u:p@example.org"), null);
  assert.equal(urlServiceValide("https://example.org/?x=1"), null);
  assert.equal(urlServiceValide("pas une adresse"), null);
  assert.equal(urlServiceValide(undefined), null);
  assert.equal(codeSessionValide(" abcd "), "ABCD");
  assert.equal(baseApi(CONFIG), "https://concours.example.org/api/concours/ABCD1234");
  assert.equal(pagePublique(CONFIG), "https://concours.example.org/concours/ABCD1234");
});

test("traduction : le socle a son sens, une issue ajoutée n'est pas comptée sans champ, le champ prime", () => {
  const attendu = {
    pas_repondu: "sans_reponse",
    messagerie: "sans_reponse",
    standard: "sans_reponse",
    a_rappeler: "conversation",
    pas_interesse: "conversation",
    hors_cible: "conversation",
    ne_plus_contacter: "conversation",
    rdv_fixe: "rdv",
  };
  for (const [code, v] of Object.entries(attendu)) assert.equal(issueConcours({ code }), v, code);
  assert.equal(issueConcours({ code: "sous_contrat" }), null, "issue de niche sans champ : ignorée");
  assert.equal(issueConcours({ code: "sous_contrat", concours: "conversation" }), "conversation");
  assert.equal(issueConcours({ code: "rdv_fixe", concours: "ignorer" }), null);
  assert.equal(issueConcours({ code: "x", concours: "n_importe_quoi" }), null);
  assert.equal(issueConcours(null), null);
});

test("config : le champ concours est facultatif, rétro-compatible, et refuse une valeur inconnue", () => {
  const n = exemple();
  const ok = chargerNiche(n);
  assert.equal(ok.issues.find((i) => i.code === "rdv_fixe").concours, "rdv");
  for (const i of n.issues) delete i.concours;
  chargerNiche(n);
  n.issues[0].concours = "gagner";
  assert.throws(() => chargerNiche(n));
  // la config du dépôt et son exemple disent la même chose pour chaque issue du socle
  for (const f of ["config/niche.json", "config/niche.exemple.json"]) {
    for (const i of JSON.parse(lire(f)).issues) {
      const v = issueConcours({ code: i.code });
      if (v) assert.equal(i.concours, v, `${f} : ${i.code}`);
      assert.ok(i.concours, `${f} : ${i.code} sans champ concours`);
    }
  }
});

test("envoi : ne part que { jeton, issue }, vers la bonne adresse, rien de la fiche", async () => {
  remettreCompteurs();
  const { f, appels } = faux([[200, { appels: 1, conversations: 0, rdv: 0 }]]);
  assert.equal(await envoyerEvenement(CONFIG, "rdv", { fetch: f }), "envoye");
  assert.equal(appels.length, 1);
  assert.equal(appels[0].url, "https://concours.example.org/api/concours/ABCD1234/evenement");
  assert.equal(appels[0].init.method, "POST");
  assert.equal(appels[0].init.redirect, "error");
  assert.deepEqual(appels[0].corps, { jeton: ENV.CONCOURS_JETON, issue: "rdv" });
  assert.equal(compteursConcours.envoyes, 1);
  const annule = faux([[200, {}]]);
  await envoyerEvenement(CONFIG, "conversation", { fetch: annule.f, annuler: true });
  assert.deepEqual(annule.appels[0].corps, { jeton: ENV.CONCOURS_JETON, issue: "conversation", annuler: true });
});

test("envoi : n'attend pas plus que le délai et ne lève jamais", async () => {
  remettreCompteurs();
  const suspendu = (_url, init) =>
    new Promise((_, rejeter) => init.signal.addEventListener("abort", () => rejeter(init.signal.reason)));
  const debut = Date.now();
  assert.equal(await envoyerEvenement(CONFIG, "conversation", { fetch: suspendu, delaiMs: 60 }), "echec");
  assert.ok(Date.now() - debut < 1500, "rendu peu après le délai");
  assert.equal(await envoyerEvenement(CONFIG, "conversation", { fetch: async () => { throw new Error("https://concours.example.org boum jeton-de-test"); } }), "echec");
  assert.equal(await envoyerEvenement(CONFIG, "conversation", { fetch: async () => ({ status: 500, json: async () => { throw new Error("pas du json"); } }) }), "echec");
  assert.equal(await envoyerEvenement(CONFIG, "conversation", { fetch: () => { throw new TypeError("synchrone"); } }), "echec");
  assert.equal(compteursConcours.echecs, 4);
  assert.deepEqual(Object.keys(compteursConcours.parCode).sort(), ["delai", "http_500", "reseau"]);
  assert.doesNotMatch(JSON.stringify(compteursConcours), /jeton|example|boum/, "les compteurs ne gardent que des codes");
  // la valeur par défaut du délai est de 3 secondes
  const { DELAI_MS, ATTENTE_TROP_VITE_MS } = await import("../lib/concours/client.ts");
  assert.equal(DELAI_MS, 3000);
  assert.equal(ATTENTE_TROP_VITE_MS, 2000);
});

test("envoi : un 429 trop_vite est retenté une fois après 2 secondes, jamais deux fois", async () => {
  remettreCompteurs();
  const attentes = [];
  const attendre = async (ms) => void attentes.push(ms);
  const un = faux([[429, { erreur: "trop_vite" }], [200, {}]]);
  assert.equal(await envoyerEvenement(CONFIG, "rdv", { fetch: un.f, attendre }), "envoye");
  assert.deepEqual(attentes, [2000]);
  assert.equal(un.appels.length, 2);
  const deux = faux([[429, { erreur: "trop_vite" }], [429, { erreur: "trop_vite" }], [200, {}]]);
  assert.equal(await envoyerEvenement(CONFIG, "rdv", { fetch: deux.f, attendre }), "echec");
  assert.equal(deux.appels.length, 2, "une seule nouvelle tentative");
  const plafond = faux([[429, { erreur: "plafond" }]]);
  assert.equal(await envoyerEvenement(CONFIG, "rdv", { fetch: plafond.f, attendre }), "echec");
  assert.equal(plafond.appels.length, 1, "un plafond n'est pas retenté");
  assert.equal(compteursConcours.parCode.trop_vite, 1);
  assert.equal(compteursConcours.parCode.plafond, 1);
});

test("rejoindre et classement : les erreurs du contrat sont dites, rien ne lève", async () => {
  const bon = faux([[200, { participant: "p1", jeton: "abcdefgh12345678", pseudo: "Soleil" }]]);
  const r = await rejoindre(CONFIG, "Soleil", { fetch: bon.f });
  assert.deepEqual(r, { ok: true, jeton: "abcdefgh12345678", pseudo: "Soleil" });
  assert.deepEqual(bon.appels[0].corps, { pseudo: "Soleil", source: "dialer" });
  for (const [statut, erreur, mot] of [[404, "session_inconnue", /n'existe pas/], [403, "session_fermee", /fermée/], [403, "session_pleine", /pleine/], [409, "pseudo_pris", /déjà pris/], [400, "pseudo_invalide", /pas accepté/]]) {
    const x = await rejoindre(CONFIG, "S", { fetch: faux([[statut, { erreur }]]).f });
    assert.equal(x.ok, false);
    assert.match(x.erreur, mot);
    assert.doesNotMatch(x.erreur, /example/);
  }
  assert.equal((await rejoindre(CONFIG, "S", { fetch: async () => { throw new Error("x"); } })).ok, false);
  const c = await lireSession(CONFIG, { fetch: faux([[200, { session: { titre: "Défi", ouverte: true }, participants: [{ pseudo: "A", appels: 3, conversations: 1, rdv: 0 }, "x"] }]]).f });
  assert.equal(c.titre, "Défi");
  assert.equal(c.participants.length, 1);
  assert.equal(await lireSession(CONFIG, { fetch: faux([[500, {}]]).f }), null);
  assert.equal(lireClassement({ nimporte: 1 }), null);
});

test("accroche : l'envoi suit l'enregistrement réussi de l'issue, après la réponse, sans rien de la fiche", () => {
  const action = lire("app/_actions/issue.ts");
  assert.match(action, /if \(enregistree\.ok\) signalerAuConcours\(saisie\.issue\.code\)/);
  assert.match(action, /after\(tache\)/);
  const corps = /function signalerAuConcours[\s\S]*?\n}\n/.exec(action)[0];
  assert.doesNotMatch(corps, /leadId|note|telephone|entreprise|siren/, "aucune donnée de fiche dans l'envoi");
  const envoi = lire("lib/concours/client.ts");
  assert.doesNotMatch(envoi, /console\./, "aucun journal dans le module");
  assert.doesNotMatch(lire("lib/concours/traduction.ts") + lire("lib/concours/configuration.ts"), /console\.|process\.env/);
});
