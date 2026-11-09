// Les tests tournent toujours sur la niche d'exemple (scripts/charger-ts.mjs remplace config/niche.json par config/niche.exemple.json au
// chargement) : « npm test » passe dans le dépôt de chaque utilisateur, quelle que soit sa configuration. La vraie config est validée à
// part (tests/config-schema.test.mjs la lit sur le disque) et par le build.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lire } from "./aides.mjs";

test("un import de config/niche.json donne la niche d'exemple pendant les tests", async () => {
  const { default: importee } = await import("../config/niche.json");
  assert.deepEqual(importee, JSON.parse(lire("config/niche.exemple.json")));
  const { niche } = await import("../config/niche.ts");
  assert.equal(niche.marque.nomEquipe, importee.marque.nomEquipe);
});
