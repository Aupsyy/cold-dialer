// Le rapprochement fiche Maps (ou annuaire) et entreprise de la base (scripts/sourcing/appariement.mjs) : normalisation des noms,
// zones, téléphones, choix d'une fiche, fiches disputées, et le script sur des CSV fictifs. Règle : jamais un mauvais téléphone.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { apparier, choisirFiche, executer, lireAdresse, lireNoteAvis, motsDistinctifs, niveauZone, similariteNom } from "../scripts/sourcing/appariement.mjs";
import { lireCsv } from "../scripts/sourcing/csv.mjs";
import { dossierTemporaire, e164, fixe, niche, sirenFictif } from "./sourcing-outils.mjs";

const VIDES = niche().sources.motsVidesAppariement;

test("mots distinctifs : accents, ponctuation, formes juridiques et mots vides de la config écartés", () => {
  assert.deepEqual(motsDistinctifs("SARL Les Jardins d'Émile & Fils", VIDES), ["emile"]);
  assert.deepEqual(motsDistinctifs("SAS DÉMO-PAYSAGE 69", VIDES), ["demo", "69"]);
  assert.deepEqual(motsDistinctifs("EURL Paysages et Jardins", VIDES), [], "un nom fait de mots vides");
  assert.deepEqual(motsDistinctifs("Atelier Démo", ["atelier"]), ["demo"], "les mots vides viennent de la config");
});

test("similarité : noms identiques ou contenus, sinon part des mots distinctifs retrouvés", () => {
  assert.equal(similariteNom("SARL DUPONT DÉMO", "Dupont Démo", VIDES), 1);
  assert.equal(similariteNom("Atelier Démo Martin", "Atelier Démo Martin - Paysagiste à Lyon", VIDES), 1);
  assert.equal(similariteNom("Démo Martin Bernard", "Martin Démo", VIDES), 2 / 3);
  assert.equal(similariteNom("Démo Martin", "Atelier Simon", VIDES), 0);
  assert.equal(similariteNom("", "Atelier Simon", VIDES), 0);
});

test("zones : code postal, commune (Saint, Cedex), département (France), sinon rien", () => {
  assert.equal(niveauZone({ code_postal: "69003" }, { code_postal: "69003" }), "cp");
  assert.equal(niveauZone({ ville: "St-Étienne", code_postal: "42000" }, { ville: "SAINT ETIENNE CEDEX 2", code_postal: "42100" }), "ville");
  assert.equal(niveauZone({ ville: "Lyon", code_postal: "69003" }, { ville: "Bron", code_postal: "69500" }), "dept");
  assert.equal(niveauZone({ ville: "Lyon", code_postal: "69003" }, { ville: "Grenoble", code_postal: "38000" }), null);
  assert.equal(niveauZone({ ville: "Bruxelles", code_postal: "1000" }, { ville: "Bruxelles", code_postal: "1000" }), "cp", "hors France aussi");
});

test("choix : même téléphone d'abord ; un autre numéro que le nôtre n'est jamais pris", () => {
  const prospect = { entreprise: "Atelier Démo Martin", ville: "Lyon", code_postal: "69003", telephone: fixe(1) };
  const bonNom = { entreprise: "Atelier Démo Martin", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(2)) };
  const memeNumero = { entreprise: "Démo Martin Jardins", ville: "Lyon", code_postal: "69007", telephone: e164(fixe(1)) };
  assert.equal(choisirFiche(prospect, [bonNom, memeNumero], { motsVides: VIDES }).fiabilite, "telephone");
  assert.equal(choisirFiche(prospect, [bonNom], { motsVides: VIDES }), null, "même nom mais autre numéro : écartée");
  const sansNumero = { ...bonNom, telephone: "" };
  assert.equal(choisirFiche(prospect, [sansNumero], { motsVides: VIDES }).fiabilite, "zone+nom");
});

