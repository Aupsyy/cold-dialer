// La base SIRENE (scripts/sourcing/sirene.mjs) contre une FAUSSE API Recherche Entreprises (fetch injecté, réponses fictives) :
// plan des recherches, pagination, cadence (7 requêtes par seconde au plus), User-Agent de la config, reprise, découpage au-delà de
// 10 000 résultats, nouvelles tentatives (429, 500), non-diffusion, filtres du build, score, CSV. Aucun appel réseau réel.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { lireCsv } from "../scripts/sourcing/csv.mjs";
import {
  API,
  choisirDirigeant,
  codesPostauxCandidats,
  compacter,
  construire,
  decouper,
  DEPARTEMENTS,
  horsTaille,
  INTERVALLE_MS,
  metierDepuisNom,
  nonDiffusible,
  planifier,
  recolter,
} from "../scripts/sourcing/sirene.mjs";
import { dossierTemporaire, fausseHorloge, niche, reponse, sirenFictif } from "./sourcing-outils.mjs";

const MAINTENANT = new Date("2026-11-09T09:00:00Z");

/** Un résultat fictif de l'API (forme de la réponse de /search). */
function resultat(n, o = {}) {
  const siren = sirenFictif(n);
  const diffusion = o.diffusion ?? "O";
  return {
    siren,
    nom_complet: o.nom ?? `ATELIER DEMO ${String(n).padStart(3, "0")}`,
    sigle: null,
    nature_juridique: o.nj ?? "5499",
    activite_principale: o.naf ?? "81.30Z",
    date_creation: o.date ?? "2015-03-01",
    tranche_effectif_salarie: o.tranche ?? "03",
    etat_administratif: o.etat ?? "A",
    statut_diffusion: diffusion,
    siege: {
      siret: `${siren}00011`,
      code_postal: o.cp ?? "69003",
      libelle_commune: o.ville ?? "LYON",
      departement: o.dep ?? "69",
      etat_administratif: "A",
      statut_diffusion_etablissement: o.diffusionSiege ?? diffusion,
      liste_enseignes: o.enseignes ?? null,
      nom_commercial: null,
      adresse: "1 RUE DEMO",
    },
    dirigeants: o.dirigeants ?? [
      { nom: "DEMO", prenoms: "CAMILLE, ALEX", qualite: "Gérant", type_dirigeant: "personne physique", annee_de_naissance: "1980", nationalite: "Française" },
    ],
    complements: { est_entrepreneur_individuel: o.ei ?? false },
  };
}

/** Une fausse API : donnees(params) rend la liste complète d'une recherche ; la fausse API la pagine (10 000 accessibles au plus). */
function fausseApi(donnees, h, { pannes = [] } = {}) {
  const appels = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams);
    appels.push({ base: `${u.origin}${u.pathname}`, p, t: h.horloge(), ua: init.headers["user-agent"] });
    const panne = pannes.shift();
    if (panne) return panne;
    const tous = donnees(p);
    const parPage = Number(p.per_page);
    const page = Number(p.page);
    const debut = (page - 1) * parPage;
    return reponse(
      { results: tous.slice(0, 10000).slice(debut, debut + parPage), total_results: tous.length, page, per_page: parPage, total_pages: Math.ceil(tous.length / parPage) },
      { type: "application/json" },
    );
  };
  return { fetch, appels };
}

const dependances = (api, h) => ({ fetch: api.fetch, attendre: h.attendre, horloge: h.horloge, maintenant: MAINTENANT });

test("le plan : une recherche par NAF et par département ; « tous » : une par NAF ; découpage en départements puis en codes postaux", () => {
  const plan = planifier({ naf: ["81.30Z", "43.21A"], departements: ["69", "2A"] });
  assert.deepEqual(plan.map((r) => r.cle), ["81.30Z_69", "81.30Z_2A", "43.21A_69", "43.21A_2A"]);
  assert.deepEqual(plan[0].params, { activite_principale: "81.30Z", etat_administratif: "A", departement: "69" });
  const france = planifier({ naf: ["81.30Z"], departements: "tous" });
  assert.equal(france.length, 1);
  assert.equal(decouper(france[0]).length, DEPARTEMENTS.length);
  assert.equal(DEPARTEMENTS.length, 101);
  assert.ok(DEPARTEMENTS.includes("2B") && DEPARTEMENTS.includes("976") && !DEPARTEMENTS.includes("20"));
  const morceaux = decouper(plan[0]);
  assert.equal(morceaux.length, 1000);
  assert.deepEqual(morceaux[3].params, { activite_principale: "81.30Z", etat_administratif: "A", departement: "69", code_postal: "69003" });
  assert.equal(decouper(morceaux[3]), null, "un code postal ne se découpe plus");
  assert.deepEqual([codesPostauxCandidats("2A")[0], codesPostauxCandidats("2B")[0], codesPostauxCandidats("974").length], ["20000", "20200", 100]);
});

