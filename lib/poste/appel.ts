// Les noms des événements viennent de la téléphonie (lib/telephonie/navigateur.ts) : une seule vérité pour le Poste et les adaptateurs.
import { EVENEMENT_APPEL, EVENEMENT_ETAT } from "../telephonie/navigateur";

// L'appel en cours au Poste : le chronomètre (démarré par « Appeler », arrêté par « Raccroché » ou par le choix de l'issue) et la durée
// envoyée avec l'issue (lead_activities.duree_s). En mode « telephone » ou « softphone », aucun fournisseur ne renvoie la durée : c'est
// le chronomètre du Poste, ou la durée saisie à la main. Module PUR.

export const DUREE_MAX_S = 86_400;

/** La durée en secondes entre deux instants (millisecondes), bornée de 0 à 86 400. */
export function dureeSecondes(debut: number, fin: number): number {
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return 0;
  return Math.min(DUREE_MAX_S, Math.max(0, Math.round((fin - debut) / 1000)));
}

/** « 0:07 », « 12:34 », « 1:02:03 ». */
export function formatChrono(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Une durée saisie à la main : « 2:35 », « 155 » (secondes) ou « 2 min » ; null si illisible ou hors bornes. */
export function lireDureeSaisie(v: string | null | undefined): number | null {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "") return null;
  let s: number | null = null;
  const mmss = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  const hmmss = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(t);
  const min = /^(\d{1,4})\s*min$/.exec(t);
  if (hmmss) s = Number(hmmss[1]) * 3600 + Number(hmmss[2]) * 60 + Number(hmmss[3]);
  else if (mmss) s = Number(mmss[1]) * 60 + Number(mmss[2]);
  else if (min) s = Number(min[1]) * 60;
  else if (/^\d{1,5}$/.test(t)) s = Number(t);
  return s !== null && s >= 0 && s <= DUREE_MAX_S ? s : null;
}

