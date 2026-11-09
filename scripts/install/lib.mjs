// Le commun des scripts d'installation (scripts/install/*.mjs) : la configuration de la niche, la ligne de commande, l'URL de la base,
// le lancement d'une commande (vercel, outil de presse-papiers) et le presse-papiers.
//
// Règles de tous ces scripts :
//   - aucune valeur sensible n'est affichée (jeton, secret, URL de la base, lien d'invitation) : des NOMS, des compteurs, des codes ;
//   - aucune valeur sensible ne passe en argument d'une commande (visible de tous dans la liste des processus) : l'entrée standard ;
//   - une erreur affiche son code, jamais son message brut (il peut citer une valeur).
// Node 22.18 ou plus récent (il lit le TypeScript de config/ en retirant les types).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { optionsTls } from "../accroches/lib/base.mjs";

export const RACINE = fileURLToPath(new URL("../../", import.meta.url));
export const CHEMIN_NICHE = join(RACINE, "config", "niche.json");

// ---------------------------------------------------------------------------------------------------------------------------------
// Erreurs sans donnée
// ---------------------------------------------------------------------------------------------------------------------------------

/** Une erreur dont le message ne contient aucune valeur sensible : on peut l'afficher telle quelle. */
export class ErreurInstall extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurInstall";
  }
}

/** Le code d'une erreur (SQL, système), jamais son message : il peut citer une valeur. */
export function codeErreur(e) {
  const code = e && typeof e === "object" ? e.code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_]{2,24}$/.test(code)) return code;
  if (e && typeof e === "object" && (e.name === "TimeoutError" || e.name === "AbortError")) return "delai_depasse";
  return "inconnu";
}

/** Le message à afficher pour une erreur : le sien si elle est sûre, sinon son seul code. */
export function messageSur(e) {
  if (e instanceof ErreurInstall) return e.message;
  return `erreur inattendue (code ${codeErreur(e)})`;
}

export function afficher(lignes, flux = process.stdout) {
  for (const l of lignes) flux.write(`${l}\n`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Configuration et ligne de commande
// ---------------------------------------------------------------------------------------------------------------------------------

/** La configuration de la niche, validée (schéma et garde-fous). Lève ErreurInstall avec la liste des problèmes. */
export async function chargerNiche(chemin = CHEMIN_NICHE) {
  // Le chargeur TypeScript de Node (sans effet s'il est déjà enregistré, par exemple sous npm test), puis config/charger.ts.
  await import("../charger-ts.mjs");
  const { analyserNiche } = await import("../../config/charger.ts");
  if (!existsSync(chemin)) throw new ErreurInstall("Configuration introuvable : config/niche.json (le skill d'installation l'écrit).");
  let brut;
  try {
    brut = JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    throw new ErreurInstall("config/niche.json n'est pas un JSON lisible.");
  }
  const r = analyserNiche(brut);
  if (!r.ok) throw new ErreurInstall(`config/niche.json invalide (npm test donne le détail) :\n- ${r.problemes.join("\n- ")}`);
  return r.niche;
}

const nomCle = (option) => option.replace(/^--/, "").replace(/-([a-z])/g, (_, l) => l.toUpperCase());

/**
 * La ligne de commande, d'après une spécification { "--appliquer": "booleen", "--objectif": "entier", "--role": ["membre", "appelant"] }.
 * « --option valeur » et « --option=valeur » sont acceptés ; « --env-file » devient la clé envFile ; --aide, --help et -h demandent
 * l'aide. Une option inconnue ou mal formée lève ErreurInstall (une faute de frappe ne passe jamais pour l'option par défaut).
 */
export function lireArguments(argv, spec) {
  const options = {};
  const positionnels = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === "-h") {
      options.aide = true;
      continue;
    }
    if (!a.startsWith("--")) {
      if (a.startsWith("-") && a.length > 1) throw new ErreurInstall(`Option inconnue (les options s'écrivent --nom) : ${a.slice(0, 30)}`);
      positionnels.push(a);
      continue;
    }
    const egal = a.indexOf("=");
    const nom = egal > 0 ? a.slice(0, egal) : a;
    const type = nom === "--aide" || nom === "--help" ? "booleen" : spec[nom];
    if (!type) throw new ErreurInstall(`Option inconnue : ${nom.slice(0, 40)} (--aide pour la liste).`);
    const cle = nom === "--help" ? "aide" : nomCle(nom);
    if (type === "booleen") {
      if (egal > 0) throw new ErreurInstall(`${nom} ne prend pas de valeur.`);
      options[cle] = true;
      continue;
    }
    const valeur = egal > 0 ? a.slice(egal + 1) : argv[++i];
    if (valeur === undefined || valeur === "" || (egal < 0 && String(valeur).startsWith("--"))) {
      throw new ErreurInstall(`${nom} attend une valeur.`);
    }
    if (type === "entier") {
      if (!/^\d{1,6}$/.test(valeur)) throw new ErreurInstall(`${nom} attend un nombre entier.`);
      options[cle] = Number(valeur);
    } else if (Array.isArray(type)) {
      if (!type.includes(valeur)) throw new ErreurInstall(`${nom} attend l'une de ces valeurs : ${type.join(", ")}.`);
      options[cle] = valeur;
    } else {
      options[cle] = String(valeur);
    }
  }
  return { options, positionnels };
}

