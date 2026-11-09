// L'adaptateur « aucun » : pas d'outil de réservation. Les rendez-vous sont pris au Poste ou créés dans l'agenda de l'application (table
// rendez_vous), et chaque closer peut s'abonner à son flux ICS (/api/agenda/ics/<jeton>) depuis Google Agenda, Apple ou Outlook.
// Ni lien de réservation, ni webhook.

import type { AdaptateurAgenda } from "./types";

export const interne: AdaptateurAgenda = {
  id: "aucun",
  libelle: "Agenda interne (sans outil de réservation)",
  lienReservation() {
    return null;
  },
};
