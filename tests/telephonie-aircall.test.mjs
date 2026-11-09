// L'adaptateur Aircall (lib/telephonie/aircall.ts), selon le contrat de lib/telephonie/types.ts : lecture des événements call.*
// et transcription.created ; jeton DANS le corps (temps constant) ; refus 401, 503, 413, 400 ; idempotence ; la suite (audio, puis
// transcription par l'API en Basic) seulement si la base dit conserverAudio ; le téléphone en iframe (protocole aircall-everywhere :
// apm_phone_loaded, apm_app_dial_number et sa réponse, événements d'appel), avec un filtre strict de l'origine des messages.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aircall,
  creerClientAircall,
  enteteBasicAircall,
  estSignalTranscription,
  lireAircall,
  lireTranscriptionAircall,
  statutAircall,
  suiteAircall,
  urlEnregistrementAircall,
} from "../lib/telephonie/aircall.ts";
import { recevoirWebhookTelephonie } from "../lib/telephonie/reception.ts";
import {
  EMAIL,
  ENV_BASE,
  NUMERO_FIXE,
  WS,
  dependances,
  fausseBase,
  fauxFetch,
  fauxNavigateur,
  journalPropre,
  reponseAudio,
  reponseJson,
  routesStockage,
} from "./telephonie-faux.mjs";

const JETON = "jeton-aircall-de-test-0123456789";
const ENV = { ...ENV_BASE, AIRCALL_WEBHOOK_TOKEN: JETON };
const ENV_API = { ...ENV, AIRCALL_API_ID: "id-api-de-test", AIRCALL_API_TOKEN: "jeton-api-de-test" };
const URL_MP3 = "https://cdn.example.org/demo/900001.mp3?signature=inventee";
const appel = (x = {}) => ({
  id: 900001,
  direction: "outbound",
  status: "initial",
  started_at: 1794214800,
  answered_at: null,
  ended_at: null,
  duration: null,
  raw_digits: "+33 1 99 00 01 01",
  user: { id: 7, name: "Appelant Démo", email: EMAIL },
  recording: null,
  ...x,
});
const corps = (event, data, token = JETON) => ({ resource: event.split(".")[0], event, timestamp: 1794214801, token, data });
const FIN = appel({ status: "done", answered_at: 1794214810, ended_at: 1794214905, duration: 95, recording: URL_MP3 });
const R = { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: true, conserverAudio: true };

function recevoir(o, { env = ENV, base = fausseBase(), suites = [], journal = [] } = {}) {
  const req = new Request("https://poste.example.org/api/telephonie/aircall/webhook", { method: "POST", body: typeof o === "string" ? o : JSON.stringify(o) });
  return recevoirWebhookTelephonie("aircall", req, {
    env,
    fournisseurActif: "aircall",
    indicatif: "+33",
    base: () => base.rpc,
    journal: (c, g) => journal.push({ code: c, grave: !!g }),
    planifier: (s) => suites.push(s),
    dependances: () => {
      throw new Error("non utilisé");
    },
  });
}

test("lire un call.ended : identifiant en texte, horodatages Unix en ISO, durée, numéro E.164, e-mail, lien de l'enregistrement", () => {
  const [e] = lireAircall(corps("call.ended", FIN));
  assert.deepEqual(e, {
    fournisseur: "aircall",
    externeId: "900001",
    direction: "sortant",
    statut: "repondu",
    debut: "2026-11-09T09:00:00.000Z",
    fin: "2026-11-09T09:01:45.000Z",
    dureeS: 95,
    numeroExterne: NUMERO_FIXE,
    emailAppelant: EMAIL,
    annonceJouee: false,
    urlEnregistrement: URL_MP3,
  });
});

test("statuts : créé (inconnu), décroché, terminé décroché, terminé sans réponse, messagerie", () => {
  assert.equal(statutAircall("call.created", appel()), "inconnu");
  assert.equal(statutAircall("call.answered", appel()), "repondu");
  assert.equal(statutAircall("call.hungup", appel({ answered_at: 1794214810 })), "repondu");
  assert.equal(statutAircall("call.ended", appel({ status: "done" })), "sans_reponse");
  assert.equal(statutAircall("call.ended", appel({ status: "answered" })), "repondu");
  assert.equal(statutAircall("call.ended", appel({ direction: "inbound", voicemail: "https://cdn.example.org/vm.mp3" })), "messagerie");
});

