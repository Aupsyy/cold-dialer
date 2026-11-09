// L'adaptateur iClosed : le lien de réservation pré-rempli, et le webhook.
//
// Ce qu'iClosed envoie (documentation des webhooks iClosed, v1) : un POST JSON dont le corps est un TABLEAU d'événements, chacun avec
// « hookType » : « Call booked », « Call rescheduled », « Call canceled », « Outcome added » (et « Contact created », « Contact updated »,
// ignorés). Un call : event.uuid, event.start_time / utc_start_time / end_time, event.location, event.extended_assigned_to (le closer, avec
// son e-mail), event.timezone, invitee.name / email / text_reminder_number / timezone, questions_and_answers, tracking.utm_*.
// Une issue (Outcome added) : callOutcome, noSaleReason, email, phoneNumber, startTime, closerEmail… mais PAS l'identifiant du call.
//
// Authentification : la documentation dit « signé avec une clé secrète » sans donner ni en-tête ni algorithme, et l'écran d'iClosed ne
// prend qu'une adresse. Le webhook est donc protégé par un SECRET PARTAGÉ (ICLOSED_WEBHOOK_SECRET, 24 caractères au moins) placé dans
// l'adresse (« ?secret=… ») ; l'en-tête « X-Webhook-Secret » est accepté aussi (Zapier, Make, n8n). Comparaison en temps constant.
//
// iClosed renvoie un événement pendant 24 heures tant qu'il n'a pas reçu de réponse 2xx : la base (integrations_evenements) ne traite
// qu'une fois un même externeId. Sa dernière partie est la VERSION de l'événement (versionIclosed) : son horodatage de modification s'il
// est envoyé, sinon la minute de réception (l'envoi natif n'en porte pas). Un renvoi immédiat est donc reconnu, et un vrai aller-retour
// (A, B, puis de nouveau A ; annulé puis réservé de nouveau) n'est jamais pris pour un doublon ; un renvoi tardif est rejoué sans effet
// (evenement_agenda n'écrit rien quand rien ne change : « rdv_inchange »).
//
//   Call booked       → reserve        rdvExterneId : event.uuid (le call)
//   Call rescheduled  → deplace        (même call, nouvelle date ; deux reports = deux externeId)
//   Call canceled     → annule
//   Outcome added     → issue (no_show, sinon tenu) SEULEMENT si l'envoi porte l'identifiant du call (event.uuid, callId…) : l'envoi
//                       natif d'iClosed ne le porte pas (voir docs/agenda.md : Zapier ou Make, ou noter l'issue dans l'agenda).
// Heures : la documentation d'iClosed est incohérente (« utc_start_time » y porte un décalage local, et des heures arrivent SANS décalage).
// Une heure avec un décalage explicite (Z, +01:00) est prise telle quelle ; sans décalage, c'est l'heure du fuseau de l'événement, sinon
// celui de l'équipe (config.pays.fuseau).
// iClosed écrit lui-même dans Google Agenda : l'application n'écrit jamais dans Google (pas de double).

import { egalTempsConstant, objet, valeurEnv } from "../integrations/base";
import { FUSEAU_PAR_DEFAUT, fuseauValide, heureMuraleVersMs } from "./fuseau";
import {
  chaine,
  chemin,
  emailOuNull,
  empreinteCourte,
  idExterneCourt,
  idExterneOuNull,
  isoOuNull,
  lienHttpsOuNull,
  liste,
  telephoneOuNull,
  uuidOuNull,
} from "./lecture";
import { emailPourLien, identifiantPourLien, lienAvecParametres, lienNu, nomPourLien, telephonePourLien } from "./lien";
import type { AdaptateurAgenda, CanalRdv, EvenementRdv, IssueRdv, TypeEvenementRdv } from "./types";

export const VARIABLE_ICLOSED = "ICLOSED_WEBHOOK_SECRET";
export const ENTETE_ICLOSED = "x-webhook-secret";
export const LONGUEUR_MIN_SECRET_ICLOSED = 24;
/** iClosed envoie un événement par requête ; au-delà de 20, l'envoi n'est pas d'iClosed. */
export const EVENEMENTS_MAX_ICLOSED = 20;

