// Le temps du Poste : jours, heures, jours ouvrés et jours fériés, toujours dans le fuseau de la config (config.pays.fuseau) et selon son
// pays (config.pays.code). Module PUR et sans horloge cachée : « maintenant » est toujours reçu en argument (millisecondes).
// Importé par le navigateur (le Poste) comme par le serveur : aucun module Node, aucun accès au DOM.

/** Où l'on appelle : le fuseau (« Europe/Paris ») et le pays (« FR ») de la config. */
export interface Lieu {
  fuseau: string;
  pays: string;
}

export interface Parties {
  /** Le jour local, AAAA-MM-JJ. */
  jour: string;
  heure: number;
  minute: number;
}

const MINUTE = 60_000;
const JOUR_MS = 86_400_000;

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"] as const;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"] as const;

const formateurs = new Map<string, Intl.DateTimeFormat>();

function formateur(fuseau: string): Intl.DateTimeFormat {
  let f = formateurs.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      numberingSystem: "latn",
    });
    formateurs.set(fuseau, f);
  }
  return f;
}

/** Le jour, l'heure et la minute d'un instant, dans un fuseau. */
export function partiesDans(t: number, fuseau: string): Parties {
  const parties = formateur(fuseau).formatToParts(new Date(t));
  const valeur = (type: Intl.DateTimeFormatPartTypes) => parties.find((p) => p.type === type)?.value ?? "";
  return { jour: `${valeur("year")}-${valeur("month")}-${valeur("day")}`, heure: Number(valeur("hour")) % 24, minute: Number(valeur("minute")) };
}

export function jourDans(t: number, fuseau: string): string {
  return partiesDans(t, fuseau).jour;
}

