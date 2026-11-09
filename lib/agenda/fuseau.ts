// Le calendrier dans le fuseau de l'équipe (config.pays.fuseau) : jamais l'heure de l'appareil ni celle du serveur (UTC sur Vercel).
// Un « jour » est une clé « AAAA-MM-JJ » dans ce fuseau ; ses bornes en UTC tiennent compte des changements d'heure (un jour de 23 h
// ou de 25 h). Module PUR (Intl seulement), importable partout.

export const FUSEAU_PAR_DEFAUT = "Europe/Paris";

const RE_CLE_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const JOUR_MS = 86_400_000;

const formateurs = new Map<string, Intl.DateTimeFormat>();

function formateur(fuseau: string): Intl.DateTimeFormat {
  let f = formateurs.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formateurs.set(fuseau, f);
  }
  return f;
}

/** Le fuseau s'il est connu d'Intl (« Europe/Paris »), sinon null. */
export function fuseauValide(v: unknown): string | null {
  if (typeof v !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(v)) return null;
  try {
    formateur(v);
    return v;
  } catch {
    return null;
  }
}

export interface PartiesLocales {
  annee: number;
  mois: number;
  jour: number;
  heure: number;
  minute: number;
  seconde: number;
}

/** L'heure « murale » d'un instant dans un fuseau. */
export function partiesLocales(instantMs: number, fuseau: string): PartiesLocales {
  const parts = formateur(fuseau).formatToParts(new Date(instantMs));
  const v = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { annee: v("year"), mois: v("month"), jour: v("day"), heure: v("hour") % 24, minute: v("minute"), seconde: v("second") };
}

/** Le décalage du fuseau à cet instant, en millisecondes (heure locale moins UTC : +3 600 000 à Paris en hiver). */
export function decalageMs(instantMs: number, fuseau: string): number {
  const p = partiesLocales(instantMs, fuseau);
  const local = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde);
  return local - Math.floor(instantMs / 1000) * 1000;
}

/**
 * L'instant (ms) d'une heure murale dans un fuseau. Une heure qui n'existe pas (passage à l'heure d'été : 02:30 à Paris le dernier
 * dimanche de mars) avance d'autant ; une heure qui existe deux fois (retour à l'heure d'hiver) prend l'une des deux, sans erreur.
 */
export function heureMuraleVersMs(an: number, mois: number, jour: number, h: number, mi: number, s: number, fuseau: string): number {
  const brut = Date.UTC(an, mois - 1, jour, h, mi, s);
  let t = brut - decalageMs(brut, fuseau);
  t = brut - decalageMs(t, fuseau);
  return t;
}

/** Vrai pour une clé de jour « AAAA-MM-JJ » qui existe vraiment. */
export function estCleJour(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = RE_CLE_JOUR.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function lireCle(cle: string): [number, number, number] {
  const m = RE_CLE_JOUR.exec(cle);
  if (!m) throw new Error("Clé de jour invalide.");
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cleDepuisUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Le jour (« AAAA-MM-JJ ») d'un instant dans le fuseau. */
export function cleJour(instantMs: number, fuseau: string): string {
  const p = partiesLocales(instantMs, fuseau);
  return cleDepuisUtc(Date.UTC(p.annee, p.mois - 1, p.jour));
}

/** Le jour décalé de n jours (pur calendrier : les changements d'heure n'y changent rien). */
export function decalerJour(cle: string, n: number): string {
  const [a, m, j] = lireCle(cle);
  return cleDepuisUtc(Date.UTC(a, m - 1, j + n));
}

/** Le jour de la semaine : 1 = lundi … 7 = dimanche. */
export function jourSemaine(cle: string): number {
  const [a, m, j] = lireCle(cle);
  const d = new Date(Date.UTC(a, m - 1, j)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Le lundi de la semaine de ce jour. */
export function lundiDe(cle: string): string {
  return decalerJour(cle, 1 - jourSemaine(cle));
}

/** L'instant (ms) où commence ce jour dans le fuseau (minuit, ou la première heure qui existe). */
export function debutJourMs(cle: string, fuseau: string): number {
  const [a, m, j] = lireCle(cle);
  return heureMuraleVersMs(a, m, j, 0, 0, 0, fuseau);
}

/** La durée réelle d'un jour dans le fuseau, en heures (23, 24 ou 25). */
export function heuresDuJour(cle: string, fuseau: string): number {
  return (debutJourMs(decalerJour(cle, 1), fuseau) - debutJourMs(cle, fuseau)) / 3_600_000;
}

/**
 * L'instant ISO (UTC) d'un jour et d'une heure « HH:MM » saisis dans le fuseau ; null si la saisie est illisible. `decale` : vrai si
 * l'heure n'existait pas ce jour-là (passage à l'heure d'été) et a été avancée.
 */
export function instantLocal(cle: string, heure: string, fuseau: string): { iso: string; decale: boolean } | null {
  if (!estCleJour(cle)) return null;
  const h = RE_HEURE.exec(heure);
  if (!h) return null;
  const [a, m, j] = lireCle(cle);
  const ms = heureMuraleVersMs(a, m, j, Number(h[1]), Number(h[2]), 0, fuseau);
  const p = partiesLocales(ms, fuseau);
  const decale = p.heure !== Number(h[1]) || p.minute !== Number(h[2]) || cleJour(ms, fuseau) !== cle;
  return { iso: new Date(ms).toISOString(), decale };
}

/** « 09:30 » : l'heure d'un instant dans le fuseau. */
export function heureLocale(instant: string | number, fuseau: string): string {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) return "";
  const p = partiesLocales(ms, fuseau);
  return `${String(p.heure).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

const formatJour = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const formatJourCourt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" });
const formatJourAnnee = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

function midiUtc(cle: string): Date {
  const [a, m, j] = lireCle(cle);
  return new Date(Date.UTC(a, m - 1, j, 12));
}

/** « lundi 9 novembre » */
export function libelleJour(cle: string): string {
  return formatJour.format(midiUtc(cle));
}

/** « 9 novembre 2026 » */
export function libelleDate(cle: string): string {
  return formatJourAnnee.format(midiUtc(cle));
}

/** « du 9 au 15 novembre 2026 », « du 30 novembre au 6 décembre 2026 » */
export function libelleSemaine(lundi: string): string {
  const dimanche = decalerJour(lundi, 6);
  const memeMois = lundi.slice(0, 7) === dimanche.slice(0, 7);
  const debut = memeMois ? String(Number(lundi.slice(8, 10))) : formatJourCourt.format(midiUtc(lundi));
  return `du ${debut} au ${libelleDate(dimanche)}`;
}

/** Le nombre de jours entiers entre deux clés (b moins a). */
export function ecartJours(a: string, b: string): number {
  const [aa, am, aj] = lireCle(a);
  const [ba, bm, bj] = lireCle(b);
  return Math.round((Date.UTC(ba, bm - 1, bj) - Date.UTC(aa, am - 1, aj)) / JOUR_MS);
}
