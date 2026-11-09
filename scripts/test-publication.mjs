// Le contrôle bloquant avant toute publication du dépôt. Joué par npm test et par la CI ; il doit rester vert. Les règles sont dans
// scripts/lib/publication-regles.mjs (testées une à une par tests/publication-regles.test.mjs) ; ce script lit le dépôt et les applique.
//
//   1. Termes interdits : les marques, noms et adresses du projet d'où vient ce code ne doivent apparaître ni dans un fichier, ni dans un
//      nom de fichier, ni dans l'historique git (messages, auteurs). La liste n'est PAS dans le dépôt (elle révélerait ce qu'elle cache) :
//      elle vient de l'environnement, TERMES_INTERDITS (une expression régulière par ligne) ou TERMES_INTERDITS_FICHIER (un fichier hors du
//      dépôt), aussi lus dans .env.local ; en CI, le secret TERMES_INTERDITS. Sans liste, cette partie est sautée et le dit. En cas
//      d'échec, seul le numéro du terme est affiché, jamais le terme.
//   2. Aucune donnée de personne : e-mail hors des domaines d'exemple, numéro français hors des plages fictives de l'ARCEP, SIREN ou SIRET
//      valide (clé de Luhn), dans tout fichier texte du dépôt. Aucun chemin absolu d'une machine.
//   3. Aucun fichier de données, d'audio, d'archive ou d'export (CSV, TSV, JSONL, XLSX, VCF, MP3, PDF, ZIP…) ; du JSON seulement pour la
//      configuration du projet ; aucun .env suivi, sauf .env.example (des noms, aucune valeur).
//   4. .gitignore couvre les données, les secrets, les caches, l'audio, les exports, les transcriptions et les dossiers d'outils.
//   5. Aucun secret évident (clés privées, JWT, Stripe, Supabase, GitHub, Slack, Google, Anthropic, AWS, adresse de base avec mot de passe
//      hors base locale). gitleaks, en CI, complète ce contrôle.
// Les fichiers examinés : ceux que git suit, plus les nouveaux fichiers non ignorés (jamais un lien symbolique ni un dossier).

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTENSIONS_BINAIRES_PERMISES,
  ignoresManquants,
  problemesDeChemin,
  problemesDeLigne,
  sansEmpreintes,
} from "./lib/publication-regles.mjs";

const RACINE = fileURLToPath(new URL("../", import.meta.url));
const IGNORER_TOUJOURS = /^(node_modules|\.next|\.git|out|coverage)\//;

function valeurEnvOuLocale(nom) {
  if (typeof process.env[nom] === "string" && process.env[nom].trim() !== "") return process.env[nom];
  try {
    for (const ligne of readFileSync(join(RACINE, ".env.local"), "utf8").split("\n")) {
      const m = ligne.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[1] === nom) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // pas de .env.local : rien
  }
  return "";
}

/** Les termes interdits, un par ligne (expressions régulières), lus hors du dépôt ; null si aucune liste n'est fournie. */
function chargerTermes() {
  let brut = valeurEnvOuLocale("TERMES_INTERDITS");
  if (brut === "") {
    const fichier = valeurEnvOuLocale("TERMES_INTERDITS_FICHIER");
    if (fichier !== "") {
      try {
        brut = readFileSync(fichier.replace(/^~(?=\/|$)/, homedir()), "utf8");
      } catch {
        return { erreur: "TERMES_INTERDITS_FICHIER illisible" };
      }
    }
  }
  const lignes = brut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  if (lignes.length === 0) return { termes: null };
  return { termes: lignes.map((l) => new RegExp(l, "iu")) };
}

const CHARGEMENT = chargerTermes();
if (CHARGEMENT.erreur) {
  console.error(`✗ Contrôle de publication : ${CHARGEMENT.erreur}`);
  process.exit(1);
}
const TERMES = CHARGEMENT.termes;

