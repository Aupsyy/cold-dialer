// L'équipe et les invitations de l'écran Réglages : la lecture des lignes (profiles, invitations), la saisie revérifiée de chaque geste
// (changer un rôle, retirer quelqu'un, poser un e-mail de téléphonie, inviter, révoquer), le lien d'inscription et les messages lisibles
// de ce que la base refuse. Module PUR (ni réseau, ni Next) : testé par tests/reglages-logique.test.mjs.
//
// Ce que la base refuse déjà (supabase/migrations/0001_schema.sql), et que l'écran dit avant elle :
//   - changer_role et retirer_membre : le propriétaire seul, jamais sur soi-même (l'équipe garde donc toujours un propriétaire) ;
//   - definir_email_telephonie : un gestionnaire ; jamais un e-mail qui désigne déjà un autre compte (connexion ou téléphonie) ;
//   - invitations : un gestionnaire ; une invitation « propriétaire » et son jeton, le propriétaire seul ; un e-mail ou un nom ; le jeton
//     est toujours tiré par la base ; 14 jours de validité ; une invitation ne se modifie pas (on la révoque, on en crée une autre).

import { LIBELLES_ROLE, ROLES, estRole, type Role } from "@/lib/roles";
import { ERR_GENERIQUE, ERR_REFUS } from "@/lib/server/contexte";
import { ErreurSaisie, email, texte, uuidObligatoire } from "@/lib/server/validation";

export { RE_JETON_INVITATION, lienInvitation } from "./libelles";

/** La validité d'une invitation (la valeur par défaut de invitations.expire_le). */
export const DUREE_INVITATION_JOURS = 14;
export const NOM_MAX = 120;

/** Les colonnes lues pour la liste de l'équipe. */
export const COLONNES_MEMBRE = "id, nom, email, role, email_telephonie, created_at";
/** Les colonnes lues pour les invitations en attente : JAMAIS le jeton (il n'est montré qu'une fois, à la création). */
export const COLONNES_INVITATION = "id, role, email, nom_invite, expire_le, created_at";

export const DESCRIPTION_ROLE: Readonly<Record<Role, string>> = {
  proprietaire: "tout, dont les rôles, le retrait d'un compte et l'effacement d'une fiche",
  membre: "tout sauf changer les rôles, retirer quelqu'un ou effacer une fiche",
  appelant: "le Poste, ses fiches et les fiches non attribuées de la file",
};

export interface MembreEquipe {
  id: string;
  nom: string;
  email: string | null;
  role: Role;
  emailTelephonie: string | null;
  depuis: string | null;
}

export interface InvitationEnAttente {
  id: string;
  role: Role;
  email: string | null;
  nom: string | null;
  expireLe: string;
  creeLe: string | null;
}

