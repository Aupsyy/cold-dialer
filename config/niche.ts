// La configuration de la niche, validée une fois au chargement (schéma et garde-fous). À importer côté serveur :
//   import { niche } from "@/config/niche";
// Un composant client reçoit seulement la partie dont il a besoin, en props.

import { chargerNiche } from "./charger";
import brut from "./niche.json";

export const niche = chargerNiche(brut);
export type { Niche } from "./schema";