test("lecture tolérante : type non suivi, sans identifiant, corps non objet, lien http refusé ; transcription.created = un signal sans données", () => {
  for (const x of [corps("user.created", { id: 1 }), corps("call.created", {}), [], "x", null, corps("call.created<script>", appel())]) {
    assert.deepEqual(lireAircall(x), [], JSON.stringify(x));
  }
  assert.equal(lireAircall(corps("call.ended", appel({ recording: "http://cdn.example.org/a.mp3" })))[0].urlEnregistrement, null);
  const [t] = lireAircall(corps("transcription.created", { id: 5, call_id: 900001 }));
  assert.equal(t.externeId, "900001");
  assert.ok(estSignalTranscription(t));
  assert.ok(!estSignalTranscription(lireAircall(corps("call.created", appel()))[0]), "un call.* a toujours son début");
  assert.equal(lireAircall(corps("transcription.created", { id: 5, call: { id: 900002 } }))[0].externeId, "900002");
  assert.deepEqual(lireAircall(corps("transcription.created", { id: 5 })), [], "l'id d'une transcription n'est pas celui de l'appel");
});

test("verifier : le jeton du corps, en temps constant ; absent, faux, ou jeton d'environnement trop court : faux", () => {
  const v = (o, env = ENV) => aircall.webhook.verifier(new Request("https://poste.example.org/x", { method: "POST" }), new TextEncoder().encode(JSON.stringify(o)), env);
  assert.equal(v(corps("call.created", appel())), true);
  assert.equal(v(corps("call.created", appel(), `${JETON}x`)), false);
  assert.equal(v({ event: "call.created", data: appel() }), false);
  assert.equal(v(corps("call.created", appel(), "court"), { ...ENV, AIRCALL_WEBHOOK_TOKEN: "court" }), false);
  assert.equal(aircall.webhook.verifier(new Request("https://poste.example.org/x", { method: "POST" }), new TextEncoder().encode("{pas du json"), ENV), false);
});

test("le webhook Aircall : jeton faux 401, jeton absent de l'environnement 503, trop gros 413, pas du JSON 400 ; rien d'écrit", async () => {
  const base = fausseBase();
  assert.equal((await recevoir(corps("call.created", appel(), "mauvais-jeton-de-test-000"), { base })).statut, 401);
  assert.equal((await recevoir({ event: "call.created", data: appel() }, { base })).statut, 401);
  assert.equal((await recevoir(corps("call.created", appel()), { base, env: { ...ENV, AIRCALL_WEBHOOK_TOKEN: "" } })).statut, 503);
  assert.equal((await recevoir(corps("call.created", appel({ note: "x".repeat(300_000) })), { base })).statut, 413);
  assert.equal((await recevoir("{pas du json", { base })).statut, 400);
  assert.equal((await recevoir("[1,2]", { base })).statut, 401, "du JSON sans jeton");
  assert.equal(base.rpcs.length, 0);
});

test("idempotence : les étapes d'un même appel et un renvoi mettent à jour UNE ligne ; un seul audio téléchargé", async () => {
  const base = fausseBase();
  const suites = [];
  for (const [event, data] of [["call.created", appel()], ["call.answered", appel({ answered_at: 1794214810 })], ["call.ended", FIN], ["call.ended", FIN]]) {
    assert.equal((await recevoir(corps(event, data), { base, suites })).statut, 200);
  }
  assert.equal(base.appels.size, 1);
  assert.deepEqual(base.rpcs.map((r) => r.args.p_evenement.statut), ["inconnu", "repondu", "repondu", "repondu"]);
  const { f, vus } = fauxFetch([["cdn.example.org", () => reponseAudio(32, "audio/mpeg")], ...routesStockage()]);
  const x = dependances({ base, fetchImpl: f, env: ENV });
  for (const [event, data] of [["call.created", appel()], ["call.ended", FIN], ["call.ended", FIN]]) {
    await aircall.webhook.apres(lireAircall(corps(event, data))[0], R, x.d);
  }
  assert.equal(vus.filter((v) => v.url.startsWith(URL_MP3)).length, 1);
  assert.deepEqual(x.depots, [{ chemin: `${WS}/aircall/900001.mp3`, taille: 32, mime: "audio/mpeg" }]);
  assert.deepEqual(x.journal.map((l) => l.code), ["aircall:rien_a_recuperer", "aircall:audio_garde", "aircall:audio_deja_la"]);
});

