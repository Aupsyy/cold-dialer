// L'adaptateur Google Agenda : l'application LIT un agenda Google (jamais elle n'y écrit) et en ramène les rendez-vous de prospection.
//
// Pas de webhook : une tâche planifiée (cron Vercel) appelle /api/agenda/google/sync avec « Authorization: Bearer <CRON_SECRET> ». La
// route échange le refresh token contre un jeton d'accès (OAuth 2.0 : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
// portée https://www.googleapis.com/auth/calendar.events ou calendar.events.readonly), lit les événements À VENIR de l'agenda
// GOOGLE_CALENDAR_ID (« primary » par défaut) par l'API REST Calendar v3, et envoie chaque rendez-vous à evenement_agenda.
//
// Un événement Google devient un rendez-vous s'il a une heure (pas une journée entière), s'il est un événement ordinaire (ni absence, ni
// temps de concentration) et s'il porte l'identifiant d'une fiche dans sa description (« utm_content=<id> » ou « /prospects/<id> ») ou un
// invité extérieur à l'équipe. Le rapprochement avec une fiche est fait par la base : identifiant, puis e-mail, puis téléphone.
// Idempotence : externeId = l'identifiant Google et la version de l'événement (son champ « updated »), à défaut une empreinte de ce qui
// compte (créneau, invité, lien) : une même version relue n'est traitée qu'une fois, un déplacement (même un aller-retour) l'est de nouveau. Un événement supprimé (status « cancelled ») annule le rendez-vous.
//
// Piège connu : tant que l'application Google Cloud est en mode « Testing », le refresh token EXPIRE AU BOUT DE 7 JOURS (la
// synchronisation répond alors « jeton_refuse »). Il faut la publier (« In production ») : voir docs/agenda.md.
// Aucun module Node ; fetch est injecté (tests sans réseau) ; le journal ne porte que des codes.

import { egalTempsConstant, objet, valeurEnv, variablesManquantes, type Env, type Journal, type Rpc } from "../integrations/base";
import { appliquerEvenements, type BilanApplication } from "./appliquer";
import { chaine, chemin, emailOuNull, empreinteCourte, idExterneCourt, isoOuNull, lienHttpsOuNull, liste, telephoneOuNull, uuidOuNull } from "./lecture";
import type { AdaptateurAgenda, CanalRdv, EvenementRdv } from "./types";

export const VARIABLES_GOOGLE = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"] as const;
export const VARIABLE_CALENDRIER_GOOGLE = "GOOGLE_CALENDAR_ID";
export const VARIABLE_CRON = "CRON_SECRET";
export const LONGUEUR_MIN_CRON = 16;
export const PORTEE_GOOGLE = "https://www.googleapis.com/auth/calendar.events";
export const URL_JETON_GOOGLE = "https://oauth2.googleapis.com/token";
export const URL_CALENDAR_GOOGLE = "https://www.googleapis.com/calendar/v3";
/** La fenêtre lue : de maintenant à 60 jours. */
export const JOURS_SYNC_GOOGLE = 60;
export const PAGES_MAX_GOOGLE = 4;
export const EVENEMENTS_PAR_PAGE_GOOGLE = 250;
/** Au plus 300 rendez-vous nouveaux ou modifiés envoyés à la base par passage (le reste au passage suivant). */
export const CANDIDATS_MAX_GOOGLE = 300;
export const DELAI_GOOGLE_MS = 8000;

export type RaisonGoogle =
  | "non_configure"
  | "jeton_refuse"
  | "jeton_illisible"
  | "non_autorise"
  | "introuvable"
  | "quota"
  | "reponse_illisible"
  | "delai"
  | "reseau"
  | `http_${number}`;

