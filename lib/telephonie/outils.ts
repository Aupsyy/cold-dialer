// Les petits outils PURS des adaptateurs de téléphonie : lecture tolérante d'un corps de webhook, corps borné, JSON, secrets. Aucun
// réseau, aucune base, aucun DOM, aucun module Node : ce fichier est lu par le navigateur (le Poste), par next.config.ts (au build) et
// par les routes serveur. Tout champ absent ou illisible devient null : rien n'est inventé. Le journal ne reçoit jamais une valeur lue
// ici (numéro, e-mail, URL, secret) : seulement des codes.

import { egalTempsConstant, objet, texte, valeurEnv, type Env } from "../integrations/base";

export { objet, texte };

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture tolérante
// ---------------------------------------------------------------------------------------------------------------------------------

/** La forme d'un identifiant d'appel acceptée par la base (appels.externe_id). */
export const RE_EXTERNE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Un identifiant d'appel chez le fournisseur (nombre entier ou texte), en texte ; null s'il n'a pas la forme attendue. */
export function idExterne(v: unknown): string | null {
  const t = typeof v === "number" ? (Number.isSafeInteger(v) && v >= 0 ? String(v) : null) : texte(v, 80);
  return t !== null && RE_EXTERNE_ID.test(t) ? t : null;
}

/** Un nombre (ou un texte de chiffres) arrondi à l'entier et borné, sinon null. */
export function entierBorne(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d{1,12}(\.\d{1,9})?$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const e = Math.round(n);
  return e >= min && e <= max ? e : null;
}

const DEBUT_2000 = Date.UTC(2000, 0, 1);
const FIN_2100 = Date.UTC(2100, 0, 1);
const RE_ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/i;

/**
 * Une date lue dans un corps : ISO 8601 (sans fuseau = UTC), ou des secondes Unix (éventuellement décimales), ou des millisecondes ;
 * renvoyée en ISO UTC si elle tombe entre 2000 et 2100, sinon null (la base applique la même borne).
 */
export function isoOuNull(v: unknown): string | null {
  let ms = Number.NaN;
  if (typeof v === "number") {
    if (Number.isFinite(v) && v > 0) ms = v > 1e12 ? v : v * 1000;
  } else if (typeof v === "string") {
    const t = v.trim();
    if (t.length > 0 && t.length <= 40) {
      if (/^\d{9,13}(\.\d{1,9})?$/.test(t)) {
        const n = Number(t);
        ms = n > 1e12 ? n : n * 1000;
      } else if (RE_ISO.test(t)) {
        const avecHeure = /[T ]\d{2}:/.test(t);
        const sansFuseau = !/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(t);
        ms = Date.parse(`${t.replace(" ", "T")}${avecHeure && sansFuseau ? "Z" : ""}`);
      }
    }
  }
  if (!Number.isFinite(ms) || ms < DEBUT_2000 || ms > FIN_2100) return null;
  return new Date(Math.round(ms)).toISOString();
}

const RE_EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,24}$/i;

/** Un e-mail lisible, en minuscules ; sinon null. */
export function emailOuNull(v: unknown): string | null {
  const t = texte(v, 254);
  return t !== null && RE_EMAIL.test(t) ? t.toLowerCase() : null;
}

/** Une adresse https:// bien formée (jamais http://, jamais un autre protocole) ; sinon null. */
export function urlHttps(v: unknown): string | null {
  const t = texte(v, 4000);
  if (t === null || !/^https:\/\/[^\s"'<>\\]+$/i.test(t)) return null;
  try {
    return new URL(t).protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}

/** Un code court et sûr pour le journal (lettres, chiffres, tirets bas) ; sinon le repli. Jamais une donnée lue telle quelle. */
export function codeSur(v: unknown, repli: string): string {
  return typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : repli;
}

/** Un texte de transcription : espaces resserrés, borné. */
export function nettoyerTexte(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** « 00:01:05 », « 01:05 », « 65 » ou 65 -> des secondes (65) ; null si illisible. */
export function secondesDepuis(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v < 86_400 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(t);
  if (m) return (Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
  if (/^\d{1,5}(\.\d{1,3})?$/.test(t)) return Number(t);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Corps reçus : lecture bornée, JSON
// ---------------------------------------------------------------------------------------------------------------------------------

/** Lit un flux sans jamais garder plus de `max` octets : « trop_gros » dès qu'on dépasse (le reste n'est pas lu). */
export async function lireFluxBorne(flux: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | "trop_gros" | "illisible"> {
  if (!flux) return new Uint8Array(0);
  const lecteur = flux.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lecteur.cancel().catch(() => undefined);
        return "trop_gros";
      }
      morceaux.push(value);
    }
  } catch {
    return "illisible";
  }
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const m of morceaux) {
    sortie.set(m, position);
    position += m.byteLength;
  }
  return sortie;
}

/**
 * Le JSON d'un corps (UTF-8 strict), ou undefined s'il est illisible. Un entier trop grand pour JavaScript (au-delà de 2^53, certains
 * identifiants d'appel) est gardé en TEXTE, chiffre pour chiffre, au lieu d'être arrondi (lecture de la source par le reviver).
 */
export function analyserJson(corps: Uint8Array): unknown {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(corps);
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(source, (_cle: string, valeur: unknown, contexte?: { source?: string }) =>
      typeof valeur === "number" &&
      Number.isInteger(valeur) &&
      !Number.isSafeInteger(valeur) &&
      typeof contexte?.source === "string" &&
      /^-?\d{1,40}$/.test(contexte.source)
        ? contexte.source
        : valeur,
    );
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Secrets des webhooks
// ---------------------------------------------------------------------------------------------------------------------------------

/** La longueur minimale de chaque secret de webhook : en dessous, la route répond 503 (configuration à refaire), sans rien lire. */
export const LONGUEURS_MIN_SECRETS: Readonly<Record<string, number>> = {
  ONOFF_WEBHOOK_TOKEN: 16,
  AIRCALL_WEBHOOK_TOKEN: 16,
  RINGOVER_WEBHOOK_SECRET: 24,
  CRON_SECRET: 16,
};

/** Les NOMS des secrets présents mais trop courts (jamais leur valeur). */
export function secretsTropCourts(env: Env, noms: readonly string[]): string[] {
  return noms.filter((n) => {
    const v = valeurEnv(env, n);
    const min = LONGUEURS_MIN_SECRETS[n] ?? 0;
    return v !== "" && v.length < min;
  });
}

/** Vrai si `recu` est exactement le secret de la variable `nom` (comparaison en temps constant ; un secret trop court ne vaut rien). */
export function secretEgal(recu: unknown, env: Env, nom: string): boolean {
  const attendu = valeurEnv(env, nom);
  if (attendu === "" || attendu.length < (LONGUEURS_MIN_SECRETS[nom] ?? 1)) return false;
  if (typeof recu !== "string") return false;
  const r = recu.trim();
  return r !== "" && egalTempsConstant(r, attendu);
}
