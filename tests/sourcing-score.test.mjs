// Le score des fiches (scripts/sourcing/score.mjs) : chaque type de critère de config.score, les bornes (0 à 100), les seuils A et B,
// et le script sur un CSV fictif écrit dans un dossier temporaire.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { analyserNiche } from "../config/charger.ts";
import { TYPES_CRITERE_SCORE } from "../config/schema.ts";
import { lireCsv } from "../scripts/sourcing/csv.mjs";
import { ageEnAnnees, calculerScore, evaluerCritere, executer, formeDe, noterTableau, tierDepuisScore } from "../scripts/sourcing/score.mjs";
import { dossierTemporaire, niche, sirenFictif } from "./sourcing-outils.mjs";

const AUJOURDHUI = "2026-11-09";
const vrai = (critere, fiche) => evaluerCritere(critere, fiche, { aujourdhui: AUJOURDHUI });
const critere = (type, regle, points = 10) => ({ id: `c_${type}`, type, regle, points });

test("chaque type de critère du schéma est pris en charge", () => {
  const exemples = {
    forme_juridique: [critere("forme_juridique", { inclure: ["SARL"] }), { forme_juridique: "SARL" }],
    effectif: [critere("effectif", { min: 1, max: 9 }), { effectif: "3 à 5 salariés" }],
    anciennete: [critere("anciennete", { minAns: 2 }), { date_creation: "2015-01-01" }],
    ville: [critere("ville", { inclure: ["Lyon"] }), { ville: "Lyon" }],
    naf: [critere("naf", { inclure: ["81.30Z"] }), { naf: "8130Z" }],
    mot_nom: [critere("mot_nom", { mots: ["jardin"] }), { entreprise: "Les Jardins Démo" }],
    note_google: [critere("note_google", { min: 4 }), { note_google: "4,5" }],
    a_site: [critere("a_site", {}), { site: "https://example.org/atelier-demo-01" }],
    a_email: [critere("a_email", {}), { email: "contact@example.org" }],
  };
  assert.deepEqual(Object.keys(exemples).sort(), [...TYPES_CRITERE_SCORE].sort());
  for (const [type, [c, fiche]] of Object.entries(exemples)) {
    assert.equal(vrai(c, fiche), true, `${type} : la fiche devrait correspondre`);
    assert.equal(vrai(c, {}), false, `${type} : une donnée absente ne rapporte rien`);
  }
});

test("forme_juridique : codes INSEE (exacts ou débuts), libellés en mot entier, inclure et exclure", () => {
  assert.deepEqual(formeDe({ categorie_juridique: "5499" }), { code: "5499", libelle: "SARL" });
  assert.deepEqual(formeDe({ forme_juridique: "SASU" }), { code: "5720", libelle: "SASU" });
  assert.equal(formeDe({ forme_juridique: "Société par actions simplifiée" }).code, "5710");
  const codes = critere("forme_juridique", { inclure: ["5498", "5499", "5710", "5720"] });
  assert.equal(vrai(codes, { categorie_juridique: "5710" }), true);
  assert.equal(vrai(codes, { forme_juridique: "SARL" }), true, "le libellé courant retrouve son code");
  assert.equal(vrai(codes, { categorie_juridique: "1000" }), false);
  assert.equal(vrai(critere("forme_juridique", { inclure: ["54"] }), { categorie_juridique: "5485" }), true, "un début de code");
  const libelles = critere("forme_juridique", { inclure: ["SAS"] });
  assert.equal(vrai(libelles, { forme_juridique: "SAS" }), true);
  assert.equal(vrai(libelles, { forme_juridique: "SASU" }), false, "mot entier : SAS ne trouve pas SASU");
  const sauf = critere("forme_juridique", { inclure: ["54", "57"], exclure: ["5720"] });
  assert.equal(vrai(sauf, { categorie_juridique: "5720" }), false);
  assert.equal(vrai(sauf, { categorie_juridique: "5710" }), true);
  const pasEI = critere("forme_juridique", { exclure: ["1000"] });
  assert.equal(vrai(pasEI, { categorie_juridique: "5499" }), true);
  assert.equal(vrai(pasEI, { forme_juridique: "Entrepreneur individuel" }), false);
  assert.equal(vrai(pasEI, {}), false, "exclure seul : la forme doit être connue");
});

