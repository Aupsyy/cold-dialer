// Les messages d'erreur du Poste et des prospects, par code d'erreur de la base (jamais le détail brut, qui peut citer une valeur).
// Module PUR.

import { messageDepuisCode } from "@/lib/server/contexte";

export const ERR_DOUBLON_PROSPECT = "Ce prospect existe déjà (même SIREN ou même numéro) : cherche-le dans la liste.";
export const ERR_LIEN_EQUIPE = "Ce choix n'appartient pas à ton équipe.";
export const ERR_FICHE_INTROUVABLE = "Fiche introuvable : elle a peut-être été attribuée à quelqu'un d'autre.";

/** Le message lisible d'une erreur de base pour une action sur les fiches. */
export function messageFiche(code: string | undefined): string {
  if (code === "23505") return ERR_DOUBLON_PROSPECT;
  if (code === "23503") return ERR_LIEN_EQUIPE;
  if (code === "P0002" || code === "PGRST116") return ERR_FICHE_INTROUVABLE;
  return messageDepuisCode(code);
}