/** Le secret reçu : l'en-tête d'abord, sinon le paramètre « secret » de l'adresse (le webhook natif n'a pas d'en-tête). */
export function secretRecuIclosed(req: Request): string | null {
  const entete = req.headers.get(ENTETE_ICLOSED)?.trim();
  if (entete) return entete;
  try {
    return new URL(req.url).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** Vrai si le secret reçu est celui de l'instance (24 caractères au moins, comparé en temps constant). */
export function secretIclosedValide(req: Request, attendu: string): boolean {
  if (attendu.length < LONGUEUR_MIN_SECRET_ICLOSED) return false;
  const recu = secretRecuIclosed(req);
  if (!recu || recu.length > 500) return false;
  return egalTempsConstant(recu, attendu);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Le type d'un événement
// ---------------------------------------------------------------------------------------------------------------------------------

type GenreIclosed = "reserve" | "deplace" | "annule" | "issue" | "autre";

/** Le genre d'un hookType iClosed (et des noms de déclencheurs de Zapier, Make ou de l'ancienne version). */
export function genreDepuisHook(hook: string): GenreIclosed | null {
  const h = hook.toLowerCase().replace(/[\s_.-]+/g, "");
  if (!h) return null;
  if (/outcome|result|noshow/.test(h)) return "issue";
  if (/cancel/.test(h)) return "annule";
  if (/reschedul/.test(h)) return "deplace";
  if (/contact|deal|transaction/.test(h)) return "autre";
  if (/booked|scheduled|newcall|created|booking/.test(h)) return "reserve";
  return null;
}

/** L'issue d'un résultat iClosed : no_show, tenu (l'appel a eu lieu, quel qu'en soit le résultat), ou null (report, annulation, inconnu). */
export function issueDepuisResultat(resultat: string | null, raison: string | null): IssueRdv | null {
  const o = (resultat ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  const r = (raison ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  if (o === "NO_SHOW" || o === "NOSHOW" || r === "NO_SHOW") return "no_show";
  if (/^RESCHEDULE|CANCEL/.test(o) || /CANCEL/.test(r)) return null;
  if (
    ["SALE", "WON", "PARTIAL_SALE", "DEPOSIT", "RECURRING", "APPROVED", "NO_SALE", "NOT_INTERESTED", "REJECTED", "LOST"].includes(o) ||
    ["UNQUALIFIED", "DISQUALIFIED", "FOLLOW_UP", "FOLLOW_UP_SCHEDULE"].includes(o) ||
    /_OBJECTION$/.test(o)
  ) {
    return "tenu";
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les heures
// ---------------------------------------------------------------------------------------------------------------------------------

const RE_DATE_HEURE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

type LectureHeure = { iso: string; explicite: boolean } | null;

/** Une heure d'iClosed : avec un décalage explicite, absolue ; sans décalage, l'heure murale du fuseau donné. */
export function lireHeureIclosed(v: unknown, fuseauSansDecalage: string): LectureHeure {
  if (typeof v === "number") {
    const iso = isoOuNull(v);
    return iso ? { iso, explicite: true } : null;
  }
  const t = chaine(v, 40);
  if (!t) return null;
  const m = RE_DATE_HEURE.exec(t);
  if (!m) return null;
  if (m[7]) {
    const iso = isoOuNull(t.replace(" ", "T"));
    return iso ? { iso, explicite: true } : null;
  }
  const ms = heureMuraleVersMs(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), fuseauSansDecalage);
  const iso = isoOuNull(ms);
  return iso ? { iso, explicite: false } : null;
}

function premier<T>(racines: readonly unknown[], cles: readonly string[], lire: (v: unknown) => T | null): T | null {
  for (const r of racines) {
    for (const c of cles) {
      const v = lire(chemin(r, c));
      if (v !== null) return v;
    }
  }
  return null;
}

/**
 * L'heure d'un call : (1) une heure locale (start_time…) AVEC décalage ; (2) utc_start_time en Z ou +00:00 ; (3) une heure locale SANS
 * décalage, dans le fuseau de l'événement (invitee_start_time : celui de l'invité), sinon celui de l'équipe ; (4) utc_start_time sans
 * décalage, lu comme de l'UTC.
 */
function heureCall(racines: readonly unknown[], clesLocales: readonly string[], cleUtc: string, fuseauEquipe: string): string | null {
  const fuseauEvt = premier(racines, ["event.timezone", "event.timeZone", "timezone", "timeZone", "event_type.timezone"], fuseauValide) ?? fuseauEquipe;
  const fuseauInvite = premier(racines, ["invitee.timezone"], fuseauValide) ?? fuseauEvt;
  const lectures: NonNullable<LectureHeure>[] = [];
  for (const r of racines) {
    for (const c of clesLocales) {
      const l = lireHeureIclosed(chemin(r, c), c.includes("invitee_") ? fuseauInvite : fuseauEvt);
      if (l) lectures.push(l);
    }
  }
  const explicite = lectures.find((l) => l.explicite);
  if (explicite) return explicite.iso;
  const brutUtc = premier(racines, [cleUtc], (v) => chaine(v, 40));
  if (brutUtc && /(Z|[+-]00:?00)$/i.test(brutUtc)) {
    const l = lireHeureIclosed(brutUtc, "UTC");
    if (l) return l.iso;
  }
  if (lectures[0]) return lectures[0].iso;
  return brutUtc ? (lireHeureIclosed(brutUtc, "UTC")?.iso ?? null) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les champs
// ---------------------------------------------------------------------------------------------------------------------------------

const CLES_HOOK = ["hookType", "hook_type", "trigger", "event_name", "type"];
const CLES_CALL = ["event.uuid", "call.uuid", "eventCall.id", "eventCallId", "callId", "call_id", "bookingId", "booking_id"];
const CLES_EMAIL = ["invitee.email", "email", "contact.email", "lead.email"];
const CLES_TELEPHONE = ["invitee.text_reminder_number", "invitee.phone", "invitee.phoneNumber", "phoneNumber", "phone", "phone_number", "contact.phone"];
const CLES_LEAD = ["tracking.utm_content", "tracking.first_utm_content", "utm_content", "lead_id", "leadId"];
const CLES_DEBUT = ["event.start_time", "event.invitee_start_time", "startTime", "start_time", "call.startTime", "call.start_time"];
const CLES_FIN = ["event.end_time", "event.invitee_end_time", "endTime", "end_time", "call.endTime"];

function telephoneIclosed(racines: readonly unknown[]): string | null {
  const direct = premier(racines, CLES_TELEPHONE, telephoneOuNull);
  if (direct) return direct;
  for (const r of racines) {
    for (const qa of liste(chemin(r, "questions_and_answers"), 50)) {
      const o = objet(qa);
      if (/phone|t[ée]l[ée]phone|portable|mobile|num[ée]ro/i.test(chaine(o.question, 200) ?? "")) {
        const t = telephoneOuNull(o.answer);
        if (t) return t;
      }
    }
  }
  return null;
}

function nomIclosed(racines: readonly unknown[]): string | null {
  const complet = premier(racines, ["invitee.name", "name", "contact.name", "fullName"], (v) => chaine(v, 160));
  if (complet) return complet;
  for (const r of racines) {
    const prenom = chaine(chemin(r, "invitee.first_name") ?? chemin(r, "firstName") ?? chemin(r, "first_name"), 80);
    const nom = chaine(chemin(r, "invitee.last_name") ?? chemin(r, "lastName") ?? chemin(r, "last_name"), 80);
    const t = [prenom, nom].filter(Boolean).join(" ").trim();
    if (t) return t;
  }
  return null;
}

/** La fiche : utm_content (posé par le lien pré-rempli), sinon une paire utmKey_i / utmValue_i « utm_content » ou « lead_id ». */
function leadIclosed(racines: readonly unknown[]): string | null {
  const direct = premier(racines, CLES_LEAD, uuidOuNull);
  if (direct) return direct;
  for (const r of racines) {
    const t = objet(chemin(r, "tracking"));
    for (let i = 0; i < 10; i++) {
      const cle = chaine(t[`utmKey_${i}`], 40);
      if (cle && /^(utm_content|lead_?id)$/i.test(cle)) {
        const v = uuidOuNull(t[`utmValue_${i}`]);
        if (v) return v;
      }
    }
  }
  return null;
}

/** Le lien de la visio : un https qui n'est pas une page d'iClosed elle-même. */
export function lienVisioIclosed(v: unknown): string | null {
  const lien = lienHttpsOuNull(v);
  if (!lien) return null;
  return /(^|\.)iclosed\.io$/i.test(new URL(lien).hostname) ? null : lien;
}

function canalIclosed(racines: readonly unknown[]): { canal: CanalRdv | null; lienVisio: string | null } {
  const lieu = premier(racines, ["event.location", "location", "meetingLink", "meeting_url"], (v) => chaine(v, 300));
  const lien = lienVisioIclosed(lieu);
  if (lien) return { canal: "visio", lienVisio: lien };
  if (lieu && telephoneOuNull(lieu)) return { canal: "telephone", lienVisio: null };
  return { canal: null, lienVisio: null };
}

/** L'e-mail du closer : event.extended_assigned_to (le principal d'abord), sinon closerEmail (issue). */
function emailCloserIclosed(racines: readonly unknown[]): string | null {
  for (const r of racines) {
    const assignes = Object.values(objet(chemin(r, "event.extended_assigned_to"))).slice(0, 10).map(objet);
    const principal = assignes.find((a) => String(a.primary) === "true" && emailOuNull(a.email));
    const e = emailOuNull(principal?.email) ?? assignes.map((a) => emailOuNull(a.email)).find((x): x is string => x !== null) ?? null;
    if (e) return e;
  }
  return premier(racines, ["closerEmail", "closer.email"], emailOuNull);
}

/** L'horodatage de modification d'un événement, quand l'envoi en porte un (Zapier, Make, ou une version future d'iClosed). */
const CLES_MODIFIE = ["event.updated_at", "event.updatedAt", "updated_at", "updatedAt"];

/**
 * La version d'un événement, dernière partie de sa clé d'idempotence (base 36) : son horodatage de modification en secondes s'il est
 * envoyé, sinon la minute de réception (recuLeMs).
 */
export function versionIclosed(racines: readonly unknown[], recuLeMs: number): string {
  const modifie = premier(racines, CLES_MODIFIE, (v) => {
    const t = Date.parse(chaine(v, 40) ?? "");
    return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) : null;
  });
  return (modifie ?? Math.floor(recuLeMs / 60_000)).toString(36);
}

/** « 2026-11-10T09:00:00.000Z » → « 20261110T090000Z » (pour un externeId lisible et court). */
function compact(iso: string | null): string {
  return iso ? iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z") : "sans-date";
}

/**
 * Un événement iClosed (un élément du tableau) ramené à un événement de rendez-vous ; null s'il n'est pas utilisable. recuLeMs : l'heure
 * de réception (la version de l'événement quand il ne porte pas d'horodatage de modification).
 */
export function lireEvenementIclosed(brut: unknown, fuseauEquipe: string = FUSEAU_PAR_DEFAUT, recuLeMs: number = Date.now()): EvenementRdv | null {
  const json = objet(brut);
  if (Object.keys(json).length === 0) return null;
  const racines = [json, objet(json.data), objet(json.payload)];

  const hook = premier(racines, CLES_HOOK, (v) => chaine(v, 60));
  let genre = hook ? genreDepuisHook(hook) : null;
  // Sans type lisible : on le déduit du contenu.
  if (!genre) {
    if (premier(racines, ["callOutcome", "outcome"], (v) => chaine(v, 60))) genre = "issue";
    else if (premier(racines, ["event.canceled", "invitee.canceled"], (v) => (v === true ? true : null))) genre = "annule";
    else if (premier(racines, ["event.old_start_time"], (v) => chaine(v, 40))) genre = "deplace";
    else if (premier(racines, ["event.uuid"], (v) => chaine(v, 120))) genre = "reserve";
  }
  if (!genre || genre === "autre") return null;
  // Un « booké » d'un call déjà annulé est une annulation.
  if (genre === "reserve" && premier(racines, ["event.canceled"], (v) => (v === true ? true : null))) genre = "annule";

  const callBrut = premier(racines, CLES_CALL, (v) => idExterneOuNull(chaine(v, 200), 200));
  if (!callBrut) return null;
  const call = idExterneCourt(callBrut, 70);

  let issue: IssueRdv | null = null;
  if (genre === "issue") {
    const resultat = premier(racines, ["callOutcome", "outcome"], (v) => chaine(v, 60));
    const raison = premier(racines, ["noSaleReason"], (v) => chaine(v, 60));
    issue = hook && /no.?show/i.test(hook) ? "no_show" : issueDepuisResultat(resultat, raison);
    if (!issue) return null;
  }

  const debut = heureCall(racines, CLES_DEBUT, "event.utc_start_time", fuseauEquipe);
  const fin = heureCall(racines, CLES_FIN, "event.utc_end_time", fuseauEquipe);
  const type: TypeEvenementRdv = genre;
  // Un report : la nouvelle date et l'ancienne (deux reports différents = deux clés) ; puis la version (le même envoi renvoyé dans la
  // minute = la même clé ; le même report refait plus tard, après un retour en arrière = une nouvelle clé). 120 caractères au plus.
  const ancienne = premier(racines, ["event.old_start_time", "old_start_time", "oldStartTime"], (v) => chaine(v, 40)) ?? "";
  const version = versionIclosed(racines, recuLeMs);
  const externeId =
    type === "reserve"
      ? `reserve:${call}:${version}`
      : type === "deplace"
        ? `deplace:${call}:${compact(debut)}:${empreinteCourte(ancienne)}:${version}`
        : type === "annule"
          ? `annule:${call}:${version}`
          : `issue:${call}:${issue}:${version}`;
  const { canal, lienVisio } = canalIclosed(racines);

  return {
    fournisseur: "iclosed",
    type,
    externeId,
    rdvExterneId: call,
    debut,
    fin,
    issue,
    leadId: leadIclosed(racines),
    email: premier(racines, CLES_EMAIL, emailOuNull),
    telephone: telephoneIclosed(racines),
    nom: nomIclosed(racines),
    canal,
    lienVisio,
    emailCloser: emailCloserIclosed(racines),
  };
}

/** Le corps d'un envoi iClosed : un tableau d'événements (ou un objet seul : Zapier, Make). Au-delà de 20 éléments, rien. */
export function lireIclosed(corps: unknown, fuseauEquipe: string = FUSEAU_PAR_DEFAUT): EvenementRdv[] {
  const elements = Array.isArray(corps) ? corps : corps !== null && typeof corps === "object" ? [corps] : [];
  if (elements.length > EVENEMENTS_MAX_ICLOSED) return [];
  const recuLeMs = Date.now();
  return elements.map((e) => lireEvenementIclosed(e, fuseauEquipe, recuLeMs)).filter((e): e is EvenementRdv => e !== null);
}

/** L'adaptateur iClosed ; `fuseauEquipe` lit les heures envoyées sans décalage (config.pays.fuseau). */
export function creerIclosed(fuseauEquipe: string = FUSEAU_PAR_DEFAUT): AdaptateurAgenda {
  const fuseau = fuseauValide(fuseauEquipe) ?? FUSEAU_PAR_DEFAUT;
  return {
    id: "iclosed",
    libelle: "iClosed",
    lienReservation(lead, config) {
      if (!config.prefill) return lienNu(config);
      // Paramètres de pré-remplissage d'iClosed : iclosedName (nom complet), iclosedEmail, iclosedPhone (format +33…).
      return lienAvecParametres(config.lienReservation, [
        ["iclosedName", nomPourLien(lead)],
        ["iclosedEmail", emailPourLien(lead)],
        ["iclosedPhone", telephonePourLien(lead)],
        [config.champLead, identifiantPourLien(lead)],
      ]);
    },
    webhook: {
      variables: [VARIABLE_ICLOSED],
      verifier(req, _corps, env) {
        return secretIclosedValide(req, valeurEnv(env, VARIABLE_ICLOSED));
      },
      lire(corps) {
        return lireIclosed(corps, fuseau);
      },
    },
  };
}

export const iclosed: AdaptateurAgenda = creerIclosed();