function fichiersDuDepot() {
  try {
    const sortie = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: RACINE, encoding: "utf8" });
    return sortie.split("\0").filter((f) => f && existsSync(join(RACINE, f)));
  } catch {
    // Hors d'un dépôt git (archive téléchargée) : tout le dossier, sauf les dépendances et les constructions.
    const liste = [];
    const parcourir = (dossier) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        const rel = relative(RACINE, chemin);
        if (IGNORER_TOUJOURS.test(`${rel}/`)) continue;
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else liste.push(rel);
      }
    };
    parcourir(RACINE);
    return liste;
  }
}

/** L'historique git (auteurs et messages), en entrées séparées ; vide hors d'un dépôt. */
function historiqueGit() {
  try {
    const sortie = execFileSync("git", ["log", "--format=%h%x00%an%x00%ae%x00%B%x1e"], { cwd: RACINE, encoding: "utf8" });
    return sortie
      .split("\x1e")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => {
        const [hash, auteur, email, ...message] = e.split("\0");
        return { hash, texte: [auteur, email, message.join("\0")].join("\n") };
      });
  } catch {
    return [];
  }
}

const problemes = [];
const signaler = (ou, regle, detail = "") => problemes.push(`${ou} : ${regle}${detail ? ` (${detail})` : ""}`);

const fichiers = fichiersDuDepot();
for (const f of fichiers) {
  for (const [regle, detail] of problemesDeChemin(f, TERMES)) signaler(f, regle, detail);
  if (EXTENSIONS_BINAIRES_PERMISES.test(f)) continue;
  // Un lien symbolique ou un dossier (par exemple un node_modules partagé entre deux copies de travail) ne se lit pas.
  if (!lstatSync(join(RACINE, f)).isFile()) continue;

  let contenu = readFileSync(join(RACINE, f));
  if (contenu.subarray(0, 8000).includes(0)) {
    signaler(f, "fichier binaire inconnu (ni image ni police)");
    continue;
  }
  contenu = contenu.toString("utf8");
  if (f === "package-lock.json") contenu = sansEmpreintes(contenu);

  // Le fichier des règles cite les chemins qu'il refuse : ses lignes de commentaire ne sont pas des fuites.
  const regles = f === "scripts/lib/publication-regles.mjs" || f === "tests/publication-regles.test.mjs";
  const options = { cheminsPermis: regles, processusPermis: regles };
  contenu.split("\n").forEach((texte, i) => {
    for (const [regle, detail] of problemesDeLigne(texte, TERMES, options)) signaler(`${f}:${i + 1}`, regle, detail);
  });
}

// L'historique git : les termes interdits dans les messages et les identités (jamais recopiés).
if (TERMES) {
  for (const entree of historiqueGit()) {
    TERMES.forEach((re, k) => {
      if (re.test(entree.texte)) signaler(`historique git, commit ${entree.hash}`, "terme interdit", `n°${k + 1} de la liste`);
    });
  }
}

// .gitignore et .env.example.
const gitignore = existsSync(join(RACINE, ".gitignore")) ? readFileSync(join(RACINE, ".gitignore"), "utf8") : "";
for (const attendu of ignoresManquants(gitignore)) signaler(".gitignore", `entrée manquante : ${attendu}`);
if (existsSync(join(RACINE, ".env.example"))) {
  readFileSync(join(RACINE, ".env.example"), "utf8")
    .split("\n")
    .forEach((l, i) => {
      const t = l.trim();
      if (t === "" || t.startsWith("#")) return;
      if (!/^[A-Z][A-Z0-9_]*=$/.test(t)) signaler(`.env.example:${i + 1}`, "une ligne doit être « NOM= », sans valeur");
    });
} else {
  signaler(".env.example", "fichier manquant (les noms des variables)");
}

if (problemes.length > 0) {
  console.error(`✗ Contrôle de publication : ${problemes.length} problème(s)\n  - ${problemes.join("\n  - ")}`);
  process.exit(1);
}
console.log(
  TERMES
    ? `✓ Contrôle de publication : ${fichiers.length} fichiers et l'historique, aucun des ${TERMES.length} termes interdits, aucune donnée de personne, aucun secret.`
    : `✓ Contrôle de publication : ${fichiers.length} fichiers, aucune donnée de personne, aucun secret (liste des termes interdits absente : partie sautée ; voir CONTRIBUTING.md).`,
);
