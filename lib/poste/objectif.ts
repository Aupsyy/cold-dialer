// L'objectif du jour et les compteurs de la personne connectée : appels passés, prospects joints, rendez-vous pris aujourd'hui (journal
// lead_activities, type « appel », depuis minuit dans le fuseau de la config). L'objectif d'appels vient des réglages de l'équipe
// (reglages.objectif_appels_jour ; 0 : pas d'objectif affiché). Aucun chiffre inventé : seulement ce que dit le journal. Module PUR.

import { estJointe } from "./issues";

export interface AppelDuJour {
  leadId: string;
  appelantId: string | null;
  issue: string | null;
  statutApres: string | null;
}

export interface Compteurs {
  appels: number;
  joints: number;
  rdv: number;
}

/** Les appels du jour d'une personne : chaque appel compte ; un RDV compte une fois par fiche. */
export function compteursDuJour(appels: readonly AppelDuJour[], appelantId: string): Compteurs {
  const miens = appels.filter((a) => a.appelantId === appelantId);
  const rdv = new Set(miens.filter((a) => a.issue === "rdv_fixe" || a.statutApres === "rdv_fixe").map((a) => a.leadId));
  return { appels: miens.length, joints: miens.filter((a) => estJointe(a.issue)).length, rdv: rdv.size };
}

/** Les fiches qui ont déjà eu un appel aujourd'hui (par n'importe qui de l'équipe). */
export function fichesAppeleesAujourdhui(appels: readonly AppelDuJour[]): Set<string> {
  return new Set(appels.map((a) => a.leadId));
}

export interface Jauge {
  fait: number;
  cible: number;
  reste: number;
  /** De 0 à 1, pour la largeur de la barre. */
  part: number;
  atteint: boolean;
}

/** La jauge d'un objectif ; null sans objectif (cible nulle ou illisible). */
export function jauge(fait: number, cible: number | null | undefined): Jauge | null {
  const c = typeof cible === "number" && Number.isFinite(cible) ? Math.floor(cible) : 0;
  if (c <= 0) return null;
  const f = Number.isFinite(fait) && fait > 0 ? Math.floor(fait) : 0;
  return { fait: f, cible: c, reste: Math.max(0, c - f), part: Math.min(1, f / c), atteint: f >= c };
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** « Encore 12 appels pour l'objectif », « Objectif atteint ». */
export function resteAFaire(j: Jauge | null): string | null {
  if (!j) return null;
  return j.atteint ? "Objectif atteint" : `Encore ${pluriel(j.reste, "appel", "appels")} pour l'objectif`;
}
