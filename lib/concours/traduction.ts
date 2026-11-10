// « Issue du Poste » vers « issue du concours ». Le concours ne connaît que trois sortes d'appels :
//   sans_reponse  personne n'a été joint (pas de réponse, messagerie, standard ou barrage)
//   conversation  un interlocuteur a parlé, sans rendez-vous
//   rdv           un rendez-vous est fixé
// Chaque issue de config/niche.json peut porter un champ facultatif `concours` (ces trois valeurs, ou « ignorer » : rien n'est compté).
// Sans lui, une valeur PRUDENTE est déduite du code : les issues du socle ont leur sens connu ; une issue ajoutée par la niche n'est pas
// comptée (« ignorer ») tant qu'on n'a pas dit ce qu'elle vaut. Module PUR.

export const ISSUES_CONCOURS = ["sans_reponse", "conversation", "rdv"] as const;
export type IssueConcours = (typeof ISSUES_CONCOURS)[number];
export type ValeurConcours = IssueConcours | "ignorer";

const PAR_DEFAUT: Readonly<Record<string, ValeurConcours>> = {
  pas_repondu: "sans_reponse",
  messagerie: "sans_reponse",
  standard: "sans_reponse",
  a_rappeler: "conversation",
  rdv_fixe: "rdv",
  pas_interesse: "conversation",
  hors_cible: "conversation",
  ne_plus_contacter: "conversation",
};

/** Ce que vaut une issue pour le concours, ou null si elle n'est pas comptée. */
export function issueConcours(issue: { code: string; concours?: string | undefined } | null | undefined): IssueConcours | null {
  if (!issue) return null;
  const explicite = issue.concours;
  const valeur: string = typeof explicite === "string" ? explicite : (PAR_DEFAUT[issue.code] ?? "ignorer");
  return (ISSUES_CONCOURS as readonly string[]).includes(valeur) ? (valeur as IssueConcours) : null;
}
