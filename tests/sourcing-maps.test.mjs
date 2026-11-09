// Google Maps (scripts/sourcing/maps.mjs) : désactivé par défaut (message, rien de chargé), Playwright absent (message d'installation),
// et toute la logique autour du navigateur avec un FAUX navigateur (aucun accès à Google) : plan des recherches, lecture des fiches,
// cadence lente, blocages, maximum, reprise, mode enrichir suivi de l'appariement.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { analyserNiche } from "../config/charger.ts";
import { executer as apparier } from "../scripts/sourcing/appariement.mjs";
import { lireCsv } from "../scripts/sourcing/csv.mjs";
import { estBloqueTexte, executer, MESSAGE_DESACTIVE, MESSAGE_PLAYWRIGHT, planRecherches, versFiche } from "../scripts/sourcing/maps.mjs";
import { dossierTemporaire, e164, fausseHorloge, fixe, niche, sirenFictif } from "./sourcing-outils.mjs";

const MAINTENANT = new Date("2026-11-09T09:00:00Z");

function nicheActive({ motsCles = ["paysagiste"], villes = ["Lyon", "Bron"], max = 50 } = {}) {
  const n = niche();
  n.sources.maps = { actif: true, motsCles, villes, max };
  assert.equal(analyserNiche(n).ok, true);
  return n;
}

const brut = (n, o = {}) => ({
  titre: o.titre ?? `Atelier Démo ${String(n).padStart(2, "0")}`,
  tel: o.tel ?? fixe(n),
  site: o.site ?? `https://example.org/atelier-demo-${n}?utm_source=maps`,
  adresse: o.adresse ?? `Adresse : ${n} Rue Démo, 69003 Lyon`,
  noteAvis: o.noteAvis ?? "4,6\n(12)",
  categorie: o.categorie ?? "Paysagiste",
  lien: o.lien ?? `https://www.google.com/maps/place/atelier-demo-${n}`,
});

function fauxNavigateur(reponses) {
  const etat = { requetes: [], ferme: false };
  return {
    etat,
    async chercher(requete, { max }) {
      etat.requetes.push({ requete, max });
      const r = typeof reponses === "function" ? reponses(requete, max) : reponses.shift();
      return r ?? { statut: "ok", fiches: [] };
    },
    async fermer() {
      etat.ferme = true;
    },
  };
}