test("choix : nom et zone ; au seul niveau du département il faut un nom identique ; zone seule réservée aux fiches cherchées", () => {
  const prospect = { entreprise: "SARL Démo Martin", ville: "Lyon", code_postal: "69003" };
  const memeCp = { entreprise: "Martin Démo", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(5)) };
  const dept = { entreprise: "Démo Martin Bernard", ville: "Bron", code_postal: "69500", telephone: e164(fixe(6)) };
  const ailleurs = { entreprise: "Démo Martin", ville: "Grenoble", code_postal: "38000", telephone: e164(fixe(7)) };
  assert.equal(choisirFiche(prospect, [dept, memeCp, ailleurs], { motsVides: VIDES }).fiche, memeCp);
  assert.equal(choisirFiche(prospect, [dept], { motsVides: VIDES }), null, "département : nom pas identique");
  assert.equal(choisirFiche(prospect, [{ ...dept, entreprise: "Démo Martin" }], { motsVides: VIDES }).fiabilite, "zone+nom");
  assert.equal(choisirFiche(prospect, [ailleurs], { motsVides: VIDES }), null, "autre département : jamais");
  const sansMot = { entreprise: "EURL Paysages et Jardins", ville: "Lyon", code_postal: "69003" };
  const unique = { entreprise: "Jardins Démo du Rhône", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(8)) };
  assert.equal(choisirFiche(sansMot, [unique], { motsVides: VIDES }), null);
  assert.equal(choisirFiche(sansMot, [unique], { motsVides: VIDES, zoneSeule: true }).fiabilite, "zone seule");
  assert.equal(choisirFiche(sansMot, [unique, memeCp], { motsVides: VIDES, zoneSeule: true }), null, "zone seule : une seule fiche");
});

test("adresses et notes lues sur une fiche", () => {
  assert.deepEqual(lireAdresse("Adresse : 10 Rue Démo, 69003 Lyon"), { codePostal: "69003", ville: "Lyon" });
  assert.deepEqual(lireAdresse("10 Rue Démo, 69003 Lyon, France"), { codePostal: "69003", ville: "Lyon" });
  assert.deepEqual(lireAdresse("Rue Démo 10, 1000 Bruxelles, Belgique"), { codePostal: "1000", ville: "Bruxelles" });
  assert.deepEqual(lireAdresse("123 Rue Démo, Montréal, QC H2X 1Y4, Canada"), { codePostal: "H2X 1Y4", ville: "Montréal" });
  assert.deepEqual(lireAdresse("sans code postal"), { codePostal: "", ville: "" });
  assert.deepEqual(lireNoteAvis("4,8\n(17)"), { note: "4.8", nb: "17" });
  assert.deepEqual(lireNoteAvis("4.5 (1 234)"), { note: "4.5", nb: "1234" });
  assert.deepEqual(lireNoteAvis(""), { note: "", nb: "" });
});

test("apparier : complète sans jamais remplacer, note la provenance ; une fiche disputée à égalité ne va à personne", () => {
  const base = [
    { entreprise: "Atelier Démo Martin", siren: sirenFictif(1), ville: "Lyon", code_postal: "69003" },
    { entreprise: "Atelier Démo Simon", siren: sirenFictif(2), ville: "Lyon", code_postal: "69003", telephone: fixe(9), site: "https://example.org/simon" },
    { entreprise: "Démo Durand", siren: sirenFictif(3), ville: "Lyon", code_postal: "69007" },
    { entreprise: "Démo Durand", siren: sirenFictif(4), ville: "Lyon", code_postal: "69007" },
  ];
  const fiches = [
    { entreprise: "Atelier Démo Martin", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(1)), site: "https://example.org/martin", note_google: "4.6", nb_avis: "12", source: "maps", source_url: "https://www.google.com/maps/place/demo-1", source_date: "2026-11-02" },
    { entreprise: "Atelier Démo Simon", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(9)), site: "https://example.org/autre" },
    { entreprise: "Démo Durand", ville: "Lyon", code_postal: "69007", telephone: e164(fixe(3)) },
  ];
  const { lignes, compteurs } = apparier(base, fiches, { motsVides: VIDES });
  assert.equal(lignes[0].telephone, e164(fixe(1)));
  assert.equal(lignes[0].site, "https://example.org/martin");
  assert.deepEqual(
    [lignes[0].coordonnees_source, lignes[0].coordonnees_url, lignes[0].coordonnees_date, lignes[0].coordonnees_fiabilite],
    ["maps", "https://www.google.com/maps/place/demo-1", "2026-11-02", "zone+nom"],
  );
  assert.equal(lignes[1].telephone, fixe(9), "le téléphone déjà présent n'est jamais remplacé");
  assert.equal(lignes[1].site, "https://example.org/simon", "le site non plus");
  assert.equal(lignes[1].coordonnees_fiabilite, undefined, "rien d'ajouté : aucune provenance notée (elle serait fausse)");
  assert.equal(lignes[0].coordonnees_champs, "telephone,site,note_google,nb_avis", "la provenance dit ce qu'elle couvre");
  assert.equal(lignes[2].telephone, undefined, "fiche disputée à égalité : personne ne la prend");
  assert.equal(lignes[3].telephone, undefined);
  assert.equal(compteurs.disputees, 1);
  assert.deepEqual(compteurs.rapprochees, { telephone: 1, "zone+nom": 1, "zone seule": 0 });
  assert.equal(compteurs.telephones_ajoutes, 1);
  assert.equal(compteurs.fiches_non_retenues, 1);
});

