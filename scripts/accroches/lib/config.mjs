// La configuration de la niche (config/niche.json), validée par le même chargeur que l'application : schéma (config/schema.ts) puis
// garde-fous (config/garde-fous.ts). Le chargeur de TypeScript pour Node (scripts/charger-ts.mjs) est posé avant d'importer les
// fichiers .ts : c'est lui qui résout leurs imports sans extension.

import { readFileSync } from "node:fs";
import { CONFIG_PAR_DEFAUT } from "./chemins.mjs";

async function modulesTs() {
  await import("../../charger-ts.mjs");
  const { analyserNiche } = await import("../../../config/charger.ts");
  const { PROMESSES_INTERDITES } = await import("../../../config/garde-fous.ts");
  return { analyserNiche, PROMESSES_INTERDITES };
}

/**
 * La niche validée et les motifs de promesse interdits (les mêmes que ceux de la config : une accroche est dite au prospect).
 * @returns {Promise<{ niche: any, promesses: RegExp[] }>}
 */
export async function chargerConfig(chemin = CONFIG_PAR_DEFAUT) {
  const { analyserNiche, PROMESSES_INTERDITES } = await modulesTs();
  let brut;
  try {
    brut = JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    throw new Error(`Configuration illisible : ${chemin} (crée-la depuis config/niche.exemple.json)`);
  }
  const r = analyserNiche(brut);
  if (!r.ok) throw new Error(`Configuration invalide (${chemin}) :\n- ${r.problemes.join("\n- ")}`);
  return { niche: r.niche, promesses: [...PROMESSES_INTERDITES] };
}

/** Le jeton du robot dans robots.txt : « AtelierDemoBot » pour « AtelierDemoBot/1.0 (+https://…) ». */
export function jetonRobot(userAgent) {
  return String(userAgent).split("/")[0].trim();
}
