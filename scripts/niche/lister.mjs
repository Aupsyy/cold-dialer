// Affiche les niches prêtes (config/niches/<code>.json) : code, métier, codes NAF.
// Usage : node scripts/niche/lister.mjs
import { codesDesNiches, lireArguments, lireNiche, ErreurNiche } from "./lib.mjs";

const USAGE = [
  "Usage : node scripts/niche/lister.mjs",
  "  Liste les niches prêtes (code, métier, codes NAF, taille visée). Le code sert à : node scripts/niche/appliquer.mjs <code>",
].join("\n");

try {
  const { options } = lireArguments(process.argv.slice(2), {});
  if (options.aide) {
    console.log(USAGE);
  } else {
    for (const code of codesDesNiches()) {
      const n = lireNiche(code);
      console.log(`${code.padEnd(30)} ${n.metier} | NAF ${n.sources.sirene.naf.join(", ")} | ${n.tailleVisee}`);
    }
  }
} catch (e) {
  console.error(e instanceof ErreurNiche ? e.message : `erreur inattendue (code ${e?.code ?? "inconnu"})`);
  process.exitCode = 1;
}