test("apparier : une fiche cherchée pour une entreprise (siren_recherche) n'est comparée qu'à elle", () => {
  const base = [
    { entreprise: "EURL Paysages et Jardins", siren: sirenFictif(5), ville: "Lyon", code_postal: "69003" },
    { entreprise: "Atelier Démo Martin", siren: sirenFictif(6), ville: "Lyon", code_postal: "69003" },
  ];
  const fiches = [{ entreprise: "Jardins Démo du Rhône", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(10)), siren_recherche: sirenFictif(5), source: "maps", source_date: "2026-11-02" }];
  const { lignes } = apparier(base, fiches, { motsVides: VIDES });
  assert.equal(lignes[0].telephone, e164(fixe(10)));
  assert.equal(lignes[0].coordonnees_fiabilite, "zone seule");
  assert.equal(lignes[1].telephone, undefined);
});

test("le script : deux CSV fictifs, un CSV enrichi, des compteurs sans donnée ; --essai n'écrit rien", async () => {
  const dossier = dossierTemporaire();
  try {
    const base = join(dossier.chemin, "base.csv");
    const fiches = join(dossier.chemin, "fiches.csv");
    writeFileSync(base, `entreprise;siren;ville;code_postal\nAtelier Démo Martin;${sirenFictif(7)};Lyon;69003\nAtelier Démo Simon;${sirenFictif(8)};Lyon;69005\n`);
    writeFileSync(fiches, `nom,téléphone,ville,cp,site web,source,source_date\nAtelier Démo Martin,${fixe(11)},Lyon,69003,https://example.org/martin,Annuaire démo,2026-11-02\n`);
    const essai = await executer({ niche: niche(), base, fiches, essai: true });
    assert.ok(essai.lignes.some((l) => /ESSAI/.test(l)));
    const r = await executer({ niche: niche(), base, fiches });
    assert.ok(!r.lignes.join("\n").includes("Démo"), "le rapport ne cite aucune donnée");
    const sortie = lireCsv(readFileSync(join(dossier.chemin, "base-apparie.csv"), "utf8")).lignes;
    assert.equal(sortie[0].telephone, fixe(11));
    assert.equal(sortie[0].site, "https://example.org/martin");
    assert.equal(sortie[0].coordonnees_source, "Annuaire démo");
    assert.equal(sortie[1].telephone, "");
  } finally {
    dossier.supprimer();
  }
});

test("M25 : rien n'entre sans sa source datée ; une ligne déjà sourcée par une autre fiche ne reçoit rien d'une nouvelle", () => {
  const base = [
    { entreprise: "Atelier Démo Martin", siren: sirenFictif(9), ville: "Lyon", code_postal: "69003" },
    { entreprise: "Atelier Démo Simon", siren: sirenFictif(10), ville: "Lyon", code_postal: "69005", telephone: e164(fixe(12)), coordonnees_source: "maps", coordonnees_url: "https://www.google.com/maps/place/demo-12", coordonnees_date: "2026-10-01", coordonnees_fiabilite: "zone+nom" },
  ];
  const fiches = [
    { entreprise: "Atelier Démo Martin", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(13)), source: "Annuaire démo" },
    { entreprise: "Atelier Démo Simon", ville: "Lyon", code_postal: "69005", telephone: e164(fixe(12)), site: "https://example.org/simon", source: "Annuaire démo", source_date: "2026-11-02" },
  ];
  const { lignes, compteurs } = apparier(base, fiches, { motsVides: VIDES });
  assert.equal(lignes[0].telephone, undefined, "sans date de source : rien d'ajouté");
  assert.equal(lignes[0].coordonnees_source, undefined);
  assert.equal(lignes[1].site, undefined, "la ligne a déjà la provenance d'un appariement précédent : rien de la nouvelle fiche");
  assert.deepEqual([lignes[1].coordonnees_source, lignes[1].coordonnees_date], ["maps", "2026-10-01"], "provenance d'origine intacte");
  assert.deepEqual([compteurs.sans_date, compteurs.autre_provenance], [1, 1]);
  // Rejouer le même appariement (même fiche, même provenance) ne change rien.
  const fiche = { entreprise: "Atelier Démo Martin", ville: "Lyon", code_postal: "69003", telephone: e164(fixe(13)), source: "maps", source_url: "https://www.google.com/maps/place/demo-13", source_date: "2026-11-02" };
  const premier = apparier([base[0]], [fiche], { motsVides: VIDES }).lignes[0];
  assert.equal(premier.telephone, e164(fixe(13)));
  assert.deepEqual(apparier([premier], [fiche], { motsVides: VIDES }).lignes[0], premier);
});
