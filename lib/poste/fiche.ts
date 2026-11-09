// Les lignes de la base, lues prudemment (une forme inattendue ne fait jamais planter un écran) et ramenées en camelCase : la fiche
// complète, la ligne légère de la file, une activité du journal, un rendez-vous, un membre de l'équipe. Module PUR.

import type { FicheFile, Tier } from "./file";

export interface Fiche {
  id: string;
  entreprise: string;
  siren: string | null;
  siret: string | null;
  naf: string | null;
  forme: string | null;
  dateCreation: string | null;
  effectif: string | null;
  metier: string | null;
  ville: string | null;
  cp: string | null;
  departement: string | null;
  dirigeant: string | null;
  telephone: string | null;
  mobile: string | null;
  email: string | null;
  emailSource: string | null;
  site: string | null;
  noteGoogle: number | null;
  nbAvis: number | null;
  score: number | null;
  tier: Tier | null;
  statut: string;
  objection: string | null;
  derniereIssue: string | null;
  tentatives: number;
  rappelLe: string | null;
  rdvLe: string | null;
  assigneA: string | null;
  accroche: string | null;
  accrocheSource: string | null;
  sources: unknown[];
  qualification: Record<string, unknown>;
  urgent: boolean;
  notes: string | null;
  derniereActivite: string | null;
  creeLe: string;
}

/** Les colonnes lues pour une fiche complète (jamais les colonnes calculées). */
export const COLONNES_FICHE =
  "id, entreprise, siren, siret, naf, forme, date_creation, effectif, metier, ville, cp, departement, dirigeant, telephone, mobile, email, " +
  "email_source, site, note_google, nb_avis, score, tier, statut, objection, derniere_issue, tentatives, rappel_le, rdv_le, assigned_to, " +
  "accroche, accroche_source, sources, qualification, notes, last_activity_at, created_at";

/** Les colonnes de la file (une ligne légère : ni notes, ni sources, ni qualification complète). */
export const COLONNES_FILE = "id, entreprise, ville, tier, score, statut, tentatives, rappel_le, assigned_to, derniere_issue, created_at, urgent:qualification->urgent";

/** Les colonnes de la liste des prospects. */
export const COLONNES_LISTE =
  "id, entreprise, ville, departement, tier, score, statut, tentatives, rappel_le, rdv_le, assigned_to, derniere_issue, email, accroche, last_activity_at, created_at";

type Ligne = Record<string, unknown>;

function ligne(v: unknown): Ligne | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Ligne) : null;
}
const chaine = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const nombre = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const tier = (v: unknown): Tier | null => (v === "A" || v === "B" || v === "C" ? v : null);

export function estUrgent(qualification: unknown): boolean {
  const q = ligne(qualification);
  return q?.urgent === true;
}

export function lireFiche(v: unknown): Fiche | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  const entreprise = chaine(r?.entreprise);
  if (!r || !id || !entreprise) return null;
  const qualification = ligne(r.qualification) ?? {};
  return {
    id,
    entreprise,
    siren: chaine(r.siren),
    siret: chaine(r.siret),
    naf: chaine(r.naf),
    forme: chaine(r.forme),
    dateCreation: chaine(r.date_creation),
    effectif: chaine(r.effectif),
    metier: chaine(r.metier),
    ville: chaine(r.ville),
    cp: chaine(r.cp),
    departement: chaine(r.departement),
    dirigeant: chaine(r.dirigeant),
    telephone: chaine(r.telephone),
    mobile: chaine(r.mobile),
    email: chaine(r.email),
    emailSource: chaine(r.email_source),
    site: chaine(r.site),
    noteGoogle: nombre(r.note_google),
    nbAvis: nombre(r.nb_avis),
    score: nombre(r.score),
    tier: tier(r.tier),
    statut: chaine(r.statut) ?? "a_appeler",
    objection: chaine(r.objection),
    derniereIssue: chaine(r.derniere_issue),
    tentatives: nombre(r.tentatives) ?? 0,
    rappelLe: chaine(r.rappel_le),
    rdvLe: chaine(r.rdv_le),
    assigneA: chaine(r.assigned_to),
    accroche: chaine(r.accroche),
    accrocheSource: chaine(r.accroche_source),
    sources: Array.isArray(r.sources) ? r.sources : [],
    qualification,
    urgent: qualification.urgent === true,
    notes: chaine(r.notes),
    derniereActivite: chaine(r.last_activity_at),
    creeLe: chaine(r.created_at) ?? "",
  };
}

