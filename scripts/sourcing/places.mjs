// Google par son API OFFICIELLE (FACULTATIF et DÉSACTIVÉ par défaut) : Places API (New), Text Search. Le téléphone, le site, la note et
// le nombre d'avis des fiches d'établissements, par une clé d'API que TU crées dans ton projet Google Cloud (docs/sourcing.md,
// « Google (API officielle Places) »). Aucun navigateur piloté : une requête HTTPS par page de résultats, dans le cadre des conditions
// de Google Maps Platform.
//
// Deux modes :
//   chercher             découverte : chaque mot-clé dans chaque ville (sources.places.motsCles × villes), sources.places.max fiches au
//                        plus. Pour un pays sans registre ouvert (Belgique, Suisse, Canada), ou pour compléter une base.
//   enrichir <base.csv>  pour chaque entreprise de la base qui n'a pas encore téléphone et site, cherche « <nom> <ville> » et garde
//                        jusqu'à 3 fiches, marquées siren_recherche ; appariement.mjs choisit ensuite la bonne (ou aucune).
//
// Coût et plafond : chaque requête envoyée à Google est un « appel » (une page de 20 fiches au plus). --max-appels (20 par défaut)
// arrête l'exécution proprement quand il est atteint ; le nombre d'appels consommés est toujours affiché. Le prix se lit sur la page
// de tarifs de Google Maps Platform (les champs téléphone, site et note sont facturés à un tarif supérieur aux champs de base).
//
// Ce qui est gardé : le CSV écrit contient le place_id (que les conditions de Google permettent de conserver) et la date de lecture
// (source_date) ; le reste du contenu de Google (téléphone, site, note, avis) est à rafraîchir ou à supprimer sous 30 jours (docs/legal.md).
// La source reste « maps » dans le CSV : c'est le type de source que la base connaît pour une fiche Google.
//
// Reprise : l'état est gardé dans donnees/cache/places-<mode>.json (progression seulement, aucun contenu de Google) et le fichier de
// sortie est complété au fil de l'eau ; un état de plus de 30 jours n'est pas repris.
//
// Usage : node scripts/sourcing/places.mjs chercher [--sortie <f.csv>] [--limite N] [--max-appels N] [--essai] [--dossier <d>] [--config <c>]
//         node scripts/sourcing/places.mjs enrichir <base.csv> [--sortie <f.csv>] [--limite N] [--max-appels N] [--essai] [--dossier <d>] [--config <c>]
//   --limite N : N recherches au plus ; --max-appels N : N requêtes à Google au plus (20 par défaut) ; --essai : annonce le nombre de
//   recherches et d'appels, sans rien envoyer à Google (la clé n'est pas lue).
//
// Clé : GOOGLE_PLACES_API_KEY, dans l'environnement ou dans .env.local à la racine du dépôt (comme SUPABASE_DB_URL). Jamais affichée.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { lireAdresse } from "./appariement.mjs";
import {
  afficher,
  attendreVraiment,
  chargerNiche,
  cheminAffiche,
  dateDuJour,
  dossierDonnees,
  ecrireTableau,
  ErreurSourcing,
  estLance,
  estVide,
  lireArguments,
  lireTableau,
  messageSur,
  nettoyerTexte,
  normaliserCodePostal,
  normaliserDepartement,
  normaliserE164,
  normaliserSiren,
  normaliserSite,
  RACINE,
  tel9,
} from "./lib.mjs";

export const URL_PLACES = "https://places.googleapis.com/v1/places:searchText";
/** Les seuls champs demandés à Google : ce que le sourcing utilise, rien de plus (chaque champ a son tarif). */
export const CHAMPS_PLACES = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

export const APPELS_PAR_DEFAUT = 20;
export const FICHES_PAR_PAGE = 20;
export const PAGES_MAX_PAR_RECHERCHE = 3;
export const FICHES_PAR_ENTREPRISE = 3;
export const JOURS_CONSERVATION = 30;
const PAUSE_PAGE_MS = 400;
const ESSAIS = 3;
const COLONNES_FICHE = [
  "entreprise",
  "telephone",
  "site",
  "ville",
  "code_postal",
  "departement",
  "note_google",
  "nb_avis",
  "maps_categorie",
  "siren_recherche",
  "place_id",
  "source",
  "source_url",
  "source_date",
];

