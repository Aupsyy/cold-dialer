// La base d'entreprises françaises tirée du registre SIRENE, par l'API Recherche Entreprises (service public, gratuit, sans clé ;
// 7 requêtes par seconde au plus) : https://recherche-entreprises.api.gouv.fr
//
//   fetch  interroge l'API pour chaque code NAF et chaque département de config/niche.json (sources.sirene), page par page, et range
//          les réponses dans donnees/cache/sirene/ (ignoré par git). Reprise : une recherche finie n'est jamais rejouée, une recherche
//          interrompue reprend à sa page suivante, une recherche en échec est retentée. L'API ne rend pas plus de 10 000 résultats par
//          recherche : au-delà, la recherche est découpée (la France en départements, un département en codes postaux).
//   build  relit le cache et garde les entreprises actives qui répondent à la config : NAF, département du siège, mots du nom
//          (motsNomInclure, motsNomExclure), entrepreneurs individuels écartés si exclureEI, taille de config.cible quand la tranche
//          d'effectif est connue ; retire les doublons (SIREN) ; calcule un premier score (grille de config.score : à ce stade sans
//          téléphone, site ni avis) ; écrit donnees/sirene-<date>.csv, trié du meilleur score au moins bon.
//
// Non-diffusion : une personne qui dirige une entreprise individuelle peut demander que ses données ne servent pas à la prospection
// (statut de diffusion partielle de l'INSEE). Ces unités sont écartées dès la récolte : rien d'elles n'est gardé, même dans le cache.
// Des données de dirigeants, seuls le prénom, le nom et la qualité sont gardés (ni date de naissance, ni nationalité).
// SIRENE ne couvre que la France : pour la Belgique, la Suisse ou le Canada, voir docs/sourcing.md (Google Places ou import CSV).
//
// Usage :
//   node scripts/sourcing/sirene.mjs fetch [--essai] [--limite N] [--dossier <chemin>] [--config <niche.json>]
//   node scripts/sourcing/sirene.mjs build [--essai] [--limite N] [--toutes-tailles] [--sortie <fichier.csv>] [--dossier <chemin>]
//   fetch --essai   une requête légère par recherche, pour annoncer le volume et la durée ; rien n'est gardé.
//   fetch --limite  s'arrête après N entreprises récoltées (le fetch suivant reprend où il s'est arrêté).
//   build --essai   les compteurs seulement, rien n'est écrit ; build --limite : les N meilleurs scores seulement.
//   build --toutes-tailles  n'écarte pas les entreprises hors de cible.tailleMin et cible.tailleMax.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  afficher,
  cheminAffiche,
  attendreVraiment,
  casseNom,
  chargerNiche,
  codeErreur,
  contientDebutDeMot,
  creerCadence,
  dateDuJour,
  departementDepuisCodePostal,
  dossierDonnees,
  ecrireTableau,
  ErreurSourcing,
  estLance,
  libelleCategorieJuridique,
  libelleTranche,
  lireArguments,
  messageSur,
  nettoyerTexte,
  normaliserCodePostal,
  normaliserDate,
  normaliserNaf,
  normaliserSiren,
  normaliserSiret,
  TRANCHES_EFFECTIF,
} from "./lib.mjs";
import { calculerScore } from "./score.mjs";

export const API = "https://recherche-entreprises.api.gouv.fr/search";
export const SOURCE_URL = "https://recherche-entreprises.api.gouv.fr";
/** 150 ms entre deux requêtes : 6,7 requêtes par seconde au plus, sous la limite de 7 de l'API. */
export const INTERVALLE_MS = 150;
export const PAR_PAGE = 25;
/** Le nombre de résultats que l'API rend au plus pour une recherche (400 pages de 25). */
export const PLAFOND = 10000;
const ESSAIS = 6;

