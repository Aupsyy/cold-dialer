// Le rendez-vous pris au Poste. Deux chemins (app/(app)/poste), selon que l'outil d'agenda renvoie lui-même ses rendez-vous
// (rdvRecusAutomatiquement de lib/agenda/registre.ts, la même règle que l'écran Agenda) :
//   - RDV reçus automatiquement (Calendly payant et iClosed par leur webhook, Google par sa synchronisation, leurs variables posées) :
//     « Ouvrir la réservation » ouvre le lien pré-rempli dans un nouvel onglet, sur le clic de l'appelant seulement (iClosed crée le contact
//     dès l'ouverture) ; l'outil renvoie le rendez-vous ; le Poste n'enregistre que l'issue de l'appel (jamais un second rendez-vous sur le
//     même créneau : le chevauchement n'est contrôlé que pour les rendez-vous du Poste et de l'agenda interne) ;
//   - sinon (Calendly gratuit, aucun outil) : « RDV pris » = l'agenda interne (date, heure lues dans le fuseau de la config, canal,
//     closer), écrit dans rendez_vous (source « poste », RLS normale ; la base pose la fin et le closer par défaut et refuse un chevauchement :
//     rendez_vous_avant_ecriture), puis l'issue rdv_fixe. Le lien de réservation, s'il existe, reste proposé pour caler le créneau.
// Module PUR : la saisie revérifiée, la ligne à insérer, le lien et le mode.

import type { AdaptateurAgenda, CanalRdv, ConfigAgenda, LeadPourLien } from "@/lib/agenda/types";
import { ErreurSaisie, MAX_NOTE, texte, uuid, uuidObligatoire } from "@/lib/server/validation";
import { depuisChampsLocaux } from "./temps";

export const CANAUX: readonly CanalRdv[] = ["visio", "telephone", "sur_place"];
/** Un rendez-vous se pose au moins 5 minutes dans le futur, et 180 jours au plus. */
export const AVANCE_MIN_MS = 5 * 60_000;
export const HORIZON_MAX_MS = 180 * 86_400_000;

export interface SaisieRdv {
  leadId: string;
  debut: string;
  fin: string;
  canal: CanalRdv;
  closerId: string | null;
  note: string | null;
}

export interface ContexteRdv {
  fuseau: string;
  dureeMin: number;
  maintenant: number;
}

export function validerSaisieRdv(brut: unknown, c: ContexteRdv): SaisieRdv {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) throw new ErreurSaisie("Saisie illisible.");
  const o = brut as Record<string, unknown>;
  const leadId = uuidObligatoire(o.leadId, "La fiche");
  const date = texte(o.date, "La date", 10);
  const heure = texte(o.heure, "L'heure", 5);
  if (!date || !heure) throw new ErreurSaisie("Choisis la date et l'heure du rendez-vous.");
  const t = depuisChampsLocaux(date, heure, c.fuseau);
  if (t === null) throw new ErreurSaisie("La date ou l'heure du rendez-vous est illisible.");
  if (t < c.maintenant + AVANCE_MIN_MS) throw new ErreurSaisie("Le rendez-vous doit être dans le futur.");
  if (t > c.maintenant + HORIZON_MAX_MS) throw new ErreurSaisie("Le rendez-vous est trop loin (180 jours au plus).");
  const canal = texte(o.canal, "Le canal", 20);
  if (!canal || !(CANAUX as readonly string[]).includes(canal)) throw new ErreurSaisie("Le canal : visio, téléphone ou sur place.");
  const duree = Math.min(480, Math.max(5, Math.round(c.dureeMin))) * 60_000;
  return {
    leadId,
    debut: new Date(t).toISOString(),
    fin: new Date(t + duree).toISOString(),
    canal: canal as CanalRdv,
    closerId: uuid(o.closerId, "Le closer"),
    note: texte(o.note, "La note du rendez-vous", MAX_NOTE),
  };
}

/** La ligne à insérer dans rendez_vous (l'équipe et l'auteur sont posés par la base). */
export function ligneRendezVous(s: SaisieRdv): Record<string, unknown> {
  return { lead_id: s.leadId, closer_id: s.closerId, debut: s.debut, fin: s.fin, canal: s.canal, source: "poste", statut: "pris", note: s.note };
}

/** Le lien de réservation pré-rempli de l'outil d'agenda, ou null (pas d'adaptateur, pas de lien, ou lien qui n'est pas en https). */
export function lienReservationSur(adaptateur: AdaptateurAgenda | null, lead: LeadPourLien, config: ConfigAgenda): string | null {
  if (!adaptateur) return null;
  let lien: string | null = null;
  try {
    lien = adaptateur.lienReservation(lead, config);
  } catch {
    return null;
  }
  if (typeof lien !== "string") return null;
  try {
    return new URL(lien).protocol === "https:" ? lien : null;
  } catch {
    return null;
  }
}

