// Le commun des scripts de sourcing (scripts/sourcing/*.mjs) :
//   - la configuration de la niche (config/niche.json, validée par config/charger.ts) ;
//   - la ligne de commande, la date du jour dans le fuseau de l'équipe, la cadence des requêtes ;
//   - les normalisations : texte, SIREN, SIRET, NAF, dates, codes postaux, départements, sites, e-mails, téléphones en E.164 (la même
//     règle que la fonction SQL normaliser_e164), effectifs, formes juridiques ;
//   - les colonnes du CSV d'import (docs/sourcing.md) et leur lecture (alias d'en-têtes) ;
//   - des sorties sans donnée : les messages d'erreur et les compteurs ne citent jamais une entreprise, un nom, un numéro ou un e-mail.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decoderUtf8, ecrireCsv, lireCsv } from "./csv.mjs";

export const RACINE = fileURLToPath(new URL("../../", import.meta.url));
export const CHEMIN_NICHE = join(RACINE, "config", "niche.json");
/** Le dossier des données de prospection : ignoré par git (.gitignore : donnees/, *.csv, cache/). */
export const DOSSIER_DONNEES = join(RACINE, "donnees");

// ---------------------------------------------------------------------------------------------------------------------------------
// Erreurs sans donnée
// ---------------------------------------------------------------------------------------------------------------------------------

/** Une erreur dont le message ne contient aucune donnée de prospect : on peut l'afficher telle quelle. */
export class ErreurSourcing extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurSourcing";
  }
}

/** Le code d'une erreur (SQL, réseau…), jamais son message : il peut citer une valeur. */
export function codeErreur(e) {
  const code = e && typeof e === "object" ? e.code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_]{2,24}$/.test(code)) return code;
  if (e && typeof e === "object" && (e.name === "TimeoutError" || e.name === "AbortError")) return "delai_depasse";
  return "inconnu";
}

/** Le message à afficher pour une erreur : le sien si elle est sûre, sinon son seul code. */
export function messageSur(e) {
  if (e instanceof ErreurSourcing || e?.name === "ErreurCsv") return e.message;
  return `erreur inattendue (code ${codeErreur(e)})`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Configuration, ligne de commande, fichiers
// ---------------------------------------------------------------------------------------------------------------------------------

/** La configuration de la niche, validée (schéma et garde-fous). Lève ErreurSourcing avec la liste des problèmes. */
export async function chargerNiche(chemin = CHEMIN_NICHE) {
  // Enregistre le chargeur TypeScript de Node (sans effet s'il l'est déjà, par exemple sous npm test), puis lit config/charger.ts.
  await import("../charger-ts.mjs");
  const { analyserNiche } = await import("../../config/charger.ts");
  if (!existsSync(chemin)) throw new ErreurSourcing("Configuration introuvable : config/niche.json (le skill d'installation l'écrit).");
  let brut;
  try {
    brut = JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    throw new ErreurSourcing("config/niche.json n'est pas un JSON lisible.");
  }
  const r = analyserNiche(brut);
  if (!r.ok) throw new ErreurSourcing(`config/niche.json invalide :\n- ${r.problemes.join("\n- ")}`);
  return r.niche;
}

const nomCle = (option) => option.replace(/^--/, "").replace(/-([a-z])/g, (_, l) => l.toUpperCase());

/**
 * La ligne de commande, d'après une spécification { "--appliquer": "booleen", "--limite": "entier", "--sortie": "texte" }.
 * « --option valeur » et « --option=valeur » sont acceptés ; « --exiger-telephone » devient la clé exigerTelephone.
 * Renvoie { options, positionnels }. Une option inconnue ou mal formée lève ErreurSourcing.
 */
export function lireArguments(argv, spec) {
  const options = {};
  const positionnels = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === "-h") {
      options.aide = true;
      continue;
    }
    if (!a.startsWith("--")) {
      if (a.startsWith("-") && a.length > 1) throw new ErreurSourcing(`Option inconnue (les options s'écrivent --nom) : ${a.slice(0, 30)}`);
      positionnels.push(a);
      continue;
    }
    const egal = a.indexOf("=");
    const nom = egal > 0 ? a.slice(0, egal) : a;
    const type = nom === "--aide" || nom === "--help" ? "booleen" : spec[nom];
    if (!type) throw new ErreurSourcing(`Option inconnue : ${nom.slice(0, 40)}`);
    const cle = nom === "--help" ? "aide" : nomCle(nom);
    if (type === "booleen") {
      if (egal > 0) throw new ErreurSourcing(`${nom} ne prend pas de valeur.`);
      options[cle] = true;
      continue;
    }
    const valeur = egal > 0 ? a.slice(egal + 1) : argv[++i];
    if (valeur === undefined || valeur === "" || (egal < 0 && String(valeur).startsWith("--"))) {
      throw new ErreurSourcing(`${nom} attend une valeur.`);
    }
    if (type === "entier") {
      if (!/^\d{1,9}$/.test(valeur) || Number(valeur) < 1) throw new ErreurSourcing(`${nom} attend un entier supérieur ou égal à 1.`);
      options[cle] = Number(valeur);
    } else if (Array.isArray(type)) {
      if (!type.includes(valeur)) throw new ErreurSourcing(`${nom} attend l'une de ces valeurs : ${type.join(", ")}.`);
      options[cle] = valeur;
    } else {
      options[cle] = String(valeur);
    }
  }
  return { options, positionnels };
}

