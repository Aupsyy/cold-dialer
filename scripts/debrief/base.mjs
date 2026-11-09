// La base pour les scripts du débrief : la connexion (SUPABASE_DB_URL, jamais affichée), le compte de l'appelant, et le passage sous son
// identité (rôle « authenticated » et identité du jeton, comme une requête de l'application) : chaque lecture et chaque écriture passe
// alors par la RLS, les déclencheurs et les fonctions de l'application. Seules quelques lectures se font avec la connexion du script
// (le compte, l'appel par son identifiant, sa conservation), avant de prendre l'identité de l'appelant.
// Les erreurs ne sont rapportées que par leur code SQL (jamais un message de la base, qui peut contenir une valeur).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionsTls } from "../accroches/lib/base.mjs";
import { estUuid } from "./lib.mjs";

export const RACINE = fileURLToPath(new URL("../../", import.meta.url));

/** Charge .env.local (à la racine du dépôt) si SUPABASE_DB_URL n'est pas déjà dans l'environnement. Rien n'est affiché. */
export function chargerEnvLocal(env = process.env) {
  if (env.SUPABASE_DB_URL) return;
  const chemin = `${RACINE}.env.local`;
  if (!existsSync(chemin)) return;
  try {
    process.loadEnvFile(chemin);
  } catch {
    // fichier illisible : la suite dira que SUPABASE_DB_URL manque
  }
}

export function estUrlLocale(url) {
  return /@(127\.0\.0\.1|localhost)[:/]/.test(url);
}

/**
 * La configuration de pg : rien en local ; vers une base distante, TLS avec le certificat vérifié si SUPABASE_DB_CA est posée (sinon un
 * avertissement, sans aucune valeur). La même règle que les autres scripts : optionsTls (scripts/accroches/lib/base.mjs).
 */
export function configurationPg(url, env = process.env) {
  return { connectionString: url, ssl: optionsTls(url, { ca: env.SUPABASE_DB_CA }) };
}

/** Un client pg connecté, ou une raison (sans jamais citer l'URL). */
export async function ouvrirConnexion(env = process.env) {
  const url = env.SUPABASE_DB_URL ?? "";
  if (!url) return { ok: false, raison: "SUPABASE_DB_URL manquante (dans .env.local, posée à l'installation)" };
  const { default: pg } = await import("pg");
  let configuration;
  try {
    configuration = configurationPg(url, env);
  } catch {
    return { ok: false, raison: "SUPABASE_DB_CA illisible (le chemin du certificat racine, ou son texte PEM)" };
  }
  const client = new pg.Client(configuration);
  try {
    await client.connect();
  } catch (e) {
    return { ok: false, raison: `connexion à la base impossible (${e?.code ?? "sans code"})` };
  }
  return { ok: true, client };
}

/** Le message d'une erreur de base : son code SQL et, s'il y en a une, la contrainte en cause. Jamais le texte de la base. */
export function codeErreur(e) {
  const code = typeof e?.code === "string" ? e.code : "sans code";
  const contrainte = typeof e?.constraint === "string" ? `, contrainte ${e.constraint}` : "";
  const sens =
    {
      "42501": "refusé par la base (droits du compte ou RLS)",
      "23514": "refusé par une règle de la base (liste d'opposition ou contrainte)",
      "23505": "existe déjà (doublon)",
      "23503": "lien vers une ligne d'une autre équipe ou absente",
      P0002: "introuvable",
      "22023": "valeur refusée par la base",
    }[code] ?? "erreur de la base";
  return `${sens} (code ${code}${contrainte})`;
}

/**
 * Le compte qui a passé l'appel : par son e-mail (de connexion ou chez le fournisseur de téléphonie) ou son identifiant. Sans choix :
 * le seul compte de l'instance. Renvoie { ok, profil: { id, workspace_id, role } } ou { ok: false, raison, n }.
 */
export async function resoudreAppelant(client, choix) {
  let lignes;
  if (choix && estUuid(choix)) {
    lignes = (await client.query("select p.id, p.workspace_id, p.role from public.profiles p where p.id = $1", [choix.toLowerCase()])).rows;
  } else if (choix) {
    lignes = (
      await client.query(
        `select distinct p.id, p.workspace_id, p.role from public.profiles p
          where lower(p.email) = lower($1) or lower(p.email_telephonie) = lower($1)`,
        [String(choix).trim()],
      )
    ).rows;
  } else {
    lignes = (await client.query("select p.id, p.workspace_id, p.role from public.profiles p order by p.created_at limit 3")).rows;
  }
  if (lignes.length === 1) return { ok: true, profil: lignes[0] };
  if (lignes.length === 0) {
    return { ok: false, n: 0, raison: choix ? "aucun compte ne correspond à --appelant" : "aucun compte dans la base (crée d'abord le compte propriétaire)" };
  }
  return {
    ok: false,
    n: lignes.length,
    raison: choix ? "plusieurs comptes correspondent à --appelant : donne son identifiant" : "plusieurs comptes dans l'équipe : précise --appelant <e-mail>",
  };
}

/** Prend l'identité d'un compte pour la suite de la transaction en cours (rôle authenticated, identité du jeton). */
export async function connecterComme(client, uid) {
  await client.query("select set_config('role', 'none', true)");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await client.query("select set_config('role', 'authenticated', true)");
}

/** Revient à la connexion du script (fin de l'identité empruntée) dans la transaction en cours. */
export async function redevenirScript(client) {
  await client.query("select set_config('role', 'none', true)");
  await client.query("select set_config('request.jwt.claims', '', true)");
}

/** Une transaction : « begin », ou un point de sauvegarde si l'appelant (un test) en a déjà ouvert une. */
export async function ouvrirTransaction(client, imbriquee) {
  await client.query(imbriquee ? "savepoint debrief" : "begin");
}

export async function annulerTransaction(client, imbriquee) {
  if (imbriquee) {
    await client.query("rollback to savepoint debrief");
    await client.query("release savepoint debrief");
  } else {
    await client.query("rollback");
  }
}

export async function validerTransaction(client, imbriquee) {
  await client.query(imbriquee ? "release savepoint debrief" : "commit");
  if (imbriquee) await redevenirScript(client);
}

/** Charge config/niche.json, validée par config/charger.ts (schéma et garde-fous), en lisant le TypeScript du dépôt. */
export async function chargerConfig() {
  const { readFileSync } = await import("node:fs");
  await import("../charger-ts.mjs");
  const { chargerNiche } = await import("../../config/charger.ts");
  return chargerNiche(JSON.parse(readFileSync(`${RACINE}config/niche.json`, "utf8")));
}
