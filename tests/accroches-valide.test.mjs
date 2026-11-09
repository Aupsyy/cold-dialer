// Accroches, le contrôle anti-invention : les cas inventés sont refusés (lieu, année, nombre ou mot absents du site, chiffre de
// résultat, promesse, flatterie, mot interdit de la config, extrait introuvable, page non lue, longueur), les cas fidèles au site
// passent, et toute accroche signalée sort VIDÉE (jamais corrigée). Site et accroches 100 % fictifs.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PROMESSES_INTERDITES } from "../config/garde-fous.ts";
import { schemaNiche } from "../config/schema.ts";
import { contexteFiche, elementsAVerifier, preparerRegles, validerReponses, verifierAccroche } from "../scripts/accroches/lib/validation.mjs";
import { principal as valider } from "../scripts/accroches/valide.mjs";
import { principal as revue } from "../scripts/accroches/revue.mjs";
import { RACINE, exemple } from "./aides.mjs";

const NICHE = schemaNiche.parse(exemple());
const REGLES = preparerRegles(NICHE, PROMESSES_INTERDITES);
const S = "https://atelier-demo-21.example.org";
const REALISATIONS = `${S}/realisations`;
const A_PROPOS = `${S}/a-propos`;

const CRAWL = {
  id: "f21",
  site: `${S}/`,
  origine: S,
  pages: [
    { url: `${S}/`, titre: "Atelier Démo 21", description: "", titres: [], texte: "Paysagiste fictif.", lu_le: "2026-11-02T09:00:00.000Z" },
    {
      url: REALISATIONS,
      titre: "Nos réalisations",
      description: "",
      titres: ["Bassin naturel à Vienne"],
      texte: "Création d'un bassin naturel à Vienne en 2019.\nTerrasse en bois exotique et massif de graminées pour une maison de ville.",
      lu_le: "2026-11-02T22:30:00.000Z",
    },
    {
      url: A_PROPOS,
      titre: "À propos",
      description: "",
      titres: [],
      texte: "Entreprise familiale fondée en 2009 par deux paysagistes passionnés.",
      lu_le: "2026-11-02T09:00:02.000Z",
    },
  ],
};
const COMPACT = {
  id: "f21",
  site: `${S}/`,
  indices: [
    { url: REALISATIONS, type: "titre", texte: "Bassin naturel à Vienne" },
    { url: REALISATIONS, type: "phrase", texte: "Création d'un bassin naturel à Vienne en 2019." },
    { url: REALISATIONS, type: "phrase", texte: "Terrasse en bois exotique et massif de graminées pour une maison de ville." },
    { url: A_PROPOS, type: "phrase", texte: "Entreprise familiale fondée en 2009 par deux paysagistes passionnés." },
  ],
};
const CTX = contexteFiche(COMPACT, CRAWL);
const BASSIN = { url: REALISATIONS, extrait: "Création d'un bassin naturel à Vienne en 2019." };
const FAMILLE = { url: A_PROPOS, extrait: "Entreprise familiale fondée en 2009 par deux paysagistes passionnés." };

function motifs(accroche, source = BASSIN, regles = REGLES) {
  return verifierAccroche({ accroche, source }, CTX, regles).motifs.map((m) => m.code);
}

test("accroches fidèles au site : acceptées", () => {
  assert.deepEqual(motifs("J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?"), []);
  assert.deepEqual(
    motifs("Je vois que votre entreprise familiale a été fondée en 2009 par deux paysagistes : vous êtes toujours aussi passionnés aujourd'hui ?", FAMILLE),
    [],
  );
  assert.deepEqual(
    motifs("Votre terrasse en bois exotique avec son massif de graminées m'a arrêté : c'est ce genre de projet que vous aimeriez faire plus souvent ?", {
      url: `${REALISATIONS}/`,
      extrait: "terrasse en bois exotique et massif de graminées",
    }),
    [],
  );
});

