// L'état du formulaire de saisie rapide (partagé par l'action serveur et le formulaire). Sur une erreur, les valeurs envoyées reviennent :
// React remet le formulaire à ces valeurs au lieu de le vider.

export interface ValeursSaisie {
  objection: string;
  objectionTexte: string;
  verdict: string;
  citation: string;
}

export interface EtatSaisie {
  statut: "repos" | "ok" | "erreur";
  message: string;
  valeurs: ValeursSaisie;
}

export const VALEURS_VIDES: ValeursSaisie = { objection: "", objectionTexte: "", verdict: "", citation: "" };

export const ETAT_INITIAL: EtatSaisie = { statut: "repos", message: "", valeurs: VALEURS_VIDES };