/** Vrai si ce module est le script lancé (node scripts/install/x.mjs), faux s'il est importé (tests). */
export function estLance(urlModule) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(urlModule));
  } catch {
    return false;
  }
}

/** L'origine d'une instance : https://hôte, ou http://localhost et http://127.0.0.1 (une instance lancée sur cette machine). Sinon null. */
export function origineValide(brut) {
  let u;
  try {
    u = new URL(String(brut));
  } catch {
    return null;
  }
  const locale = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && locale)) return null;
  if (u.username || u.password) return null;
  return u.origin;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------------------------------------------------------------

/** Les variables d'un fichier au format .env (NOM=valeur), lues sans toucher à process.env. Rien n'est affiché. */
export function lireFichierEnv(chemin) {
  if (!existsSync(chemin)) throw new ErreurInstall("Fichier de variables introuvable.");
  try {
    return parseEnv(readFileSync(chemin, "utf8"));
  } catch {
    throw new ErreurInstall("Fichier de variables illisible (format attendu : une ligne NOM=valeur par variable).");
  }
}

/**
 * L'URL de la base : SUPABASE_DB_URL de l'environnement, sinon celle de .env.local à la racine du dépôt (le reste du fichier n'est pas
 * chargé). Jamais affichée. Chaîne vide si elle manque.
 */