test("non-diffusion : l'unité (ou son siège) en diffusion partielle, ou un champ masqué, est écartée dès la récolte", () => {
  assert.equal(nonDiffusible(resultat(1)), false);
  assert.equal(nonDiffusible(resultat(1, { diffusion: "P" })), true);
  assert.equal(nonDiffusible(resultat(1, { diffusionSiege: "P" })), true);
  assert.equal(nonDiffusible(resultat(1, { nom: "[NON-DIFFUSIBLE]" })), true);
  assert.equal(compacter(resultat(1, { diffusion: "P" }), "2026-11-09"), null);
});

test("minimisation : le cache ne garde ni date de naissance, ni nationalité, ni adresse, ni dirigeant personne morale", () => {
  const brut = resultat(2, {
    dirigeants: [
      { denomination: "HOLDING DEMO", siren: sirenFictif(99), qualite: "Président", type_dirigeant: "personne morale" },
      { nom: "DEMO", prenoms: "SACHA", qualite: "Directeur général", type_dirigeant: "personne physique", annee_de_naissance: "1975", nationalite: "Française" },
    ],
  });
  const c = compacter(brut, "2026-11-09");
  const texte = JSON.stringify(c);
  for (const interdit of ["1975", "nationalite", "Française", "RUE DEMO", "HOLDING"]) assert.ok(!texte.includes(interdit), `le cache ne garde pas : ${interdit}`);
  assert.deepEqual(c.dirigeants, [{ prenoms: "SACHA", nom: "DEMO", qualite: "Directeur général" }]);
  assert.equal(c.le, "2026-11-09");
  assert.equal(choisirDirigeant(c.dirigeants), "Sacha Demo");
  assert.equal(choisirDirigeant([{ prenoms: "LOU", nom: "DEMO", qualite: "Associé" }, { prenoms: "CAMILLE, ALEX", nom: "DE LA DEMO", qualite: "Gérante" }]), "Camille De La Demo");
  assert.equal(choisirDirigeant([]), "");
});

test("fetch : pagination complète, cache, cadence d'au moins 150 ms (sous 7 par seconde), User-Agent de la config", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(5_000);
    const api = fausseApi((p) => (p.departement === "69" ? Array.from({ length: 60 }, (_, i) => resultat(i + 1)) : []), h);
    const n = niche();
    const r = await recolter({ niche: n, dossier: dossier.chemin, dependances: dependances(api, h) });
    assert.equal(r.code, 0);
    assert.equal(r.compteurs.entreprises, 60);
    assert.deepEqual(api.appels.filter((a) => a.p.departement === "69").map((a) => a.p.page), ["1", "2", "3"]);
    assert.ok(api.appels.every((a) => a.base === API && a.p.per_page === "25" && a.p.etat_administratif === "A" && a.p.activite_principale === "81.30Z"));
    assert.ok(api.appels.every((a) => a.ua === n.marque.userAgent));
    for (let i = 1; i < api.appels.length; i++) assert.ok(api.appels[i].t - api.appels[i - 1].t >= INTERVALLE_MS);
    assert.ok(1000 / INTERVALLE_MS <= 7, "7 requêtes par seconde au plus");
    assert.ok(existsSync(join(dossier.chemin, "cache", "sirene", "81.30Z_69.jsonl")));
    assert.ok(!r.lignes.join("\n").includes("DEMO"), "le rapport ne cite aucune donnée");
    const encore = await recolter({ niche: n, dossier: dossier.chemin, dependances: dependances(api, h) });
    assert.equal(encore.compteurs.appels, 0, "une recherche finie n'est jamais rejouée");
    assert.equal(encore.compteurs.deja_finies, 3);
  } finally {
    dossier.supprimer();
  }
});

test("fetch --limite puis reprise à la page suivante ; les non-diffusibles ne sont jamais gardés", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const liste = Array.from({ length: 60 }, (_, i) => resultat(i + 1, { diffusion: i === 59 ? "P" : "O" }));
    const api = fausseApi((p) => (p.departement === "69" ? liste : []), h);
    const premier = await recolter({ niche: niche(), dossier: dossier.chemin, limite: 30, dependances: dependances(api, h) });
    assert.equal(premier.compteurs.entreprises, 50, "arrêt après la page qui atteint la limite");
    assert.ok(premier.lignes.some((l) => /--limite 30/.test(l)));
    const etat = JSON.parse(readFileSync(join(dossier.chemin, "cache", "sirene", "81.30Z_69.etat.json"), "utf8"));
    assert.equal(etat.page_suivante, 3);
    const avant = api.appels.length;
    const suite = await recolter({ niche: niche(), dossier: dossier.chemin, dependances: dependances(api, h) });
    assert.equal(api.appels[avant].p.page, "3", "la reprise commence à la page 3");
    assert.equal(suite.compteurs.entreprises, 9);
    assert.equal(suite.compteurs.non_diffusibles, 1);
    const cache = readFileSync(join(dossier.chemin, "cache", "sirene", "81.30Z_69.jsonl"), "utf8").trim().split("\n");
    assert.equal(cache.length, 59);
    assert.ok(!cache.some((l) => l.includes(sirenFictif(60))), "l'unité non diffusible n'est pas dans le cache");
  } finally {
    dossier.supprimer();
  }
});

