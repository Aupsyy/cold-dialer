// Google par l'API officielle Places (scripts/sourcing/places.mjs) : désactivé par défaut, clé absente, --essai sans clé ni réseau,
// la requête envoyée (méthode, adresse, en-têtes, champs demandés, corps), la lecture des fiches (numéro E.164, site sans paramètres,
// place_id, lien bâti sur le place_id), les pages suivantes, le plafond d'appels et l'affichage de leur nombre, les erreurs de Google,
// la reprise, les doublons, les fiches fermées et le mode enrichir. Aucun réseau : fetch est un faux ; la clé de test est inventée.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { analyserNiche } from "../config/charger.ts";
import { lireCsv } from "../scripts/sourcing/csv.mjs";
import {
  APPELS_PAR_DEFAUT,
  CHAMPS_PLACES,
  cleGoogle,
  executer,
  lienDepuisPlaceId,
  MESSAGE_DESACTIVE,
  MESSAGE_SANS_CLE,
  planRecherches,
  URL_PLACES,
  versFiche,
} from "../scripts/sourcing/places.mjs";
import { dossierTemporaire, e164, fausseHorloge, fixe, niche, sirenFictif } from "./sourcing-outils.mjs";

const MAINTENANT = new Date("2026-11-09T09:00:00Z");
const CLE = "cle-de-test-inventee";
const idPlace = (n) => `ChIJdemo${String(n).padStart(6, "0")}`;

function nicheActive({ motsCles = ["paysagiste"], villes = ["Lyon", "Bron"], max = 50 } = {}) {
  const n = niche();
  n.sources.places = { actif: true, motsCles, villes, max };
  assert.equal(analyserNiche(n).ok, true);
  return n;
}

/** Une fiche de la réponse Places (New). */
const place = (n, o = {}) => ({
  id: o.id ?? idPlace(n),
  displayName: { text: o.titre ?? `Atelier Démo ${String(n).padStart(2, "0")}`, languageCode: "fr" },
  formattedAddress: `${n} Rue Démo, 69003 Lyon, France`,
  addressComponents: [
    { longText: "69003", types: ["postal_code"] },
    { longText: "Lyon", types: ["locality", "political"] },
  ],
  internationalPhoneNumber: o.tel ?? `+33 ${fixe(n).slice(1)}`,
  websiteUri: o.site ?? `https://example.org/atelier-demo-${n}?utm_source=g`,
  rating: o.note ?? 4.6,
  userRatingCount: o.avis ?? 12,
  businessStatus: o.statut ?? "OPERATIONAL",
  primaryTypeDisplayName: { text: "Paysagiste", languageCode: "fr" },
});

