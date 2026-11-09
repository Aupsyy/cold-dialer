// Étape 3 des accroches : réduire le texte lu sur chaque site aux lignes utiles pour écrire une accroche.
//
//   node scripts/accroches/compact.mjs [--max-caracteres 2000] [--dossier D] [--config C]
//
// Pour chaque site de donnees/accroches/crawl.jsonl, on garde, mot pour mot (espaces normalisés seulement) :
//   - les titres (titre de page, intertitres), sauf les génériques (« Accueil », « Nos réalisations »…) ;
//   - les phrases qui contiennent un mot indice (config.accroche.motsIndices, puis la liste de base : projet, réalisation, chantier,
//     rénovation, agence, fondé, équipe, depuis, spécialisé…), un lieu probable (« à Vienne », un code postal), un nom propre probable
//     ou une année ; sur les pages internes (choisies pour leur sujet), les autres phrases aussi, en dernier ;
// jamais une ligne qui porte un e-mail (même masqué : « contact [at] … ») ou un numéro de téléphone (séparateurs, « (0) », formats
// belge, suisse, nord-américain compris : lib/coordonnees.mjs), ni un identifiant légal (inutiles à une accroche), ni le bruit des
// sites (cookies, droits réservés…). Les lignes les plus parlantes passent d'abord, jusqu'à N caractères par site, puis reprennent
// l'ordre des pages. Sortie : donnees/accroches/compact.jsonl { id, site, origine, indices: [{ url, type, texte }], caracteres }.

import { entier, lireOptions } from "./lib/args.mjs";
import { CONFIG_PAR_DEFAUT, dossierDeTravail, fichiers } from "./lib/chemins.mjs";
import { chargerConfig } from "./lib/config.mjs";
import { dernieresParId, ecrireTexte, lireJsonl } from "./lib/fichiers.mjs";
import { lancerSiPrincipal } from "./lib/lancer.mjs";
import { contientCoordonnees } from "./lib/coordonnees.mjs";
import { INDICES_PAR_DEFAUT, PREPOSITIONS_DE_LIEU } from "./lib/mots.mjs";
import { decouperPhrases, memeFamille, mots, normaliser, pourComparer } from "./lib/texte.mjs";

export const MAX_CARACTERES = 2000;
export const LONGUEUR_MIN = 12;
export const LONGUEUR_MAX = 400;

/** Le bruit des sites : une ligne qui en contient est écartée. */
const BRUIT = [
  "cookie", "cookies", "javascript", "navigateur", "tous droits reserves", "droits reserves", "mentions legales",
  "politique de confidentialite", "donnees personnelles", "newsletter", "inscrivez vous", "abonnez vous", "panier", "copyright",
  "captcha", "site realise par", "site cree par", "propulse par", "conception du site", "lire la suite", "en savoir plus",
  "chargement", "ajouter au panier", "accepter", "refuser",
];
/** Les lignes sans information : titres de rubrique et boutons (comparés en entier). */
const LIGNES_GENERIQUES = new Set([
  "accueil", "home", "contact", "contacts", "contactez nous", "nous contacter", "menu", "realisations", "nos realisations", "projets",
  "nos projets", "portfolio", "galerie", "galerie photos", "a propos", "qui sommes nous", "equipe", "notre equipe", "services",
  "nos services", "prestations", "nos prestations", "mentions legales", "devis", "devis gratuit", "demande de devis", "blog",
  "actualites", "actualite", "references", "nos references", "en savoir plus", "voir plus", "decouvrir", "suivez nous", "avis",
  "avis clients", "temoignages", "page introuvable", "erreur 404", "404", "voir le projet", "voir les projets", "voir la realisation",
  "voir les realisations", "decouvrir le projet", "decouvrir nos realisations", "demander un devis", "demandez un devis",
  "contactez nous des maintenant", "appelez nous", "retour aux realisations", "retour aux projets", "projet suivant",
  "projet precedent", "lire plus", "afficher plus",
]);
/** Des mots qui ne sont pas des noms propres même avec une majuscule au milieu d'une ligne (menus, boutons). */
const MAJUSCULES_COURANTES = new Set([
  "nous", "notre", "nos", "vous", "votre", "vos", "le", "la", "les", "un", "une", "des", "du", "de", "il", "elle", "ils", "elles", "je",
  "ce", "cette", "ces", "en", "au", "aux", "pour", "avec", "dans", "sur", "par", "et", "ou", "mais", "si", "que", "qui", "quand",
  "comment", "pourquoi", "tous", "tout", "toute", "toutes", "chaque", "depuis", "accueil", "contact", "contactez", "decouvrez",
  "demandez", "devis", "plus", "voir", "lire", "suite", "menu", "fermer", "ouvrir", "retour", "suivant", "precedent", "page",
]);

