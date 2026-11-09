// La saisie manuelle d'un prospect (lib/poste/prospect.ts) et ses sources RGPD (lib/poste/sources.ts) : source datée obligatoire, jamais
// LinkedIn, numéros rangés en E.164, département déduit du code postal, traces datées des modifications manuelles. Données fictives.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ErreurSaisie } from "../lib/server/validation.ts";
import { departementDepuisCp, normaliserSite, validerModifContact, validerSaisieProspect } from "../lib/poste/prospect.ts";
import { TYPES_SOURCE, lireSources, marquerSaisiesManuelles, validerSource } from "../lib/poste/sources.ts";
import { construireSources } from "../scripts/sourcing/importer.mjs";

const MOI = "a3000000-0000-4000-8000-000000000003";
const C = { pays: "FR", aujourdhui: "2026-11-09", userId: MOI };
const BASE = { entreprise: "Atelier Démo 41", telephone: "01 99 00 01 41", source: { type: "annuaire" } };

test("une saisie complète devient la ligne à insérer, avec sa source datée du jour", () => {
  const l = validerSaisieProspect(
    {
      entreprise: "  Atelier Démo 41 ",
      dirigeant: "Camille Démo",
      telephone: "01 99 00 01 41",
      mobile: "06 39 98 00 41",
      email: "Contact41@Example.com",
      site: "example.org/atelier-demo-41",
      siren: "000 000 041",
      ville: "Lyon",
      cp: "69003",
      metier: "paysagiste",
      notes: "Vu sur un salon",
      attribuer: true,
      source: { type: "site", url: "https://example.org/atelier-demo-41/contact" },
    },
    C,
  );
  assert.deepEqual(l, {
    entreprise: "Atelier Démo 41",
    dirigeant: "Camille Démo",
    telephone: "+33199000141",
    mobile: "+33639980041",
    email: "contact41@example.com",
    email_source: "https://example.org/atelier-demo-41/contact",
    site: "https://example.org/atelier-demo-41",
    siren: "000000041",
    ville: "Lyon",
    cp: "69003",
    departement: "69",
    metier: "paysagiste",
    notes: "Vu sur un salon",
    sources: [{ type: "site", le: "2026-11-09", origine: "manuel", url: "https://example.org/atelier-demo-41/contact" }],
    assigned_to: MOI,
  });
});

test("la source est obligatoire, choisie dans la liste, et jamais LinkedIn", () => {
  const refus = (source, motif) =>
    assert.throws(() => validerSaisieProspect({ ...BASE, source }, C), (e) => e instanceof ErreurSaisie && motif.test(e.message));
  refus(undefined, /source des coordonnées est obligatoire/);
  refus({ type: "" }, /obligatoire/);
  refus({ type: "fichier_achete" }, /dans la liste/);
  refus({ type: "autre" }, /précise laquelle/);
  refus({ type: "site", url: "https://www.linkedin.com/company/x" }, /LinkedIn/);
  refus({ type: "autre", precision: "profil LinkedIn du gérant" }, /LinkedIn/);
  refus({ type: "site", url: "javascript:alert(1)" }, /https/);
  refus({ type: "site", url: "pas une adresse" }, /https/);
  assert.deepEqual(validerSource({ type: "autre", precision: "Liste des exposants du salon" }, "2026-11-09"), {
    type: "autre",
    le: "2026-11-09",
    origine: "manuel",
    precision: "Liste des exposants du salon",
  });
  assert.ok(TYPES_SOURCE.every((t) => !/linkedin/i.test(t.libelle)));
});

