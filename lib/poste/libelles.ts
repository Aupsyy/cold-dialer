// Les libellés de l'interface pour les valeurs fermées de la base (statuts d'une fiche, canaux et statuts d'un rendez-vous). Module PUR.

export const STATUTS_LEAD = [
  "a_appeler",
  "a_rappeler",
  "rdv_fixe",
  "pas_interesse",
  "hors_cible",
  "injoignable",
  "clos",
  "ne_plus_contacter",
] as const;
export type StatutLead = (typeof STATUTS_LEAD)[number];

export const LIBELLES_STATUT: Readonly<Record<StatutLead, string>> = {
  a_appeler: "À appeler",
  a_rappeler: "À rappeler",
  rdv_fixe: "RDV fixé",
  pas_interesse: "Pas intéressé",
  hors_cible: "Hors cible",
  injoignable: "Injoignable",
  clos: "Clos",
  ne_plus_contacter: "Ne plus contacter",
};

export function libelleStatut(s: string | null | undefined): string {
  return s && Object.hasOwn(LIBELLES_STATUT, s) ? LIBELLES_STATUT[s as StatutLead] : "Inconnu";
}

export const LIBELLES_CANAL: Readonly<Record<string, string>> = { visio: "Visio", telephone: "Téléphone", sur_place: "Sur place" };

export const LIBELLES_STATUT_RDV: Readonly<Record<string, string>> = {
  pris: "Pris",
  confirme: "Confirmé",
  tenu: "Tenu",
  no_show: "Absent",
  annule: "Annulé",
  reporte: "Reporté",
};

export const LIBELLES_SOURCE_RDV: Readonly<Record<string, string>> = {
  poste: "Poste",
  manuel: "Saisi à la main",
  calendly: "Calendly",
  iclosed: "iClosed",
  google: "Google Agenda",
};

export function libelleDans(table: Readonly<Record<string, string>>, cle: string | null | undefined, repli = "Inconnu"): string {
  return cle && Object.hasOwn(table, cle) ? (table[cle] as string) : repli;
}
