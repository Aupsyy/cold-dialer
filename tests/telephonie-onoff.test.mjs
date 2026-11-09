// L'adaptateur Onoff (lib/telephonie/onoff.ts), selon le contrat de lib/telephonie/types.ts : lecture des événements CDR,
// RECORDING et VM ; X-API-KEY en temps constant ; refus 401, 503, 413, 400 ; idempotence ; la suite (audio et transcription) seulement
// si la base dit conserverAudio, effacement de l'audio refusé par la base ; l'extension Chrome (balise surlignée, clic relayé, repli
// copie, téléphone mobile). Tout est inventé (numéros de la plage de fiction, e-mails example.com, identifiants de démonstration).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BALISE_NUMERO_ONOFF,
  creerClientOnoff,
  lireOnoff,
  lireTranscriptionOnoff,
  locuteurOnoff,
  onoff,
  statutOnoff,
  suiteOnoff,
} from "../lib/telephonie/onoff.ts";
import { recevoirWebhookTelephonie } from "../lib/telephonie/reception.ts";
import {
  EMAIL,
  ENV_BASE,
  NUMERO_FIXE,
  NUMERO_MOBILE,
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

const JETON = "jeton-onoff-de-test-0123456789";
const CLE_API = "cle-api-onoff-de-test";
const ENV = { ...ENV_BASE, ONOFF_WEBHOOK_TOKEN: JETON };
const URL_AUDIO = "https://stockage.example.org/audio/demo.mp4?signature=inventee";
const CDR = {
  id: "1730000000000-demo-0001",
  eventName: "CDR",
  onoffUserName: "Appelant Démo",
  onoffUserEmail: "Appelant.Demo@Example.com",
  onoffUserNumber: "+33199000100",
  externalNumber: "+33 1 99 00 01 01",
  externalName: "Atelier Démo 01",
  callStarted: "2026-11-09T09:00:00Z",
  callEnded: "2026-11-09T09:03:05Z",
  callDuration: 185,
  callDirection: "OUTBOUND",
  callStatus: "ANSWERED",
  callNotes: "note inventée",
};
const RECORDING = { ...CDR, eventName: "RECORDING", callRecordingUrl: URL_AUDIO };
const LOGS = {
  id: CDR.id,
  callTranscription: {
    summarization: "Le prospect demande un rappel jeudi.",
    diarization: [
      { speakerLabel: "Customer", speakerIndex: 1, text: "Bonjour.", startTime: "00:00:06" },
      { speakerLabel: "Agent", speakerIndex: 0, text: "  Bonjour,   démonstration. ", startTime: "00:00:02" },
      { speakerLabel: "Agent", speakerIndex: 0, text: "   ", startTime: "00:00:08" },
    ],
    actionItems: [{ action: "Rappeler jeudi", done: false }, { action: "", done: true }],
  },
};
const INTERDITS = [JETON, CLE_API, "0101", EMAIL, "appelant.demo", "Démo", "stockage.example.org", CDR.id];

const corps = (o) => JSON.stringify(o);
const requete = (o, cle = JETON) =>
  new Request("https://poste.example.org/api/telephonie/onoff/webhook", { method: "POST", body: typeof o === "string" ? o : corps(o), headers: cle === null ? {} : { "x-api-key": cle } });

function recevoir(o, { env = ENV, base = fausseBase(), cle = JETON, suites = [], journal = [] } = {}) {
  return recevoirWebhookTelephonie("onoff", requete(o, cle), {
    env,
    fournisseurActif: "onoff",
    indicatif: "+33",
    base: () => base.rpc,
    journal: (c, g) => journal.push({ code: c, grave: !!g }),
    planifier: (s) => suites.push(s),
    dependances: () => {
      throw new Error("non utilisé");
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------

test("lire un CDR : identifiant, statut, direction, dates ISO, durée, numéro E.164, e-mail en minuscules, pas d'audio", () => {
  const [e] = lireOnoff(CDR);
  assert.deepEqual(e, {
    fournisseur: "onoff",
    externeId: CDR.id,
    direction: "sortant",
    statut: "repondu",
    debut: "2026-11-09T09:00:00.000Z",
    fin: "2026-11-09T09:03:05.000Z",
    dureeS: 185,
    numeroExterne: NUMERO_FIXE,
    emailAppelant: "appelant.demo@example.com",
    annonceJouee: false,
    urlEnregistrement: null,
  });
  assert.equal(lireOnoff(CDR).length, 1);
});

test("RECORDING porte l'URL https de l'audio ; VM devient « messagerie » sans audio ; un lien http est refusé", () => {
  assert.equal(lireOnoff(RECORDING)[0].urlEnregistrement, URL_AUDIO);
  const vm = lireOnoff({ ...CDR, eventName: "VM", callStatus: "VMS", voicemailUrl: URL_AUDIO, callRecordingUrl: URL_AUDIO })[0];
  assert.equal(vm.statut, "messagerie");
  assert.equal(vm.urlEnregistrement, null);
  assert.equal(lireOnoff({ ...RECORDING, callRecordingUrl: "http://stockage.example.org/a.mp4" })[0].urlEnregistrement, null);
  assert.equal(lireOnoff({ ...RECORDING, callRecordingUrl: "javascript:alert(1)" })[0].urlEnregistrement, null);
});

test("lecture tolérante : entrant, champs absents, durée hors bornes, numéro national gardé pour l'indicatif, identifiant numérique", () => {
  const [e] = lireOnoff({ eventName: "cdr", id: 12345, callDirection: "INBOUND", callDuration: -3, externalNumber: "01 99 00 01 01", callStarted: "hier" });
  assert.equal(e.externeId, "12345");
  assert.equal(e.direction, "entrant");
  assert.equal(e.dureeS, null);
  assert.equal(e.debut, null);
  assert.equal(e.statut, "inconnu");
  assert.equal(e.numeroExterne, "0199000101", "la route le lit avec config.pays.indicatif");
  assert.equal(e.emailAppelant, null);
  for (const x of [null, [], "x", {}, { eventName: "SMS", id: "1" }, { eventName: "CDR" }, { eventName: "CDR", id: "a b" }]) assert.deepEqual(lireOnoff(x), [], JSON.stringify(x));
});

test("statuts Onoff (webhook et API)", () => {
  assert.deepEqual(
    ["ANSWERED", "ANSWER", "MISSED_CALL", "BUSY", "VMS", "WRONG_NUMBER", "UNKNOWN_SUBSCRIBER", "UNKNOWN", undefined, " answered "].map(statutOnoff),
    ["repondu", "repondu", "sans_reponse", "occupe", "messagerie", "faux_numero", "faux_numero", "inconnu", "inconnu", "repondu"],
  );
});

test("verifier : X-API-KEY égal au jeton (espaces tolérés), sinon faux ; un jeton de moins de 16 caractères ne vaut rien", () => {
  const v = (cle, env = ENV) => onoff.webhook.verifier(requete(CDR, cle), new Uint8Array(), env);
  assert.equal(v(JETON), true);
  assert.equal(v(` ${JETON} `), true);
  assert.equal(v(`${JETON}x`), false);
  assert.equal(v(JETON.slice(0, -1)), false);
  assert.equal(v(null), false);
  assert.equal(v(""), false);
  assert.equal(v("court", { ...ENV, ONOFF_WEBHOOK_TOKEN: "court" }), false);
});

test("le webhook Onoff : jeton faux 401, jeton absent de l'environnement 503, trop gros 413, pas du JSON 400 ; rien d'écrit", async () => {
  const base = fausseBase();
  assert.equal((await recevoir(CDR, { base, cle: "mauvais-jeton-de-test-000" })).statut, 401);
  assert.equal((await recevoir(CDR, { base, cle: null })).statut, 401);
  assert.equal((await recevoir(CDR, { base, env: { ...ENV, ONOFF_WEBHOOK_TOKEN: "" } })).statut, 503);
  assert.equal((await recevoir({ ...CDR, callNotes: "x".repeat(300_000) }, { base })).statut, 413);
  assert.equal((await recevoir("{pas du json", { base })).statut, 400);
  assert.equal(base.rpcs.length, 0);
});

test("idempotence : le même corps reçu deux fois (Onoff réessaie) = une seule ligne, un seul audio déposé", async () => {
  const base = fausseBase();
  const suites = [];
  const journal = [];
  for (let i = 0; i < 2; i++) {
    const r = await recevoir(RECORDING, { base, suites, journal });
    assert.equal(r.statut, 200);
  }
  assert.deepEqual(base.fonctions(), ["evenement_appel", "evenement_appel"]);
  assert.equal(base.appels.size, 1, "une seule ligne d'appel");
  assert.match(journal[0].code, /:nouveau:/);
  assert.match(journal[1].code, /:connu:/);
  const { f, vus } = fauxFetch([["stockage.example.org", () => reponseAudio(16, "video/mp4")], ...routesStockage()]);
  const x = dependances({ base, fetchImpl: f, env: ENV });
  const [e] = lireOnoff(RECORDING);
  for (let i = 0; i < 2; i++) await onoff.webhook.apres(e, { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: i === 0, conserverAudio: true }, x.d);
  assert.equal(x.depots.length, 1, "un seul dépôt");
  assert.equal(vus.filter((v) => v.url.includes("stockage.example.org")).length, 1, "un seul téléchargement");
  assert.equal(x.depots[0].chemin, `${WS}/onoff/${CDR.id}.mp4`);
  assert.equal(x.depots[0].mime, "audio/mp4");
  assert.match(x.journal.at(-1).code, /^onoff:audio_deja_la/);
});

test("la suite ne télécharge RIEN si la base n'a pas dit conserverAudio (ni audio, ni API, ni transcription)", async () => {
  const base = fausseBase({ conserver: false });
  await base.rpc("evenement_appel", { p_evenement: { fournisseur: "onoff", externeId: CDR.id } });
  const { f, vus } = fauxFetch([["", () => reponseAudio()]]);
  const x = dependances({ base, fetchImpl: f, env: { ...ENV, ONOFF_API_KEY: CLE_API } });
  const codes = await suiteOnoff(lireOnoff(RECORDING)[0], { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: true, conserverAudio: false }, x.d);
  assert.deepEqual(codes, ["audio_ignore"]);
  assert.equal(vus.length, 0);
  assert.equal(x.depots.length, 0);
});

test("la base refuse l'audio déjà déposé : le fichier est EFFACÉ du bucket (clé service, chemin exact)", async () => {
  const base = fausseBase({ refuserAudio: true });
  await base.rpc("evenement_appel", { p_evenement: { fournisseur: "onoff", externeId: CDR.id } });
  const { f, vus } = fauxFetch([["stockage.example.org", () => reponseAudio(16, "audio/mpeg")], ...routesStockage()]);
  const x = dependances({ base, fetchImpl: f, env: ENV });
  const codes = await suiteOnoff(lireOnoff(RECORDING)[0], { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: true, conserverAudio: true }, x.d);
  assert.deepEqual(codes, ["audio_refuse_enregistrement_non_autorise"]);
  assert.equal(x.depots.length, 1, "déposé d'abord");
  const effacement = vus.find((v) => v.methode === "DELETE");
  assert.ok(effacement, "puis effacé");
  assert.equal(effacement.url, "https://projet-test.supabase.co/storage/v1/object/enregistrements");
  assert.deepEqual(JSON.parse(effacement.init.body), { prefixes: [`${WS}/onoff/${CDR.id}.mp3`] });
  assert.equal(effacement.init.headers.Authorization, "Bearer cle-service-de-test");
  assert.deepEqual(
    base.fonctions().filter((n) => n !== "evenement_appel"),
    ["etat_recuperation_appel", "enregistrement_appel"],
  );
});

test("un dépôt qui échoue : pas d'enregistrement_appel ; un téléchargement trop gros ou en erreur : rien n'est déposé", async () => {
  for (const [reponse, code, depotOk] of [
    [() => reponseAudio(16), "depot_stockage_403", false],
    [() => reponseAudio(16, "audio/mpeg", { "content-length": String(30 * 1024 * 1024) }), "audio_trop_gros", true],
    [() => new Response("", { status: 403 }), "telechargement_403", true],
  ]) {
    const base = fausseBase();
    await base.rpc("evenement_appel", { p_evenement: { fournisseur: "onoff", externeId: CDR.id } });
    const { f } = fauxFetch([["stockage.example.org", reponse], ...routesStockage()]);
    const x = dependances({ base, fetchImpl: f, env: ENV, depotOk });
    const codes = await suiteOnoff(lireOnoff(RECORDING)[0], { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: true, conserverAudio: true }, x.d);
    assert.deepEqual(codes, [code]);
    assert.ok(!base.fonctions().includes("enregistrement_appel"));
  }
});

test("un CDR sans lien, avec la clé d'API : l'URL est demandée à l'API, puis la transcription (relue une fois si elle n'est pas prête)", async () => {
  const base = fausseBase();
  await base.rpc("evenement_appel", { p_evenement: { fournisseur: "onoff", externeId: CDR.id } });
  let lectures = 0;
  const { f, vus } = fauxFetch([
    ["/recording", () => reponseJson({ url: URL_AUDIO })],
    ["stockage.example.org", () => reponseAudio(16, "video/mp4")],
    ["/logs", () => (++lectures === 1 ? reponseJson({ id: CDR.id, callTranscription: null }) : reponseJson(LOGS))],
    ...routesStockage(),
  ]);
  const x = dependances({ base, fetchImpl: f, env: { ...ENV, ONOFF_API_KEY: CLE_API } });
  const codes = await suiteOnoff(lireOnoff(CDR)[0], { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: true, conserverAudio: true }, x.d);
  assert.deepEqual(codes, ["audio_garde", "transcription_gardee"]);
  assert.equal(lectures, 2);
  assert.deepEqual(x.attentes, [15_000], "une seule attente bornée");
  const api = vus.filter((v) => v.url.startsWith("https://public-apigateway.onoffapp.net/api/v1/calls/"));
  assert.equal(api.length, 3);
  assert.ok(api.every((v) => v.init.headers["X-API-Key"] === CLE_API));
  const t = base.rpcs.find((r) => r.fonction === "transcription_appel").args;
  assert.deepEqual(t.p_lignes, [
    { t: 2, locuteur: "appelant", texte: "Bonjour, démonstration." },
    { t: 6, locuteur: "prospect", texte: "Bonjour." },
  ]);
  assert.equal(t.p_resume, "Le prospect demande un rappel jeudi.\nÀ faire : Rappeler jeudi");
  assert.equal(t.p_workspace_id, WS);
  journalPropre(assert, x.journal, INTERDITS);
});

test("sans clé d'API, un CDR sans lien attend l'événement RECORDING ; un appel manqué ou une messagerie : rien à récupérer", async () => {
  const base = fausseBase();
  await base.rpc("evenement_appel", { p_evenement: { fournisseur: "onoff", externeId: CDR.id } });
  const { f, vus } = fauxFetch([]);
  const x = dependances({ base, fetchImpl: f, env: ENV });
  const r = { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: true, conserverAudio: true };
  assert.deepEqual(await suiteOnoff(lireOnoff(CDR)[0], r, x.d), ["audio_en_attente"]);
  assert.deepEqual(await suiteOnoff(lireOnoff({ ...CDR, callStatus: "MISSED_CALL" })[0], r, x.d), ["sans_audio_attendu"]);
  assert.deepEqual(await suiteOnoff(lireOnoff({ ...CDR, eventName: "VM", callStatus: "VMS" })[0], r, x.d), ["sans_audio_attendu"]);
  assert.equal(vus.length, 0);
});

test("transcription Onoff : lignes triées en secondes, locuteurs (étiquette, sinon index), résumé et actions", () => {
  const t = lireTranscriptionOnoff(LOGS);
  assert.deepEqual(t.lignes.map((l) => [l.t, l.locuteur]), [[2, "appelant"], [6, "prospect"]]);
  assert.equal(lireTranscriptionOnoff({ callTranscription: null }).resume, null);
  assert.deepEqual(lireTranscriptionOnoff({ callTranscription: null }).lignes, []);
  assert.equal(locuteurOnoff("Customer", 0), "prospect");
  assert.equal(locuteurOnoff("Agent", 1), "appelant");
  assert.equal(locuteurOnoff("Speaker", 1), "prospect");
  assert.equal(locuteurOnoff("Speaker", 0), "appelant");
  assert.equal(locuteurOnoff(null, undefined), "inconnu");
});

// ---------------------------------------------------------------------------------------------------------------------------------
// L'extension Chrome
// ---------------------------------------------------------------------------------------------------------------------------------

test("preparer affiche les numéros de data-numero ; l'extension les surligne : « attente » puis « pret » (événement telephonie:etat)", async () => {
  const nav = fauxNavigateur();
  const el = nav.element({ "data-numero": `${NUMERO_FIXE} ${NUMERO_MOBILE} pas-un-numero` });
  const client = creerClientOnoff({ delaiSurlignageMs: 40, delaiAbsenceMs: 500 });
  const fermer = client.preparer(el);
  const spans = el.querySelectorAll("[data-telephonie-numero]");
  assert.deepEqual(spans.map((s) => s.textContent), ["+33 1 99 00 01 01", "+33 6 39 98 01 02"]);
  assert.equal(client.etat(), "attente");
  nav.surlignerOnoff(el);
  await nav.attendre(5);
  assert.equal(client.etat(), "pret");
  assert.deepEqual(nav.evenementsDe(el, "telephonie:etat").at(-1), "pret");
  fermer();
  assert.equal(el.querySelectorAll("[data-telephonie-numero]").length, 0, "le démontage retire ce que l'adaptateur a ajouté");
});

test("appeler relaie un clic qui ne remonte pas vers la balise du BON numéro, et copie le numéro en secours", async () => {
  const nav = fauxNavigateur();
  const el = nav.element({ "data-numero": `${NUMERO_FIXE} ${NUMERO_MOBILE}` });
  const client = creerClientOnoff({ delaiSurlignageMs: 40 });
  client.preparer(el);
  nav.surlignerOnoff(el);
  assert.equal(await client.appeler(NUMERO_MOBILE, { leadId: "l1" }), "lance");
  const [fixe, mobile] = el.querySelectorAll(BALISE_NUMERO_ONOFF);
  assert.equal(fixe.evenements.length, 0);
  assert.equal(mobile.evenements.length, 1);
  assert.deepEqual([mobile.evenements[0].type, mobile.evenements[0].bubbles], ["click", false]);
  await nav.attendre(1);
  assert.deepEqual(nav.copies, [NUMERO_MOBILE]);
});

test("la fiche vient de s'ouvrir : appeler attend la balise (600 ms au plus) ; sans extension, repli « copie »", async () => {
  const nav = fauxNavigateur();
  const el = nav.element({ "data-numero": NUMERO_FIXE });
  const client = creerClientOnoff({ delaiSurlignageMs: 200 });
  client.preparer(el);
  setTimeout(() => nav.surlignerOnoff(el), 60);
  assert.equal(await client.appeler(NUMERO_FIXE, { leadId: "l1" }), "lance");

  const nav2 = fauxNavigateur();
  const el2 = nav2.element({ "data-numero": NUMERO_FIXE });
  const sans = creerClientOnoff({ delaiSurlignageMs: 30, delaiAbsenceMs: 20 });
  sans.preparer(el2);
  assert.equal(await sans.appeler(NUMERO_FIXE, { leadId: "l1" }), "copie");
  assert.deepEqual(nav2.copies, [NUMERO_FIXE]);
  await nav2.attendre(30);
  assert.equal(sans.etat(), "indisponible", "sans balise au bout du délai");
});

test("un clic direct sur le numéro surligné (l'extension l'a reçu) n'est pas relayé une seconde fois", async () => {
  const nav = fauxNavigateur();
  const el = nav.element({ "data-numero": NUMERO_FIXE });
  const client = creerClientOnoff({ delaiSurlignageMs: 20 });
  client.preparer(el);
  nav.surlignerOnoff(el);
  const balise = el.querySelector(BALISE_NUMERO_ONOFF);
  const capture = el.ecouteurs.find((x) => x.type === "click" && x.capture);
  capture.f({ isTrusted: true, target: balise });
  assert.equal(await client.appeler(NUMERO_FIXE, { leadId: "l1" }), "lance");
  assert.equal(balise.evenements.length, 0);
});

test("sur un téléphone : « indisponible » et copie seulement (un lien tel: partirait sur la carte SIM) ; numéro illisible : erreur", async () => {
  const nav = fauxNavigateur({ mobile: true });
  const el = nav.element({ "data-numero": NUMERO_FIXE });
  const client = creerClientOnoff();
  client.preparer(el);
  assert.equal(client.etat(), "indisponible");
  assert.equal(el.querySelectorAll("[data-telephonie-numero]").length, 0);
  assert.equal(await client.appeler(NUMERO_FIXE, { leadId: "l1" }), "copie");
  await assert.rejects(() => client.appeler("01 99 00 01 01", { leadId: "l1" }), /format international/);
  const sansPresse = fauxNavigateur({ mobile: true, pressePapiers: false });
  const c2 = creerClientOnoff();
  c2.preparer(sansPresse.element());
  await assert.rejects(() => c2.appeler(NUMERO_FIXE, { leadId: "l1" }), /compose-le dans Onoff/);
});

test("un nouveau numéro (data-numero change) est réaffiché ; un ancien démontage ne défait pas un nouveau montage", async () => {
  const nav = fauxNavigateur();
  const el = nav.element({ "data-numero": NUMERO_FIXE });
  const client = creerClientOnoff({ delaiSurlignageMs: 20 });
  const premier = client.preparer(el);
  const second = client.preparer(el);
  premier();
  assert.equal(el.querySelectorAll("[data-telephonie-numero]").length, 1, "le second montage est intact");
  el.setAttribute("data-numero", NUMERO_MOBILE);
  await nav.attendre(1);
  assert.deepEqual(el.querySelectorAll("[data-telephonie-numero]").map((s) => s.getAttribute("data-telephonie-numero")), [NUMERO_MOBILE]);
  second();
});
