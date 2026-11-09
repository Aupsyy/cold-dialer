// iClosed (lib/agenda/iclosed.ts) : corps en TABLEAU, secret partagé (?secret= ou en-tête) comparé en temps constant, idempotence (une
// base injectée qui retient les externeId : iClosed renvoie un événement pendant 24 h), heures sans décalage, issues. Tout est inventé.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { creerIclosed, genreDepuisHook, iclosed, issueDepuisResultat, lireEvenementIclosed, lireHeureIclosed, lireIclosed, secretIclosedValide } from "../lib/agenda/iclosed.ts";
import { creerRegistreAgenda } from "../lib/agenda/registre.ts";
import { recevoirWebhookAgenda } from "../lib/agenda/webhook.ts";

const SECRET = randomBytes(20).toString("hex"); // tiré au hasard à chaque passage, jamais une valeur figée
// L'horloge des tests (la minute de réception est la version d'un événement sans horodatage de modification).
const RECU = Date.parse("2026-11-09T10:00:30Z");
const V = Math.floor(RECU / 60_000).toString(36);
const horloge = (t) => t.mock.timers.enable({ apis: ["Date"], now: RECU });
const LEAD = "11111111-2222-4333-8444-555555555555";
const ENV = { ICLOSED_WEBHOOK_SECRET: SECRET, NEXT_PUBLIC_SUPABASE_URL: "https://projet-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-service-inventee" };
const URL_WEBHOOK = "https://app.example.org/api/agenda/iclosed/webhook";

// La forme d'un « Call booked » de la documentation d'iClosed, avec des valeurs inventées (dont les "null" écrits en toutes lettres).
function callBooked(racine = {}, evenement = {}, invite = {}) {
  return {
    event_type: { uuid: "123", kind: "Round Robin", name: "Diagnostic offert", duration: "20", durationUnit: "MINUTES" },
    event: {
      uuid: "45526",
      extended_assigned_to: { 1: { name: "Closer Démo", email: "closer@example.com", primary: "true" } },
      utc_start_time: "2026-11-10T09:00:00+01:00",
      utc_end_time: "2026-11-10T09:20:00+01:00",
      start_time: "2026-11-10T10:00:00+01:00",
      end_time: "2026-11-10T10:20:00+01:00",
      location: "https://visio.example.org/abc-defg-hij",
      canceled: false,
      cancel_reason: null,
      ...evenement,
    },
    invitee: {
      uuid: "00000000-0000-4000-8000-00000000abcd",
      first_name: "null",
      last_name: "null",
      name: "Camille Démo",
      email: "contact.demo01@example.com",
      text_reminder_number: "+33 6 39 98 00 01",
      timezone: "Europe/Paris",
      ...invite,
    },
    questions_and_answers: [{ question: "Phone Number", answer: "+33 6 39 98 00 01" }],
    tracking: { utm_source: "", utm_medium: "", utm_content: LEAD, utm_campaign: "", utmKey_0: "", utmValue_0: "" },
    hookType: "Call booked",
    ...racine,
  };
}

function outcome(racine = {}) {
  return {
    uuid: 123, userId: 456, eventName: "Diagnostic offert", eventId: 789, email: "contact.demo01@example.com", firstName: "Camille", lastName: "Démo",
    phoneNumber: "+33639980001", closerEmail: "closer@example.com", callOutcome: "NO_SALE", noSaleReason: "NO_SHOW", startTime: "2026-11-10T09:00:00Z",
    notes: "Note inventée", hookType: "Outcome added", ...racine,
  };
}

function requete(corps, { secret = SECRET, entete = null, url = URL_WEBHOOK } = {}) {
  const adresse = secret === null ? url : `${url}?secret=${encodeURIComponent(secret)}`;
  const headers = new Headers({ "content-type": "application/json" });
  if (entete !== null) headers.set("x-webhook-secret", entete);
  return new Request(adresse, { method: "POST", headers, body: corps });
}

/** Une base injectée qui imite l'idempotence de integrations_evenements : un externeId déjà vu répond « doublon ». */
function baseIdempotente() {
  const vus = new Set();
  const appels = [];
  return {
    vus,
    appels,
    rpc: async (fonction, args) => {
      appels.push({ fonction, args });
      const cle = `${args.p_evenement.fournisseur}|${args.p_evenement.externeId}`;
      const doublon = vus.has(cle);
      vus.add(cle);
      return { data: { doublon, workspaceId: doublon ? null : "w", rendezVousId: doublon ? null : "r", leadId: null, aVerifier: false }, error: null };
    },
  };
}