const USAGE = [
  "Usage :",
  "  node scripts/sourcing/sirene.mjs fetch [--essai] [--limite N] [--dossier <chemin>] [--config <niche.json>]",
  "  node scripts/sourcing/sirene.mjs build [--essai] [--limite N] [--toutes-tailles] [--sortie <fichier.csv>] [--dossier <chemin>]",
  "  fetch : interroge l'API Recherche Entreprises (cache dans donnees/cache/sirene, reprise automatique)",
  "  build : filtre, dédoublonne, note et écrit donnees/sirene-<date>.csv",
  "  --essai : fetch annonce le volume sans rien garder ; build compte sans rien écrire",
].join("\n");

/** Les départements français (métropole, Corse, outre-mer) : le découpage d'une recherche « France entière ». */
export const DEPARTEMENTS = [
  ...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, "0")).filter((d) => d !== "20"),
  "2A",
  "2B",
  "971",
  "972",
  "973",
  "974",
  "976",
];

/** Les codes postaux possibles d'un département (découpage d'une recherche trop large) : « 69 » donne 69000 à 69999. */
export function codesPostauxCandidats(departement) {
  const plage = (debut, fin) => Array.from({ length: fin - debut + 1 }, (_, i) => String(debut + i).padStart(5, "0"));
  if (departement === "2A") return plage(20000, 20199);
  if (departement === "2B") return plage(20200, 20699);
  if (/^\d{3}$/.test(departement)) return plage(Number(departement) * 100, Number(departement) * 100 + 99);
  if (/^\d{2}$/.test(departement)) return plage(Number(departement) * 1000, Number(departement) * 1000 + 999);
  return [];
}

function requete({ naf, departement = null, codePostal = null }) {
  const params = { activite_principale: naf, etat_administratif: "A" };
  if (departement) params.departement = departement;
  if (codePostal) params.code_postal = codePostal;
  const niveau = codePostal ? "code_postal" : departement ? "departement" : "france";
  const cle = [naf, departement ?? "france", codePostal].filter(Boolean).join("_");
  return { cle, niveau, naf, departement, codePostal, params };
}

/** Les recherches à faire pour la config (sources.sirene) : une par code NAF et par département (ou une par NAF pour « tous »). */
export function planifier(sirene) {
  const plan = [];
  for (const naf of sirene.naf) {
    if (sirene.departements === "tous") plan.push(requete({ naf }));
    else for (const d of sirene.departements) plan.push(requete({ naf, departement: d }));
  }
  return plan;
}

/** Le découpage d'une recherche trop large (plus de 10 000 résultats), ou null si elle ne se découpe plus. */
export function decouper(r) {
  if (r.niveau === "france") return DEPARTEMENTS.map((d) => requete({ naf: r.naf, departement: d }));
  if (r.niveau === "departement") return codesPostauxCandidats(r.departement).map((cp) => requete({ naf: r.naf, departement: r.departement, codePostal: cp }));
  return null;
}

/** Vrai si l'unité ne doit pas servir à la prospection : diffusion partielle (INSEE) de l'unité ou de son siège, ou champ masqué. */
export function nonDiffusible(r) {
  const statut = r?.statut_diffusion;
  const statutSiege = r?.siege?.statut_diffusion_etablissement;
  if ((statut && statut !== "O") || (statutSiege && statutSiege !== "O")) return true;
  return /non[- ]?diffusible/i.test([r?.nom_complet, r?.nom_raison_sociale, r?.siege?.libelle_commune, r?.siege?.adresse].join(" "));
}

/**
 * Le résumé d'un résultat de l'API, tel qu'il est gardé dans le cache : le strict nécessaire (minimisation), ou null si l'unité est
 * non diffusible ou sans SIREN lisible. le : la date de la récolte.
 */