test("la suite ne télécharge rien si la base n'a pas dit conserverAudio ; si la base refuse l'audio déposé, il est effacé", async () => {
  const { f, vus } = fauxFetch([["cdn.example.org", () => reponseAudio(32)], ...routesStockage()]);
  const base = fausseBase();
  await base.rpc("evenement_appel", { p_evenement: { fournisseur: "aircall", externeId: "900001" } });
  const x = dependances({ base, fetchImpl: f, env: ENV_API });
  assert.deepEqual(await suiteAircall(lireAircall(corps("call.ended", FIN))[0], { ...R, conserverAudio: false }, x.d), ["audio_ignore"]);
  assert.equal(vus.length, 0);

  const refus = fausseBase({ refuserAudio: true });
  await refus.rpc("evenement_appel", { p_evenement: { fournisseur: "aircall", externeId: "900001" } });
  const y = dependances({ base: refus, fetchImpl: f, env: ENV });
  assert.deepEqual(await suiteAircall(lireAircall(corps("call.ended", FIN))[0], R, y.d), ["audio_refuse_enregistrement_non_autorise"]);
  assert.equal(y.depots.length, 1);
  const effacement = vus.find((v) => v.methode === "DELETE");
  assert.deepEqual(JSON.parse(effacement.init.body), { prefixes: [`${WS}/aircall/900001.mp3`] });
});

test("transcription.created : la transcription est lue par l'API (Basic) et envoyée à la base ; sans clé d'API, on le dit", async () => {
  const base = fausseBase();
  await base.rpc("evenement_appel", { p_evenement: { fournisseur: "aircall", externeId: "900001" } });
  let entete = null;
  const { f } = fauxFetch([
    [
      "https://api.aircall.io/v1/calls/900001/transcription",
      (_u, init) => {
        entete = init.headers.Authorization;
        return reponseJson({
          transcription: {
            id: 68271,
            call_id: 900001,
            content: {
              language: "fr-FR",
              utterances: [
                { start_time: 2.5, end_time: 3, text: "Oui ?", participant_type: "external" },
                { start_time: 0.5, end_time: 1.5, text: " Bonjour. ", participant_type: "internal" },
                { start_time: 4, end_time: 5, text: "Sans locuteur" },
              ],
            },
          },
        });
      },
    ],
  ]);
  const x = dependances({ base, fetchImpl: f, env: ENV_API });
  const signal = lireAircall(corps("transcription.created", { id: 5, call_id: 900001 }))[0];
  assert.deepEqual(await suiteAircall(signal, R, x.d), ["transcription_gardee"]);
  assert.equal(entete, enteteBasicAircall(ENV_API));
  assert.equal(atob(entete.slice(6)), "id-api-de-test:jeton-api-de-test");
  const t = base.rpcs.find((r) => r.fonction === "transcription_appel").args;
  assert.deepEqual(t.p_lignes, [
    { t: 0.5, locuteur: "appelant", texte: "Bonjour." },
    { t: 2.5, locuteur: "prospect", texte: "Oui ?" },
    { t: 4, locuteur: "inconnu", texte: "Sans locuteur" },
  ]);
  const y = dependances({ base: fausseBase(), fetchImpl: f, env: ENV });
  await y.d.base()("evenement_appel", { p_evenement: { fournisseur: "aircall", externeId: "900001" } });
  assert.deepEqual(await suiteAircall(signal, R, y.d), ["api_non_configuree"]);
  assert.equal(enteteBasicAircall(ENV), null);
  assert.deepEqual(lireTranscriptionAircall(null).lignes, []);
  journalPropre(assert, x.journal, [JETON, "jeton-api-de-test", EMAIL]);
});