function morceaux(jour: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Un jour AAAA-MM-JJ qui existe vraiment. */
export function estJourValide(jour: string): boolean {
  const p = morceaux(jour);
  if (!p) return false;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toISOString().slice(0, 10) === jour;
}

/** AAAA-MM-JJ plus n jours (calendrier pur : le changement d'heure ne compte pas). */
export function plusJours(jour: string, n: number): string {
  const p = morceaux(jour);
  if (!p) return jour;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

/** Le jour de la semaine d'un jour AAAA-MM-JJ : 0 dimanche, 1 lundi… 6 samedi. */
export function jourSemaine(jour: string): number {
  const p = morceaux(jour);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : -1;
}

/** Le nombre de jours du calendrier de a à b (positif si b est après a). */
export function ecartJours(a: string, b: string): number {
  const pa = morceaux(a);
  const pb = morceaux(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / JOUR_MS);
}

/**
 * L'instant (millisecondes) d'une heure locale un jour donné, dans un fuseau. Deux passes : la première suppose le fuseau à l'heure UTC,
 * la seconde corrige du décalage réel lu sur le résultat (heure d'hiver ou d'été). NaN si le jour est illisible.
 */
export function instantDans(jour: string, heure: number, minute: number, fuseau: string): number {
  const p = morceaux(jour);
  if (!p) return Number.NaN;
  const voulu = Date.UTC(p[0], p[1] - 1, p[2], heure, minute);
  let t = voulu;
  for (let passe = 0; passe < 2; passe++) {
    const lu = partiesDans(t, fuseau);
    const q = morceaux(lu.jour);
    if (!q) return Number.NaN;
    t += voulu - Date.UTC(q[0], q[1] - 1, q[2], lu.heure, lu.minute);
  }
  return t;
}

/** Minuit (heure locale) du jour de t : le début de « aujourd'hui » pour les compteurs. */
export function debutDuJour(t: number, fuseau: string): number {
  return instantDans(jourDans(t, fuseau), 0, 0, fuseau);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Jours fériés et jours ouvrés
// ---------------------------------------------------------------------------------------------------------------------------------

/** Le dimanche de Pâques (calendrier grégorien, algorithme de Meeus, Jones et Butcher), AAAA-MM-JJ. */
export function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

/** Le n-ième lundi d'un mois (n à partir de 1), AAAA-MM-JJ. */
function niemeLundi(annee: number, mois: number, n: number): string {
  const premier = `${annee}-${String(mois).padStart(2, "0")}-01`;
  const decalage = (8 - jourSemaine(premier)) % 7;
  return plusJours(premier, decalage + 7 * (n - 1));
}

/** Le lundi qui précède le 25 mai (Journée nationale des patriotes au Québec). */
function lundiAvant25Mai(annee: number): string {
  let j = `${annee}-05-24`;
  while (jourSemaine(j) !== 1) j = plusJours(j, -1);
  return j;
}

/**
 * Les jours fériés nationaux les plus courants d'un pays, une année donnée. Connus : FR (métropole), BE, LU, MC, CH (les plus répandus :
 * ils varient selon le canton) et CA (Québec, la province francophone). Pour un autre pays : aucun (seuls le samedi et le dimanche sont
 * chômés).
 */
export function joursFeries(annee: number, pays: string): string[] {
  const fixe = (md: string) => `${annee}-${md}`;
  const p = paques(annee);
  const relatif = (n: number) => plusJours(p, n);
  let liste: string[];
  switch (pays.toUpperCase()) {
    case "FR":
      liste = [fixe("01-01"), relatif(1), fixe("05-01"), fixe("05-08"), relatif(39), relatif(50), fixe("07-14"), fixe("08-15"), fixe("11-01"), fixe("11-11"), fixe("12-25")];
      break;
    case "BE":
      liste = [fixe("01-01"), relatif(1), fixe("05-01"), relatif(39), relatif(50), fixe("07-21"), fixe("08-15"), fixe("11-01"), fixe("11-11"), fixe("12-25")];
      break;
    case "LU":
      liste = [fixe("01-01"), relatif(1), fixe("05-01"), fixe("05-09"), relatif(39), relatif(50), fixe("06-23"), fixe("08-15"), fixe("11-01"), fixe("12-25"), fixe("12-26")];
      break;
    case "MC":
      liste = [fixe("01-01"), fixe("01-27"), relatif(1), fixe("05-01"), relatif(39), relatif(50), relatif(60), fixe("08-15"), fixe("11-01"), fixe("11-19"), fixe("12-08"), fixe("12-25")];
      break;
    case "CH":
      liste = [fixe("01-01"), relatif(-2), relatif(1), relatif(39), relatif(50), fixe("08-01"), fixe("12-25"), fixe("12-26")];
      break;
    case "CA":
      liste = [fixe("01-01"), relatif(-2), lundiAvant25Mai(annee), fixe("06-24"), fixe("07-01"), niemeLundi(annee, 9, 1), niemeLundi(annee, 10, 2), fixe("12-25")];
      break;
    default:
      liste = [];
  }
  return [...new Set(liste)].sort();
}

const feriesEnCache = new Map<string, Set<string>>();

function feries(annee: number, pays: string): Set<string> {
  const cle = `${pays.toUpperCase()}:${annee}`;
  let s = feriesEnCache.get(cle);
  if (!s) {
    s = new Set(joursFeries(annee, pays));
    feriesEnCache.set(cle, s);
  }
  return s;
}

/** Un jour ouvré : du lundi au vendredi, et pas un jour férié du pays. */
export function estJourOuvre(jour: string, pays: string): boolean {
  const p = morceaux(jour);
  if (!p || !estJourValide(jour)) return false;
  const js = jourSemaine(jour);
  return js !== 0 && js !== 6 && !feries(p[0], pays).has(jour);
}

/** Le premier jour ouvré strictement APRÈS ce jour. */
export function jourOuvreSuivant(jour: string, pays: string): string {
  let j = plusJours(jour, 1);
  for (let garde = 0; garde < 30 && !estJourOuvre(j, pays); garde++) j = plusJours(j, 1);
  return j;
}

/** Ce jour s'il est ouvré, sinon le premier jour ouvré qui suit. */
export function jourOuvreAPartirDe(jour: string, pays: string): string {
  return estJourOuvre(jour, pays) ? jour : jourOuvreSuivant(jour, pays);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Libellés (français, sans tiret cadratin)
// ---------------------------------------------------------------------------------------------------------------------------------

export function majuscule(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** « 9 h », « 9 h 30 », « 14 h 05 ». */
export function libelleHeure(t: number, fuseau: string): string {
  const { heure, minute } = partiesDans(t, fuseau);
  return minute === 0 ? `${heure} h` : `${heure} h ${String(minute).padStart(2, "0")}`;
}

/** « jeudi 19 novembre » pour un jour AAAA-MM-JJ. */
export function jourLong(jour: string): string {
  const p = morceaux(jour);
  if (!p) return jour;
  return `${JOURS[jourSemaine(jour)]} ${p[2]} ${MOIS[p[1] - 1]}`;
}

/** « aujourd'hui », « demain », « hier », « jeudi » (dans la semaine qui vient), sinon « jeudi 19 novembre ». */
export function libelleJour(t: number, maintenant: number, fuseau: string): string {
  const jour = jourDans(t, fuseau);
  const ecart = ecartJours(jourDans(maintenant, fuseau), jour);
  if (ecart === 0) return "aujourd'hui";
  if (ecart === 1) return "demain";
  if (ecart === -1) return "hier";
  if (ecart > 1 && ecart < 7) return JOURS[jourSemaine(jour)];
  return jourLong(jour);
}

/** « demain 9 h 30 », « jeudi 19 novembre 14 h ». */
export function libelleJourHeure(t: number, maintenant: number, fuseau: string): string {
  return `${libelleJour(t, maintenant, fuseau)} ${libelleHeure(t, fuseau)}`;
}

/** « jeudi 19 novembre 2026, 9 h 30 » : une date complète, sans ambiguïté. */
export function dateHeureLongue(t: number, fuseau: string): string {
  const jour = jourDans(t, fuseau);
  return `${jourLong(jour)} ${jour.slice(0, 4)}, ${libelleHeure(t, fuseau)}`;
}

/** Les valeurs d'un champ date (AAAA-MM-JJ) et d'un champ heure (HH:MM) pour un instant, dans le fuseau. */
export function versChampsLocaux(t: number, fuseau: string): { date: string; heure: string } {
  const p = partiesDans(t, fuseau);
  return { date: p.jour, heure: `${String(p.heure).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` };
}

/** L'instant d'une date (AAAA-MM-JJ) et d'une heure (HH:MM) saisies, lues dans le fuseau ; null si l'une est illisible. */
export function depuisChampsLocaux(date: string, heure: string, fuseau: string): number | null {
  const d = (date ?? "").trim();
  const h = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((heure ?? "").trim());
  if (!estJourValide(d) || !h) return null;
  const t = instantDans(d, Number(h[1]), Number(h[2]), fuseau);
  return Number.isFinite(t) ? t : null;
}

/** Arrondi à la minute suivante multiple de `pas` (5 par défaut) : « dans 1 h » tombe sur une heure ronde. */
export function arrondiMinutes(t: number, pas = 5): number {
  const p = pas * MINUTE;
  return Math.ceil(t / p) * p;
}
