// Les e-mails PUBLICS des entreprises, lus sur leur propre site : la page d'accueil, puis au plus 3 pages liées depuis l'accueil
// (contact, mentions légales, à propos). Rien n'est deviné ni construit : une adresse n'est gardée que si elle est écrite sur le site.
//
//   - Les mêmes garde-fous que le crawl des accroches (scripts/accroches/lib : hotes.mjs, robots.mjs, http.mjs), avant CHAQUE requête,
//     redirections comprises (5 au plus, suivies à la main) : jamais un réseau social (LinkedIn compris), un annuaire ou une carte,
//     jamais une adresse IP, un réseau local ou un nom qui y mène par le DNS, jamais un port autre que 80 et 443, jamais un autre
//     domaine que celui du site ; 10 s d'attente et 1 Mo au plus par page (lecture en flux, arrêtée au-delà).
//   - robots.txt est lu et respecté (le groupe du robot de config.marque.userAgent, version comprise, sinon « * ») ; un site dont le
//     robots.txt ne répond pas (erreur serveur, trop de requêtes) n'est pas lu ; un Crawl-delay de plus de 30 secondes non plus.
//   - Une requête par seconde au plus par domaine (davantage si robots.txt le demande) ; User-Agent : config.marque.userAgent.
//   - Adresses gardées : celles du domaine du site, et celles d'une messagerie grand public (gmail.com, orange.fr…) publiées sur le
//     site ; jamais celles d'un autre domaine (l'agence qui a fait le site, un partenaire). Une adresse masquée simplement
//     (« contact [at] domaine [dot] fr », « (at) », « arobase ») n'est acceptée que si son domaine est celui du site. Une adresse
//     protégée par un script n'est pas décodée : le site a choisi de la cacher aux robots.
//   - Adresses écartées : les adresses de service (ne-pas-répondre, webmaster, RGPD, ressources humaines, comptabilité, presse…).
//   - Choix : une adresse du domaine du site d'abord, en préférant les débuts d'adresse de config.sources.prefixesEmail (contact,
//     bonjour…) dans leur ordre ; sinon une messagerie grand public.
//   - Pour chaque e-mail : la page où il est écrit (email_source) et la date (email_date).
//
// Usage : node scripts/sourcing/emails.mjs <entree.csv> [--sortie <fichier.csv>] [--limite N] [--paralleles N] [--essai]
//                                          [--dossier <chemin>] [--config <niche.json>]
//   Traite les lignes qui ont un site et pas d'e-mail ; écrit <entree>-emails.csv. Reprise : donnees/cache/emails.jsonl garde le
//   résultat de chaque domaine déjà lu (supprime-le pour tout relire).
//   --limite N : les N premiers sites. --paralleles N : sites lus en même temps (4 par défaut, 8 au plus ; toujours une requête par
//   seconde par domaine). --essai : 5 sites au plus (ou --limite), compteurs seulement, rien n'est écrit (ni CSV ni cache).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { jetonRobot } from "../accroches/lib/config.mjs";
import { EMAIL_TEXTE, MASQUE, POINT } from "../accroches/lib/coordonnees.mjs";
import { adresseLisible, creerControleHotes } from "../accroches/lib/hotes.mjs";
import { DELAI_MS, TAILLE_MAX, telecharger } from "../accroches/lib/http.mjs";
import { cheminAutorise, lireRobotsDistant } from "../accroches/lib/robots.mjs";
import { liensDePage, remplacerBalises, retirerBlocs, retirerCommentaires } from "../accroches/lib/texte.mjs";
import {
  afficher,
  cheminAffiche,
  attendreVraiment,
  chargerNiche,
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
  messageSur,
  normaliserEmail,
  normaliserSite,
  verifierSortie,
} from "./lib.mjs";