test("fetch : 429 (Retry-After) et 500 sont retentés ; un refus (400) laisse la recherche en échec, retentée au fetch suivant", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const n = niche();
    n.sources.sirene.departements = ["69"];
    const api = fausseApi(() => [resultat(1)], h, {
      pannes: [reponse("trop", { status: 429, type: "text/plain", entetes: { "retry-after": "2" } }), reponse("panne", { status: 500, type: "text/plain" })],
    });
    const r = await recolter({ niche: n, dossier: dossier.chemin, dependances: dependances(api, h) });
    assert.equal(r.code, 0);
    assert.equal(r.compteurs.entreprises, 1);
    assert.ok(h.etat.attentes.includes(2000), "Retry-After respecté");
    assert.ok(h.etat.attentes.includes(1600), "attente croissante après une erreur serveur");

    const dossier2 = dossierTemporaire();
    try {
      const refus = fausseApi(() => [resultat(2)], h, { pannes: [reponse("{}", { status: 400, type: "application/json" })] });
      const echec = await recolter({ niche: n, dossier: dossier2.chemin, dependances: dependances(refus, h) });
      assert.equal(echec.code, 1);
      assert.equal(echec.compteurs.echecs, 1);
      const reprise = await recolter({ niche: n, dossier: dossier2.chemin, dependances: dependances(refus, h) });
      assert.equal(reprise.code, 0);
      assert.equal(reprise.compteurs.entreprises, 1);
    } finally {
      dossier2.supprimer();
    }
  } finally {
    dossier.supprimer();
  }
});

test("fetch : au-delà de 10 000 résultats, la France se découpe en départements, un département en codes postaux", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const n = niche();
    n.sources.sirene.departements = "tous";
    let compteur = 0;
    const gros = Array.from({ length: 10000 }, () => resultat(++compteur));
    const parCp = { 69001: [resultat(20001, { cp: "69001" })], 69003: [resultat(20002), resultat(20003)] };
    const api = fausseApi((p) => {
      if (!p.departement) return gros; // la France entière : trop large
      if (p.departement === "69" && !p.code_postal) return gros; // le Rhône : encore trop large
      if (p.code_postal) return parCp[p.code_postal] ?? [];
      return p.departement === "38" ? [resultat(30001, { dep: "38", cp: "38000", ville: "GRENOBLE" })] : [];
    }, h);
    const r = await recolter({ niche: n, dossier: dossier.chemin, dependances: dependances(api, h) });
    assert.equal(r.code, 0);
    assert.equal(r.compteurs.decoupees, 2);
    assert.equal(r.compteurs.entreprises, 4);
    assert.equal(r.compteurs.restantes, 0);
    assert.equal(api.appels.filter((a) => a.p.code_postal).length, 1000);
    assert.ok(!api.appels.some((a) => !a.p.departement && a.p.page !== "1"), "la recherche trop large n'est pas paginée");
    const b = construire({ niche: n, dossier: dossier.chemin, essai: true, maintenant: MAINTENANT });
    assert.equal(b.compteurs.gardees, 4);
  } finally {
    dossier.supprimer();
  }
});

test("fetch --essai : une requête légère par recherche, le volume annoncé, rien de gardé", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const api = fausseApi((p) => (p.departement === "69" ? Array.from({ length: 30 }, (_, i) => resultat(i + 1)) : []), h);
    const r = await recolter({ niche: niche(), dossier: dossier.chemin, essai: true, dependances: dependances(api, h) });
    assert.equal(api.appels.length, 3);
    assert.ok(api.appels.every((a) => a.p.per_page === "1"));
    assert.equal(r.compteurs.annonces, 30);
    assert.ok(!existsSync(join(dossier.chemin, "cache")));
  } finally {
    dossier.supprimer();
  }
});

