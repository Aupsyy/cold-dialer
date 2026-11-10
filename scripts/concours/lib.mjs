// Le commun des scripts de session commune (scripts/concours/*.mjs) : la configuration lue dans l'environnement ou dans .env.local, et
// l'écriture de trois lignes dans .env.local. Règles : le jeton ne s'affiche JAMAIS ; .env.local n'est jamais affiché, et seules les
// trois lignes CONCOURS_* y sont ajoutées ou remplacées (le reste du fichier est recopié tel quel, sans être lu ligne par ligne ici).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { RACINE } from "../install/lib.mjs";

export const VARIABLES = ["CONCOURS_URL", "CONCOURS_CODE", "CONCOURS_JETON"];

/** Le chargeur TypeScript, puis les modules de lib/concours. */
export async function modulesConcours() {
  await import("../charger-ts.mjs");
  const configuration = await import("../../lib/concours/configuration.ts");
  const client = await import("../../lib/concours/client.ts");
  return { ...configuration, ...client };
}

/**
 * Remplace ou ajoute les seules lignes CONCOURS_* d'un texte au format .env ; toutes les autres lignes restent telles quelles.
 * `valeurs` : { CONCOURS_URL, CONCOURS_CODE, CONCOURS_JETON }. Les valeurs sont validées (aucun retour à la ligne).
 */
export function poserLignes(texte, valeurs) {
  for (const nom of VARIABLES) {
    if (typeof valeurs[nom] !== "string" || valeurs[nom] === "" || /[\r\n]/.test(valeurs[nom])) throw new Error(`valeur invalide pour ${nom}`);
  }
  const lignes = texte === "" ? [] : texte.split("\n");
  const dejaPosees = new Set();
  const sortie = [];
  for (const ligne of lignes) {
    const m = /^\s*(?:export\s+)?(CONCOURS_URL|CONCOURS_CODE|CONCOURS_JETON)\s*=/.exec(ligne);
    if (!m) {
      sortie.push(ligne);
    } else if (!dejaPosees.has(m[1])) {
      dejaPosees.add(m[1]);
      sortie.push(`${m[1]}=${valeurs[m[1]]}`);
    }
    // une seconde ligne du même nom est retirée
  }
  while (sortie.length > 0 && sortie[sortie.length - 1] === "") sortie.pop();
  for (const nom of VARIABLES) if (!dejaPosees.has(nom)) sortie.push(`${nom}=${valeurs[nom]}`);
  return `${sortie.join("\n")}\n`;
}

/** Écrit les trois lignes dans <racine>/.env.local (créé s'il manque). */
export function ecrireEnvLocal(valeurs, racine = RACINE) {
  const chemin = join(racine, ".env.local");
  const actuel = existsSync(chemin) ? readFileSync(chemin, "utf8") : "";
  writeFileSync(chemin, poserLignes(actuel, valeurs), { mode: 0o600 });
  return chemin;
}

/** Les variables CONCOURS_* : l'environnement d'abord, sinon .env.local (seules ces trois sont retenues). */
export function lireVariables(env = process.env, racine = RACINE) {
  const sortie = {};
  const chemin = join(racine, ".env.local");
  let fichier = {};
  if (existsSync(chemin)) {
    try {
      fichier = parseEnv(readFileSync(chemin, "utf8"));
    } catch {
      fichier = {};
    }
  }
  for (const nom of VARIABLES) sortie[nom] = (typeof env[nom] === "string" && env[nom] !== "" ? env[nom] : fichier[nom]) ?? undefined;
  return sortie;
}
