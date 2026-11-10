// Affiche le classement de la session commune configurée (CONCOURS_URL, CONCOURS_CODE : l'environnement, sinon .env.local). Des pseudos
// et des compteurs, rien d'autre ; le jeton n'est pas utilisé.
//
// Usage : node scripts/concours/classement.mjs

import { afficher, estLance, lireArguments, messageSur } from "../install/lib.mjs";
import { lireVariables, modulesConcours } from "./lib.mjs";

const USAGE = [
  "Usage : node scripts/concours/classement.mjs",
  "  Affiche le classement de la session commune (pseudos et compteurs : appels, conversations, rendez-vous).",
  "  Il lit CONCOURS_URL et CONCOURS_CODE dans l'environnement, sinon dans .env.local.",
].join("\n");

/** Les lignes du classement : trié par rendez-vous, puis conversations, puis appels. */
export function lignesClassement(c) {
  const lignes = [`Session : ${c.titre || "sans titre"}${c.ouverte === false ? " (fermée)" : ""}`];
  const tries = [...c.participants].sort((a, b) => b.rdv - a.rdv || b.conversations - a.conversations || b.appels - a.appels);
  if (tries.length === 0) return [...lignes, "Aucun participant pour l'instant."];
  tries.forEach((p, i) => {
    lignes.push(`${String(i + 1).padStart(2)}. ${p.pseudo} : ${p.appels} appels, ${p.conversations} conversations, ${p.rdv} rendez-vous`);
  });
  return lignes;
}

/** Le travail du script, testable : `d` fournit les variables et la lecture du classement. */
export async function executerClassement(d, m) {
  const url = m.urlServiceValide(d.variables.CONCOURS_URL);
  const code = m.codeSessionValide(d.variables.CONCOURS_CODE);
  if (!url || !code) {
    return { code: 1, lignes: [], erreur: "Aucune session configurée : CONCOURS_URL et CONCOURS_CODE manquent ou sont invalides (node scripts/concours/rejoindre.mjs --aide)." };
  }
  const config = { url, code };
  const c = await d.lire(config);
  if (!c) return { code: 1, lignes: [], erreur: "Le classement n'a pas pu être lu (service injoignable ou réponse inattendue)." };
  return { code: 0, lignes: lignesClassement(c), erreur: null };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {});
    if (options.aide || positionnels.length > 0) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const m = await modulesConcours();
    const r = await executerClassement({ variables: lireVariables(), lire: (c) => m.lireSession(c) }, m);
    afficher(r.lignes);
    if (r.erreur) console.error(`ERREUR : ${r.erreur}`);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();
