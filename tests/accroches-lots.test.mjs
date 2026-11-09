// Accroches, les lots : 50 fiches par lot, la consigne en tête, une fiche lisible (id, site, pages, lignes), reprise sans remettre une
// fiche déjà répondue, nouveaux lots numérotés après les lots répondus. Fiches fictives, écrites dans un dossier temporaire.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { preparerLots, principal, rendreFiche, rendreLot } from "../scripts/accroches/lots.mjs";
import { RACINE } from "./aides.mjs";

function fiche(n) {
  const nn = String(n).padStart(3, "0");
  const s = `https://atelier-demo-${nn}.example.org`;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    site: `${s}/`,
    indices: [
      { url: `${s}/realisations`, type: "titre", texte: `Jardin fictif numéro ${n}` },
      { url: `${s}/realisations`, type: "phrase", texte: "Création d'un bassin naturel à Vienne en 2019." },
      { url: `${s}/a-propos`, type: "phrase", texte: "Entreprise familiale fondée en 2009." },
    ],
    caracteres: 90,
  };
}

test("preparerLots : 50 fiches par lot, seulement celles qui ont des lignes, sans les fiches déjà répondues", () => {
  const compacts = [...Array.from({ length: 120 }, (_, i) => fiche(i + 1)), { id: "vide", site: "https://example.org/", indices: [] }, { id: "err", erreur: "robots_interdit", indices: [] }];
  const lots = preparerLots(compacts, {});
  assert.deepEqual(lots.map((l) => [l.nom, l.fiches.length]), [["lot-001", 50], ["lot-002", 50], ["lot-003", 20]]);
  const repondus = new Set(compacts.slice(0, 50).map((c) => c.id));
  const suite = preparerLots(compacts, { repondus, numerosRepondus: new Set([1]) });
  assert.deepEqual(suite.map((l) => [l.nom, l.fiches.length]), [["lot-002", 50], ["lot-003", 20]]);
  assert.ok(!suite.flatMap((l) => l.fiches).some((f) => repondus.has(f.id)));
});

test("rendreFiche et rendreLot : fichier de réponse et consigne en tête, pages et lignes recopiées, titres en gras", () => {
  const bloc = rendreFiche(fiche(7), 1, 2);
  assert.ok(bloc.startsWith("## Fiche 1 sur 2\n\n- id : 00000000-0000-4000-8000-000000000007\n- site : https://atelier-demo-007.example.org/"));
  assert.ok(bloc.includes("Page : https://atelier-demo-007.example.org/realisations\n\n- **Jardin fictif numéro 7**\n- Création d'un bassin naturel à Vienne en 2019."));
  assert.ok(bloc.includes("Page : https://atelier-demo-007.example.org/a-propos"));
  const md = rendreLot({ nom: "lot-004", fiches: [fiche(7), fiche(8)], consigne: "# Consigne fictive", fichierReponse: "donnees/accroches/reponses/lot-004.json" });
  assert.ok(md.startsWith("# Accroches, lot-004 (2 fiches)\n\nFichier de réponse à écrire : `donnees/accroches/reponses/lot-004.json`"));
  assert.ok(md.indexOf("# Consigne fictive") < md.indexOf("## Fiche 1 sur 2"));
});

test("lots.mjs : écrit les lots avec la consigne de la config ; au second passage, garde le lot répondu et refait les autres", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "accroches-lots-"));
  const config = fileURLToPath(new URL("config/niche.exemple.json", RACINE));
  const journal = [];
  try {
    writeFileSync(join(dossier, "compact.jsonl"), Array.from({ length: 60 }, (_, i) => JSON.stringify(fiche(i + 1))).join("\n") + "\n");
    assert.equal(await principal(["--dossier", dossier, "--config", config], { journal: (l) => journal.push(l) }), 0);
    assert.deepEqual(readdirSync(join(dossier, "lots")).sort(), ["lot-001.md", "lot-002.md"]);
    const lot1 = readFileSync(join(dossier, "lots", "lot-001.md"), "utf8");
    assert.ok(lot1.includes("Tu écris, pour chaque fiche du lot, UNE accroche"));
    assert.ok(lot1.includes(join(dossier, "reponses", "lot-001.json")));
    assert.equal((lot1.match(/^## Fiche \d+ sur 50$/gm) ?? []).length, 50);
    assert.ok(lot1.split("\n").length < 2000, "un lot se lit d'un seul coup");
    assert.ok(existsSync(join(dossier, "reponses")));

    mkdirSync(join(dossier, "reponses"), { recursive: true });
    const ids = Array.from({ length: 50 }, (_, i) => fiche(i + 1).id);
    writeFileSync(join(dossier, "reponses", "lot-001.json"), JSON.stringify(ids.map((id) => ({ id, accroche: "", source: null }))));
    assert.equal(await principal(["--dossier", dossier, "--config", config], { journal: (l) => journal.push(l) }), 0);
    assert.deepEqual(readdirSync(join(dossier, "lots")).sort(), ["lot-001.md", "lot-002.md"]);
    const lot2 = readFileSync(join(dossier, "lots", "lot-002.md"), "utf8");
    assert.equal((lot2.match(/^## Fiche \d+ sur 10$/gm) ?? []).length, 10);
    assert.ok(!ids.some((id) => lot2.includes(id)));
    assert.ok(journal.every((l) => !/example\.org|Jardin fictif/.test(l)), journal.join("\n"));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
