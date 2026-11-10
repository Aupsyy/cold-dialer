// L'enrichissement d'une base : deux lectures PUBLIQUES qui servent à décider qui appeler en premier (grille de score, config.score).
//
//   a) Le registre public des entreprises (API Recherche Entreprises, sans clé, la même cadence que sirene.mjs) pour chaque ligne qui a
//      un SIREN : chiffre d'affaires publié (dernier exercice connu), tranche d'effectif, employeur ou non, date de création, état
//      (active ou cessée). Une unité non diffusible (statut de diffusion partielle) n'est jamais gardée.
//   b) Le site de l'entreprise, lu avec la même politesse et les mêmes garde-fous que emails.mjs (robots.txt, une requête par seconde
//      par domaine, identité marque.userAgent, jamais un réseau social ni une adresse non publique, 4 pages au plus). Une SEULE lecture
//      sert aux signaux et à l'e-mail publié (comme emails.mjs : jamais deviné, jamais celui d'un autre domaine) : un pixel publicitaire
//      de Meta, une balise de publicité Google, un outil de prise de rendez-vous, une agence créditée en pied de page, site joignable ou non.
//
// Colonnes écrites (une valeur déjà présente n'est jamais remplacée, sauf --refaire) :
//   registre : chiffre_affaires (euros), ca_annee, employeur (oui/non), etat_registre (A : active, C : cessée), registre_date ;
//              effectif et date_creation si elles étaient vides ;
//   site     : site_joignable (oui : lu ; non : n'a pas répondu ; vide : pas lu, par exemple interdit par robots.txt), signaux_site
//              (les signaux vus, séparés par des virgules), signaux_date ; email, email_source, email_date si l'e-mail était vide.
// Ces colonnes servent à score.mjs (critères chiffre_affaires, employeur, signal_site ; « cessée » est écartée) : lance score.mjs APRÈS
// cette étape. Elles ne sont pas importées en base (l'import les ignore) : elles ne servent qu'au score.
// Une donnée absente (CA non publié, site pas lu) reste vide : elle ne rapporte ni ne retire aucun point.
//
// Usage : node scripts/sourcing/enrichir.mjs <entree.csv> [--sortie <fichier.csv>] [--limite N] [--paralleles N] [--sans-registre]
//                                           [--sans-site] [--refaire] [--essai] [--dossier <chemin>] [--config <niche.json>]
//   Écrit <entree>-enrichi.csv. Reprise : donnees/cache/enrichir-registre.jsonl (par SIREN) et enrichir-sites.jsonl (par domaine)
//   gardent chaque lecture faite ; supprime-les pour tout relire. --limite N : N SIREN et N sites au plus. --essai : compteurs
//   seulement, aucune requête, rien n'est écrit.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { creerContexteSite, domaineDe, emailDepuisPages, enParallele, lireSite } from "./emails.mjs";
import {
  afficher,
  attendreVraiment,
  chargerNiche,
  cheminAffiche,
  cheminSortie,
  creerCadence,
  dateDuJour,
  dossierDonnees,
  ecrireTableau,
  ErreurSourcing,
  estLance,
  estVide,
  lireArguments,
  lireTableau,
  libelleTranche,
  messageSur,
  normaliserDate,
  normaliserSiren,
  verifierSortie,
} from "./lib.mjs";
import { INTERVALLE_MS, appelerApi, nonDiffusible } from "./sirene.mjs";
import { lireSignaux, listerSignaux } from "./signaux.mjs";

const USAGE = [
  "Usage : node scripts/sourcing/enrichir.mjs <entree.csv> [--sortie <fichier.csv>] [--limite N] [--paralleles N] [--sans-registre]",
  "                                           [--sans-site] [--refaire] [--essai] [--dossier <chemin>] [--config <niche.json>]",
  "  Lit le registre public (chiffre d'affaires, effectif, employeur, état) puis le site de chaque entreprise (pixel publicitaire,",
  "  balise Google Ads, prise de rendez-vous, agence créditée, site joignable). Lance score.mjs ensuite.",
  "  --sortie        le fichier écrit (défaut : <entree>-enrichi.csv)",
  "  --limite N      N SIREN et N sites au plus",
  "  --paralleles N  sites lus en même temps (4 par défaut, 8 au plus ; toujours une requête par seconde par domaine)",
  "  --sans-registre / --sans-site   saute l'une des deux lectures",
  "  --refaire       relit même les lignes déjà enrichies (le cache est ignoré)",
  "  --essai         compteurs seulement, aucune requête, rien n'est écrit",
].join("\n");

const oui = (v) => (v === true ? "oui" : v === false ? "non" : "");