export function compacter(r, le) {
  if (!r || typeof r !== "object" || nonDiffusible(r)) return null;
  const siren = normaliserSiren(r.siren);
  if (!siren) return null;
  const siege = r.siege && typeof r.siege === "object" ? r.siege : {};
  const enseignes = [...(Array.isArray(siege.liste_enseignes) ? siege.liste_enseignes : []), siege.nom_commercial]
    .filter((e) => typeof e === "string" && e.trim() !== "")
    .map((e) => nettoyerTexte(e, 120));
  const dirigeants = (Array.isArray(r.dirigeants) ? r.dirigeants : [])
    .filter((d) => d && d.type_dirigeant === "personne physique")
    .slice(0, 5)
    .map((d) => ({ prenoms: nettoyerTexte(d.prenoms, 120), nom: nettoyerTexte(d.nom, 120), qualite: nettoyerTexte(d.qualite, 80) }));
  const categorie = String(r.nature_juridique ?? "").trim();
  const cp = normaliserCodePostal(siege.code_postal) ?? "";
  return {
    siren,
    siret: normaliserSiret(siege.siret, siren) ?? "",
    nom: nettoyerTexte(r.nom_complet || r.nom_raison_sociale, 200),
    sigle: nettoyerTexte(r.sigle, 60),
    enseignes: [...new Set(enseignes)],
    categorie_juridique: /^\d{4}$/.test(categorie) ? categorie : "",
    naf: normaliserNaf(r.activite_principale) ?? "",
    date_creation: normaliserDate(r.date_creation) ?? "",
    tranche: String(r.tranche_effectif_salarie ?? siege.tranche_effectif_salarie ?? "").trim(),
    etat: String(r.etat_administratif ?? "").trim(),
    siege_etat: String(siege.etat_administratif ?? "").trim(),
    commune: nettoyerTexte(siege.libelle_commune, 120),
    code_postal: cp,
    departement: nettoyerTexte(siege.departement, 3).toUpperCase() || departementDepuisCodePostal(cp) || "",
    ei: r.complements?.est_entrepreneur_individuel === true || categorie.startsWith("1"),
    dirigeants,
    le,
  };
}

/** Un appel à l'API, avec la cadence et les nouvelles tentatives (429, erreurs serveur, réseau). Renvoie le corps JSON. */
export async function appelerApi(params, ctx) {
  const url = `${API}?${new URLSearchParams(params)}`;
  let derniere = null;
  for (let essai = 0; essai < ESSAIS; essai++) {
    await ctx.patienter("api");
    let reponse;
    try {
      reponse = await ctx.fetch(url, { headers: { "user-agent": ctx.userAgent, accept: "application/json" }, signal: ctx.signal?.() });
    } catch (e) {
      derniere = e;
      await ctx.attendre(800 * 2 ** essai);
      continue;
    }
    if (reponse.status === 429 || reponse.status >= 500) {
      const apres = Number(reponse.headers?.get?.("retry-after"));
      derniere = { code: `http_${reponse.status}` };
      await ctx.attendre(Number.isFinite(apres) && apres > 0 ? Math.min(apres, 120) * 1000 : 800 * 2 ** essai);
      continue;
    }
    if (!reponse.ok) throw Object.assign(new ErreurSourcing(`L'API a refusé la recherche (HTTP ${reponse.status}).`), { code: `http_${reponse.status}` });
    let corps;
    try {
      corps = await reponse.json();
    } catch {
      throw Object.assign(new ErreurSourcing("Réponse de l'API illisible (JSON attendu)."), { code: "json" });
    }
    if (!corps || typeof corps !== "object" || corps.erreur) {
      throw Object.assign(new ErreurSourcing("L'API a répondu par une erreur pour cette recherche."), { code: "api" });
    }
    return corps;
  }
  throw Object.assign(new ErreurSourcing(`L'API ne répond pas après ${ESSAIS} essais.`), { code: codeErreur(derniere) });
}

const dossierCache = (dossier) => join(dossier, "cache", "sirene");
const cheminEtat = (dossier, cle) => join(dossierCache(dossier), `${cle}.etat.json`);
const cheminLignes = (dossier, cle) => join(dossierCache(dossier), `${cle}.jsonl`);

function lireEtat(dossier, cle) {
  const chemin = cheminEtat(dossier, cle);
  if (!existsSync(chemin)) return null;
  try {
    return JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    return null;
  }
}

function ecrireEtat(dossier, etat) {
  writeFileSync(cheminEtat(dossier, etat.cle), JSON.stringify(etat));
}

