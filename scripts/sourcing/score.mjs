// Le score d'une fiche (0 à 100) et son tier (A, B ou C), d'après la grille de config/niche.json (score.criteres, score.seuils).
//
// Chaque critère vrai pour la fiche rapporte ses points (un malus est permis : points négatifs). La somme est bornée entre 0 et
// score.plafond (100). Tier : A si le score atteint seuils.A, B s'il atteint seuils.B, C sinon. Une donnée absente ne rapporte rien.
//
// Les types de critère (config/schema.ts, TYPES_CRITERE_SCORE) et leur règle :
//   forme_juridique  { inclure?, exclure? } : des codes de catégorie juridique de l'INSEE (« 5499 », ou un début : « 54 ») ou des
//                    libellés (« SARL », en mot entier). inclure : la forme doit y être, et pas dans exclure ; exclure seul : la
//                    forme doit être connue et absente de la liste.
//   effectif         { min?, max? } : l'effectif salarié (un nombre ou une tranche) tient entièrement entre min et max.
//   anciennete       { minAns?, maxAns? } : l'âge de l'entreprise (date de création) en années, bornes comprises.
//   ville            { inclure } : des communes (accents, casse, « St » et « Saint » ignorés ; « Lyon » trouve « Lyon 3e
//                    Arrondissement ») ou des débuts de code postal (« 75 », « 690 ») ; « 2A » et « 2B » pour la Corse.
//   naf              { inclure } : des codes NAF (« 81.30Z »).
//   mot_nom          { mots } : un mot ou un début de mot (« paysag ») dans le nom ou l'enseigne.
//   note_google      { min, avisMin? } : une note Google d'au moins min (et au moins avisMin avis).
//   a_site, a_email  {} : la fiche a un site, un e-mail.
//
// Usage : node scripts/sourcing/score.mjs <entree.csv> [--sortie <fichier.csv>] [--essai] [--config <niche.json>]
//   Écrit <entree>-score.csv : les colonnes score, tier et score_detail (les critères retenus) sont ajoutées ou remplacées.
//   --essai : les compteurs seulement, rien n'est écrit.

import { resolve } from "node:path";
import {
  afficher,
  cheminAffiche,
  chargerNiche,
  cheminSortie,
  codeDepuisForme,
  contientDebutDeMot,
  contientMotEntier,
  dateDuJour,
  departementDepuisCodePostal,
  ecrireTableau,
  ErreurSourcing,
  estLance,
  libelleCategorieJuridique,
  lireArguments,
  lireEffectif,
  lireTableau,
  messageSur,
  nettoyerTexte,
  normaliserDate,
  normaliserEmail,
  normaliserNaf,
  normaliserNbAvis,
  normaliserNote,
  normaliserSite,
  normaliserVille,
  verifierSortie,
} from "./lib.mjs";

const USAGE = [
  "Usage : node scripts/sourcing/score.mjs <entree.csv> [--sortie <fichier.csv>] [--essai] [--config <niche.json>]",
  "  Calcule score (0 à 100), tier (A, B, C) et score_detail avec la grille de config/niche.json (score).",
  "  --sortie   le fichier écrit (défaut : <entree>-score.csv)",
  "  --essai    compteurs seulement, rien n'est écrit",
].join("\n");

/** L'âge d'une entreprise en années (fraction comprise ; exact aux anniversaires), ou null si une date manque. */
export function ageEnAnnees(dateCreation, aujourdhui) {
  const d = normaliserDate(dateCreation);
  const j = normaliserDate(aujourdhui);
  if (!d || !j) return null;
  const [a1, m1, j1] = d.split("-").map(Number);
  const [a2, m2, j2] = j.split("-").map(Number);
  const t = Date.UTC(a2, m2 - 1, j2);
  let ans = a2 - a1;
  if (Date.UTC(a1 + ans, m1 - 1, j1) > t) ans--;
  if (ans < 0) return 0;
  const avant = Date.UTC(a1 + ans, m1 - 1, j1);
  const apres = Date.UTC(a1 + ans + 1, m1 - 1, j1);
  return ans + (t - avant) / (apres - avant);
}