function dependances(base = baseIdempotente(), env = ENV) {
  const journal = [];
  return { base, journal, d: { env, base: () => base.rpc, journal: (code, grave) => journal.push({ code, grave: Boolean(grave) }), maintenantS: () => 1_794_000_000 } };
}

function journalPropre(journal) {
  const tout = journal.map((l) => l.code).join("\n");
  for (const interdit of [SECRET, LEAD, "contact.demo01", "Camille", "39 98", "45526", "closer@example.com", "visio.example.org"]) {
    assert.ok(!tout.includes(interdit), `journal : ${interdit}`);
  }
}

test("iClosed : le corps est un tableau ; Call booked → reserve (call, fiche, invité, closer, visio, heure avec décalage)", (t) => {
  horloge(t);
  const evenements = lireIclosed([callBooked()]);
  assert.equal(evenements.length, 1);
  assert.deepEqual(evenements[0], {
    fournisseur: "iclosed",
    type: "reserve",
    externeId: `reserve:45526:${V}`,
    rdvExterneId: "45526",
    debut: "2026-11-10T09:00:00.000Z",
    fin: "2026-11-10T09:20:00.000Z",
    issue: null,
    leadId: LEAD,
    email: "contact.demo01@example.com",
    telephone: "+33 6 39 98 00 01",
    nom: "Camille Démo",
    canal: "visio",
    lienVisio: "https://visio.example.org/abc-defg-hij",
    emailCloser: "closer@example.com",
  });
});

test("iClosed : reporté, annulé, issue ; deux reports = deux clés, le même report renvoyé = la même clé", (t) => {
  horloge(t);
  const report = (debut, ancien) => lireEvenementIclosed(callBooked({ hookType: "Call rescheduled" }, { start_time: debut, old_start_time: ancien }));
  const a = report("2026-11-12T15:00:00+01:00", "2026-11-10T10:00:00+01:00");
  const b = report("2026-11-13T11:00:00+01:00", "2026-11-12T15:00:00+01:00");
  assert.equal(a.type, "deplace");
  assert.equal(a.rdvExterneId, "45526");
  assert.equal(a.debut, "2026-11-12T14:00:00.000Z");
  assert.notEqual(a.externeId, b.externeId);
  assert.equal(report("2026-11-12T15:00:00+01:00", "2026-11-10T10:00:00+01:00").externeId, a.externeId);
  assert.match(a.externeId, /^[A-Za-z0-9_.:-]{1,120}$/);

  const annule = lireEvenementIclosed(callBooked({ hookType: "Call canceled" }, { canceled: true }));
  assert.equal(annule.type, "annule");
  assert.equal(annule.externeId, `annule:45526:${V}`);
  assert.equal(lireEvenementIclosed(callBooked({}, { canceled: true })).type, "annule", "un « booké » déjà annulé est une annulation");

  // L'issue native d'iClosed ne porte pas l'identifiant du call : elle est ignorée (documenté).
  assert.equal(lireEvenementIclosed(outcome()), null);
  // Avec l'identifiant (Zapier, Make : event.uuid ou callId), elle passe.
  const noShow = lireEvenementIclosed(outcome({ callId: "45526" }));
  assert.equal(noShow.type, "issue");
  assert.equal(noShow.issue, "no_show");
  assert.equal(noShow.rdvExterneId, "45526");
  assert.equal(noShow.externeId, `issue:45526:no_show:${V}`);
  assert.equal(lireEvenementIclosed(outcome({ callId: "45526", callOutcome: "SALE", noSaleReason: null })).issue, "tenu");
  assert.equal(lireEvenementIclosed(outcome({ callId: "45526", callOutcome: "RESCHEDULE", noSaleReason: null })), null, "un report n'est pas une issue");
});

