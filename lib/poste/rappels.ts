// Les rappels du Poste : le rappel automatique « creneau_alterne » (config.issues[].rappelAuto) après une messagerie, un standard ou un
// « pas de réponse », les raccourcis de la date de rappel (« À rappeler ») et l'état des tentatives. Module PUR : « maintenant » est reçu.
//
// Le créneau alterné : on ne rappelle jamais au même moment de la journée. Un appel passé le matin (avant 13 h, heure locale) est rappelé
// l'APRÈS-MIDI du prochain jour ouvré (16 h) ; un appel de l'après-midi ou du soir, le MATIN du prochain jour ouvré (9 h 30). « Prochain
// jour ouvré » : le premier jour ouvré après celui de l'appel (ni samedi, ni dimanche, ni jour férié du pays de la config).

import {
  arrondiMinutes,
  estJourOuvre,
  instantDans,
  jourDans,
  jourOuvreAPartirDe,
  jourOuvreSuivant,
  libelleHeure,
  libelleJour,
  majuscule,
  partiesDans,
  plusJours,
  type Lieu,
} from "./temps";

export const HEURE_RAPPEL_MATIN: readonly [number, number] = [9, 30];
export const HEURE_RAPPEL_APRES_MIDI: readonly [number, number] = [16, 0];
/** Avant 13 h (heure locale), c'est le matin. */
export const FIN_DU_MATIN = 13;

export type Moment = "matin" | "apres_midi";

export interface DateRappel {
  id: string;
  /** « Demain 16 h », « Lundi 9 h 30 », « Dans 1 h ». */
  libelle: string;
  /** L'instant, en millisecondes. */
  t: number;
}

export function momentDe(t: number, fuseau: string): Moment {
  return partiesDans(t, fuseau).heure < FIN_DU_MATIN ? "matin" : "apres_midi";
}

function a(jour: string, [h, m]: readonly [number, number], lieu: Lieu): number {
  return instantDans(jour, h, m, lieu.fuseau);
}

function libelle(t: number, maintenant: number, lieu: Lieu): string {
  return `${majuscule(libelleJour(t, maintenant, lieu.fuseau))} ${libelleHeure(t, lieu.fuseau)}`;
}

/** Le créneau alterné d'un appel passé à `maintenant` : matin -> après-midi du prochain jour ouvré ; après-midi -> son matin. */
export function creneauAlterne(maintenant: number, lieu: Lieu): DateRappel & { moment: Moment } {
  const suivant = jourOuvreSuivant(jourDans(maintenant, lieu.fuseau), lieu.pays);
  const moment: Moment = momentDe(maintenant, lieu.fuseau) === "matin" ? "apres_midi" : "matin";
  const t = a(suivant, moment === "matin" ? HEURE_RAPPEL_MATIN : HEURE_RAPPEL_APRES_MIDI, lieu);
  return { id: "alterne", libelle: libelle(t, maintenant, lieu), t, moment };
}

/** Le rappel posé d'office par une issue (rappelAuto de la config), ou null. */
export function rappelAutomatique(
  issue: { rappelAuto?: "creneau_alterne" | null },
  maintenant: number,
  lieu: Lieu,
): (DateRappel & { moment: Moment }) | null {
  return issue.rappelAuto === "creneau_alterne" ? creneauAlterne(maintenant, lieu) : null;
}

/**
 * Les raccourcis de la date de rappel : dans 1 h ; cet après-midi 16 h (un jour ouvré, au moins 30 minutes avant) ; le matin et l'après-midi
 * du prochain jour ouvré ; dans une semaine, 9 h 30 (ou le jour ouvré qui suit). La date libre reste un champ à part.
 */
export function raccourcisRappel(maintenant: number, lieu: Lieu): DateRappel[] {
  const liste: DateRappel[] = [];
  const unJour = jourDans(maintenant, lieu.fuseau);
  liste.push({ id: "1h", libelle: "Dans 1 h", t: arrondiMinutes(maintenant + 3_600_000) });
  const apresMidi = a(unJour, HEURE_RAPPEL_APRES_MIDI, lieu);
  if (estJourOuvre(unJour, lieu.pays) && apresMidi - maintenant >= 30 * 60_000) {
    liste.push({ id: "apres-midi", libelle: `Cet après-midi ${libelleHeure(apresMidi, lieu.fuseau)}`, t: apresMidi });
  }
  const suivant = jourOuvreSuivant(unJour, lieu.pays);
  const matinSuivant = a(suivant, HEURE_RAPPEL_MATIN, lieu);
  const apresMidiSuivant = a(suivant, HEURE_RAPPEL_APRES_MIDI, lieu);
  liste.push({ id: "matin-suivant", libelle: libelle(matinSuivant, maintenant, lieu), t: matinSuivant });
  liste.push({ id: "apres-midi-suivant", libelle: libelle(apresMidiSuivant, maintenant, lieu), t: apresMidiSuivant });
  const semaine = a(jourOuvreAPartirDe(plusJours(unJour, 7), lieu.pays), HEURE_RAPPEL_MATIN, lieu);
  liste.push({ id: "semaine", libelle: `Dans une semaine (${libelle(semaine, maintenant, lieu).toLowerCase()})`, t: semaine });
  return liste;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tentatives
// ---------------------------------------------------------------------------------------------------------------------------------

export interface EtatTentatives {
  /** Les appels sans réponse déjà comptés sur la fiche (leads.tentatives). */
  deja: number;
  /** Le numéro de la tentative en cours. */
  tentative: number;
  max: number;
  /** Cette tentative est la dernière : sans réponse, la fiche passe « injoignable » (la base s'en charge). */
  derniere: boolean;
  /** La limite est déjà atteinte avant cet appel. */
  depassee: boolean;
  /** « Tentative 2 sur 4 », « Tentative 4 sur 4, la dernière », « 4 tentatives déjà : la limite est de 4 ». */
  texte: string;
}

export function etatTentatives(deja: number, max: number): EtatTentatives {
  const d = Number.isFinite(deja) && deja > 0 ? Math.floor(deja) : 0;
  const m = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1;
  const tentative = d + 1;
  const depassee = d >= m;
  const texte = depassee
    ? `${d} tentative${d > 1 ? "s" : ""} déjà : la limite est de ${m}`
    : `Tentative ${tentative} sur ${m}${tentative === m ? ", la dernière" : ""}`;
  return { deja: d, tentative, max: m, derniere: tentative >= m, depassee, texte };
}
