// Rejoint une session commune (concours d'appels) et branche cette instance dessus.
//
// Il appelle le service (POST …/rejoindre), puis ÉCRIT lui-même CONCOURS_URL, CONCOURS_CODE et CONCOURS_JETON dans .env.local (ces trois
// lignes seulement, ajoutées ou remplacées ; le reste du fichier n'est ni lu ni affiché). Le jeton ne s'affiche jamais : --copier-jeton
// le met dans le presse-papiers pour le coller dans le tableau de bord de ton hébergeur. Seuls des compteurs partent ensuite
// (appels, conversations, rendez-vous) : voir docs/concours.md.
//
// Usage : node scripts/concours/rejoindre.mjs --url <https://…> --code <CODE> --pseudo "<pseudo>" [--essai] [--copier-jeton]

import { afficher, copierPressePapiers, ErreurInstall, estLance, lireArguments, messageSur } from "../install/lib.mjs";
import { ecrireEnvLocal, modulesConcours, VARIABLES } from "./lib.mjs";

const USAGE = [
  'Usage : node scripts/concours/rejoindre.mjs --url <https://…> --code <CODE> --pseudo "<pseudo>" [--essai] [--copier-jeton]',
  "  Rejoint la session commune, puis écrit CONCOURS_URL, CONCOURS_CODE et CONCOURS_JETON dans .env.local (ces trois lignes seulement).",
  "  Le jeton ne s'affiche jamais. Seuls des compteurs partent ensuite : appels, conversations, rendez-vous.",
  "  --url           l'adresse du service qui héberge la session (https obligatoire, sauf http://localhost pour un essai)",
  "  --code          le code de la session (4 à 12 caractères, A-Z et 0-9)",
  "  --pseudo        le nom sous lequel ton équipe apparaît au classement",
  "  --essai         vérifie les trois réglages et n'appelle rien, n'écrit rien",
  "  --copier-jeton  copie le jeton dans le presse-papiers (jamais affiché), pour le coller chez ton hébergeur",
].join("\n");

/** Le pseudo : sans retour à la ligne ni caractère de contrôle, de 1 à 40 caractères. */
export function pseudoValide(brut) {
  const p = String(brut ?? "").trim();
  return p.length >= 1 && p.length <= 40 && !/[\u0000-\u001f\u007f]/.test(p) ? p : null;
}

/**
 * Le travail du script, testable. `d` : { rejoindre, racine, copier } (le réseau, le dossier du dépôt et le presse-papiers sont
 * injectés) et `m` : les fonctions de lib/concours. Renvoie { code, lignes, erreur }.
 */
export async function executerRejoindre(options, d, m) {
  const lignes = [];
  const echec = (erreur) => ({ code: 1, lignes, erreur });
  const url = m.urlServiceValide(options.url);
  if (!url) return echec("--url : une adresse https://… est obligatoire (http://localhost accepté pour un essai).");
  const code = m.codeSessionValide(options.code);
  if (!code) return echec("--code : 4 à 12 caractères, des lettres majuscules et des chiffres.");
  const pseudo = pseudoValide(options.pseudo);
  if (!pseudo) return echec("--pseudo : un nom de 1 à 40 caractères, sans retour à la ligne.");

  if (options.essai) {
    lignes.push("Simulation : le service n'est pas appelé et .env.local n'est pas touché.");
    lignes.push(`  - session ${code}, pseudo « ${pseudo} » : tu rejoindrais, puis ${VARIABLES.join(", ")} seraient écrites dans .env.local`);
    return { code: 0, lignes, erreur: null };
  }

  const r = await d.rejoindre({ url, code }, pseudo);
  if (!r.ok) return echec(r.erreur);

  try {
    d.ecrire({ CONCOURS_URL: url, CONCOURS_CODE: code, CONCOURS_JETON: r.jeton });
  } catch {
    return echec("Tu as rejoint la session, mais .env.local n'a pas pu être écrit : vérifie le dossier et les droits, puis relance avec un autre pseudo.");
  }
  lignes.push(`Session ${code} rejointe sous le pseudo « ${r.pseudo} ».`);
  lignes.push(`.env.local : ${VARIABLES.join(", ")} sont écrites (le jeton n'est pas affiché).`);
  if (options.copierJeton) {
    const copie = d.copier(r.jeton);
    lignes.push(copie.ok ? "Le jeton est dans ton presse-papiers (jamais affiché) : colle-le chez ton hébergeur." : "Copie impossible (aucun outil de presse-papiers) : ouvre .env.local pour copier la ligne CONCOURS_JETON.");
  }
  lignes.push("");
  lignes.push("Pour que ton instance en ligne envoie ses compteurs, pose les trois mêmes variables chez ton hébergeur :");
  lignes.push("  Vercel : Settings, Environment Variables, ajoute CONCOURS_URL, CONCOURS_CODE puis CONCOURS_JETON (coche « Sensitive »), puis redéploie.");
  lignes.push("  (scripts/install/secrets.mjs ne pose que des secrets tirés au hasard : ces trois valeurs viennent du service, à poser à la main.)");
  lignes.push("Pour quitter la session : retire ces trois variables, chez l'hébergeur et dans .env.local, puis redéploie.");
  return { code: 0, lignes, erreur: null };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--url": "texte",
      "--code": "texte",
      "--pseudo": "texte",
      "--essai": "booleen",
      "--copier-jeton": "booleen",
    });
    if (options.aide || positionnels.length > 0) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    if (!options.url || !options.code || !options.pseudo) throw new ErreurInstall("--url, --code et --pseudo sont obligatoires (--aide pour le détail).");
    const m = await modulesConcours();
    const r = await executerRejoindre(
      options,
      { rejoindre: (c, p) => m.rejoindre(c, p), ecrire: (v) => ecrireEnvLocal(v), copier: (j) => copierPressePapiers(j) },
      m,
    );
    afficher(r.lignes);
    if (r.erreur) console.error(`ERREUR : ${r.erreur}`);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();
