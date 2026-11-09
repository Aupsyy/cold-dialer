// L'adaptateur Ringover (lib/telephonie/ringover.ts), EXPÉRIMENTAL : la normalisation sur des corps construits d'après les exemples
// publics de Ringover (resource « call » : ringing, answered, hangup, missed, voicemail ; resource « aftercall » : record_available ;
// numéros en chiffres sans « + », dates en secondes Unix décimales), avec des valeurs inventées ; le secret dans l'URL ; la suite ; le
// téléphone en iframe (handshake checkSDK / presenceSDK, ordre « dial », événements d'appel), avec un filtre strict de l'origine.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { recevoirWebhookTelephonie } from "../lib/telephonie/reception.ts";
import { creerClientRingover, lireRingover, numeroRingover, ringover, suiteRingover } from "../lib/telephonie/ringover.ts";
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
  reponseAudio,
  routesStockage,
} from "./telephonie-faux.mjs";

const SECRET = randomBytes(20).toString("hex"); // tiré au hasard à chaque passage, jamais une valeur figée
const ENV = { ...ENV_BASE, RINGOVER_WEBHOOK_SECRET: SECRET };
const URL_RECORD = "https://cdr.example.org/record/demo-000101.mp3";
const R = { id: "a", workspaceId: WS, leadId: null, appelantId: null, nouveau: true, conserverAudio: true };

const donneesAppel = (x = {}) => ({
  id: "demo-evenement-0001",
  call_id: 4200000001,
  channel_id: 99,
  start_time: 1794214800.762305,
  direction: "outbound",
  from_number: "33199000100",
  to_number: "33199000101",
  user_id: 7,
  is_internal: false,
  is_anonymous: false,
  is_ivr: false,
  ivr_data: null,
  user: { user_id: 7, firstname: "Appelant", lastname: "Démo", email: EMAIL, photo: "" },
  ...x,
});
const evenement = (resource, event, data) => ({ resource, event, timestamp: 1794214900.5, attempt: 1, data });
const HANGUP = evenement("call", "hangup", donneesAppel({ hangup_time: 1794214905.1, duration_in_seconds: 104, record: URL_RECORD }));

const url = (secret = SECRET) => `https://poste.example.org/api/telephonie/ringover/webhook${secret === null ? "" : `?secret=${encodeURIComponent(secret)}`}`;
function recevoir(o, { secret = SECRET, env = ENV, base = fausseBase(), suites = [] } = {}) {
  const req = new Request(url(secret), { method: "POST", body: typeof o === "string" ? o : JSON.stringify(o) });
  return recevoirWebhookTelephonie("ringover", req, {
    env,
    fournisseurActif: "ringover",
    indicatif: "+33",
    base: () => base.rpc,
    journal: () => {},
    planifier: (s) => suites.push(s),
    dependances: () => {
      throw new Error("non utilisé");
    },
  });
}

test("Ringover est marqué expérimental (jamais testé sur un vrai compte)", () => {
  assert.equal(ringover.experimental, true);
  assert.deepEqual([...ringover.originesMicro], ["https://app.ringover.com"]);
});

test("hangup : identifiant d'appel (grand entier) en texte, dates Unix décimales, durée, numéro E.164 du prospect, e-mail, lien de l'audio", () => {
  const [e] = lireRingover(HANGUP);
  assert.deepEqual(e, {
    fournisseur: "ringover",
    externeId: "4200000001",
    direction: "sortant",
    statut: "inconnu",
    debut: "2026-11-09T09:00:00.762Z",
    fin: "2026-11-09T09:01:45.100Z",
    dureeS: 104,
    numeroExterne: NUMERO_FIXE,
    emailAppelant: EMAIL,
    annonceJouee: false,
    urlEnregistrement: URL_RECORD,
  });
});

