// Lance la fonction principale d'un script seulement quand il est exécuté (node scripts/accroches/x.mjs), pas quand un test l'importe.
// Les messages d'erreur ne contiennent jamais de donnée de prospect ni la valeur d'une variable d'environnement.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErreurOptions } from "./args.mjs";

function cheminReel(chemin) {
  try {
    return realpathSync(chemin);
  } catch {
    return chemin;
  }
}

export function lancerSiPrincipal(urlModule, principal) {
  if (!process.argv[1] || cheminReel(process.argv[1]) !== cheminReel(fileURLToPath(urlModule))) return;
  principal(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code ?? 0;
    },
    (erreur) => {
      console.error(erreur instanceof ErreurOptions ? `Option : ${erreur.message}` : `Erreur : ${erreur?.message ?? erreur}`);
      process.exitCode = 1;
    },
  );
}