test("désactivé par défaut : un message qui explique le risque et comment l'activer ; Playwright n'est jamais chargé", async () => {
  const n = niche();
  assert.equal(n.sources.maps.actif, false, "la niche d'exemple est livrée avec Maps désactivé");
  let charge = false;
  const r = await executer({ niche: n, mode: "chercher", dossier: "/inexistant", dependances: { chargerPlaywright: async () => (charge = true) } });
  assert.equal(r.code, 1);
  assert.equal(charge, false);
  assert.deepEqual(r.lignes, MESSAGE_DESACTIVE);
  const texte = MESSAGE_DESACTIVE.join("\n");
  assert.match(texte, /conditions d'utilisation de Google/);
  assert.match(texte, /sources\.maps\.actif = true/);
  assert.match(texte, /npm install --no-save playwright/);
  delete n.sources.maps;
  assert.equal((await executer({ niche: n, mode: "chercher", dossier: "/inexistant" })).code, 1, "sources.maps absent : désactivé aussi");
});

test("activé sans Playwright : le message d'installation, sans rien écrire", async () => {
  const dossier = dossierTemporaire();
  try {
    const r = await executer({
      niche: nicheActive(),
      mode: "chercher",
      dossier: dossier.chemin,
      dependances: { chargerPlaywright: async () => Promise.reject(Object.assign(new Error("absent"), { code: "ERR_MODULE_NOT_FOUND" })) },
    });
    assert.equal(r.code, 1);
    assert.deepEqual(r.lignes, MESSAGE_PLAYWRIGHT);
    assert.ok(!existsSync(join(dossier.chemin, "cache")));
  } finally {
    dossier.supprimer();
  }
});

test("--essai : le nombre de recherches et la durée, sans navigateur", async () => {
  let charge = false;
  const r = await executer({ niche: nicheActive(), mode: "chercher", dossier: "/inexistant", essai: true, dependances: { chargerPlaywright: async () => (charge = true) } });
  assert.equal(r.code, 0);
  assert.equal(charge, false);
  assert.equal(r.compteurs.recherches, 2);
});

test("le plan : mots-clés × villes ; enrichir : une recherche par entreprise sans téléphone ou sans site, avec son SIREN", () => {
  assert.deepEqual(
    planRecherches(nicheActive({ motsCles: ["paysagiste", "élagage"], villes: ["Lyon"] }), "chercher").map((r) => r.requete),
    ["paysagiste Lyon", "élagage Lyon"],
  );
  const base = [
    { entreprise: "ATELIER DEMO 01", enseigne: "Les Jardins Démo | Démo Paysage", siren: sirenFictif(1), ville: "LYON" },
    { entreprise: "ATELIER DEMO 02", siren: sirenFictif(2), ville: "BRON", telephone: fixe(2), site: "https://example.org/2" },
    { entreprise: "ATELIER DEMO 03", siren: sirenFictif(3), ville: "LYON", telephone: fixe(3) },
  ];
  assert.deepEqual(planRecherches(nicheActive(), "enrichir", base), [
    { requete: "Les Jardins Démo LYON", siren_recherche: sirenFictif(1) },
    { requete: "ATELIER DEMO 03 LYON", siren_recherche: sirenFictif(3) },
  ]);
});

test("une fiche lue : numéro en E.164, site sans paramètres, code postal, département, note, avis ; lien Maps seulement", () => {
  const f = versFiche(brut(1), { pays: "FR", le: "2026-11-09" });
  assert.deepEqual(f, {
    entreprise: "Atelier Démo 01",
    telephone: e164(fixe(1)),
    site: "https://example.org/atelier-demo-1",
    ville: "Lyon",
    code_postal: "69003",
    departement: "69",
    note_google: "4.6",
    nb_avis: "12",
    maps_categorie: "Paysagiste",
    siren_recherche: "",
    source: "maps",
    source_url: "https://www.google.com/maps/place/atelier-demo-1",
    source_date: "2026-11-09",
  });
  assert.equal(versFiche(brut(2, { lien: "https://example.net/piege" }), { pays: "FR", le: "2026-11-09" }).source_url, "");
  assert.equal(versFiche(brut(3, { tel: "" }), { pays: "FR", le: "2026-11-09" }).telephone, "");
});

test("blocage reconnu : page « sorry », captcha, trafic inhabituel", () => {
  assert.equal(estBloqueTexte("https://www.google.com/sorry/index", ""), true);
  assert.equal(estBloqueTexte("https://www.google.com/maps", "Nos systèmes ont détecté un trafic inhabituel"), true);
  assert.equal(estBloqueTexte("https://www.google.com/maps", "Atelier Démo 01"), false);
});

test("chercher : fiches gardées sans doublon, maximum de la config, cadence lente, CSV au format d'import, navigateur refermé", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const nav = fauxNavigateur([
      { statut: "ok", fiches: [brut(1), brut(2), brut(3)] },
      { statut: "ok", fiches: [brut(3), brut(4), brut(5)] },
    ]);
    const r = await executer({
      niche: nicheActive({ max: 4 }),
      mode: "chercher",
      dossier: dossier.chemin,
      dependances: { navigateur: nav, attendre: h.attendre, alea: () => 0.5, maintenant: MAINTENANT },
    });
    assert.equal(r.code, 0);
    assert.deepEqual([r.compteurs.fiches_gardees, r.compteurs.doublons, r.compteurs.total], [4, 1, 4]);
    assert.deepEqual(nav.etat.requetes.map((q) => q.requete), ["paysagiste Lyon", "paysagiste Bron"]);
    assert.equal(nav.etat.requetes[1].max, 1, "on ne demande que ce qui manque pour atteindre le maximum");
    assert.ok(h.etat.attentes.includes(6000), "une pause de 4 à 8 secondes entre deux recherches");
    assert.ok(nav.etat.ferme);
    assert.ok(!r.lignes.join("\n").includes("Démo"), "le rapport ne cite aucune donnée");
    const { colonnes, lignes } = lireCsv(readFileSync(join(dossier.chemin, "maps-chercher-2026-11-09.csv"), "utf8"));
    assert.deepEqual(colonnes.slice(0, 2), ["entreprise", "telephone"]);
    assert.deepEqual(lignes.map((l) => l.entreprise), ["Atelier Démo 01", "Atelier Démo 02", "Atelier Démo 03", "Atelier Démo 04"]);
  } finally {
    dossier.supprimer();
  }
});