/**
 * La récolte (fetch). dependances : { fetch, attendre, horloge, maintenant, signal } (injectables : les tests n'appellent jamais la
 * vraie API). Renvoie { code, lignes (le rapport), compteurs }.
 */
export async function recolter({ niche, dossier, limite = null, essai = false, dependances = {} }) {
  const sirene = niche.sources.sirene;
  if (!sirene) throw new ErreurSourcing("config/niche.json n'a pas de sources.sirene : rien à récolter (hors France : Google Places ou import CSV, voir docs/sourcing.md).");
  const attendre = dependances.attendre ?? attendreVraiment;
  const ctx = {
    fetch: dependances.fetch ?? globalThis.fetch,
    attendre,
    patienter: creerCadence(INTERVALLE_MS, { horloge: dependances.horloge, attendre }),
    userAgent: niche.marque.userAgent,
    signal: dependances.signal,
  };
  const le = dateDuJour(niche.pays.fuseau, dependances.maintenant ?? new Date());
  const plan = planifier(sirene);
  const rapport = [`Registre SIRENE : ${sirene.naf.length} code(s) NAF, ${sirene.departements === "tous" ? "toute la France" : `${sirene.departements.length} département(s)`}, ${plan.length} recherche(s)`];
  if (niche.pays.code !== "FR") rapport.push(`Attention : l'équipe est en ${niche.pays.code} ; le registre SIRENE ne couvre que les entreprises françaises.`);

  if (essai) {
    let annonces = 0;
    let appels = 0;
    let decoupes = 0;
    for (const r of plan) {
      const corps = await appelerApi({ ...r.params, page: 1, per_page: 1 }, ctx);
      const total = Number(corps.total_results ?? 0);
      annonces += total;
      appels += Math.ceil(Math.min(total, PLAFOND) / PAR_PAGE);
      if (total >= PLAFOND) {
        decoupes++;
        appels += Math.ceil(total / PAR_PAGE) - Math.ceil(PLAFOND / PAR_PAGE) + (r.niveau === "france" ? DEPARTEMENTS.length : 1000);
      }
    }
    rapport.push(`Entreprises actives annoncées par l'API : ${annonces} (avant filtres, doublons et non-diffusion)`);
    if (decoupes > 0) rapport.push(`Recherches de plus de ${PLAFOND} résultats, découpées au fetch : ${decoupes}`);
    rapport.push(`Requêtes à prévoir : environ ${appels} ; durée : environ ${Math.max(1, Math.ceil((appels * INTERVALLE_MS) / 60000))} min`);
    rapport.push("ESSAI : rien n'a été gardé. Lance « sirene.mjs fetch » pour récolter.");
    return { code: 0, lignes: rapport, compteurs: { annonces, appels, decoupes } };
  }

  mkdirSync(dossierCache(dossier), { recursive: true });
  const c = { appels: 0, entreprises: 0, non_diffusibles: 0, finies: 0, deja_finies: 0, tronquees: 0, decoupees: 0, echecs: 0 };
  const run = { restant: limite ?? Infinity, arret: false };

  const traiter = async (r) => {
    const etat = lireEtat(dossier, r.cle) ?? {
      cle: r.cle,
      niveau: r.niveau,
      params: r.params,
      page_suivante: 1,
      pages: null,
      total: null,
      lignes: 0,
      non_diffusibles: 0,
      termine: false,
      tronque: false,
      decoupe: false,
      echec: null,
      le,
    };
    if (etat.termine) {
      c.deja_finies++;
      return;
    }
    etat.echec = null;
    if (etat.decoupe) {
      await traiterDecoupe(r, etat);
      return;
    }
    while (!run.arret) {
      if (run.restant <= 0) {
        run.arret = true;
        break;
      }
      let corps;
      try {
        corps = await appelerApi({ ...r.params, page: etat.page_suivante, per_page: PAR_PAGE }, ctx);
      } catch (e) {
        etat.echec = codeErreur(e);
        ecrireEtat(dossier, etat);
        c.echecs++;
        return;
      }
      c.appels++;
      if (etat.page_suivante === 1) {
        etat.total = Number(corps.total_results ?? 0);
        etat.pages = Number(corps.total_pages ?? Math.ceil(etat.total / PAR_PAGE));
        if (etat.total >= PLAFOND && decouper(r)) {
          etat.decoupe = true;
          ecrireEtat(dossier, etat);
          c.decoupees++;
          await traiterDecoupe(r, etat);
          return;
        }
        if (etat.total >= PLAFOND) etat.tronque = true;
      }
      const resultats = Array.isArray(corps.results) ? corps.results : [];
      const gardes = [];
      for (const x of resultats) {
        const compact = compacter(x, le);
        if (compact) gardes.push(compact);
        else etat.non_diffusibles++;
      }
      if (gardes.length > 0) appendFileSync(cheminLignes(dossier, r.cle), `${gardes.map((g) => JSON.stringify(g)).join("\n")}\n`);
      etat.lignes += gardes.length;
      c.entreprises += gardes.length;
      c.non_diffusibles += resultats.length - gardes.length;
      run.restant -= gardes.length;
      const derniere = Math.min(etat.pages || 0, PLAFOND / PAR_PAGE);
      if (resultats.length === 0 || etat.page_suivante >= derniere) {
        etat.termine = true;
        etat.page_suivante = null;
        ecrireEtat(dossier, etat);
        c.finies++;
        if (etat.tronque) c.tronquees++;
        return;
      }
      etat.page_suivante++;
      ecrireEtat(dossier, etat);
    }
    ecrireEtat(dossier, etat);
  };

  const traiterDecoupe = async (r, etat) => {
    const morceaux = decouper(r);
    for (const m of morceaux) {
      if (run.arret) return;
      await traiter(m);
    }
    if (morceaux.every((m) => lireEtat(dossier, m.cle)?.termine)) {
      etat.termine = true;
      ecrireEtat(dossier, etat);
    }
  };

  for (const r of plan) {
    if (run.arret) break;
    await traiter(r);
  }
  const restantes = plan.filter((r) => !lireEtat(dossier, r.cle)?.termine).length;
  rapport.push(`Requêtes à l'API : ${c.appels} ; recherches finies : ${c.finies} (déjà finies avant : ${c.deja_finies}) ; découpées : ${c.decoupees}`);
  rapport.push(`Entreprises récoltées : ${c.entreprises} ; non diffusibles écartées : ${c.non_diffusibles}`);
  if (c.tronquees > 0) rapport.push(`Recherches tronquées à ${PLAFOND} résultats (impossible à découper davantage) : ${c.tronquees}`);
  if (c.echecs > 0) rapport.push(`Recherches en échec : ${c.echecs} (relance la même commande : elles seront retentées)`);
  if (run.arret) rapport.push(`Arrêt à la limite demandée (--limite ${limite}) : relance « fetch » pour continuer.`);
  rapport.push(restantes === 0 ? "Récolte complète : lance « sirene.mjs build »." : `Recherches pas encore finies : ${restantes} sur ${plan.length}.`);
  return { code: c.echecs > 0 ? 1 : 0, lignes: rapport, compteurs: { ...c, restantes } };
}

