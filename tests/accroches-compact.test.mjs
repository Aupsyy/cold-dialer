// Accroches, le compactage : les phrases à mots indices, lieux, années et noms propres sont gardées mot pour mot ; le bruit, les
// e-mails, numéros et identifiants légaux sont écartés ; le tout borné à N caractères. Tout est fictif.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compacter, compacterSite, ligneEcartee, preparerIndices } from "../scripts/accroches/compact.mjs";
import { exemple } from "./aides.mjs";

const INDICES = preparerIndices(exemple().accroche.motsIndices);
const S = "https://atelier-demo-11.example.org";

const CRAWL = {
  id: "f11",
  site: `${S}/`,
  origine: S,
  pages: [
    {
      url: `${S}/`,
      titre: "Accueil",
      description: "Bienvenue chez nous.",
      titres: ["Accueil", "Nos réalisations"],
      texte: [
        "Bienvenue sur notre site.",
        "Entreprise familiale fondée en 2009 à Vienne, au service des particuliers.",
        "Nous utilisons des cookies pour améliorer votre expérience de navigation.",
        "Contactez-nous au 01 99 00 00 11 ou par e-mail : contact11@example.com pour un devis.",
        "SARL au capital de 10 000 euros, SIRET 000 000 011 00010, RCS fictif.",
        "Court.",
        "Création d'une terrasse en bois et d'un massif de graminées pour une maison de ville.",
        "Un texte très ordinaire qui ne dit rien de particulier sur rien du tout.",
        "Terrasse à Bron",
        "Voir le projet",
      ].join("\n"),
      lu_le: "2026-11-02T09:00:00.000Z",
    },
    {
      url: `${S}/realisations/jardin-sec`,
      titre: "Jardin sec à Bron",
      description: "",
      titres: ["Jardin sec à Bron"],
      texte: "Jardin sec à Bron\nPlantation de graminées et d'oliviers dans une cour de 80 m2.",
      lu_le: "2026-11-02T09:00:03.000Z",
    },
  ],
};

test("lignes gardées : mots indices de la config, année, lieu, titre de page interne", () => {
  const c = compacterSite(CRAWL, { indices: INDICES });
  const textes = c.indices.map((i) => i.texte);
  assert.ok(textes.includes("Entreprise familiale fondée en 2009 à Vienne, au service des particuliers."));
  assert.ok(textes.includes("Création d'une terrasse en bois et d'un massif de graminées pour une maison de ville."));
  assert.ok(textes.includes("Jardin sec à Bron"));
  assert.ok(textes.includes("Plantation de graminées et d'oliviers dans une cour de 80 m2."));
  assert.ok(textes.includes("Terrasse à Bron"), "une légende courte qui nomme un projet reste");
  const titre = c.indices.find((i) => i.texte === "Jardin sec à Bron");
  assert.equal(titre.type, "titre");
  assert.equal(titre.url, `${S}/realisations/jardin-sec`);
});

test("lignes écartées : bruit, e-mail, téléphone, identifiants légaux, titres génériques, phrases sans indice, trop courtes", () => {
  const c = compacterSite(CRAWL, { indices: INDICES });
  const tout = c.indices.map((i) => i.texte).join("\n");
  for (const absent of ["cookies", "contact11@example.com", "01 99 00", "SIRET", "Court.", "Bienvenue", "ne dit rien", "Nos réalisations", "Voir le projet"]) {
    assert.ok(!tout.includes(absent), `ne devrait pas rester : ${absent}`);
  }
  assert.ok(!c.indices.some((i) => i.texte === "Accueil"));
  assert.ok(ligneEcartee("Écrivez à equipe@example.com"));
  assert.ok(ligneEcartee("Tél. +33 1 99 00 00 12"));
  assert.ok(!ligneEcartee("Création d'un bassin naturel à Vienne en 2019."));
});

test("les lignes restent mot pour mot (aucune réécriture), dans l'ordre des pages", () => {
  const c = compacterSite(CRAWL, { indices: INDICES });
  for (const l of c.indices) {
    const page = CRAWL.pages.find((p) => p.url === l.url);
    assert.ok([page.titre, ...page.titres, page.texte].some((t) => t.includes(l.texte)), l.texte);
  }
  const urls = c.indices.map((i) => i.url);
  assert.deepEqual(urls, [...urls].sort((a, b) => (a === b ? 0 : a === `${S}/` ? -1 : 1)));
});

test("borne de N caractères : les lignes les plus parlantes d'abord", () => {
  const c = compacterSite(CRAWL, { indices: INDICES, maxCaracteres: 100 });
  assert.ok(c.caracteres <= 100);
  assert.ok(c.indices.length >= 1);
  assert.ok(c.indices.some((i) => /terrasse|2009/.test(i.texte)), JSON.stringify(c.indices));
});

test("compacter : une fiche en erreur de crawl reste listée, sans lignes ; la dernière ligne d'une fiche compte", () => {
  const { sorties, bilan } = compacter(
    [{ id: "f12", site: "https://atelier-demo-12.example.org/", erreur: "robots_interdit" }, { ...CRAWL, pages: [] }, CRAWL],
    { motsIndices: exemple().accroche.motsIndices },
  );
  assert.equal(bilan.fiches, 2);
  assert.equal(bilan.enErreur, 1);
  assert.equal(bilan.avecIndices, 1);
  assert.deepEqual(sorties.find((s) => s.id === "f12").indices, []);
  assert.ok(sorties.find((s) => s.id === "f11").indices.length > 0);
});

test("M20 : numéros et e-mails écartés sous toutes leurs formes (séparateurs, « (0) », Belgique, Suisse, Amérique du Nord, adresse masquée)", () => {
  for (const ligne of [
    "Appelez le +33 (0)1 99 00 01 02 pour un devis de terrasse.",
    "Notre atelier de Bruxelles : 02 000 00 01, du lundi au vendredi.",
    "Joignable au +32 2 000 00 01 pour vos bassins naturels.",
    "Bureau de Genève : 022 000 00 00, pour vos jardins en ville.",
    "Notre équipe d'Ottawa répond au (555) 000-0001 ou au 1 555 000 0001 pour les terrasses.",
    "Pour un rendez-vous au jardin : 01.99.00.01.02 ou 06/39/98/01/02.",
    "Atelier de Lyon 69003 04 65 71 00 00 pour vos bassins.",
    "Devis gratuit au +3220000001 ou au +41 22 000 00 00.",
    "Écrivez à contact [at] atelier-demo-01 [dot] example [dot] org pour un projet.",
    "Votre projet de bassin : bonjour (at) atelier-demo-01.example.org dès aujourd'hui.",
  ]) {
    assert.equal(ligneEcartee(ligne), true, ligne);
  }
  for (const ligne of [
    "Entreprise familiale fondée en 2009, à Vienne, 38200.",
    "Nos chantiers de 2018, 2019 et 2020 à Bron.",
    "Une terrasse de 1 200 m² et un bassin de 35 m³.",
    "Créée le 02/03/2009 par deux paysagistes passionnés.",
  ]) {
    assert.equal(ligneEcartee(ligne), false, ligne);
  }
});
