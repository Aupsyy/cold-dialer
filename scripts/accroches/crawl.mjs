// Étape 2 des accroches : lire le site public de chaque entreprise de donnees/accroches/a-crawler.json.
//
//   node scripts/accroches/crawl.mjs [--limite N] [--paralleles 4] [--refaire-erreurs] [--dossier D] [--config C]
//
// Pour chaque site : robots.txt d'abord (lu et respecté : groupe de notre robot, sinon « * »), puis la page d'accueil, puis jusqu'à
// 5 pages internes probables (réalisations, projets, à propos, équipe, contact, et les mots indices de config.accroche.motsIndices) :
// 6 pages au plus. Une requête par seconde au plus par domaine (davantage si robots.txt le demande), 10 s d'attente au plus, 1 Mo au
// plus par page, HTTPS puis HTTP, User-Agent = config.marque.userAgent. Aucun JavaScript n'est exécuté, aucune image n'est lue.
// Sortie : donnees/accroches/crawl.jsonl, une ligne par fiche { id, site, origine, pages: [{ url, titre, description, titres, texte,
// lu_le }], robots, compteurs } ou { id, site, erreur }. Reprise : une fiche déjà lue n'est jamais relue (--refaire-erreurs relit
// celles en erreur). Un « site » qui est en fait un réseau social (jamais LinkedIn), un annuaire ou une carte n'est jamais lu, ni une
// adresse dont le nom mène, par le DNS, à une adresse non publique (réseau local, bouclage…), ni un port autre que 80 et 443 : ces
// contrôles (lib/hotes.mjs) précèdent CHAQUE requête, redirections comprises. La console n'affiche que des compteurs.

import { entier, lireOptions } from "./lib/args.mjs";
import { creerCadence, domaine, horlogeReelle } from "./lib/cadence.mjs";
import { CONFIG_PAR_DEFAUT, dossierDeTravail, fichiers } from "./lib/chemins.mjs";
import { chargerConfig, jetonRobot } from "./lib/config.mjs";
import { ajouterLigne, dernieresParId, lireJson, lireJsonl } from "./lib/fichiers.mjs";
import { adresseLisible, adressesDeDepart, creerControleHotes, hoteExclu } from "./lib/hotes.mjs";
import { DELAI_MS, TAILLE_MAX, telecharger } from "./lib/http.mjs";
import { lancerSiPrincipal } from "./lib/lancer.mjs";
import { TAILLE_MAX_ROBOTS, cheminAutorise, lireRobotsDistant } from "./lib/robots.mjs";
import { analyserHtml, memeFamille, mots } from "./lib/texte.mjs";

// Les gardes d'adresse vivent dans lib/hotes.mjs (partagées avec scripts/sourcing/emails.mjs) ; réexportées pour les appelants du crawl.
export { DOMAINES_EXCLUS, HOTES_EXCLUS, adressesDeDepart, hoteExclu, hotePublic } from "./lib/hotes.mjs";

export const MAX_PAGES = 6;
/** Pages tentées au plus par site, en plus de l'accueil (une page en erreur ne bloque pas les suivantes, sans boucler sans fin). */
export const MAX_ESSAIS = 12;
export const TEXTE_MAX_PAGE = 15_000;
export const MAX_REDIRECTIONS = 5;
export const CRAWL_DELAY_MAX_S = 60;
export const PARALLELES = 4;
export { TAILLE_MAX_ROBOTS };

/** Les pages internes probables, par famille (chaque famille compte une fois par lien). Les mots indices de la config valent 3. */
export const PAGES_PROBABLES = [
  { poids: 5, projets: true, cles: ["projet", "realisation", "reference", "portfolio", "galerie", "chantier", "travaux", "creations"] },
  {
    poids: 4,
    cles: ["a propos", "qui sommes nous", "histoire", "entreprise", "societe", "equipe", "savoir faire", "presentation", "about", "atelier", "agence"],
  },
  { poids: 2, cles: ["services", "prestations", "activites", "metiers", "expertises", "specialites", "competences"] },
  { poids: 1, cles: ["contact", "nous contacter", "acces", "coordonnees"] },
];
const POIDS_INDICE = 3;
const BONUS_SOUS_PAGE = 4;

