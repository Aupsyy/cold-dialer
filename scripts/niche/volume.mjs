// Annonce le volume d'entreprises d'une niche : lance « node scripts/sourcing/sirene.mjs fetch --essai » (le registre public, rien n'est gardé).
// Sans code : sur config/niche.json. Avec un code de niche prête : sur cette niche fusionnée à ta config, dans un fichier temporaire
// (config/niche.json n'est pas modifié).
//
// Usage : node scripts/niche/volume.mjs [<code>] [--departements 69,38|tous]

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliquerNiche, CHEMIN_EXEMPLE, CHEMIN_NICHE, ErreurNiche, estLExemple, lireArguments, lireDepartements, lireNiche, RACINE } from "./lib.mjs";

const USAGE = [
  "Usage : node scripts/niche/volume.mjs [<code>] [--departements 69,38|tous]",
  "  Annonce le volume d'entreprises (registre public SIRENE) et la durée de récolte ; rien n'est gardé.",
  "  Sans code : d'après config/niche.json. Avec un code de niche prête : d'après cette niche, sans modifier config/niche.json.",
].join("\n");

async function main() {
  const { options, positionnels } = lireArguments(process.argv.slice(2), { "--departements": "texte" });
  if (options.aide || positionnels.length > 1) {
    console.log(USAGE);
    process.exitCode = options.aide ? 0 : 1;
    return;
  }
  const args = [join(RACINE, "scripts/sourcing/sirene.mjs"), "fetch", "--essai"];
  let dossierTemporaire = null;
  try {
    if (positionnels.length === 1) {
      const exemple = JSON.parse(readFileSync(CHEMIN_EXEMPLE, "utf8"));
      const actuelle = existsSync(CHEMIN_NICHE) ? JSON.parse(readFileSync(CHEMIN_NICHE, "utf8")) : exemple;
      const base = estLExemple(actuelle, exemple) ? exemple : actuelle;
      const departements = options.departements !== undefined ? lireDepartements(options.departements) : undefined;
      const { config } = await appliquerNiche(base, lireNiche(positionnels[0]), { departements });
      dossierTemporaire = mkdtempSync(join(tmpdir(), "niche-volume-"));
      const fichier = join(dossierTemporaire, "niche.json");
      writeFileSync(fichier, JSON.stringify(config));
      args.push("--config", fichier);
    }
    const r = spawnSync(process.execPath, args, { cwd: RACINE, stdio: "inherit" });
    process.exitCode = r.status ?? 1;
  } finally {
    if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof ErreurNiche ? [e.message, ...e.details.map((d) => `- ${d}`)].join("\n") : `erreur inattendue (code ${e?.code ?? "inconnu"})`);
  process.exitCode = 1;
});
