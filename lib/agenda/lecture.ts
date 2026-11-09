// Lecture TOLÉRANTE des corps de webhook et des réponses d'API (Calendly, iClosed, Google) : chaque valeur est vérifiée et bornée ; une
// valeur douteuse devient null (rien n'est inventé). Module PUR : aucun module Node, aucun réseau, aucun journal.

import { objet, texte } from "../integrations/base";

/** La valeur au bout d'un chemin pointé (« event.uuid ») ; undefined si un maillon manque. */
export function chemin(racine: unknown, cheminPointe: string): unknown {
  let courant: unknown = racine;
  for (const cle of cheminPointe.split(".")) {
    if (courant === null || typeof courant !== "object" || Array.isArray(courant)) return undefined;
    courant = (courant as Record<string, unknown>)[cle];
  }
  return courant;
}

/** Un texte utile : une chaîne (ou un nombre) non vide et bornée ; « null », « undefined » et « none » écrits en toutes lettres ne comptent pas. */
export function chaine(v: unknown, max = 200): string | null {
  const t = texte(typeof v === "number" && Number.isFinite(v) ? String(v) : v, max);
  return t && !/^(null|undefined|none)$/i.test(t) ? t : null;
}

const RE_EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[A-Za-z]{2,24}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_ID_EXTERNE = /^[A-Za-z0-9_.:-]+$/;

/** Une adresse e-mail plausible, en minuscules, ou null. */
export function emailOuNull(v: unknown): string | null {
  const t = chaine(v, 254);
  return t && RE_EMAIL.test(t) ? t.toLowerCase() : null;
}

/** Un numéro de téléphone tel qu'écrit (chiffres, espaces, points, tirets, parenthèses, « + » en tête), 6 chiffres au moins, ou null. */
export function telephoneOuNull(v: unknown): string | null {
  const t = chaine(v, 40);
  if (!t || !/^\+?[\d\s.()/-]{6,30}$/.test(t)) return null;
  return t.replace(/\D/g, "").length >= 6 ? t.replace(/\s+/g, " ") : null;
}

export function uuidOuNull(v: unknown): string | null {
  const t = chaine(v, 36);
  return t && RE_UUID.test(t) ? t.toLowerCase() : null;
}

/** Une date lisible (ISO 8601, ou un nombre de millisecondes), ramenée en ISO UTC, entre 2000 et 2100 ; sinon null. */
export function isoOuNull(v: unknown): string | null {
  let t: number;
  if (typeof v === "number") t = v;
  else {
    const s = chaine(v, 40);
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    t = Date.parse(s);
  }
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const annee = d.getUTCFullYear();
  return annee >= 2000 && annee < 2100 ? d.toISOString() : null;
}

/** Un lien https:// sans espace, borné, ou null. */
export function lienHttpsOuNull(v: unknown, max = 300): string | null {
  const t = chaine(v, max);
  if (!t || !/^https:\/\/[^\s/?#]+\.[^\s]+$/i.test(t)) return null;
  try {
    return new URL(t).protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}

/** Un identifiant acceptable par la base (^[A-Za-z0-9_.:-]{1,max}$), ou null. */
export function idExterneOuNull(v: unknown, max = 120): string | null {
  const t = chaine(v, max);
  return t && RE_ID_EXTERNE.test(t) ? t : null;
}

/** Le segment d'URI qui suit `apres` (« /scheduled_events/<uuid>/… » → l'uuid), sinon le dernier segment ; null s'il est illisible. */
export function segmentUri(uri: unknown, apres?: string): string | null {
  const t = chaine(uri, 500);
  if (!t) return null;
  let segments: string[];
  try {
    segments = new URL(t).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  let segment: string | undefined;
  if (apres) {
    const i = segments.indexOf(apres);
    segment = i >= 0 ? segments[i + 1] : undefined;
  } else {
    segment = segments.at(-1);
  }
  return segment && /^[A-Za-z0-9_-]{1,80}$/.test(segment) ? segment : null;
}

/**
 * Une empreinte courte et STABLE d'un texte (cyrb53, 53 bits, 14 caractères hexadécimaux). Pas de la cryptographie : elle sert à
 * fabriquer un identifiant d'événement déterministe (idempotence), de façon synchrone.
 */
export function empreinteCourte(texteSource: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texteSource.length; i++) {
    const c = texteSource.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

/** Un identifiant externe : tel quel s'il est acceptable et assez court, sinon « h-<empreinte> » (toujours le même pour la même entrée). */
export function idExterneCourt(v: string, max = 80): string {
  return v.length <= max && RE_ID_EXTERNE.test(v) ? v : `h-${empreinteCourte(v)}`;
}

/** Les éléments d'un tableau (au plus `max`), sinon un tableau vide. */
export function liste(v: unknown, max = 50): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : [];
}

export { objet };
