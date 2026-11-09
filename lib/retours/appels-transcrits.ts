// Le bloc « Appels transcrits » de la fiche prospect : les appels de la fiche (vus par le fournisseur de téléphonie) et leurs débriefs
// (scripts/debrief/ecrire.mjs). Lecture d'une ligne de la base en objet affichable, sans jamais planter sur une forme inattendue
// (un débrief écrit par une autre version, une extraction partielle), et la règle de l'audio. Module PUR (tests/retours-bloc.test.mjs).

import { estVerdictBase, verdictLu, type VerdictBase } from "./libelles";

export const STATUTS_APPEL = ["repondu", "sans_reponse", "occupe", "messagerie", "faux_numero", "inconnu"] as const;
export type StatutAppel = (typeof STATUTS_APPEL)[number];

export const LIBELLES_STATUT_APPEL: Readonly<Record<StatutAppel, string>> = {
  repondu: "Répondu",
  sans_reponse: "Sans réponse",
  occupe: "Occupé",
  messagerie: "Messagerie",
  faux_numero: "Faux numéro",
  inconnu: "Statut inconnu",
};

export const LIBELLES_SOURCE_DEBRIEF: Readonly<Record<string, string>> = {
  colle: "Transcription collée",
  fichier: "Fichier",
  appel: "Appel enregistré",
  notes_mac: "App Notes",
};

export const LIBELLES_ETAPE: Readonly<Record<string, string>> = {
  rdv: "Rendez-vous",
  rappel: "Rappel",
  mail: "Envoi d'informations",
  autre: "Autre",
};

/** Le nombre maximal d'éléments montrés par liste (douleurs, citations…). */
export const MAX_LISTE = 10;

export interface VueAppel {
  id: string;
  /** Date ISO du début (sinon de la réception). */
  quand: string | null;
  statut: StatutAppel;
  dureeS: number | null;
  fournisseur: string;
  direction: "sortant" | "entrant";
  annonceLue: boolean;
  /** Chemin de l'enregistrement dans le bucket privé (posé par la base seulement si l'appel était conservable). */
  enregistrement: string | null;
  aTranscription: boolean;
}

export interface EtapeVue {
  type: string;
  date: string | null;
  detail: string | null;
}

export interface VueDebrief {
  id: string;
  appelId: string | null;
  quand: string | null;
  source: string;
  issue: string | null;
  objection: string | null;
  objectionTexte: string | null;
  interet: number | null;
  decideurJoint: boolean | null;
  resume: string | null;
  douleurs: string[];
  croyances: string[];
  /** Les réponses de découverte, dans l'ordre où elles ont été écrites (id du champ, valeur). */
  champs: { id: string; valeur: string }[];
  citations: string[];
  prochaineEtape: EtapeVue | null;
  verdict: VerdictBase | null;
  tags: string[];
  aTranscription: boolean;
}

export interface EntreeAppels {
  cle: string;
  quand: string | null;
  appel: VueAppel | null;
  debriefs: VueDebrief[];
}

const objet = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const chaine = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const textes = (v: unknown, n = MAX_LISTE): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, n);
const dateOuNull = (v: unknown): string | null => {
  const t = chaine(v);
  return t && !Number.isNaN(new Date(t).getTime()) ? t : null;
};
const entier = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Une ligne de « appels » (colonnes lues par le bloc) ; null sans identifiant. */
export function lireAppel(brut: unknown): VueAppel | null {
  const o = objet(brut);
  const id = chaine(o.id);
  if (!id) return null;
  const statut = (STATUTS_APPEL as readonly string[]).includes(o.statut as string) ? (o.statut as StatutAppel) : "inconnu";
  return {
    id,
    quand: dateOuNull(o.debut) ?? dateOuNull(o.created_at),
    statut,
    dureeS: entier(o.duree_s, 0, 86_400),
    fournisseur: chaine(o.fournisseur) ?? "inconnu",
    direction: o.direction === "entrant" ? "entrant" : "sortant",
    annonceLue: o.annonce_lue === true,
    enregistrement: chaine(o.enregistrement_chemin),
    // Le bloc lit seulement le premier énoncé (transcription->0) : présent ou non.
    aTranscription: o.premiere_ligne !== null && o.premiere_ligne !== undefined,
  };
}

function lireEtape(v: unknown): EtapeVue | null {
  const o = objet(v);
  const type = chaine(o.type);
  if (!type || type === "aucune") return null;
  return { type, date: dateOuNull(o.date), detail: chaine(o.detail) };
}