/** Le message montré après « Appeler », selon ce qu'a fait l'adaptateur (ou le repli). */
export function messageAppel(resultat: "lance" | "repli_tel" | "copie" | "echec", copie: boolean): string {
  switch (resultat) {
    case "lance":
      return "Appel lancé.";
    case "repli_tel":
      return copie ? "Lien d'appel ouvert ; le numéro est aussi copié." : "Lien d'appel ouvert.";
    case "copie":
      return "Numéro copié : colle-le dans ton téléphone ou ton logiciel d'appel.";
    case "echec":
      return "L'appel n'a pas pu partir : compose le numéro affiché à la main.";
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les signaux du téléphone (adaptateurs de lib/telephonie) : l'élément de téléphonie du Poste reçoit des événements DOM
//   « telephonie:etat »  detail : "pret" | "attente" | "indisponible" ;
//   « telephonie:appel » detail : { etat: "sonne" | "decroche" | "termine", direction, dureeS, externeId, leadId } (téléphones en iframe).
// Ils pilotent le chronomètre et la durée de l'issue (la durée donnée par le fournisseur l'emporte). Le webhook reste la vérité en base.
// ---------------------------------------------------------------------------------------------------------------------------------

export const EVENEMENT_ETAT_TELEPHONE: typeof EVENEMENT_ETAT = EVENEMENT_ETAT;
export const EVENEMENT_APPEL_TELEPHONE: typeof EVENEMENT_APPEL = EVENEMENT_APPEL;

export type EtatTelephonePoste = "pret" | "attente" | "indisponible";

export function lireEtatTelephone(detail: unknown): EtatTelephonePoste | null {
  return detail === "pret" || detail === "attente" || detail === "indisponible" ? detail : null;
}

export interface SignalTelephone {
  etat: "sonne" | "decroche" | "termine";
  direction: "sortant" | "entrant" | null;
  dureeS: number | null;
  leadId: string | null;
}

/** Un signal d'appel lu prudemment (un détail d'une autre forme est ignoré). */
export function lireSignalTelephone(detail: unknown): SignalTelephone | null {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  if (d.etat !== "sonne" && d.etat !== "decroche" && d.etat !== "termine") return null;
  const duree = typeof d.dureeS === "number" && Number.isFinite(d.dureeS) && d.dureeS >= 0 && d.dureeS <= DUREE_MAX_S ? Math.round(d.dureeS) : null;
  return {
    etat: d.etat,
    direction: d.direction === "sortant" || d.direction === "entrant" ? d.direction : null,
    dureeS: duree,
    leadId: typeof d.leadId === "string" && d.leadId !== "" ? d.leadId : null,
  };
}

/** L'appel de la fiche ouverte : lancé (« Appeler » ou le téléphone), décroché, terminé ; la durée du fournisseur si elle est connue. */
export interface AppelEnCours {
  debut: number;
  fin: number | null;
  decroche: number | null;
  dureeFournisseur: number | null;
}

export function nouvelAppel(maintenant: number): AppelEnCours {
  return { debut: maintenant, fin: null, decroche: null, dureeFournisseur: null };
}

/**
 * Ce signal concerne-t-il la fiche ouverte ? Oui s'il porte son identifiant (appel lancé par appeler()) ; un signal sans fiche n'est
 * pris que pour un appel sortant déjà en cours sur cette fiche (jamais un appel entrant).
 */
export function signalPourFiche(s: SignalTelephone, ficheId: string, appelEnCours: boolean): boolean {
  if (s.leadId !== null) return s.leadId === ficheId;
  return appelEnCours && s.direction !== "entrant";
}

/** L'appel après un signal du téléphone. */
export function appliquerSignal(appel: AppelEnCours | null, s: SignalTelephone, maintenant: number): AppelEnCours {
  const enCours = appel !== null && appel.fin === null ? appel : null;
  switch (s.etat) {
    case "sonne":
      return enCours ?? nouvelAppel(maintenant);
    case "decroche": {
      const a = enCours ?? nouvelAppel(maintenant);
      return a.decroche === null ? { ...a, decroche: maintenant } : a;
    }
    case "termine": {
      if (!appel) return { debut: maintenant - (s.dureeS ?? 0) * 1000, fin: maintenant, decroche: null, dureeFournisseur: s.dureeS };
      return { ...appel, fin: appel.fin ?? maintenant, dureeFournisseur: s.dureeS ?? appel.dureeFournisseur };
    }
  }
}

/** La durée de l'appel à cet instant : celle du fournisseur si elle est connue, sinon depuis le décroché, sinon depuis le lancement. */
export function dureeAppel(appel: AppelEnCours | null, maintenant: number): number {
  if (!appel) return 0;
  if (appel.dureeFournisseur !== null) return appel.dureeFournisseur;
  const fin = appel.fin ?? Math.max(maintenant, appel.debut);
  return dureeSecondes(appel.decroche ?? appel.debut, fin);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// L'annonce d'enregistrement : la case se coche PENDANT l'appel seulement (lancé, pas encore raccroché). Après, l'audio n'est pas
// conservé, point : l'écran n'invite jamais à cocher après coup une annonce qui n'a pas été lue (la base refuse de toute façon une
// annonce cochée après la fin de l'appel). Une annonce ne vaut que pour UN appel : un nouvel appel repart d'une case vide.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Vrai si la case « annonce lue » peut être cochée : un appel lancé et pas encore terminé. */
export function annonceCochable(appel: AppelEnCours | null): boolean {
  return appel !== null && appel.fin === null;
}

/** Le texte à côté de la case de l'annonce. `lueA` : l'heure de la coche, si elle a été faite. */
export function libelleCaseAnnonce(appel: AppelEnCours | null, lueA: string | null): string {
  if (lueA !== null) return `Annonce lue à ${lueA} : l'enregistrement de cet appel pourra être conservé.`;
  if (appel === null) return "La case s'active pendant l'appel (clique sur « Appeler »).";
  if (appel.fin === null) return "J'ai lu l'annonce au prospect";
  return "Appel terminé sans annonce cochée : son audio et sa transcription ne seront pas conservés.";
}

/** Le refus d'une coche hors de l'appel (avant « Appeler », ou après la fin). */
export function refusCocheAnnonce(appel: AppelEnCours | null): string | null {
  if (appel === null) return "Lance l'appel d'abord : l'annonce se lit quand le prospect décroche.";
  if (appel.fin !== null) return "L'appel est terminé : l'annonce ne se coche que pendant l'appel.";
  return null;
}

/** L'avertissement d'une issue où le prospect a décroché sans annonce cochée : une information, jamais une invitation à cocher. */
export const ALERTE_SANS_ANNONCE =
  "L'annonce d'enregistrement n'a pas été cochée pendant l'appel : son audio et sa transcription ne seront pas conservés.";
