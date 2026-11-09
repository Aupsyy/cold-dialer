// La file d'appels du Poste : quelles fiches on appelle, et dans quel ordre. Module PUR (testé par tests/poste-file.test.mjs).
//
// L'ordre :
//   1. les rappels dus (rappel_le passé), le plus en retard d'abord : un rappel promis passe avant tout ;
//   2. puis les fiches urgentes (qualification.urgent : posé à la main sur la fiche, ou par un import) ;
//   3. puis par tier : A, B, C, puis sans tier ;
//   4. puis le score, du plus haut au plus bas, puis le moins de tentatives d'abord (à égalité : la fiche la plus ancienne).
// Hors de la file : les fiches au statut final (rdv_fixe, pas_interesse, hors_cible, injoignable, clos) et celles de la liste
// d'opposition (statut ne_plus_contacter : la base l'impose à toute fiche dont le SIREN ou un numéro est dans « opposition »), et les
// fiches « à appeler » qui ont atteint config.tentativesMax. Un rappel promis (statut a_rappeler) reste dans la file même au-delà.
// Les fiches dont le rappel est à venir attendent leur heure (« Rappels à venir »). Les fiches déjà appelées aujourd'hui, sans rappel,
// passent en bas, hors de l'enchaînement (sinon un appel sans rappel automatique ramènerait la même fiche en tête).

export const STATUTS_FILE = ["a_appeler", "a_rappeler"] as const;
export const STATUTS_HORS_FILE = ["rdv_fixe", "pas_interesse", "hors_cible", "injoignable", "clos", "ne_plus_contacter"] as const;

export type Tier = "A" | "B" | "C";

export interface FicheFile {
  id: string;
  entreprise: string;
  ville: string | null;
  tier: Tier | null;
  score: number | null;
  statut: string;
  tentatives: number;
  /** ISO 8601, ou null. */
  rappelLe: string | null;
  urgent: boolean;
  assigneA: string | null;
  derniereIssue: string | null;
  creeLe: string;
}

export interface OptionsFile {
  maintenant: number;
  tentativesMax: number;
  /** Les fiches qui ont déjà eu un appel aujourd'hui (journal lead_activities). */
  appeleesAujourdhui?: ReadonlySet<string>;
  /** Vrai si la fiche est sur la liste d'opposition (en plus du statut, que la base garantit déjà). */
  enOpposition?: (f: FicheFile) => boolean;
}

export interface FileAppels {
  dus: FicheFile[];
  aAppeler: FicheFile[];
  dejaAppelees: FicheFile[];
  aVenir: FicheFile[];
  /** L'enchaînement du Poste : les rappels dus, puis la file à appeler. */
  ordre: string[];
}

export function rangTier(t: Tier | null): number {
  return t === "A" ? 0 : t === "B" ? 1 : t === "C" ? 2 : 3;
}

function instant(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** L'ordre de la file hors rappels : urgent, tier, score décroissant, moins de tentatives, la plus ancienne. */
export function comparerFile(a: FicheFile, b: FicheFile): number {
  return (
    Number(b.urgent) - Number(a.urgent) ||
    rangTier(a.tier) - rangTier(b.tier) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    a.tentatives - b.tentatives ||
    a.creeLe.localeCompare(b.creeLe) ||
    a.id.localeCompare(b.id)
  );
}

/** Les rappels : le plus tôt d'abord (à égalité, l'ordre de la file). */
export function comparerRappels(a: FicheFile, b: FicheFile): number {
  return (instant(a.rappelLe) ?? 0) - (instant(b.rappelLe) ?? 0) || comparerFile(a, b);
}

export function estDansFile(f: FicheFile, o: Pick<OptionsFile, "tentativesMax" | "enOpposition">): boolean {
  if (!(STATUTS_FILE as readonly string[]).includes(f.statut)) return false;
  if (o.enOpposition?.(f)) return false;
  if (f.statut === "a_appeler" && f.tentatives >= o.tentativesMax) return false;
  return true;
}

export function construireFile(fiches: readonly FicheFile[], o: OptionsFile): FileAppels {
  const vues = new Set<string>();
  const dedans: FicheFile[] = [];
  for (const f of fiches) {
    if (vues.has(f.id)) continue;
    vues.add(f.id);
    if (estDansFile(f, o)) dedans.push(f);
  }
  const appelees = o.appeleesAujourdhui ?? new Set<string>();
  const rappel = (f: FicheFile) => instant(f.rappelLe);
  const dus = dedans.filter((f) => (rappel(f) ?? Infinity) <= o.maintenant).sort(comparerRappels);
  const aVenir = dedans.filter((f) => (rappel(f) ?? -Infinity) > o.maintenant).sort(comparerRappels);
  const sansRappel = dedans.filter((f) => rappel(f) === null);
  const aAppeler = sansRappel.filter((f) => !appelees.has(f.id)).sort(comparerFile);
  const dejaAppelees = sansRappel.filter((f) => appelees.has(f.id)).sort(comparerFile);
  return { dus, aAppeler, dejaAppelees, aVenir, ordre: [...dus, ...aAppeler].map((f) => f.id) };
}

/** La fiche qui suit `courante` dans l'enchaînement (la première si `courante` n'y est pas), jamais `courante` elle-même. */
export function ficheSuivante(ordre: readonly string[], courante: string | null): string | null {
  const i = courante ? ordre.indexOf(courante) : -1;
  if (i >= 0) return ordre[i + 1] ?? ordre.find((id) => id !== courante) ?? null;
  return ordre.find((id) => id !== courante) ?? null;
}
