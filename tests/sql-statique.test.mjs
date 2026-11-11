// Contrôles statiques de la base (sans base de données) : chaque table a sa RLS et son test, chaque fonction SECURITY DEFINER a son
// search_path, rien n'est accordé à anon, la fixture des tests est la même partout, la graine reste fictive.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { RACINE, lire } from "./aides.mjs";

const SQL = lire("supabase/migrations/0001_schema.sql");
const TABLES = [...SQL.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);

test("les 13 tables du plan", () => {
  assert.deepEqual([...TABLES].sort(), [
    "appels", "debriefs", "imports", "integrations_evenements", "invitations", "lead_activities", "leads", "opposition", "profiles",
    "reglages", "rendez_vous", "retours_marche", "workspaces",
  ]);
});

test("chaque table : RLS activée et un fichier de test", () => {
  const tests = readdirSync(new URL("supabase/tests/", RACINE));
  for (const t of TABLES) {
    assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security;`), `RLS absente : ${t}`);
    assert.ok(tests.includes(`${t}.sql`), `test absent : supabase/tests/${t}.sql`);
  }
});

test("chaque fonction a un search_path fixé (public, pg_temp)", () => {
  const fonctions = SQL.split(/create or replace function /).slice(1);
  assert.ok(fonctions.length > 30);
  for (const f of fonctions) {
    const entete = f.slice(0, f.indexOf("as $$"));
    assert.match(entete, /set search_path = public, pg_temp/, `search_path manquant : ${f.slice(0, 60)}`);
  }
});

test("rien pour anon : aucune politique ni aucun grant pour anon, et la révocation générale est là", () => {
  assert.doesNotMatch(SQL, /to\s+anon\b/i);
  assert.doesNotMatch(SQL, /grant[^;]*\banon\b/i);
  assert.match(SQL, /revoke all on all tables in schema public from anon, authenticated;/);
  assert.match(SQL, /revoke all on all functions in schema public from public, anon, authenticated;/);
  for (const m of SQL.matchAll(/create policy \w+ on [\w.]+ for \w+ to (\w+)/g)) assert.equal(m[1], "authenticated");
});

test("les migrations suivantes ferment chaque nouvelle fonction (PostgreSQL l'ouvre à tous par défaut)", () => {
  const migrations = readdirSync(new URL("supabase/migrations/", RACINE)).filter((f) => f.endsWith(".sql") && f !== "0001_schema.sql");
  for (const m of migrations) {
    const texte = lire(`supabase/migrations/${m}`);
    for (const f of texte.matchAll(/create (?:or replace )?function (public\.\w+)/g)) {
      assert.match(texte, new RegExp(`revoke [^;]*on function ${f[1].replace(".", "\\.")}[^;]*from public, anon`), `${m} : ${f[1]} non révoquée`);
    }
  }
});

test("la fixture est la même dans chaque test SQL (copie de supabase/tests/_fixture.sql)", () => {
  const fixture = lire("supabase/tests/_fixture.sql").trim();
  const fichiers = readdirSync(new URL("supabase/tests/", RACINE)).filter((f) => f.endsWith(".sql") && !f.startsWith("_"));
  assert.ok(fichiers.length >= 13, "au moins un test SQL par table du socle (13), plus ceux des lots suivants");
  for (const f of fichiers) {
    const texte = lire(`supabase/tests/${f}`);
    assert.ok(texte.includes(fixture), `${f} : fixture absente ou modifiée`);
    const nu = texte.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim();
    assert.match(nu, /^begin;/, `${f} : doit commencer par begin;`);
    assert.match(nu, /rollback;$/, `${f} : doit finir par rollback;`);
  }
});

test("la graine de démonstration : sans transaction, données fictives seulement", () => {
  const graine = lire("supabase/seed-demo.sql");
  assert.doesNotMatch(graine.replace(/--.*$/gm, ""), /\b(begin|commit)\s*;/i);
  for (const m of graine.matchAll(/@([a-z0-9.-]+)/gi)) assert.match(m[1], /^example\.(com|org)$/, m[0]);
  for (const m of graine.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.equal(m[1], "example.org");
  for (const m of graine.matchAll(/'\+33(\d{5})/g)) assert.ok(["19900", "63998"].includes(m[1]), `numéro hors plage fictive : ${m[0]}`);
});

// ---- Migration 0002 : le branchement à la session commune ----------------------------------------------------------------------
const SQL2 = lire("supabase/migrations/0002_concours_branchement.sql");

test("0002 : une table, RLS activée, son test SQL, aucun droit pour anon ni authenticated", () => {
  assert.deepEqual([...SQL2.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]), ["concours_branchement"]);
  assert.match(SQL2, /alter table public\.concours_branchement enable row level security;/);
  assert.ok(readdirSync(new URL("supabase/tests/", RACINE)).includes("concours_branchement.sql"));
  assert.match(SQL2, /revoke all on public\.concours_branchement from public, anon, authenticated;/);
  assert.doesNotMatch(SQL2, /grant[^;]*on (?:table )?public\.concours_branchement[^;]*to[^;]*\b(anon|authenticated)\b/i, "aucun droit de table pour les comptes");
  assert.doesNotMatch(SQL2, /create policy/, "aucune politique : la table n'est lisible que par la clé service et les fonctions");
  assert.doesNotMatch(SQL2, /to\s+anon\b|grant[^;]*\banon\b/i);
});

test("0002 : additive et rejouable (rien de supprimé ni de modifié dans le schéma de 0001)", () => {
  const nu = SQL2.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(nu, /\b(drop table|drop column|alter table public\.(?!concours_branchement)|truncate|delete from public\.(?!concours_branchement))/i);
  assert.match(nu, /create table if not exists/);
  for (const f of nu.matchAll(/create (?!or replace)(function|index|policy|trigger)/gi)) assert.fail(`non rejouable : create ${f[1]} sans « or replace » ni « if not exists »`);
});

test("0002 : chaque fonction a son search_path fixé, est fermée à public et anon, et le jeton ne sort que par la clé service", () => {
  const fonctions = nuFonctions(SQL2);
  assert.ok(fonctions.length >= 5);
  for (const f of fonctions) {
    assert.match(f.entete, /set search_path = public, pg_temp/, `search_path manquant : ${f.nom}`);
    assert.match(SQL2, new RegExp(`revoke all on function public\\.${f.nom}\\([^)]*\\) from public, anon`), `${f.nom} non révoquée`);
  }
  assert.match(SQL2, /grant execute on function public\.concours_jeton_serveur\(uuid\) to service_role;/);
  assert.doesNotMatch(SQL2, /grant execute on function public\.concours_jeton_serveur\([^)]*\) to[^;]*authenticated/);
  assert.match(SQL2, /revoke all on function public\.concours_jeton_serveur\(uuid\) from public, anon, authenticated;/);
  const etat = fonctions.find((f) => f.nom === "concours_etat").corps;
  assert.doesNotMatch(etat.replace(/--.*$/gm, ""), /\bc\.jeton\b|'jeton'/, "concours_etat ne rend jamais le jeton");
  for (const nom of ["concours_poser", "concours_retirer"]) {
    assert.match(fonctions.find((f) => f.nom === nom).corps, /not public\.est_gestionnaire\(\)/, `${nom} : réservée aux gestionnaires`);
  }
  assert.match(SQL2, /select 2\b/, "version_schema passe à 2");
});

function nuFonctions(sql) {
  return sql
    .split(/create or replace function public\./)
    .slice(1)
    .map((f) => ({ nom: /^(\w+)/.exec(f)[1], entete: f.slice(0, f.indexOf("as $$")), corps: f.slice(f.indexOf("as $$")) }));
}
