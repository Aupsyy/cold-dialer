// Les niches prêtes (config/niches/<code>.json) : chacune, appliquée sur la niche d'exemple, donne une config valide (schéma et
// garde-fous) ; les codes NAF sont bien écrits et connus de la table de scripts/niche/naf.mjs ; aucun métier interdit.
// Les tests tournent sur la niche d'exemple (jamais sur config/niche.json) : voir tests/config-exemple-en-test.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyserNiche } from "../config/charger.ts";
import { appliquerNiche, codesDesNiches, lireNiche } from "../scripts/niche/lib.mjs";
import { TABLE_NAF } from "../scripts/niche/naf.mjs";
import { exemple, lire } from "./aides.mjs";

const CODES = codesDesNiches();
/** Les dix niches livrées avec le dépôt. Un utilisateur peut en ajouter (niche libre) : elles passent les mêmes tests de validité. */
const LIVREES = ["agences-immobilieres", "cabinets-dentaires", "cuisinistes", "experts-comptables", "garages-controle-technique", "menuisiers-agenceurs", "paysagistes", "pisciniers", "renovation-energetique", "traiteurs-evenementiels"];
const FORMAT_NAF = /^\d{2}\.\d{2}[A-Z]$/;
// Les métiers qu'on ne propose pas : les motifs sont écrits en morceaux pour que ce fichier ne les cite pas en toutes lettres.
const METIERS_INTERDITS = new RegExp(["architect", "d[ée]corat", "design", "staging", "am[ée]nagement d.int[ée]rieur"].join("|"), "iu");

test("les dix niches livrées sont là, un fichier par code, le code du fichier est celui de la niche", () => {
  for (const code of LIVREES) assert.ok(CODES.includes(code), `${code} manque`);
  for (const code of CODES) {
    const n = lireNiche(code);
    assert.equal(n.code, code);
    assert.match(code, /^[a-z0-9-]+$/);
    for (const cle of ["metier", "tailleVisee", "pourquoi", "cible", "sources", "google", "score", "script", "objections", "accroche", "debrief"]) {
      assert.ok(n[cle], `${code} : « ${cle} » manque`);
    }
  }
});

for (const code of CODES) {
  test(`${code} : appliquée sur l'exemple, la config est valide (schéma et garde-fous)`, async () => {
    const { config } = await appliquerNiche(exemple(), lireNiche(code));
    const r = analyserNiche(config);
    assert.equal(r.ok, true, r.ok ? "" : r.problemes.join("\n"));
    assert.deepEqual(config.sources.sirene.naf, lireNiche(code).sources.sirene.naf);
    assert.equal(config.script.questions.length, lireNiche(code).script.questions.length);
  });

  test(`${code} : codes NAF au bon format${LIVREES.includes(code) ? ", connus de la table" : ""}, grille de score à 100 points`, () => {
    const n = lireNiche(code);
    const connus = new Set(TABLE_NAF.map((l) => l[0]));
    assert.ok(n.sources.sirene.naf.length >= 1 && n.sources.sirene.naf.length <= 4, "de un à quatre codes NAF");
    for (const naf of n.sources.sirene.naf) {
      assert.match(naf, FORMAT_NAF);
      if (LIVREES.includes(code)) assert.ok(connus.has(naf), `${naf} absent de la table de naf.mjs`);
    }
    for (const c of n.score.criteres.filter((x) => x.type === "naf")) for (const naf of c.regle.inclure) assert.match(naf, FORMAT_NAF);
    assert.deepEqual(n.score.criteres.find((c) => c.type === "naf").regle.inclure, n.sources.sirene.naf, "le critère NAF suit sources.sirene.naf");
    if (LIVREES.includes(code)) assert.equal(n.score.criteres.reduce((s, c) => s + c.points, 0), 100);
    assert.ok(n.google.motsCles.length >= 3);
  });

  test(`${code} : de 3 à 4 questions, de 5 à 6 objections, trois exemples d'accroche, aucun métier interdit`, () => {
    const n = lireNiche(code);
    assert.ok(n.script.questions.length >= 3 && n.script.questions.length <= 4);
    assert.ok(n.objections.length >= 5 && n.objections.length <= 6);
    assert.equal(n.accroche.exemples.length, 3);
    const brut = lire(`config/niches/${code}.json`);
    assert.ok(!METIERS_INTERDITS.test(brut), `${code} : un métier interdit apparaît`);
    assert.ok(!brut.includes("—"), "tiret cadratin");
  });
}

test("les codes NAF de la table sont uniques et bien écrits ; aucun métier interdit dans la table ni dans le README des niches", () => {
  const codes = TABLE_NAF.map((l) => l[0]);
  assert.equal(new Set(codes).size, codes.length);
  for (const [code, libelle] of TABLE_NAF) {
    assert.match(code, FORMAT_NAF);
    assert.ok(libelle.length > 5);
  }
  assert.ok(!METIERS_INTERDITS.test(JSON.stringify(TABLE_NAF)), "un métier interdit dans la table");
  assert.ok(!METIERS_INTERDITS.test(lire("config/niches/README.md")), "un métier interdit dans le README des niches");
});

test("les niches prêtes sont toutes différentes (cibles, NAF ou mots-clés distincts)", () => {
  const empreintes = CODES.map((c) => JSON.stringify([lireNiche(c).cible.metiers, lireNiche(c).google.motsCles]));
  assert.equal(new Set(empreintes).size, CODES.length);
});
