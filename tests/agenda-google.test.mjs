// Google Agenda (lib/agenda/google.ts, lib/agenda/synchro-google.ts) : fetch injecté (aucun réseau), rafraîchissement du jeton d'accès,
// lecture d'événements fictifs, normalisation, secret de cron requis, refresh token refusé (mode « Testing » : 7 jours). Tout est inventé.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  URL_JETON_GOOGLE,
  calendrierGoogle,
  clientGoogle,
  cronAutorise,
  google,
  leadDepuisDescription,
  normaliserEvenementGoogle,
  telephoneDepuisDescription,
} from "../lib/agenda/google.ts";
import { recevoirSyncGoogle } from "../lib/agenda/synchro-google.ts";

const CRON = "secret-de-cron-invente-0123456789";
const LEAD = "11111111-2222-4333-8444-555555555555";
const MAINTENANT = Date.parse("2026-11-09T06:00:00Z");
const ENV = {
  GOOGLE_CLIENT_ID: "client-invente.apps.example.com",
  GOOGLE_CLIENT_SECRET: "secret-client-invente",
  GOOGLE_REFRESH_TOKEN: "jeton-de-rafraichissement-invente",
  CRON_SECRET: CRON,
  NEXT_PUBLIC_SUPABASE_URL: "https://projet-test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "cle-service-inventee",
};

function evenement(extra = {}) {
  return {
    id: "evtdemo01",
    status: "confirmed",
    created: "2026-11-05T10:00:00.000Z",
    updated: "2026-11-05T10:00:10.000Z",
    summary: "Diagnostic offert",
    description: `Rendez-vous pris depuis la page.\nTéléphone : 06 39 98 00 01\nutm_content=${LEAD}`,
    start: { dateTime: "2026-11-10T10:00:00+01:00", timeZone: "Europe/Paris" },
    end: { dateTime: "2026-11-10T10:20:00+01:00", timeZone: "Europe/Paris" },
    hangoutLink: "https://visio.example.org/abc-defg-hij",
    organizer: { email: "closer@example.org", self: true },
    attendees: [
      { email: "closer@example.org", self: true, organizer: true, responseStatus: "accepted" },
      { email: "Contact.Demo01@Example.com", displayName: "Camille Démo", responseStatus: "needsAction" },
    ],
    eventType: "default",
    ...extra,
  };
}