function ligne(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function chaine(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function lireMembreEquipe(v: unknown): MembreEquipe | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  if (!r || !id || !estRole(r.role)) return null;
  return { id, nom: chaine(r.nom) ?? "Sans nom", email: chaine(r.email), role: r.role, emailTelephonie: chaine(r.email_telephonie), depuis: chaine(r.created_at) };
}

export function lireInvitation(v: unknown): InvitationEnAttente | null {
  const r = ligne(v);
  const id = chaine(r?.id);
  const expireLe = chaine(r?.expire_le);
  if (!r || !id || !expireLe || !estRole(r.role) || !Number.isFinite(Date.parse(expireLe))) return null;
  return { id, role: r.role, email: chaine(r.email), nom: chaine(r.nom_invite), expireLe, creeLe: chaine(r.created_at) };
}

export function lireListe<T>(v: unknown, lecteur: (x: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const sortie: T[] = [];
  for (const x of v) {
    const lu = lecteur(x);
    if (lu) sortie.push(lu);
  }
  return sortie;
}

/** Les propriétaires d'abord, puis les membres, puis les appelants ; à rôle égal, par nom. */
export function trierEquipe(membres: readonly MembreEquipe[]): MembreEquipe[] {
  const rang = (r: Role) => ROLES.indexOf(r);
  return [...membres].sort((a, b) => rang(a.role) - rang(b.role) || a.nom.localeCompare(b.nom, "fr"));
}

export function estExpiree(inv: Pick<InvitationEnAttente, "expireLe">, maintenant: number): boolean {
  return Date.parse(inv.expireLe) <= maintenant;
}

/** Les rôles qu'une personne peut donner dans une invitation : le propriétaire seul invite un propriétaire. */
export function rolesInvitables(role: Role | null): Role[] {
  if (role === "proprietaire") return ["appelant", "membre", "proprietaire"];
  if (role === "membre") return ["appelant", "membre"];
  return [];
}

function objet(brut: unknown): Record<string, unknown> {
  const r = ligne(brut);
  if (!r) throw new ErreurSaisie("Saisie illisible.");
  return r;
}

function role(v: unknown): Role {
  if (!estRole(v)) throw new ErreurSaisie("Choisis un rôle : propriétaire, membre ou appelant.");
  return v;
}

export const ERR_PROPRE_ROLE = "Tu ne changes pas ton propre rôle : un autre propriétaire peut le faire.";
export const ERR_SE_RETIRER = "Tu ne peux pas te retirer toi-même : l'équipe garde toujours un propriétaire.";

/** { membreId, role } : jamais son propre rôle (la base le refuse aussi). */
export function validerChangementRole(brut: unknown, moi: string): { membreId: string; role: Role } {
  const o = objet(brut);
  const membreId = uuidObligatoire(o.membreId, "Le compte");
  const r = role(o.role);
  if (membreId === moi.toLowerCase()) throw new ErreurSaisie(ERR_PROPRE_ROLE);
  return { membreId, role: r };
}

/** { membreId } : jamais soi-même (la base le refuse aussi). */
export function validerRetrait(brut: unknown, moi: string): { membreId: string } {
  const membreId = uuidObligatoire(objet(brut).membreId, "Le compte");
  if (membreId === moi.toLowerCase()) throw new ErreurSaisie(ERR_SE_RETIRER);
  return { membreId };
}

/** { membreId, email } : l'e-mail du compte chez le fournisseur de téléphonie ; vide : effacé (null). */
export function validerEmailTelephonie(brut: unknown): { membreId: string; email: string | null } {
  const o = objet(brut);
  return { membreId: uuidObligatoire(o.membreId, "Le compte"), email: email(o.email, "L'e-mail de téléphonie") };
}

/** { nom } : son propre nom, 1 à 120 caractères. */
export function validerNom(brut: unknown): { nom: string } {
  const nom = texte(objet(brut).nom, "Le nom", NOM_MAX);
  if (!nom) throw new ErreurSaisie("Le nom est obligatoire.");
  return { nom };
}

export interface NouvelleInvitation {
  role: Role;
  email: string | null;
  nom_invite: string | null;
}

/** { role, email?, nom? } : un rôle que l'on a le droit de donner, et l'e-mail ou le nom de la personne (la base exige l'un des deux). */
export function validerInvitation(brut: unknown, roleCourant: Role | null): NouvelleInvitation {
  const o = objet(brut);
  const r = role(o.role);
  if (!rolesInvitables(roleCourant).includes(r)) {
    throw new ErreurSaisie(r === "proprietaire" ? "Seul le propriétaire invite un autre propriétaire." : ERR_REFUS);
  }
  const mail = email(o.email, "L'e-mail");
  const nom = texte(o.nom, "Le nom", NOM_MAX);
  if (!mail && !nom) throw new ErreurSaisie("Indique l'e-mail ou le nom de la personne invitée.");
  return { role: r, email: mail, nom_invite: nom };
}

export function validerRevocation(brut: unknown): { invitationId: string } {
  return { invitationId: uuidObligatoire(objet(brut).invitationId, "L'invitation") };
}

export type OperationEquipe = "role" | "retrait" | "email_telephonie" | "invitation" | "revocation" | "nom";

const PLUS_DANS_L_EQUIPE = "Ce compte n'est plus dans l'équipe : recharge la page.";

/** Le message lisible d'un refus de la base pour un geste de l'équipe (jamais le détail brut, qui peut citer une valeur). */
export function messageEquipe(operation: OperationEquipe, code: string | undefined): string {
  if (code === "42501") {
    if (operation === "role" || operation === "retrait") return "Réservé au propriétaire, et jamais sur son propre compte.";
    if (operation === "invitation") return "Tu ne peux pas créer cette invitation (seul le propriétaire invite un propriétaire).";
    return ERR_REFUS;
  }
  if (code === "P0002" || code === "PGRST116") return operation === "revocation" ? "Invitation introuvable : elle a peut-être déjà été utilisée ou révoquée." : PLUS_DANS_L_EQUIPE;
  if (code === "22023") return operation === "email_telephonie" ? "Cette adresse e-mail n'est pas valide." : "Valeur refusée par la base.";
  if (code === "23505") {
    return operation === "email_telephonie"
      ? "Cet e-mail est déjà celui d'un autre compte (connexion ou téléphonie) : ses appels iraient au mauvais appelant."
      : "Cet élément existe déjà.";
  }
  if (code === "23514") return operation === "invitation" ? "Indique l'e-mail ou le nom de la personne invitée." : "Valeur refusée par la base.";
  if (code === "23503") return "Ce choix n'appartient pas à ton équipe.";
  return ERR_GENERIQUE;
}

export function libelleRole(r: Role): string {
  return LIBELLES_ROLE[r];
}
