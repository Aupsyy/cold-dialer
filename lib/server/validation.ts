// La validation des entrées des actions serveur. On ne fait JAMAIS confiance à ce qu'envoie le navigateur : tout est revérifié ici.
// Une ErreurSaisie porte un message lisible, montré tel quel. Module PUR.

export class ErreurSaisie extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurSaisie";
  }
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_COURT = 200;
export const MAX_URL = 2000;
export const MAX_NOTE = 5000;

/** Chaîne nettoyée ; vide ou absente : null ; trop longue : erreur. */
export function texte(valeur: unknown, libelle: string, max: number = MAX_COURT): string | null {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur !== "string") throw new ErreurSaisie(`${libelle} : valeur invalide.`);
  const t = valeur.trim();
  if (t === "") return null;
  if (t.length > max) throw new ErreurSaisie(`${libelle} : ${max} caractères au plus.`);
  return t;
}

export function texteObligatoire(valeur: unknown, libelle: string, max: number = MAX_COURT): string {
  const t = texte(valeur, libelle, max);
  if (!t) throw new ErreurSaisie(`${libelle} est obligatoire.`);
  return t;
}

export function uuid(valeur: unknown, libelle: string): string | null {
  const t = texte(valeur, libelle, 64);
  if (t === null) return null;
  if (!RE_UUID.test(t)) throw new ErreurSaisie(`${libelle} : identifiant invalide.`);
  return t.toLowerCase();
}

export function uuidObligatoire(valeur: unknown, libelle: string): string {
  const t = uuid(valeur, libelle);
  if (!t) throw new ErreurSaisie(`${libelle} est obligatoire.`);
  return t;
}

/** Date AAAA-MM-JJ qui existe vraiment, ou null. */
export function date(valeur: unknown, libelle: string): string | null {
  const t = texte(valeur, libelle, 10);
  if (t === null) return null;
  const d = new Date(`${t}T00:00:00Z`);
  if (!RE_DATE.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
    throw new ErreurSaisie(`${libelle} : date invalide.`);
  }
  return t;
}

/** Date et heure lisibles (un rappel, un rendez-vous) : renvoyée en ISO UTC, ou null. */
export function dateHeure(valeur: unknown, libelle: string): string | null {
  const t = texte(valeur, libelle, 40);
  if (t === null) return null;
  const d = new Date(t);
  const annee = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || annee < 2000 || annee > 2100) throw new ErreurSaisie(`${libelle} : date ou heure invalide.`);
  return d.toISOString();
}

export function entier(valeur: unknown, libelle: string, min: number, max: number): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  if (typeof valeur !== "number" || !Number.isInteger(valeur) || valeur < min || valeur > max) {
    throw new ErreurSaisie(`${libelle} doit être un entier entre ${min} et ${max}.`);
  }
  return valeur;
}

/** Un lien https:// sans espace, ou null. */
export function lienHttps(valeur: unknown, libelle: string): string | null {
  const t = texte(valeur, libelle, MAX_URL);
  if (t === null) return null;
  if (!/^https:\/\/\S+$/i.test(t)) throw new ErreurSaisie(`${libelle} doit commencer par https://.`);
  return t;
}

export function email(valeur: unknown, libelle: string): string | null {
  const t = texte(valeur, libelle, 254);
  if (t === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new ErreurSaisie(`${libelle} : adresse invalide.`);
  return t.toLowerCase();
}

/** Une valeur choisie dans une liste fermée (ou null si permis). */
export function parmi<T extends string>(valeur: unknown, permis: readonly T[], libelle: string, facultatif = true): T | null {
  if (valeur === null || valeur === undefined || valeur === "") {
    if (facultatif) return null;
    throw new ErreurSaisie(`${libelle} est obligatoire.`);
  }
  if (typeof valeur !== "string" || !(permis as readonly string[]).includes(valeur)) {
    throw new ErreurSaisie(`${libelle} : valeur non autorisée.`);
  }
  return valeur as T;
}
