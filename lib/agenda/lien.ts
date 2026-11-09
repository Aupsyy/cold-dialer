// Le lien de réservation pré-rempli (Calendly, iClosed) : le lien public de config.agenda.lienReservation, plus ce que l'on sait de la
// fiche. Rien n'est inventé : un champ inconnu reste à saisir par le prospect. Encodage strict (encodeURIComponent : une espace devient
// %20, jamais « + »). Tourne dans le navigateur comme sur le serveur ; n'écrit jamais rien dans un journal.

import { uuidOuNull } from "./lecture";
import type { ConfigAgenda, LeadPourLien } from "./types";

const RE_EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[A-Za-z]{2,24}$/;

/** Le lien public de base : https, sans espace ; sinon null. */
export function lienBase(v: unknown): URL | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 500 || /\s/.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" && u.hostname.includes(".") ? u : null;
  } catch {
    return null;
  }
}

/** Le lien de base, avec ces paramètres (ceux qui existaient déjà sous le même nom sont remplacés) ; null si la base est illisible. */
export function lienAvecParametres(base: unknown, parametres: readonly (readonly [string, string | null])[]): string | null {
  const u = lienBase(base);
  if (!u) return null;
  const aPoser = parametres.filter((p): p is readonly [string, string] => typeof p[1] === "string" && p[1] !== "");
  for (const [cle] of aPoser) u.searchParams.delete(cle);
  for (const [cle, valeur] of aPoser) u.searchParams.append(cle, valeur);
  // URLSearchParams écrit une espace « + » et un « + » véritable « %2B » : remplacer les « + » par %20 ne touche que les espaces.
  u.search = u.searchParams.toString().replace(/\+/g, "%20");
  return u.toString();
}

/** Le nom de la personne à pré-remplir : le dirigeant de la fiche (jamais le nom de l'entreprise), espaces réduits, 120 caractères au plus. */
export function nomPourLien(lead: LeadPourLien): string | null {
  const nom = (lead.dirigeant ?? "").replace(/\s+/g, " ").trim();
  return nom && nom.length <= 120 ? nom : null;
}

export function emailPourLien(lead: LeadPourLien): string | null {
  const e = (lead.email ?? "").trim();
  return RE_EMAIL.test(e) ? e.toLowerCase() : null;
}

/** Le téléphone au format international (« +33199000101 ») seulement : un numéro national est laissé à saisir (le pays serait deviné). */
export function telephonePourLien(lead: LeadPourLien): string | null {
  const brut = (lead.telephone ?? "").trim();
  if (!brut) return null;
  const compact = brut.replace(/[\s.()/-]/g, "").replace(/^00(?=[1-9])/, "+");
  return /^\+[1-9]\d{5,14}$/.test(compact) ? compact : null;
}

/** L'identifiant de la fiche (uuid) à glisser dans le lien (utm_content), ou null. */
export function identifiantPourLien(lead: LeadPourLien): string | null {
  return uuidOuNull(lead.id);
}

/** Le lien sans pré-remplissage (prefill: false) : le lien public tel quel, s'il est valide. */
export function lienNu(config: ConfigAgenda): string | null {
  return lienBase(config.lienReservation)?.toString() ?? null;
}