test("iClosed : un aller-retour n'est jamais pris pour un doublon (A→B, B→A, puis de nouveau A→B ; annulé puis réservé de nouveau)", async (t) => {
  horloge(t);
  const A = "2026-11-12T15:00:00+01:00";
  const B = "2026-11-13T11:00:00+01:00";
  const report = (debut, ancien) => JSON.stringify([callBooked({ hookType: "Call rescheduled" }, { start_time: debut, old_start_time: ancien })]);
  const x = dependances();
  const envois = [report(B, A), report(A, B), report(B, A)];
  for (const envoi of envois) {
    const r = await recevoirWebhookAgenda("iclosed", requete(envoi), x.d);
    assert.deepEqual(r.corps, { ok: true, recus: 1, traites: 1, doublons: 0, aVerifier: 0, rejetes: 0 });
    t.mock.timers.tick(5 * 60_000);
  }
  assert.deepEqual(x.base.appels.map((a) => a.args.p_evenement.debut), ["2026-11-13T10:00:00.000Z", "2026-11-12T14:00:00.000Z", "2026-11-13T10:00:00.000Z"],
    "le dernier report (retour en B) arrive en base : l'agenda n'affiche pas le mauvais jour");
  // Le même envoi renvoyé dans la minute (iClosed sans réponse à temps) : reconnu.
  const r = await recevoirWebhookAgenda("iclosed", requete(envois[2]), x.d);
  assert.equal(r.corps.traites, 1);
  const encore = await recevoirWebhookAgenda("iclosed", requete(envois[2]), x.d);
  assert.deepEqual(encore.corps, { ok: true, recus: 1, traites: 0, doublons: 1, aVerifier: 0, rejetes: 0 });
  // Annulé, réservé de nouveau, annulé de nouveau : trois clés.
  const cycle = [{ hookType: "Call canceled" }, { hookType: "Call booked" }, { hookType: "Call canceled" }].map((racine) => {
    t.mock.timers.tick(60_000);
    return lireEvenementIclosed(callBooked(racine, { canceled: racine.hookType === "Call canceled" }));
  });
  assert.deepEqual(cycle.map((e) => e.type), ["annule", "reserve", "annule"]);
  assert.equal(new Set(cycle.map((e) => e.externeId)).size, 3);
  // Un horodatage de modification envoyé (Zapier, Make) fait la version, quelle que soit l'heure de réception.
  const modifie = (q) => lireEvenementIclosed(callBooked({ updated_at: "2026-11-09T09:15:00Z" }), "Europe/Paris", q);
  assert.equal(modifie(RECU).externeId, modifie(RECU + 3_600_000).externeId);
  assert.match(modifie(RECU).externeId, /^[A-Za-z0-9_.:-]{1,120}$/);
});

test("iClosed : types et issues", () => {
  const types = {
    "Call booked": "reserve", newCallScheduled: "reserve", "Call rescheduled": "deplace", callRescheduled: "deplace", "Call canceled": "annule",
    callCancelled: "annule", "Outcome added": "issue", callOutcome: "issue", "Contact created": "autre", contactDetailChanged: "autre",
  };
  for (const [hook, attendu] of Object.entries(types)) assert.equal(genreDepuisHook(hook), attendu, hook);
  assert.equal(genreDepuisHook("<script>"), null);
  const issues = [
    ["NO_SHOW", null, "no_show"], ["NO_SALE", "NO_SHOW", "no_show"], ["SALE", null, "tenu"], ["NO_SALE", "NOT_INTERESTED", "tenu"],
    ["PRICE_OBJECTION", null, "tenu"], ["APPROVED", null, "tenu"], ["RESCHEDULE", null, null], ["CANCELLED", null, null], ["BIZARRE", null, null],
  ];
  for (const [o, r, attendu] of issues) assert.equal(issueDepuisResultat(o, r), attendu, `${o}/${r}`);
});

