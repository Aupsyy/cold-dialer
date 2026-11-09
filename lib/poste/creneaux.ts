// Les créneaux de rendez-vous proposés au téléphone : « [deux créneaux] » du close et des relances, et les boutons du panneau RDV.
// Deux créneaux, toujours : jamais « quand êtes-vous disponible ? ». Ils partent du prochain jour ouvré (jamais le jour même : le closer
// prépare l'échange), à 10 h ou à 14 h 30 (heure locale du fuseau de la config), sans chevaucher un rendez-vous déjà pris quand on le sait.
// Le second tombe un autre jour que le premier, à l'autre moment de la journée si possible : le prospect a un vrai choix. Module PUR.

import { instantDans, jourDans, jourOuvreSuivant, libelleHeure, libelleJour, type Lieu } from "./temps";
import { FIN_DU_MATIN, type Moment } from "./rappels";

/** Les heures proposées chaque jour ouvré (heure locale). */
export const HEURES_RDV: readonly (readonly [number, number])[] = [
  [10, 0],
  [14, 30],
];

/** Combien de jours ouvrés on regarde au plus. */
export const JOURS_RDV = 10;

export interface Plage {
  debut: number;
  fin: number;
}

export interface CreneauRdv extends Plage {
  /** Le jour local, AAAA-MM-JJ. */
  jour: string;
  moment: Moment;
  /** « demain à 10 h », « jeudi à 14 h 30 ». */
  libelle: string;
}

export interface OptionsCreneaux {
  /** La durée du rendez-vous (config.offre.rdv.dureeMin). */
  dureeMin: number;
  /** Les rendez-vous déjà pris (pris ou confirmés) du closer, s'ils sont connus. */
  occupes?: readonly Plage[];
  jours?: number;
}

export function libelleCreneau(t: number, maintenant: number, fuseau: string): string {
  return `${libelleJour(t, maintenant, fuseau)} à ${libelleHeure(t, fuseau)}`;
}

/** Les créneaux libres des prochains jours ouvrés, dans l'ordre. */
export function creneauxRdv(maintenant: number, lieu: Lieu, o: OptionsCreneaux): CreneauRdv[] {
  const duree = Math.max(5, Math.round(o.dureeMin)) * 60_000;
  const occupes = o.occupes ?? [];
  const sortie: CreneauRdv[] = [];
  let jour = jourDans(maintenant, lieu.fuseau);
  for (let n = 0; n < (o.jours ?? JOURS_RDV); n++) {
    jour = jourOuvreSuivant(jour, lieu.pays);
    for (const [h, m] of HEURES_RDV) {
      const debut = instantDans(jour, h, m, lieu.fuseau);
      const fin = debut + duree;
      if (!Number.isFinite(debut) || debut <= maintenant) continue;
      if (occupes.some((x) => x.debut < fin && debut < x.fin)) continue;
      sortie.push({ debut, fin, jour, moment: h < FIN_DU_MATIN ? "matin" : "apres_midi", libelle: libelleCreneau(debut, maintenant, lieu.fuseau) });
    }
  }
  return sortie;
}

export interface DeuxCreneaux {
  premier: CreneauRdv;
  second: CreneauRdv;
  /** « demain à 10 h ou jeudi à 14 h 30 » : ce qui remplace [deux créneaux]. */
  texte: string;
}

/** Les deux créneaux du close, ou null si rien n'est libre sur la période. */
export function deuxCreneaux(maintenant: number, lieu: Lieu, o: OptionsCreneaux): DeuxCreneaux | null {
  const liste = creneauxRdv(maintenant, lieu, o);
  const premier = liste[0];
  if (!premier) return null;
  const second =
    liste.find((c) => c.jour !== premier.jour && c.moment !== premier.moment) ??
    liste.find((c) => c.jour !== premier.jour) ??
    liste.find((c) => c !== premier);
  if (!second) return null;
  const memeJour = second.jour === premier.jour;
  const texte = memeJour
    ? `${premier.libelle} ou à ${libelleHeure(second.debut, lieu.fuseau)}`
    : `${premier.libelle} ou ${second.libelle}`;
  return { premier, second, texte };
}
