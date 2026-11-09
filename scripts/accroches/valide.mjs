// Étape 6 des accroches : le contrôle anti-invention des réponses de Claude (donnees/accroches/reponses/lot-*.json).
//
//   node scripts/accroches/valide.mjs [--dossier D] [--config C]
//
// Chaque accroche est relue mot à mot contre le texte compacté du site (compact.jsonl) et son extrait contre la page lue (crawl.jsonl) :
// voir lib/validation.mjs pour les règles. Toute accroche signalée est VIDÉE, jamais corrigée : on ne remplace pas une invention par une
// autre. Sorties :
//   - donnees/accroches/validees.json : une entrée par fiche répondue { id, accroche, source: { url, extrait, le }, motifs } ; une
//     accroche vidée garde ses motifs et son texte refusé (champ « refusee », pour la relecture seulement : il n'est jamais écrit en base) ;
//   - donnees/accroches/rapport-validation.md : des compteurs par motif et la liste des fiches vidées (identifiant et motifs).
// La console n'affiche que des compteurs.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lireOptions } from "./lib/args.mjs";
import { CONFIG_PAR_DEFAUT, dossierDeTravail, fichiers } from "./lib/chemins.mjs";
import { chargerConfig } from "./lib/config.mjs";
import { dernieresParId, ecrireJson, ecrireTexte, lireJson, lireJsonl } from "./lib/fichiers.mjs";
import { lancerSiPrincipal } from "./lib/lancer.mjs";
import { LIBELLES_MOTIFS, preparerRegles, validerReponses } from "./lib/validation.mjs";

/** Les entrées de toutes les réponses, dans l'ordre des lots. */
export function lireToutesLesReponses(dossierReponses) {
  const entrees = [];
  let fichiersLus = 0;
  let illisibles = 0;
  if (!existsSync(dossierReponses)) return { entrees, fichiersLus, illisibles };
  for (const nom of readdirSync(dossierReponses).filter((n) => n.endsWith(".json")).sort()) {
    let contenu;
    try {
      contenu = lireJson(join(dossierReponses, nom));
    } catch {
      illisibles++;
      continue;
    }
    if (!Array.isArray(contenu)) {
      illisibles++;
      continue;
    }
    fichiersLus++;
    entrees.push(...contenu);
  }
  return { entrees, fichiersLus, illisibles };
}

/** Le rapport de validation : compteurs, motifs, fiches vidées (identifiants et codes, jamais le texte d'un site). */
export function rendreRapport(compteurs, validees, { sansReponse, date }) {
  const lignes = [
    `# Rapport de validation des accroches (${date})`,
    "",
    "Règle d'or : rien d'inventé. Une accroche signalée est vidée, jamais corrigée.",
    "",
    "| Compteur | Nombre |",
    "|---|---|",
    `| Réponses lues | ${compteurs.lues} |`,
    `| Accroches retenues | ${compteurs.retenues} |`,
    `| Accroches vidées par le contrôle | ${compteurs.videes} |`,
    `| Fiches sans accroche (rien de précis sur le site) | ${compteurs.sansAccroche} |`,
    `| Fiches inconnues du crawl (ignorées) | ${compteurs.inconnues} |`,
    `| Réponses en double (ignorées) | ${compteurs.doublons} |`,
    `| Réponses mal formées (ignorées) | ${compteurs.malFormees} |`,
    `| Fiches à lignes utiles encore sans réponse | ${sansReponse} |`,
    "",
  ];
  const motifs = Object.entries(compteurs.motifs).sort((a, b) => b[1] - a[1]);
  if (motifs.length) {
    lignes.push("## Motifs des accroches vidées", "", "| Motif | Accroches |", "|---|---|");
    for (const [code, n] of motifs) lignes.push(`| ${LIBELLES_MOTIFS[code] ?? code} (${code}) | ${n} |`);
    lignes.push("");
    lignes.push("## Fiches vidées", "");
    for (const v of validees.filter((x) => x.motifs.length > 0)) {
      lignes.push(`- ${v.id} : ${[...new Set(v.motifs.map((m) => m.code))].join(", ")}`);
    }
    lignes.push("");
  }
  return lignes.join("\n");
}

export async function principal(argv, { journal = console.log, maintenant = () => new Date() } = {}) {
  const options = lireOptions(argv, { drapeaux: ["aide"], valeurs: ["dossier", "config"] });
  if (options.aide) {
    journal("Contrôle anti-invention des réponses (reponses/*.json) : écrit validees.json et rapport-validation.md.");
    return 0;
  }
  const f = fichiers(dossierDeTravail(options.dossier));
  const { niche, promesses } = await chargerConfig(options.config ?? CONFIG_PAR_DEFAUT);
  const regles = preparerRegles(niche, promesses);

  const crawls = dernieresParId(lireJsonl(f.crawl).lignes);
  const compacts = dernieresParId(lireJsonl(f.compact).lignes);
  if (crawls.size === 0 || compacts.size === 0) throw new Error("crawl.jsonl ou compact.jsonl absent : lance d'abord crawl.mjs puis compact.mjs.");
  const { entrees, fichiersLus, illisibles } = lireToutesLesReponses(f.reponses);
  if (fichiersLus === 0) throw new Error("Aucun fichier de réponse lisible dans reponses/ : Claude écrit d'abord les accroches des lots.");

  const { validees, compteurs } = validerReponses(entrees, { compacts, crawls, regles, fuseau: niche.pays.fuseau });
  const repondus = new Set(validees.map((v) => v.id));
  const sansReponse = [...compacts.values()].filter((c) => !c.erreur && c.indices?.length > 0 && !repondus.has(c.id)).length;

  ecrireJson(f.validees, validees);
  const date = maintenant().toISOString().slice(0, 10);
  ecrireTexte(f.rapport, `${rendreRapport(compteurs, validees, { sansReponse, date })}\n`);

  const motifs = Object.entries(compteurs.motifs)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code} ${n}`)
    .join(", ");
  journal(`Réponses : ${compteurs.lues} (fichiers lus : ${fichiersLus}${illisibles ? `, illisibles : ${illisibles}` : ""}).`);
  journal(`Retenues : ${compteurs.retenues} ; vidées : ${compteurs.videes} ; sans accroche : ${compteurs.sansAccroche} ; inconnues : ${compteurs.inconnues} ; doublons : ${compteurs.doublons} ; mal formées : ${compteurs.malFormees}.`);
  if (motifs) journal(`Motifs : ${motifs}.`);
  if (sansReponse) journal(`Fiches à lignes utiles encore sans réponse : ${sansReponse} (lots non répondus ?).`);
  return 0;
}

lancerSiPrincipal(import.meta.url, principal);