/** Un faux fetch : `reponses` est une liste (une réponse par appel) ou une fonction (corps, numéro d'appel). Garde chaque requête. */
function fauxGoogle(reponses) {
  const appels = [];
  const fetch = async (url, init) => {
    const corps = JSON.parse(init.body);
    appels.push({ url, methode: init.method, entetes: init.headers, corps });
    const r = typeof reponses === "function" ? reponses(corps, appels.length - 1) : reponses.shift();
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("{}", { status: r });
    return new Response(JSON.stringify(r ?? { places: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { appels, fetch };
}

const dependances = (google, h = fausseHorloge(0)) => ({ fetch: google.fetch, attendre: h.attendre, maintenant: MAINTENANT, cle: CLE });

test("désactivé par défaut : un message qui dit comment l'activer, aucune clé lue, aucune requête", async () => {
  const n = niche();
  assert.equal(n.sources.places.actif, false, "la niche d'exemple est livrée avec Google Places désactivé");
  const google = fauxGoogle([]);
  const r = await executer({ niche: n, mode: "chercher", dossier: "/inexistant", dependances: dependances(google) });
  assert.equal(r.code, 1);
  assert.deepEqual(r.lignes, MESSAGE_DESACTIVE);
  assert.equal(google.appels.length, 0);
  const texte = MESSAGE_DESACTIVE.join("\n");
  assert.match(texte, /sources\.places\.actif = true/);
  assert.match(texte, /GOOGLE_PLACES_API_KEY/);
  assert.ok(!/playwright|navigateur/i.test(texte));
  delete n.sources.places;
  assert.equal((await executer({ niche: n, mode: "chercher", dossier: "/inexistant" })).code, 1, "sources.places absent : désactivé aussi");
});

test("activé sans clé : le message pour la créer et la coller dans .env.local, sans rien écrire ni envoyer", async () => {
  const dossier = dossierTemporaire();
  try {
    const google = fauxGoogle([]);
    const r = await executer({ niche: nicheActive(), mode: "chercher", dossier: dossier.chemin, dependances: { fetch: google.fetch, cle: "" } });
    assert.equal(r.code, 1);
    assert.deepEqual(r.lignes, MESSAGE_SANS_CLE);
    assert.equal(google.appels.length, 0);
    assert.ok(!existsSync(join(dossier.chemin, "cache")));
  } finally {
    dossier.supprimer();
  }
});

test("la clé : lue dans l'environnement ou dans .env.local, jamais affichée dans un rapport", () => {
  assert.equal(cleGoogle({ GOOGLE_PLACES_API_KEY: ` ${CLE} ` }, "/inexistant"), CLE);
  assert.equal(cleGoogle({}, "/inexistant"), "");
  const dossier = dossierTemporaire();
  try {
    writeFileSync(join(dossier.chemin, ".env.local"), `GOOGLE_PLACES_API_KEY=${CLE}-fichier\n`);
    const env = {};
    const avant = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    try {
      assert.equal(cleGoogle(process.env, dossier.chemin), `${CLE}-fichier`);
    } finally {
      delete process.env.GOOGLE_PLACES_API_KEY;
      if (avant !== undefined) process.env.GOOGLE_PLACES_API_KEY = avant;
    }
    assert.deepEqual(env, {});
  } finally {
    dossier.supprimer();
  }
});

test("--essai : le nombre de recherches et d'appels, sans clé ni requête ni fichier", async () => {
  const google = fauxGoogle([]);
  const r = await executer({ niche: nicheActive({ max: 45 }), mode: "chercher", dossier: "/inexistant", essai: true, dependances: { fetch: google.fetch, cle: "" } });
  assert.equal(r.code, 0);
  assert.equal(google.appels.length, 0);
  assert.deepEqual([r.compteurs.recherches, r.compteurs.appels_max], [2, 6], "2 recherches, 3 pages de 20 au plus chacune pour 45 fiches");
  assert.match(r.lignes.join("\n"), /plafond de cette exécution : 20/);
  assert.match(r.lignes.join("\n"), /ESSAI/);
});

test("le plan : mots-clés × villes ; enrichir : une recherche par entreprise sans téléphone ou sans site, avec son SIREN", () => {
  assert.deepEqual(planRecherches(nicheActive({ motsCles: ["paysagiste", "élagage"], villes: ["Lyon"] }), "chercher").map((r) => r.requete), ["paysagiste Lyon", "élagage Lyon"]);
  const base = [
    { entreprise: "ATELIER DEMO 01", enseigne: "Les Jardins Démo | Démo Paysage", siren: sirenFictif(1), ville: "LYON" },
    { entreprise: "ATELIER DEMO 02", siren: sirenFictif(2), ville: "BRON", telephone: e164(fixe(2)), site: "https://example.org/2" },
    { entreprise: "ATELIER DEMO 03", siren: sirenFictif(3), ville: "LYON", telephone: e164(fixe(3)) },
  ];
  assert.deepEqual(planRecherches(nicheActive(), "enrichir", base), [
    { requete: "Les Jardins Démo LYON", siren_recherche: sirenFictif(1) },
    { requete: "ATELIER DEMO 03 LYON", siren_recherche: sirenFictif(3) },
  ]);
});

test("une fiche lue : numéro en E.164, site sans paramètres, code postal, département, note, avis, place_id, lien bâti sur le place_id", () => {
  const f = versFiche(place(1), { pays: "FR", le: "2026-11-09" });
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
    place_id: idPlace(1),
    source: "maps",
    source_url: `https://www.google.com/maps/place/?q=place_id:${idPlace(1)}`,
    source_date: "2026-11-09",
  });
  const national = versFiche({ ...place(2), internationalPhoneNumber: undefined, nationalPhoneNumber: fixe(2) }, { pays: "FR", le: "2026-11-09" });
  assert.equal(national.telephone, e164(fixe(2)), "à défaut du numéro international, le national est lu");
  const maigre = versFiche({ id: "x", displayName: { text: "Atelier Démo 03" }, formattedAddress: "3 Rue Démo, 69500 Bron, France" }, { pays: "FR", le: "2026-11-09", siren: sirenFictif(3) });
  assert.deepEqual([maigre.telephone, maigre.site, maigre.note_google, maigre.nb_avis, maigre.place_id, maigre.source_url], ["", "", "", "", "", ""]);
  assert.deepEqual([maigre.code_postal, maigre.ville, maigre.siren_recherche], ["69500", "Bron", sirenFictif(3)], "sans addressComponents : lu dans l'adresse");
  assert.equal(lienDepuisPlaceId("../../etc/passwd"), "", "un identifiant bizarre ne devient jamais un lien");
});

test("chercher : la requête (POST, adresse, clé et champs en en-têtes, langue, pays), CSV écrit, appels affichés, la clé jamais citée", async () => {
  const dossier = dossierTemporaire();
  try {
    const google = fauxGoogle(() => ({ places: [place(1), place(2)] }));
    const h = fausseHorloge(0);
    const r = await executer({ niche: nicheActive({ villes: ["Lyon"] }), mode: "chercher", dossier: dossier.chemin, dependances: dependances(google, h) });
    assert.equal(r.code, 0);
    assert.equal(google.appels.length, 1, "une page de moins de 20 fiches sans jeton de page suivante : un seul appel");
    const a = google.appels[0];
    assert.equal(a.url, URL_PLACES);
    assert.equal(a.url, "https://places.googleapis.com/v1/places:searchText");
    assert.equal(a.methode, "POST");
    assert.equal(a.entetes["X-Goog-Api-Key"], CLE);
    assert.equal(a.entetes["X-Goog-FieldMask"], CHAMPS_PLACES);
    assert.ok(CHAMPS_PLACES.includes("places.internationalPhoneNumber") && CHAMPS_PLACES.includes("nextPageToken"));
    assert.ok(!/reviews|photos|openingHours/.test(CHAMPS_PLACES), "seulement les champs utiles (chaque champ a son tarif)");
    assert.deepEqual(a.corps, { textQuery: "paysagiste Lyon", languageCode: "fr", regionCode: "FR", pageSize: 20 });
    const texte = r.lignes.join("\n");
    assert.ok(!texte.includes(CLE) && !/Démo|example/.test(texte), "le rapport ne cite ni la clé ni une donnée");
    assert.match(texte, /Appels à Google consommés : 1 sur 20/);
    assert.match(texte, /sous 30 jours/);
    const csv = lireCsv(readFileSync(join(dossier.chemin, "places-chercher-2026-11-09.csv"), "utf8"));
    assert.deepEqual(csv.lignes.map((l) => [l.entreprise, l.telephone, l.source, l.source_date, l.place_id]), [
      ["Atelier Démo 01", e164(fixe(1)), "maps", "2026-11-09", idPlace(1)],
      ["Atelier Démo 02", e164(fixe(2)), "maps", "2026-11-09", idPlace(2)],
    ]);
    assert.ok(!readFileSync(join(dossier.chemin, "cache", "places-chercher.json"), "utf8").includes(CLE));
  } finally {
    dossier.supprimer();
  }
});

test("pages suivantes : le jeton est renvoyé, 3 pages au plus par recherche, une pause avant chaque page suivante, doublons écartés", async () => {
  const dossier = dossierTemporaire();
  try {
    const google = fauxGoogle((corps, k) => ({ places: [place(k * 2 + 1), place(1)], nextPageToken: `jeton-${k + 1}` }));
    const h = fausseHorloge(0);
    const r = await executer({ niche: nicheActive({ villes: ["Lyon"], max: 200 }), mode: "chercher", dossier: dossier.chemin, dependances: dependances(google, h) });
    assert.equal(google.appels.length, 3, "3 pages au plus par recherche");
    assert.deepEqual(google.appels.map((a) => a.corps.pageToken), [undefined, "jeton-1", "jeton-2"]);
    assert.ok(h.etat.attentes.filter((m) => m === 400).length >= 2);
    assert.deepEqual([r.compteurs.fiches_lues, r.compteurs.fiches_gardees, r.compteurs.doublons], [6, 3, 3], "le place_id sert de clé de doublon");
  } finally {
    dossier.supprimer();
  }
});

test("max : la découverte s'arrête aux sources.places.max fiches et ne demande pas plus que nécessaire", async () => {
  const dossier = dossierTemporaire();
  try {
    const google = fauxGoogle(() => ({ places: [place(1), place(2), place(3)] }));
    const r = await executer({ niche: nicheActive({ max: 2 }), mode: "chercher", dossier: dossier.chemin, dependances: dependances(google) });
    assert.equal(r.compteurs.total, 2);
    assert.equal(google.appels.length, 1);
    assert.equal(google.appels[0].corps.pageSize, 2);
    assert.match(r.lignes.join("\n"), /Maximum atteint/);
  } finally {
    dossier.supprimer();
  }
});

test("plafond d'appels : arrêt propre, nombre d'appels affiché, la reprise repart de la recherche coupée", async () => {
  const dossier = dossierTemporaire();
  try {
    const n = nicheActive({ villes: ["Lyon", "Bron", "Villeurbanne"], max: 200 });
    const google = fauxGoogle((corps) => ({ places: [place(corps.textQuery.length)] }));
    const r = await executer({ niche: n, mode: "chercher", dossier: dossier.chemin, maxAppels: 2, dependances: dependances(google) });
    assert.equal(google.appels.length, 2, "jamais plus d'appels que le plafond");
    assert.equal(r.code, 0, "le plafond est un arrêt normal");
    assert.match(r.lignes.join("\n"), /Appels à Google consommés : 2 sur 2/);
    assert.match(r.lignes.join("\n"), /plafond de 2 appels atteint/);
    const suite = await executer({ niche: n, mode: "chercher", dossier: dossier.chemin, maxAppels: 5, dependances: dependances(google) });
    assert.deepEqual(google.appels.slice(2).map((a) => a.corps.textQuery), ["paysagiste Villeurbanne"], "reprise : les recherches faites ne sont pas refaites");
    assert.equal(suite.compteurs.appels, 1);
    const csv = lireCsv(readFileSync(join(dossier.chemin, "places-chercher-2026-11-09.csv"), "utf8"));
    assert.ok(csv.lignes.length >= 2);
    // le plafond par défaut est prudent
    assert.ok(APPELS_PAR_DEFAUT <= 50);
  } finally {
    dossier.supprimer();
  }
});

test("un plafond atteint en cours de recherche garde les fiches déjà lues et refait la recherche à la reprise", async () => {
  const dossier = dossierTemporaire();
  try {
    const n = nicheActive({ villes: ["Lyon"], max: 200 });
    const google = fauxGoogle((corps, k) => ({ places: [place(k + 1)], nextPageToken: "suite" }));
    const r = await executer({ niche: n, mode: "chercher", dossier: dossier.chemin, maxAppels: 2, dependances: dependances(google) });
    assert.equal(google.appels.length, 2);
    assert.equal(r.compteurs.total, 2, "les fiches des deux pages lues sont gardées");
    assert.match(r.lignes.join("\n"), /plafond/);
  } finally {
    dossier.supprimer();
  }
});

test("les erreurs de Google : clé refusée (403) = arrêt avec le code seul ; panne passagère = nouvelles tentatives puis arrêt", async () => {
  const dossier = dossierTemporaire();
  try {
    const refuse = fauxGoogle(() => 403);
    const r = await executer({ niche: nicheActive(), mode: "chercher", dossier: dossier.chemin, dependances: dependances(refuse) });
    assert.equal(r.code, 1);
    assert.equal(refuse.appels.length, 1, "inutile de réessayer une clé refusée");
    assert.match(r.lignes.join("\n"), /code http_403/);
    assert.ok(!r.lignes.join("\n").includes(CLE));

    const panne = fauxGoogle(() => 503);
    const h = fausseHorloge(0);
    const r2 = await executer({ niche: nicheActive(), mode: "chercher", dossier: dossier.chemin, sortie: join(dossier.chemin, "autre.csv"), dependances: dependances(panne, h) });
    assert.equal(r2.code, 1);
    assert.equal(panne.appels.length, 3, "3 essais au plus");
    assert.deepEqual(h.etat.attentes.slice(0, 2), [1500, 3000], "attente croissante entre les essais");

    const reseau = fauxGoogle([new Error("réseau"), { places: [place(1)] }]);
    const r3 = await executer({ niche: nicheActive({ villes: ["Lyon"] }), mode: "chercher", dossier: dossier.chemin, sortie: join(dossier.chemin, "reseau.csv"), dependances: dependances(reseau) });
    assert.equal(r3.compteurs.total, 1, "une coupure réseau passagère est retentée");
    assert.equal(r3.compteurs.appels, 2, "chaque essai compte dans les appels");
  } finally {
    dossier.supprimer();
  }
});

test("fiches fermées définitivement écartées ; fiche sans nom ignorée ; appels comptés", async () => {
  const dossier = dossierTemporaire();
  try {
    const google = fauxGoogle(() => ({ places: [place(1, { statut: "CLOSED_PERMANENTLY" }), place(2), { id: idPlace(9) }] }));
    const r = await executer({ niche: nicheActive({ villes: ["Lyon"] }), mode: "chercher", dossier: dossier.chemin, dependances: dependances(google) });
    assert.deepEqual([r.compteurs.fiches_lues, r.compteurs.fermees, r.compteurs.total], [3, 1, 1]);
  } finally {
    dossier.supprimer();
  }
});

test("un état de plus de 30 jours n'est pas repris (le contenu de Google se rafraîchit)", async () => {
  const dossier = dossierTemporaire();
  try {
    const n = nicheActive({ villes: ["Lyon", "Bron"] });
    const google = fauxGoogle(() => ({ places: [place(1)] }));
    await executer({ niche: n, mode: "chercher", dossier: dossier.chemin, maxAppels: 1, dependances: dependances(google) });
    const avant = google.appels.length;
    const tard = { ...dependances(google), maintenant: new Date("2026-12-20T09:00:00Z") };
    await executer({ niche: n, mode: "chercher", dossier: dossier.chemin, sortie: join(dossier.chemin, "places-chercher-2026-11-09.csv"), maxAppels: 5, dependances: tard });
    assert.equal(google.appels[avant].corps.textQuery, "paysagiste Lyon", "repart du début");
  } finally {
    dossier.supprimer();
  }
});

test("enrichir : une recherche « nom ville » par entreprise sans téléphone ou sans site, 3 fiches au plus, marquées siren_recherche", async () => {
  const dossier = dossierTemporaire();
  try {
    const base = join(dossier.chemin, "base.csv");
    writeFileSync(
      base,
      [
        "entreprise;siren;ville;telephone;site",
        `ATELIER DEMO 01;${sirenFictif(1)};LYON;;`,
        `ATELIER DEMO 02;${sirenFictif(2)};BRON;${e164(fixe(2))};https://example.org/2`,
        `ATELIER DEMO 03;${sirenFictif(3)};LYON;${e164(fixe(3))};`,
      ].join("\n"),
    );
    const google = fauxGoogle(() => ({ places: [place(1), place(2), place(3), place(4)] }));
    const r = await executer({ niche: nicheActive(), mode: "enrichir", base, dossier: dossier.chemin, dependances: dependances(google) });
    assert.deepEqual(google.appels.map((a) => a.corps.textQuery), ["ATELIER DEMO 01 LYON", "ATELIER DEMO 03 LYON"]);
    assert.ok(google.appels.every((a) => a.corps.pageSize === 3 && a.corps.pageToken === undefined));
    const csv = lireCsv(readFileSync(join(dossier.chemin, "places-enrichir-2026-11-09.csv"), "utf8"));
    assert.equal(csv.lignes.length, 6, "3 fiches au plus par entreprise cherchée, doublons gardés (appariement.mjs choisit)");
    assert.deepEqual([...new Set(csv.lignes.map((l) => l.siren_recherche))], [sirenFictif(1), sirenFictif(3)]);
    assert.match(r.lignes.join("\n"), /appariement\.mjs/);
    assert.ok(!r.lignes.join("\n").includes(sirenFictif(1)));
    const limite = await executer({ niche: nicheActive(), mode: "enrichir", base, sortie: join(dossier.chemin, "limite.csv"), limite: 1, dossier: dossier.chemin, dependances: dependances(fauxGoogle(() => ({ places: [place(1)] }))) });
    assert.equal(limite.compteurs.recherches, 1);
  } finally {
    dossier.supprimer();
  }
});

test("secrets de l'installation : GOOGLE_PLACES_API_KEY est listée (facultative) seulement quand Google Places est actif", async () => {
  const { besoinsSecrets } = await import("../scripts/install/secrets.mjs");
  const nom = (n) => besoinsSecrets(n).aColler.find((v) => v.nom === "GOOGLE_PLACES_API_KEY");
  assert.equal(nom(niche()), undefined);
  assert.equal(nom(nicheActive())?.facultative, true);
});
