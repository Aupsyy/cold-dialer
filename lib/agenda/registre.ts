// Le registre des adaptateurs d'agenda : Calendly, iClosed, Google Agenda et l'agenda interne (« aucun »). Importable partout (navigateur,
// serveur, build) : aucun module Node ni accès au DOM au chargement.
//
// Pour le Poste :
//   - lienReservationPour(lead, niche.agenda) : le lien de réservation pré-rempli (ou null) ; à ouvrir dans un nouvel onglet
//     (window.open(lien, "_blank", "noopener,noreferrer")), seulement pour une vraie réservation : iClosed crée le contact dès que la page
//     pré-remplie s'ouvre ;
//   - rdvRecusAutomatiquement(fournisseur, env) (serveur) : vrai si l'outil renvoie lui-même les rendez-vous (webhook ou synchronisation
//     configurés) ; sinon le Poste propose le bouton « RDV pris » (offre gratuite de Calendly, agenda interne).

import { valeurEnv, variablesManquantes, type Env } from "../integrations/base";
import { calendly } from "./calendly";
import { FUSEAU_PAR_DEFAUT } from "./fuseau";
import { VARIABLE_CRON, VARIABLES_GOOGLE, google } from "./google";
import { creerIclosed } from "./iclosed";
import { interne } from "./interne";
import type { AdaptateurAgenda, ConfigAgenda, FournisseurAgenda, LeadPourLien, RegistreAgenda } from "./types";

export interface OptionsRegistreAgenda {
  /** Le fuseau de l'équipe (config.pays.fuseau) : iClosed envoie parfois des heures sans décalage. */
  fuseau?: string;
}

export function creerRegistreAgenda(options: OptionsRegistreAgenda = {}): RegistreAgenda {
  return {
    calendly,
    iclosed: creerIclosed(options.fuseau ?? FUSEAU_PAR_DEFAUT),
    google,
    aucun: interne,
  };
}

export const REGISTRE_AGENDA: RegistreAgenda = creerRegistreAgenda();

export function adaptateurAgenda(id: FournisseurAgenda, registre: RegistreAgenda = REGISTRE_AGENDA): AdaptateurAgenda | null {
  return registre[id] ?? null;
}

/** Le lien de réservation de cette fiche avec l'outil configuré, ou null (agenda interne, lien absent ou illisible). */
export function lienReservationPour(lead: LeadPourLien, config: ConfigAgenda, registre: RegistreAgenda = REGISTRE_AGENDA): string | null {
  return adaptateurAgenda(config.fournisseur, registre)?.lienReservation(lead, config) ?? null;
}

/**
 * Les NOMS des variables qu'il faut à l'agenda choisi : celles du webhook (Calendly, iClosed), celles de la synchronisation (Google :
 * OAuth et CRON_SECRET), aucune pour l'agenda interne. (/api/sante ne lit aujourd'hui que celles du webhook.)
 */
export function variablesAgenda(id: FournisseurAgenda, registre: RegistreAgenda = REGISTRE_AGENDA): readonly string[] {
  if (id === "google") return [...VARIABLES_GOOGLE, VARIABLE_CRON];
  return adaptateurAgenda(id, registre)?.webhook?.variables ?? [];
}

/** Vrai si l'outil choisi renvoie lui-même les rendez-vous dans l'application (variables posées) ; sinon, « RDV pris » au Poste. */
export function rdvRecusAutomatiquement(id: FournisseurAgenda, env: Env, registre: RegistreAgenda = REGISTRE_AGENDA): boolean {
  if (id === "aucun") return false;
  const noms = variablesAgenda(id, registre);
  return noms.length > 0 && variablesManquantes(env, noms).length === 0 && valeurEnv(env, "SUPABASE_SERVICE_ROLE_KEY") !== "";
}