/** La forme juridique d'une fiche : { code (catégorie de l'INSEE ou null), libelle }. */
export function formeDe(fiche) {
  const brut = String(fiche.categorie_juridique ?? "").trim();
  const code = /^\d{4}$/.test(brut) ? brut : codeDepuisForme(fiche.forme_juridique);
  const libelle = nettoyerTexte(fiche.forme_juridique, 80) || libelleCategorieJuridique(code) || "";
  return { code, libelle };
}

function correspondForme(entree, { code, libelle }) {
  const e = String(entree).trim();
  if (/^\d{1,4}$/.test(e)) return code !== null && code.startsWith(e);
  return libelle !== "" && contientMotEntier(libelle, e);
}

function correspondVille(entree, fiche) {
  const e = String(entree).trim();
  const cp = String(fiche.code_postal ?? "").trim();
  if (/^\d{2,5}$/.test(e)) return cp.startsWith(e);
  if (/^2[AB]$/i.test(e)) {
    const dep = String(fiche.departement ?? "").trim().toUpperCase() || departementDepuisCodePostal(cp) || "";
    return dep === e.toUpperCase();
  }
  const ville = normaliserVille(fiche.ville);
  const voulue = normaliserVille(e);
  return ville !== "" && voulue !== "" && (ville === voulue || ville.startsWith(`${voulue} `));
}

/** Vrai si le critère s'applique à la fiche. contexte.aujourdhui : la date du jour (AAAA-MM-JJ), pour l'ancienneté. */
export function evaluerCritere(critere, fiche, { aujourdhui }) {
  const r = critere.regle ?? {};
  switch (critere.type) {
    case "forme_juridique": {
      const forme = formeDe(fiche);
      const dans = (liste) => (liste ?? []).some((e) => correspondForme(e, forme));
      if (r.inclure?.length) return dans(r.inclure) && !dans(r.exclure);
      if (r.exclure?.length) return (forme.code !== null || forme.libelle !== "") && !dans(r.exclure);
      return false;
    }
    case "effectif": {
      const e = lireEffectif(fiche.effectif);
      if (!e) return false;
      return e.min >= (r.min ?? 0) && e.max <= (r.max ?? Infinity);
    }
    case "anciennete": {
      const age = ageEnAnnees(fiche.date_creation, aujourdhui);
      if (age === null) return false;
      return (r.minAns === undefined || age >= r.minAns) && (r.maxAns === undefined || age <= r.maxAns);
    }
    case "ville":
      return (r.inclure ?? []).some((e) => correspondVille(e, fiche));
    case "naf": {
      const naf = normaliserNaf(fiche.naf);
      return naf !== null && (r.inclure ?? []).includes(naf);
    }
    case "mot_nom":
      return contientDebutDeMot(`${fiche.entreprise ?? ""} ${fiche.enseigne ?? ""}`, r.mots);
    case "note_google": {
      const note = normaliserNote(fiche.note_google);
      if (note === null || note < r.min) return false;
      return r.avisMin === undefined || (normaliserNbAvis(fiche.nb_avis) ?? 0) >= r.avisMin;
    }
    case "a_site":
      return normaliserSite(fiche.site) !== null;
    case "a_email":
      return normaliserEmail(fiche.email) !== null;
    default:
      // Un type inconnu ne peut pas venir d'une config validée : on ne lui donne aucun point.
      return false;
  }
}

/** Le tier d'un score : A au moins seuils.A, B au moins seuils.B, C sinon (et sans score). */
export function tierDepuisScore(score, seuils) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "C";
  if (score >= seuils.A) return "A";
  if (score >= seuils.B) return "B";
  return "C";
}