test("les trois exemples de config/niche.exemple.json passent sur un site qui contient leurs éléments", () => {
  const site = {
    id: "f22",
    pages: [{ url: `${S}/`, titre: "", titres: [], texte: "", lu_le: "2026-11-02T09:00:00.000Z" }],
  };
  const lignes = [
    "La terrasse en bois et le massif de graminées de la maison de ville.",
    "Nos bassins naturels.",
    "L'entretien à l'année de vos jardins.",
  ];
  site.pages[0].texte = lignes.join("\n");
  const ctx = contexteFiche({ indices: lignes.map((texte) => ({ url: `${S}/`, texte })) }, site);
  NICHE.accroche.exemples.forEach((accroche, i) => {
    const r = verifierAccroche({ accroche, source: { url: `${S}/`, extrait: lignes[i] } }, ctx, REGLES);
    assert.deepEqual(r.motifs, [], accroche);
  });
});

test("lieu absent du site : refusé", () => {
  assert.deepEqual(motifs("J'ai vu sur votre site le bassin naturel réalisé à Grenoble en 2019 : c'est ce type de chantier que vous voulez développer ?"), ["lieu_absent"]);
});

test("année absente du site : refusée", () => {
  assert.deepEqual(motifs("J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2018 : c'est ce type de chantier que vous voulez développer ?"), ["annee_absente"]);
});

test("mot ou nom propre absent du site (matériau, style inventés) : refusé", () => {
  assert.ok(motifs("J'ai vu sur votre site le bassin naturel en pierre de Bourgogne réalisé à Vienne : c'est ce type de chantier que vous voulez développer ?").includes("mot_absent"));
  assert.ok(motifs("J'ai vu sur votre site le bassin naturel réalisé pour la famille Martin à Vienne : c'est ce type de chantier que vous voulez développer ?").includes("nom_propre_absent"));
  assert.ok(motifs("J'ai vu sur votre site vos 12 bassins naturels réalisés à Vienne depuis 2019 : c'est ce type de chantier que vous voulez développer ?").includes("nombre_absent"));
});

test("chiffre de résultat et promesse : refusés, même avec des éléments vrais", () => {
  assert.ok(motifs("Avec votre bassin naturel à Vienne en 2019, nous pourrions vous apporter 30 % de demandes en plus chaque mois, ça vous parle ?").includes("promesse"));
  assert.ok(motifs("J'ai vu votre bassin naturel à Vienne en 2019 : avec nous, ce type de chantier vous apporterait +20 demandes, ça vous intéresse ?").includes("promesse"));
  assert.ok(motifs("J'ai vu votre bassin naturel à Vienne en 2019 : nous vous garantissons des demandes sérieuses sur ce type de chantier, ça vous intéresse ?").includes("promesse"));
  assert.ok(motifs("J'ai vu votre bassin naturel à Vienne en 2019 : nos résultats sur ce type de chantier vous plairaient, vous voulez en parler ?").includes("promesse"));
});

test("flatterie vide et mot interdit par la config : refusés", () => {
  assert.ok(motifs("Votre bassin naturel à Vienne en 2019 est vraiment magnifique, bravo : c'est ce type de chantier que vous voulez faire plus souvent ?").includes("flatterie"));
  const regles = preparerRegles({ accroche: { longueurMax: 160, interdits: ["exotique"] } }, PROMESSES_INTERDITES);
  const m = motifs(
    "Votre terrasse en bois exotique avec son massif de graminées m'a arrêté : c'est ce genre de projet que vous aimeriez faire plus souvent ?",
    { url: REALISATIONS, extrait: "Terrasse en bois exotique et massif de graminées" },
    regles,
  );
  assert.deepEqual(m, ["interdit"]);
});

test("source : page non lue pour cette fiche, extrait introuvable ou sans rapport, source absente : refusés", () => {
  const phrase = "J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?";
  assert.ok(motifs(phrase, { url: `${S}/une-page-jamais-lue`, extrait: BASSIN.extrait }).includes("source_hors_crawl"));
  assert.ok(motifs(phrase, { url: "https://atelier-demo-99.example.org/realisations", extrait: BASSIN.extrait }).includes("source_hors_crawl"));
  assert.ok(motifs(phrase, { url: REALISATIONS, extrait: "Création d'un bassin naturel à Lyon en 2019." }).includes("extrait_absent"));
  assert.ok(motifs(phrase, { url: A_PROPOS, extrait: "par deux paysagistes passionnés" }).includes("extrait_sans_rapport"));
  assert.ok(motifs(phrase, null).includes("source"));
  assert.ok(motifs(phrase, { url: REALISATIONS, extrait: "bassin" }).includes("extrait"));
});

