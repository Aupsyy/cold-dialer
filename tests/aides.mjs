// Petits outils partagés par les tests : la racine du dépôt, la lecture d'un fichier, une copie profonde de la niche d'exemple.
import { readFileSync } from "node:fs";

export const RACINE = new URL("../", import.meta.url);

export function lire(chemin) {
  return readFileSync(new URL(chemin, RACINE), "utf8");
}

export function exemple() {
  return JSON.parse(lire("config/niche.exemple.json"));
}