/** Le score d'une fiche avec la grille (config.score) : { score, tier, retenus (identifiants des critères vrais) }. */
export function calculerScore(fiche, grille, { aujourdhui }) {
  let total = 0;
  const retenus = [];
  for (const critere of grille.criteres) {
    if (evaluerCritere(critere, fiche, { aujourdhui })) {
      total += critere.points;
      retenus.push(critere.id);
    }
  }
  const plafond = grille.plafond ?? 100;
  const score = Math.max(0, Math.min(plafond, total));
  return { score, tier: tierDepuisScore(score, grille.seuils), retenus };
}

const TRANCHES_SCORE = [
  [0, 19],
  [20, 39],
  [40, 59],
  [60, 79],
  [80, 100],
];

/** Note toutes les lignes : { lignes (avec score, tier, score_detail), compteurs }. Les compteurs ne contiennent aucune donnée. */
export function noterTableau(lignes, grille, aujourdhui) {
  const compteurs = { lignes: lignes.length, tiers: { A: 0, B: 0, C: 0 }, tranches: {}, criteres: {} };
  for (const [a, b] of TRANCHES_SCORE) compteurs.tranches[`${a}-${b}`] = 0;
  for (const c of grille.criteres) compteurs.criteres[c.id] = 0;
  const notees = lignes.map((ligne) => {
    const r = calculerScore(ligne, grille, { aujourdhui });
    compteurs.tiers[r.tier]++;
    const tranche = TRANCHES_SCORE.find(([a, b]) => r.score >= a && r.score <= b);
    compteurs.tranches[`${tranche[0]}-${tranche[1]}`]++;
    for (const id of r.retenus) compteurs.criteres[id]++;
    return { ...ligne, score: String(r.score), tier: r.tier, score_detail: r.retenus.join(" + ") };
  });
  return { lignes: notees, compteurs };
}

/** Les lignes du rapport (des compteurs seulement). */
export function rapportScore(compteurs, grille) {
  const l = [];
  l.push(`Lignes notées : ${compteurs.lignes}`);
  l.push(`Tiers : A ${compteurs.tiers.A}, B ${compteurs.tiers.B}, C ${compteurs.tiers.C} (seuils : A dès ${grille.seuils.A}, B dès ${grille.seuils.B})`);
  l.push(`Scores : ${Object.entries(compteurs.tranches).map(([t, n]) => `${t} : ${n}`).join(" ; ")}`);
  l.push("Critères (fiches concernées) :");
  for (const c of grille.criteres) l.push(`  ${c.id} (${c.type}, ${c.points > 0 ? "+" : ""}${c.points}) : ${compteurs.criteres[c.id]}`);
  return l;
}

/** Fait tout le travail : lit le CSV, note chaque ligne, écrit le fichier (sauf --essai). Renvoie { code, lignes, compteurs }. */
export async function executer({ niche, entree, sortie, essai = false, maintenant = new Date() }) {
  const { colonnes, lignes } = lireTableau(entree);
  if (lignes.length === 0) throw new ErreurSourcing("Le fichier ne contient aucune ligne de données.");
  const aujourdhui = dateDuJour(niche.pays.fuseau, maintenant);
  const { lignes: notees, compteurs } = noterTableau(lignes, niche.score, aujourdhui);
  const rapport = [`Score des fiches (grille de config/niche.json, ${niche.score.criteres.length} critères)`, ...rapportScore(compteurs, niche.score)];
  if (essai) {
    rapport.push("ESSAI : rien n'a été écrit.");
  } else {
    const chemin = sortie ?? cheminSortie(entree, "score");
    verifierSortie(entree, chemin);
    ecrireTableau(chemin, notees, colonnes, ["score", "tier", "score_detail"]);
    rapport.push(`Écrit : ${cheminAffiche(chemin)}`);
  }
  return { code: 0, lignes: rapport, compteurs };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), { "--sortie": "texte", "--essai": "booleen", "--config": "texte" });
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
