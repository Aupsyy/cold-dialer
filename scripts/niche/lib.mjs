// Les outils communs des scripts de scripts/niche/ : lire les niches prêtes (config/niches/<code>.json), les fusionner dans une config,
// valider le résultat avec le schéma et les garde-fous (config/charger.ts, le même contrôle que le build et npm test).
//
// Une niche prête décrit la partie « marché » d'une config : la cible, les codes NAF, la grille de score, les questions de découverte,
// les objections, les exemples d'accroche et le débrief. Elle ne touche JAMAIS à ce que la personne remplit elle-même : marque, pays,
// offre, téléphonie, agenda, légal (voir BLOCS_PROTEGES), ni aux issues d'appel.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DOSSIER_NICHES = join(RACINE, "config", "niches");
export const CHEMIN_NICHE = join(RACINE, "config", "niche.json");
export const CHEMIN_EXEMPLE = join(RACINE, "config", "niche.exemple.json");

/** Les blocs que la fusion laisse tels quels : ce que la personne remplit elle-même (et les réglages du poste). */
export const BLOCS_PROTEGES = ["version", "marque", "pays", "offre", "telephonie", "agenda", "legal", "issues", "tentativesMax"];
/** Ce que la personne doit écrire ou relire après avoir choisi une niche. */
export const A_COMPLETER = ["offre", "marque", "telephonie", "agenda", "legal"];
/** Les clés du bloc de mots-clés Google : « places » (l'API officielle) ; « maps », l'ancien nom, est repris puis renommé. */
export const CLES_GOOGLE = ["places", "maps"];

export class ErreurNiche extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ErreurNiche";
    this.details = details;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------------------------------------------------------------