export function lireFicheFile(v: unknown): FicheFile | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  const entreprise = chaine(r?.entreprise);
  if (!r || !id || !entreprise) return null;
  return {
    id,
    entreprise,
    ville: chaine(r.ville),
    tier: tier(r.tier),
    score: nombre(r.score),
    statut: chaine(r.statut) ?? "a_appeler",
    tentatives: nombre(r.tentatives) ?? 0,
    rappelLe: chaine(r.rappel_le),
    urgent: r.urgent === true || estUrgent(r.qualification),
    assigneA: chaine(r.assigned_to),
    derniereIssue: chaine(r.derniere_issue),
    creeLe: chaine(r.created_at) ?? "",
  };
}

export interface LigneListe {
  id: string;
  entreprise: string;
  ville: string | null;
  departement: string | null;
  tier: Tier | null;
  score: number | null;
  statut: string;
  tentatives: number;
  rappelLe: string | null;
  rdvLe: string | null;
  assigneA: string | null;
  derniereIssue: string | null;
  aEmail: boolean;
  aAccroche: boolean;
  derniereActivite: string | null;
}

export function lireLigneListe(v: unknown): LigneListe | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  const entreprise = chaine(r?.entreprise);
  if (!r || !id || !entreprise) return null;
  return {
    id,
    entreprise,
    ville: chaine(r.ville),
    departement: chaine(r.departement),
    tier: tier(r.tier),
    score: nombre(r.score),
    statut: chaine(r.statut) ?? "a_appeler",
    tentatives: nombre(r.tentatives) ?? 0,
    rappelLe: chaine(r.rappel_le),
    rdvLe: chaine(r.rdv_le),
    assigneA: chaine(r.assigned_to),
    derniereIssue: chaine(r.derniere_issue),
    aEmail: chaine(r.email) !== null,
    aAccroche: (chaine(r.accroche) ?? "").trim() !== "",
    derniereActivite: chaine(r.last_activity_at),
  };
}

export const TYPES_ACTIVITE = ["appel", "note", "rdv", "statut", "annonce", "import"] as const;
export type TypeActivite = (typeof TYPES_ACTIVITE)[number];

export interface Activite {
  id: string;
  type: TypeActivite;
  issue: string | null;
  objection: string | null;
  statutApres: string | null;
  rappelLe: string | null;
  note: string | null;
  dureeS: number | null;
  appelantId: string | null;
  appelId: string | null;
  creeLe: string;
}

export const COLONNES_ACTIVITE = "id, type, issue, objection, statut_apres, rappel_le, note, duree_s, appelant_id, appel_id, cree_le";

export function lireActivite(v: unknown): Activite | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  const type = chaine(r?.type);
  const creeLe = chaine(r?.cree_le);
  if (!r || !id || !type || !creeLe || !(TYPES_ACTIVITE as readonly string[]).includes(type)) return null;
  return {
    id,
    type: type as TypeActivite,
    issue: chaine(r.issue),
    objection: chaine(r.objection),
    statutApres: chaine(r.statut_apres),
    rappelLe: chaine(r.rappel_le),
    note: chaine(r.note),
    dureeS: nombre(r.duree_s),
    appelantId: chaine(r.appelant_id),
    appelId: chaine(r.appel_id),
    creeLe,
  };
}

export interface RdvFiche {
  id: string;
  debut: string;
  fin: string;
  canal: string;
  statut: string;
  source: string;
  closerId: string | null;
  prisPar: string | null;
  lienVisio: string | null;
  note: string | null;
  aVerifier: boolean;
}

export const COLONNES_RDV = "id, debut, fin, canal, statut, source, closer_id, pris_par, lien_visio, note, a_verifier";

export function lireRdv(v: unknown): RdvFiche | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  const debut = chaine(r?.debut);
  const fin = chaine(r?.fin);
  if (!r || !id || !debut || !fin) return null;
  return {
    id,
    debut,
    fin,
    canal: chaine(r.canal) ?? "visio",
    statut: chaine(r.statut) ?? "pris",
    source: chaine(r.source) ?? "poste",
    closerId: chaine(r.closer_id),
    prisPar: chaine(r.pris_par),
    lienVisio: chaine(r.lien_visio),
    note: chaine(r.note),
    aVerifier: r.a_verifier === true,
  };
}

export interface Membre {
  id: string;
  nom: string;
  role: "proprietaire" | "membre" | "appelant";
}

export function lireMembre(v: unknown): Membre | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  const role = chaine(r?.role);
  if (!r || !id || (role !== "proprietaire" && role !== "membre" && role !== "appelant")) return null;
  return { id, nom: chaine(r.nom) ?? "Sans nom", role };
}

/** Lit un tableau de lignes avec un lecteur : les lignes illisibles sont ignorées. */
export function lireListe<T>(v: unknown, lecteur: (x: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(lecteur).filter((x): x is T => x !== null) : [];
}