const USAGE = [
  "Usage : node scripts/sourcing/emails.mjs <entree.csv> [--sortie <fichier.csv>] [--limite N] [--paralleles N] [--essai] [--dossier <chemin>]",
  "  Cherche l'e-mail public de chaque entreprise sur son site (accueil, contact, mentions légales) : rien n'est deviné.",
  "  --sortie      le fichier écrit (défaut : <entree>-emails.csv)",
  "  --limite N    les N premiers sites seulement",
  "  --paralleles  sites lus en même temps (4 par défaut, 8 au plus)",
  "  --essai       5 sites au plus, compteurs seulement, rien n'est écrit",
].join("\n");

export const PAGES_MAX = 4;
export const DELAI_ROBOTS_MAX_S = 30;
export const MAX_REDIRECTIONS = 5;
/** Une page web : HTML, XHTML ou XML (les autres types ne sont pas lus). */
const TYPES_PAGE = /^(text\/html|application\/xhtml\+xml|application\/xml|text\/xml)\b/i;

/** Les messageries grand public : une adresse chez elles est gardée seulement si elle est publiée sur le site de l'entreprise. */
export const DOMAINES_MESSAGERIE = [
  "gmail.com", "googlemail.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr", "numericable.fr",
  "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr", "msn.com", "yahoo.com", "yahoo.fr", "icloud.com",
  "me.com", "aol.com", "gmx.fr", "gmx.com", "proton.me", "protonmail.com", "skynet.be", "bluewin.ch", "videotron.ca", "sympatico.ca",
];

/** Les adresses de service, jamais retenues pour prospecter. */
const ADRESSES_SERVICE =
  /^(?:no-?reply|noreply|ne-?pas-?repondre|donotreply|do-not-reply|mailer-daemon|postmaster|hostmaster|abuse|webmaster|admin|administrat\w*|root|rgpd|dpo|gdpr|privacy|confidentialite|donnees-?personnelles|rh|drh|recrutement|emploi|jobs?|carrieres?|careers?|candidatures?|stages?|alternance|compta|comptabilite|factur\w*|invoices?|billing|presse|press|media|medias|newsletter|unsubscribe|desinscription|wordpress|wix|example|exemple|email|e-mail|votre-?\w*|your-?\w*|nom|name|prenom|user|test|xxx)$/;
const FICHIER = /\.(?:png|jpe?g|gif|svg|webp|avif|bmp|ico|css|js|json|xml|pdf|zip|mp4|webm)$/i;

