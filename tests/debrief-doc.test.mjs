// docs/debrief.md reste juste : ses exemples JSON passent la validation, sa note datée est celle que le script compose, et il cite tous
// les codes de la config d'exemple. Aucun tiret cadratin dans les fichiers du lot.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { composerNote, validerDebrief } from "../scripts/debrief/lib.mjs";
import { exemple, lire } from "./aides.mjs";

const DOC = lire("docs/debrief.md");
const niche = chargerNiche(exemple());
const blocs = (langage) => [...DOC.matchAll(new RegExp("```" + langage + "\\n([\\s\\S]*?)\\n```", "g"))].map((m) => m[1]);

test("les exemples JSON de docs/debrief.md sont valides contre la config d'exemple", () => {
  const exemples = blocs("json");
  assert.equal(exemples.length, 2);
  for (const texte of exemples) {
    const v = validerDebrief(JSON.parse(texte), niche, { maintenant: Date.parse("2026-11-09T16:00:00+01:00") });
    assert.equal(v.ok, true, v.erreurs.join("\n"));
  }
});

test("la note datée de docs/debrief.md est exactement celle que compose le script", () => {
  const d = validerDebrief(JSON.parse(blocs("json")[0]), niche, { maintenant: Date.parse("2026-11-09T16:00:00+01:00") }).donnees;
  assert.equal(composerNote(d, niche).replace(/[^\S\n]/gu, " "), blocs("text")[0]);
});

test("docs/debrief.md cite chaque issue, chaque objection et chaque champ de la config d'exemple", () => {
  for (const i of niche.issues) assert.ok(DOC.includes(`\`${i.code}\``), `issue absente : ${i.code}`);
  for (const o of niche.objections) assert.ok(DOC.includes(`\`${o.code}\``), `objection absente : ${o.code}`);
  for (const c of niche.debrief.champs) assert.ok(DOC.includes(`\`${c.id}\``), `champ absent : ${c.id}`);
});

test("aucun tiret cadratin dans les fichiers du lot", () => {
  const fichiers = [
    "docs/debrief.md",
    "scripts/debrief/lib.mjs",
    "scripts/debrief/base.mjs",
    "scripts/debrief/ecrire.mjs",
    "scripts/debrief/lire-appel.mjs",
    "scripts/debrief/notes-mac.mjs",
    "lib/retours/libelles.ts",
    "lib/retours/agregats.ts",
    "lib/retours/periode.ts",
    "lib/retours/saisie.ts",
    "lib/retours/appels-transcrits.ts",
    "app/(app)/retours/page.tsx",
    "app/(app)/retours/SaisieRetour.tsx",
    "app/(app)/retours/actions.ts",
    "app/(app)/retours/donnees.ts",
    "app/(app)/retours/etat.ts",
    "app/_components/fiche/blocs/AppelsTranscrits.tsx",
  ];
  for (const f of fichiers) assert.ok(!lire(f).includes("—"), f);
});
