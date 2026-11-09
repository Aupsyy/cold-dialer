// Lecture et écriture de fichiers CSV (RFC 4180), sans dépendance.
//
//   - Un champ entre guillemets doubles peut contenir le séparateur, un retour à la ligne et des guillemets (un guillemet s'écrit "").
//   - Fins de ligne CRLF, LF ou CR ; BOM UTF-8 accepté (et retiré) ; les lignes entièrement vides sont ignorées.
//   - Séparateur : virgule ou point-virgule, détecté sur la première ligne (en dehors des guillemets).
//   - La première ligne est l'en-tête. Les noms de colonnes sont normalisés : minuscules, sans accents, « _ » entre les mots
//     (« Code postal » devient code_postal, « Téléphone » devient telephone).
//   - L'écriture se fait en point-virgule, avec BOM et fins de ligne CRLF : Excel en français ouvre le fichier tel quel.
//   - Formules : une cellule qui commence par =, @, ou par + ou - suivis d'autre chose qu'un chiffre, est écrite précédée d'une
//     apostrophe, pour qu'un tableur ne l'exécute jamais (injection de formule) ; la lecture retire cette apostrophe.
// Les messages d'erreur ne citent jamais le contenu d'une cellule : seulement un numéro de ligne.

export class ErreurCsv extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurCsv";
  }
}

const BOM = "﻿";

/** Le texte d'un fichier : de l'UTF-8 strict (avec ou sans BOM). Sinon une erreur qui dit comment réenregistrer le fichier. */
export function decoderUtf8(octets) {
  try {
    // TextDecoder retire lui-même un BOM en tête.
    return new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    throw new ErreurCsv("Le fichier n'est pas en UTF-8 : réenregistre-le au format « CSV UTF-8 » (Excel, Numbers, LibreOffice), puis relance.");
  }
}

/** Le séparateur de la première ligne : point-virgule s'il y en a plus que de virgules (hors guillemets), sinon virgule. */
export function detecterSeparateur(texte) {
  let virgules = 0;
  let pointsVirgules = 0;
  let entre = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (c === '"') entre = !entre;
    else if (!entre) {
      if (c === "\n" || c === "\r") break;
      if (c === ",") virgules++;
      else if (c === ";") pointsVirgules++;
    }
  }
  return pointsVirgules > virgules ? ";" : ",";
}

/**
 * Découpe le texte en rangées de champs (tableaux de chaînes). Chaque rangée porte le numéro de la ligne physique où elle commence
 * (propriété ligne). Lève ErreurCsv si un guillemet ouvert n'est jamais refermé.
 */
export function decouper(texte, separateur = ",") {
  if (separateur.length !== 1 || separateur === '"' || separateur === "\n" || separateur === "\r") {
    throw new ErreurCsv("Séparateur invalide.");
  }
  const brut = texte.startsWith(BOM) ? texte.slice(1) : texte;
  const rangees = [];
  let rangee = [];
  let champ = "";
  let entre = false; // dans un champ entre guillemets
  let commence = false; // la rangée a commencé (au moins un caractère ou un séparateur)
  let ligne = 1;
  let debutRangee = 1;
  let ouverture = 1;

  const finChamp = () => {
    rangee.push(champ);
    champ = "";
  };
  const finRangee = () => {
    finChamp();
    rangees.push(Object.assign(rangee, { ligne: debutRangee }));
    rangee = [];
    commence = false;
  };

  for (let i = 0; i < brut.length; i++) {
    const c = brut[i];
    if (entre) {
      if (c === '"') {
        if (brut[i + 1] === '"') {
          champ += '"';
          i++;
        } else entre = false;
      } else {
        if (c === "\n" || (c === "\r" && brut[i + 1] !== "\n")) ligne++;
        champ += c;
      }
      continue;
    }
    if (!commence) {
      commence = true;
      debutRangee = ligne;
    }
    if (c === '"' && champ === "") {
      entre = true;
      ouverture = ligne;
    } else if (c === separateur) {
      finChamp();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && brut[i + 1] === "\n") i++;
      finRangee();
      ligne++;
    } else {
      champ += c;
    }
  }
  if (entre) throw new ErreurCsv(`CSV illisible : un guillemet ouvert ligne ${ouverture} n'est jamais refermé.`);
  if (commence || champ !== "" || rangee.length > 0) finRangee();
  return rangees;
}

