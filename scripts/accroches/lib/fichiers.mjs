// Lecture et écriture des fichiers de travail (JSON et JSONL). Écriture atomique : un fichier à moitié écrit n'existe jamais.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function lireJson(chemin, { defaut } = {}) {
  if (!existsSync(chemin)) {
    if (defaut !== undefined) return defaut;
    throw new Error(`Fichier absent : ${chemin}`);
  }
  try {
    return JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    throw new Error(`JSON illisible : ${chemin}`);
  }
}

export function ecrireTexte(chemin, texte) {
  mkdirSync(dirname(chemin), { recursive: true });
  const temporaire = `${chemin}.${process.pid}.tmp`;
  writeFileSync(temporaire, texte);
  renameSync(temporaire, chemin);
}

export function ecrireJson(chemin, valeur) {
  ecrireTexte(chemin, `${JSON.stringify(valeur, null, 2)}\n`);
}

/** Les lignes d'un JSONL (une ligne illisible, par exemple coupée par un arrêt brutal, est ignorée et comptée). */
export function lireJsonl(chemin) {
  if (!existsSync(chemin)) return { lignes: [], illisibles: 0 };
  const lignes = [];
  let illisibles = 0;
  for (const brut of readFileSync(chemin, "utf8").split("\n")) {
    if (!brut.trim()) continue;
    try {
      lignes.push(JSON.parse(brut));
    } catch {
      illisibles++;
    }
  }
  return { lignes, illisibles };
}

/** La dernière ligne de chaque identifiant (une reprise ajoute une ligne : c'est elle qui compte). */
export function dernieresParId(lignes) {
  const parId = new Map();
  for (const l of lignes) if (l && typeof l.id === "string") parId.set(l.id, l);
  return parId;
}

export function ajouterLigne(chemin, objet) {
  mkdirSync(dirname(chemin), { recursive: true });
  appendFileSync(chemin, `${JSON.stringify(objet)}\n`);
}