const USAGE = [
  "Usage :",
  "  node scripts/sourcing/places.mjs chercher [--sortie <f.csv>] [--limite N] [--max-appels N] [--essai] [--dossier <d>] [--config <c>]",
  "  node scripts/sourcing/places.mjs enrichir <base.csv> [--sortie <f.csv>] [--limite N] [--max-appels N] [--essai] [--dossier <d>] [--config <c>]",
  "  Désactivé par défaut (config/niche.json : sources.places.actif). Lis docs/sourcing.md, « Google (API officielle Places) », avant.",
  `  --max-appels N : au plus N requêtes à Google (${APPELS_PAR_DEFAUT} par défaut) ; --essai : rien n'est envoyé, la clé n'est pas lue.`,
].join("\n");

export const MESSAGE_DESACTIVE = [
  "Google Places est désactivé : config/niche.json, sources.places.actif vaut false (ou sources.places est absent). Rien n'a été fait.",
  "",
  "Pour l'activer : crée une clé d'API Google Places (New) dans ton projet Google Cloud, restreinte à cette API, avec un quota par",
  "jour et une alerte de budget (docs/sourcing.md, « Google (API officielle Places) »), mets-la dans .env.local sous le nom",
  "GOOGLE_PLACES_API_KEY, puis dans config/niche.json : sources.places.actif = true (avec motsCles, villes, max).",
  "Sans Google : le registre SIRENE (sirene.mjs) donne les entreprises sans téléphone ; complète avec ton propre fichier",
  "(annuaire, export de ton CRM) et appariement.mjs, ou fais chercher le numéro par l'appelant.",
];

export const MESSAGE_SANS_CLE = [
  "La clé GOOGLE_PLACES_API_KEY est introuvable (ni dans l'environnement, ni dans .env.local à la racine du dépôt).",
  "Crée-la toi-même dans ton projet Google Cloud (docs/sourcing.md, « Google (API officielle Places) »), colle-la dans .env.local",
  "(une ligne : GOOGLE_PLACES_API_KEY=…, jamais dans le dépôt ni dans une conversation), puis relance la même commande.",
];

/** La clé de l'API : GOOGLE_PLACES_API_KEY, sinon lue dans .env.local à la racine du dépôt. Jamais affichée. */
export function cleGoogle(env = process.env, racine = RACINE) {
  if (!env.GOOGLE_PLACES_API_KEY) {
    const fichier = join(racine, ".env.local");
    if (existsSync(fichier)) {
      try {
        process.loadEnvFile(fichier);
      } catch {
        // fichier illisible : on le dit par le message « clé introuvable », sans rien en citer
      }
    }
  }
  return String(env.GOOGLE_PLACES_API_KEY ?? "").trim();
}

/** Les recherches à faire : { requete, siren_recherche } (mode chercher : mots-clés × villes ; enrichir : une par entreprise). */
export function planRecherches(niche, mode, base = []) {
  const places = niche.sources.places;
  if (mode === "chercher") {
    const plan = [];
    for (const mot of places.motsCles) for (const ville of places.villes) plan.push({ requete: nettoyerTexte(`${mot} ${ville}`, 200), siren_recherche: "" });
    return plan;
  }
  return base
    .filter((l) => !estVide(l.entreprise) && (estVide(l.telephone) || estVide(l.site)))
    .map((l) => {
      const nom = String(l.enseigne ?? "").split("|")[0].trim() || l.entreprise;
      return { requete: nettoyerTexte(`${nom} ${l.ville ?? ""}`, 200), siren_recherche: normaliserSiren(l.siren) ?? "" };
    });
}

/** Le lien Google Maps d'une fiche, bâti sur son place_id (le seul identifiant que Google permet de garder). */
export const lienDepuisPlaceId = (id) => (/^[A-Za-z0-9_-]{10,200}$/.test(String(id ?? "")) ? `https://www.google.com/maps/place/?q=place_id:${id}` : "");