/** Un faux Google : le point de jeton puis l'API Calendar. Retient chaque appel (sans jamais rien envoyer). */
function fauxGoogle({ jeton = () => ({ statut: 200, json: { access_token: "jeton-acces-invente", expires_in: 3599, token_type: "Bearer" } }), pages = [{ items: [evenement()] }], evenements = null } = {}) {
  const appels = [];
  let page = 0;
  const f = async (url, init = {}) => {
    const u = String(url);
    appels.push({ url: u, methode: init.method ?? "GET", entetes: new Headers(init.headers ?? {}), corps: init.body ?? null });
    if (u === URL_JETON_GOOGLE) {
      const r = jeton(appels.filter((a) => a.url === URL_JETON_GOOGLE).length);
      return new Response(JSON.stringify(r.json), { status: r.statut, headers: { "content-type": "application/json" } });
    }
    if (evenements) {
      const r = evenements(appels.filter((a) => a.url !== URL_JETON_GOOGLE).length, init);
      return new Response(JSON.stringify(r.json), { status: r.statut, headers: { "content-type": "application/json" } });
    }
    const corps = pages[Math.min(page, pages.length - 1)];
    page++;
    return new Response(JSON.stringify(corps), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { f, appels };
}

function baseInjectee() {
  const vus = new Set();
  const appels = [];
  return {
    appels,
    rpc: async (fonction, args) => {
      appels.push({ fonction, args });
      const doublon = vus.has(args.p_evenement.externeId);
      vus.add(args.p_evenement.externeId);
      return { data: { doublon, workspaceId: "w", rendezVousId: "r", leadId: null, aVerifier: !args.p_evenement.leadId }, error: null };
    },
  };
}

function dependances({ env = ENV, faux = fauxGoogle(), base = baseInjectee(), fournisseurActif = "google", emailsEquipe, dejaTraites } = {}) {
  const journal = [];
  return {
    faux,
    base,
    journal,
    d: {
      env,
      fetch: faux.f,
      base: () => base.rpc,
      journal: (code, grave) => journal.push({ code, grave: Boolean(grave) }),
      maintenant: () => MAINTENANT,
      fournisseurActif,
      emailsEquipe,
      dejaTraites,
    },
  };
}

const requete = (entete = `Bearer ${CRON}`) => new Request("https://app.example.org/api/agenda/google/sync", { headers: entete ? { authorization: entete } : {} });

function journalPropre(journal) {
  const tout = journal.map((l) => l.code).join("\n");
  for (const interdit of [CRON, "jeton-acces-invente", "jeton-de-rafraichissement-invente", "secret-client-invente", LEAD, "contact.demo01", "Camille", "evtdemo01"]) {
    assert.ok(!tout.includes(interdit), `journal : ${interdit}`);
  }
}

test("Google : le secret de cron est requis (Bearer, temps constant, 16 caractères au moins)", () => {
  assert.equal(cronAutorise(`Bearer ${CRON}`, ENV), true);
  assert.equal(cronAutorise(`bearer   ${CRON}`, ENV), true);
  for (const entete of [null, "", CRON, `Bearer ${CRON}x`, "Bearer mauvais-secret-de-cron-xx", `Basic ${CRON}`]) assert.equal(cronAutorise(entete, ENV), false, String(entete));
  assert.equal(cronAutorise("Bearer court", { CRON_SECRET: "court" }), false, "un secret trop court ne vaut rien");
  assert.equal(cronAutorise("Bearer x", {}), false);
});

test("Google : la route refuse sans secret de cron (503 sans config, 401 sinon) et ne touche ni Google ni la base", async () => {
  const sansSecret = dependances({ env: { ...ENV, CRON_SECRET: "" } });
  assert.equal((await recevoirSyncGoogle(requete(), sansSecret.d)).statut, 503);
  for (const entete of [null, "Bearer mauvais-secret-de-cron-xx", CRON]) {
    const x = dependances();
    const r = await recevoirSyncGoogle(requete(entete), x.d);
    assert.equal(r.statut, 401, String(entete));
    assert.equal(x.faux.appels.length, 0);
    assert.equal(x.base.appels.length, 0);
    journalPropre(x.journal);
  }
});

test("Google : agenda configuré ailleurs → 200 inactif ; variable Google manquante → 503 (rien n'est appelé)", async () => {
  const autre = dependances({ fournisseurActif: "calendly" });
  assert.deepEqual((await recevoirSyncGoogle(requete(), autre.d)).corps, { ok: true, actif: false });
  assert.equal(autre.faux.appels.length, 0);
  const manque = dependances({ env: { ...ENV, GOOGLE_REFRESH_TOKEN: " " } });
  const r = await recevoirSyncGoogle(requete(), manque.d);
  assert.equal(r.statut, 503);
  assert.equal(manque.faux.appels.length, 0);
  assert.ok(manque.journal.some((l) => l.code.includes("GOOGLE_REFRESH_TOKEN")), "le NOM de la variable seulement");
  journalPropre(manque.journal);
});

test("Google : rafraîchissement du jeton, lecture de l'agenda (fenêtre à venir, instances dépliées, supprimés compris), envoi à la base", async () => {
  const x = dependances();
  const r = await recevoirSyncGoogle(requete(), x.d);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { ok: true, actif: true, lus: 1, candidats: 1, traites: 1, doublons: 0, aVerifier: 0, rejetes: 0, reportes: 0 });

  const [jeton, liste] = x.faux.appels;
  assert.equal(jeton.url, URL_JETON_GOOGLE);
  assert.equal(jeton.methode, "POST");
  const corps = new URLSearchParams(jeton.corps);
  assert.equal(corps.get("grant_type"), "refresh_token");
  assert.equal(corps.get("refresh_token"), ENV.GOOGLE_REFRESH_TOKEN);
  assert.equal(corps.get("client_id"), ENV.GOOGLE_CLIENT_ID);

  const u = new URL(liste.url);
  assert.equal(u.origin + u.pathname, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
  assert.equal(liste.entetes.get("authorization"), "Bearer jeton-acces-invente");
  assert.equal(u.searchParams.get("singleEvents"), "true");
  assert.equal(u.searchParams.get("showDeleted"), "true");
  assert.equal(u.searchParams.get("timeMin"), "2026-11-09T06:00:00.000Z");
  assert.equal(u.searchParams.get("timeMax"), "2027-01-08T06:00:00.000Z");

  assert.equal(x.base.appels.length, 1);
  assert.equal(x.base.appels[0].fonction, "evenement_agenda");
  assert.deepEqual(x.base.appels[0].args.p_evenement, normaliserEvenementGoogle(evenement()));
  journalPropre(x.journal);

  // Deuxième passage, rien n'a changé : doublon (la base ne refait rien).
  const r2 = await recevoirSyncGoogle(requete(), { ...x.d, fetch: fauxGoogle().f });
  assert.equal(r2.corps.doublons, 1);
  assert.equal(r2.corps.traites, 0);
});

test("Google : normalisation (fiche par utm_content, invité, téléphone annoncé, visio, hôte, idempotence)", () => {
  const e = normaliserEvenementGoogle(evenement());
  assert.equal(e.fournisseur, "google");
  assert.equal(e.type, "reserve");
  assert.equal(e.rdvExterneId, "evtdemo01");
  assert.equal(e.externeId, `evtdemo01:${Date.parse("2026-11-05T10:00:10.000Z").toString(36)}`, "la clé porte la version (updated) de l'événement");
  assert.equal(e.debut, "2026-11-10T09:00:00.000Z");
  assert.equal(e.fin, "2026-11-10T09:20:00.000Z");
  assert.equal(e.leadId, LEAD);
  assert.equal(e.email, "contact.demo01@example.com");
  assert.equal(e.nom, "Camille Démo");
  assert.equal(e.telephone, "06 39 98 00 01");
  assert.equal(e.canal, "visio");
  assert.equal(e.lienVisio, "https://visio.example.org/abc-defg-hij");
  assert.equal(e.emailCloser, "closer@example.org");
  assert.equal(e.issue, null);

  // La même version relue à chaque synchro : la même clé (traitée une fois). Toute modification : une nouvelle version, une nouvelle clé
  // (une modification sans effet, comme la réponse de l'invité, est reconnue par la base : « rdv_inchange », rien n'est écrit).
  assert.equal(normaliserEvenementGoogle(evenement()).externeId, e.externeId);
  const deplace = normaliserEvenementGoogle(evenement({ start: { dateTime: "2026-11-11T10:00:00+01:00" }, end: { dateTime: "2026-11-11T10:20:00+01:00" }, updated: "2026-11-06T10:00:00Z" }));
  assert.notEqual(deplace.externeId, e.externeId);
  assert.equal(deplace.type, "deplace");
  assert.equal(deplace.rdvExterneId, e.rdvExterneId);

  const annule = normaliserEvenementGoogle({ id: "evtdemo01", status: "cancelled", updated: "2026-11-07T10:00:00Z" });
  assert.equal(annule.type, "annule");
  assert.equal(annule.externeId, `annule:evtdemo01:${Date.parse("2026-11-07T10:00:00Z").toString(36)}`);
  assert.equal(annule.rdvExterneId, "evtdemo01");
  // Sans version (champ absent) : la clé d'avant, par le contenu.
  assert.equal(normaliserEvenementGoogle({ id: "evtdemo01", status: "cancelled" }).externeId, "annule:evtdemo01");
  assert.match(normaliserEvenementGoogle(evenement({ updated: undefined })).externeId, /^evtdemo01:[0-9a-f]{14}$/);
});

test("Google : un aller-retour n'est jamais ignoré (A, puis B, puis de nouveau A ; annulé, restauré, ré-annulé)", () => {
  const A = { start: { dateTime: "2026-11-20T09:00:00+01:00" }, end: { dateTime: "2026-11-20T09:20:00+01:00" } };
  const B = { start: { dateTime: "2026-11-21T09:00:00+01:00" }, end: { dateTime: "2026-11-21T09:20:00+01:00" } };
  const versions = [
    evenement({ ...A, updated: "2026-11-05T10:00:10.000Z" }),
    evenement({ ...B, updated: "2026-11-06T08:00:00.000Z" }),
    evenement({ ...A, updated: "2026-11-06T09:00:00.000Z" }),
  ].map((v) => normaliserEvenementGoogle(v));
  assert.equal(new Set(versions.map((v) => v.externeId)).size, 3, "trois versions, trois clés : la troisième (retour en A) est traitée");
  assert.equal(versions[2].debut, "2026-11-20T08:00:00.000Z");
  const cycle = [
    normaliserEvenementGoogle({ id: "evtdemo01", status: "cancelled", updated: "2026-11-07T10:00:00Z" }),
    normaliserEvenementGoogle(evenement({ ...A, updated: "2026-11-07T11:00:00Z" })),
    normaliserEvenementGoogle({ id: "evtdemo01", status: "cancelled", updated: "2026-11-07T12:00:00Z" }),
  ];
  assert.deepEqual(cycle.map((c) => c.type), ["annule", "deplace", "annule"]);
  assert.equal(new Set(cycle.map((c) => c.externeId)).size, 3, "la ré-annulation a sa propre clé : elle n'est pas prise pour un doublon");
});

test("Google : ce qui n'est pas un rendez-vous de prospection est ignoré", () => {
  assert.equal(normaliserEvenementGoogle(evenement({ start: { date: "2026-11-10" }, end: { date: "2026-11-11" } })), null, "journée entière");
  assert.equal(normaliserEvenementGoogle(evenement({ eventType: "outOfOffice" })), null, "absence");
  assert.equal(normaliserEvenementGoogle(evenement({ description: "", attendees: [] })), null, "ni fiche ni invité");
  const interne = evenement({ description: "", attendees: [{ email: "closer@example.org", self: true }, { email: "collegue@example.org" }] });
  assert.equal(normaliserEvenementGoogle(interne), null, "un collègue du même domaine : réunion interne");
  const equipe = evenement({ description: "", attendees: [{ email: "closer@example.org", self: true }, { email: "associe@messagerie.example" }] });
  assert.notEqual(normaliserEvenementGoogle(equipe), null);
  assert.equal(normaliserEvenementGoogle(equipe, { emailsEquipe: new Set(["associe@messagerie.example"]) }), null, "un compte de l'équipe n'est pas un prospect");
  const messagerie = evenement({ description: "", organizer: { email: "closer@messagerie.example", self: true }, attendees: [{ email: "closer@messagerie.example", self: true }, { email: "prospect.demo@messagerie.example" }] });
  assert.equal(
    normaliserEvenementGoogle(messagerie, { domainesPublics: new Set(["messagerie.example"]) }).email,
    "prospect.demo@messagerie.example",
    "même messagerie grand public : pas un collègue",
  );
  assert.equal(normaliserEvenementGoogle({ id: "a/b", status: "confirmed" }), null, "identifiant illisible");
  assert.equal(normaliserEvenementGoogle("texte"), null);
  const long = normaliserEvenementGoogle(evenement({ id: "x".repeat(300) }));
  assert.ok(long.rdvExterneId.length <= 90 && long.externeId.length <= 120, "identifiant long ramené à une empreinte");
});

test("Google : description (fiche, téléphone annoncé) et agenda cible", () => {
  assert.equal(leadDepuisDescription(`Fiche : https://app.example.org/prospects/${LEAD}`), LEAD);
  assert.equal(leadDepuisDescription("rien"), null);
  assert.equal(telephoneDepuisDescription("Tél. : +33 1 99 00 01 01"), "+33 1 99 00 01 01");
  assert.equal(telephoneDepuisDescription("Référence 0199000101"), null, "un nombre seul n'est pas un numéro");
  assert.equal(calendrierGoogle({ GOOGLE_CALENDAR_ID: "equipe-rdv@group.calendar.example.com" }), "equipe-rdv@group.calendar.example.com");
  assert.equal(calendrierGoogle({ GOOGLE_CALENDAR_ID: "a/b" }), "primary");
  assert.equal(calendrierGoogle({}), "primary");
  assert.equal(google.webhook, undefined, "Google n'a pas de webhook : /api/agenda/google/webhook répond 404");
  assert.equal(google.lienReservation({ id: LEAD, entreprise: "Atelier Démo 01", dirigeant: null, email: null, telephone: null }, { fournisseur: "google", prefill: true, champLead: "utm_content" }), null);
  assert.equal(
    google.lienReservation({ id: LEAD, entreprise: "Atelier Démo 01", dirigeant: null, email: null, telephone: null }, { fournisseur: "google", lienReservation: "https://reservation.example.org/rdv", prefill: true, champLead: "utm_content" }),
    "https://reservation.example.org/rdv",
    "une page de réservation Google ne se pré-remplit pas : le lien tel quel",
  );
});

test("Google : refresh token refusé (mode « Testing », 7 jours) → 502 google_jeton_refuse ; 401 de l'API → un seul rafraîchissement", async () => {
  const refuse = dependances({ faux: fauxGoogle({ jeton: () => ({ statut: 400, json: { error: "invalid_grant" } }) }) });
  const r = await recevoirSyncGoogle(requete(), refuse.d);
  assert.equal(r.statut, 502);
  assert.equal(r.corps.code, "google_jeton_refuse");
  assert.equal(refuse.base.appels.length, 0);
  assert.ok(refuse.journal.some((l) => l.code === "agenda:google:jeton_refuse"));
  journalPropre(refuse.journal);

  // Le premier jeton est refusé par l'API (401) : un nouveau jeton, une seule nouvelle tentative.
  const faux = fauxGoogle({ evenements: (n) => (n === 1 ? { statut: 401, json: { error: { code: 401 } } } : { statut: 200, json: { items: [evenement()] } }) });
  const client = clientGoogle(ENV, { fetch: faux.f });
  const lu = await client.lister("2026-11-09T06:00:00.000Z", "2026-12-09T06:00:00.000Z");
  assert.equal(lu.ok, true);
  assert.equal(faux.appels.filter((a) => a.url === URL_JETON_GOOGLE).length, 2);

  const toujours401 = fauxGoogle({ evenements: () => ({ statut: 401, json: {} }) });
  assert.deepEqual(await clientGoogle(ENV, { fetch: toujours401.f }).lister("a", "b"), { ok: false, raison: "non_autorise" });
  const quota = fauxGoogle({ evenements: () => ({ statut: 403, json: { error: { errors: [{ reason: "rateLimitExceeded" }] } } }) });
  assert.deepEqual(await clientGoogle(ENV, { fetch: quota.f }).lister("a", "b"), { ok: false, raison: "quota" });
  const panne = async () => {
    throw new Error("réseau coupé");
  };
  assert.deepEqual(await clientGoogle(ENV, { fetch: panne }).lister("a", "b"), { ok: false, raison: "reseau" });
  assert.equal(clientGoogle({ ...ENV, GOOGLE_CLIENT_SECRET: "" }, { fetch: panne }), null, "sans variable : pas de client");
});

test("Google : plusieurs pages, les comptes de l'équipe écartés, une base en panne → 500", async () => {
  const pages = [
    { items: [evenement()], nextPageToken: "page-2" },
    { items: [evenement({ id: "evtdemo02", description: "", attendees: [{ email: "closer@example.org", self: true }, { email: "associe@messagerie.example" }] }), { id: "evtdemo03", status: "cancelled" }] },
  ];
  const x = dependances({ faux: fauxGoogle({ pages }), emailsEquipe: async () => new Set(["associe@messagerie.example"]) });
  const r = await recevoirSyncGoogle(requete(), x.d);
  assert.equal(r.corps.lus, 3);
  assert.equal(r.corps.candidats, 2, "le rendez-vous avec un associé est écarté ; l'annulation est envoyée");
  assert.equal(new URL(x.faux.appels.at(-1).url).searchParams.get("pageToken"), "page-2");

  const panne = { appels: [], rpc: async () => ({ data: null, error: { code: "08006" } }) };
  const y = dependances({ base: panne });
  const r2 = await recevoirSyncGoogle(requete(), y.d);
  assert.equal(r2.statut, 500);
  assert.equal(r2.corps.ok, false);
  journalPropre(y.journal);
});

test("Google : un événement déjà traité (journal des intégrations) ne retourne pas en base ; journal illisible → tout est envoyé", async () => {
  const deja = normaliserEvenementGoogle(evenement()).externeId;
  const pages = [{ items: [evenement(), evenement({ id: "evtdemo02", start: { dateTime: "2026-11-12T10:00:00+01:00" }, end: { dateTime: "2026-11-12T10:20:00+01:00" } })] }];
  const x = dependances({ faux: fauxGoogle({ pages }), dejaTraites: async () => new Set([deja]) });
  const r = await recevoirSyncGoogle(requete(), x.d);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.candidats, 2);
  assert.equal(r.corps.doublons, 1, "compté comme doublon, sans appel à la base");
  assert.equal(r.corps.traites, 1);
  assert.deepEqual(x.base.appels.map((a) => a.args.p_evenement.rdvExterneId), ["evtdemo02"]);

  const y = dependances({ faux: fauxGoogle({ pages }), dejaTraites: async () => { throw new Error("x"); } });
  const r2 = await recevoirSyncGoogle(requete(), y.d);
  assert.equal(r2.statut, 200);
  assert.equal(y.base.appels.length, 2, "repli : la base reconnaît elle-même les doublons");
  assert.ok(y.journal.some((l) => l.code === "agenda:google:journal_illisible"));
});