const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", commat: "@", period: ".", lbrack: "[", rbrack: "]", lpar: "(", rpar: ")" };
function caractere(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

/** Les entités HTML courantes décodées (&#64;, &#x40;, &commat;, &amp;…). */
export function decoderEntites(html) {
  return String(html ?? "")
    .replace(/&#(\d{1,7});/g, (_, n) => caractere(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => caractere(parseInt(n, 16)))
    .replace(/&([a-z]{2,8});/gi, (m, nom) => ENTITES[nom.toLowerCase()] ?? m);
}

/**
 * Le texte visible d'une page : sans commentaires, scripts ni styles (un élément jamais fermé court jusqu'à la fin), sans balises ;
 * entités décodées. Linéaire (les outils de scripts/accroches/lib/texte.mjs) : une page hostile ne bloque pas le script.
 */
export function texteDePage(html) {
  const sansScripts = retirerBlocs(retirerCommentaires(String(html ?? "")), ["script", "style"], { jusquALaFin: true });
  return decoderEntites(remplacerBalises(sansScripts, " ")).replace(/\s+/g, " ");
}

/**
 * Vrai si l'hôte (d'un e-mail, d'un lien) est le domaine du site ou l'un de ses sous-domaines (www ignoré). Jamais le domaine parent :
 * pour « entreprise.plateforme.example », une adresse « @plateforme.example » est celle de la plateforme, pas de l'entreprise.
 */
export function memeDomaine(hote, domaineSite) {
  const x = String(hote ?? "").toLowerCase().replace(/^www\./, "");
  const y = String(domaineSite ?? "").toLowerCase().replace(/^www\./, "");
  return x !== "" && y !== "" && (x === y || x.endsWith(`.${y}`));
}

// Les motifs d'e-mail (en clair et masqué) sont ceux de scripts/accroches/lib/coordonnees.mjs : le compactage des accroches s'en sert
// pour ne jamais envoyer une adresse à l'agent.
const POINTS = new RegExp(POINT, "gi");

/**
 * Les adresses écrites dans une page : liens mailto:, texte visible, et adresses masquées simplement (seulement si leur domaine est
 * celui du site). Renvoie [{ email, masque }] sans doublon, dans l'ordre de la page.
 */
export function extraireEmails(html, { domaineSite }) {
  const trouves = new Map();
  const ajouter = (email, masque) => {
    if (email && !trouves.has(email)) trouves.set(email, { email, masque });
  };
  for (const m of String(html ?? "").matchAll(/href\s*=\s*["']\s*mailto:([^"'?#]+)/gi)) {
    let valeur = m[1];
    try {
      valeur = decodeURIComponent(valeur);
    } catch {
      // un pourcentage isolé : on garde la valeur telle quelle
    }
    for (const morceau of decoderEntites(valeur).split(/[,;]/)) ajouter(normaliserEmail(morceau), false);
  }
  const texte = texteDePage(html);
  // Les motifs ne tournent que sur un texte qui peut en contenir (un « @ », un « at » ou « arobase ») : une page sans adresse se lit
  // sans recherche ; sinon le coût reste linéaire (64 pas au plus par caractère, motifs bornés).
  if (texte.includes("@")) for (const m of texte.matchAll(EMAIL_TEXTE)) ajouter(normaliserEmail(m[0]), false);
  if (!/(?:\bat|arobase|@)/i.test(texte)) return [...trouves.values()];
  for (const m of texte.matchAll(MASQUE)) {
    const domaine = m[2].replace(POINTS, ".").replace(/\s+/g, "");
    const email = normaliserEmail(`${m[1]}@${domaine}`);
    if (email && memeDomaine(email.split("@")[1], domaineSite)) ajouter(email, true);
  }
  return [...trouves.values()];
}

/**
 * L'adresse à garder parmi celles trouvées sur le site ([{ email, masque, page }]) : { email, page } ou null. Jamais une adresse d'un
 * autre domaine, jamais une adresse de service ; d'abord le domaine du site (débuts d'adresse de la config en premier), puis une
 * messagerie grand public.
 */
export function choisirEmail(trouves, { domaineSite, prefixes = [], messageries = DOMAINES_MESSAGERIE }) {
  const candidats = [];
  trouves.forEach((t, ordre) => {
    const [local, domaine] = t.email.split("@");
    if (!domaine || ADRESSES_SERVICE.test(local) || FICHIER.test(t.email) || t.email.length > 80) return;
    const surSite = memeDomaine(domaine, domaineSite);
    if (!surSite && (t.masque || !messageries.includes(domaine))) return;
    const prefixe = surSite ? prefixes.indexOf(local) : -1;
    candidats.push({ ...t, rang: [surSite ? 0 : 1, prefixe >= 0 ? prefixe : prefixes.length, ordre] });
  });
  candidats.sort((a, b) => a.rang[0] - b.rang[0] || a.rang[1] - b.rang[1] || a.rang[2] - b.rang[2]);
  return candidats.length > 0 ? { email: candidats[0].email, page: candidats[0].page } : null;
}

const PRIORITES = [
  /contact|joindre|coordonn|ecrire|devis/i,
  /mention|legal|l%C3%A9gal|légal|impressum|imprint/i,
  /propos|qui-sommes|qui-nous|about|equipe|agence|societe|entreprise|atelier/i,
];

/**
 * Les liens utiles d'une page (contact, mentions légales, à propos), sur le même site, du plus utile au moins utile. Les liens sont
 * lus par liensDePage (scripts/accroches/lib/texte.mjs) : en un seul passage, contenu borné, adresses http(s) absolues sans ancre.
 */
export function liensUtiles(html, base, domaineSite) {
  const vus = new Set([String(base).replace(/#.*$/, "")]);
  const liens = [];
  for (const lien of liensDePage(retirerBlocs(retirerCommentaires(String(html ?? "")), ["script", "style"], { jusquALaFin: true }), base)) {
    const url = new URL(lien.url);
    if (!memeDomaine(url.hostname, domaineSite) || FICHIER.test(url.pathname) || vus.has(url.href)) continue;
    const texte = `${decodeURIComponentSur(url.pathname)} ${lien.texte}`;
    const priorite = PRIORITES.findIndex((re) => re.test(texte));
    if (priorite < 0) continue;
    vus.add(url.href);
    liens.push({ url: url.href, priorite, ordre: liens.length });
  }
  return liens.sort((a, b) => a.priorite - b.priorite || a.ordre - b.ordre).map((l) => l.url);
}

function decodeURIComponentSur(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Les options de téléchargement (lib/http.mjs) : délai, User-Agent, fetch injectable. */
function http(ctx, plus) {
  return { fetch: ctx.fetch, userAgent: ctx.userAgent, delaiMs: ctx.delaiMs ?? DELAI_MS, ...plus };
}

/** robots.txt d'une origine (scripts/accroches/lib/robots.mjs, le même que le crawl des accroches : chaque saut contrôlé et cadencé). */
function lireRobots(origine, ctx) {
  return lireRobotsDistant(origine, {
    adresseSure: ctx.adresseSure,
    attendreTour: (url) => ctx.patienter(new URL(url).host),
    compter: () => {
      ctx.compteurs.requetes++;
    },
    http: http(ctx, {}),
    jeton: ctx.jeton,
  });
}

function robotsPour(origine, ctx) {
  let promesse = ctx.robots.get(origine);
  if (!promesse) {
    promesse = lireRobots(origine, ctx);
    ctx.robots.set(origine, promesse);
  }
  return promesse;
}

/**
 * Une page du site, si robots.txt la permet, en suivant 5 redirections au plus : à CHAQUE saut, l'adresse est contrôlée (même domaine
 * que le site, hôte public, DNS, port 80 ou 443) avant d'être demandée, puis robots.txt et la cadence de son origine.
 * @returns {Promise<{ statut: "ok", url: string, html: string } | { statut: "robots" | "injoignable" | "pas_html" | "illisible" | "redirige_ailleurs" | "hors_perimetre" }>}
 */
export async function lirePage(adresse, ctx, domaineSite) {
  let courante = adresse;
  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
    let u;
    try {
      u = new URL(courante);
    } catch {
      return { statut: "illisible" };
    }
    if (!adresseLisible(u) || !memeDomaine(u.hostname, domaineSite)) return { statut: saut === 0 ? "hors_perimetre" : "redirige_ailleurs" };
    if (!(await ctx.adresseSure(u))) return { statut: "injoignable" };
    const robots = await robotsPour(u.origin, ctx);
    if (!robots.joignable) return { statut: "injoignable" };
    if (robots.etat === "indisponible" || (robots.delai ?? 0) > DELAI_ROBOTS_MAX_S || !cheminAutorise(robots.regles, `${u.pathname}${u.search}`)) {
      return { statut: "robots" };
    }
    await ctx.patienter(u.host, Math.max(1000, (robots.delai ?? 0) * 1000));
    ctx.compteurs.requetes++;
    const r = await telecharger(u.href, http(ctx, { types: TYPES_PAGE, tailleMax: TAILLE_MAX }));
    if (r.redirection !== undefined) {
      if (!r.redirection) return { statut: "injoignable" };
      courante = r.redirection;
      continue;
    }
    if (r.erreur === "type") return { statut: "pas_html" };
    if (r.erreur || r.statut < 200 || r.statut >= 300) return { statut: "injoignable" };
    return { statut: "ok", url: u.href, html: r.texte };
  }
  return { statut: "injoignable" };
}

/**
 * L'e-mail public d'un site : { statut: "trouve", email, source } ou { statut } (aucun, robots, injoignable, pas_html,
 * redirige_ailleurs, hors_perimetre, site_illisible). ctx : { fetch, patienter, adresseSure, userAgent, jeton, prefixes, messageries,
 * robots (Map), compteurs, delaiMs }.
 */
export async function chercherEmailSurSite(site, ctx) {
  const url = normaliserSite(site);
  if (!url) return { statut: "site_illisible" };
  const depart = new URL(url);
  const domaineSite = depart.hostname.replace(/^www\./, "");
  const accueil = await lirePage(depart.href, ctx, domaineSite);
  if (accueil.statut !== "ok") return { statut: accueil.statut };
  const pages = [accueil];
  for (const lien of liensUtiles(accueil.html, accueil.url, domaineSite).slice(0, (ctx.pagesMax ?? PAGES_MAX) - 1)) {
    const p = await lirePage(lien, ctx, domaineSite);
    if (p.statut === "ok") pages.push(p);
  }
  const trouves = pages.flatMap((p) => extraireEmails(p.html, { domaineSite }).map((t) => ({ ...t, page: p.url })));
  const choix = choisirEmail(trouves, { domaineSite, prefixes: ctx.prefixes, messageries: ctx.messageries });
  return choix ? { statut: "trouve", email: choix.email, source: choix.page.slice(0, 500) } : { statut: "aucun" };
}

async function enParallele(elements, n, fonction) {
  let suivant = 0;
  const travailleurs = Array.from({ length: Math.max(1, Math.min(n, elements.length)) }, async () => {
    while (suivant < elements.length) {
      const k = suivant++;
      await fonction(elements[k], k);
    }
  });
  await Promise.all(travailleurs);
}

const domaineDe = (site) => {
  const url = normaliserSite(site);
  return url ? new URL(url).hostname.replace(/^www\./, "") : null;
};

function lireCache(chemin) {
  const cache = new Map();
  if (!existsSync(chemin)) return cache;
  for (const ligne of readFileSync(chemin, "utf8").split("\n")) {
    if (!ligne.trim()) continue;
    try {
      const r = JSON.parse(ligne);
      if (r && typeof r.domaine === "string") cache.set(r.domaine, r);
    } catch {
      // une ligne abîmée (arrêt brutal) : le domaine sera relu
    }
  }
  return cache;
}

/**
 * Fait tout le travail sur un CSV. dependances : { fetch, resoudre (DNS), attendre, horloge, maintenant, delaiMs, messageries }
 * (injectables : les tests n'ouvrent aucune connexion). Renvoie { code, lignes (le rapport), compteurs }.
 */
export async function executer({ niche, entree, sortie, dossier, limite = null, paralleles = 4, essai = false, dependances = {} }) {
  const { colonnes, lignes } = lireTableau(entree);
  if (lignes.length === 0) throw new ErreurSourcing("Le fichier ne contient aucune ligne de données.");
  if (!colonnes.includes("site")) throw new ErreurSourcing("Le fichier n'a pas de colonne « site » (ou site_web, url).");
  const le = dateDuJour(niche.pays.fuseau, dependances.maintenant ?? new Date());
  const compteurs = {
    lignes: lignes.length,
    a_chercher: 0,
    domaines: 0,
    lus: 0,
    repris_du_cache: 0,
    trouves: 0,
    lignes_completees: 0,
    aucun: 0,
    robots: 0,
    injoignables: 0,
    pas_html: 0,
    rediriges_ailleurs: 0,
    hors_perimetre: 0,
    illisibles: 0,
    requetes: 0,
  };
  const parDomaine = new Map();
  lignes.forEach((l, k) => {
    if (!estVide(l.email)) return;
    const domaine = domaineDe(l.site);
    if (!domaine) return;
    compteurs.a_chercher++;
    if (!parDomaine.has(domaine)) parDomaine.set(domaine, { site: l.site, lignes: [] });
    parDomaine.get(domaine).lignes.push(k);
  });
  let domaines = [...parDomaine.keys()];
  const plafond = limite ?? (essai ? 5 : null);
  if (plafond) domaines = domaines.slice(0, plafond);
  compteurs.domaines = domaines.length;

  const cheminCache = join(dossier, "cache", "emails.jsonl");
  const cache = essai ? new Map() : lireCache(cheminCache);
  if (!essai) mkdirSync(dirname(cheminCache), { recursive: true });
  const attendre = dependances.attendre ?? attendreVraiment;
  const ctx = {
    fetch: dependances.fetch ?? globalThis.fetch,
    patienter: creerCadence(1000, { horloge: dependances.horloge, attendre }),
    adresseSure: creerControleHotes(dependances.resoudre ? { resoudre: dependances.resoudre } : {}),
    delaiMs: dependances.delaiMs ?? DELAI_MS,
    userAgent: niche.marque.userAgent,
    jeton: jetonRobot(niche.marque.userAgent),
    prefixes: niche.sources.prefixesEmail,
    messageries: dependances.messageries ?? DOMAINES_MESSAGERIE,
    robots: new Map(),
    compteurs,
  };
  const STATUTS = {
    aucun: "aucun",
    robots: "robots",
    injoignable: "injoignables",
    pas_html: "pas_html",
    redirige_ailleurs: "rediriges_ailleurs",
    hors_perimetre: "hors_perimetre",
  };

  await enParallele(domaines, Math.min(8, Math.max(1, paralleles)), async (domaine) => {
    const groupe = parDomaine.get(domaine);
    let r = cache.get(domaine);
    if (r) {
      compteurs.repris_du_cache++;
    } else {
      let resultat;
      try {
        resultat = await chercherEmailSurSite(groupe.site, ctx);
      } catch {
        resultat = { statut: "injoignable" };
      }
      compteurs.lus++;
      r = { domaine, statut: resultat.statut, email: resultat.email ?? null, source: resultat.source ?? null, le };
      if (!essai && resultat.statut !== "injoignable") appendFileSync(cheminCache, `${JSON.stringify(r)}\n`);
    }
    if (r.statut === "trouve" && r.email) {
      compteurs.trouves++;
      for (const k of groupe.lignes) {
        lignes[k].email = r.email;
        lignes[k].email_source = r.source ?? "";
        lignes[k].email_date = r.le ?? le;
        compteurs.lignes_completees++;
      }
    } else if (STATUTS[r.statut]) {
      compteurs[STATUTS[r.statut]]++;
    } else {
      compteurs.illisibles++;
    }
  });

  const rapport = [
    "E-mails publics lus sur les sites des entreprises (rien n'est deviné)",
    `Lignes : ${compteurs.lignes} ; avec un site et sans e-mail : ${compteurs.a_chercher} ; domaines traités : ${compteurs.domaines}`,
    `Sites lus : ${compteurs.lus} ; repris du cache : ${compteurs.repris_du_cache} ; requêtes : ${compteurs.requetes}`,
    `E-mails trouvés : ${compteurs.trouves} (lignes complétées : ${compteurs.lignes_completees})`,
    `Sans e-mail : aucun publié ${compteurs.aucun} ; interdit par robots.txt ${compteurs.robots} ; injoignables ${compteurs.injoignables} ; pas une page web ${compteurs.pas_html} ; redirigés vers un autre site ${compteurs.rediriges_ailleurs} ; hors périmètre (réseau social, annuaire, adresse non publique) ${compteurs.hors_perimetre} ; adresse de site illisible ${compteurs.illisibles}`,
  ];
  if (essai) {
    rapport.push("ESSAI : rien n'a été écrit (ni fichier ni cache).");
  } else {
    const chemin = sortie ?? cheminSortie(entree, "emails");
    verifierSortie(entree, chemin);
    ecrireTableau(chemin, lignes, colonnes, ["email", "email_source", "email_date"]);
    rapport.push(`Écrit : ${cheminAffiche(chemin)}`);
  }
  return { code: 0, lignes: rapport, compteurs };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--sortie": "texte",
      "--limite": "entier",
      "--paralleles": "entier",
      "--essai": "booleen",
      "--dossier": "texte",
      "--config": "texte",
    });
    if (options.aide || positionnels.length !== 1) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const r = await executer({
      niche,
      entree: resolve(positionnels[0]),
      sortie: options.sortie ? resolve(options.sortie) : undefined,
      dossier: dossierDonnees(options.dossier),
      limite: options.limite ?? null,
      paralleles: options.paralleles ?? 4,
      essai: Boolean(options.essai),
      dependances: {},
    });
    afficher(r.lignes);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();
