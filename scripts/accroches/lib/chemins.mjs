// Les chemins du parcours des accroches. Tout ce qui touche aux prospects (liste des sites, textes lus, lots, réponses, accroches)
// vit dans donnees/accroches/, que .gitignore exclut du dépôt : rien de tout cela n'est jamais commité.

import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RACINE = fileURLToPath(new URL("../../../", import.meta.url));
export const DOSSIER_PAR_DEFAUT = join(RACINE, "donnees", "accroches");
export const CONFIG_PAR_DEFAUT = join(RACINE, "config", "niche.json");
export const MODELE_CONSIGNE = join(RACINE, "skills", "accroches", "consigne.md");

/**
 * Le dossier de travail : donnees/accroches/ par défaut. Un autre dossier est permis hors du dépôt (tests, disque externe) ou sous
 * donnees/ ; jamais ailleurs dans le dépôt, où git pourrait suivre des données de prospects.
 */
export function dossierDeTravail(choix) {
  const dossier = choix ? resolve(String(choix)) : DOSSIER_PAR_DEFAUT;
  const rel = relative(RACINE, dossier);
  const horsDepot = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const sousDonnees = rel === "donnees" || rel.startsWith(`donnees${sep}`);
  if (!horsDepot && !sousDonnees) {
    throw new Error("Le dossier de travail doit être sous donnees/ (ignoré par git) ou hors du dépôt.");
  }
  return dossier;
}

/** Les fichiers du parcours, dans l'ordre où ils apparaissent. */
export function fichiers(dossier) {
  return {
    dossier,
    aCrawler: join(dossier, "a-crawler.json"),
    crawl: join(dossier, "crawl.jsonl"),
    compact: join(dossier, "compact.jsonl"),
    lots: join(dossier, "lots"),
    reponses: join(dossier, "reponses"),
    validees: join(dossier, "validees.json"),
    rapport: join(dossier, "rapport-validation.md"),
    revue: join(dossier, "revue.md"),
    consigne: join(dossier, "consigne.md"),
  };
}
