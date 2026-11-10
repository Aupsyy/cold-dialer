// scripts/niche/naf.mjs : propose des codes NAF à partir de mots, sans réseau.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { chercherNaf } from "../scripts/niche/naf.mjs";
import { RACINE } from "./aides.mjs";

const premier = (mots) => chercherNaf(mots)[0]?.code;

test("naf.mjs trouve le code attendu pour le métier de chaque niche prête", () => {
  assert.equal(premier("paysagiste"), "81.30Z");
  assert.equal(premier("piscine"), "43.99D");
  assert.equal(premier("expert-comptable"), "69.20Z");
  assert.equal(premier("agence immobilière"), "68.31Z");
  assert.equal(premier("dentiste"), "86.23Z");
  assert.equal(premier("contrôle technique"), "71.20A");
  assert.equal(premier("garagiste"), "45.20A");
  assert.equal(premier("traiteur"), "56.21Z");
  assert.equal(premier("isolation"), "43.29A");
  assert.equal(premier("agenceur"), "43.32C");
  assert.ok(chercherNaf("cuisiniste").some((x) => x.code === "47.59A") && chercherNaf("cuisiniste").some((x) => x.code === "31.02Z"));
  assert.ok(chercherNaf("menuisier").some((x) => x.code === "43.32A"));
});

test("naf.mjs ignore les accents, la casse et les pluriels ; rien pour des mots inconnus", () => {
  assert.equal(premier("PISCINES"), "43.99D");
  assert.equal(premier("Kiné"), "86.90E");
  assert.equal(premier("controle technique"), "71.20A");
  assert.deepEqual(chercherNaf("zzzzqx"), []);
  assert.deepEqual(chercherNaf(""), []);
  assert.ok(chercherNaf("garage", { max: 1 }).length === 1);
});

function lancer(...args) {
  return spawnSync(process.execPath, ["scripts/niche/naf.mjs", ...args], { cwd: RACINE, encoding: "utf8" });
}

test("la commande : codes et libellés en sortie, --aide, code de sortie 1 sans résultat", () => {
  const r = lancer("traiteur");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /56\.21Z\s+Services des traiteurs/);
  assert.equal(lancer("--aide").status, 0);
  assert.equal(lancer("zzzzqx").status, 1);
  assert.equal(lancer().status, 1);
  assert.equal(lancer("--inconnue").status, 1);
});
