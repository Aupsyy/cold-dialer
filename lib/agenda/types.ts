// Les types de l'agenda. Contrat partagé : le Poste, les routes de webhook et next.config.ts en dépendent ; on le change avec ses tests.
//
// Un adaptateur = un outil de prise de rendez-vous (Calendly, iClosed, Google Agenda) ; « aucun » = l'agenda interne et le flux ICS.
// Mêmes règles que la téléphonie (lib/telephonie/types.ts) : aucun module Node, aucun accès au DOM au chargement, Web Crypto pour les
// signatures, un journal en codes seulement.
//
// Rapprochement d'un rendez-vous avec une fiche (fait par la base, evenement_agenda) : rendez-vous déjà lié, puis leadId (utm_content),
// puis e-mail, puis téléphone (9 derniers chiffres) ; sinon le rendez-vous est gardé « à vérifier ».

import type { Env } from "../integrations/base";

export const FOURNISSEURS_AGENDA = ["calendly", "iclosed", "google", "aucun"] as const;
export type FournisseurAgenda = (typeof FOURNISSEURS_AGENDA)[number];
/** Les fournisseurs qui envoient des événements (tout sauf « aucun »). */
export type FournisseurAgendaExterne = Exclude<FournisseurAgenda, "aucun">;

/** D'où vient un rendez-vous (rendez_vous.source). */
export const SOURCES_RDV = ["poste", "manuel", "calendly", "iclosed", "google"] as const;
export type SourceRdv = (typeof SOURCES_RDV)[number];

export const CANAUX_RDV = ["visio", "telephone", "sur_place"] as const;
export type CanalRdv = (typeof CANAUX_RDV)[number];

export const STATUTS_RDV = ["pris", "confirme", "tenu", "no_show", "annule", "reporte"] as const;
export type StatutRdv = (typeof STATUTS_RDV)[number];

export const TYPES_EVENEMENT_RDV = ["reserve", "deplace", "annule", "issue"] as const;
export type TypeEvenementRdv = (typeof TYPES_EVENEMENT_RDV)[number];

export const ISSUES_RDV = ["tenu", "no_show"] as const;
export type IssueRdv = (typeof ISSUES_RDV)[number];

/**
 * Un événement de rendez-vous normalisé, envoyé tel quel à la fonction SQL evenement_agenda(p_evenement jsonb). La base lit les clés de
 * CHAMPS_EVENEMENT_RDV. Idempotent : un même (fournisseur, externeId) n'est traité qu'une fois (integrations_evenements).
 */
export interface EvenementRdv {
  fournisseur: FournisseurAgendaExterne;
  type: TypeEvenementRdv;
  /** Identifiant de l'ÉVÉNEMENT (^[A-Za-z0-9_.:-]{1,120}$) : un renvoi du même événement est ignoré. */
  externeId: string;
  /** Identifiant du RENDEZ-VOUS chez le fournisseur : le même pour « reserve », « deplace », « annule » et « issue ». */
  rdvExterneId: string;
  /** ISO 8601 (entre 2000 et 2100), ou null : toute autre valeur compte pour absente. */
  debut: string | null;
  fin: string | null;
  /** Pour le type « issue » seulement. */
  issue: IssueRdv | null;
  /** L'identifiant de la fiche, repris du lien pré-rempli (utm_content). */
  leadId: string | null;
  email: string | null;
  telephone: string | null;
  nom: string | null;
  canal: CanalRdv | null;
  lienVisio: string | null;
  /** L'e-mail de l'hôte chez le fournisseur : le closer est retrouvé par profiles.email (sinon le propriétaire). */
  emailCloser: string | null;
}

/** Les clés lues par evenement_agenda (tests/agenda.test.mjs vérifie qu'elles figurent dans la migration). */
export const CHAMPS_EVENEMENT_RDV = [
  "fournisseur",
  "type",
  "externeId",
  "rdvExterneId",
  "debut",
  "fin",
  "issue",
  "leadId",
  "email",
  "telephone",
  "nom",
  "canal",
  "lienVisio",
  "emailCloser",
] as const satisfies readonly (keyof EvenementRdv)[];

/** La réponse de evenement_agenda (jsonb, clés en camelCase). */
export interface ResultatEvenementRdv {
  doublon: boolean;
  workspaceId: string | null;
  rendezVousId: string | null;
  leadId: string | null;
  /** Vrai si aucune fiche n'a été retrouvée : le rendez-vous attend une vérification à la main. */
  aVerifier: boolean;
}

export const FONCTIONS_SQL_AGENDA = {
  evenement: "evenement_agenda",
  flux: "agenda_flux",
} as const;

/** Ce qu'il faut d'une fiche pour pré-remplir un lien de réservation. */
export interface LeadPourLien {
  id: string;
  entreprise: string;
  dirigeant: string | null;
  email: string | null;
  telephone: string | null;
}

/** La partie « agenda » de config/niche.json. */
export interface ConfigAgenda {
  fournisseur: FournisseurAgenda;
  lienReservation?: string;
  prefill: boolean;
  champLead: "utm_content";
}

export interface WebhookAgenda {
  /** Les NOMS des variables d'environnement nécessaires (jamais leurs valeurs). */
  variables: readonly string[];
  /** Vrai si la requête vient bien du fournisseur ; `maintenantS` : l'horloge en secondes (tolérance des signatures horodatées). */
  verifier(req: Request, corps: Uint8Array, env: Env, maintenantS: number): boolean | Promise<boolean>;
  lire(corps: unknown): EvenementRdv[];
}

export interface AdaptateurAgenda {
  id: FournisseurAgenda;
  libelle: string;
  /** Le lien de réservation pré-rempli (nom, e-mail, téléphone, utm_content=<lead.id>), ou null s'il n'y en a pas. */
  lienReservation(lead: LeadPourLien, config: ConfigAgenda): string | null;
  webhook?: WebhookAgenda;
}

export type RegistreAgenda = Partial<Record<FournisseurAgenda, AdaptateurAgenda>>;