/** L'agenda lu : GOOGLE_CALENDAR_ID, sinon « primary » (une valeur douteuse retombe sur « primary »). */
export function calendrierGoogle(env: Env): string {
  const v = valeurEnv(env, VARIABLE_CALENDRIER_GOOGLE);
  return v && v.length <= 200 && !/[\s/?#]/.test(v) ? v : "primary";
}

/** Vrai si l'en-tête est « Bearer <CRON_SECRET> » (comparaison en temps constant ; un secret de moins de 16 caractères ne vaut rien). */
export function cronAutorise(entete: string | null, env: Env): boolean {
  const secret = valeurEnv(env, VARIABLE_CRON);
  if (secret.length < LONGUEUR_MIN_CRON || !entete || entete.length > 600) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(entete.trim());
  return m !== null && egalTempsConstant(m[1], secret);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Le client (OAuth et API Calendar)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DependancesClientGoogle {
  fetch: typeof fetch;
  delaiMs?: number;
}

type ReponseBrute = { statut: number; json: unknown } | { echec: "delai" | "reseau" };

async function appeler(f: typeof fetch, delaiMs: number, url: string, init: RequestInit): Promise<ReponseBrute> {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delaiMs);
  try {
    const rep = await f(url, { ...init, signal: controleur.signal });
    let json: unknown = null;
    try {
      json = await rep.json();
    } catch {
      json = null;
    }
    return { statut: rep.status, json };
  } catch {
    return { echec: controleur.signal.aborted ? "delai" : "reseau" };
  } finally {
    clearTimeout(minuterie);
  }
}

/** La raison d'une réponse qui n'est pas un succès (un 403 « rate limit » de Google est un quota). Jamais le texte de Google. */
export function raisonHttpGoogle(statut: number, json: unknown): RaisonGoogle {
  if (statut === 401) return "non_autorise";
  if (statut === 404 || statut === 410) return "introuvable";
  if (statut === 429) return "quota";
  if (statut === 403) {
    const erreurs = liste(chemin(json, "error.errors"), 10);
    return erreurs.some((e) => /ratelimit|quota|usagelimits/i.test(chaine(objet(e).reason, 60) ?? "")) ? "quota" : "non_autorise";
  }
  return `http_${statut}`;
}

export interface ClientGoogle {
  /** Les événements d'une fenêtre (instances des événements récurrents dépliées, événements supprimés compris). */
  lister(timeMinIso: string, timeMaxIso: string): Promise<{ ok: true; items: unknown[] } | { ok: false; raison: RaisonGoogle }>;
}

/** Le client Google Calendar, ou null tant qu'une variable manque. Un jeton d'accès par client, rafraîchi une fois sur un 401. */
export function clientGoogle(env: Env, deps: DependancesClientGoogle): ClientGoogle | null {
  if (variablesManquantes(env, VARIABLES_GOOGLE).length > 0) return null;
  const f = deps.fetch;
  const delaiMs = deps.delaiMs ?? DELAI_GOOGLE_MS;
  const agenda = encodeURIComponent(calendrierGoogle(env));
  let jetonCourant: string | null = null;

  async function jeton(forcer: boolean): Promise<{ jeton: string } | { raison: RaisonGoogle }> {
    if (jetonCourant && !forcer) return { jeton: jetonCourant };
    const corps = new URLSearchParams({
      client_id: valeurEnv(env, "GOOGLE_CLIENT_ID"),
      client_secret: valeurEnv(env, "GOOGLE_CLIENT_SECRET"),
      refresh_token: valeurEnv(env, "GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    });
    const r = await appeler(f, delaiMs, URL_JETON_GOOGLE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: corps.toString(),
    });
    if ("echec" in r) return { raison: r.echec };
    // 400 invalid_grant : refresh token expiré (application en mode « Testing » : 7 jours) ou révoqué.
    if (r.statut === 400 || r.statut === 401) return { raison: "jeton_refuse" };
    if (r.statut !== 200) return { raison: raisonHttpGoogle(r.statut, r.json) };
    const acces = chaine(objet(r.json).access_token, 4096);
    if (!acces) return { raison: "jeton_illisible" };
    jetonCourant = acces;
    return { jeton: acces };
  }

  async function lirePage(url: string): Promise<{ ok: true; json: unknown } | { ok: false; raison: RaisonGoogle }> {
    let j = await jeton(false);
    if ("raison" in j) return { ok: false, raison: j.raison };
    for (let tentative = 0; tentative < 2; tentative++) {
      const r = await appeler(f, delaiMs, url, { method: "GET", headers: { Authorization: `Bearer ${j.jeton}`, Accept: "application/json" } });
      if ("echec" in r) return { ok: false, raison: r.echec };
      if (r.statut === 200) return { ok: true, json: r.json };
      if (r.statut === 401 && tentative === 0) {
        j = await jeton(true);
        if ("raison" in j) return { ok: false, raison: j.raison };
        continue;
      }
      return { ok: false, raison: raisonHttpGoogle(r.statut, r.json) };
    }
    return { ok: false, raison: "non_autorise" };
  }

  return {
    async lister(timeMinIso, timeMaxIso) {
      const items: unknown[] = [];
      let pageToken: string | null = null;
      for (let page = 0; page < PAGES_MAX_GOOGLE; page++) {
        const params = new URLSearchParams({
          timeMin: timeMinIso,
          timeMax: timeMaxIso,
          singleEvents: "true",
          showDeleted: "true",
          maxResults: String(EVENEMENTS_PAR_PAGE_GOOGLE),
        });
        if (pageToken) params.set("pageToken", pageToken);
        const r = await lirePage(`${URL_CALENDAR_GOOGLE}/calendars/${agenda}/events?${params.toString()}`);
        if (!r.ok) return r;
        const o = objet(r.json);
        if (!Array.isArray(o.items)) return { ok: false, raison: "reponse_illisible" };
        items.push(...o.items);
        pageToken = chaine(o.nextPageToken, 2000);
        if (!pageToken) break;
      }
      return { ok: true, items };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Un événement Google → un événement de rendez-vous
// ---------------------------------------------------------------------------------------------------------------------------------

/** Les messageries grand public : deux adresses chez elles ne disent pas « même entreprise ». */
const DOMAINES_PUBLICS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "msn.com",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "mac.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net",
  "bbox.fr", "neuf.fr", "gmx.fr", "gmx.com", "proton.me", "protonmail.com", "aol.com",
]);

function domaine(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/** Une adresse d'agenda Google (agenda partagé, salle, import) n'est pas une personne. */
function emailPersonne(v: unknown): string | null {
  const e = emailOuNull(v);
  return e && !/calendar\.google\.com$/.test(domaine(e)) ? e : null;
}

/** L'identifiant d'une fiche glissé dans la description : « utm_content=<id> » ou un lien « …/prospects/<id> ». */
export function leadDepuisDescription(description: string): string | null {
  const m = /utm_content=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(description) ??
    /\/prospects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(description);
  return m ? uuidOuNull(m[1]) : null;
}

/** Un téléphone ANNONCÉ dans la description (« Téléphone : 01 99 00 01 01 ») ; un nombre seul n'est jamais pris pour un numéro. */
export function telephoneDepuisDescription(description: string): string | null {
  const m = /(?:t[ée]l[ée]phone|t[ée]l\.?|phone|mobile|portable)\s*[:：]\s*(\+?[\d][\d\s.()-]{5,24}\d)/i.exec(description);
  return m ? telephoneOuNull(m[1]) : null;
}

function canalGoogle(o: Record<string, unknown>): { canal: CanalRdv | null; lienVisio: string | null } {
  const meet = lienHttpsOuNull(o.hangoutLink);
  if (meet) return { canal: "visio", lienVisio: meet };
  const entrees = liste(chemin(o, "conferenceData.entryPoints"), 10).map(objet);
  const video = entrees.find((e) => e.entryPointType === "video" && lienHttpsOuNull(e.uri));
  if (video) return { canal: "visio", lienVisio: lienHttpsOuNull(video.uri) };
  const lieu = lienHttpsOuNull(o.location);
  if (lieu) return { canal: "visio", lienVisio: lieu };
  if (entrees.some((e) => e.entryPointType === "phone")) return { canal: "telephone", lienVisio: null };
  return { canal: null, lienVisio: null };
}

export interface OptionsNormalisationGoogle {
  /** Les e-mails des comptes de l'équipe : un invité de l'équipe n'est pas un prospect. */
  emailsEquipe?: ReadonlySet<string>;
  /** Les domaines de messagerie grand public (deux invités du même domaine n'y sont pas collègues) ; la liste intégrée par défaut. */
  domainesPublics?: ReadonlySet<string>;
}

/**
 * La version d'un événement Google : son horodatage de modification (« updated », qui change à CHAQUE modification), en base 36. La clé
 * d'idempotence la porte : une même version relue à chaque synchro n'est traitée qu'une fois, mais un aller-retour (A, puis B, puis de
 * nouveau A ; annulé puis restauré) donne de nouvelles versions, donc de nouvelles clés. null si Google ne la donne pas.
 */
export function versionGoogle(o: Record<string, unknown>): string | null {
  const t = Date.parse(chaine(o.updated, 40) ?? "");
  return Number.isFinite(t) && t > 0 ? t.toString(36) : null;
}

/** Un événement de l'API Calendar ramené à un événement de rendez-vous ; null s'il n'en est pas un. */
export function normaliserEvenementGoogle(item: unknown, options: OptionsNormalisationGoogle = {}): EvenementRdv | null {
  const o = objet(item);
  const idBrut = chaine(o.id, 1024);
  if (!idBrut || !/^[A-Za-z0-9_.:@-]+$/.test(idBrut)) return null;
  const id = idExterneCourt(idBrut, 90);
  const version = versionGoogle(o);
  const vide = { issue: null, leadId: null, email: null, telephone: null, nom: null, canal: null, lienVisio: null, emailCloser: null };

  if (o.status === "cancelled") {
    const externeId = version ? `annule:${id}:${version}` : `annule:${id}`;
    return { fournisseur: "google", type: "annule", externeId, rdvExterneId: id, debut: null, fin: null, ...vide };
  }
  const genre = chaine(o.eventType, 40);
  if (genre && genre !== "default") return null;
  const debut = isoOuNull(chemin(o, "start.dateTime"));
  if (!debut) return null;
  const fin = isoOuNull(chemin(o, "end.dateTime"));

  const description = chaine(o.description, 8000) ?? "";
  const leadId = leadDepuisDescription(description);
  const participants = liste(o.attendees, 100).map(objet);
  const hote =
    emailPersonne(participants.find((p) => p.self === true)?.email) ??
    emailPersonne(chemin(o, "organizer.email")) ??
    emailPersonne(chemin(o, "creator.email"));
  const equipe = options.emailsEquipe ?? new Set<string>();
  const publics = options.domainesPublics ?? DOMAINES_PUBLICS;
  const prospects = participants
    .filter((p) => p.self !== true && p.organizer !== true && p.resource !== true)
    .map((p) => ({ email: emailPersonne(p.email), nom: chaine(p.displayName, 160) }))
    .filter((p): p is { email: string; nom: string | null } => p.email !== null)
    .filter((p) => !equipe.has(p.email) && p.email !== hote)
    // Un invité du même domaine (privé) que l'hôte est un collègue : réunion interne.
    .filter((p) => !hote || publics.has(domaine(p.email)) || domaine(p.email) !== domaine(hote));
  if (!leadId && prospects.length === 0) return null;

  const prospect = prospects[0] ?? null;
  const telephone = telephoneDepuisDescription(description);
  const { canal, lienVisio } = canalGoogle(o);
  const empreinte = empreinteCourte([debut, fin ?? "", prospect?.email ?? "", leadId ?? "", telephone ?? "", canal ?? "", lienVisio ?? ""].join("|"));
  const cree = Date.parse(chaine(o.created, 40) ?? "");
  const maj = Date.parse(chaine(o.updated, 40) ?? "");
  const modifie = Number.isFinite(cree) && Number.isFinite(maj) && maj - cree > 60_000;
  return {
    fournisseur: "google",
    type: modifie ? "deplace" : "reserve",
    // La version si Google la donne ; sinon le contenu (créneau, invité, fiche, lien), comme avant.
    externeId: `${id}:${version ?? empreinte}`,
    rdvExterneId: id,
    debut,
    fin,
    issue: null,
    leadId,
    email: prospect?.email ?? null,
    telephone,
    nom: prospect?.nom ?? null,
    canal,
    lienVisio,
    emailCloser: hote,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La synchronisation
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DependancesSyncGoogle {
  env: Env;
  fetch: typeof fetch;
  base: () => Rpc;
  journal: Journal;
  maintenant: () => number;
  /** Les e-mails des comptes de l'équipe (lus avec la clé service) ; facultatif. */
  emailsEquipe?: () => Promise<ReadonlySet<string>>;
  /**
   * Les externeId Google déjà traités (journal des intégrations, lu avec la clé service) : un événement inchangé n'est pas renvoyé à la
   * base à chaque passage. Facultatif : sans cette liste (ou si sa lecture échoue), tout est envoyé et la base reconnaît les doublons.
   */
  dejaTraites?: () => Promise<ReadonlySet<string>>;
  delaiMs?: number;
}

export interface BilanSyncGoogle extends BilanApplication {
  /** Événements lus dans l'agenda. */
  lus: number;
  /** Ceux qui sont des rendez-vous de prospection. */
  candidats: number;
  /** Laissés pour le passage suivant (plafond par passage). */
  reportes: number;
  raison?: RaisonGoogle;
}

/** Lit l'agenda Google et envoie chaque rendez-vous à la base. Ne lève jamais : un bilan en compteurs (et une raison en cas d'échec). */
export async function synchroniserGoogle(d: DependancesSyncGoogle): Promise<BilanSyncGoogle> {
  const vide: BilanSyncGoogle = { ok: false, lus: 0, candidats: 0, reportes: 0, traites: 0, doublons: 0, aVerifier: 0, rejetes: 0 };
  const client = clientGoogle(d.env, { fetch: d.fetch, delaiMs: d.delaiMs });
  if (!client) return { ...vide, raison: "non_configure", code: "non_configure" };
  const maintenant = d.maintenant();
  const r = await client.lister(new Date(maintenant).toISOString(), new Date(maintenant + JOURS_SYNC_GOOGLE * 86_400_000).toISOString());
  if (!r.ok) {
    d.journal(`agenda:google:${r.raison}`, true);
    return { ...vide, raison: r.raison, code: r.raison };
  }
  let equipe: ReadonlySet<string> = new Set();
  if (d.emailsEquipe) {
    try {
      equipe = await d.emailsEquipe();
    } catch {
      d.journal("agenda:google:equipe_illisible", true);
    }
  }
  const candidats = r.items.map((i) => normaliserEvenementGoogle(i, { emailsEquipe: equipe })).filter((e): e is EvenementRdv => e !== null);
  let connus: ReadonlySet<string> = new Set();
  if (d.dejaTraites) {
    try {
      connus = await d.dejaTraites();
    } catch {
      d.journal("agenda:google:journal_illisible", true);
    }
  }
  const nouveaux = candidats.filter((e) => !connus.has(e.externeId));
  const aEnvoyer = nouveaux.slice(0, CANDIDATS_MAX_GOOGLE);
  let rpc: Rpc;
  try {
    rpc = d.base();
  } catch {
    d.journal("agenda:google:base_non_configuree", true);
    return { ...vide, lus: r.items.length, candidats: candidats.length, code: "base_non_configuree" };
  }
  const bilan = await appliquerEvenements(aEnvoyer, rpc, d.journal, "agenda:google");
  return {
    ...bilan,
    doublons: bilan.doublons + (candidats.length - nouveaux.length),
    lus: r.items.length,
    candidats: candidats.length,
    reportes: nouveaux.length - aEnvoyer.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// L'adaptateur
// ---------------------------------------------------------------------------------------------------------------------------------

export const google: AdaptateurAgenda = {
  id: "google",
  libelle: "Google Agenda",
  // Une page de réservation Google n'accepte aucun pré-remplissage : le lien public tel quel, s'il est donné.
  lienReservation(_lead, config) {
    const t = typeof config.lienReservation === "string" ? config.lienReservation.trim() : "";
    return lienHttpsOuNull(t, 500);
  },
};
