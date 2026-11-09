// Fait tourner les tests avec Node seul (22.18 ou plus : Node lit le TypeScript en retirant les types). Ce que Next.js fait pour nous et
// que Node ne fait pas :
//   - « @/… » veut dire « la racine du dépôt » ;
//   - un import sans extension (« ./schema ») est cherché en .ts, .tsx, puis /index.ts ;
//   - un import de JSON sans « with { type: "json" } » est accepté ;
//   - « next/server » et « next/headers » : Node, en ESM, veut le fichier exact.
// Usage : node --import ./scripts/charger-ts.mjs --test tests/*.test.mjs
// Les tests tournent TOUJOURS sur la niche d'exemple : « config/niche.json » est remplacé par « config/niche.exemple.json » au chargement,
// pour que « npm test » passe dans le dépôt de chaque utilisateur quelle que soit sa configuration (la vraie config est validée à part,
// par tests/config-schema.test.mjs qui la lit sur le disque, et par le build). COLD_DIALER_TESTS_CONFIG=reelle désactive ce remplacement.
// Rappel : dans un fichier .ts importé par un test, un type s'importe avec « import type » (tsconfig : verbatimModuleSyntax).

import { register } from "node:module";

const CROCHETS = `
import { readFile } from "node:fs/promises";
let racine = "";
let exemple = true;
export async function initialize(donnees) { racine = donnees.racine; exemple = donnees.exemple; }
const EXACTS = { "next/server": "next/server.js", "next/headers": "next/headers.js", "next/navigation": "next/navigation.js" };
export async function resolve(specifier, context, nextResolve) {
  if (EXACTS[specifier]) return nextResolve(EXACTS[specifier], context);
  const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), racine).href : specifier;
  const local = base.startsWith("./") || base.startsWith("../") || base.startsWith("file:");
  if (!local) return nextResolve(specifier, context);
  try {
    return await nextResolve(base, context);
  } catch (erreur) {
    for (const suffixe of [".ts", ".tsx", "/index.ts"]) {
      try { return await nextResolve(base + suffixe, context); } catch { /* suivant */ }
    }
    throw erreur;
  }
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const lu = exemple && url === new URL("config/niche.json", racine).href ? new URL("config/niche.exemple.json", racine) : new URL(url);
    const source = await readFile(lu, "utf8");
    return { format: "module", source: "export default " + source + ";", shortCircuit: true };
  }
  // Nos fichiers .ts sont des modules ES : on le dit à Node (sinon il essaie CommonJS d'abord et prévient à chaque fichier).
  if (url.startsWith(racine) && !url.includes("/node_modules/") && url.endsWith(".ts")) {
    return nextLoad(url, { ...context, format: "module-typescript" });
  }
  return nextLoad(url, context);
}
`;

register("data:text/javascript," + encodeURIComponent(CROCHETS), {
  parentURL: import.meta.url,
  data: { racine: new URL("../", import.meta.url).href, exemple: process.env.COLD_DIALER_TESTS_CONFIG !== "reelle" },
});
