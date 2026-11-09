// Calendly (lib/agenda/calendly.ts) : signature HMAC-SHA256 de « t.<corps> » à 3 minutes près, normalisation des événements
// (réservé, annulé, reporté, no-show), webhook complet (lib/agenda/webhook.ts) avec une base injectée. Tout est inventé.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { ENTETE_CALENDLY, calendly, lireCalendly, lireSignatureCalendly, lieuCalendly, signatureCalendlyValide } from "../lib/agenda/calendly.ts";
import { recevoirWebhookAgenda } from "../lib/agenda/webhook.ts";

const CLE = "cle-de-signature-calendly-inventee-pour-les-tests";
const MAINTENANT_S = 1_794_000_000;
const LEAD = "11111111-2222-4333-8444-555555555555";
const ENV = { CALENDLY_WEBHOOK_SIGNING_KEY: CLE, NEXT_PUBLIC_SUPABASE_URL: "https://projet-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-service-inventee" };
const URL_WEBHOOK = "https://app.example.org/api/agenda/calendly/webhook";

function envoi(evenement, payload = {}) {
  return {
    event: evenement,
    created_at: "2026-11-09T08:00:00.000000Z",
    created_by: "https://api.example.com/users/HOTE-DEMO",
    payload: {
      uri: "https://api.example.com/scheduled_events/EVT-DEMO-01/invitees/INV-DEMO-01",
      email: "Contact.Demo01@Example.com",
      name: "Camille Démo",
      first_name: null,
      last_name: null,
      status: "active",
      timezone: "Europe/Paris",
      event: "https://api.example.com/scheduled_events/EVT-DEMO-01",
      text_reminder_number: "+33 6 39 98 00 01",
      rescheduled: false,
      old_invitee: null,
      new_invitee: null,
      no_show: null,
      questions_and_answers: [{ question: "Votre activité ?", answer: "Paysage" }],
      tracking: { utm_campaign: null, utm_source: null, utm_medium: null, utm_content: LEAD, utm_term: null, salesforce_uuid: null },
      scheduled_event: {
        uri: "https://api.example.com/scheduled_events/EVT-DEMO-01",
        name: "Diagnostic offert",
        status: "active",
        start_time: "2026-11-10T09:00:00.000000Z",
        end_time: "2026-11-10T09:20:00.000000Z",
        location: { type: "google_conference", status: "pushed", join_url: "https://visio.example.org/abc-defg-hij" },
        event_memberships: [{ user: "https://api.example.com/users/HOTE-DEMO", user_email: "closer@example.com", user_name: "Closer Démo" }],
      },
      ...payload,
    },
  };
}

function signer(corps, t = MAINTENANT_S, cle = CLE) {
  return `t=${t},v1=${createHmac("sha256", cle).update(`${t}.${corps}`).digest("hex")}`;
}

function requete(corps, entete, url = URL_WEBHOOK) {
  const headers = new Headers({ "content-type": "application/json" });
  if (entete !== null) headers.set(ENTETE_CALENDLY, entete);
  return new Request(url, { method: "POST", headers, body: corps });
}

function dependances(reponse = (args) => ({ data: { doublon: false, workspaceId: "w", rendezVousId: "r", leadId: args.p_evenement.leadId, aVerifier: !args.p_evenement.leadId }, error: null })) {
  const appels = [];
  const journal = [];
  return {
    appels,
    journal,
    d: {
      env: ENV,
      base: () => async (fonction, args) => {
        appels.push({ fonction, args });
        return reponse(args);
      },
      journal: (code, grave) => journal.push({ code, grave: Boolean(grave) }),
      maintenantS: () => MAINTENANT_S,
    },
  };
}

function journalPropre(journal) {
  const tout = journal.map((l) => l.code).join("\n");
  for (const interdit of [CLE, LEAD, "Contact.Demo01", "contact.demo01", "Camille", "39 98", "EVT-DEMO", "INV-DEMO", "closer@example.com", "visio.example.org"]) {
    assert.ok(!tout.includes(interdit), `journal : ${interdit}`);
  }
}

const octets = (s) => new TextEncoder().encode(s);

test("Calendly : l'en-tête de signature (t et un ou plusieurs v1)", () => {
  assert.deepEqual(lireSignatureCalendly(`t=12,v1=${"a".repeat(64)}`), { t: 12, v1: ["a".repeat(64)] });
  assert.deepEqual(lireSignatureCalendly(`t=12, v1=${"A".repeat(64)}, v1=${"b".repeat(64)}`).v1, ["a".repeat(64), "b".repeat(64)]);
  for (const mauvais of [null, "", "t=12", `v1=${"a".repeat(64)}`, `t=abc,v1=${"a".repeat(64)}`, `t=12,v1=court`, "x".repeat(2001)]) {
    assert.equal(lireSignatureCalendly(mauvais), null, String(mauvais).slice(0, 20));
  }
});