test("les autres événements d'appel : answered (décroché), missed, voicemail, ringing ; un appel entrant prend le numéro de l'appelant", () => {
  assert.equal(lireRingover(evenement("call", "answered", donneesAppel()))[0].statut, "repondu");
  assert.equal(lireRingover(evenement("call", "missed", donneesAppel({ hangup_time: 1794214830, status: "missed", reason: "OUT_PLANNING" })))[0].statut, "sans_reponse");
  assert.equal(lireRingover(evenement("call", "voicemail", donneesAppel({ answered_time: 1794214810 })))[0].statut, "messagerie");
  assert.equal(lireRingover(evenement("call", "ringing", donneesAppel()))[0].statut, "inconnu");
  const entrant = lireRingover(evenement("call", "ringing", donneesAppel({ direction: "inbound", from_number: "33639980102", to_number: "33199000100" })))[0];
  assert.equal(entrant.direction, "entrant");
  assert.equal(entrant.numeroExterne, NUMERO_MOBILE);
  for (const e of ["answered", "missed", "voicemail", "ringing"]) assert.equal(lireRingover(evenement("call", e, donneesAppel({ record: URL_RECORD })))[0].urlEnregistrement, null, e);
});

test("record_available (aftercall) : seulement l'identifiant et le lien ; les autres événements « aftercall » et les inconnus : rien", () => {
  const [e] = lireRingover(evenement("aftercall", "record_available", { call_id: 4200000001, record_link: URL_RECORD, record_duration: "104" }));
  assert.equal(e.externeId, "4200000001");
  assert.equal(e.urlEnregistrement, URL_RECORD);
  assert.equal(e.debut, null);
  assert.equal(e.statut, "inconnu");
  for (const x of [
    evenement("aftercall", "record_available", { call_id: 1, record_link: "http://cdr.example.org/a.mp3" }),
    evenement("aftercall", "voicemail_available", { call_id: 1, voicemail_link: URL_RECORD }),
    evenement("aftercall", "tags_updated", { call_id: 1, tags: ["a"] }),
    evenement("call", "contact", donneesAppel()),
    evenement("call", "constructor", donneesAppel()),
    evenement("sms", "received", { id: "x", call_id: 1 }),
    evenement("call", "hangup", { ...donneesAppel(), call_id: "a b" }),
    null,
    [],
  ]) {
    assert.deepEqual(lireRingover(x), [], JSON.stringify(x));
  }
});

test("un call_id au-delà de 2^53 reste exact (lu en texte par la route)", async () => {
  const base = fausseBase();
  const brut = JSON.stringify(HANGUP).replace('"call_id":4200000001', '"call_id":1234567890987654400123');
  assert.equal((await recevoir(brut, { base })).statut, 200);
  assert.equal(base.rpcs[0].args.p_evenement.externeId, "1234567890987654400123");
});

test("numéros Ringover : chiffres indicatif compris -> E.164", () => {
  assert.equal(numeroRingover("33199000101"), NUMERO_FIXE);
  assert.equal(numeroRingover(33639980102), NUMERO_MOBILE);
  assert.equal(numeroRingover("+33 1 99 00 01 01"), NUMERO_FIXE);
  assert.equal(numeroRingover("anonymous"), null);
  assert.equal(numeroRingover(""), null);
});

test("verifier : le secret de l'URL (?secret=), en temps constant ; absent, faux, ou secret d'environnement trop court : refus", async () => {
  const v = (secret, env = ENV) => ringover.webhook.verifier(new Request(url(secret), { method: "POST" }), new Uint8Array(), env);
  assert.equal(v(SECRET), true);
  assert.equal(v(`${SECRET}x`), false);
  assert.equal(v(null), false);
  assert.equal(v("court-court-court-court", { ...ENV, RINGOVER_WEBHOOK_SECRET: "court-court-court-court" }), false, "23 caractères");
  const base = fausseBase();
  assert.equal((await recevoir(HANGUP, { base, secret: "mauvais-secret-de-test-0000" })).statut, 401);
  assert.equal((await recevoir(HANGUP, { base, env: { ...ENV, RINGOVER_WEBHOOK_SECRET: "" } })).statut, 503);
  assert.equal((await recevoir(HANGUP, { base, env: { ...ENV, RINGOVER_WEBHOOK_SECRET: "trop-court" } })).statut, 503);
  assert.equal(base.rpcs.length, 0);
  assert.equal((await recevoir(HANGUP, { base })).statut, 200);
  assert.equal(base.rpcs.length, 1);
});

