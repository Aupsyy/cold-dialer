// Les secrets de l'instance, tirés au hasard et posés dans Vercel SANS JAMAIS ÊTRE AFFICHÉS.
//
// D'après config/niche.json, le script tire (crypto, 32 octets, en base64url : 43 caractères) :
//   - le jeton du webhook de téléphonie qu'on choisit soi-même : ONOFF_WEBHOOK_TOKEN (Onoff), RINGOVER_WEBHOOK_SECRET (Ringover) ;
//     celui d'Aircall (AIRCALL_WEBHOOK_TOKEN) est créé par Aircall : l'utilisateur le colle lui-même ;
//   - le secret du webhook d'agenda : CALENDLY_WEBHOOK_SIGNING_KEY (Calendly), ICLOSED_WEBHOOK_SECRET (iClosed) ;
//   - CRON_SECRET, toujours : les deux tâches planifiées de vercel.json tournent chaque jour et Vercel leur envoie ce secret.
// Il les pose par « vercel env add <NOM> <environnement> --sensitive --yes », la valeur dans l'ENTRÉE STANDARD (jamais en argument :
// les arguments se lisent dans la liste des processus). Il refuse d'écraser une variable déjà présente sans --remplacer, et copie une
// valeur dans le presse-papiers sur demande (--copier <NOM>) pour la coller dans la console du fournisseur.
// Sortie : des NOMS et des états, jamais une valeur. Il faut avoir lancé « vercel login » puis « vercel link » avant.
//
// Usage : node scripts/install/secrets.mjs [--essai] [--copier <NOM>] [--remplacer] [--environnement production|preview]
//           [--config <niche.json>]

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  afficher,
  chargerNiche,
  copierPressePapiers,
  estLance,
  executerCommande,
  lireArguments,
  messageSur,
  RACINE,
} from "./lib.mjs";

export const OCTETS_SECRET = 32;
export const ENVIRONNEMENTS = ["production", "preview"];

const USAGE = [
  "Usage : node scripts/install/secrets.mjs [--essai] [--copier <NOM>] [--remplacer] [--environnement production|preview]",
  "          [--config <niche.json>]",
  "  Tire au hasard (32 octets) les secrets des webhooks et CRON_SECRET qu'il faut à config/niche.json, et les pose dans Vercel",
  "  (vercel env add, valeur en entrée standard) : jamais affichés, jamais en argument. Il faut vercel login puis vercel link avant.",
  "  --essai           les NOMS qui seraient posés et ceux à coller toi-même ; rien n'est exécuté",
  "  --copier <NOM>    pose ce secret seulement et copie sa valeur dans le presse-papiers (pour la console du fournisseur)",
  "  --remplacer       tire une nouvelle valeur même si la variable existe déjà dans Vercel",
  "  --environnement   production (par défaut) ou preview",
  "  --config <f>      une autre config que config/niche.json",
].join("\n");

/** Un secret tiré au hasard : `octets` octets en base64url (lettres, chiffres, « - » et « _ » ; 43 caractères pour 32 octets). */
export function tirerSecret(aleatoire = randomBytes, octets = OCTETS_SECRET) {
  return Buffer.from(aleatoire(octets)).toString("base64url");
}

const SUPABASE = [
  { nom: "NEXT_PUBLIC_SUPABASE_URL", ou: "Supabase, Project Settings, API (l'URL du projet)" },
  { nom: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ou: "Supabase, Project Settings, API Keys (la clé publique : anon ou publishable)" },
  { nom: "SUPABASE_SERVICE_ROLE_KEY", ou: "Supabase, Project Settings, API Keys (la clé secrète : service_role ou secret)" },
];

/**
 * Ce que la config demande. aTirer : les secrets que ce script tire et pose (nom, longueur minimale exigée par l'application, à quoi il
 * sert). aColler : les variables que l'utilisateur colle lui-même dans Vercel (créées par Supabase ou par le fournisseur).
 */