/** Le dirigeant à appeler : le président, le gérant ou le directeur général (personne physique), sinon le premier ; « Prénom Nom ». */
export function choisirDirigeant(dirigeants) {
  if (!Array.isArray(dirigeants) || dirigeants.length === 0) return "";
  const d = dirigeants.find((x) => /pr[ée]sident|g[ée]rant|directeur g[ée]n[ée]ral/i.test(x.qualite ?? "")) ?? dirigeants[0];
  const prenom = String(d.prenoms ?? "")
    .split(/[,\s]+/)
    .find(Boolean);
  return casseNom([prenom, d.nom].filter(Boolean).join(" "));
}

/** Le métier d'une entreprise : le premier métier de config.cible.metiers trouvé dans son nom, sinon le seul métier s'il n'y en a qu'un. */
export function metierDepuisNom(texte, metiers) {
  const trouve = metiers.find((m) => contientDebutDeMot(texte, [m]));
  if (trouve) return trouve;
  return metiers.length === 1 ? metiers[0] : "";
}

/** Vrai si la tranche d'effectif (connue) est entièrement hors de [tailleMin, tailleMax] de config.cible. */
export function horsTaille(tranche, cible) {
  const t = TRANCHES_EFFECTIF[tranche];
  if (!t) return false;
  const [min, max] = t;
  if (cible.tailleMax !== undefined && min > cible.tailleMax) return true;
  if (cible.tailleMin !== undefined && max < cible.tailleMin) return true;
  return false;
}

