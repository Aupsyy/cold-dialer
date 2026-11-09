// robots.txt, selon la norme (RFC 9309) :
//   - le groupe dont un « User-agent » est le jeton de notre robot (sans casse) s'applique seul ; sinon le groupe « * » ; sinon rien ;
//   - plusieurs groupes pour le même robot se cumulent ;
//   - la règle la plus longue qui correspond gagne ; à longueur égale, Allow gagne ; « * » remplace n'importe quelle suite, « $ » ancre
//     la fin ; « Disallow: » vide ne ferme rien ;
//   - Crawl-delay (hors norme mais courant) est lu et respecté par le crawl.
// Ce que le crawl fait du code de réponse de robots.txt (lib/http.mjs, crawl.mjs) : 2xx → ces règles ; 4xx → rien n'est fermé ;
// 429, 5xx ou serveur injoignable → tout est fermé (le site est laissé de côté).
// La correspondance d'un motif est linéaire (algorithme du parseur robots.txt de Google, sans expression régulière construite depuis
// le fichier) : un robots.txt hostile (« Disallow: /*a*a*a*a*a*a*a*a*a*a*b ») ne bloque jamais le script. Un robots.txt trop lourd
// (plus de MAX_REGLES règles ou MAX_CARACTERES_REGLES caractères de motifs pour notre robot) ferme tout le site ; un chemin de plus de
// MAX_CHEMIN caractères n'est jamais lu. Ce module sert au crawl des accroches ET à la recherche d'e-mails (scripts/sourcing/emails.mjs).

import { telecharger } from "./http.mjs";

/** Au-delà, les règles qui s'appliquent à notre robot sont jugées trop lourdes à suivre : tout le site est fermé. */
export const MAX_REGLES = 500;
export const MAX_CARACTERES_REGLES = 20_000;
/** Un chemin (avec sa requête) plus long n'est jamais lu : une vraie page en est très loin. */
export const MAX_CHEMIN = 2000;