test("la suite : l'audio du lien, seulement si conserverAudio ; un renvoi ne le retélécharge pas ; pas de lien : rien", async () => {
  const base = fausseBase();
  await base.rpc("evenement_appel", { p_evenement: { fournisseur: "ringover", externeId: "4200000001" } });
  const { f, vus } = fauxFetch([["cdr.example.org", () => reponseAudio(24, "audio/mpeg")], ...routesStockage()]);
  const x = dependances({ base, fetchImpl: f, env: ENV });
  const [e] = lireRingover(HANGUP);
  assert.deepEqual(await suiteRingover(e, { ...R, conserverAudio: false }, x.d), ["audio_ignore"]);
  assert.equal(vus.length, 0);
  assert.deepEqual(await suiteRingover(e, R, x.d), ["audio_garde"]);
  assert.deepEqual(await suiteRingover(e, R, x.d), ["audio_deja_la"]);
  assert.deepEqual(x.depots, [{ chemin: `${WS}/ringover/4200000001.mp3`, taille: 24, mime: "audio/mpeg" }]);
  assert.deepEqual(await suiteRingover(lireRingover(evenement("call", "answered", donneesAppel()))[0], R, x.d), ["rien_a_recuperer"]);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Le téléphone en iframe
// ---------------------------------------------------------------------------------------------------------------------------------

function telephone() {
  const nav = fauxNavigateur();
  const el = nav.element();
  const client = creerClientRingover();
  const fermer = client.preparer(el);
  const iframe = el.enfants.find((e) => e.tagName === "IFRAME");
  return { nav, el, client, fermer, iframe, dire: (data, origine = "https://app.ringover.com", source = iframe.contentWindow) => nav.emettre(origine, source, data) };
}

test("l'iframe app.ringover.com, micro délégué à Ringover seulement ; checkSDK -> presenceSDK avec NOTRE origine ; dialerReady : prêt", () => {
  const { client, iframe, dire, fermer, nav } = telephone();
  assert.equal(iframe.src, "https://app.ringover.com");
  assert.equal(iframe.getAttribute("allow"), "microphone https://app.ringover.com; autoplay https://app.ringover.com; clipboard-read https://app.ringover.com; clipboard-write https://app.ringover.com");
  dire({ action: "checkSDK" });
  assert.deepEqual(iframe.messages, [{ message: { action: "presenceSDK", location: "https://poste.example.org" }, origine: "https://app.ringover.com" }]);
  dire({ action: "dialerReady", data: { userId: 7 } }, "https://autre.example.org");
  assert.equal(client.etat(), "attente", "autre origine : ignoré");
  dire({ action: "dialerReady", data: { userId: 7 } }, "https://app.ringover.com", { postMessage() {} });
  assert.equal(client.etat(), "attente", "autre fenêtre : ignoré");
  dire({ action: "dialerReady", data: { userId: 7 } });
  assert.equal(client.etat(), "pret");
  dire({ action: "logout", data: { userId: 7 } });
  assert.equal(client.etat(), "attente");
  fermer();
  assert.equal(nav.nombreEcouteurs("message"), 0);
});

test("appeler : { action: dial, number } vers app.ringover.com ; les événements d'appel vont au Poste ; pas prêt : copie", async () => {
  const { client, iframe, dire, nav, el } = telephone();
  assert.equal(await client.appeler(NUMERO_FIXE, { leadId: "l" }), "copie", "pas encore prêt");
  dire({ action: "login", data: { userId: 7 } });
  assert.equal(await client.appeler(NUMERO_FIXE, { leadId: "lead-demo" }), "lance");
  assert.deepEqual(iframe.messages.at(-1), { message: { action: "dial", number: NUMERO_FIXE }, origine: "https://app.ringover.com" });
  dire({ action: "ringingCall", data: { direction: "out", from_number: "+33199000100", to_number: NUMERO_FIXE, internal: false, call_id: 4200000001, ringDuration: 0, callDuration: 0 } });
  dire({ action: "answeredCall", data: { direction: "out", call_id: 4200000001, ringDuration: 4, callDuration: 0 } });
  dire({ action: "hangupCall", data: { direction: "out", call_id: 4200000001, ringDuration: 4, callDuration: 104 } });
  assert.deepEqual(nav.evenementsDe(el, "telephonie:appel"), [
    { etat: "sonne", direction: "sortant", dureeS: null, externeId: "4200000001", leadId: "lead-demo" },
    { etat: "decroche", direction: "sortant", dureeS: null, externeId: "4200000001", leadId: "lead-demo" },
    { etat: "termine", direction: "sortant", dureeS: 104, externeId: "4200000001", leadId: "lead-demo" },
  ]);
  await assert.rejects(() => client.appeler("0199000101", { leadId: "l" }), /format international/);
});