export function besoinsSecrets(niche) {
  const aTirer = [];
  const aColler = [...SUPABASE];
  switch (niche.telephonie.fournisseur) {
    case "onoff":
      aTirer.push({ nom: "ONOFF_WEBHOOK_TOKEN", min: 16, usage: "à coller dans la console Onoff (webhook « Call », champ Api key)" });
      aColler.push({ nom: "ONOFF_API_KEY", ou: "console Onoff, Integrations, API keys", facultative: true });
      break;
    case "aircall":
      aColler.push(
        { nom: "AIRCALL_WEBHOOK_TOKEN", ou: "créé et affiché par Aircall à la création du webhook" },
        { nom: "AIRCALL_API_ID", ou: "Aircall, Integrations & API, API keys", facultative: true },
        { nom: "AIRCALL_API_TOKEN", ou: "Aircall, Integrations & API, API keys", facultative: true },
      );
      break;
    case "ringover":
      aTirer.push({ nom: "RINGOVER_WEBHOOK_SECRET", min: 24, usage: "au bout de l'adresse du webhook chez Ringover (?secret=…)" });
      break;
    default:
      break;
  }
  switch (niche.agenda.fournisseur) {
    case "calendly":
      aTirer.push({ nom: "CALENDLY_WEBHOOK_SIGNING_KEY", min: 32, usage: "la clé de signature (signing_key) de l'abonnement Calendly" });
      break;
    case "iclosed":
      aTirer.push({ nom: "ICLOSED_WEBHOOK_SECRET", min: 24, usage: "au bout de l'adresse du webhook chez iClosed (?secret=…)" });
      break;
    case "google":
      aColler.push(
        { nom: "GOOGLE_CLIENT_ID", ou: "Google Cloud Console, Identifiants, ID client OAuth" },
        { nom: "GOOGLE_CLIENT_SECRET", ou: "Google Cloud Console, Identifiants, ID client OAuth" },
        { nom: "GOOGLE_REFRESH_TOKEN", ou: "OAuth 2.0 Playground (docs/agenda.md)" },
        { nom: "GOOGLE_CALENDAR_ID", ou: "paramètres de l'agenda Google (sinon l'agenda principal)", facultative: true },
      );
      break;
    default:
      break;
  }
  if (niche.sources.places?.actif) {
    aColler.push({
      nom: "GOOGLE_PLACES_API_KEY",
      ou: "Google Cloud Console, Identifiants (clé restreinte à Places API (New)) ; sert aux scripts de sourcing, dans .env.local sur ta machine : inutile dans Vercel",
      facultative: true,
    });
  }
  aTirer.push({ nom: "CRON_SECRET", min: 16, usage: "envoyé par Vercel à ses tâches planifiées : il ne se colle nulle part" });
  return { aTirer, aColler };
}

/** Les NOMS attendus présents dans la sortie de « vercel env ls » (première colonne du tableau). La sortie n'est jamais affichée. */
export function nomsPresents(sortie, noms) {
  const presents = new Set();
  for (const ligne of String(sortie).split(/\r?\n/)) {
    const m = /^[\s│|┃]*([A-Z][A-Z0-9_]*)(?=\s|$)/u.exec(ligne);
    if (m && noms.includes(m[1])) presents.add(m[1]);
  }
  return presents;
}

function lignesAColler(aColler) {
  const lignes = ["À coller toi-même dans Vercel (Settings, Environment Variables), si ce n'est pas déjà fait :"];
  for (const v of aColler) lignes.push(`  - ${v.nom}${v.facultative ? " (facultative)" : ""} : ${v.ou}`);
  return lignes;
}

/**
 * Le travail du script, testable : `d` fournit la config (niche), l'exécution des commandes (executer), le tirage (aleatoire), le
 * presse-papiers (plateforme, env), la racine du dépôt et le test d'existence d'un fichier (existe). Renvoie { code, lignes, erreur }.
 */