/** Une fiche de la réponse Places (New) au format d'import. */
export function versFiche(place, { pays = "FR", le, siren = "" }) {
  const composants = Array.isArray(place?.addressComponents) ? place.addressComponents : [];
  const lire = (type) => composants.find((c) => Array.isArray(c?.types) && c.types.includes(type))?.longText ?? "";
  const adresse = lireAdresse(place?.formattedAddress);
  const cp = normaliserCodePostal(lire("postal_code") || adresse.codePostal, pays) ?? "";
  const ville = lire("locality") || lire("postal_town") || adresse.ville;
  const note = typeof place?.rating === "number" && place.rating >= 0 && place.rating <= 5 ? String(Math.round(place.rating * 10) / 10) : "";
  const avis = Number.isInteger(place?.userRatingCount) && place.userRatingCount >= 0 ? String(place.userRatingCount) : "";
  const id = String(place?.id ?? "");
  return {
    entreprise: nettoyerTexte(place?.displayName?.text, 200),
    telephone: normaliserE164(place?.internationalPhoneNumber, pays) ?? normaliserE164(place?.nationalPhoneNumber, pays) ?? "",
    site: normaliserSite(String(place?.websiteUri ?? "").replace(/\?.*$/, "")) ?? "",
    ville: nettoyerTexte(ville, 120),
    code_postal: cp,
    departement: normaliserDepartement("", cp, pays) ?? "",
    note_google: note,
    nb_avis: avis,
    maps_categorie: nettoyerTexte(place?.primaryTypeDisplayName?.text, 80),
    siren_recherche: siren,
    place_id: /^[A-Za-z0-9_-]{10,200}$/.test(id) ? id : "",
    source: "maps",
    source_url: lienDepuisPlaceId(id),
    source_date: le,
  };
}

/**
 * Le client de l'API : chercher(requete, { max, pages }) lit jusqu'à `pages` pages de résultats (au plus `max` fiches), dans la limite
 * du budget partagé { restant, appels }. Renvoie { statut: "ok" | "budget" | "refuse" | "erreur", places: [brut] }.
 * « refuse » : la clé ou l'API est refusée (400, 401, 403) : inutile de continuer. « erreur » : panne passagère après 3 essais.
 */