/**
 * Ce que le registre dit d'une entreprise (un résultat de l'API Recherche Entreprises) : { ca, ca_annee, employeur (true/false/null),
 * etat, tranche (libellé), date_creation }, ou null si l'unité est non diffusible. Rien d'autre n'est gardé.
 */
export function extraireRegistre(r) {
  if (!r || typeof r !== "object" || nonDiffusible(r)) return null;
  const finances = r.finances && typeof r.finances === "object" ? r.finances : {};
  const annees = Object.keys(finances)
    .filter((a) => /^\d{4}$/.test(a) && typeof finances[a]?.ca === "number" && Number.isFinite(finances[a].ca))
    .sort();
  const derniere = annees.at(-1) ?? null;
  const siege = r.siege && typeof r.siege === "object" ? r.siege : {};
  const brutEmployeur = r.caractere_employeur ?? siege.caractere_employeur ?? null;
  const etat = String(r.etat_administratif ?? "").trim().toUpperCase();
  return {
    ca: derniere ? Math.round(finances[derniere].ca) : null,
    ca_annee: derniere ? Number(derniere) : null,
    employeur: brutEmployeur === "O" ? true : brutEmployeur === "N" ? false : null,
    etat: /^[A-Z]$/.test(etat) ? etat : "",
    tranche: libelleTranche(r.tranche_effectif_salarie ?? siege.tranche_effectif_salarie) ?? "",
    date_creation: normaliserDate(r.date_creation) ?? "",
  };
}

/** Écrit le registre d'une entreprise dans sa ligne : seulement les cases vides (sauf refaire). Renvoie true si le registre a répondu. */
export function appliquerRegistre(ligne, reg, le, { refaire = false } = {}) {
  if (!reg) return false;
  const mettre = (colonne, valeur) => {
    if (valeur === "" || valeur === null || valeur === undefined) return;
    if (refaire || estVide(ligne[colonne])) ligne[colonne] = String(valeur);
  };
  mettre("chiffre_affaires", reg.ca);
  mettre("ca_annee", reg.ca_annee);
  mettre("employeur", oui(reg.employeur));
  mettre("etat_registre", reg.etat);
  if (estVide(ligne.effectif)) mettre("effectif", reg.tranche);
  if (estVide(ligne.date_creation)) mettre("date_creation", reg.date_creation);
  ligne.registre_date = le;
  return true;
}

function lireCache(chemin, cle) {
  const cache = new Map();
  if (!existsSync(chemin)) return cache;
  for (const ligne of readFileSync(chemin, "utf8").split("\n")) {
    if (!ligne.trim()) continue;
    try {
      const r = JSON.parse(ligne);
      if (r && typeof r[cle] === "string") cache.set(r[cle], r);
    } catch {
      // une ligne abîmée (arrêt brutal) : elle sera relue
    }
  }
  return cache;
}

const STATUTS_SITE = {
  aucun: "sans_email",
  robots: "robots",
  injoignable: "injoignables",
  pas_html: "pas_html",
  redirige_ailleurs: "rediriges_ailleurs",
  hors_perimetre: "hors_perimetre",
  site_illisible: "illisibles",
};

/**
 * Fait tout le travail sur un CSV. dependances : { fetch, resoudre (DNS), attendre, horloge, maintenant, delaiMs, messageries }
 * (injectables : les tests n'ouvrent aucune connexion). Renvoie { code, lignes (le rapport), compteurs }.
 */