/** Jamais lues : pages légales et techniques, comptes, paniers, flux, recherche (mots exacts, ou suites de mots). */
export const CLES_EXCLUES = [
  "mentions legales", "mention legale", "cgv", "cgu", "conditions generales", "confidentialite", "cookies", "cookie", "rgpd",
  "donnees personnelles", "plan du site", "sitemap", "login", "connexion", "mon compte", "account", "panier", "cart", "checkout",
  "commande", "wp admin", "wp login", "wp json", "feed", "rss", "recherche", "search", "tag", "author", "auteur", "replytocom",
  "share", "print", "imprimer", "calendar", "agenda",
];
const LANGUES_ETRANGERES = /^\/(en|de|es|it|nl|pt|pl|ru|zh|ja|ar)(\/|$)/i;
const FICHIERS =
  /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?|pdf|zip|rar|7z|gz|docx?|xlsx?|pptx?|odt|ods|odp|mp3|mp4|m4a|wav|avi|mov|webm|css|js|json|xml|txt|ics|vcf|woff2?|ttf|eot|apk|exe|dmg)$/i;

// ---------------------------------------------------------------------------------------------------------------------------------
// Adresses
// ---------------------------------------------------------------------------------------------------------------------------------

function sansWww(hote) {
  return hote.toLowerCase().replace(/^www\./, "");
}

/** La clé d'une page : sans « www. », sans ancre, sans barre finale (« /a-propos/ » et « /a-propos » sont la même page). */
export function cleUrl(url) {
  const u = new URL(url);
  const chemin = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
  return `${sansWww(u.hostname)}${u.port ? `:${u.port}` : ""}${chemin}${u.search}`;
}

function motsDuLien(url, texte) {
  const u = new URL(url);
  let chemin = `${u.pathname} ${u.search}`;
  try {
    chemin = decodeURIComponent(chemin);
  } catch {
    // chemin mal encodé : lu tel quel
  }
  return mots(`${chemin} ${texte ?? ""}`);
}

function contientCle(liste, phrase, cle, famille) {
  if (cle.includes(" ")) return phrase.includes(` ${cle} `);
  return liste.some((m) => (famille ? memeFamille(m, cle) : m === cle));
}

/** Les mots indices de la config, normalisés (« Clôture » → « cloture », « espaces verts » reste une suite de deux mots). */
export function indicesNormalises(motsIndices) {
  return [...new Set((motsIndices ?? []).map((m) => mots(m).join(" ")).filter(Boolean))];
}

/** Le score d'un lien interne (0 : pas une page probable) et s'il mène à une page de réalisations. */
export function scoreLien(lien, indices) {
  const liste = motsDuLien(lien.url, lien.texte);
  const phrase = ` ${liste.join(" ")} `;
  let score = 0;
  let projets = false;
  for (const famille of PAGES_PROBABLES) {
    if (famille.cles.some((c) => contientCle(liste, phrase, c, true))) {
      score += famille.poids;
      if (famille.projets) projets = true;
    }
  }
  if (indices.some((c) => contientCle(liste, phrase, c, true))) score += POIDS_INDICE;
  return { score, projets };
}

/** Vrai pour une page à ne jamais lire (légale, technique, fichier, autre langue). */
export function lienExclu(url, texte = "") {
  const u = new URL(url);
  if (FICHIERS.test(u.pathname) || LANGUES_ETRANGERES.test(u.pathname)) return true;
  const liste = motsDuLien(url, texte);
  const phrase = ` ${liste.join(" ")} `;
  return CLES_EXCLUES.some((c) => contientCle(liste, phrase, c, false));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture d'un site
// ---------------------------------------------------------------------------------------------------------------------------------

/** robots.txt d'une origine (lib/robots.mjs : chaque saut contrôlé et cadencé ; 429 et 5xx ferment le site). */
function lireRobots(origine, ctx, compteurs) {
  return lireRobotsDistant(origine, {
    adresseSure: ctx.adresseSure,
    attendreTour: (url) => ctx.cadence.attendreTour(domaine(url)),
    compter: () => {
      compteurs.requetes++;
    },
    http: ctx.http,
    jeton: ctx.jeton,
  });
}

/** robots.txt d'une origine, lu une seule fois par passage (plusieurs fiches peuvent partager un hôte). */
function robotsDe(origine, ctx, compteurs) {
  if (!ctx.robots) return lireRobots(origine, ctx, compteurs);
  let promesse = ctx.robots.get(origine);
  if (!promesse) {
    promesse = lireRobots(origine, ctx, compteurs);
    ctx.robots.set(origine, promesse);
  }
  return promesse;
}

function refusDeRobots(robots) {
  if (robots.etat === "indisponible") return "robots_indisponible";
  if (robots.delai !== null && robots.delai > CRAWL_DELAY_MAX_S) return "robots_delai_trop_long";
  return null;
}

function appliquerDelai(etat, ctx) {
  if (etat.robots.delai) ctx.cadence.ralentir(domaine(etat.origine), etat.robots.delai * 1000);
}

/** Lit une page en suivant ses redirections ; l'accueil peut changer d'origine (son robots.txt est alors relu). */
async function lirePage(url, etat, ctx, compteurs, { accueil = false } = {}) {
  let courante = url;
  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
    const u = new URL(courante);
    if (u.origin !== etat.origine) {
      if (!accueil || !adresseLisible(u)) return { erreur: "hors_site" };
      const robots = await robotsDe(u.origin, ctx, compteurs);
      if (!robots.joignable) return { erreur: "injoignable" };
      const refus = refusDeRobots(robots);
      if (refus) return { erreur: refus };
      etat.origine = u.origin;
      etat.robots = robots;
      appliquerDelai(etat, ctx);
    }
    if (!cheminAutorise(etat.robots.regles, u.pathname + u.search)) {
      compteurs.refusRobots++;
      return { erreur: "robots" };
    }
    if (!(await ctx.adresseSure(u))) return { erreur: "adresse_non_publique" };
    await ctx.cadence.attendreTour(domaine(courante));
    compteurs.requetes++;
    const r = await telecharger(courante, ctx.http);
    if (r.redirection !== undefined) {
      if (!r.redirection) return { erreur: "redirection" };
      courante = r.redirection;
      continue;
    }
    if (r.erreur) {
      compteurs.erreurs++;
      return { erreur: r.erreur };
    }
    return { url: courante, tronquee: r.tronque, ...analyserHtml(r.texte, courante) };
  }
  return { erreur: "redirections" };
}