test("reprise : l'URL de l'audio par l'API (GET /v1/calls/{id})", async () => {
  const { f } = fauxFetch([["https://api.aircall.io/v1/calls/900001", () => reponseJson({ call: { id: 900001, recording: URL_MP3 } })]]);
  assert.deepEqual(await urlEnregistrementAircall("900001", { env: ENV_API, fetch: f }), { url: URL_MP3 });
  assert.deepEqual(await urlEnregistrementAircall("900002", { env: ENV_API, fetch: f }), { code: "appel_introuvable" });
  assert.deepEqual(await urlEnregistrementAircall("900001", { env: ENV, fetch: f }), { code: "api_non_configuree" });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Le téléphone en iframe
// ---------------------------------------------------------------------------------------------------------------------------------

function telephone() {
  const nav = fauxNavigateur();
  const el = nav.element();
  const client = creerClientAircall({ delaiReponseMs: 30 });
  const fermer = client.preparer(el);
  const iframe = el.enfants.find((e) => e.tagName === "IFRAME");
  return { nav, el, client, fermer, iframe, dire: (data, origine = "https://workspace.aircall.io", source = iframe.contentWindow) => nav.emettre(origine, source, data) };
}

test("preparer monte l'iframe Aircall (micro délégué aux seules origines Aircall) ; « attente » jusqu'à la connexion", () => {
  const { client, iframe, nav, fermer, el } = telephone();
  assert.equal(iframe.src, "https://workspace.aircall.io?integration=generic");
  assert.equal(
    iframe.getAttribute("allow"),
    "microphone https://workspace.aircall.io https://phone.aircall.io; autoplay https://workspace.aircall.io https://phone.aircall.io; clipboard-read https://workspace.aircall.io https://phone.aircall.io; clipboard-write https://workspace.aircall.io https://phone.aircall.io; hid https://workspace.aircall.io https://phone.aircall.io",
  );
  assert.equal(client.etat(), "attente");
  assert.equal(nav.nombreEcouteurs("message"), 1);
  fermer();
  assert.equal(nav.nombreEcouteurs("message"), 0);
  assert.equal(el.enfants.length, 0, "l'iframe est retirée");
});

test("apm_phone_loaded : on répond apm_app_isready, l'état passe à « pret » ; un message d'une autre origine ou d'une autre fenêtre est ignoré", () => {
  const { client, iframe, dire, nav, el } = telephone();
  dire({ name: "apm_phone_loaded", value: { user: { email: EMAIL } } }, "https://autre.example.org");
  dire({ name: "apm_phone_loaded", value: {} }, "https://workspace.aircall.io", { postMessage() {} });
  assert.equal(client.etat(), "attente");
  dire({ name: "apm_phone_loaded", value: {} }, "https://phone.aircall.io");
  assert.equal(client.etat(), "pret");
  assert.deepEqual(iframe.messages, [{ message: { name: "apm_app_isready" }, origine: "https://phone.aircall.io" }]);
  dire({ name: "apm_phone_logout" });
  assert.equal(client.etat(), "attente");
  assert.deepEqual(nav.evenementsDe(el, "telephonie:etat"), ["attente", "pret", "attente"]);
});

test("appeler : apm_app_dial_number avec le numéro E.164, « lance » sur réponse positive ; les événements d'appel vont au Poste", async () => {
  const { client, iframe, dire, nav, el } = telephone();
  dire({ name: "apm_phone_loaded", value: {} });
  const promesse = client.appeler(NUMERO_FIXE, { leadId: "lead-demo" });
  assert.deepEqual(iframe.messages.at(-1), { message: { name: "apm_app_dial_number", value: { phone_number: NUMERO_FIXE } }, origine: "https://workspace.aircall.io" });
  dire({ name: "apm_phone_dial_number_response", value: { success: true, data: {} } });
  assert.equal(await promesse, "lance");
  dire({ name: "apm_phone_outgoing_call", value: { from: "+33199000100", to: NUMERO_FIXE, call_id: 900001 } });
  dire({ name: "apm_phone_outgoing_answered", value: { call_id: 900001 } });
  dire({ name: "apm_phone_call_ended", value: { duration: 95, call_id: 900001 } });
  assert.deepEqual(nav.evenementsDe(el, "telephonie:appel"), [
    { etat: "sonne", direction: "sortant", dureeS: null, externeId: "900001", leadId: "lead-demo" },
    { etat: "decroche", direction: "sortant", dureeS: null, externeId: "900001", leadId: "lead-demo" },
    { etat: "termine", direction: null, dureeS: 95, externeId: "900001", leadId: "lead-demo" },
  ]);
});

test("appeler : un appel déjà en cours est une erreur lisible ; pas de réponse ou téléphone pas prêt : repli « copie »", async () => {
  const a = telephone();
  a.dire({ name: "apm_phone_loaded", value: {} });
  const p = a.client.appeler(NUMERO_FIXE, { leadId: "l" });
  a.dire({ name: "apm_phone_dial_number_response", value: { success: false, errorCode: "in_call", errorMessage: "x" } });
  await assert.rejects(p, /déjà en cours/);
  assert.equal(await a.client.appeler(NUMERO_FIXE, { leadId: "l" }), "copie", "pas de réponse en 30 ms (no_answer)");
  const b = telephone();
  assert.equal(await b.client.appeler(NUMERO_FIXE, { leadId: "l" }), "copie");
  assert.deepEqual(b.nav.copies, [NUMERO_FIXE]);
  await assert.rejects(() => b.client.appeler("0199000101", { leadId: "l" }), /format international/);
  await assert.rejects(() => creerClientAircall().appeler(NUMERO_FIXE, { leadId: "l" }), /pas prêt/, "sans navigateur ni presse-papiers");
});