/** « --option valeur » ou « --option=valeur » ; spec : { "--essai": "booleen", "--departements": "texte" }. Le reste : positionnels. */
export function lireArguments(argv, spec) {
  const options = {};
  const positionnels = [];
  for (let i = 0; i < argv.length; i++) {
    const brut = argv[i];
    if (!brut.startsWith("--")) {
      positionnels.push(brut);
      continue;
    }
    const [nom, inline] = brut.split(/=(.*)/s, 2);
    if (nom === "--aide") {
      options.aide = true;
      continue;
    }
    const type = spec[nom];
    if (!type) throw new ErreurNiche(`Option inconnue : ${nom} (--aide donne la liste).`);
    const cle = nom.slice(2).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
    if (type === "booleen") {
      options[cle] = true;
      continue;
    }
    const valeur = inline ?? argv[++i];
    if (valeur === undefined || valeur.startsWith("--")) throw new ErreurNiche(`${nom} attend une valeur.`);
    options[cle] = type === "entier" ? Number.parseInt(valeur, 10) : valeur;
  }
  return { options, positionnels };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les niches prêtes
// ---------------------------------------------------------------------------------------------------------------------------------

export function codesDesNiches() {
  if (!existsSync(DOSSIER_NICHES)) return [];
  return readdirSync(DOSSIER_NICHES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
}

export function lireNiche(code) {
  if (!/^[a-z0-9-]+$/.test(code ?? "") || !codesDesNiches().includes(code)) {
    throw new ErreurNiche(`Niche inconnue : « ${code ?? ""} ». Niches prêtes : ${codesDesNiches().join(", ")} (node scripts/niche/lister.mjs).`);
  }
  return JSON.parse(readFileSync(join(DOSSIER_NICHES, `${code}.json`), "utf8"));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validation (schéma + garde-fous)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Valide une config : { ok: true } ou { ok: false, problemes: [...] }. Les messages sont ceux de config/charger.ts. */
export async function valider(config) {
  await import("../charger-ts.mjs");
  const { analyserNiche } = await import("../../config/charger.ts");
  const r = analyserNiche(config);
  return r.ok ? { ok: true } : { ok: false, problemes: r.problemes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------------------------------------------------------------

const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Vrai si la config est encore la niche d'exemple fournie avec le dépôt (rien n'a été personnalisé). */
export function estLExemple(config, exemple) {
  return egal(config, exemple);
}

/** La liste des départements d'une option : « tous » ou « 69,38,2A » (le schéma refuse un département qui n'existe pas). */
export function lireDepartements(texte) {
  const t = String(texte).trim();
  if (t.toLowerCase() === "tous") return "tous";
  const liste = t.split(/[\s,;]+/).filter(Boolean).map((d) => d.toUpperCase());
  if (liste.length === 0) throw new ErreurNiche("--departements : une liste (69,38) ou « tous ».");
  return liste;
}

/**
 * Le bloc de mots-clés Google après fusion : celui de la config (sa clé, ses villes, son « actif », son plafond) dont seuls les mots-clés
 * changent. Sans bloc : désactivé, sans ville (la personne choisit et active elle-même, voir docs/sourcing.md).
 */
function blocGoogle(ancien, motsCles) {
  return { actif: false, villes: [], max: 200, ...(ancien ?? {}), motsCles };
}

/** Fusionne la niche prête dans la config de base, sans toucher aux blocs protégés. Renvoie la config candidate (sans la valider). */
export function fusionner(base, niche, { departements, cleGoogle } = {}) {
  const c = structuredClone(base);
  c.cible = structuredClone(niche.cible);

  const ancienne = base.sources?.sirene ?? {};
  const sirene = {
    ...ancienne,
    naf: [...niche.sources.sirene.naf],
    departements: departements ?? ancienne.departements ?? "tous",
    etatAdministratif: "A",
  };
  for (const cle of ["motsNomInclure", "motsNomExclure", "exclureEI"]) {
    if (niche.sources.sirene[cle] === undefined) delete sirene[cle];
    else sirene[cle] = structuredClone(niche.sources.sirene[cle]);
  }
  c.sources = {
    ...(c.sources ?? {}),
    sirene,
    motsVidesAppariement: [...niche.sources.motsVidesAppariement],
    prefixesEmail: [...niche.sources.prefixesEmail],
  };

  const existante = CLES_GOOGLE.find((k) => base.sources?.[k] !== undefined);
  const cle = cleGoogle ?? CLES_GOOGLE[0];
  const ancien = base.sources?.[existante];
  for (const k of CLES_GOOGLE) delete c.sources[k];
  c.sources[cle] = blocGoogle(ancien, [...niche.google.motsCles]);

  c.score = structuredClone(niche.score);
  c.script = { ...c.script, questions: structuredClone(niche.script.questions) };
  c.objections = structuredClone(niche.objections);
  c.accroche = { ...c.accroche, exemples: [...niche.accroche.exemples], motsIndices: [...niche.accroche.motsIndices] };
  c.debrief = { champs: structuredClone(niche.debrief.champs) };
  return c;
}

/**
 * Fusion complète : range les mots-clés Google sous « places » (un ancien bloc « maps » est repris et renommé), valide, vérifie que rien de protégé n'a
 * bougé. Lève ErreurNiche avec la liste des problèmes si aucune variante n'est valide.
 */
export async function appliquerNiche(base, niche, options = {}) {
  const ordre = [options.cleGoogle ?? CLES_GOOGLE[0]];
  let derniers = null;
  for (const cleGoogle of ordre) {
    const candidate = fusionner(base, niche, { ...options, cleGoogle });
    const v = await valider(candidate);
    if (v.ok) {
      for (const bloc of BLOCS_PROTEGES) {
        if (!egal(base[bloc], candidate[bloc])) throw new ErreurNiche(`Erreur interne : le bloc protégé « ${bloc} » a changé.`);
      }
      return { config: candidate, cleGoogle };
    }
    if (!derniers || v.problemes.length < derniers.length) derniers = v.problemes;
  }
  throw new ErreurNiche("La config obtenue est refusée par le schéma ou les garde-fous :", derniers ?? []);
}

/** Le résumé de ce qui change entre deux configs (une ligne par bloc modifié), pour --essai. */
export function resumeDesChangements(avant, apres) {
  const l = [];
  const liste = (a) => (Array.isArray(a) ? a.join(", ") : String(a));
  const naf = (c) => c.sources?.sirene?.naf ?? [];
  if (!egal(naf(avant), naf(apres))) l.push(`codes NAF : ${liste(naf(avant))}  ->  ${liste(naf(apres))}`);
  const dep = (c) => c.sources?.sirene?.departements;
  l.push(egal(dep(avant), dep(apres)) ? `départements : inchangés (${liste(dep(apres))})` : `départements : ${liste(dep(avant))}  ->  ${liste(dep(apres))}`);
  if (!egal(avant.cible, apres.cible)) l.push(`cible : ${liste(avant.cible?.metiers ?? [])}  ->  ${liste(apres.cible.metiers)} (taille ${apres.cible.tailleMin} à ${apres.cible.tailleMax}, décideur : ${apres.cible.decideur})`);
  if (!egal(avant.score, apres.score)) l.push(`score : ${avant.score?.criteres?.length ?? 0} critères  ->  ${apres.score.criteres.length} critères, seuils A ${apres.score.seuils.A} et B ${apres.score.seuils.B}`);
  if (!egal(avant.script?.questions, apres.script.questions)) l.push(`questions de découverte : ${avant.script?.questions?.length ?? 0}  ->  ${apres.script.questions.length}`);
  if (!egal(avant.objections, apres.objections)) l.push(`objections : ${avant.objections?.length ?? 0}  ->  ${apres.objections.length}`);
  if (!egal(avant.accroche, apres.accroche)) l.push("accroche : exemples et mots-indices remplacés");
  if (!egal(avant.debrief, apres.debrief)) l.push(`débrief : ${apres.debrief.champs.length} champs`);
  const g = (c) => CLES_GOOGLE.map((k) => c.sources?.[k]).find(Boolean);
  if (!egal(g(avant)?.motsCles, g(apres)?.motsCles)) l.push(`mots-clés Google : ${liste(g(avant)?.motsCles ?? [])}  ->  ${liste(g(apres).motsCles)}`);
  if (!egal(avant.sources?.prefixesEmail, apres.sources.prefixesEmail) || !egal(avant.sources?.motsVidesAppariement, apres.sources.motsVidesAppariement)) {
    l.push("sources : mots vides d'appariement et débuts d'adresse e-mail remplacés");
  }
  return l;
}
