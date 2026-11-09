// La lecture par pages (lib/poste/pages.ts) : Supabase coupe toute réponse à 1 000 lignes (max_rows) ; un faux client qui fait de même
// montre que les appels du jour et les retours ne sont plus tronqués en silence, et que « tronqué » dit vrai.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TAILLE_PAGE_POSTGREST, lirePages } from "../lib/poste/pages.ts";
import { lire } from "./aides.mjs";

/** Un faux PostgREST : `total` lignes, jamais plus de 1 000 par réponse (comme max_rows), quelle que soit la plage demandée. */
function fauxPostgrest(total, { panneA = null } = {}) {
  const demandes = [];
  const page = async (de, a) => {
    demandes.push([de, a]);
    if (panneA !== null && de >= panneA) return { data: null, error: { code: "57014" } };
    const fin = Math.min(a + 1, total, de + 1000);
    return { data: Array.from({ length: Math.max(0, fin - de) }, (_, i) => ({ n: de + i })), error: null };
  };
  return { page, demandes };
}

test("par pages : 1 500 lignes derrière un plafond de 1 000 sont toutes lues, sans « tronqué »", async () => {
  const f = fauxPostgrest(1500);
  const r = await lirePages(f.page, { max: 5000 });
  assert.equal(r.error, null);
  assert.equal(r.lignes.length, 1500);
  assert.deepEqual(r.lignes.at(-1), { n: 1499 });
  assert.equal(r.tronque, false);
  assert.deepEqual(f.demandes, [[0, 999], [1000, 1999]]);
  // L'ancienne lecture (une requête « limit 5000 ») n'en voyait que 1 000, et ne disait pas qu'il en manquait.
  const ancienne = await f.page(0, 4999);
  assert.equal(ancienne.data.length, TAILLE_PAGE_POSTGREST);
});

test("par pages : le plafond de l'écran atteint, « tronqué » ; une page en erreur arrête la lecture ; peu de lignes, une requête", async () => {
  const plein = fauxPostgrest(7000);
  const r = await lirePages(plein.page, { max: 5000 });
  assert.equal(r.lignes.length, 5000);
  assert.equal(r.tronque, true);
  assert.equal(plein.demandes.length, 5);
  const panne = await lirePages(fauxPostgrest(3000, { panneA: 1000 }).page, { max: 5000 });
  assert.deepEqual([panne.error, panne.lignes.length, panne.tronque], [{ code: "57014" }, 1000, false]);
  const peu = fauxPostgrest(12);
  assert.equal((await lirePages(peu.page, { max: 5000 })).lignes.length, 12);
  assert.equal(peu.demandes.length, 1);
});

test("les appels du jour (Poste, objectif) et les lignes des retours se lisent par pages, triées sur une clé stable", () => {
  const file = lire("app/_actions/file.ts");
  assert.equal((file.match(/lirePages\(/g) ?? []).length, 2);
  assert.doesNotMatch(file, /\.limit\(LIMITE_APPELS_JOUR\)/);
  assert.match(file, /\.order\("cree_le", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)\s*\.range\(de, a\)/);
  const retours = lire("app/(app)/retours/donnees.ts");
  assert.match(retours, /lirePages\(\(de, a\) => lignesQuery\(\)/);
  assert.match(retours, /vue\.tronque = lignes\.tronque;/);
});