export function executerSecrets(options, d) {
  const lignes = [];
  const echec = (message) => ({ code: 1, lignes, erreur: message });
  const executer = d.executer ?? executerCommande;
  const racine = d.racine ?? RACINE;
  const existe = d.existe ?? existsSync;
  const environnement = options.environnement ?? "production";
  if (!ENVIRONNEMENTS.includes(environnement)) return echec(`--environnement attend : ${ENVIRONNEMENTS.join(" ou ")}.`);

  const { aTirer, aColler } = besoinsSecrets(d.niche);
  let cibles = aTirer;
  if (options.copier !== undefined) {
    const choisi = aTirer.find((s) => s.nom === options.copier);
    if (!choisi) {
      return echec(`--copier : ce nom n'est pas un secret tiré par ce script pour cette config (possibles : ${aTirer.map((s) => s.nom).join(", ")}).`);
    }
    cibles = [choisi];
  }

  if (options.essai) {
    lignes.push(`Simulation : rien n'est exécuté ni posé (environnement ${environnement}).`);
    for (const s of cibles) lignes.push(`  - ${s.nom} : serait tiré au hasard et posé s'il n'est pas déjà dans Vercel (${s.usage})`);
    if (options.copier !== undefined) lignes.push(`  - ${options.copier} : serait copié dans le presse-papiers, jamais affiché`);
    lignes.push(...lignesAColler(aColler));
    return { code: 0, lignes, erreur: null };
  }

  if (!existe(join(racine, ".vercel", "project.json"))) {
    return echec("Ce dossier n'est lié à aucun projet Vercel : lance « vercel login » puis « vercel link », puis relance.");
  }
  const liste = executer("vercel", ["env", "ls", environnement], { cwd: racine });
  if (liste.introuvable) return echec("Vercel CLI introuvable : installe-la (npm i -g vercel), puis « vercel login » et « vercel link ».");
  if (liste.code !== 0) return echec(`« vercel env ls » a échoué (code ${liste.code}) : vérifie « vercel login » et « vercel link ».`);
  const presents = nomsPresents(`${liste.sortie}\n${liste.erreur}`, cibles.map((s) => s.nom));

  let valeurCopiee = null;
  for (const s of cibles) {
    const present = presents.has(s.nom);
    if (present && !options.remplacer) {
      lignes.push(`${s.nom} : déjà dans Vercel (${environnement}), gardée (--remplacer en tire une nouvelle)`);
      continue;
    }
    const valeur = tirerSecret(d.aleatoire);
    const args = ["env", "add", s.nom, environnement, "--sensitive", "--yes", ...(present ? ["--force"] : [])];
    const r = executer("vercel", args, { entree: valeur, cwd: racine });
    if (r.code !== 0) {
      return echec(`${s.nom} : « vercel env add » a échoué (code ${r.code}) ; les variables des lignes précédentes sont posées, pas celle-ci.`);
    }
    lignes.push(`${s.nom} : ${present ? "remplacée" : "posée"} dans Vercel (${environnement}) : ${s.usage}`);
    if (options.copier === s.nom) valeurCopiee = valeur;
  }

  if (options.copier !== undefined) {
    if (valeurCopiee === null) {
      return echec(
        `${options.copier} est déjà dans Vercel et sa valeur n'est jamais relue : « --remplacer --copier ${options.copier} » en tire une nouvelle (à recoller chez le fournisseur, puis redéployer).`,
      );
    }
    const copie = copierPressePapiers(valeurCopiee, { executer, plateforme: d.plateforme, env: d.env });
    if (!copie.ok) {
      return echec(
        `${options.copier} est posée, mais la copie a échoué (aucun outil : pbcopy, clip, wl-copy ou xclip) ; installe-en un, puis « --remplacer --copier ${options.copier} ».`,
      );
    }
    const usage = cibles[0].usage;
    lignes.push(`${options.copier} : copiée dans le presse-papiers (jamais affichée) ; colle-la maintenant : ${usage}`);
  }

  lignes.push(...lignesAColler(aColler));
  lignes.push("Redéploie pour que les variables comptent : vercel deploy --prod");
  return { code: 0, lignes, erreur: null };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--essai": "booleen",
      "--copier": "texte",
      "--remplacer": "booleen",
      "--environnement": ENVIRONNEMENTS,
      "--config": "texte",
    });
    if (options.aide || positionnels.length > 0) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const r = executerSecrets(options, { niche });
    afficher(r.lignes);
    if (r.erreur) console.error(`ERREUR : ${r.erreur}`);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();