function tronquer(texte, max) {
  if (texte.length <= max) return texte;
  const coupe = texte.lastIndexOf("\n", max);
  return texte.slice(0, coupe > max / 2 ? coupe : max);
}

function pageSortie(page, luLe) {
  return {
    url: page.url,
    titre: page.titre.slice(0, 300),
    description: page.description.slice(0, 500),
    titres: page.titres.slice(0, 40),
    texte: tronquer(page.texte, TEXTE_MAX_PAGE),
    lu_le: luLe,
    ...(page.tronquee ? { tronquee: true } : {}),
  };
}

function ajouterCandidats(candidats, page, etat, vues, ctx, prefixeListe, ordre) {
  const hote = sansWww(new URL(etat.origine).hostname);
  for (const lien of page.liens) {
    const u = new URL(lien.url);
    if (sansWww(u.hostname) !== hote || (u.port && u.port !== new URL(etat.origine).port)) continue;
    const url = `${etat.origine}${u.pathname}${u.search}`;
    const cle = cleUrl(url);
    if (vues.has(cle) || (u.pathname === "/" && !u.search) || lienExclu(url, lien.texte)) continue;
    const note = scoreLien({ url, texte: lien.texte }, ctx.indices);
    const prefixe = prefixeListe ? prefixeListe.replace(/\/?$/, "/") : null;
    const bonus = prefixe && u.pathname.startsWith(prefixe) && u.pathname.length > prefixe.length ? BONUS_SOUS_PAGE : 0;
    const score = note.score + bonus;
    if (score < 1) continue;
    const existant = candidats.get(cle);
    if (!existant) candidats.set(cle, { cle, url, score, projets: note.projets, ordre: ordre.n++ });
    else if (existant.score < score) Object.assign(existant, { score, projets: existant.projets || note.projets });
  }
}

function meilleurCandidat(candidats) {
  let meilleur = null;
  for (const c of candidats.values()) {
    if (!meilleur || c.score > meilleur.score || (c.score === meilleur.score && c.ordre < meilleur.ordre)) meilleur = c;
  }
  return meilleur;
}

/**
 * Lit un site : robots.txt, accueil, puis les pages probables (6 pages au plus).
 * @param {{ id: string, site: string }} fiche
 * @param {object} ctx { cadence, horloge, http: { fetch, userAgent, delaiMs, tailleMax }, jeton, indices, maxPages }
 */
