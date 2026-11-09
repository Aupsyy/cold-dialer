// La validation des saisies de l'écran Agenda (actions serveur de app/(app)/agenda/actions.ts) : rien de ce qu'envoie le navigateur
// n'est cru sur parole. Une ErreurSaisie porte un message lisible. Module PUR, testé par tests/agenda-vues.test.mjs.

import { ErreurSaisie, lienHttps, parmi, texte, uuid, uuidObligatoire } from "../server/validation";
import { instantLocal } from "./fuseau";
import { CANAUX_RDV, STATUTS_RDV, type CanalRdv, type StatutRdv } from "./types";

export const DUREES_RDV_MIN = [15, 20, 30, 45, 60, 90, 120] as const;
export const NOTE_RDV_MAX = 2000;

export interface EntreeRdvManuel {
  jour?: unknown;
  heure?: unknown;
  dureeMin?: unknown;
  canal?: unknown;
  lienVisio?: unknown;
  closerId?: unknown;
  leadId?: unknown;
  note?: unknown;
}

export interface RdvManuelValide {
  debut: string;
  fin: string;
  canal: CanalRdv;
  lienVisio: string | null;
  closerId: string | null;
  leadId: string | null;
  note: string | null;
}

/** Un rendez-vous saisi à la main : jour et heure dans le fuseau de l'équipe, durée parmi les durées proposées, lien en https. */
export function validerRdvManuel(e: EntreeRdvManuel, o: { fuseau: string; maintenant: number }): RdvManuelValide {
  const jour = texte(e.jour, "Le jour", 10);
  const heure = texte(e.heure, "L'heure", 5);
  if (!jour || !heure) throw new ErreurSaisie("Le jour et l'heure sont obligatoires.");
  const instant = instantLocal(jour, heure, o.fuseau);
  if (!instant) throw new ErreurSaisie("Le jour ou l'heure est illisible.");
  if (instant.decale) throw new ErreurSaisie("Cette heure n'existe pas ce jour-là (changement d'heure) : choisis-en une autre.");
  const duree = typeof e.dureeMin === "string" ? Number(e.dureeMin) : e.dureeMin;
  if (typeof duree !== "number" || !(DUREES_RDV_MIN as readonly number[]).includes(duree)) {
    throw new ErreurSaisie(`La durée doit être l'une de : ${DUREES_RDV_MIN.join(", ")} minutes.`);
  }
  const debutMs = Date.parse(instant.iso);
  if (debutMs < o.maintenant - 30 * 86_400_000) throw new ErreurSaisie("Ce rendez-vous date de plus de 30 jours.");
  const canal = parmi(e.canal, CANAUX_RDV, "Le canal", false) as CanalRdv;
  const lienVisio = lienHttps(e.lienVisio, "Le lien de visio");
  if (lienVisio && lienVisio.length > 300) throw new ErreurSaisie("Le lien de visio : 300 caractères au plus.");
  return {
    debut: instant.iso,
    fin: new Date(debutMs + duree * 60_000).toISOString(),
    canal,
    lienVisio: canal === "visio" ? lienVisio : null,
    closerId: uuid(e.closerId, "Le closer"),
    leadId: uuid(e.leadId, "La fiche"),
    note: texte(e.note, "La note", NOTE_RDV_MAX),
  };
}

/** Le changement de statut demandé : un rendez-vous (uuid) et un statut connu. */
export function validerChangementStatut(rdvId: unknown, statut: unknown): { rdvId: string; statut: StatutRdv } {
  return { rdvId: uuidObligatoire(rdvId, "Le rendez-vous"), statut: parmi(statut, STATUTS_RDV, "Le statut", false) as StatutRdv };
}

/** Le rattachement demandé : un rendez-vous et une fiche (uuid). */
export function validerRattachement(rdvId: unknown, leadId: unknown): { rdvId: string; leadId: string } {
  return { rdvId: uuidObligatoire(rdvId, "Le rendez-vous"), leadId: uuidObligatoire(leadId, "La fiche") };
}