test("build : filtres de la config, doublons, taille de la cible, score, tri, --limite, CSV ; --essai n'écrit rien", async () => {
  const dossier = dossierTemporaire();
  try {
    const h = fausseHorloge(0);
    const n = niche();
    const rhone = [
      resultat(1, { nom: "DEMO PAYSAGE", tranche: "03", nj: "5499", enseignes: ["Les Jardins Démo"] }),
      resultat(2, { etat: "C" }),
      resultat(3, { naf: "43.21A" }),
      resultat(4, { dep: "01", cp: "01000", ville: "BOURG-EN-BRESSE" }),
      resultat(5, { ei: true, nj: "1000" }),
      resultat(6, { nom: "DEMO HOLDING" }),
      resultat(7, { tranche: "21" }),
      resultat(8, { tranche: "00" }),
      resultat(9, { tranche: "NN", date: "2025-12-01", nj: "5710" }),
    ];
    const isere = [resultat(1), resultat(10, { dep: "38", cp: "38000", ville: "GRENOBLE", dirigeants: [] })];
    const api = fausseApi((p) => (p.departement === "69" ? rhone : p.departement === "38" ? isere : []), h);
    await recolter({ niche: n, dossier: dossier.chemin, dependances: dependances(api, h) });

    const essai = construire({ niche: n, dossier: dossier.chemin, essai: true, maintenant: MAINTENANT });
    const c = essai.compteurs;
    assert.deepEqual(
      [c.lues, c.doublons, c.fermees, c.hors_naf, c.hors_zone, c.entrepreneurs_individuels, c.nom_exclu, c.taille_hors_cible, c.gardees],
      [11, 1, 1, 1, 1, 1, 1, 2, 3],
    );
    assert.equal(readdirSync(dossier.chemin).filter((f) => f.endsWith(".csv")).length, 0, "--essai n'écrit rien");
    assert.ok(!essai.lignes.join("\n").includes("DEMO"), "le rapport ne cite aucune donnée");

    const toutes = construire({ niche: n, dossier: dossier.chemin, essai: true, toutesTailles: true, maintenant: MAINTENANT });
    assert.equal(toutes.compteurs.gardees, 5, "--toutes-tailles garde les entreprises hors de la taille de la cible");

    const r = construire({ niche: n, dossier: dossier.chemin, maintenant: MAINTENANT });
    const { colonnes, lignes } = lireCsv(readFileSync(join(dossier.chemin, "sirene-2026-11-09.csv"), "utf8"));
    assert.ok(r.lignes.some((l) => /sirene-2026-11-09\.csv/.test(l)));
    for (const col of ["entreprise", "enseigne", "siren", "siret", "naf", "forme_juridique", "effectif", "dirigeant", "source", "source_url", "source_date", "score", "tier"]) {
      assert.ok(colonnes.includes(col), `colonne ${col}`);
    }
    assert.deepEqual(lignes.map((l) => l.siren), [sirenFictif(1), sirenFictif(10), sirenFictif(9)], "trié du meilleur score au moins bon");
    const premiere = lignes[0];
    assert.deepEqual(
      [premiere.forme_juridique, premiere.effectif, premiere.dirigeant, premiere.enseigne, premiere.source, premiere.source_date, premiere.departement],
      ["SARL", "6 à 9 salariés", "Camille Demo", "Les Jardins Démo", "sirene", "2026-11-09", "69"],
    );
    assert.equal(premiere.metier, "", "trois métiers dans la config, aucun dans le nom : pas de métier deviné");
    assert.deepEqual([premiere.score, premiere.tier], ["80", "A"]);
    assert.equal(lignes[1].dirigeant, "");

    construire({ niche: n, dossier: dossier.chemin, limite: 1, sortie: join(dossier.chemin, "top.csv"), maintenant: MAINTENANT });
    assert.deepEqual(lireCsv(readFileSync(join(dossier.chemin, "top.csv"), "utf8")).lignes.map((l) => l.siren), [sirenFictif(1)]);
  } finally {
    dossier.supprimer();
  }
});

test("build sans cache : un message clair ; la taille de la cible et le métier se lisent dans la config", () => {
  const dossier = dossierTemporaire();
  try {
    assert.throws(() => construire({ niche: niche(), dossier: dossier.chemin }), /fetch/);
  } finally {
    dossier.supprimer();
  }
  assert.equal(horsTaille("00", { tailleMin: 2, tailleMax: 20 }), true);
  assert.equal(horsTaille("01", { tailleMin: 2, tailleMax: 20 }), false);
  assert.equal(horsTaille("12", { tailleMin: 2, tailleMax: 20 }), false, "20 à 49 touche la borne : gardée");
  assert.equal(horsTaille("21", { tailleMin: 2, tailleMax: 20 }), true);
  assert.equal(horsTaille("NN", { tailleMin: 2, tailleMax: 20 }), false, "effectif inconnu : gardée");
  assert.equal(horsTaille("53", {}), false);
  assert.equal(metierDepuisNom("DEMO ELAGAGE", ["paysagiste", "élagage"]), "élagage");
  assert.equal(metierDepuisNom("DEMO", ["paysagiste", "élagage"]), "");
  assert.equal(metierDepuisNom("DEMO", ["paysagiste"]), "paysagiste");
});