export async function executer({ niche, entree, sortie, dossier, limite = null, paralleles = 4, registre = true, site = true, refaire = false, essai = false, dependances = {} }) {
  const { colonnes, lignes } = lireTableau(entree);
  if (lignes.length === 0) throw new ErreurSourcing("Le fichier ne contient aucune ligne de données.");
  if (site && !colonnes.includes("site") && !registre) throw new ErreurSourcing("Le fichier n'a pas de colonne « site » (ou site_web, url).");
  const le = dateDuJour(niche.pays.fuseau, dependances.maintenant ?? new Date());
  const attendre = dependances.attendre ?? attendreVraiment;
  const c = {
    lignes: lignes.length,
    sirens_a_lire: 0,
    registre_lus: 0,
    registre_repris_du_cache: 0,
    registre_introuvables: 0,
    non_diffusibles: 0,
    registre_erreurs: 0,
    avec_ca: 0,
    employeurs: 0,
    cessees: 0,
    domaines_a_lire: 0,
    sites_lus: 0,
    sites_repris_du_cache: 0,
    sites_joignables: 0,
    sites_non_lus: 0,
    pixel_meta: 0,
    balise_google_ads: 0,
    prise_rdv: 0,
    agence_creditee: 0,
    emails_trouves: 0,
    sans_email: 0,
    robots: 0,
    injoignables: 0,
    pas_html: 0,
    rediriges_ailleurs: 0,
    hors_perimetre: 0,
    illisibles: 0,
    requetes: 0,
  };

  // Le travail à faire : une lecture du registre par SIREN, une lecture de site par domaine.
  const parSiren = new Map();
  if (registre) {
    lignes.forEach((l, k) => {
      const siren = normaliserSiren(l.siren);
      if (!siren || (!refaire && !estVide(l.registre_date))) return;
      if (!parSiren.has(siren)) parSiren.set(siren, []);
      parSiren.get(siren).push(k);
    });
  }
  const parDomaine = new Map();
  if (site && colonnes.includes("site")) {
    lignes.forEach((l, k) => {
      const domaine = domaineDe(l.site);
      if (!domaine || (!refaire && !estVide(l.signaux_date))) return;
      if (!parDomaine.has(domaine)) parDomaine.set(domaine, { site: l.site, lignes: [] });
      parDomaine.get(domaine).lignes.push(k);
    });
  }
  let sirens = [...parSiren.keys()];
  let domaines = [...parDomaine.keys()];
  if (limite) {
    sirens = sirens.slice(0, limite);
    domaines = domaines.slice(0, limite);
  }
  c.sirens_a_lire = sirens.length;
  c.domaines_a_lire = domaines.length;

  const rapportDuTravail = () => [
    "Enrichissement de la base : registre public et signaux du site (rien n'est deviné)",
    `Lignes : ${c.lignes} ; SIREN à lire au registre : ${c.sirens_a_lire} ; sites à lire : ${c.domaines_a_lire}`,
  ];
  if (essai) {
    const secondes = Math.ceil((c.sirens_a_lire * INTERVALLE_MS) / 1000 + (c.domaines_a_lire * 5) / Math.min(8, Math.max(1, paralleles)));
    return {
      code: 0,
      lignes: [...rapportDuTravail(), `Durée : environ ${Math.max(1, Math.ceil(secondes / 60))} min au plus`, "ESSAI : aucune requête envoyée, rien n'a été écrit."],
      compteurs: c,
    };
  }

  const cacheRegistre = join(dossier, "cache", "enrichir-registre.jsonl");
  const cacheSites = join(dossier, "cache", "enrichir-sites.jsonl");
  mkdirSync(dirname(cacheRegistre), { recursive: true });

  // a) Le registre.
  if (sirens.length > 0) {
    const memoire = refaire ? new Map() : lireCache(cacheRegistre, "siren");
    const ctxApi = {
      fetch: dependances.fetch ?? globalThis.fetch,
      attendre,
      patienter: creerCadence(INTERVALLE_MS, { horloge: dependances.horloge, attendre }),
      userAgent: niche.marque.userAgent,
    };
    for (const siren of sirens) {
      let r = memoire.get(siren);
      if (r) {
        c.registre_repris_du_cache++;
      } else {
        let corps;
        try {
          corps = await appelerApi({ q: siren, per_page: 1 }, ctxApi);
        } catch {
          c.registre_erreurs++;
          continue;
        }
        c.registre_lus++;
        c.requetes++;
        const trouve = (Array.isArray(corps.results) ? corps.results : []).find((x) => normaliserSiren(x?.siren) === siren);
        const reg = trouve ? extraireRegistre(trouve) : null;
        r = { siren, statut: !trouve ? "introuvable" : reg ? "ok" : "non_diffusible", reg, le };
        appendFileSync(cacheRegistre, `${JSON.stringify(r)}\n`);
      }
      if (r.statut === "introuvable") {
        c.registre_introuvables++;
        continue;
      }
      if (r.statut === "non_diffusible") {
        c.non_diffusibles++;
        continue;
      }
      for (const k of parSiren.get(siren)) {
        appliquerRegistre(lignes[k], r.reg, r.le ?? le, { refaire });
        if (r.reg.ca !== null) c.avec_ca++;
        if (r.reg.employeur === true) c.employeurs++;
        if (r.reg.etat && r.reg.etat !== "A") c.cessees++;
      }
    }
  }

  // b) Les sites : une lecture par domaine pour les signaux ET l'e-mail.
  if (domaines.length > 0) {
    const memoire = refaire ? new Map() : lireCache(cacheSites, "domaine");
    const ctx = creerContexteSite(niche, c, dependances);
    await enParallele(domaines, Math.min(8, Math.max(1, paralleles)), async (domaine) => {
      const groupe = parDomaine.get(domaine);
      let r = memoire.get(domaine);
      if (r) {
        c.sites_repris_du_cache++;
      } else {
        let lecture;
        try {
          lecture = await lireSite(groupe.site, ctx);
        } catch {
          lecture = { statut: "injoignable" };
        }
        c.sites_lus++;
        r = { domaine, statut: lecture.statut, signaux: null, email: null, source: null, le };
        if (lecture.statut === "ok") {
          r.signaux = lireSignaux(lecture.pages);
          const email = emailDepuisPages(lecture, ctx);
          r.email = email?.email ?? null;
          r.source = email?.source ?? null;
        }
        if (r.statut !== "injoignable") appendFileSync(cacheSites, `${JSON.stringify(r)}\n`);
      }
      for (const k of groupe.lignes) {
        const ligne = lignes[k];
        if (r.statut === "ok") {
          ligne.site_joignable = "oui";
          ligne.signaux_site = listerSignaux(r.signaux);
          ligne.signaux_date = r.le ?? le;
          if (r.email && (refaire || estVide(ligne.email))) {
            ligne.email = r.email;
            ligne.email_source = r.source ?? "";
            ligne.email_date = r.le ?? le;
          }
        } else if (r.statut === "injoignable") {
          ligne.site_joignable = "non";
          ligne.signaux_site = "";
          ligne.signaux_date = le;
        }
      }
      if (r.statut === "ok") {
        c.sites_joignables++;
        for (const s of ["pixel_meta", "balise_google_ads", "prise_rdv", "agence_creditee"]) if (r.signaux?.[s]) c[s]++;
        if (r.email) c.emails_trouves++;
        else c.sans_email++;
      } else {
        c.sites_non_lus++;
        c[STATUTS_SITE[r.statut] ?? "illisibles"]++;
      }
    });
  }

  const rapport = rapportDuTravail();
  if (registre) {
    rapport.push(
      `Registre : lus ${c.registre_lus}, repris du cache ${c.registre_repris_du_cache}, introuvables ${c.registre_introuvables}, non diffusibles (écartés) ${c.non_diffusibles}, erreurs ${c.registre_erreurs}`,
      `  chiffre d'affaires publié : ${c.avec_ca} ligne(s) ; employeurs : ${c.employeurs} ; cessées (écartées au score) : ${c.cessees}`,
    );
  }
  if (site) {
    rapport.push(
      `Sites : lus ${c.sites_lus}, repris du cache ${c.sites_repris_du_cache}, joignables et lus ${c.sites_joignables}, requêtes ${c.requetes}`,
      `  pixel Meta ${c.pixel_meta} ; balise Google Ads ${c.balise_google_ads} ; prise de rendez-vous ${c.prise_rdv} ; agence créditée ${c.agence_creditee} ; e-mails publiés trouvés ${c.emails_trouves}`,
      `  pas lus : interdit par robots.txt ${c.robots} ; injoignables ${c.injoignables} ; pas une page web ${c.pas_html} ; redirigés vers un autre site ${c.rediriges_ailleurs} ; hors périmètre (réseau social, annuaire, adresse non publique) ${c.hors_perimetre} ; adresse illisible ${c.illisibles}`,
    );
  }
  const chemin = sortie ?? cheminSortie(entree, "enrichi");
  verifierSortie(entree, chemin);
  ecrireTableau(chemin, lignes, colonnes, [
    ...(registre ? ["chiffre_affaires", "ca_annee", "employeur", "etat_registre", "registre_date", "effectif", "date_creation"] : []),
    ...(site ? ["site_joignable", "signaux_site", "signaux_date", "email", "email_source", "email_date"] : []),
  ]);
  rapport.push(`Écrit : ${cheminAffiche(chemin)}`, "Étape suivante : score.mjs sur ce fichier (la grille lit ces colonnes).");
  return { code: 0, lignes: rapport, compteurs: c };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--sortie": "texte",
      "--limite": "entier",
      "--paralleles": "entier",
      "--sans-registre": "booleen",
      "--sans-site": "booleen",
      "--refaire": "booleen",
      "--essai": "booleen",
      "--dossier": "texte",
      "--config": "texte",
    });
    if (options.aide || positionnels.length !== 1) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    if (options.sansRegistre && options.sansSite) throw new ErreurSourcing("--sans-registre et --sans-site ensemble : il ne reste rien à faire.");
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const r = await executer({
      niche,
      entree: resolve(positionnels[0]),
      sortie: options.sortie ? resolve(options.sortie) : undefined,
      dossier: dossierDonnees(options.dossier),
      limite: options.limite ?? null,
      paralleles: options.paralleles ?? 4,
      registre: !options.sansRegistre,
      site: !options.sansSite,
      refaire: Boolean(options.refaire),
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