const MOTIF_IDENTIFIANT = /\b(siret|siren|rcs|tva intracom|capital social|numero de tva|ape|naf)\b/u;
const MOTIF_ANNEE = /\b(1[89]\d\d|20\d\d)\b/u;
const MOTIF_CODE_POSTAL = /\b\d{5}\b/u;

function contientCle(liste, phrase, cle) {
  if (cle.includes(" ")) return phrase.includes(` ${cle} `);
  return liste.some((m) => memeFamille(m, cle));
}

/** Les mots indices : ceux de la config d'abord (ils comptent double), puis la liste de base. */
export function preparerIndices(motsIndices) {
  const config = [...new Set((motsIndices ?? []).map((m) => mots(m).join(" ")).filter(Boolean))];
  return { config, base: INDICES_PAR_DEFAUT.filter((m) => !config.includes(m)) };
}

/** Lieu probable : une préposition de lieu suivie d'un mot à majuscule (« à Vienne »), ou un code postal. */
function aUnLieu(brut) {
  if (MOTIF_CODE_POSTAL.test(brut)) return true;
  const jetons = brut.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 1; i < jetons.length; i++) {
    if (/^\p{Lu}/u.test(jetons[i]) && PREPOSITIONS_DE_LIEU.has(normaliser(jetons[i - 1]))) return true;
  }
  return false;
}

/** Nom propre probable : un mot à majuscule qui n'ouvre pas la ligne et n'est pas un mot courant. */
function aUnNomPropre(brut) {
  const jetons = brut.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return jetons.some((j, i) => i > 0 && j.length >= 3 && /^\p{Lu}/u.test(j) && !MAJUSCULES_COURANTES.has(normaliser(j)));
}

/** Vrai si la ligne est à écarter : bruit, donnée personnelle, identifiant légal. */
export function ligneEcartee(brut) {
  const comparable = ` ${pourComparer(brut)} `;
  if (contientCoordonnees(brut) || MOTIF_IDENTIFIANT.test(comparable)) return true;
  return BRUIT.some((b) => comparable.includes(` ${b} `));
}

/** La note d'une ligne (0 : inutile). */
export function noterLigne(brut, type, { indices, pageInterne }) {
  const liste = mots(brut);
  const phrase = ` ${liste.join(" ")} `;
  let note = 0;
  if (indices.config.some((c) => contientCle(liste, phrase, c))) note += 4;
  if (indices.base.some((c) => contientCle(liste, phrase, c))) note += 2;
  if (aUnLieu(brut)) note += 2;
  if (MOTIF_ANNEE.test(brut)) note += 2;
  if (aUnNomPropre(brut)) note += 1;
  if (type === "titre") note += 1;
  if (pageInterne) note += 1;
  return note;
}

/**
 * Les lignes utiles d'un site, bornées à maxCaracteres (somme des textes gardés).
 * @returns {{ id: string, site: string, origine?: string, indices: { url: string, type: string, texte: string }[], caracteres: number }}
 */