test("entrées invalides refusées avec un message lisible", () => {
  const refus = (brut, motif) => assert.throws(() => validerSaisieProspect(brut, C), (e) => e instanceof ErreurSaisie && motif.test(e.message));
  refus(null, /illisible/);
  refus({ ...BASE, entreprise: " " }, /nom de l'entreprise est obligatoire/);
  refus({ ...BASE, entreprise: "x".repeat(201) }, /200 caractères/);
  refus({ ...BASE, telephone: "" }, /au moins un numéro/);
  refus({ ...BASE, telephone: "01 99" }, /numéro illisible/);
  refus({ ...BASE, mobile: "poste 12" }, /numéro illisible/);
  refus({ ...BASE, email: "pas-un-email" }, /adresse invalide/);
  refus({ ...BASE, siren: "12345" }, /9 chiffres/);
  refus({ ...BASE, cp: "#" }, /code postal/);
  refus({ ...BASE, site: "http://" }, /site/);
});

test("par défaut : pas d'attribution, pas de doublon téléphone et mobile", () => {
  const l = validerSaisieProspect({ ...BASE, mobile: "+33 1 99 00 01 41" }, C);
  assert.equal(l.assigned_to, null);
  assert.equal(l.mobile, null, "le même numéro en mobile n'est pas gardé deux fois");
  assert.equal(l.email_source, null);
  assert.equal(validerSaisieProspect({ ...BASE, attribuer: "true" }, C).assigned_to, null, "seul le booléen vrai attribue");
});

test("département déduit du code postal (France), Corse et outre-mer compris", () => {
  assert.equal(departementDepuisCp("69003", "FR"), "69");
  assert.equal(departementDepuisCp("01000", "FR"), "01");
  assert.equal(departementDepuisCp("20090", "FR"), "2A");
  assert.equal(departementDepuisCp("20200", "FR"), "2B");
  assert.equal(departementDepuisCp("97411", "FR"), "974");
  assert.equal(departementDepuisCp("1000", "BE"), null);
  assert.equal(departementDepuisCp("6900", "FR"), null);
  assert.equal(departementDepuisCp(null, "FR"), null);
});

test("le site : complété en https, refusé s'il est illisible", () => {
  assert.equal(normaliserSite("example.org"), "https://example.org/");
  assert.equal(normaliserSite("http://example.org/a"), "http://example.org/a");
  assert.equal(normaliserSite(""), null);
  assert.throws(() => normaliserSite("ftp://example.org"), /illisible/);
  assert.throws(() => normaliserSite("localhost"), /illisible/);
});

test("modification des coordonnées : seulement les champs envoyés ; vide efface ; le département suit le code postal", () => {
  assert.deepEqual(validerModifContact({ dirigeant: "", cp: "38000" }, "FR"), { dirigeant: null, cp: "38000", departement: "38" });
  assert.deepEqual(validerModifContact({ mobile: "06 39 98 00 41" }, "FR"), { mobile: "+33639980041" });
  assert.throws(() => validerModifContact({}, "FR"), /Rien à modifier/);
  assert.throws(() => validerModifContact({ telephone: "abc" }, "FR"), /numéro illisible/);
  assert.throws(() => validerModifContact("tout", "FR"), /illisible/);
});

test("trace datée des modifications manuelles dans les sources", () => {
  const sources = [
    { type: "sirene", le: "2026-10-01" },
    { type: "saisie_manuelle", donnee: "telephone", le: "2026-10-15", origine: "manuel" },
  ];
  assert.equal(marquerSaisiesManuelles({ dirigeant: "Camille Démo" }, { dirigeant: " Camille  Démo " }, sources, "2026-11-09"), null, "rien de changé");
  assert.deepEqual(marquerSaisiesManuelles({ telephone: "+33199000101", dirigeant: null }, { telephone: "+33199000102", dirigeant: "Lou Démo" }, sources, "2026-11-09"), [
    { type: "sirene", le: "2026-10-01" },
    { type: "saisie_manuelle", donnee: "dirigeant", le: "2026-11-09", origine: "manuel" },
    { type: "saisie_manuelle", donnee: "telephone", le: "2026-11-09", origine: "manuel" },
  ]);
  assert.deepEqual(marquerSaisiesManuelles({ telephone: "+33199000101" }, { telephone: null }, sources, "2026-11-09"), [{ type: "sirene", le: "2026-10-01" }], "une donnée effacée perd sa trace");
  assert.equal(marquerSaisiesManuelles({}, { site: "https://example.org" }, sources, "2026-11-09"), null, "le site n'est pas suivi");
});

test("les sources d'une fiche, lisibles ; un lien n'est gardé qu'en http(s)", () => {
  assert.deepEqual(
    lireSources([
      { type: "demo", le: "2026-11-09" },
      { type: "site", le: "2026-11-09T10:00:00Z", url: "javascript:alert(1)" },
      { type: "saisie_manuelle", donnee: "telephone", le: "2026-11-09" },
      "texte",
    ]),
    [
      { libelle: "Démonstration (fiche fictive)", le: "2026-11-09", url: null, precision: null, donnee: null },
      { libelle: "Site internet de l'entreprise", le: "2026-11-09", url: null, precision: null, donnee: null },
      { libelle: "Saisie manuelle", le: "2026-11-09", url: null, precision: null, donnee: "téléphone" },
    ],
  );
  assert.deepEqual(lireSources(null), []);
  assert.deepEqual(lireSources([{ type: "accroche", url: "https://example.org/realisations", extrait: "Terrasse en bois", le: "2026-11-09" }]), [
    { libelle: "Page du site d'où vient l'accroche", le: "2026-11-09", url: "https://example.org/realisations", precision: "Terrasse en bois", donnee: null },
  ]);
});

test("les sources écrites par l'import gardent leur précision à l'écran (le détail : quel fichier, quel registre)", () => {
  const sources = construireSources(
    { source: "Annuaire démo", source_date: "2026-11-02", coordonnees_source: "manuel", coordonnees_date: "2026-11-03" },
    { aujourdhui: "2026-11-09", coordonnees: true },
  );
  const lues = lireSources([...sources, { type: "sirene", detail: "registre SIRENE (API Recherche Entreprises)", le: "2026-11-01" }, { type: "debrief", le: "2026-11-04" }]);
  assert.deepEqual(lues.map((l) => [l.libelle, l.precision, l.le]), [
    ["Fichier apporté par l'équipe", "Annuaire démo", "2026-11-02"],
    ["Saisie manuelle (fichier de l'équipe)", "téléphone et site : saisie manuelle", "2026-11-03"],
    ["Registre public des entreprises", "registre SIRENE (API Recherche Entreprises)", "2026-11-01"],
    ["Débrief d'un appel", null, "2026-11-04"],
  ]);
});