test("iClosed : heures sans décalage = heure du fuseau (de l'événement, sinon de l'équipe), heure d'été comprise", () => {
  const sans = { start_time: "2026-11-18T09:00:00", utc_start_time: "2026-11-18T09:00:00", end_time: "2026-11-18T09:20:00", utc_end_time: undefined };
  const e = lireEvenementIclosed(callBooked({}, sans));
  assert.equal(e.debut, "2026-11-18T08:00:00.000Z", "09:00 à Paris en novembre = 08:00 UTC");
  assert.equal(e.fin, "2026-11-18T08:20:00.000Z");
  assert.equal(lireEvenementIclosed(callBooked({}, { ...sans, start_time: "2026-07-10T09:00:00", utc_start_time: undefined })).debut, "2026-07-10T07:00:00.000Z");
  assert.equal(lireEvenementIclosed(callBooked({}, { ...sans, timezone: "America/Toronto" })).debut, "2026-11-18T14:00:00.000Z", "fuseau de l'événement");
  assert.equal(lireEvenementIclosed(callBooked({}, sans), "America/Toronto").debut, "2026-11-18T14:00:00.000Z", "start_time suit l'événement, pas le fuseau de l'invité");
  const sansFuseau = callBooked({}, sans, { timezone: undefined });
  assert.equal(lireEvenementIclosed(sansFuseau, "America/Toronto").debut, "2026-11-18T14:00:00.000Z", "sans fuseau donné : celui de l'équipe");
  assert.equal(lireEvenementIclosed(callBooked({}, { start_time: undefined, utc_start_time: "2026-11-18T08:00:00Z" })).debut, "2026-11-18T08:00:00.000Z");
  assert.deepEqual(lireHeureIclosed("2026-11-18T09:00:00+01:00", "UTC"), { iso: "2026-11-18T08:00:00.000Z", explicite: true });
  assert.equal(lireHeureIclosed("pas une date", "Europe/Paris"), null);
  // Le registre lit les heures de l'équipe : config.pays.fuseau.
  const registre = creerRegistreAgenda({ fuseau: "America/Toronto" });
  assert.equal(registre.iclosed.webhook.lire([sansFuseau])[0].debut, "2026-11-18T14:00:00.000Z");
});

test("iClosed : formes tolérées, limites, valeurs douteuses", () => {
  assert.equal(lireIclosed(callBooked()).length, 1, "un objet seul (Zapier, Make)");
  assert.equal(lireIclosed({ data: callBooked({ hookType: undefined }) }).length, 1, "sous « data »");
  assert.deepEqual(lireIclosed([]), []);
  assert.deepEqual(lireIclosed(Array.from({ length: 21 }, () => callBooked())), [], "plus de 20 événements : refus");
  assert.deepEqual(lireIclosed("texte"), []);
  assert.deepEqual(lireIclosed([42, null, callBooked({ hookType: "Contact created" })]), []);
  assert.deepEqual(lireIclosed([callBooked({}, { uuid: undefined })]), [], "sans identifiant de call : rien (pas d'idempotence possible)");
  const e = lireEvenementIclosed(
    callBooked({ tracking: { utm_content: "", utmKey_0: "utm_content", utmValue_0: LEAD } }, { location: "https://app.iclosed.io/page" }, { email: "pas-un-email", text_reminder_number: "abc" }),
  );
  assert.equal(e.leadId, LEAD, "paire utmKey / utmValue");
  assert.equal(e.email, null);
  assert.equal(e.lienVisio, null, "une page d'iClosed n'est pas une visio");
  assert.equal(e.telephone, "+33 6 39 98 00 01", "repli : la réponse « Phone Number »");
  assert.equal(lireEvenementIclosed(callBooked({}, { uuid: "x".repeat(150) })).rdvExterneId.length <= 80, true, "identifiant long ramené à une empreinte");
});

test("iClosed : secret bon (adresse ou en-tête), mauvais, absent, trop court", () => {
  const corps = "[]";
  assert.equal(secretIclosedValide(requete(corps), SECRET), true);
  assert.equal(secretIclosedValide(requete(corps, { secret: null, entete: SECRET }), SECRET), true, "en-tête (Zapier, Make)");
  assert.equal(secretIclosedValide(requete(corps, { secret: `${SECRET}x` }), SECRET), false);
  assert.equal(secretIclosedValide(requete(corps, { secret: "mauvais-secret-de-vingt-quatre-car" }), SECRET), false);
  assert.equal(secretIclosedValide(requete(corps, { secret: null }), SECRET), false, "absent");
  assert.equal(secretIclosedValide(requete(corps, { secret: "" }), SECRET), false, "vide");
  assert.equal(secretIclosedValide(requete(corps, { secret: "court" }), "court"), false, "un secret de moins de 24 caractères ne vaut rien");
});

