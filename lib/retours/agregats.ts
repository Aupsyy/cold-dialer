// Les agrégats des retours du marché (page /retours, skill ajuster-script).
//   - lireAgregats : la réponse de la fonction SQL retours_marche_agreger (0001), lue sans jamais planter sur une forme inattendue ;
//   - agregerLignes : le MÊME calcul en TypeScript sur des lignes de retours_marche lues sous la RLS (filtre par appelant d'un
//     gestionnaire, que la fonction SQL ne propose pas) ; tests/retours-agregats.test.mjs vérifie l'égalité avec la base ;
//   - repartitionIssues : le nombre de retours par issue (la fonction SQL ne compte que les rendez-vous).
// Module PUR : ni base, ni horloge.

import { estVerdictBase, type VerdictBase } from "./libelles";

export interface CompteCode {
  code: string;
  n: number;
}

export interface CompteTag {
  tag: string;
  n: number;
}

export interface TexteDate {
  texte: string;
  /** Date ISO de l'appel. */
  le: string;
}

export interface Agregats {
  total: number;
  decideurs: number;
  rdv: number;
  /** Arrondi à deux décimales ; null si aucun intérêt noté. */
  interetMoyen: number | null;
  objections: CompteCode[];
  verdicts: Record<VerdictBase, number>;
  tags: CompteTag[];
  /** Les 20 plus récentes, mot pour mot. */
  citations: TexteDate[];
  douleurs: TexteDate[];
}

export const MAX_TEXTES = 20;

export function agregatsVides(): Agregats {
  return {
    total: 0,
    decideurs: 0,
    rdv: 0,
    interetMoyen: null,
    objections: [],
    verdicts: { accroche: 0, neutre: 0, rejet: 0 },
    tags: [],
    citations: [],
    douleurs: [],
  };
}

const objetOuVide = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const tableau = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x));
const compte = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const chaine = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function textesDates(v: unknown): TexteDate[] {
  return tableau(v)
    .map((x) => ({ texte: chaine(x.texte), le: chaine(x.le) }))
    .filter((x): x is TexteDate => x.texte !== null && x.le !== null)
    .slice(0, MAX_TEXTES);
}

/** La réponse de retours_marche_agreger (jsonb), normalisée. Une valeur absente ou illisible compte pour zéro (ou liste vide). */
export function lireAgregats(brut: unknown): Agregats {
  const o = objetOuVide(brut);
  const v = objetOuVide(o.verdicts);
  const moyen = o.interetMoyen === null || o.interetMoyen === undefined ? NaN : Number(o.interetMoyen);
  return {
    total: compte(o.total),
    decideurs: compte(o.decideurs),
    rdv: compte(o.rdv),
    interetMoyen: Number.isFinite(moyen) ? Math.round(moyen * 100) / 100 : null,
    objections: tableau(o.objections)
      .map((x) => ({ code: chaine(x.code) ?? "", n: compte(x.n) }))
      .filter((x) => x.code !== "" && x.n > 0),
    verdicts: { accroche: compte(v.accroche), neutre: compte(v.neutre), rejet: compte(v.rejet) },
    tags: tableau(o.tags)
      .map((x) => ({ tag: chaine(x.tag) ?? "", n: compte(x.n) }))
      .filter((x) => x.tag !== "" && x.n > 0),
    citations: textesDates(o.citations),
    douleurs: textesDates(o.douleurs),
  };
}

/** Une ligne de retours_marche, telle que la page la lit (colonnes utiles aux agrégats). */
export interface LigneRetour {
  appel_le: string;
  issue: string | null;
  objection_code: string | null;
  accroche_verdict: VerdictBase | null;
  interet: number | null;
  decideur_joint: boolean;
  citation: string | null;
  douleur: string | null;
  tags: string[];
}

/** Une ligne lue de la base (forme inconnue) ; null si elle n'a pas de date d'appel lisible. */
export function lireLigneRetour(brut: unknown): LigneRetour | null {
  const o = objetOuVide(brut);
  const le = chaine(o.appel_le);
  if (!le || Number.isNaN(new Date(le).getTime())) return null;
  const interet = typeof o.interet === "number" && Number.isInteger(o.interet) && o.interet >= 0 && o.interet <= 3 ? o.interet : null;
  return {
    appel_le: le,
    issue: chaine(o.issue),
    objection_code: chaine(o.objection_code),
    accroche_verdict: estVerdictBase(o.accroche_verdict) ? o.accroche_verdict : null,
    interet,
    decideur_joint: o.decideur_joint === true,
    citation: typeof o.citation === "string" ? o.citation : null,
    douleur: typeof o.douleur === "string" ? o.douleur : null,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string" && t !== "") : [],
  };
}

/** Comparaison par points de code (l'ordre de la base pour des codes en minuscules ASCII). */
function comparer(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compter<T extends string>(valeurs: Iterable<T>): Map<T, number> {
  const m = new Map<T, number>();
  for (const v of valeurs) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

/** La moyenne arrondie à deux décimales, au plus proche (moitié vers le haut), en arithmétique entière : comme round(avg(), 2). */
export function moyenneArrondie(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const somme = valeurs.reduce((s, x) => s + x, 0);
  const n = valeurs.length;
  return Math.floor((200 * somme + n) / (2 * n)) / 100;
}

function recents(lignes: readonly LigneRetour[], champ: "citation" | "douleur"): TexteDate[] {
  return lignes
    .filter((l) => (l[champ] ?? "").trim() !== "")
    .map((l, i) => ({ texte: l[champ] as string, le: l.appel_le, i, t: new Date(l.appel_le).getTime() }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .slice(0, MAX_TEXTES)
    .map(({ texte, le }) => ({ texte, le }));
}

/** Les agrégats calculés sur des lignes (même résultat que retours_marche_agreger sur les mêmes lignes). */
export function agregerLignes(lignes: readonly LigneRetour[]): Agregats {
  const interets = lignes.flatMap((l) => (l.interet === null ? [] : [l.interet]));
  const objections = [...compter(lignes.flatMap((l) => (l.objection_code ? [l.objection_code] : [])))]
    .map(([code, n]) => ({ code, n }))
    .sort((a, b) => b.n - a.n || comparer(a.code, b.code));
  const tags = [...compter(lignes.flatMap((l) => l.tags))].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || comparer(a.tag, b.tag));
  const verdicts = { accroche: 0, neutre: 0, rejet: 0 };
  for (const l of lignes) if (l.accroche_verdict) verdicts[l.accroche_verdict] += 1;
  return {
    total: lignes.length,
    decideurs: lignes.filter((l) => l.decideur_joint).length,
    rdv: lignes.filter((l) => l.issue === "rdv_fixe").length,
    interetMoyen: moyenneArrondie(interets),
    objections,
    verdicts,
    tags,
    citations: recents(lignes, "citation"),
    douleurs: recents(lignes, "douleur"),
  };
}

export interface CompteIssue {
  /** null : retour noté sans issue. */
  code: string | null;
  n: number;
}

/** Le nombre de retours par issue, de la plus fréquente à la moins fréquente (« sans issue » en dernier à égalité). */
export function repartitionIssues(issues: readonly (string | null)[]): CompteIssue[] {
  return [...compter(issues.map((i) => i ?? ""))]
    .map(([code, n]) => ({ code: code === "" ? null : code, n }))
    .sort((a, b) => b.n - a.n || (a.code === null ? 1 : b.code === null ? -1 : comparer(a.code, b.code)));
}