/** Un nom de colonne normalisé : minuscules, sans accents, tout ce qui n'est ni lettre ni chiffre devient « _ ». */
export function normaliserEntete(nom) {
  return String(nom ?? "")
    .replace(/œ/gi, "oe")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Retire l'apostrophe de protection posée par ecrireCsv devant une cellule qui ressemble à une formule. */
function sansProtection(valeur) {
  return /^'[=+\-@\t\r]/.test(valeur) ? valeur.slice(1) : valeur;
}

/**
 * Lit un CSV : { colonnes, lignes, separateur }. colonnes : les noms normalisés de l'en-tête (un nom en double n'est gardé qu'une
 * fois). lignes : un objet par ligne de données { colonne: valeur }, plus deux propriétés non énumérables : ligne (numéro de la ligne
 * dans le fichier) et enTrop (vrai si la ligne a des valeurs au-delà des colonnes de l'en-tête).
 */
export function lireCsv(texte, { separateur } = {}) {
  const brut = String(texte ?? "");
  const sep = separateur ?? detecterSeparateur(brut.startsWith(BOM) ? brut.slice(1) : brut);
  const rangees = decouper(brut, sep).filter((r) => r.some((v) => v.trim() !== ""));
  if (rangees.length === 0) return { colonnes: [], lignes: [], separateur: sep };
  const entete = rangees[0].map(normaliserEntete);
  const colonnes = [];
  const indices = [];
  entete.forEach((nom, k) => {
    if (nom !== "" && !colonnes.includes(nom)) {
      colonnes.push(nom);
      indices.push(k);
    }
  });
  const lignes = rangees.slice(1).map((r) => {
    const objet = {};
    colonnes.forEach((nom, j) => {
      objet[nom] = sansProtection(r[indices[j]] ?? "");
    });
    const enTrop = r.length > entete.length && r.slice(entete.length).some((v) => v.trim() !== "");
    Object.defineProperty(objet, "ligne", { value: r.ligne, enumerable: false });
    Object.defineProperty(objet, "enTrop", { value: enTrop, enumerable: false });
    return objet;
  });
  return { colonnes, lignes, separateur: sep };
}

/**
 * Une cellule prête à écrire : apostrophe devant tout ce qu'un tableur prendrait pour une formule (début par = + - @, tabulation ou
 * retour), sauf un nombre (« +33199000101 », « -5 », « 4,5 ») ; guillemets si elle contient le séparateur, un guillemet ou un retour.
 * « +1+cmd|… » ou « -1+LIEN(…) » commencent par un chiffre après le signe, mais ne sont pas des nombres : désamorcés aussi.
 */
export function cellule(valeur, separateur = ";") {
  let v = valeur === null || valeur === undefined ? "" : String(valeur);
  if (/^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+(?:[.,]\d+)?$/.test(v)) v = `'${v}`;
  if (v.includes(separateur) || v.includes('"') || v.includes("\n") || v.includes("\r")) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Écrit un CSV : l'en-tête (colonnes), puis une ligne par objet (les clés absentes donnent une cellule vide). */
export function ecrireCsv(colonnes, lignes, { separateur = ";", bom = true, finDeLigne = "\r\n" } = {}) {
  const sortie = [colonnes.map((c) => cellule(c, separateur)).join(separateur)];
  for (const objet of lignes) sortie.push(colonnes.map((c) => cellule(objet[c], separateur)).join(separateur));
  return (bom ? BOM : "") + sortie.join(finDeLigne) + finDeLigne;
}