/** Vrai si ce module est le script lancé (node scripts/sourcing/x.mjs), faux s'il est importé (tests). */
export function estLance(urlModule) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(urlModule));
  } catch {
    return false;
  }
}

/** Le dossier des données : --dossier s'il est donné, sinon donnees/ à la racine du dépôt. Il est créé seulement quand on y écrit. */
export function dossierDonnees(choisi) {
  return resolve(choisi ?? DOSSIER_DONNEES);
}

/** Le chemin de sortie par défaut d'une étape : « <entrée>-<etape>.csv », à côté du fichier d'entrée. */
export function cheminSortie(entree, etape) {
  const ext = extname(entree);
  return join(dirname(entree), `${basename(entree, ext)}-${etape}.csv`);
}

/** Refuse d'écrire par-dessus le fichier lu : chaque étape écrit un nouveau fichier. */
export function verifierSortie(entree, sortie) {
  if (resolve(entree) === resolve(sortie)) throw new ErreurSourcing("Le fichier de sortie doit être différent du fichier d'entrée.");
}

/** Lit un CSV (UTF-8 strict) : { colonnes, lignes } en colonnes canoniques (voir canoniserTableau). */
export function lireTableau(chemin) {
  if (!existsSync(chemin)) throw new ErreurSourcing("Fichier CSV introuvable.");
  const { colonnes, lignes } = lireCsv(decoderUtf8(readFileSync(chemin)));
  return canoniserTableau(colonnes, lignes);
}

/** Écrit un CSV (point-virgule, BOM) : les colonnes standard présentes, dans l'ordre standard, puis les autres. */
export function ecrireTableau(chemin, lignes, colonnesLues = [], colonnesAjoutees = []) {
  const presentes = new Set([...colonnesLues, ...colonnesAjoutees]);
  const standard = COLONNES.filter((c) => presentes.has(c));
  const autres = [...presentes].filter((c) => !COLONNES.includes(c));
  mkdirSync(dirname(resolve(chemin)), { recursive: true });
  writeFileSync(chemin, ecrireCsv([...standard, ...autres], lignes));
  return [...standard, ...autres];
}

/** Un chemin à afficher : relatif au dossier courant s'il est dedans, sinon absolu. */
export function cheminAffiche(chemin) {
  const r = relative(process.cwd(), chemin);
  return r && !r.startsWith("..") ? r : resolve(chemin);
}