test("effectif : la tranche doit tenir entièrement entre min et max ; nombre, tranche, libellé INSEE", () => {
  const c = critere("effectif", { min: 3, max: 20 });
  assert.equal(vrai(c, { effectif: "3 à 5 salariés" }), true);
  assert.equal(vrai(c, { effectif: "10 à 19 salariés" }), true);
  assert.equal(vrai(c, { effectif: "12" }), true);
  assert.equal(vrai(c, { effectif: "6-9" }), true);
  assert.equal(vrai(c, { effectif: "1 ou 2 salariés" }), false);
  assert.equal(vrai(c, { effectif: "20 à 49 salariés" }), false, "49 dépasse 20");
  assert.equal(vrai(c, { effectif: "NN" }), false);
  assert.equal(vrai(critere("effectif", { min: 50 }), { effectif: "10 000 salariés et plus" }), true);
  assert.equal(vrai(critere("effectif", { max: 0 }), { effectif: "0 salarié" }), true);
});

test("anciennete : âge exact aux anniversaires, bornes comprises", () => {
  assert.equal(ageEnAnnees("2011-11-09", AUJOURDHUI), 15);
  assert.ok(ageEnAnnees("2011-11-10", AUJOURDHUI) < 15);
  assert.equal(ageEnAnnees("2030-01-01", AUJOURDHUI), 0, "une date future compte pour 0");
  assert.equal(ageEnAnnees("pas une date", AUJOURDHUI), null);
  const c = critere("anciennete", { minAns: 2, maxAns: 15 });
  assert.equal(vrai(c, { date_creation: "2011-11-09" }), true, "15 ans pile");
  assert.equal(vrai(c, { date_creation: "2011-11-08" }), false, "15 ans et un jour");
  assert.equal(vrai(c, { date_creation: "2024-11-09" }), true, "2 ans pile");
  assert.equal(vrai(c, { date_creation: "2024-11-10" }), false);
  assert.equal(vrai(c, { date_creation: "09/11/2020" }), true, "JJ/MM/AAAA accepté");
  assert.equal(vrai(critere("anciennete", { maxAns: 1 }), { date_creation: "2026-01-15" }), true);
});

test("ville : communes (accents, casse, Saint, arrondissements, Cedex), débuts de code postal, Corse", () => {
  const c = critere("ville", { inclure: ["Lyon", "Saint-Étienne", "75", "2A"] });
  assert.equal(vrai(c, { ville: "LYON" }), true);
  assert.equal(vrai(c, { ville: "Lyon 3e Arrondissement" }), true);
  assert.equal(vrai(c, { ville: "Lyons-la-Forêt" }), false);
  assert.equal(vrai(c, { ville: "ST ETIENNE CEDEX 1" }), true);
  assert.equal(vrai(c, { ville: "Paris", code_postal: "75011" }), true);
  assert.equal(vrai(c, { ville: "Bastia", code_postal: "20200" }), false);
  assert.equal(vrai(c, { ville: "Ajaccio", code_postal: "20000" }), true);
  assert.equal(vrai(c, { ville: "Bron", code_postal: "69500" }), false);
});

test("naf, mot_nom (début de mot, nom ou enseigne), note_google (note et avis), a_site, a_email", () => {
  assert.equal(vrai(critere("naf", { inclure: ["81.30Z"] }), { naf: "81.30z" }), true);
  assert.equal(vrai(critere("naf", { inclure: ["81.30Z"] }), { naf: "43.21A" }), false);
  const mots = critere("mot_nom", { mots: ["paysag", "espaces verts"] });
  assert.equal(vrai(mots, { entreprise: "SARL Démo Paysagiste" }), true);
  assert.equal(vrai(mots, { entreprise: "Atelier Démo", enseigne: "Espaces Verts Démo" }), true);
  assert.equal(vrai(mots, { entreprise: "Dépaysagement Démo" }), false, "début de mot seulement");
  const note = critere("note_google", { min: 4, avisMin: 10 });
  assert.equal(vrai(note, { note_google: "4.6", nb_avis: "12" }), true);
  assert.equal(vrai(note, { note_google: "4.6", nb_avis: "9" }), false);
  assert.equal(vrai(note, { note_google: "3,9", nb_avis: "120" }), false);
  assert.equal(vrai(critere("a_site", {}), { site: "pas un site" }), false);
  assert.equal(vrai(critere("a_email", {}), { email: "pas-un-email" }), false);
});

test("bornes : jamais sous 0 ni au-dessus de 100, malus compris", () => {
  const grille = { seuils: { A: 70, B: 45 }, plafond: 100, criteres: [critere("a_site", {}, 80), { ...critere("a_email", {}, 60), id: "email" }] };
  assert.equal(calculerScore({ site: "https://example.org", email: "contact@example.org" }, grille, { aujourdhui: AUJOURDHUI }).score, 100);
  const malus = { seuils: { A: 70, B: 45 }, plafond: 100, criteres: [critere("a_site", {}, 10), { ...critere("anciennete", { maxAns: 1 }, -50), id: "recente" }] };
  const r = calculerScore({ site: "https://example.org", date_creation: "2026-06-01" }, malus, { aujourdhui: AUJOURDHUI });
  assert.equal(r.score, 0);
  assert.deepEqual(r.retenus, ["c_a_site", "recente"]);
});

