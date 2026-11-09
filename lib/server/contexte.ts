// Le contexte d'une personne connectée, lu en UN aller-retour par la fonction SQL contexte() : { uid, workspace_id, role, nom }.
// auth.uid() est l'identité du jeton de session, jamais une valeur envoyée par le navigateur. Module PUR, testé par tests/contexte.test.mjs.

import { estGestionnaire, estRole, type Role } from "../roles";

export interface Contexte {
  userId: string;
  /** null : compte sans équipe (retiré par le propriétaire). */
  workspaceId: string | null;
  role: Role | null;
  nom: string | null;
}

/** Le contexte d'après la réponse de contexte() ; null si personne n'est connecté ou si la forme est inattendue. */
export function lireContexte(data: unknown): Contexte | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const chaine = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const userId = chaine(o.uid);
  if (!userId) return null;
  return {
    userId,
    workspaceId: chaine(o.workspace_id),
    role: estRole(o.role) ? o.role : null,
    nom: chaine(o.nom),
  };
}

/** Le niveau demandé par une action. */
export type Besoin = "equipe" | "gestionnaire" | "proprietaire";

export function autorise(ctx: Contexte, besoin: Besoin): boolean {
  if (!ctx.workspaceId || !ctx.role) return false;
  switch (besoin) {
    case "equipe":
      return true;
    case "gestionnaire":
      return estGestionnaire(ctx.role);
    case "proprietaire":
      return ctx.role === "proprietaire";
  }
}

export const ERR_GENERIQUE = "Une erreur est survenue. Réessaie dans un instant.";
export const ERR_REFUS = "Tu n'as pas l'autorisation de faire cette action.";
export const ERR_INTROUVABLE = "Élément introuvable.";
export const ERR_DOUBLON = "Cet élément existe déjà.";
export const ERR_OPPOSITION = "Cette fiche est sur la liste d'opposition : elle ne peut plus être appelée.";

/** Un message lisible d'après le code d'erreur Postgres ou PostgREST (jamais le détail brut). */
export function messageDepuisCode(code: string | undefined): string {
  switch (code) {
    case "42501":
      return ERR_REFUS;
    case "23505":
      return ERR_DOUBLON;
    case "23514":
      return ERR_OPPOSITION;
    case "23P01":
      return "Ce créneau chevauche un autre rendez-vous : choisis-en un autre.";
    case "P0002":
    case "PGRST116":
      return ERR_INTROUVABLE;
    default:
      return ERR_GENERIQUE;
  }
}
