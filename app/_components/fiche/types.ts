// Un bloc de la fiche prospect : le point d'extension entre la fiche et les blocs qui s'y ajoutent (par exemple « Appels transcrits »).
// Un contrat stable : le changer touche tous les blocs. Un bloc est un composant SERVEUR (il peut lire la base avec la session) qui ne reçoit que
// l'identifiant de la fiche.

import type { ReactNode } from "react";

export interface BlocFiche {
  /** Identifiant stable, en minuscules (sert de clé et d'ancre). */
  id: string;
  titre: string;
  /** Ordre d'affichage croissant. */
  ordre: number;
  Composant: (props: { leadId: string }) => ReactNode | Promise<ReactNode>;
}
