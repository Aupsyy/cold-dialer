// La liste des blocs ajoutés à la fiche prospect (aujourd'hui : « Appels transcrits »). Ajouter un bloc, c'est ajouter UNE entrée ici :
// c'est le seul fichier partagé à toucher.

import { AppelsTranscrits } from "./blocs/AppelsTranscrits";
import type { BlocFiche } from "./types";

export const BLOCS_FICHE: readonly BlocFiche[] = [{ id: "appels-transcrits", titre: "Appels transcrits", ordre: 100, Composant: AppelsTranscrits }];
