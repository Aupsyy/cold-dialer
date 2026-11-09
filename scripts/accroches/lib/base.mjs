// La connexion à la base : SUPABASE_DB_URL, lue dans l'environnement ou dans .env.local (à la racine du dépôt). Sa valeur n'est JAMAIS
// affichée : une erreur de connexion ne montre que son code (ECONNREFUSED, 28P01…).
//
// Le chiffrement : aucun vers une base locale ; vers une base distante, le certificat du serveur est vérifié quand SUPABASE_DB_CA
// désigne son certificat racine (le chemin d'un fichier .crt ou .pem, ou son texte « -----BEGIN CERTIFICATE----- … ») ; sans elle, la
// connexion reste chiffrée SANS vérification du certificat, et le script le dit (un intermédiaire actif, sur un Wi-Fi hostile, pourrait
// lire ou modifier les fiches). Le certificat racine se télécharge depuis le tableau de bord de Supabase (réglages de la base, SSL).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ErreurOptions } from "./args.mjs";
import { RACINE } from "./chemins.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'adresse de la base, ou null si elle n'est nulle part. */
export function adresseBase() {
  if (!process.env.SUPABASE_DB_URL) {
    const fichier = join(RACINE, ".env.local");
    if (existsSync(fichier)) {
      try {
        process.loadEnvFile(fichier);
      } catch {
        // fichier illisible : la variable reste absente
      }
    }
  }
  return process.env.SUPABASE_DB_URL || null;
}

/** Vrai pour une base sur cette machine (supabase start, base de test). */
export function baseLocale(adresse) {
  return /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(String(adresse));
}

/**
 * Les options TLS de la connexion : false pour une base locale ; { ca, rejectUnauthorized: true } si SUPABASE_DB_CA est donnée ; sinon
 * { rejectUnauthorized: false } et un avertissement (jamais la valeur d'une variable).
 * @param {string} adresse
 * @param {{ ca?: string, avertir?: (message: string) => void }} [options]
 */
export function optionsTls(adresse, { ca = process.env.SUPABASE_DB_CA, avertir = (m) => console.warn(m) } = {}) {
  if (baseLocale(adresse)) return false;
  const valeur = String(ca ?? "").trim();
  if (valeur) {
    let certificat = valeur;
    if (!valeur.startsWith("-----BEGIN")) {
      try {
        certificat = readFileSync(valeur, "utf8");
      } catch {
        throw new Error("SUPABASE_DB_CA : certificat illisible (attendu : le chemin du certificat racine, ou son texte)");
      }
    }
    if (!certificat.includes("-----BEGIN CERTIFICATE-----")) throw new Error("SUPABASE_DB_CA : ce n'est pas un certificat (format PEM)");
    return { ca: certificat, rejectUnauthorized: true };
  }
  avertir(
    "Attention : SUPABASE_DB_CA absente. La connexion à la base est chiffrée mais le certificat du serveur n'est pas vérifié ; " +
      "pose SUPABASE_DB_CA (le certificat racine de Supabase) pour le vérifier.",
  );
  return { rejectUnauthorized: false };
}

export async function connecter(adresse = adresseBase()) {
  if (!adresse) {
    throw new Error("SUPABASE_DB_URL manquante : mets l'adresse de la base dans .env.local (elle n'est jamais affichée).");
  }
  const client = new pg.Client({ connectionString: adresse, ssl: optionsTls(adresse) });
  try {
    await client.connect();
  } catch (e) {
    await client.end().catch(() => {});
    throw new Error(`connexion à la base impossible (code ${e?.code ?? "inconnu"})`);
  }
  return client;
}

/**
 * L'équipe d'un script : celle demandée par --workspace (elle doit exister), sinon la seule de la base ; s'il y en a plusieurs,
 * --workspace est obligatoire (la même règle que scripts/sourcing/importer.mjs).
 * @returns {Promise<string>} l'identifiant de l'équipe
 */
export async function resoudreEquipe(client, demande = null) {
  if (demande !== null && demande !== undefined) {
    if (!UUID.test(String(demande))) throw new ErreurOptions("--workspace attend l'identifiant (uuid) d'une équipe");
    const { rows } = await client.query("select id::text as id from public.workspaces where id = $1::uuid", [String(demande)]);
    if (rows.length === 0) throw new Error("Équipe inconnue : vérifie l'identifiant donné à --workspace.");
    return rows[0].id;
  }
  const { rows } = await client.query("select id::text as id from public.workspaces order by created_at, id limit 2");
  if (rows.length === 0) throw new Error("Aucune équipe dans cette base : crée d'abord le compte propriétaire (installation), puis relance.");
  if (rows.length > 1) throw new Error("Cette base a plusieurs équipes : précise laquelle avec --workspace <identifiant>.");
  return rows[0].id;
}