test("forme : longueur (15 à 30 mots, longueurMax caractères), une seule phrase, majuscule, ponctuation, tiret long", () => {
  assert.ok(motifs("J'ai vu votre bassin naturel à Vienne.").includes("longueur"));
  assert.ok(
    motifs("J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 et la terrasse en bois exotique avec son massif de graminées pour une maison de ville : c'est ce type de chantier que vous voulez développer ?").includes("longueur"),
  );
  assert.ok(motifs("j'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?").includes("phrase"));
  assert.ok(motifs("J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019. C'est ce type de chantier que vous voulez développer ?").includes("phrase"));
  assert.ok(motifs("J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 — c'est ce type de chantier que vous voulez développer ?").includes("tiret"));
  assert.ok(motifs("J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer").includes("phrase"));
});

test("aucun élément vérifiable (formule creuse) : refusée", () => {
  assert.deepEqual(motifs("J'ai vu votre site et vos réalisations : c'est le type de chantier que vous voulez développer davantage aujourd'hui ?"), ["aucun_element"]);
  assert.deepEqual(elementsAVerifier("J'ai vu votre bassin à Vienne en 2019").map((e) => e.type), ["mot", "lieu", "annee"]);
});

test("validerReponses : retenues datées, vidées (jamais corrigées), sans accroche, inconnues, doublons", () => {
  const crawls = new Map([["f21", CRAWL]]);
  const compacts = new Map([["f21", COMPACT]]);
  const vraie = "J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?";
  const inventee = "J'ai vu sur votre site le bassin naturel réalisé à Grenoble en 2019 : c'est ce type de chantier que vous voulez développer ?";
  const { validees, compteurs } = validerReponses(
    [
      { id: "f21", accroche: inventee, source: BASSIN },
      { id: "f21", accroche: vraie, source: BASSIN },
      { id: "inconnue", accroche: vraie, source: BASSIN },
      "pas un objet",
    ],
    { compacts, crawls, regles: REGLES, fuseau: "Europe/Paris" },
  );
  assert.equal(validees.length, 1);
  assert.equal(validees[0].accroche, "");
  assert.equal(validees[0].source, null);
  assert.equal(validees[0].refusee, inventee);
  assert.deepEqual(validees[0].motifs.map((m) => m.code), ["lieu_absent"]);
  assert.deepEqual(compteurs, { lues: 4, retenues: 0, videes: 1, sansAccroche: 0, inconnues: 1, doublons: 1, malFormees: 1, motifs: { lieu_absent: 1 } });

  const bon = validerReponses([{ id: "f21", accroche: vraie, source: BASSIN }], { compacts, crawls, regles: REGLES, fuseau: "Europe/Paris" });
  assert.deepEqual(bon.validees[0].source, { url: REALISATIONS, extrait: BASSIN.extrait, le: "2026-11-02" });
  const nuit = validerReponses([{ id: "f21", accroche: vraie, source: BASSIN }], { compacts, crawls, regles: REGLES, fuseau: "Pacific/Auckland" });
  assert.equal(nuit.validees[0].source.le, "2026-11-03");
  const vide = validerReponses([{ id: "f21", accroche: "", source: null }], { compacts, crawls, regles: REGLES, fuseau: "Europe/Paris" });
  assert.deepEqual(vide.validees, [{ id: "f21", accroche: "", source: null, motifs: [] }]);
  assert.equal(vide.compteurs.sansAccroche, 1);
});