test("blocages : 10 minutes de pause puis on reprend ; arrêt propre après 3 de suite, et la relance reprend au même endroit", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const bloque = { statut: "bloque", fiches: [] };
    const nav = fauxNavigateur([bloque, { statut: "ok", fiches: [brut(1)] }, bloque, bloque, bloque]);
    const n = nicheActive({ villes: ["Lyon", "Bron", "Vienne"] });
    const deps = { navigateur: nav, attendre: h.attendre, alea: () => 0, maintenant: MAINTENANT };
    const r = await executer({ niche: n, mode: "chercher", dossier: dossier.chemin, dependances: deps });
    assert.equal(r.code, 1);
    assert.ok(r.lignes.some((l) => /ARRÊT/.test(l)));
    assert.equal(h.etat.attentes.filter((ms) => ms === 600000).length, 3, "trois pauses de 10 minutes");
    assert.deepEqual(nav.etat.requetes.map((q) => q.requete), ["paysagiste Lyon", "paysagiste Lyon", "paysagiste Bron", "paysagiste Bron", "paysagiste Bron"]);

    const suite = fauxNavigateur([{ statut: "ok", fiches: [brut(2)] }, { statut: "ok", fiches: [brut(3)] }]);
    const r2 = await executer({ niche: n, mode: "chercher", dossier: dossier.chemin, dependances: { ...deps, navigateur: suite } });
    assert.equal(r2.code, 0);
    assert.deepEqual(suite.etat.requetes.map((q) => q.requete), ["paysagiste Bron", "paysagiste Vienne"], "reprise à la recherche bloquée");
    const lignes = lireCsv(readFileSync(join(dossier.chemin, "maps-chercher-2026-11-09.csv"), "utf8")).lignes;
    assert.deepEqual(lignes.map((l) => l.entreprise), ["Atelier Démo 01", "Atelier Démo 02", "Atelier Démo 03"]);
  } finally {
    dossier.supprimer();
  }
});

test("12 recherches vides de suite : arrêt propre (blocage silencieux)", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const villes = Array.from({ length: 15 }, (_, i) => `Ville Démo ${i + 1}`);
    const nav = fauxNavigateur(() => ({ statut: "ok", fiches: [] }));
    const r = await executer({ niche: nicheActive({ villes }), mode: "chercher", dossier: dossier.chemin, dependances: { navigateur: nav, attendre: h.attendre, alea: () => 0, maintenant: MAINTENANT } });
    assert.equal(r.code, 1);
    assert.equal(nav.etat.requetes.length, 12);
  } finally {
    dossier.supprimer();
  }
});

test("enrichir puis apparier : les fiches portent le SIREN cherché, l'appariement choisit la bonne", async () => {
  const dossier = dossierTemporaire();
  try {
    const base = join(dossier.chemin, "base.csv");
    writeFileSync(base, `entreprise;siren;ville;code_postal\nAtelier Démo 01;${sirenFictif(1)};Lyon;69003\nAtelier Démo 02;${sirenFictif(2)};Lyon;69003\n`);
    const nav = fauxNavigateur((requete) => ({
      statut: "ok",
      fiches: requete.startsWith("Atelier Démo 01") ? [brut(9, { titre: "Atelier Démo 09", tel: fixe(9) }), brut(1)] : [],
    }));
    const h = fausseHorloge(0);
    const sortie = join(dossier.chemin, "fiches.csv");
    const r = await executer({ niche: nicheActive(), mode: "enrichir", base, sortie, dossier: dossier.chemin, dependances: { navigateur: nav, attendre: h.attendre, alea: () => 0, maintenant: MAINTENANT } });
    assert.equal(r.code, 0);
    assert.deepEqual(nav.etat.requetes.map((q) => q.max), [3, 3], "trois fiches au plus par entreprise");
    const fiches = lireCsv(readFileSync(sortie, "utf8")).lignes;
    assert.ok(fiches.every((f) => f.siren_recherche === sirenFictif(1)));
    const fin = await apparier({ niche: nicheActive(), base, fiches: sortie, sortie: join(dossier.chemin, "fin.csv") });
    assert.equal(fin.compteurs.rapprochees["zone+nom"], 1);
    const lignes = lireCsv(readFileSync(join(dossier.chemin, "fin.csv"), "utf8")).lignes;
    assert.equal(lignes[0].telephone, e164(fixe(1)));
    assert.equal(lignes[0].coordonnees_source, "maps");
    assert.equal(lignes[1].telephone, "");
  } finally {
    dossier.supprimer();
  }
});
