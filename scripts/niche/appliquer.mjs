// Applique une niche prête (config/niches/<code>.json) à config/niche.json.
//
//   - Part de la config existante, ou de config/niche.exemple.json si elle est encore l'exemple (ou absente).
//   - Remplace la partie « marché » : cible, codes NAF, mots-clés Google, grille de score, questions de découverte, objections,
//     exemples d'accroche, débrief. Ne touche pas à marque, pays, offre, téléphonie, agenda, légal, issues : ils restent les tiens.
//   - Valide le résultat (schéma et garde-fous) AVANT d'écrire ; garde l'ancienne config dans config/niche.json.avant.
//   - --essai : montre ce qui changerait, n'écrit rien.
//
// Usage : node scripts/niche/appliquer.mjs <code> [--departements 69,38|tous] [--essai] [--config <fichier.json>]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  A_COMPLETER,
  appliquerNiche,
  CHEMIN_EXEMPLE,
  CHEMIN_NICHE,
  ErreurNiche,
  estLExemple,
  lireArguments,
  lireDepartements,
  lireNiche,
  RACINE,
  resumeDesChangements,
} from "./lib.mjs";

const USAGE = [
  "Usage : node scripts/niche/appliquer.mjs <code> [--departements 69,38|tous] [--essai] [--config <fichier.json>]",
  "  Applique la niche prête <code> (node scripts/niche/lister.mjs) à config/niche.json.",
  "  --departements  les départements à sourcer, ou « tous » (sinon ceux de la config actuelle)",
  "  --essai         montre ce qui changerait, n'écrit rien",
  "  --config        une autre config que config/niche.json (la copie de sauvegarde se nomme <fichier>.avant)",
  "  Ne change jamais : marque, pays, offre, téléphonie, agenda, légal, issues.",
].join("\n");

const affiche = (chemin) => (resolve(chemin).startsWith(RACINE) ? relative(RACINE, resolve(chemin)) : resolve(chemin));

function lireJson(chemin, nom) {
  try {
    return JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    throw new ErreurNiche(`${nom} n'est pas un JSON lisible.`);
  }
}

async function main() {
  const { options, positionnels } = lireArguments(process.argv.slice(2), { "--essai": "booleen", "--departements": "texte", "--config": "texte" });
  if (options.aide || positionnels.length !== 1) {
    console.log(USAGE);
    process.exitCode = options.aide ? 0 : 1;
    return;
  }
  const chemin = options.config ? resolve(options.config) : CHEMIN_NICHE;
  const niche = lireNiche(positionnels[0]);
  const exemple = lireJson(CHEMIN_EXEMPLE, "config/niche.exemple.json");
  const existe = existsSync(chemin);
  const actuelle = existe ? lireJson(chemin, affiche(chemin)) : null;
  const partDeLExemple = !actuelle || estLExemple(actuelle, exemple);
  const base = partDeLExemple ? exemple : actuelle;

  const departements = options.departements !== undefined ? lireDepartements(options.departements) : undefined;
  const { config, cleGoogle } = await appliquerNiche(base, niche, { departements });

  const lignes = [`Niche « ${niche.code} » (${niche.metier}) sur ${partDeLExemple ? "la niche d'exemple" : affiche(chemin)} :`];
  lignes.push(...resumeDesChangements(base, config).map((l) => `  - ${l}`));
  lignes.push(`  - mots-clés Google rangés dans sources.${cleGoogle} (lecture de Google : ${config.sources[cleGoogle].actif ? "activée" : "désactivée, à activer par toi seul"})`);
  lignes.push(`  Intact : marque, pays, offre, téléphonie, agenda, légal, issues.`);
  if (partDeLExemple) {
    lignes.push(`  Attention : la base est encore la niche d'exemple. À écrire ensuite pour ta niche : ${A_COMPLETER.join(", ")}, et les textes du script (ouverture, pitch, close, messagerie).`);
  }
  lignes.push("  Validé : schéma et garde-fous.");

  if (options.essai) {
    console.log([...lignes, "Essai : rien n'a été écrit."].join("\n"));
    return;
  }
  if (existe) copyFileSync(chemin, `${chemin}.avant`);
  writeFileSync(chemin, `${JSON.stringify(config, null, 2)}\n`);
  lignes.push(`Écrit : ${affiche(chemin)}${existe ? ` (ancienne version : ${affiche(`${chemin}.avant`)})` : ""}.`);
  console.log(lignes.join("\n"));
}

main().catch((e) => {
  if (e instanceof ErreurNiche) {
    console.error([e.message, ...e.details.map((d) => `- ${d}`)].join("\n"));
  } else {
    console.error(`erreur inattendue (code ${e?.code ?? "inconnu"})`);
  }
  process.exitCode = 1;
});
