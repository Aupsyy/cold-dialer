// Joue les tests SQL sur la base SUPABASE_DB_URL : la base locale de « supabase start »
// (postgresql://postgres:postgres@127.0.0.1:54322/postgres) ou un projet Supabase de TEST, jamais une base de production.
//
//   1. supabase/tests/<table>.sql : chaque fichier ouvre sa transaction (begin) et l'annule (rollback) ; rien n'est gardé. Le lanceur
//      refuse un fichier qui ne commence pas par « begin; » ou ne finit pas par « rollback; ».
//   2. supabase/seed-demo.sql : joué dans une transaction annulée, puis vérifié 100 % fictif (SIREN invalides, numéros de la plage
//      réservée à la fiction, e-mails example.com, sites example.org).
// Chaque vérification réussie envoie un avis « OK : … » ; la première en échec arrête son fichier avec « ECHEC : … ».
// La valeur de SUPABASE_DB_URL n'est jamais affichée.
//
// Usage : SUPABASE_DB_URL=… npm run test:sql   (ou la variable dans .env.local, lue par Node : --env-file-if-exists)

import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { optionsTls } from "./accroches/lib/base.mjs";

const URL_BASE = process.env.SUPABASE_DB_URL ?? "";
if (!URL_BASE) {
  console.error("SUPABASE_DB_URL manquante : l'URL de la base de TEST (supabase start : postgresql://postgres:postgres@127.0.0.1:54322/postgres).");
  process.exit(1);
}
const locale = /@(127\.0\.0\.1|localhost)[:/]/.test(URL_BASE);
if (!locale && process.env.TEST_SQL_DISTANT !== "1") {
  console.error("SUPABASE_DB_URL n'est pas une base locale : les tests SQL ne tournent sur une base distante de TEST qu'avec TEST_SQL_DISTANT=1 (jamais une base de production).");
  process.exit(1);
}
// Vers une base distante, le certificat est vérifié quand SUPABASE_DB_CA est posé (scripts/accroches/lib/base.mjs).
const configuration = { connectionString: URL_BASE, ssl: optionsTls(URL_BASE) };

const DOSSIER = new URL("../supabase/tests/", import.meta.url);
const GRAINE = new URL("../supabase/seed-demo.sql", import.meta.url);

/** Vrai si un SIREN (9 chiffres) passe la clé de Luhn : un SIREN réel. Les fiches de démonstration doivent toutes échouer. */
function sirenValide(siren) {
  if (!/^\d{9}$/.test(siren)) return false;
  let somme = 0;
  for (let i = 0; i < 9; i++) {
    let c = Number(siren[8 - i]);
    if (i % 2 === 1) c = c * 2 > 9 ? c * 2 - 9 : c * 2;
    somme += c;
  }
  return somme % 10 === 0;
}

function sansCommentaires(sql) {
  return sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n")
    .trim();
}

async function jouerFichier(nom) {
  const sql = readFileSync(new URL(nom, DOSSIER), "utf8");
  const nu = sansCommentaires(sql);
  if (!/^begin;/i.test(nu) || !/rollback;$/i.test(nu)) {
    return { ok: false, verifications: 0, erreur: "le fichier doit commencer par « begin; » et finir par « rollback; »" };
  }
  const client = new pg.Client(configuration);
  const reussies = [];
  client.on("notice", (avis) => {
    if (avis.message.startsWith("OK : ")) reussies.push(avis.message.slice(5));
  });
  try {
    await client.connect();
  } catch (e) {
    // Rien d'autre que le code : le message d'un serveur peut porter l'adresse ou le compte.
    return { ok: false, verifications: 0, erreur: `connexion impossible (${e.code ?? "sans code"})` };
  }
  try {
    await client.query(sql);
    return { ok: true, verifications: reussies.length };
  } catch (e) {
    return { ok: false, verifications: reussies.length, erreur: e.message, derniere: reussies.at(-1) };
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

async function verifierGraine() {
  const client = new pg.Client(configuration);
  try {
    await client.connect();
  } catch (e) {
    return { ok: false, fiches: 0, problemes: [`connexion impossible (${e.code ?? "sans code"})`] };
  }
  try {
    await client.query("begin");
    await client.query(readFileSync(GRAINE, "utf8"));
    const { rows } = await client.query(
      "select siren, telephone, mobile, email, site from public.leads where entreprise like 'Atelier Démo %'",
    );
    const problemes = [];
    if (rows.length < 30) problemes.push(`${rows.length} fiches de démonstration seulement (30 au moins attendues)`);
    for (const r of rows) {
      if (r.siren && sirenValide(r.siren)) problemes.push(`SIREN valide (donc peut-être réel) : ${r.siren}`);
      if (r.telephone && !/^\+3319900\d{4}$/.test(r.telephone)) problemes.push(`téléphone hors plage fictive : ${r.telephone}`);
      if (r.mobile && !/^\+3363998\d{4}$/.test(r.mobile)) problemes.push(`mobile hors plage fictive : ${r.mobile}`);
      if (r.email && !/@example\.com$/.test(r.email)) problemes.push(`e-mail hors example.com : ${r.email}`);
      if (r.site && !/^https:\/\/example\.org\//.test(r.site)) problemes.push(`site hors example.org : ${r.site}`);
    }
    return { ok: problemes.length === 0, fiches: rows.length, problemes };
  } catch (e) {
    return { ok: false, fiches: 0, problemes: [e.message] };
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

const fichiers = readdirSync(DOSSIER)
  .filter((f) => f.endsWith(".sql") && !f.startsWith("_"))
  .sort();
let echecs = 0;
let total = 0;
for (const f of fichiers) {
  const r = await jouerFichier(f);
  total += r.verifications;
  if (r.ok) {
    console.log(`✓ ${f} : ${r.verifications} vérifications`);
  } else {
    echecs++;
    console.error(`✗ ${f} : ${r.erreur}`);
    if (r.derniere) console.error(`  (dernière vérification réussie : ${r.derniere})`);
  }
}
const graine = await verifierGraine();
if (graine.ok) {
  console.log(`✓ seed-demo.sql : ${graine.fiches} fiches, toutes fictives`);
} else {
  echecs++;
  console.error(`✗ seed-demo.sql :\n  - ${graine.problemes.join("\n  - ")}`);
}
console.log(`\nRÉSULTAT : ${fichiers.length} fichiers, ${total} vérifications réussies, ${echecs} en échec.`);
process.exit(echecs === 0 ? 0 : 1);