/** @returns {{ agents: string[], regles: { permis: boolean, motif: string }[], delai: number | null }[]} */
export function analyserRobots(texte) {
  const groupes = [];
  let courant = null;
  let ligneAgentPrecedente = false;
  for (const brut of String(texte ?? "").split(/\r\n|\r|\n/)) {
    const ligne = brut.replace(/#.*$/, "").trim();
    if (!ligne) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(ligne);
    if (!m) continue;
    const cle = m[1].toLowerCase();
    const valeur = m[2].trim();
    if (cle === "user-agent") {
      if (!courant || !ligneAgentPrecedente) {
        courant = { agents: [], regles: [], delai: null };
        groupes.push(courant);
      }
      courant.agents.push(valeur.split("/")[0].trim().toLowerCase());
      ligneAgentPrecedente = true;
      continue;
    }
    ligneAgentPrecedente = false;
    if (!courant) continue;
    if (cle === "allow" || cle === "disallow") {
      if (valeur) courant.regles.push({ permis: cle === "allow", motif: valeur });
    } else if (cle === "crawl-delay") {
      const n = Number(valeur.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) courant.delai = Math.max(courant.delai ?? 0, n);
    }
  }
  return groupes;
}

/**
 * Les règles qui s'appliquent à notre robot.
 * @returns {{ regles: { permis: boolean, motif: string }[], delai: number | null, groupe: "specifique" | "general" | "aucun" }}
 */
export function reglesPour(groupes, jeton) {
  const j = String(jeton).trim().toLowerCase();
  const specifiques = groupes.filter((g) => g.agents.includes(j));
  const choisis = specifiques.length > 0 ? specifiques : groupes.filter((g) => g.agents.includes("*"));
  const delais = choisis.map((g) => g.delai).filter((d) => d !== null);
  const regles = choisis.flatMap((g) => g.regles);
  const caracteres = regles.reduce((n, r) => n + r.motif.length, 0);
  // Trop de règles à suivre : on ne lit rien plutôt que de risquer de lire une page fermée.
  const tropLourd = regles.length > MAX_REGLES || caracteres > MAX_CARACTERES_REGLES;
  return {
    regles: tropLourd ? [{ permis: false, motif: "/" }] : regles,
    delai: delais.length > 0 ? Math.max(...delais) : null,
    groupe: specifiques.length > 0 ? "specifique" : choisis.length > 0 ? "general" : "aucun",
  };
}

function decoder(s) {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** Le motif d'une règle, décodé, qui commence par « / » (ou « * »). */
function motifNormalise(motif) {
  const m = decoder(motif);
  return m.startsWith("/") || m.startsWith("*") ? m : `/${m}`;
}

/**
 * Vrai si le chemin commence par le motif : « * » remplace n'importe quelle suite (même vide), « $ » en dernier ancre la fin du
 * chemin (ailleurs, c'est un caractère comme un autre). L'algorithme Matches() du parseur robots.txt de Google : on tient la liste
 * des longueurs de préfixe du chemin qui correspondent au début du motif, mise à jour caractère par caractère du motif. Au plus
 * |motif| × |chemin| étapes, sans aucun retour arrière : un motif à vingt étoiles se décide en quelques microsecondes.
 */
export function motifCorrespond(motif, chemin) {
  const n = chemin.length;
  const positions = new Int32Array(n + 1);
  let nombre = 1;
  for (let k = 0; k < motif.length; k++) {
    const c = motif[k];
    if (c === "$" && k === motif.length - 1) return positions[nombre - 1] === n;
    if (c === "*") {
      // Toutes les positions à partir de la plus courte (la liste reste triée).
      const depuis = positions[0];
      nombre = n - depuis + 1;
      for (let i = 1; i < nombre; i++) positions[i] = depuis + i;
      continue;
    }
    let suivantes = 0;
    for (let i = 0; i < nombre; i++) {
      const p = positions[i];
      if (p < n && chemin[p] === c) positions[suivantes++] = p + 1;
    }
    if (suivantes === 0) return false;
    nombre = suivantes;
  }
  return true;
}

/**
 * Vrai si notre robot peut lire ce chemin (« /realisations/?page=2 » : chemin et requête). robots.txt lui-même est toujours permis ;
 * un chemin de plus de MAX_CHEMIN caractères ne l'est jamais.
 */
export function cheminAutorise(regles, chemin) {
  const c = decoder(chemin || "/");
  if (c === "/robots.txt") return true;
  if (c.length > MAX_CHEMIN) return false;
  let meilleure = null;
  for (const r of regles) {
    if (!motifCorrespond(motifNormalise(r.motif), c)) continue;
    const longueur = decoder(r.motif).length;
    if (!meilleure || longueur > meilleure.longueur || (longueur === meilleure.longueur && r.permis)) {
      meilleure = { longueur, permis: r.permis };
    }
  }
  return meilleure ? meilleure.permis : true;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lire le robots.txt d'un site (crawl des accroches et recherche d'e-mails : une seule implémentation)
// ---------------------------------------------------------------------------------------------------------------------------------

export const TAILLE_MAX_ROBOTS = 500_000;
export const MAX_REDIRECTIONS_ROBOTS = 5;
const ROBOTS_ABSENT = { regles: [], delai: null, groupe: "aucun" };

/**
 * Lit le robots.txt d'une origine (lib/http.mjs : délai, taille bornée, redirections rendues), en suivant 5 redirections au plus :
 * chaque saut est d'abord contrôlé (adresseSure : hôte public, DNS, port, ni réseau social ni annuaire), puis cadencé (attendreTour).
 * 2xx → les règles de notre robot ; 4xx (sauf 429) → « absent », rien n'est fermé ; 429, 5xx, redirection refusée ou sans fin →
 * « indisponible », tout est fermé (RFC 9309) ; aucune réponse → joignable: false.
 * @param {string} origine « https://www.example.org »
 * @param {{ adresseSure: (url: string) => Promise<boolean>, attendreTour: (url: string) => Promise<void>, compter?: () => void,
 *   http: object, jeton: string }} options http : les options de telecharger (fetch, userAgent, delaiMs)
 * @returns {Promise<{ joignable: false } | { joignable: true, etat: "lu" | "absent" | "indisponible", regles: { permis: boolean, motif: string }[], delai: number | null, groupe: string }>}
 */
export async function lireRobotsDistant(origine, { adresseSure, attendreTour, compter = () => {}, http, jeton }) {
  let url = `${origine}/robots.txt`;
  for (let saut = 0; saut <= MAX_REDIRECTIONS_ROBOTS; saut++) {
    if (!(await adresseSure(url))) break;
    await attendreTour(url);
    compter();
    const r = await telecharger(url, { ...http, types: null, tailleMax: TAILLE_MAX_ROBOTS });
    if (r.redirection !== undefined) {
      if (!r.redirection) break;
      url = r.redirection;
      continue;
    }
    if (r.statut === 0) return { joignable: false };
    if (r.statut >= 200 && r.statut < 300) return { joignable: true, etat: "lu", ...reglesPour(analyserRobots(r.texte), jeton) };
    if (r.statut >= 400 && r.statut < 500 && r.statut !== 429) return { joignable: true, etat: "absent", ...ROBOTS_ABSENT };
    return { joignable: true, etat: "indisponible", ...ROBOTS_ABSENT };
  }
  return { joignable: true, etat: "indisponible", ...ROBOTS_ABSENT };
}