test("seuils : A dès seuils.A, B dès seuils.B, C sinon (et sans score)", () => {
  const seuils = { A: 70, B: 45 };
  assert.equal(tierDepuisScore(70, seuils), "A");
  assert.equal(tierDepuisScore(69, seuils), "B");
  assert.equal(tierDepuisScore(45, seuils), "B");
  assert.equal(tierDepuisScore(44, seuils), "C");
  assert.equal(tierDepuisScore(0, seuils), "C");
  assert.equal(tierDepuisScore(null, seuils), "C");
  assert.equal(tierDepuisScore(50, { A: 90, B: 50 }), "B", "les seuils viennent de la config");
});

test("la grille de la niche d'exemple, sur une fiche fictive complète", () => {
  const n = niche();
  const fiche = {
    entreprise: "Atelier Démo 01 Paysage",
    categorie_juridique: "5499",
    effectif: "6 à 9 salariés",
    date_creation: "2015-03-01",
    naf: "81.30Z",
    note_google: "4.7",
    nb_avis: "23",
    site: "https://example.org/atelier-demo-01",
    email: "contact@example.org",
  };
  const r = calculerScore(fiche, n.score, { aujourdhui: AUJOURDHUI });
  assert.equal(r.score, 100);
  assert.equal(r.tier, "A");
  assert.deepEqual(r.retenus, ["societe", "taille", "installee", "metier_dans_le_nom", "naf_paysage", "avis", "site", "email"]);
  const nue = calculerScore({ entreprise: "Atelier Démo 02" }, n.score, { aujourdhui: AUJOURDHUI });
  assert.deepEqual(nue, { score: 0, tier: "C", retenus: [] });
});

test("une grille changée dans la config change le score : les seuils et les points ne sont pas codés en dur", () => {
  const n = niche();
  n.score = { seuils: { A: 30, B: 10 }, plafond: 100, criteres: [{ id: "lyon", type: "ville", regle: { inclure: ["Lyon"] }, points: 35 }] };
  assert.equal(analyserNiche(n).ok, true);
  const { lignes, compteurs } = noterTableau([{ ville: "Lyon" }, { ville: "Bron" }], n.score, AUJOURDHUI);
  assert.deepEqual(lignes.map((l) => [l.score, l.tier, l.score_detail]), [["35", "A", "lyon"], ["0", "C", ""]]);
  assert.deepEqual(compteurs.tiers, { A: 1, B: 0, C: 1 });
  assert.equal(compteurs.criteres.lyon, 1);
});

test("le script : écrit <entree>-score.csv, garde les autres colonnes, ne cite aucune donnée ; --essai n'écrit rien", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    writeFileSync(
      entree,
      [
        "Raison sociale;SIREN;NAF;Forme juridique;Effectif;Date création;Ville;Colonne à moi",
        `Atelier Démo 01;${sirenFictif(1)};81.30Z;SARL;6 à 9 salariés;2015-03-01;Lyon;garder`,
        `Atelier Démo 02;${sirenFictif(2)};43.21A;;;;Bron;garder aussi`,
      ].join("\n"),
    );
    const essai = await executer({ niche: niche(), entree, essai: true, maintenant: new Date("2026-11-09T10:00:00Z") });
    assert.ok(essai.lignes.some((l) => /ESSAI/.test(l)));
    assert.throws(() => readFileSync(join(dossier.chemin, "base-score.csv")));
    const r = await executer({ niche: niche(), entree, maintenant: new Date("2026-11-09T10:00:00Z") });
    const texte = r.lignes.join("\n");
    assert.ok(!texte.includes("Atelier") && !texte.includes(sirenFictif(1)), "le rapport ne cite aucune donnée");
    const { colonnes, lignes } = lireCsv(readFileSync(join(dossier.chemin, "base-score.csv"), "utf8"));
    assert.ok(colonnes.includes("colonne_a_moi") && colonnes.includes("score_detail"));
    assert.equal(colonnes[0], "entreprise", "les en-têtes connus prennent leur nom standard");
    assert.deepEqual(lignes.map((l) => [l.score, l.tier]), [["70", "A"], ["0", "C"]]);
    assert.equal(lignes[1].colonne_a_moi, "garder aussi");
  } finally {
    dossier.supprimer();
  }
});