test("Calendly : signature valide acceptée, signature fausse ou d'une autre clé refusée", async () => {
  const corps = JSON.stringify(envoi("invitee.created"));
  assert.equal(await signatureCalendlyValide(octets(corps), signer(corps), CLE, MAINTENANT_S), true);
  assert.equal(await signatureCalendlyValide(octets(corps), signer(corps, MAINTENANT_S, "autre-cle"), CLE, MAINTENANT_S), false);
  assert.equal(await signatureCalendlyValide(octets(`${corps} `), signer(corps), CLE, MAINTENANT_S), false, "un octet de plus");
  assert.equal(await signatureCalendlyValide(octets(corps), null, CLE, MAINTENANT_S), false);
  assert.equal(await signatureCalendlyValide(octets(corps), signer(corps), "", MAINTENANT_S), false, "sans clé, rien ne passe");
  const courte = "cle-courte-de-31-caracteres-xyz";
  assert.equal(courte.length, 31);
  assert.equal(await signatureCalendlyValide(octets(corps), signer(corps, MAINTENANT_S, courte), courte, MAINTENANT_S), false,
    "une clé de moins de 32 caractères est refusée, même avec une signature juste (elle se casserait hors ligne)");
  // Plusieurs v1 (changement de clé) : une seule bonne suffit.
  const double = `${signer(corps, MAINTENANT_S, "ancienne-cle")},v1=${signer(corps).split("v1=")[1]}`;
  assert.equal(await signatureCalendlyValide(octets(corps), double, CLE, MAINTENANT_S), true);
});

test("Calendly : horodatage hors tolérance (3 minutes) refusé, dans les deux sens", async () => {
  const corps = JSON.stringify(envoi("invitee.created"));
  assert.equal(await signatureCalendlyValide(octets(corps), signer(corps, MAINTENANT_S - 180), CLE, MAINTENANT_S), true, "pile 3 minutes");
  assert.equal(await signatureCalendlyValide(octets(corps), signer(corps, MAINTENANT_S - 181), CLE, MAINTENANT_S), false, "trop vieux");
  assert.equal(await signatureCalendlyValide(octets(corps), signer(corps, MAINTENANT_S + 181), CLE, MAINTENANT_S), false, "venu du futur");
});