/** Affiche des lignes de compteurs (jamais une donnée). */
export function afficher(lignes, flux = process.stdout) {
  for (const l of lignes) flux.write(`${l}\n`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dates et cadence
// ---------------------------------------------------------------------------------------------------------------------------------

/** La date (AAAA-MM-JJ) d'un instant dans un fuseau (celui de l'équipe : config.pays.fuseau). */
export function dateDuJour(fuseau = "Europe/Paris", maintenant = new Date()) {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(maintenant)
      .map((p) => [p.type, p.value]),
  );
  return `${parties.year}-${parties.month}-${parties.day}`;
}

export const attendreVraiment = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Une cadence : au plus une requête par intervalle, par clé (un domaine, une API). patienter(cle, intervalleMs) réserve le prochain
 * créneau tout de suite (deux appels simultanés ne partent pas ensemble), puis attend son heure. horloge et attendre sont injectables.
 */
export function creerCadence(intervalleParDefaut, { horloge = () => Date.now(), attendre = attendreVraiment } = {}) {
  const prochains = new Map();
  return async function patienter(cle = "", intervalleMs = intervalleParDefaut) {
    const maintenant = horloge();
    const creneau = Math.max(maintenant, prochains.get(cle) ?? 0);
    prochains.set(cle, creneau + intervalleMs);
    if (creneau > maintenant) await attendre(creneau - maintenant);
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------------------------------------------------------------

export const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "");

/** Texte de comparaison : minuscules, sans accents, « œ » devient « oe », tout ce qui n'est ni lettre ni chiffre devient une espace. */
export function texteComparable(s) {
  return sansAccents(String(s ?? "").replace(/œ/gi, "oe").replace(/æ/gi, "ae"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Vrai si l'un des mots (ou groupes de mots) commence un mot du texte : « paysag » trouve « Paysagiste » ; accents et casse ignorés. */
export function contientDebutDeMot(texte, mots) {
  const t = ` ${texteComparable(texte)}`;
  return (mots ?? []).some((m) => {
    const n = texteComparable(m);
    return n !== "" && t.includes(` ${n}`);
  });
}

/** Vrai si le mot (ou groupe de mots) figure en entier dans le texte : « SARL » trouve « SARL unipersonnelle », pas « SARLU ». */
export function contientMotEntier(texte, mot) {
  const n = texteComparable(mot);
  return n !== "" && ` ${texteComparable(texte)} `.includes(` ${n} `);
}

/** Une commune comparable : sans accents ni casse, « St » devient « saint », la mention « Cedex » et ce qui la suit sont retirés. */
export function normaliserVille(v) {
  return texteComparable(v)
    .replace(/\bcedex\b.*$/, "")
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

/** Texte d'une cellule : caractères de contrôle remplacés par une espace, espaces resserrées, au plus max caractères. */
export function nettoyerTexte(brut, max = 200) {
  const t = String(brut ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(t).slice(0, max).join("").trimEnd();
}

/** « JEAN-PIERRE DE LA FONTAINE » devient « Jean-Pierre De La Fontaine ». */
export function casseNom(s) {
  return nettoyerTexte(s, 160)
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, avant, lettre) => avant + lettre.toUpperCase());
}

/** Vrai si la cellule est vide (ou ne contient que des espaces). */
export const estVide = (v) => String(v ?? "").trim() === "";
/** Un nombre entier écrit par un tableur comme un décimal (« 12.0 ») redevient « 12 ». */
const sansDecimaleNulle = (v) =>
  String(v ?? "")
    .trim()
    .replace(/\.0+$/, "");

// ---------------------------------------------------------------------------------------------------------------------------------
// Identifiants et adresses
// ---------------------------------------------------------------------------------------------------------------------------------

/** SIREN : exactement 9 chiffres (espaces, points et tirets tolérés), sinon null. La clé de Luhn n'est pas vérifiée. */
export function normaliserSiren(brut) {
  const n = sansDecimaleNulle(brut).replace(/[\s. -]/g, "");
  return /^\d{9}$/.test(n) ? n : null;
}

/** SIRET : 14 chiffres qui commencent par le SIREN de la ligne (s'il est connu), sinon null. */
export function normaliserSiret(brut, siren = null) {
  const n = sansDecimaleNulle(brut).replace(/[\s. -]/g, "");
  if (!/^\d{14}$/.test(n)) return null;
  return siren && !n.startsWith(siren) ? null : n;
}

/** Code NAF : « 8130Z », « 81.30z », « 81.30 Z » deviennent « 81.30Z » ; sinon null. */
export function normaliserNaf(brut) {
  const m = String(brut ?? "")
    .trim()
    .match(/^(\d{2})\.?(\d{2})\s?([A-Za-z])$/);
  return m ? `${m[1]}.${m[2]}${m[3].toUpperCase()}` : null;
}

/** Date AAAA-MM-JJ (éventuellement suivie d'une heure) ou JJ/MM/AAAA, qui existe au calendrier, entre 1800 et 2100 ; sinon null. */
export function normaliserDate(brut) {
  const t = String(brut ?? "").trim();
  let a;
  let m;
  let j;
  let r = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (r) [, a, m, j] = r;
  else if ((r = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) [, j, m, a] = r;
  else return null;
  const d = new Date(Date.UTC(Number(a), Number(m) - 1, Number(j)));
  const existe = d.getUTCFullYear() === Number(a) && d.getUTCMonth() === Number(m) - 1 && d.getUTCDate() === Number(j);
  return existe && Number(a) >= 1800 && Number(a) <= 2100 ? `${a}-${m}-${j}` : null;
}

/** Département français d'un code postal : 97x et 98x sur 3 chiffres, Corse 2A (avant 20200) ou 2B ; sinon null. */
export function departementDepuisCodePostal(cp) {
  const c = String(cp ?? "").trim();
  if (!/^\d{5}$/.test(c)) return null;
  if (c.startsWith("97") || c.startsWith("98")) return c.slice(0, 3);
  if (c.startsWith("20")) return Number(c) < 20200 ? "2A" : "2B";
  return c.slice(0, 2);
}

/** Code postal : en France 5 chiffres (« 6000 » redevient « 06000 ») ; ailleurs 3 à 10 lettres, chiffres, espaces ou tirets. */
export function normaliserCodePostal(brut, pays = "FR") {
  const c = sansDecimaleNulle(brut).replace(/\s+/g, " ").toUpperCase();
  if (pays === "FR") {
    const n = c.replace(/[\s.]/g, "");
    if (/^\d{4}$/.test(n)) return `0${n}`;
    return /^\d{5}$/.test(n) ? n : null;
  }
  return /^[0-9A-Z -]{3,10}$/.test(c) ? c : null;
}

const DEPARTEMENT_FR = /^(?:0[1-9]|1\d|2[1-9]|[3-8]\d|9[0-5]|2[AB]|97[1-8]|98[4-9])$/;

/** Département : en France le code (01 à 95, 2A, 2B, 971 à 976…), sinon déduit du code postal ; ailleurs, null. */
export function normaliserDepartement(brut, codePostal = null, pays = "FR") {
  if (pays !== "FR") return null;
  let d = sansDecimaleNulle(brut).toUpperCase();
  if (/^\d$/.test(d)) d = `0${d}`;
  if (DEPARTEMENT_FR.test(d)) return d;
  const deduit = departementDepuisCodePostal(codePostal);
  return deduit && DEPARTEMENT_FR.test(deduit) ? deduit : null;
}

/** Une adresse web devient « https://… » (http accepté), 500 caractères au plus, avec un nom de domaine ; sinon null. */
export function normaliserSite(brut) {
  const t = String(brut ?? "").trim();
  if (t === "" || /\s/.test(t) || t.length > 500) return null;
  const url = /^https?:\/\//i.test(t) ? t : /^[a-z][a-z0-9+.-]*:/i.test(t) ? null : `https://${t}`;
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return null;
    return u.href.length <= 500 ? u.href : null;
  } catch {
    return null;
  }
}

const EMAIL = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}$/;

/** Un e-mail en minuscules, 254 caractères au plus ; sinon null. */
export function normaliserEmail(brut) {
  const t = String(brut ?? "")
    .trim()
    .replace(/^mailto:/i, "")
    .toLowerCase();
  return t.length <= 254 && EMAIL.test(t) && !t.includes("..") ? t : null;
}

/** La note Google : 0 à 5, une décimale (« 4,7 » accepté) ; sinon null. */
export function normaliserNote(brut) {
  const t = String(brut ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

/** Un nombre d'avis : entier positif ou nul (« 1 234 » accepté) ; sinon null. */
export function normaliserNbAvis(brut) {
  const t = sansDecimaleNulle(brut).replace(/[\s  ]/g, "");
  return /^\d{1,7}$/.test(t) ? Number(t) : null;
}

/** Un score : entier de 0 à 100 (borné) ; null s'il est absent ou illisible. */
export function normaliserScore(brut) {
  const t = String(brut ?? "")
    .trim()
    .replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  return Math.min(100, Math.max(0, Math.round(Number(t))));
}

/** « oui », « 1 », « vrai »… : true ; « non », « 0 », « faux »… : false ; sinon null. */
export function normaliserBooleen(brut) {
  const t = texteComparable(brut);
  if (["oui", "1", "true", "vrai", "o", "y", "yes"].includes(t)) return true;
  if (["non", "0", "false", "faux", "n", "no"].includes(t)) return false;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Téléphones : la même règle que la fonction SQL normaliser_e164 (supabase/migrations/0001_schema.sql)
// ---------------------------------------------------------------------------------------------------------------------------------

const INDICATIFS = { FR: "33", BE: "32", CH: "41", LU: "352", MC: "377", CA: "1" };

/**
 * Un numéro au format E.164 (« +33199000101 »), ou null s'il est illisible. pays : FR, BE, CH, LU, MC (préfixe national 0) ou CA
 * (10 chiffres) ; les numéros déjà internationaux (« +… », « 00… ») sont acceptés pour tous les pays.
 */
export function normaliserE164(numero, pays = "FR") {
  let v = String(numero ?? "")
    .trim()
    .replace(/[\s.()/-]/g, "");
  const indicatif = INDICATIFS[String(pays ?? "FR").toUpperCase()];
  if (v === "") return null;
  if (/^00[1-9]/.test(v)) {
    v = `+${v.slice(2)}`;
  } else if (!v.startsWith("+")) {
    if (indicatif === "1" && /^1?[2-9][0-9]{9}$/.test(v)) v = `+1${v.slice(-10)}`;
    else if (indicatif && indicatif !== "1" && /^0[1-9][0-9]{4,13}$/.test(v)) v = `+${indicatif}${v.slice(1)}`;
    else if (indicatif && new RegExp(`^${indicatif}[1-9][0-9]{4,13}$`).test(v)) v = `+${v}`;
    else return null;
  }
  // « +33 0 1 99… » : le 0 national en trop.
  if (/^\+(33|32|41|352|377)0[1-9]/.test(v)) v = v.replace(/^\+(33|32|41|352|377)0/, "+$1");
  if (v.startsWith("+33") && !/^\+33[1-9][0-9]{8}$/.test(v)) return null;
  return /^\+[1-9][0-9]{5,14}$/.test(v) ? v : null;
}

/** Les 9 derniers chiffres d'un numéro (rapprochement, liste d'opposition), ou null s'il y en a moins de 9 : comme la fonction SQL tel9. */
export function tel9(numero) {
  const chiffres = String(numero ?? "").replace(/\D/g, "");
  return chiffres.length >= 9 ? chiffres.slice(-9) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Effectifs (tranches de l'INSEE) et formes juridiques (catégories juridiques de l'INSEE)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Les tranches d'effectif salarié de l'INSEE : code, bornes, libellé. */
export const TRANCHES_EFFECTIF = {
  "00": [0, 0, "0 salarié"],
  "01": [1, 2, "1 ou 2 salariés"],
  "02": [3, 5, "3 à 5 salariés"],
  "03": [6, 9, "6 à 9 salariés"],
  11: [10, 19, "10 à 19 salariés"],
  12: [20, 49, "20 à 49 salariés"],
  21: [50, 99, "50 à 99 salariés"],
  22: [100, 199, "100 à 199 salariés"],
  31: [200, 249, "200 à 249 salariés"],
  32: [250, 499, "250 à 499 salariés"],
  41: [500, 999, "500 à 999 salariés"],
  42: [1000, 1999, "1 000 à 1 999 salariés"],
  51: [2000, 4999, "2 000 à 4 999 salariés"],
  52: [5000, 9999, "5 000 à 9 999 salariés"],
  53: [10000, Infinity, "10 000 salariés et plus"],
};

/** Le libellé d'une tranche d'effectif de l'INSEE (« 03 » : « 6 à 9 salariés »), ou null (« NN » : non renseignée). */
export function libelleTranche(code) {
  return TRANCHES_EFFECTIF[String(code ?? "").trim()]?.[2] ?? null;
}

/**
 * L'effectif lu dans une cellule : { min, max } salariés, ou null s'il est inconnu. Accepte un nombre (« 12 »), une tranche
 * (« 6 à 9 salariés », « 6-9 », « 1 ou 2 salariés », « 10 000 salariés et plus », « 50+ »). Un code de tranche de l'INSEE se met dans
 * la colonne tranche_effectif (canoniserTableau le convertit en libellé).
 */
export function lireEffectif(brut) {
  const t = String(brut ?? "")
    .trim()
    .toLowerCase();
  if (t === "" || t === "nn" || t === "nc") return null;
  const nombres = [...t.matchAll(/\d{1,3}(?:[\s  .]\d{3})+|\d+/g)].map((m) => Number(m[0].replace(/[\s  .]/g, "")));
  if (nombres.length === 0) return null;
  if (/plus|\+|au-dela|au-delà/.test(t)) return { min: nombres[0], max: Infinity };
  if (nombres.length === 1) return { min: nombres[0], max: nombres[0] };
  return { min: Math.min(nombres[0], nombres[1]), max: Math.max(nombres[0], nombres[1]) };
}

/** Un libellé court d'une catégorie juridique de l'INSEE (« 5499 » : « SARL »), ou « Catégorie juridique 1234 » si elle est rare. */
export function libelleCategorieJuridique(code) {
  const c = String(code ?? "").trim();
  if (!/^\d{4}$/.test(c)) return null;
  const n = Number(c);
  const exacts = {
    1000: "Entrepreneur individuel",
    5202: "SNC",
    5203: "SNC coopérative",
    5385: "SELCA",
    5470: "SPFPL SARL",
    5485: "SELARL",
    5498: "EURL",
    5585: "SELAFA",
    5685: "SELAFA",
    5710: "SAS",
    5720: "SASU",
    5770: "SPFPL SAS",
    5785: "SELAS",
    5800: "Société européenne",
    6210: "GEIE",
    6220: "GIE",
    6533: "GAEC",
    6589: "SCM",
    6598: "EARL",
    9300: "Fondation",
  };
  if (exacts[n]) return exacts[n];
  if (n >= 5300 && n < 5400) return "Société en commandite";
  if (n >= 5400 && n < 5500) return "SARL";
  if (n >= 5500 && n < 5700) return "SA";
  if (n >= 6540 && n <= 6544) return "SCI";
  if (n >= 6561 && n <= 6585) return "SCP";
  if (n >= 6500 && n < 6600) return "Société civile";
  if (n >= 9200 && n < 9300) return "Association";
  return `Catégorie juridique ${c}`;
}

/** Le code de catégorie juridique d'un libellé courant (« SARL » : 5499, « SASU » : 5720…), ou null. */
export function codeDepuisForme(libelle) {
  const t = texteComparable(libelle);
  const connus = {
    ei: "1000",
    "entrepreneur individuel": "1000",
    "entreprise individuelle": "1000",
    micro: "1000",
    "micro entreprise": "1000",
    "auto entrepreneur": "1000",
    snc: "5202",
    sarl: "5499",
    "sarl unipersonnelle": "5498",
    eurl: "5498",
    selarl: "5485",
    sa: "5599",
    sas: "5710",
    sasu: "5720",
    selas: "5785",
    sci: "6540",
    scp: "6585",
    scm: "6589",
    earl: "6598",
    gaec: "6533",
    gie: "6220",
    association: "9220",
    "societe en nom collectif": "5202",
    "societe a responsabilite limitee": "5499",
    "entreprise unipersonnelle a responsabilite limitee": "5498",
    "societe anonyme": "5599",
    "societe par actions simplifiee": "5710",
    "societe par actions simplifiee unipersonnelle": "5720",
    "societe par actions simplifiee a associe unique": "5720",
    "societe civile immobiliere": "6540",
  };
  return connus[t] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les colonnes du CSV d'import (docs/sourcing.md)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Les colonnes standard, dans l'ordre où les scripts les écrivent. Les autres colonnes d'un fichier sont gardées à la suite. */
export const COLONNES = [
  "entreprise",
  "enseigne",
  "siren",
  "siret",
  "telephone",
  "mobile",
  "email",
  "email_source",
  "email_date",
  "site",
  "ville",
  "code_postal",
  "departement",
  "naf",
  "categorie_juridique",
  "forme_juridique",
  "effectif",
  "date_creation",
  "dirigeant",
  "metier",
  "est_ei",
  "note_google",
  "nb_avis",
  "maps_categorie",
  "coordonnees_source",
  "coordonnees_url",
  "coordonnees_date",
  "coordonnees_fiabilite",
  "siren_recherche",
  "source",
  "source_url",
  "source_date",
  "score",
  "tier",
  "score_detail",
];

/**
 * Les autres en-têtes acceptés pour une colonne (noms normalisés). Si plusieurs sont présents dans l'en-tête, le premier de la liste
 * l'emporte (pour tout le fichier) ; les autres restent des colonnes ordinaires.
 */
export const ALIAS = {
  entreprise: ["entreprise", "nom", "raison_sociale", "denomination", "nom_entreprise", "societe", "nom_complet"],
  siren: ["siren", "n_siren", "numero_siren"],
  siret: ["siret", "siret_siege", "n_siret"],
  telephone: ["telephone", "tel", "telephone_fixe", "phone"],
  mobile: ["mobile", "portable", "telephone_mobile", "tel_mobile"],
  email: ["email", "e_mail", "mail", "courriel", "adresse_email"],
  site: ["site", "site_web", "site_internet", "url", "web"],
  ville: ["ville", "commune"],
  code_postal: ["code_postal", "cp"],
  naf: ["naf", "code_naf", "ape", "code_ape", "activite_principale"],
  categorie_juridique: ["categorie_juridique", "nature_juridique", "code_categorie_juridique"],
  forme_juridique: ["forme_juridique", "forme"],
  effectif: ["effectif", "effectifs", "tranche_effectif"],
  date_creation: ["date_creation", "creation"],
  dirigeant: ["dirigeant", "gerant"],
  note_google: ["note_google", "note"],
  nb_avis: ["nb_avis", "nb_avis_google", "avis"],
};

/** Pour chaque colonne standard, la colonne du fichier qui la porte : { canon: colonneDuFichier }. */
export function correspondances(colonnes) {
  const choix = {};
  for (const [canon, noms] of Object.entries(ALIAS)) {
    const trouve = noms.find((n) => colonnes.includes(n));
    if (trouve !== undefined) choix[canon] = trouve;
  }
  return choix;
}

/**
 * Les colonnes et les lignes d'un fichier, en noms canoniques : la colonne choisie pour chaque nom standard est renommée, les autres
 * colonnes sont gardées telles quelles. Un code de tranche de l'INSEE (« 03 », « NN ») lu dans tranche_effectif devient son libellé.
 */
export function canoniserTableau(colonnes, lignes) {
  const choix = correspondances(colonnes);
  const renommage = new Map(Object.entries(choix).map(([canon, source]) => [source, canon]));
  const sortie = [];
  for (const c of colonnes) {
    const nom = renommage.get(c) ?? (Object.hasOwn(choix, c) ? `${c}_2` : c);
    if (!sortie.includes(nom)) sortie.push(nom);
  }
  const canoniques = lignes.map((brut) => {
    const ligne = {};
    for (const c of colonnes) {
      const canon = renommage.get(c);
      if (canon) {
        let valeur = brut[c] ?? "";
        if (canon === "effectif" && c === "tranche_effectif") valeur = libelleTranche(valeur) ?? "";
        ligne[canon] = valeur;
      } else {
        // Une colonne qui porte un nom standard sans avoir été choisie (impossible en pratique) est gardée sous un autre nom.
        ligne[Object.hasOwn(choix, c) ? `${c}_2` : c] = brut[c] ?? "";
      }
    }
    if (brut.ligne !== undefined) Object.defineProperty(ligne, "ligne", { value: brut.ligne, enumerable: false });
    if (brut.enTrop !== undefined) Object.defineProperty(ligne, "enTrop", { value: brut.enTrop, enumerable: false });
    return ligne;
  });
  return { colonnes: sortie, lignes: canoniques };
}
