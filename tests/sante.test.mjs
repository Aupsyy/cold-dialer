// /api/sante ne renvoie que des booléens (lib/sante.ts).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { etatSante, sonderBase, VERSION_SCHEMA } from "../lib/sante.ts";
import { lire } from "./aides.mjs";

function feuilles(objet) {
  return Object.values(objet).flatMap((v) => (v !== null && typeof v === "object" ? feuilles(v) : [v]));
}

const ENV_COMPLET = {
  NEXT_PUBLIC_SUPABASE_URL: "https://projet-test.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "x",
  SUPABASE_SERVICE_ROLE_KEY: "aaaa-bbbb-cccc",
};

test("que des booléens, jamais une valeur", () => {
  const s = etatSante({ env: ENV_COMPLET, sondage: { baseJoignable: true, versionSchema: VERSION_SCHEMA }, configValide: true,
    variablesTelephonie: [], variablesAgenda: [] });
  assert.ok(feuilles(s).every((v) => typeof v === "boolean"));
  assert.equal(s.ok, true);
  assert.ok(!JSON.stringify(s).includes("aaaa-bbbb-cccc"));
});

test("une variable absente, un schéma en retard, une base injoignable : ok passe à faux", () => {
  const base = { sondage: { baseJoignable: true, versionSchema: VERSION_SCHEMA }, configValide: true, variablesTelephonie: [], variablesAgenda: [] };
  assert.equal(etatSante({ ...base, env: { ...ENV_COMPLET, SUPABASE_SERVICE_ROLE_KEY: " " } }).variables.supabase_cle_service, false);
  assert.equal(etatSante({ ...base, env: ENV_COMPLET, sondage: { baseJoignable: true, versionSchema: 0 } }).schema_a_jour, false);
  assert.equal(etatSante({ ...base, env: ENV_COMPLET, sondage: { baseJoignable: false, versionSchema: null } }).ok, false);
  const tel = etatSante({ ...base, env: ENV_COMPLET, variablesTelephonie: ["ONOFF_WEBHOOK_TOKEN"] });
  assert.equal(tel.variables.telephonie, false);
  assert.equal(tel.ok, false);
});

test("le sondage de la base : statut 0 = réseau coupé ; une réponse d'erreur = base joignable mais schéma inconnu", async () => {
  assert.deepEqual(await sonderBase(null), { baseJoignable: false, versionSchema: null });
  assert.deepEqual(await sonderBase(async () => ({ data: null, error: { message: "fetch failed" }, status: 0 })), { baseJoignable: false, versionSchema: null });
  assert.deepEqual(await sonderBase(async () => ({ data: null, error: { code: "PGRST202" }, status: 404 })), { baseJoignable: true, versionSchema: null });
  assert.deepEqual(await sonderBase(async () => ({ data: 1, error: null, status: 200 })), { baseJoignable: true, versionSchema: 1 });
  assert.deepEqual(await sonderBase(async () => { throw new Error("délai"); }), { baseJoignable: false, versionSchema: null });
});

test("la version attendue est celle de la dernière migration qui la pose", () => {
  const poses = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql") && /function public\.version_schema\(\)/.test(lire(`supabase/migrations/${f}`)))
    .sort();
  assert.match(lire(`supabase/migrations/${poses.at(-1)}`), new RegExp(`function public\\.version_schema\\(\\)[\\s\\S]*?select ${VERSION_SCHEMA}\\b`));
  assert.equal(poses.at(-1), "0002_concours_branchement.sql");
});