export async function crawlerSite(fiche, ctx) {
  const compteurs = { requetes: 0, refusRobots: 0, erreurs: 0 };
  const base = { id: fiche.id, site: fiche.site };
  const departs = adressesDeDepart(fiche.site);
  if (departs.length === 0) return { ...base, erreur: "adresse_invalide", compteurs };
  if (hoteExclu(new URL(departs[0]).hostname)) return { ...base, erreur: "site_hors_perimetre", compteurs };
  if (!(await ctx.adresseSure(departs[0]))) return { ...base, erreur: "adresse_non_publique", compteurs };

  let etat = null;
  for (const depart of departs) {
    const origine = new URL(depart).origin;
    const robots = await robotsDe(origine, ctx, compteurs);
    if (!robots.joignable) continue;
    etat = { depart, origine, robots };
    break;
  }
  if (!etat) return { ...base, erreur: "site_injoignable", compteurs };
  const refus = refusDeRobots(etat.robots);
  if (refus) return { ...base, erreur: refus, compteurs };
  appliquerDelai(etat, ctx);

  const accueil = await lirePage(etat.depart, etat, ctx, compteurs, { accueil: true });
  if (accueil.erreur) {
    return { ...base, erreur: accueil.erreur === "robots" ? "robots_interdit" : `accueil_${accueil.erreur}`, compteurs };
  }
  const luLe = () => new Date(ctx.horloge.maintenant()).toISOString();
  const pages = [pageSortie(accueil, luLe())];
  const vues = new Set([cleUrl(etat.depart), cleUrl(accueil.url)]);
  const candidats = new Map();
  const ordre = { n: 0 };
  ajouterCandidats(candidats, accueil, etat, vues, ctx, null, ordre);

  const maxPages = Math.min(ctx.maxPages ?? MAX_PAGES, MAX_PAGES);
  let essais = 0;
  while (pages.length < maxPages && essais < MAX_ESSAIS) {
    const suivant = meilleurCandidat(candidats);
    if (!suivant) break;
    candidats.delete(suivant.cle);
    vues.add(suivant.cle);
    const page = await lirePage(suivant.url, etat, ctx, compteurs);
    if (page.erreur === "robots") continue;
    essais++;
    if (page.erreur) continue;
    const cle = cleUrl(page.url);
    if (cle !== suivant.cle && vues.has(cle)) continue;
    vues.add(cle);
    pages.push(pageSortie(page, luLe()));
    ajouterCandidats(candidats, page, etat, vues, ctx, suivant.projets ? new URL(page.url).pathname : null, ordre);
  }

  return {
    ...base,
    origine: etat.origine,
    pages,
    robots: { etat: etat.robots.etat, groupe: etat.robots.groupe, delai: etat.robots.delai },
    compteurs,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plusieurs sites
// ---------------------------------------------------------------------------------------------------------------------------------

/** Le contexte d'un crawl : config, cadence partagée, fetch, horloge et résolveur DNS injectables (les tests n'ouvrent rien). */
export function creerContexte({ userAgent, motsIndices, fetch = globalThis.fetch, horloge = horlogeReelle(), resoudre, delaiMs = DELAI_MS, tailleMax = TAILLE_MAX, maxPages = MAX_PAGES, intervalleMs }) {
  return {
    adresseSure: creerControleHotes(resoudre ? { resoudre } : {}),
    cadence: creerCadence({ horloge, ...(intervalleMs ? { intervalleMs } : {}) }),
    robots: new Map(),
    horloge,
    http: { fetch, userAgent, delaiMs, tailleMax },
    jeton: jetonRobot(userAgent),
    indices: indicesNormalises(motsIndices),
    maxPages,
  };
}

function cleSite(site) {
  const departs = adressesDeDepart(site);
  return departs.length ? cleUrl(departs[0]) : `invalide:${site}`;
}

/**
 * Lit les sites des fiches (plusieurs en parallèle, la cadence par domaine reste partagée) et ajoute une ligne par fiche à `sortie`.
 * Deux fiches au même site ne le font lire qu'une fois.
 * @returns {Promise<{ sites: number, lus: number, pages: number, requetes: number, refusRobots: number, erreurs: Record<string, number> }>}
 */
export async function crawler(fiches, ctx, { sortie, paralleles = PARALLELES, progression = () => {} }) {
  const bilan = { sites: fiches.length, lus: 0, pages: 0, requetes: 0, refusRobots: 0, erreurs: {} };
  const occurrences = new Map();
  for (const f of fiches) occurrences.set(cleSite(f.site), (occurrences.get(cleSite(f.site)) ?? 0) + 1);
  const partages = new Map();
  let suivant = 0;
  let faits = 0;

  const travailleur = async () => {
    while (suivant < fiches.length) {
      const fiche = fiches[suivant++];
      const cle = cleSite(fiche.site);
      let promesse = partages.get(cle);
      const nouveau = !promesse;
      if (nouveau) {
        promesse = crawlerSite(fiche, ctx).catch(() => ({ erreur: "interne", compteurs: { requetes: 0, refusRobots: 0, erreurs: 1 } }));
        if (occurrences.get(cle) > 1) partages.set(cle, promesse);
      }
      const r = await promesse;
      ajouterLigne(sortie, { ...r, id: fiche.id, site: fiche.site });
      if (nouveau) {
        bilan.requetes += r.compteurs?.requetes ?? 0;
        bilan.refusRobots += r.compteurs?.refusRobots ?? 0;
      }
      if (r.erreur) bilan.erreurs[r.erreur] = (bilan.erreurs[r.erreur] ?? 0) + 1;
      else {
        bilan.lus++;
        bilan.pages += r.pages.length;
      }
      progression(++faits, fiches.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(paralleles, fiches.length)) }, travailleur));
  return bilan;
}

/** Les fiches lisibles d'a-crawler.json : un identifiant et un site. */
export function fichesValides(liste) {
  if (!Array.isArray(liste)) throw new Error("a-crawler.json doit contenir un tableau de fiches { id, site }.");
  const valides = [];
  const vus = new Set();
  let ignorees = 0;
  for (const f of liste) {
    const id = typeof f?.id === "string" ? f.id.trim() : "";
    if (!id || id.length > 100 || vus.has(id) || adressesDeDepart(f.site).length === 0) {
      ignorees++;
      continue;
    }
    vus.add(id);
    valides.push({ id, site: String(f.site).trim() });
  }
  return { valides, ignorees };
}

const AIDE = `Lit le site public de chaque fiche de donnees/accroches/a-crawler.json (robots.txt respecté, 1 requête par seconde par domaine).
  --limite N          ne lire que N sites (essai)
  --paralleles N      sites lus en même temps (défaut ${PARALLELES}, 16 au plus ; la cadence par domaine ne change pas)
  --refaire-erreurs   relire les sites en erreur au passage précédent
  --dossier D         dossier de travail (défaut donnees/accroches)
  --config C          configuration (défaut config/niche.json)`;

export async function principal(argv, { fetch = globalThis.fetch, horloge = horlogeReelle(), resoudre, journal = console.log } = {}) {
  const options = lireOptions(argv, { drapeaux: ["refaire-erreurs", "aide"], valeurs: ["limite", "paralleles", "dossier", "config"] });
  if (options.aide) {
    journal(AIDE);
    return 0;
  }
  const f = fichiers(dossierDeTravail(options.dossier));
  const { niche } = await chargerConfig(options.config ?? CONFIG_PAR_DEFAUT);
  if (!niche.accroche.actif) throw new Error("Accroches désactivées dans la configuration (accroche.actif : false) : rien n'est lu.");

  const { valides, ignorees } = fichesValides(lireJson(f.aCrawler));
  const { lignes, illisibles } = lireJsonl(f.crawl);
  const derniers = dernieresParId(lignes);
  const restantes = valides.filter((fi) => {
    const d = derniers.get(fi.id);
    return !d || (options["refaire-erreurs"] && d.erreur);
  });
  const limite = entier(options, "limite", { defaut: restantes.length, min: 1 });
  const paralleles = entier(options, "paralleles", { defaut: PARALLELES, min: 1, max: 16 });
  const aLire = restantes.slice(0, limite);

  journal(`Fiches : ${valides.length} (ignorées, sans site lisible : ${ignorees}) ; déjà lues : ${valides.length - restantes.length} ; à lire maintenant : ${aLire.length}.`);
  if (illisibles) journal(`Lignes illisibles dans crawl.jsonl (arrêt brutal ?) : ${illisibles}, ignorées.`);
  if (aLire.length === 0) return 0;

  const ctx = creerContexte({ userAgent: niche.marque.userAgent, motsIndices: niche.accroche.motsIndices, fetch, horloge, resoudre });
  const pas = Math.max(10, Math.round(aLire.length / 10));
  const bilan = await crawler(aLire, ctx, {
    sortie: f.crawl,
    paralleles,
    progression: (n, total) => {
      if (n % pas === 0 && n < total) journal(`  … ${n}/${total} sites`);
    },
  });
  const erreurs = Object.entries(bilan.erreurs)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code} ${n}`)
    .join(", ");
  journal(`Sites lus : ${bilan.lus}/${bilan.sites} ; pages : ${bilan.pages} ; requêtes : ${bilan.requetes} ; pages fermées par robots.txt : ${bilan.refusRobots}.`);
  if (erreurs) journal(`Sites non lus : ${erreurs}.`);
  return 0;
}

lancerSiPrincipal(import.meta.url, principal);