/** Les réponses de découverte d'une extraction : { champs: {…} } (débrief), ou des clés à plat (autres écrivains). */
function lireChamps(extraction: Record<string, unknown>, reservees: ReadonlySet<string>): { id: string; valeur: string }[] {
  const source = Object.keys(objet(extraction.champs)).length > 0 ? objet(extraction.champs) : extraction;
  return Object.entries(source)
    .filter(([id, v]) => !reservees.has(id) && /^[a-z][a-z0-9_]{0,39}$/.test(id) && typeof v === "string" && v.trim() !== "")
    .map(([id, v]) => ({ id, valeur: (v as string).trim() }))
    .slice(0, 20);
}

const CLES_RESERVEES: ReadonlySet<string> = new Set([
  "version",
  "issue",
  "objection",
  "objection_texte",
  "interet",
  "decideur_joint",
  "resume",
  "douleurs",
  "croyances",
  "citations",
  "champs",
  "prochaine_etape",
  "tags",
  "verdict_accroche",
  "duree_s",
  "transcription_lignes",
]);

/**
 * Une ligne de « debriefs » ; null sans identifiant. `verdictRetour` : le verdict noté dans retours_marche pour ce débrief (il prime sur
 * celui de l'extraction) ; `aTranscription` : la base garde-t-elle une transcription pour ce débrief.
 */
export function lireDebrief(brut: unknown, verdictRetour: unknown = null, aTranscription = false): VueDebrief | null {
  const o = objet(brut);
  const id = chaine(o.id);
  if (!id) return null;
  const x = objet(o.extraction);
  return {
    id,
    appelId: chaine(o.appel_id),
    quand: dateOuNull(o.appel_le) ?? dateOuNull(o.created_at),
    source: chaine(o.source) ?? "colle",
    issue: chaine(x.issue),
    objection: chaine(x.objection),
    objectionTexte: chaine(x.objection_texte),
    interet: entier(x.interet, 0, 3),
    decideurJoint: typeof x.decideur_joint === "boolean" ? x.decideur_joint : null,
    resume: chaine(x.resume),
    douleurs: textes(x.douleurs),
    croyances: textes(x.croyances),
    champs: lireChamps(x, CLES_RESERVEES),
    citations: textes(x.citations),
    prochaineEtape: lireEtape(x.prochaine_etape),
    verdict: estVerdictBase(verdictRetour) ? verdictRetour : verdictLu(x.verdict_accroche),
    tags: textes(x.tags),
    aTranscription,
  };
}

const temps = (iso: string | null): number => (iso ? new Date(iso).getTime() : Number.NEGATIVE_INFINITY);

/** Les entrées du bloc, la plus récente d'abord : un appel et ses débriefs, ou un débrief seul (transcription collée, Notes…). */
export function assembler(appels: readonly VueAppel[], debriefs: readonly VueDebrief[]): EntreeAppels[] {
  const parAppel = new Map<string, VueDebrief[]>();
  const seuls: VueDebrief[] = [];
  const ids = new Set(appels.map((a) => a.id));
  for (const d of debriefs) {
    if (d.appelId && ids.has(d.appelId)) parAppel.set(d.appelId, [...(parAppel.get(d.appelId) ?? []), d]);
    else seuls.push(d);
  }
  const entrees: EntreeAppels[] = [
    ...appels.map((a) => ({ cle: `appel-${a.id}`, quand: a.quand, appel: a, debriefs: parAppel.get(a.id) ?? [] })),
    ...seuls.map((d) => ({ cle: `debrief-${d.id}`, quand: d.quand, appel: null, debriefs: [d] })),
  ];
  return entrees.sort((a, b) => temps(b.quand) - temps(a.quand) || a.cle.localeCompare(b.cle));
}

/**
 * L'audio se joue seulement s'il est conservable : un chemin posé par la base, l'annonce lue (ou jouée) pour CET appel, et
 * l'enregistrement complet toujours activé dans les réglages de l'équipe (s'il a été coupé depuis, plus rien ne se joue). La lecture
 * passe ensuite par enregistrement_lisible (politique du bucket : un gestionnaire, ou l'appelant de l'appel).
 */
export function audioJouable(appel: Pick<VueAppel, "enregistrement" | "annonceLue">, enregistrementComplet: boolean): boolean {
  return Boolean(appel.enregistrement) && appel.annonceLue && enregistrementComplet;
}