export function compacterSite(ligne, { indices, maxCaracteres = MAX_CARACTERES }) {
  const candidates = [];
  const vues = new Set();
  let position = 0;
  (ligne.pages ?? []).forEach((page, numeroPage) => {
    const pageInterne = numeroPage > 0;
    const ajouter = (texte, type) => {
      const t = String(texte ?? "").trim();
      position++;
      if (t.length < (type === "titre" ? 4 : LONGUEUR_MIN) || t.length > LONGUEUR_MAX) return;
      const cle = pourComparer(t);
      if (!cle || (cle.split(" ").length < 2 && type !== "titre")) return;
      if (vues.has(cle) || LIGNES_GENERIQUES.has(cle) || ligneEcartee(t)) return;
      let note = noterLigne(t, type, { indices, pageInterne });
      // Un titre de page interne (souvent le nom d'un projet) passe avant les phrases sans indice ; une phrase de page interne sans
      // indice reste candidate, en dernier (la page a été choisie pour son sujet). Sur l'accueil, il faut un vrai signal.
      if (type === "titre" && pageInterne) note = Math.max(note, 3);
      if (note < (pageInterne ? 1 : 2)) return;
      vues.add(cle);
      candidates.push({ url: page.url, type, texte: t, note, numeroPage, position });
    };
    ajouter(page.titre, "titre");
    for (const t of page.titres ?? []) ajouter(t, "titre");
    if (page.description) ajouter(page.description, "description");
    for (const p of decouperPhrases(page.texte)) ajouter(p, "phrase");
  });

  const gardees = [];
  let caracteres = 0;
  for (const c of [...candidates].sort((a, b) => b.note - a.note || a.numeroPage - b.numeroPage || a.position - b.position)) {
    if (caracteres + c.texte.length > maxCaracteres) continue;
    gardees.push(c);
    caracteres += c.texte.length;
  }
  gardees.sort((a, b) => a.numeroPage - b.numeroPage || a.position - b.position);
  return {
    id: ligne.id,
    site: ligne.site,
    ...(ligne.origine ? { origine: ligne.origine } : {}),
    indices: gardees.map(({ url, type, texte }) => ({ url, type, texte })),
    caracteres,
  };
}

/** Compacte tout le crawl (la dernière ligne de chaque fiche). */
export function compacter(lignesCrawl, { motsIndices, maxCaracteres = MAX_CARACTERES }) {
  const indices = preparerIndices(motsIndices);
  const sorties = [];
  const bilan = { fiches: 0, avecIndices: 0, sansIndices: 0, enErreur: 0, caracteres: 0 };
  for (const ligne of dernieresParId(lignesCrawl).values()) {
    bilan.fiches++;
    if (ligne.erreur || !Array.isArray(ligne.pages)) {
      bilan.enErreur++;
      sorties.push({ id: ligne.id, site: ligne.site, erreur: ligne.erreur ?? "sans_pages", indices: [], caracteres: 0 });
      continue;
    }
    const c = compacterSite(ligne, { indices, maxCaracteres });
    if (c.indices.length > 0) {
      bilan.avecIndices++;
      bilan.caracteres += c.caracteres;
    } else bilan.sansIndices++;
    sorties.push(c);
  }
  return { sorties, bilan };
}

const AIDE = `Réduit le texte lu sur chaque site (crawl.jsonl) aux lignes utiles pour une accroche (compact.jsonl).
  --max-caracteres N   caractères gardés au plus par site (défaut ${MAX_CARACTERES}, de 300 à 6000)
  --dossier D          dossier de travail (défaut donnees/accroches)
  --config C           configuration (défaut config/niche.json)`;

export async function principal(argv, { journal = console.log } = {}) {
  const options = lireOptions(argv, { drapeaux: ["aide"], valeurs: ["max-caracteres", "dossier", "config"] });
  if (options.aide) {
    journal(AIDE);
    return 0;
  }
  const f = fichiers(dossierDeTravail(options.dossier));
  const { niche } = await chargerConfig(options.config ?? CONFIG_PAR_DEFAUT);
  const maxCaracteres = entier(options, "max-caracteres", { defaut: MAX_CARACTERES, min: 300, max: 6000 });
  const { lignes, illisibles } = lireJsonl(f.crawl);
  if (lignes.length === 0) throw new Error("crawl.jsonl est vide ou absent : lance d'abord crawl.mjs.");
  const { sorties, bilan } = compacter(lignes, { motsIndices: niche.accroche.motsIndices, maxCaracteres });
  ecrireTexte(f.compact, sorties.map((s) => JSON.stringify(s)).join("\n") + "\n");
  const moyenne = bilan.avecIndices ? Math.round(bilan.caracteres / bilan.avecIndices) : 0;
  journal(`Fiches : ${bilan.fiches} ; avec des lignes utiles : ${bilan.avecIndices} (${moyenne} caractères en moyenne) ; sans ligne utile : ${bilan.sansIndices} ; site non lu : ${bilan.enErreur}.`);
  if (illisibles) journal(`Lignes illisibles dans crawl.jsonl : ${illisibles}, ignorées.`);
  return 0;
}

lancerSiPrincipal(import.meta.url, principal);