function clesDuPlan(dossier, plan) {
  const cles = [];
  let incompletes = 0;
  const visiter = (r) => {
    const etat = lireEtat(dossier, r.cle);
    if (!etat) {
      incompletes++;
      return;
    }
    if (etat.decoupe) {
      for (const m of decouper(r)) visiter(m);
      return;
    }
    cles.push(r.cle);
    if (!etat.termine) incompletes++;
  };
  plan.forEach(visiter);
  return { cles, incompletes };
}

/** La construction (build) : relit le cache, filtre, dédoublonne, note, écrit le CSV (sauf essai). Renvoie { code, lignes, compteurs }. */
export function construire({ niche, dossier, limite = null, essai = false, sortie = null, toutesTailles = false, maintenant = new Date() }) {
  const sirene = niche.sources.sirene;
  if (!sirene) throw new ErreurSourcing("config/niche.json n'a pas de sources.sirene : rien à construire.");
  const aujourdhui = dateDuJour(niche.pays.fuseau, maintenant);
  const plan = planifier(sirene);
  const { cles, incompletes } = clesDuPlan(dossier, plan);
  if (cles.length === 0) throw new ErreurSourcing("Le cache est vide pour cette config : lance d'abord « sirene.mjs fetch ».");

  const c = {
    lues: 0,
    doublons: 0,
    fermees: 0,
    hors_naf: 0,
    hors_zone: 0,
    entrepreneurs_individuels: 0,
    nom_sans_mot_attendu: 0,
    nom_exclu: 0,
    taille_hors_cible: 0,
    gardees: 0,
    sans_dirigeant: 0,
    effectif_inconnu: 0,
    non_diffusibles: 0,
    tiers: { A: 0, B: 0, C: 0 },
  };
  const departements = sirene.departements === "tous" ? null : new Set(sirene.departements);
  const vus = new Set();
  const lignes = [];
  for (const cle of cles) {
    c.non_diffusibles += lireEtat(dossier, cle)?.non_diffusibles ?? 0;
    const chemin = cheminLignes(dossier, cle);
    if (!existsSync(chemin)) continue;
    for (const texte of readFileSync(chemin, "utf8").split("\n")) {
      if (!texte.trim()) continue;
      let x;
      try {
        x = JSON.parse(texte);
      } catch {
        continue;
      }
      c.lues++;
      if (vus.has(x.siren)) {
        c.doublons++;
        continue;
      }
      vus.add(x.siren);
      const nomComplet = [x.nom, x.sigle, ...(x.enseignes ?? [])].join(" ");
      if (x.etat !== "A" || x.siege_etat === "F") c.fermees++;
      else if (!sirene.naf.includes(x.naf)) c.hors_naf++;
      else if (departements && !departements.has(x.departement)) c.hors_zone++;
      else if (sirene.exclureEI && x.ei) c.entrepreneurs_individuels++;
      else if (sirene.motsNomInclure?.length && !contientDebutDeMot(nomComplet, sirene.motsNomInclure)) c.nom_sans_mot_attendu++;
      else if (sirene.motsNomExclure?.length && contientDebutDeMot(nomComplet, sirene.motsNomExclure)) c.nom_exclu++;
      else if (!toutesTailles && horsTaille(x.tranche, niche.cible)) c.taille_hors_cible++;
      else {
        const ligne = {
          entreprise: x.nom,
          enseigne: (x.enseignes ?? []).join(" | ").slice(0, 200),
          siren: x.siren,
          siret: x.siret,
          naf: x.naf,
          categorie_juridique: x.categorie_juridique,
          forme_juridique: libelleCategorieJuridique(x.categorie_juridique) ?? "",
          effectif: libelleTranche(x.tranche) ?? "",
          date_creation: x.date_creation,
          ville: x.commune,
          code_postal: x.code_postal,
          departement: x.departement,
          dirigeant: choisirDirigeant(x.dirigeants),
          metier: metierDepuisNom(nomComplet, niche.cible.metiers),
          est_ei: x.ei ? "oui" : "non",
          source: "sirene",
          source_url: SOURCE_URL,
          source_date: x.le ?? aujourdhui,
        };
        const s = calculerScore(ligne, niche.score, { aujourdhui });
        Object.assign(ligne, { score: String(s.score), tier: s.tier, score_detail: s.retenus.join(" + ") });
        lignes.push(ligne);
      }
    }
  }
  lignes.sort((a, b) => Number(b.score) - Number(a.score) || a.siren.localeCompare(b.siren));
  const gardees = limite ? lignes.slice(0, limite) : lignes;
  c.gardees = gardees.length;
  for (const l of gardees) {
    c.tiers[l.tier]++;
    if (!l.dirigeant) c.sans_dirigeant++;
    if (!l.effectif) c.effectif_inconnu++;
  }

  const rapport = [
    `Base SIRENE : ${cles.length} recherche(s) en cache${incompletes > 0 ? `, dont ${incompletes} pas finie(s) (relance « fetch » pour compléter)` : ""}`,
    `Non diffusibles écartées à la récolte : ${c.non_diffusibles}`,
    `Entreprises lues : ${c.lues} ; doublons (même SIREN) : ${c.doublons}`,
    `Écartées : fermées ${c.fermees} ; hors NAF ${c.hors_naf} ; siège hors zone ${c.hors_zone} ; entrepreneurs individuels ${c.entrepreneurs_individuels} ; nom sans mot attendu ${c.nom_sans_mot_attendu} ; nom exclu ${c.nom_exclu} ; taille hors cible ${c.taille_hors_cible}`,
    `Gardées : ${c.gardees}${limite && lignes.length > limite ? ` (les ${limite} meilleurs scores sur ${lignes.length})` : ""} ; sans dirigeant : ${c.sans_dirigeant} ; effectif inconnu : ${c.effectif_inconnu}`,
    `Tiers (premier score, sans téléphone ni site) : A ${c.tiers.A}, B ${c.tiers.B}, C ${c.tiers.C}`,
  ];
  if (essai) {
    rapport.push("ESSAI : rien n'a été écrit.");
  } else if (gardees.length === 0) {
    rapport.push("Aucune entreprise gardée : rien n'a été écrit.");
  } else {
    const chemin = sortie ?? join(dossier, `sirene-${aujourdhui}.csv`);
    ecrireTableau(chemin, gardees, Object.keys(gardees[0]));
    rapport.push(`Écrit : ${cheminAffiche(chemin)}`);
    rapport.push("SIRENE ne donne ni téléphone ni site : voir docs/sourcing.md (Google Places facultatif, ou ton propre fichier, puis appariement).");
  }
  return { code: 0, lignes: rapport, compteurs: c };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--essai": "booleen",
      "--limite": "entier",
      "--dossier": "texte",
      "--config": "texte",
      "--sortie": "texte",
      "--toutes-tailles": "booleen",
    });
    const commande = positionnels[0];
    if (options.aide || positionnels.length !== 1 || !["fetch", "build"].includes(commande)) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const dossier = dossierDonnees(options.dossier);
    const r =
      commande === "fetch"
        ? await recolter({ niche, dossier, limite: options.limite ?? null, essai: Boolean(options.essai), dependances: { signal: () => AbortSignal.timeout(30000) } })
        : construire({
            niche,
            dossier,
            limite: options.limite ?? null,
            essai: Boolean(options.essai),
            sortie: options.sortie ? resolve(options.sortie) : null,
            toutesTailles: Boolean(options.toutesTailles),
          });
    afficher(r.lignes);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();
