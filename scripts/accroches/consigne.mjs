// La consigne des accroches, remplie depuis config/niche.json : le modèle skills/accroches/consigne.md porte des crochets
// ([cible], [offre], [promesse], [ton], [mots indices], [exemples]…) que ce script remplace par les valeurs de la config.
// Un crochet inconnu arrête tout : le modèle et ce script restent d'accord.
//
//   node scripts/accroches/consigne.mjs                      affiche la consigne remplie
//   node scripts/accroches/consigne.mjs --sortie F           l'écrit dans F (par exemple donnees/accroches/consigne.md)
//   node scripts/accroches/consigne.mjs --config C           avec une autre config (par exemple config/niche.exemple.json)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lireOptions } from "./lib/args.mjs";
import { CONFIG_PAR_DEFAUT, MODELE_CONSIGNE } from "./lib/chemins.mjs";
import { chargerConfig } from "./lib/config.mjs";
import { ecrireTexte } from "./lib/fichiers.mjs";
import { lancerSiPrincipal } from "./lib/lancer.mjs";
import { MOTS_MAX, MOTS_MIN } from "./lib/validation.mjs";

/** Un crochet du modèle : « [mot] » ou « [deux mots] » (lettres, espaces, apostrophes, tirets). Le JSON d'exemple n'en contient pas. */
export const MOTIF_CROCHET = /\[(\p{L}[\p{L} '’-]{0,40})\]/gu;

const TONS = {
  direct_sec: "direct et sobre",
  curiosite_doux: "curieux et doux",
  expert_pose: "posé, celui de quelqu'un qui connaît le métier",
  chaleureux: "chaleureux et simple",
};

function sansPointFinal(s) {
  return String(s).trim().replace(/[.\s]+$/u, "");
}

/** Les valeurs de chaque crochet, tirées de la config. */
export function valeursConsigne(niche) {
  const interdits = niche.accroche.interdits.map((m) => `« ${m} »`);
  const indices = niche.accroche.motsIndices.map((m) => `« ${m} »`);
  return {
    "équipe": niche.marque.nomEquipe,
    "décideur": niche.cible.decideur,
    "cible": `${sansPointFinal(niche.cible.description)}.`,
    "métiers": `${niche.cible.metiers.join(", ")}`,
    "offre": sansPointFinal(niche.offre.nom),
    "pour qui": `${sansPointFinal(niche.offre.pourQui).replace(/^\p{Lu}/u, (c) => c.toLowerCase())}.`,
    "problème": `${sansPointFinal(niche.offre.probleme)}.`,
    "promesse": `${sansPointFinal(niche.offre.promesse)}.`,
    "ton": TONS[niche.script.ton] ?? "simple",
    "tutoiement ou vouvoiement": niche.script.vouvoiement ? "en vouvoyant (« vous », « votre »)" : "en tutoyant (« tu », « ton »)",
    "mots min": String(MOTS_MIN),
    "mots max": String(MOTS_MAX),
    "longueur max": String(niche.accroche.longueurMax),
    "mots indices": indices.length ? indices.join(", ") : "aucun mot propre à la niche (tout élément précis du site convient)",
    "mots interdits": interdits.length ? interdits.join(", ") : "aucun",
    "exemples": niche.accroche.exemples.map((e) => `  - « ${e} »`).join("\n"),
  };
}

/** Les crochets encore présents dans un texte. */
export function crochetsRestants(texte) {
  return [...String(texte).matchAll(MOTIF_CROCHET)].map((m) => m[0]);
}

/** Le modèle rempli. Lève une erreur si le modèle contient un crochet inconnu. */
export function remplirConsigne(modele, niche) {
  const valeurs = valeursConsigne(niche);
  const inconnus = new Set();
  const rempli = String(modele).replace(MOTIF_CROCHET, (tout, nom) => {
    if (!Object.hasOwn(valeurs, nom)) {
      inconnus.add(tout);
      return tout;
    }
    return valeurs[nom];
  });
  if (inconnus.size > 0) throw new Error(`Crochets inconnus dans le modèle de consigne : ${[...inconnus].join(" ")}`);
  return rempli;
}

export function lireModele(chemin = MODELE_CONSIGNE) {
  return readFileSync(chemin, "utf8");
}

/** La consigne remplie depuis la config donnée. */
export async function consigneDepuisConfig(cheminConfig = CONFIG_PAR_DEFAUT) {
  const { niche } = await chargerConfig(cheminConfig);
  return remplirConsigne(lireModele(), niche);
}

export async function principal(argv, { journal = console.log } = {}) {
  const options = lireOptions(argv, { drapeaux: ["aide"], valeurs: ["config", "sortie"] });
  if (options.aide) {
    journal("Affiche la consigne des accroches remplie depuis config/niche.json (--sortie F pour l'écrire, --config C pour une autre config).");
    return 0;
  }
  const consigne = await consigneDepuisConfig(options.config ?? CONFIG_PAR_DEFAUT);
  if (options.sortie) {
    ecrireTexte(resolve(String(options.sortie)), consigne);
    journal(`Consigne écrite (${consigne.length} caractères).`);
  } else {
    journal(consigne);
  }
  return 0;
}

lancerSiPrincipal(import.meta.url, principal);