export function clientPlaces({ cle, fetch: lire = globalThis.fetch, attendre = attendreVraiment, pays = "FR", budget }) {
  async function appeler(corps) {
    for (let essai = 0; essai < ESSAIS; essai++) {
      budget.restant--;
      budget.appels++;
      let reponse;
      try {
        reponse = await lire(URL_PLACES, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": cle, "X-Goog-FieldMask": CHAMPS_PLACES },
          body: JSON.stringify(corps),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        reponse = null;
      }
      if (reponse?.ok) {
        try {
          return { statut: "ok", donnees: await reponse.json() };
        } catch {
          return { statut: "erreur" };
        }
      }
      if (reponse && [400, 401, 403].includes(reponse.status)) return { statut: "refuse", code: `http_${reponse.status}` };
      if (budget.restant <= 0) return { statut: "budget" };
      await attendre(1500 * 2 ** essai);
    }
    return { statut: "erreur" };
  }

  return {
    async chercher(requete, { max, pages = PAGES_MAX_PAR_RECHERCHE }) {
      const places = [];
      let jeton = null;
      for (let page = 0; page < pages && places.length < max; page++) {
        if (budget.restant <= 0) return { statut: "budget", places };
        const corps = { textQuery: requete, languageCode: "fr", regionCode: pays, pageSize: Math.min(FICHES_PAR_PAGE, Math.max(1, max - places.length)) };
        if (jeton) corps.pageToken = jeton;
        const r = await appeler(corps);
        if (r.statut !== "ok") return { statut: r.statut, code: r.code, places };
        places.push(...(Array.isArray(r.donnees?.places) ? r.donnees.places : []));
        jeton = typeof r.donnees?.nextPageToken === "string" && r.donnees.nextPageToken ? r.donnees.nextPageToken : null;
        if (!jeton) break;
        await attendre(PAUSE_PAGE_MS); // le jeton de la page suivante met parfois un instant à devenir valable
      }
      return { statut: "ok", places };
    },
  };
}

const cleDoublon = (f) => f.place_id || tel9(f.telephone) || `${f.entreprise}|${f.code_postal}`;

/**
 * Fait tout le travail. dependances : { fetch, attendre, maintenant, cle (la clé, pour les tests) }.
 * Renvoie { code, lignes (le rapport), compteurs }.
 */
export async function executer({ niche, mode, base = null, sortie = null, dossier, limite = null, maxAppels = APPELS_PAR_DEFAUT, essai = false, dependances = {} }) {
  const places = niche.sources.places;
  if (!places?.actif) return { code: 1, lignes: MESSAGE_DESACTIVE, compteurs: { desactive: true } };
  if (mode === "chercher" && (places.motsCles.length === 0 || places.villes.length === 0)) {
    throw new ErreurSourcing("sources.places.motsCles et sources.places.villes doivent avoir au moins une valeur chacun pour « chercher ».");
  }
  const tableau = mode === "enrichir" ? lireTableau(base) : null;
  if (tableau && tableau.lignes.length === 0) throw new ErreurSourcing("La base ne contient aucune ligne de données.");
  let plan = planRecherches(niche, mode, tableau?.lignes ?? []);
  if (limite) plan = plan.slice(0, limite);
  const pagesParRecherche = mode === "enrichir" ? 1 : Math.min(PAGES_MAX_PAR_RECHERCHE, Math.ceil(places.max / FICHES_PAR_PAGE));
  const maxFiches = mode === "chercher" ? places.max : Infinity;

  if (essai) {
    const appelsMax = plan.length * pagesParRecherche;
    return {
      code: 0,
      lignes: [
        `Google Places (${mode}) : ${plan.length} recherche(s) prévue(s), ${mode === "chercher" ? `${places.max} fiches au plus` : `${FICHES_PAR_ENTREPRISE} fiches au plus par entreprise`}`,
        `Appels à Google : ${appelsMax} au plus pour tout faire (jusqu'à ${pagesParRecherche} par recherche) ; plafond de cette exécution : ${maxAppels} (--max-appels)`,
        "Le coût se lit sur la page de tarifs de Google Maps Platform, pour les champs demandés (téléphone, site, note).",
        "ESSAI : rien n'a été envoyé à Google, rien n'a été écrit.",
      ],
      compteurs: { recherches: plan.length, appels_max: appelsMax },
    };
  }

  const cle = dependances.cle ?? cleGoogle();
  if (!cle) return { code: 1, lignes: MESSAGE_SANS_CLE, compteurs: { sans_cle: true } };

  const attendre = dependances.attendre ?? attendreVraiment;
  const le = dateDuJour(niche.pays.fuseau, dependances.maintenant ?? new Date());
  const cheminSortiePlaces = sortie ?? join(dossier, `places-${mode}-${le}.csv`);
  const cheminEtat = join(dossier, "cache", `places-${mode}.json`);
  mkdirSync(dirname(cheminEtat), { recursive: true });
  let etat = { sortie: cheminSortiePlaces, prochain: 0, le };
  if (existsSync(cheminEtat) && existsSync(cheminSortiePlaces)) {
    try {
      const lu = JSON.parse(readFileSync(cheminEtat, "utf8"));
      const age = (Date.parse(`${le}T00:00:00Z`) - Date.parse(`${lu.le}T00:00:00Z`)) / 86400000;
      if (lu.sortie === cheminSortiePlaces && Number.isInteger(lu.prochain) && age >= 0 && age <= JOURS_CONSERVATION) etat = { ...etat, ...lu };
    } catch {
      // état illisible : on repart du début
    }
  }
  const fiches = existsSync(cheminSortiePlaces) && etat.prochain > 0 ? lireTableau(cheminSortiePlaces).lignes : [];
  const vus = new Set(fiches.map(cleDoublon));
  const budget = { restant: maxAppels, appels: 0 };
  const client = clientPlaces({ cle, fetch: dependances.fetch, attendre, pays: niche.pays.code, budget });
  const c = { recherches: 0, fiches_lues: 0, fiches_gardees: 0, doublons: 0, fermees: 0, appels: 0 };
  let arret = null;
  let code = 0;
  const sauver = () => {
    ecrireTableau(cheminSortiePlaces, fiches, COLONNES_FICHE);
    writeFileSync(cheminEtat, JSON.stringify(etat));
  };

  try {
    while (etat.prochain < plan.length && fiches.length < maxFiches) {
      if (budget.restant <= 0) {
        arret = `plafond de ${maxAppels} appels atteint (--max-appels) : relance la même commande pour reprendre ici`;
        break;
      }
      const r = plan[etat.prochain];
      const res = await client.chercher(r.requete, {
        max: mode === "enrichir" ? FICHES_PAR_ENTREPRISE : Math.min(pagesParRecherche * FICHES_PAR_PAGE, maxFiches - fiches.length),
        pages: pagesParRecherche,
      });
      if (res.statut === "refuse") {
        code = 1;
        arret = `Google refuse la requête (code ${res.code}) : vérifie que Places API (New) est activée, que la facturation est liée au projet et que la clé n'est pas restreinte autrement (docs/sourcing.md)`;
        break;
      }
      if (res.statut === "erreur") {
        code = 1;
        arret = "Google ne répond pas après 3 essais : relance plus tard, la récolte reprendra ici";
        break;
      }
      // « budget » : la recherche est coupée en route ; ses fiches déjà lues sont gardées, elle sera refaite à la reprise.
      c.recherches += res.statut === "ok" ? 1 : 0;
      for (const brut of mode === "enrichir" ? res.places.slice(0, FICHES_PAR_ENTREPRISE) : res.places) {
        c.fiches_lues++;
        if (brut?.businessStatus === "CLOSED_PERMANENTLY") {
          c.fermees++;
          continue;
        }
        const f = versFiche(brut, { pays: niche.pays.code, le, siren: r.siren_recherche });
        if (!f.entreprise) continue;
        const cle2 = cleDoublon(f);
        if (mode === "chercher" && vus.has(cle2)) {
          c.doublons++;
          continue;
        }
        vus.add(cle2);
        fiches.push(f);
        c.fiches_gardees++;
        if (fiches.length >= maxFiches) break;
      }
      if (res.statut === "budget") {
        arret = `plafond de ${maxAppels} appels atteint (--max-appels) : relance la même commande pour reprendre ici`;
        break;
      }
      etat.prochain++;
      if (c.recherches % 5 === 0) sauver();
    }
  } finally {
    c.appels = budget.appels;
    sauver();
  }

  const avecTelephone = fiches.filter((f) => !estVide(f.telephone)).length;
  const lignes = [
    `Google Places (${mode}) : ${c.recherches} recherche(s) faites, ${etat.prochain} sur ${plan.length} au total`,
    `Appels à Google consommés : ${c.appels} sur ${maxAppels} permis (--max-appels)`,
    `Fiches lues : ${c.fiches_lues} ; gardées : ${c.fiches_gardees} (doublons : ${c.doublons}, fermées définitivement : ${c.fermees}) ; dans le fichier : ${fiches.length}, dont ${avecTelephone} avec téléphone`,
  ];
  if (arret) lignes.push(`ARRÊT : ${arret}.`);
  else if (fiches.length >= maxFiches) lignes.push(`Maximum atteint (sources.places.max : ${maxFiches}).`);
  lignes.push(`Écrit : ${cheminAffiche(cheminSortiePlaces)}`);
  lignes.push(`Contenu de Google lu le ${le} : à rafraîchir ou à supprimer sous ${JOURS_CONSERVATION} jours (docs/legal.md) ; seul le place_id se garde.`);
  if (mode === "enrichir") lignes.push("Étape suivante : appariement.mjs <base.csv> <ce fichier> (choisit la bonne fiche, ou aucune).");
  return { code, lignes, compteurs: { ...c, total: fiches.length } };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--sortie": "texte",
      "--limite": "entier",
      "--max-appels": "entier",
      "--essai": "booleen",
      "--dossier": "texte",
      "--config": "texte",
    });
    const mode = positionnels[0];
    const valide = (mode === "chercher" && positionnels.length === 1) || (mode === "enrichir" && positionnels.length === 2);
    if (options.aide || !valide) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const r = await executer({
      niche,
      mode,
      base: mode === "enrichir" ? resolve(positionnels[1]) : null,
      sortie: options.sortie ? resolve(options.sortie) : null,
      dossier: dossierDonnees(options.dossier),
      limite: options.limite ?? null,
      maxAppels: options.maxAppels ?? APPELS_PAR_DEFAUT,
      essai: Boolean(options.essai),
    });
    afficher(r.lignes);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();