test("Calendly : invitee.created → reserve (événement, fiche par utm_content, invité, closer, visio)", () => {
  const [e] = lireCalendly(envoi("invitee.created"));
  assert.deepEqual(e, {
    fournisseur: "calendly",
    type: "reserve",
    externeId: "invitee.created:INV-DEMO-01",
    rdvExterneId: "EVT-DEMO-01",
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
  assert.match(e.externeId, /^[A-Za-z0-9_.:-]{1,120}$/);
  assert.match(e.rdvExterneId, /^[A-Za-z0-9_.:-]{1,120}$/);
});

test("Calendly : invitee.canceled → annule ; report (old_invitee) → deplace sur le nouvel événement ; no-show → issue", () => {
  const [annule] = lireCalendly(envoi("invitee.canceled", { status: "canceled", rescheduled: true, new_invitee: "https://api.example.com/scheduled_events/EVT-DEMO-02/invitees/INV-DEMO-02" }));
  assert.equal(annule.type, "annule");
  assert.equal(annule.rdvExterneId, "EVT-DEMO-01");
  assert.equal(annule.externeId, "invitee.canceled:INV-DEMO-01");

  const [deplace] = lireCalendly(
    envoi("invitee.created", {
      uri: "https://api.example.com/scheduled_events/EVT-DEMO-02/invitees/INV-DEMO-02",
      old_invitee: "https://api.example.com/scheduled_events/EVT-DEMO-01/invitees/INV-DEMO-01",
      scheduled_event: { ...envoi("x").payload.scheduled_event, uri: "https://api.example.com/scheduled_events/EVT-DEMO-02", start_time: "2026-11-12T14:00:00Z", end_time: "2026-11-12T14:20:00Z" },
    }),
  );
  assert.equal(deplace.type, "deplace");
  assert.equal(deplace.rdvExterneId, "EVT-DEMO-02");
  assert.equal(deplace.debut, "2026-11-12T14:00:00.000Z");
  assert.notEqual(deplace.externeId, annule.externeId);

  const [noShow] = lireCalendly(envoi("invitee_no_show.created", { no_show: { uri: "https://api.example.com/invitee_no_shows/NS-DEMO-01", created_at: "2026-11-10T09:30:00Z" } }));
  assert.equal(noShow.type, "issue");
  assert.equal(noShow.issue, "no_show");
  assert.equal(noShow.rdvExterneId, "EVT-DEMO-01");
  assert.equal(noShow.externeId, "invitee_no_show.created:NS-DEMO-01");
  // La forme courte (la marque de no-show seule) est lue aussi.
  const [court] = lireCalendly({ event: "invitee_no_show.created", payload: { uri: "https://api.example.com/invitee_no_shows/NS-DEMO-02", invitee: "https://api.example.com/scheduled_events/EVT-DEMO-03/invitees/INV-DEMO-03" } });
  assert.equal(court.rdvExterneId, "EVT-DEMO-03");
  assert.equal(court.externeId, "invitee_no_show.created:NS-DEMO-02");
});

test("Calendly : événements ignorés, valeurs douteuses écartées, lieux", () => {
  for (const autre of ["routing_form_submission.created", "invitee_no_show.deleted", "event_type.created", "contact.created", undefined]) {
    assert.deepEqual(lireCalendly(envoi(autre)), [], String(autre));
  }
  assert.deepEqual(lireCalendly("texte"), []);
  assert.deepEqual(lireCalendly({ event: "invitee.created", payload: {} }), [], "sans identifiant d'événement ni d'invité");
  const [e] = lireCalendly(envoi("invitee.created", { email: "pas-un-email", tracking: { utm_content: "pas-un-uuid" }, text_reminder_number: null, questions_and_answers: [{ question: "Téléphone", answer: "01 99 00 01 01" }] }));
  assert.equal(e.email, null);
  assert.equal(e.leadId, null);
  assert.equal(e.telephone, "01 99 00 01 01", "repli : la réponse « téléphone » du formulaire");
  assert.deepEqual(lieuCalendly({ type: "outbound_call", location: "+33 1 99 00 01 02" }), { canal: "telephone", lienVisio: null, telephone: "+33 1 99 00 01 02" });
  assert.deepEqual(lieuCalendly({ type: "physical", location: "Atelier" }), { canal: "sur_place", lienVisio: null, telephone: null });
  assert.deepEqual(lieuCalendly({ type: "zoom", join_url: "http://pas-https.example.org/x" }), { canal: "visio", lienVisio: null, telephone: null });
  assert.deepEqual(lieuCalendly({ type: "custom", location: "https://visio.example.org/salle" }), { canal: "visio", lienVisio: "https://visio.example.org/salle", telephone: null });
  assert.deepEqual(lieuCalendly(null), { canal: null, lienVisio: null, telephone: null });
});

test("Calendly : le webhook complet (200, base appelée une fois par événement, journal sans donnée)", async () => {
  const corps = JSON.stringify(envoi("invitee.created"));
  const x = dependances();
  const r = await recevoirWebhookAgenda("calendly", requete(corps, signer(corps)), x.d);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { ok: true, recus: 1, traites: 1, doublons: 0, aVerifier: 0, rejetes: 0 });
  assert.equal(x.appels.length, 1);
  assert.equal(x.appels[0].fonction, "evenement_agenda");
  assert.deepEqual(Object.keys(x.appels[0].args), ["p_evenement"]);
  assert.equal(x.appels[0].args.p_evenement.rdvExterneId, "EVT-DEMO-01");
  journalPropre(x.journal);
});

test("Calendly : signature fausse → 401, horodatage périmé → 401, sans en-tête → 401 ; rien en base", async () => {
  const corps = JSON.stringify(envoi("invitee.created"));
  for (const entete of [signer(corps, MAINTENANT_S, "mauvaise-cle"), signer(corps, MAINTENANT_S - 600), null, "n'importe quoi"]) {
    const x = dependances();
    const r = await recevoirWebhookAgenda("calendly", requete(corps, entete), x.d);
    assert.equal(r.statut, 401, String(entete).slice(0, 12));
    assert.deepEqual(r.corps, { ok: false, code: "signature_refusee" });
    assert.equal(x.appels.length, 0);
    journalPropre(x.journal);
  }
});

test("Calendly : l'adaptateur porte le webhook (variable par son NOM) et lit l'horloge en secondes", async () => {
  assert.deepEqual(calendly.webhook.variables, ["CALENDLY_WEBHOOK_SIGNING_KEY"]);
  const corps = JSON.stringify(envoi("invitee.created"));
  const req = requete(corps, signer(corps));
  assert.equal(await calendly.webhook.verifier(req, octets(corps), ENV, MAINTENANT_S), true);
  assert.equal(await calendly.webhook.verifier(req, octets(corps), {}, MAINTENANT_S), false, "variable absente : refus");
});