export function urlBase(env = process.env, racine = RACINE) {
  const directe = typeof env.SUPABASE_DB_URL === "string" ? env.SUPABASE_DB_URL.trim() : "";
  if (directe) return directe;
  const fichier = join(racine, ".env.local");
  if (!existsSync(fichier)) return "";
  try {
    const v = parseEnv(readFileSync(fichier, "utf8")).SUPABASE_DB_URL;
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/** Le certificat racine de la base (SUPABASE_DB_CA) : l'environnement, sinon .env.local à la racine du dépôt ; "" sans. */
export function caBase(env = process.env, racine = RACINE) {
  const directe = typeof env.SUPABASE_DB_CA === "string" ? env.SUPABASE_DB_CA.trim() : "";
  if (directe) return directe;
  const fichier = join(racine, ".env.local");
  if (!existsSync(fichier)) return "";
  try {
    const v = parseEnv(readFileSync(fichier, "utf8")).SUPABASE_DB_CA;
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/** Vrai si l'URL désigne une base sur cette machine (127.0.0.1 ou localhost). */
export function estUrlLocale(url) {
  return /@(127\.0\.0\.1|localhost)[:/]/.test(String(url));
}

/**
 * La configuration du client pg : rien en local ; vers Supabase, TLS avec le certificat vérifié si SUPABASE_DB_CA est posée (environnement
 * ou .env.local, sinon un
 * avertissement, sans aucune valeur). La même règle que les autres scripts : optionsTls (scripts/accroches/lib/base.mjs).
 */
export function configurationConnexion(url, application = "cold-dialer-install", ca = caBase()) {
  let ssl;
  try {
    ssl = optionsTls(url, { ca });
  } catch {
    throw new ErreurInstall("SUPABASE_DB_CA illisible : le chemin du certificat racine de la base, ou son texte PEM.");
  }
  return { connectionString: url, ssl, application_name: application };
}

/** Ouvre une connexion à la base de SUPABASE_DB_URL ; lève ErreurInstall (sans rien citer de l'URL) si elle manque ou ne répond pas. */
export async function connecter(url, application) {
  if (!url) {
    throw new ErreurInstall("SUPABASE_DB_URL manquante : colle l'URL de ta base dans .env.local toi-même (jamais dans le dépôt), puis relance.");
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client(configurationConnexion(url, application));
  client.on("error", (e) => console.error(`ERREUR : connexion à la base interrompue (code ${codeErreur(e)}).`));
  try {
    await client.connect();
  } catch (e) {
    throw new ErreurInstall(`Connexion à la base impossible (code ${codeErreur(e)}) : vérifie SUPABASE_DB_URL et que le projet Supabase n'est pas en pause.`);
  }
  return client;
}

/** Les ordres d'une transaction : la nôtre, ou un point de sauvegarde dans celle de l'appelant (tests sur une base partagée). */
export function ordresTransaction(externe, nom) {
  return externe
    ? { debut: `savepoint ${nom}`, valider: `release savepoint ${nom}`, annuler: `rollback to savepoint ${nom}` }
    : { debut: "begin", valider: "commit", annuler: "rollback" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Commandes et presse-papiers
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Lance une commande SANS lui passer de valeur sensible en argument : la valeur va dans son entrée standard (`entree`). Sa sortie est
 * capturée, jamais recopiée telle quelle à l'écran. { code, sortie, erreur, introuvable }.
 */
export function executerCommande(commande, args, { entree, cwd } = {}) {
  const r = spawnSync(commande, args, {
    input: entree ?? "",
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 180_000,
    windowsHide: true,
    // Windows lance vercel par un fichier .cmd, que Node n'exécute que par l'interpréteur de commandes. Les arguments ne portent que
    // des noms et des mots-clés ; la valeur passe toujours par l'entrée standard.
    shell: process.platform === "win32",
  });
  if (r.error) {
    const introuvable = r.error.code === "ENOENT";
    return { code: introuvable ? 127 : 1, sortie: "", erreur: "", introuvable };
  }
  return { code: r.status ?? 1, sortie: r.stdout ?? "", erreur: r.stderr ?? "", introuvable: false };
}

/** Les outils de presse-papiers à essayer, dans l'ordre : pbcopy (macOS), clip (Windows), wl-copy puis xclip (Linux). */
export function outilsPressePapiers(plateforme = process.platform, env = process.env) {
  if (plateforme === "darwin") return [["pbcopy", []]];
  if (plateforme === "win32") return [["clip", []]];
  const wlCopy = ["wl-copy", []];
  const xclip = ["xclip", ["-selection", "clipboard"]];
  return env.WAYLAND_DISPLAY ? [wlCopy, xclip] : [xclip, wlCopy];
}

/** Copie une valeur dans le presse-papiers par l'entrée standard de l'outil. Jamais affichée. { ok, outil }. */
export function copierPressePapiers(valeur, { executer = executerCommande, plateforme = process.platform, env = process.env } = {}) {
  for (const [outil, args] of outilsPressePapiers(plateforme, env)) {
    const r = executer(outil, args, { entree: valeur });
    if (r.code === 0) return { ok: true, outil };
  }
  return { ok: false, outil: null };
}