test("valide.mjs puis revue.mjs : fichiers écrits, accroches signalées vidées, console en compteurs, --vider à la relecture", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "accroches-valide-"));
  const config = fileURLToPath(new URL("config/niche.exemple.json", RACINE));
  const journal = [];
  const noter = (l) => journal.push(l);
  try {
    writeFileSync(join(dossier, "crawl.jsonl"), `${JSON.stringify(CRAWL)}\n${JSON.stringify({ ...CRAWL, id: "f23" })}\n`);
    writeFileSync(join(dossier, "compact.jsonl"), `${JSON.stringify(COMPACT)}\n${JSON.stringify({ ...COMPACT, id: "f23" })}\n`);
    writeFileSync(join(dossier, "a-crawler.json"), JSON.stringify([{ id: "f21", entreprise: "Atelier Démo 21", site: `${S}/` }]));
    mkdirSync(join(dossier, "reponses"));
    writeFileSync(
      join(dossier, "reponses", "lot-001.json"),
      JSON.stringify([
        { id: "f21", accroche: "J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?", source: BASSIN },
        { id: "f23", accroche: "Votre bassin naturel à Vienne est magnifique : vous en faites beaucoup dans la région de Lyon depuis 2015 ?", source: BASSIN },
      ]),
    );
    assert.equal(await valider(["--dossier", dossier, "--config", config], { journal: noter }), 0);
    const validees = JSON.parse(readFileSync(join(dossier, "validees.json"), "utf8"));
    assert.equal(validees.find((v) => v.id === "f21").accroche.length > 0, true);
    const f23 = validees.find((v) => v.id === "f23");
    assert.equal(f23.accroche, "");
    assert.ok(f23.motifs.some((m) => m.code === "flatterie"));
    const rapport = readFileSync(join(dossier, "rapport-validation.md"), "utf8");
    assert.ok(rapport.includes("| Accroches retenues | 1 |") && rapport.includes("- f23 :"));
    assert.ok(!rapport.includes("magnifique"), "le rapport ne recopie pas le texte refusé");

    assert.equal(await revue(["--dossier", dossier], { journal: noter }), 0);
    const md = readFileSync(join(dossier, "revue.md"), "utf8");
    assert.ok(md.includes("### Atelier Démo 21") && md.includes(`- Extrait du site : « ${BASSIN.extrait} »`));
    assert.ok(md.includes("## Vidées (jamais réécrites)"));

    assert.equal(await revue(["--dossier", dossier, "--vider", "f21"], { journal: noter }), 0);
    const apres = JSON.parse(readFileSync(join(dossier, "validees.json"), "utf8"));
    assert.equal(apres.find((v) => v.id === "f21").accroche, "");
    assert.ok(apres.find((v) => v.id === "f21").motifs.some((m) => m.code === "revue"));
    assert.ok(journal.every((l) => !/example\.org|Atelier Démo|bassin/i.test(l)), journal.join("\n"));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("M21 : un adjectif qui affirme un fait (dernier, grand, récent, principal…) doit être sur le site ; un superlatif ou un rang, dans l'extrait", () => {
  const invente = motifs("J'ai vu votre dernier et plus grand bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?");
  assert.ok(invente.includes("mot_absent"), invente.join(", "));
  assert.ok(invente.includes("superlatif_absent"), invente.join(", "));
  for (const adjectif of ["récent", "nouveau", "principal", "grand"]) {
    const m = motifs(`J'ai vu sur votre site le ${adjectif} bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?`);
    assert.ok(m.includes("mot_absent"), `${adjectif} : ${m.join(", ")}`);
  }
  // Un rang que le site écrit, mais ailleurs que dans l'extrait choisi : refusé (l'extrait doit le prouver).
  const site = { id: "f23", pages: [{ url: `${S}/`, titre: "", titres: [], texte: "Notre premier bassin naturel, créé à Vienne en 2019.\nNos jardins.", lu_le: "2026-11-02T09:00:00.000Z" }] };
  const lignes = ["Notre premier bassin naturel, créé à Vienne en 2019.", "Nos jardins."];
  const ctx = contexteFiche({ indices: lignes.map((texte) => ({ url: `${S}/`, texte })) }, site);
  const phrase = "J'ai vu sur votre site votre premier bassin naturel créé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?";
  assert.deepEqual(verifierAccroche({ accroche: phrase, source: { url: `${S}/`, extrait: lignes[0] } }, ctx, REGLES).motifs, []);
  const ailleurs = verifierAccroche({ accroche: `${phrase.slice(0, -1)}, vos jardins ?`, source: { url: `${S}/`, extrait: "Nos jardins." } }, ctx, REGLES);
  assert.ok(ailleurs.motifs.some((m) => m.code === "superlatif_absent" && m.detail === "premier"), JSON.stringify(ailleurs.motifs));
});