test("iClosed : le webhook (tableau, secret, 401 sans écriture, idempotence par externeId)", async (t) => {
  horloge(t);
  const corps = JSON.stringify([callBooked()]);
  const x = dependances();
  const r1 = await recevoirWebhookAgenda("iclosed", requete(corps), x.d);
  assert.equal(r1.statut, 200);
  assert.deepEqual(r1.corps, { ok: true, recus: 1, traites: 1, doublons: 0, aVerifier: 0, rejetes: 0 });
  // iClosed renvoie le même événement (pas de réponse à temps) : la base le reconnaît.
  const r2 = await recevoirWebhookAgenda("iclosed", requete(corps), x.d);
  assert.equal(r2.statut, 200);
  assert.deepEqual(r2.corps, { ok: true, recus: 1, traites: 0, doublons: 1, aVerifier: 0, rejetes: 0 });
  assert.equal(x.base.appels.length, 2);
  assert.equal(x.base.appels[0].args.p_evenement.externeId, x.base.appels[1].args.p_evenement.externeId);
  assert.deepEqual([...x.base.vus], [`iclosed|reserve:45526:${V}`]);
  // Puis un report et une annulation du même call : de nouvelles clés, traitées.
  const suite = JSON.stringify([
    callBooked({ hookType: "Call rescheduled" }, { start_time: "2026-11-12T15:00:00+01:00", old_start_time: "2026-11-10T10:00:00+01:00" }),
    callBooked({ hookType: "Call canceled" }, { canceled: true }),
  ]);
  const r3 = await recevoirWebhookAgenda("iclosed", requete(suite), x.d);
  assert.deepEqual(r3.corps, { ok: true, recus: 2, traites: 2, doublons: 0, aVerifier: 0, rejetes: 0 });
  assert.deepEqual(x.base.appels.slice(2).map((a) => a.args.p_evenement.type), ["deplace", "annule"]);

  for (const options of [{ secret: "mauvais-secret-de-vingt-quatre-car" }, { secret: null }]) {
    const y = dependances();
    const r = await recevoirWebhookAgenda("iclosed", requete(corps, options), y.d);
    assert.equal(r.statut, 401);
    assert.equal(y.base.appels.length, 0);
    journalPropre(y.journal);
  }
  journalPropre(x.journal);
});

test("iClosed : variable absente → 503 sans rien lire ; secret trop court → 401", async () => {
  const corps = JSON.stringify([callBooked()]);
  const x = dependances(baseIdempotente(), { ...ENV, ICLOSED_WEBHOOK_SECRET: "" });
  const r = await recevoirWebhookAgenda("iclosed", requete(corps), x.d);
  assert.equal(r.statut, 503);
  assert.equal(x.base.appels.length, 0);
  assert.ok(x.journal.some((l) => l.code.includes("ICLOSED_WEBHOOK_SECRET")), "le NOM de la variable est journalisé, jamais une valeur");
  const y = dependances(baseIdempotente(), { ...ENV, ICLOSED_WEBHOOK_SECRET: "court" });
  assert.equal((await recevoirWebhookAgenda("iclosed", requete(corps, { secret: "court" }), y.d)).statut, 401);
});

test("iClosed : le lien de réservation pré-rempli (iclosedName, iclosedEmail, iclosedPhone, utm_content)", () => {
  const lead = { id: LEAD, entreprise: "Atelier Démo 01", dirigeant: " Camille  Démo ", email: "Contact.Demo01@Example.com", telephone: "+33 6 39 98 00 01" };
  const config = { fournisseur: "iclosed", lienReservation: "https://reservation.example.org/equipe/diagnostic", prefill: true, champLead: "utm_content" };
  const lien = new URL(iclosed.lienReservation(lead, config));
  assert.equal(lien.searchParams.get("iclosedName"), "Camille Démo");
  assert.equal(lien.searchParams.get("iclosedEmail"), "contact.demo01@example.com");
  assert.equal(lien.searchParams.get("iclosedPhone"), "+33639980001");
  assert.equal(lien.searchParams.get("utm_content"), LEAD);
  assert.ok(!lien.search.includes("+"), "aucun « + » : les espaces sont en %20 et le « + » du numéro en %2B");
  assert.equal(iclosed.lienReservation(lead, { ...config, prefill: false }), "https://reservation.example.org/equipe/diagnostic");
  assert.equal(creerIclosed("Europe/Paris").lienReservation({ ...lead, telephone: "01 99 00 01 01" }, config).includes("iclosedPhone"), false, "un numéro national n'est pas deviné");
  assert.deepEqual(iclosed.webhook.variables, ["ICLOSED_WEBHOOK_SECRET"]);
});
