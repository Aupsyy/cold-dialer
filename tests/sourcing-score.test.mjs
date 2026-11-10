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
    chiffre_affaires: [critere("chiffre_affaires", { min: 150000 }), { chiffre_affaires: "350000" }],
    employeur: [critere("employeur", {}), { employeur: "oui" }],
    signal_site: [critere("signal_site", { absents: ["pixel_meta"] }), { site_joignable: "oui", signaux_site: "prise_rdv" }],
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

test("chiffre_affaires : bornes comprises, montants écrits à la française, donnée absente = ni gain ni perte", () => {
  const c = critere("chiffre_affaires", { min: 150000, max: 1000000 });
  assert.equal(vrai(c, { chiffre_affaires: "150000" }), true);
  assert.equal(vrai(c, { chiffre_affaires: "1 000 000" }), true);
  assert.equal(vrai(c, { chiffre_affaires: "149999" }), false);
  assert.equal(vrai(c, { chiffre_affaires: "1000001" }), false);
  assert.equal(vrai(c, { chiffre_affaires: "350000,00" }), true);
  assert.equal(vrai(c, { chiffre_affaires: "" }), false);
  assert.equal(vrai(c, { chiffre_affaires: "non publié" }), false);
  // un malus sur « petit chiffre d'affaires » ne frappe pas une fiche dont le chiffre n'est pas publié
  const malus = { seuils: { A: 70, B: 45 }, plafond: 100, criteres: [{ id: "petit", type: "chiffre_affaires", regle: { max: 49999 }, points: -20 }, { id: "ville", type: "ville", regle: { inclure: ["Lyon"] }, points: 50 }] };
  const { lignes } = noterTableau([{ ville: "Lyon", chiffre_affaires: "30000" }, { ville: "Lyon" }], malus, AUJOURDHUI);
  assert.deepEqual(lignes.map((l) => l.score), ["30", "50"]);
});

test("employeur : oui par défaut, non avec valeur false, inconnu = faux", () => {
  assert.equal(vrai(critere("employeur", {}), { employeur: "oui" }), true);
  assert.equal(vrai(critere("employeur", {}), { employeur: "non" }), false);
  assert.equal(vrai(critere("employeur", { valeur: false }), { employeur: "non" }), true);
  assert.equal(vrai(critere("employeur", { valeur: false }), { employeur: "" }), false, "inconnu : pas de malus non plus");
});

test("signal_site : présents et absents ; un site non lu ne compte jamais, ni pour ni contre", () => {
  const sansPub = critere("signal_site", { absents: ["pixel_meta", "balise_google_ads"] });
  assert.equal(vrai(sansPub, { site_joignable: "oui", signaux_site: "prise_rdv" }), true);
  assert.equal(vrai(sansPub, { site_joignable: "oui", signaux_site: "" }), true);
  assert.equal(vrai(sansPub, { site_joignable: "oui", signaux_site: "pixel_meta,prise_rdv" }), false);
  assert.equal(vrai(sansPub, { site_joignable: "non", signaux_site: "" }), false, "site injoignable : on ne dit pas qu'il n'a pas de pub");
  assert.equal(vrai(sansPub, { signaux_site: "" }), false, "site pas lu");
  const equipee = critere("signal_site", { presents: ["pixel_meta", "prise_rdv"] });
  assert.equal(vrai(equipee, { site_joignable: "oui", signaux_site: "pixel_meta,prise_rdv" }), true);
  assert.equal(vrai(equipee, { site_joignable: "oui", signaux_site: "pixel_meta" }), false, "tous les signaux demandés");
  assert.equal(vrai(critere("signal_site", { presents: ["site_joignable"] }), { site_joignable: "oui" }), true);
  assert.equal(vrai(critere("signal_site", { absents: ["site_joignable"] }), { site_joignable: "non" }), true);
  assert.equal(vrai(critere("signal_site", { absents: ["site_joignable"] }), {}), false);
});

test("cessée au registre : écartée (score 0, tier C) sans critère déclaré ; active ou inconnue : score normal", () => {
  const n = niche();
  const base = { forme_juridique: "SARL", effectif: "3 à 5 salariés", date_creation: "2015-01-01", naf: "81.30Z" };
  const { lignes, compteurs } = noterTableau([{ ...base, etat_registre: "C" }, { ...base, etat_registre: "A" }, { ...base }], n.score, AUJOURDHUI);
  assert.deepEqual(lignes.map((l) => [l.score, l.tier]), [["0", "C"], ["70", "A"], ["70", "A"]]);
  assert.equal(lignes[0].score_detail, "cessee");
  assert.equal(compteurs.criteres.cessee, 1);
  assert.equal(calculerScore({ ...base, etat_registre: "c" }, n.score, { aujourdhui: AUJOURDHUI }).tier, "C");
});

test("la liste des signaux du schéma suit celle de signaux.mjs", async () => {
  const { SIGNAUX_SITE } = await import("../config/schema.ts");
  const { SIGNAUX } = await import("../scripts/sourcing/signaux.mjs");
  assert.deepEqual([...SIGNAUX_SITE], ["site_joignable", ...SIGNAUX]);
});

test("schéma : les nouveaux critères sont valides, une borne inversée ou un signal vide est refusé, une config sans eux reste valide", () => {
  const avec = (c) => {
    const n = niche();
    n.score.criteres.push(c);
    return analyserNiche(n);
  };
  assert.equal(analyserNiche(niche()).ok, true);
  assert.equal(avec({ id: "ca", type: "chiffre_affaires", regle: { min: 1000 }, points: 5 }).ok, true);
  assert.equal(avec({ id: "emp", type: "employeur", regle: {}, points: 5 }).ok, true);
  assert.match(avec({ id: "ca2", type: "chiffre_affaires", regle: { min: 10, max: 5 }, points: 5 }).problemes.join(), /min doit être inférieur/);
  assert.match(avec({ id: "s", type: "signal_site", regle: {}, points: 5 }).problemes.join(), /presents ou absents/);
  assert.match(avec({ id: "s2", type: "signal_site", regle: { presents: ["pixel_meta"], absents: ["pixel_meta"] }, points: 5 }).problemes.join(), /à la fois/);
  assert.equal(avec({ id: "s3", type: "signal_site", regle: { presents: ["inconnu"] }, points: 5 }).ok, false);
});

test("schéma : l'ancienne clé sources.maps est refusée avec un message qui dit de la renommer en sources.places", () => {
  const n = niche();
  n.sources.maps = n.sources.places;
  delete n.sources.places;
  const r = analyserNiche(n);
  assert.equal(r.ok, false);
  assert.match(r.problemes.join("\n"), /sources\.maps n'existe plus/);
  assert.match(r.problemes.join("\n"), /Renomme la clé « maps » en « places »/);
});
