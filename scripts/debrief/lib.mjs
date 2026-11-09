// Les fonctions du débrief d'un appel (docs/debrief.md) : validation STRICTE du JSON écrit par Claude Code contre la config de la niche,
// recherche de la fiche, composition de la note datée (« clé : valeur ») et des lignes à écrire. Aucune connexion ici : la recherche de
// fiche reçoit une fonction `requete(sql, params) → lignes` (la base, sous la RLS du compte, ou une base simulée dans les tests).
// Testé par tests/debrief-*.test.mjs, sur des données fictives seulement.
//
// Règles : rien d'inventé (ce qui n'a pas été dit reste vide), citations mot pour mot (vérifiées dans la transcription quand elle est là),
// codes contraints (issues, objections et champs viennent de config/niche.json). Les messages d'erreur ne recopient jamais une valeur du
// JSON (ni nom, ni numéro, ni citation) : seulement le chemin et ce qui est permis.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const VERSION_DEBRIEF = 1;

/** D'où vient la transcription (debriefs.source). */
export const SOURCES = ["colle", "fichier", "appel", "notes_mac"];
export const LOCUTEURS = ["appelant", "prospect"];
/** Le verdict de l'accroche dans le JSON, et sa valeur en base (retours_marche.accroche_verdict). Même table que lib/retours/libelles.ts. */
export const VERDICTS = ["utile", "neutre", "contre-productive"];
export const VERDICT_EN_BASE = { utile: "accroche", neutre: "neutre", "contre-productive": "rejet" };
export const PROCHAINES_ETAPES = ["rdv", "rappel", "mail", "aucune", "autre"];
export const FOURNISSEURS = ["onoff", "aircall", "ringover", "softphone", "telephone"];

/** Les clés réservées de « extraction » : un champ de découverte ne peut pas porter l'un de ces noms. */
export const CLES_EXTRACTION = [
  "resume",
  "issue",
  "objection",
  "objection_texte",
  "interet",
  "decideur_joint",
  "douleurs",
  "croyances",
  "citations",
  "prochaine_etape",
  "tags",
  "urgent",
];
const CLES_RACINE = ["version", "creer_si_absent", "source", "lead", "appel", "transcription", "extraction", "verdict_accroche"];
const CLES_LEAD = ["id", "telephone", "entreprise", "ville", "dirigeant"];
const CLES_APPEL = ["debut", "duree_s", "externe_id", "fournisseur"];
const CLES_ETAPE = ["type", "date", "detail"];

/** Les bornes : celles de la base (0001) ou plus serrées. Un texte trop long est REFUSÉ, jamais coupé (une citation coupée ment). */
export const BORNES = {
  entreprise: 200,
  ville: 120,
  dirigeant: 160,
  resume: 600,
  douleur: 400,
  douleurs: 10,
  croyance: 300,
  croyances: 10,
  citation: 300,
  citations: 10,
  citationCourte: 12,
  champ: 600,
  objectionTexte: 400,
  tag: 40,
  tags: 10,
  tagsTotal: 400,
  detail: 300,
  ligne: 4000,
  lignes: 5000,
  transcription: 200_000,
  extractionOctets: 60_000,
  note: 5000,
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_ISO_FUSEAU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const RE_EXTERNE = /^[A-Za-z0-9_.:-]{1,80}$/;
const RE_TAG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** Une avance de 10 minutes sur l'horloge est tolérée (horloges décalées). */
const AVANCE_TOLEREE_MS = 10 * 60_000;

// ---------------------------------------------------------------------------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------------------------------------------------------------------------

export function estObjet(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function estUuid(v) {
  return typeof v === "string" && RE_UUID.test(v);
}

/** Vide : absent, null, chaîne blanche, tableau ou objet vide. */
export function vide(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (estObjet(v)) return Object.keys(v).length === 0;
  return false;
}

/** Une date ISO 8601 AVEC fuseau (« 2026-11-09T15:20:00+01:00 » ou « …Z »), entre 2000 et 2100 : renvoyée en ISO UTC, sinon null. */
export function dateIsoStricte(v) {
  if (typeof v !== "string" || v.length > 40 || !RE_ISO_FUSEAU.test(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const annee = d.getUTCFullYear();
  return annee >= 2000 && annee < 2100 ? d.toISOString() : null;
}

/** Un numéro au format E.164, ou null (même règle que la fonction SQL normaliser_e164). */
export function normaliserTelephone(numero, pays = "FR") {
  let v = String(numero ?? "")
    .trim()
    .replace(/[\s.()/-]/gu, "");
  const indicatif = { FR: "33", BE: "32", CH: "41", LU: "352", MC: "377", CA: "1" }[String(pays ?? "FR").toUpperCase()] ?? null;
  if (v === "") return null;
  if (/^00[1-9]/.test(v)) {
    v = `+${v.slice(2)}`;
  } else if (!v.startsWith("+")) {
    if (indicatif === "1" && /^1?[2-9]\d{9}$/.test(v)) v = `+1${v.slice(-10)}`;
    else if (indicatif && indicatif !== "1" && /^0[1-9]\d{4,13}$/.test(v)) v = `+${indicatif}${v.slice(1)}`;
    else if (indicatif && new RegExp(`^${indicatif}[1-9]\\d{4,13}$`).test(v)) v = `+${v}`;
    else return null;
  }
  v = v.replace(/^\+(33|32|41|352|377)0(?=[1-9])/, "+$1");
  if (v.startsWith("+33") && !/^\+33[1-9]\d{8}$/.test(v)) return null;
  return /^\+[1-9]\d{5,14}$/.test(v) ? v : null;
}

/** Les 9 derniers chiffres d'un numéro (rapprochement d'une fiche, comme la fonction SQL tel9), ou null s'il y en a moins de 9. */
export function tel9(numero) {
  const chiffres = String(numero ?? "").replace(/\D/g, "");
  return chiffres.length >= 9 ? chiffres.slice(-9) : null;
}

/** Un nom d'entreprise comparable : minuscules, sans accents ni ponctuation, espaces réduits. */
export function normaliserNom(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[œ]/g, "oe")
    .replace(/[æ]/g, "ae")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Un texte comparable pour la vérification « mot pour mot » : mêmes mots, mêmes signes ; seuls l'apostrophe, les guillemets, les
 * espaces (y compris avant la ponctuation) et la casse sont ramenés à une seule forme. */
export function pourComparer(t) {
  return String(t ?? "")
    .normalize("NFC")
    .replace(/[’‘ʼ`´]/gu, "'")
    .replace(/[«»“”„"]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/ ([?!:;,.…])/gu, "$1")
    .trim()
    .toLowerCase();
}

/** Une citation sans les guillemets ni les points de suspension ajoutés autour. */
export function citationNette(t) {
  return pourComparer(t)
    .replace(/^(?:\.{3}|…|\s)+/u, "")
    .replace(/(?:\.{3}|…|\s)+$/u, "")
    .trim();
}

/**
 * Chaque citation se retrouve-t-elle telle quelle dans ce que le PROSPECT a dit ? Renvoie les rangs introuvables, et ceux qui ne
 * viennent que de l'appelant (une citation du marché est une phrase du prospect). Une ligne « inconnu » (transcription d'un fournisseur)
 * compte comme prospect.
 */
export function verifierCitations(citations, lignes) {
  const prospect = pourComparer(lignes.filter((l) => l.locuteur !== "appelant").map((l) => l.texte).join(" "));
  const appelant = pourComparer(lignes.filter((l) => l.locuteur === "appelant").map((l) => l.texte).join(" "));
  const introuvables = [];
  const deLAppelant = [];
  citations.forEach((c, i) => {
    const n = citationNette(c);
    if (n !== "" && prospect.includes(n)) return;
    if (n !== "" && appelant.includes(n)) deLAppelant.push(i);
    else introuvables.push(i);
  });
  return { introuvables, deLAppelant };
}

/** Les champs de découverte : config.debrief.champs, puis les questions du script (même id : le champ du débrief l'emporte). */
export function champsDecouverte(niche) {
  const champs = niche.debrief.champs.map((c) => ({ id: c.id, question: c.question }));
  for (const q of niche.script.questions) if (!champs.some((c) => c.id === q.id)) champs.push({ id: q.id, question: q.texte });
  return champs;
}

/** Les codes permis par la config : issues, objections (« libre » compris, ajoutée par le chargeur), champs. */
export function codesPermis(niche) {
  const objections = niche.objections.map((o) => o.code);
  if (!objections.includes("libre")) objections.push("libre");
  return { issues: niche.issues.map((i) => i.code), objections, champs: champsDecouverte(niche).map((c) => c.id) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validation du JSON (schéma : docs/debrief.md)
// ---------------------------------------------------------------------------------------------------------------------------------

function clesInconnues(objet, permises) {
  return Object.keys(objet).filter((k) => !permises.includes(k));
}

/** Une chaîne facultative bornée : null si absente ou vide ; sinon la chaîne nettoyée (erreur si trop longue ou d'un autre type). */
function chaineFacultative(v, chemin, max, err) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    err(chemin, "texte attendu (ou null)");
    return null;
  }
  const t = v.replace(/\s+/gu, " ").trim();
  if (t === "") return null;
  if (t.length > max) {
    err(chemin, `${max} caractères au plus (raccourcis sans réécrire)`);
    return null;
  }
  return t;
}

function listeTextes(v, chemin, maxElements, maxLongueur, err) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) {
    err(chemin, "liste de textes attendue ([] si rien n'a été dit)");
    return [];
  }
  if (v.length > maxElements) err(chemin, `${maxElements} éléments au plus`);
  const sortie = [];
  v.slice(0, maxElements).forEach((x, i) => {
    if (typeof x !== "string") return err(`${chemin}[${i}]`, "texte attendu");
    if (x.trim() === "") return err(`${chemin}[${i}]`, "élément vide (retire-le)");
    const t = chaineFacultative(x, `${chemin}[${i}]`, maxLongueur, err);
    if (t !== null) sortie.push(t);
  });
  return sortie;
}

/**
 * Valide le JSON d'un débrief contre la config. Renvoie { ok, erreurs, avertissements, donnees } ; `donnees` est la forme normalisée
 * utilisée par les écritures (null si erreur). `maintenant` : l'heure de référence (tests).
 */
export function validerDebrief(entree, niche, { maintenant = Date.now() } = {}) {
  const erreurs = [];
  const avertissements = [];
  const err = (chemin, message) => erreurs.push(`${chemin} : ${message}`);
  const echec = () => ({ ok: false, erreurs, avertissements, donnees: null });
  if (!estObjet(entree)) {
    erreurs.push("le fichier doit contenir un objet JSON (voir docs/debrief.md)");
    return echec();
  }
  const permis = codesPermis(niche);
  const reserves = permis.champs.filter((c) => CLES_EXTRACTION.includes(c));
  if (reserves.length > 0) {
    erreurs.push(`config : champ de découverte au nom réservé (${reserves.join(", ")}) : renomme-le dans config/niche.json`);
    return echec();
  }

  for (const k of clesInconnues(entree, CLES_RACINE)) err(k, `clé inconnue (clés permises : ${CLES_RACINE.join(", ")})`);
  if (entree.version !== undefined && entree.version !== VERSION_DEBRIEF) err("version", `seule la version ${VERSION_DEBRIEF} existe`);
  if (entree.creer_si_absent !== undefined && typeof entree.creer_si_absent !== "boolean") err("creer_si_absent", "true ou false");
  const creerSiAbsent = entree.creer_si_absent === true;

  // L'appel.
  const a = entree.appel;
  let appel = { debut: null, dureeS: null, externeId: null, fournisseur: null };
  if (!estObjet(a)) {
    err("appel", "objet obligatoire (au moins appel.debut, ou appel.externe_id pour un appel déjà en base)");
  } else {
    for (const k of clesInconnues(a, CLES_APPEL)) err(`appel.${k}`, `clé inconnue (clés permises : ${CLES_APPEL.join(", ")})`);
    let externeId = null;
    if (a.externe_id !== undefined && a.externe_id !== null) {
      if (typeof a.externe_id === "string" && RE_EXTERNE.test(a.externe_id)) externeId = a.externe_id;
      else err("appel.externe_id", "identifiant de l'appel chez le fournisseur (lettres, chiffres, _ . : -, 80 au plus)");
    }
    let fournisseur = null;
    if (a.fournisseur !== undefined && a.fournisseur !== null) {
      if (FOURNISSEURS.includes(a.fournisseur)) fournisseur = a.fournisseur;
      else err("appel.fournisseur", `fournisseur inconnu (permis : ${FOURNISSEURS.join(", ")})`);
    }
    if (externeId && !fournisseur) fournisseur = niche.telephonie.fournisseur;
    let debut = null;
    if (a.debut !== undefined && a.debut !== null) {
      debut = dateIsoStricte(a.debut);
      if (!debut) err("appel.debut", "date ISO 8601 avec fuseau attendue (ex. 2026-11-09T15:20:00+01:00)");
      else if (Date.parse(debut) > maintenant + AVANCE_TOLEREE_MS) {
        err("appel.debut", "date dans le futur");
        debut = null;
      }
    } else if (!externeId) {
      err("appel.debut", "obligatoire (l'heure de début de l'appel, avec fuseau)");
    }
    let dureeS = null;
    if (a.duree_s !== undefined && a.duree_s !== null) {
      if (Number.isInteger(a.duree_s) && a.duree_s >= 0 && a.duree_s <= 86_400) dureeS = a.duree_s;
      else err("appel.duree_s", "entier de 0 à 86400 secondes (ou null)");
    }
    appel = { debut, dureeS, externeId, fournisseur };
  }

  // La fiche.
  const l = entree.lead;
  let lead = { id: null, telephone: null, e164: null, entreprise: null, ville: null, dirigeant: null };
  if (l !== undefined && l !== null && !estObjet(l)) {
    err("lead", "objet attendu ({ id, telephone, entreprise })");
  } else if (estObjet(l)) {
    for (const k of clesInconnues(l, CLES_LEAD)) err(`lead.${k}`, `clé inconnue (clés permises : ${CLES_LEAD.join(", ")})`);
    let id = null;
    if (l.id !== undefined && l.id !== null) {
      if (estUuid(l.id)) id = l.id.toLowerCase();
      else err("lead.id", "identifiant de fiche (uuid) attendu");
    }
    let telephone = null;
    if (l.telephone !== undefined && l.telephone !== null && !(typeof l.telephone === "string" && l.telephone.trim() === "")) {
      if (typeof l.telephone === "string" && l.telephone.trim().length <= 30 && tel9(l.telephone)) telephone = l.telephone.trim();
      else err("lead.telephone", "numéro illisible (9 chiffres au moins, 30 caractères au plus)");
    }
    lead = {
      id,
      telephone,
      e164: telephone ? normaliserTelephone(telephone, niche.pays.code) : null,
      entreprise: chaineFacultative(l.entreprise, "lead.entreprise", BORNES.entreprise, err),
      ville: chaineFacultative(l.ville, "lead.ville", BORNES.ville, err),
      dirigeant: chaineFacultative(l.dirigeant, "lead.dirigeant", BORNES.dirigeant, err),
    };
  }
  if (!lead.id && !lead.telephone && !lead.entreprise && !appel.externeId) {
    err("lead", "il faut lead.id, lead.telephone ou lead.entreprise (ou appel.externe_id d'un appel rattaché à sa fiche)");
  }
  if (creerSiAbsent && !lead.entreprise) err("creer_si_absent", "lead.entreprise est obligatoire pour créer la fiche");

  // La source de la transcription.
  let source = appel.externeId ? "appel" : "colle";
  if (entree.source !== undefined && entree.source !== null) {
    if (SOURCES.includes(entree.source)) source = entree.source;
    else err("source", `source inconnue (permises : ${SOURCES.join(", ")})`);
  }
  if (source === "appel" && !appel.externeId) err("source", "« appel » exige appel.externe_id (l'appel en base)");

  // La transcription : [{ locuteur, texte }].
  const transcription = [];
  if (entree.transcription !== undefined && entree.transcription !== null) {
    if (!Array.isArray(entree.transcription)) {
      err("transcription", "liste attendue ([] si elle est déjà en base ou absente)");
    } else {
      if (entree.transcription.length > BORNES.lignes) err("transcription", `${BORNES.lignes} énoncés au plus`);
      let total = 0;
      entree.transcription.slice(0, BORNES.lignes).forEach((u, i) => {
        const chemin = `transcription[${i}]`;
        if (!estObjet(u)) return err(chemin, "objet { locuteur, texte } attendu");
        for (const k of clesInconnues(u, ["locuteur", "texte"])) err(`${chemin}.${k}`, "clé inconnue (locuteur, texte)");
        if (!LOCUTEURS.includes(u.locuteur)) err(`${chemin}.locuteur`, `« appelant » ou « prospect »`);
        if (typeof u.texte !== "string" || u.texte.trim() === "") return err(`${chemin}.texte`, "texte non vide attendu");
        const t = u.texte.replace(/\s+/gu, " ").trim();
        if (t.length > BORNES.ligne) return err(`${chemin}.texte`, `${BORNES.ligne} caractères au plus par énoncé`);
        total += t.length + 12;
        if (LOCUTEURS.includes(u.locuteur)) transcription.push({ locuteur: u.locuteur, texte: t });
      });
      if (total > BORNES.transcription) err("transcription", `${BORNES.transcription} caractères au plus au total`);
    }
  }

  // L'extraction.
  const x = entree.extraction;
  let extraction = null;
  if (!estObjet(x)) {
    err("extraction", "objet obligatoire (voir docs/debrief.md)");
  } else {
    const permises = [...CLES_EXTRACTION, ...permis.champs];
    for (const k of clesInconnues(x, permises)) {
      err(`extraction.${k}`, `clé inconnue (champs de la config : ${permis.champs.join(", ")})`);
    }
    let issue = null;
    if (typeof x.issue === "string" && permis.issues.includes(x.issue)) issue = x.issue;
    else err("extraction.issue", `code d'issue obligatoire (permis : ${permis.issues.join(", ")})`);

    let objection = null;
    if (x.objection !== undefined && x.objection !== null) {
      if (typeof x.objection === "string" && permis.objections.includes(x.objection)) objection = x.objection;
      else err("extraction.objection", `code inconnu (permis : ${permis.objections.join(", ")}, ou null)`);
    }
    const objectionTexte = chaineFacultative(x.objection_texte, "extraction.objection_texte", BORNES.objectionTexte, err);
    if (objectionTexte && !objection) err("extraction.objection_texte", "donne aussi extraction.objection (un code, ou « libre »)");

    let interet = null;
    if (x.interet !== undefined && x.interet !== null) {
      if (Number.isInteger(x.interet) && x.interet >= 0 && x.interet <= 3) interet = x.interet;
      else err("extraction.interet", "entier de 0 à 3, ou null s'il ne se voit pas clairement");
    }
    let decideurJoint = null;
    if (x.decideur_joint !== undefined && x.decideur_joint !== null) {
      if (typeof x.decideur_joint === "boolean") decideurJoint = x.decideur_joint;
      else err("extraction.decideur_joint", "true, false ou null");
    }

    const douleurs = listeTextes(x.douleurs, "extraction.douleurs", BORNES.douleurs, BORNES.douleur, err);
    const croyances = listeTextes(x.croyances, "extraction.croyances", BORNES.croyances, BORNES.croyance, err);
    const citations = [];
    if (x.citations !== undefined && x.citations !== null && !Array.isArray(x.citations)) {
      err("extraction.citations", "liste de textes attendue ([] si rien n'a été dit)");
    } else if (Array.isArray(x.citations)) {
      if (x.citations.length > BORNES.citations) err("extraction.citations", `${BORNES.citations} éléments au plus`);
      x.citations.slice(0, BORNES.citations).forEach((c, i) => {
        const chemin = `extraction.citations[${i}]`;
        if (typeof c !== "string") return err(chemin, "texte attendu");
        if (c.trim() === "") return err(chemin, "élément vide (retire-le)");
        const nette = c.replace(/\s+/gu, " ").replace(/^[\s«»"“”„]+|[\s«»"“”„]+$/gu, "").trim();
        if (nette === "") return err(chemin, "citation vide");
        if (nette.length > BORNES.citation) return err(chemin, `${BORNES.citation} caractères au plus (choisis un passage plus court, sans le réécrire)`);
        if (nette.length < BORNES.citationCourte) avertissements.push(`${chemin} : citation très courte`);
        citations.push(nette);
      });
    }

    let prochaineEtape = null;
    const pe = x.prochaine_etape;
    if (pe !== undefined && pe !== null) {
      if (!estObjet(pe)) {
        err("extraction.prochaine_etape", "objet { type, date, detail } ou null");
      } else {
        for (const k of clesInconnues(pe, CLES_ETAPE)) err(`extraction.prochaine_etape.${k}`, "clé inconnue (type, date, detail)");
        const type = PROCHAINES_ETAPES.includes(pe.type) ? pe.type : null;
        if (!type) err("extraction.prochaine_etape.type", `type inconnu (permis : ${PROCHAINES_ETAPES.join(", ")})`);
        let date = null;
        if (pe.date !== undefined && pe.date !== null) {
          date = dateIsoStricte(pe.date);
          if (!date) err("extraction.prochaine_etape.date", "date ISO 8601 avec fuseau attendue");
        }
        if (type === "rappel" && (pe.date === undefined || pe.date === null)) err("extraction.prochaine_etape.date", "un rappel a une date (avec fuseau)");
        const detail = chaineFacultative(pe.detail, "extraction.prochaine_etape.detail", BORNES.detail, err);
        if (type && type !== "aucune") prochaineEtape = { type, date, detail };
      }
    }

    const tags = [];
    if (x.tags !== undefined && x.tags !== null) {
      if (!Array.isArray(x.tags)) err("extraction.tags", "liste de codes attendue");
      else {
        if (x.tags.length > BORNES.tags) err("extraction.tags", `${BORNES.tags} tags au plus`);
        x.tags.slice(0, BORNES.tags).forEach((t, i) => {
          const n = typeof t === "string" ? t.trim().toLowerCase() : "";
          if (!RE_TAG.test(n)) err(`extraction.tags[${i}]`, "code en minuscules (lettres, chiffres, - ou _), 40 caractères au plus");
          else if (!tags.includes(n)) tags.push(n);
        });
        if (tags.join(",").length > BORNES.tagsTotal) err("extraction.tags", `${BORNES.tagsTotal} caractères au plus au total`);
      }
    }
    const resume = chaineFacultative(x.resume, "extraction.resume", BORNES.resume, err);

    const champs = {};
    for (const id of permis.champs) {
      const v = chaineFacultative(x[id], `extraction.${id}`, BORNES.champ, err);
      if (v !== null) champs[id] = v;
    }
    extraction = { issue, objection, objectionTexte, interet, decideurJoint, douleurs, croyances, citations, prochaineEtape, tags, resume, champs };
  }

  let verdict = null;
  if (entree.verdict_accroche !== undefined && entree.verdict_accroche !== null) {
    if (VERDICTS.includes(entree.verdict_accroche)) verdict = entree.verdict_accroche;
    else err("verdict_accroche", `verdict inconnu (permis : ${VERDICTS.join(", ")}, ou null)`);
  }

  // Les citations, mot pour mot, dans ce que le prospect a dit.
  if (extraction && extraction.citations.length > 0) {
    if (transcription.length > 0) {
      const { introuvables, deLAppelant } = verifierCitations(extraction.citations, transcription);
      for (const i of introuvables) err(`extraction.citations[${i}]`, "introuvable mot pour mot dans la transcription (copie-la telle quelle)");
      for (const i of deLAppelant) err(`extraction.citations[${i}]`, "phrase de l'appelant : une citation vient du prospect");
    } else if (!appel.externeId) {
      avertissements.push("extraction.citations : non vérifiées (aucune transcription)");
    }
  }

  if (erreurs.length > 0) return echec();
  return {
    ok: true,
    erreurs,
    avertissements,
    donnees: { creerSiAbsent, source, lead, appel, transcription, extraction, verdict },
  };
}

/**
 * Les règles de --issue (enregistrer l'issue comme le Poste, par enregistrer_issue) : jamais « rdv_fixe » (le rendez-vous se pose au
 * Poste ou dans l'agenda, qui crée le créneau) ; « a_rappeler » exige une prochaine étape datée dans les bornes de la base.
 */
export function verifierIssue(donnees, niche, maintenant = Date.now()) {
  const erreurs = [];
  const issue = donnees.extraction.issue;
  if (issue === "rdv_fixe") {
    erreurs.push("--issue : « rdv_fixe » se pose au Poste ou dans l'agenda (ils créent le rendez-vous) ; relance sans --issue");
  }
  const config = niche.issues.find((i) => i.code === issue);
  const date = donnees.extraction.prochaineEtape?.date ?? null;
  if ((issue === "a_rappeler" || config?.exigeRappel) && !date) {
    erreurs.push("--issue : cette issue exige extraction.prochaine_etape.date (le rappel)");
  }
  if (date && (Date.parse(date) < maintenant - 86_400_000 || Date.parse(date) > maintenant + 400 * 86_400_000)) {
    erreurs.push("--issue : la date de rappel doit être entre hier et dans 400 jours");
  }
  return erreurs;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La fiche : par id, puis par téléphone (9 derniers chiffres), puis par nom d'entreprise
// ---------------------------------------------------------------------------------------------------------------------------------

const MAX_CANDIDATS = 10;

/** Le résumé d'une fiche candidate : identifiant, statut, jour de la dernière activité. Jamais de nom, de ville ni de numéro. */
function candidat(l) {
  const derniere = l.last_activity_at ? new Date(l.last_activity_at).toISOString().slice(0, 10) : null;
  return { id: l.id, statut: l.statut ?? null, derniere };
}

/** Choix par nom d'entreprise (casse, accents et ponctuation ignorés) parmi les fiches visibles. */
export function choisirParEntreprise(nom, lignes) {
  const cible = normaliserNom(nom);
  if (cible === "") return { etat: "aucune", par: "entreprise", candidats: [] };
  const exacts = lignes.filter((l) => normaliserNom(l.entreprise) === cible);
  if (exacts.length === 1) return { etat: "trouvee", par: "entreprise", id: exacts[0].id, candidats: [] };
  if (exacts.length > 1) return { etat: "plusieurs", par: "entreprise", candidats: exacts.slice(0, MAX_CANDIDATS).map(candidat), total: exacts.length };
  const proches = lignes.filter((l) => {
    const n = normaliserNom(l.entreprise);
    return n.length >= 3 && cible.length >= 3 && (n.includes(cible) || cible.includes(n));
  });
  return { etat: "aucune", par: "entreprise", candidats: proches.slice(0, MAX_CANDIDATS).map(candidat), total: proches.length };
}

/**
 * La fiche visée par le débrief, parmi les fiches VISIBLES du compte (la requête tourne sous sa RLS). Ordre : lead.id (sans repli s'il
 * est donné), puis le téléphone (9 derniers chiffres, sur téléphone et mobile), puis le nom d'entreprise.
 * Renvoie { etat: "trouvee" | "plusieurs" | "aucune", par, id?, candidats, total? }.
 */
export async function rechercherFiche(requete, cible) {
  if (cible.id) {
    const lignes = await requete("select id from public.leads where id = $1", [cible.id]);
    return lignes.length === 1 ? { etat: "trouvee", par: "id", id: lignes[0].id, candidats: [] } : { etat: "aucune", par: "id", candidats: [] };
  }
  const cle = cible.telephone ? tel9(cible.telephone) : null;
  if (cle) {
    const lignes = await requete(
      `select id, statut, last_activity_at from public.leads
        where telephone_9 = $1 or mobile_9 = $1
        order by last_activity_at desc nulls last, created_at desc
        limit ${MAX_CANDIDATS + 1}`,
      [cle],
    );
    if (lignes.length === 1) return { etat: "trouvee", par: "telephone", id: lignes[0].id, candidats: [] };
    if (lignes.length > 1) return { etat: "plusieurs", par: "telephone", candidats: lignes.slice(0, MAX_CANDIDATS).map(candidat), total: lignes.length };
  }
  if (cible.entreprise) {
    const lignes = await requete(
      "select id, entreprise, statut, last_activity_at from public.leads order by last_activity_at desc nulls last, created_at desc limit 100000",
      [],
    );
    return choisirParEntreprise(cible.entreprise, lignes);
  }
  return { etat: "aucune", par: cle ? "telephone" : "rien", candidats: [] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ce qui est écrit
// ---------------------------------------------------------------------------------------------------------------------------------

const LIBELLES_SOURCE = { colle: "transcription collée", fichier: "fichier", appel: "appel enregistré", notes_mac: "app Notes" };
const LIBELLES_ETAPE = { rdv: "rendez-vous", rappel: "rappel", mail: "envoi d'informations", autre: "autre" };

/** Une date lisible dans le fuseau de l'équipe : « 9 nov. 2026 à 15 h 20 ». */
export function dateLisible(iso, fuseau) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date inconnue";
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: fuseau,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const val = (type) => parties.find((p) => p.type === type)?.value ?? "";
  return `${val("day")} ${val("month")} ${val("year")} à ${val("hour")} h ${val("minute")}`;
}

/** La transcription en texte (debriefs.transcription) : une ligne par énoncé, « Appelant : … » ou « Prospect : … ». */
export function transcriptionEnTexte(lignes) {
  const nom = { appelant: "Appelant", prospect: "Prospect", inconnu: "Inconnu" };
  return lignes.map((l) => `${nom[l.locuteur] ?? "Inconnu"} : ${l.texte}`).join("\n");
}

/** La transcription d'un appel en base (appels.transcription : [{ t, locuteur, texte }]) en énoncés { locuteur, texte }. */
export function lireTranscriptionAppel(brut) {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter((l) => estObjet(l) && typeof l.texte === "string" && l.texte.trim() !== "")
    .map((l) => ({
      locuteur: ["appelant", "prospect"].includes(l.locuteur) ? l.locuteur : "inconnu",
      texte: l.texte.replace(/\s+/gu, " ").trim(),
    }));
}

/**
 * La note datée du journal de la fiche, au gabarit « clé : valeur » (une ligne par information dite ; rien pour ce qui n'a pas été dit).
 * 5000 caractères au plus (lead_activities.note).
 */
export function composerNote(donnees, niche, { debut = donnees.appel.debut, fuseau = niche.pays.fuseau } = {}) {
  const x = donnees.extraction;
  const libelle = (liste, code) => liste.find((e) => e.code === code)?.libelle ?? code;
  const quand = debut ? `du ${dateLisible(debut, fuseau)}` : "(date inconnue)";
  const lignes = [`Débrief de l'appel ${quand} (${LIBELLES_SOURCE[donnees.source] ?? donnees.source})`];
  lignes.push(`Issue : ${libelle(niche.issues, x.issue)}`);
  if (x.objection) lignes.push(`Objection : ${libelle(niche.objections, x.objection)}${x.objectionTexte ? ` (${x.objectionTexte})` : ""}`);
  if (x.interet !== null) lignes.push(`Intérêt : ${x.interet}/3`);
  if (x.decideurJoint !== null) lignes.push(`Décideur joint : ${x.decideurJoint ? "oui" : "non"}`);
  if (donnees.verdict) lignes.push(`Accroche : ${donnees.verdict}`);
  for (const c of champsDecouverte(niche)) {
    if (x.champs[c.id]) lignes.push(`${c.question.replace(/\s*\?\s*$/u, "")} : ${x.champs[c.id]}`);
  }
  if (x.douleurs.length > 0) lignes.push(`Douleurs : ${x.douleurs.join(" ; ")}`);
  if (x.croyances.length > 0) lignes.push(`Croyances : ${x.croyances.join(" ; ")}`);
  for (const c of x.citations.slice(0, 3)) lignes.push(`Citation : « ${c} »`);
  if (x.prochaineEtape) {
    const pe = x.prochaineEtape;
    const date = pe.date ? ` le ${dateLisible(pe.date, fuseau)}` : "";
    lignes.push(`Prochaine étape : ${LIBELLES_ETAPE[pe.type] ?? pe.type}${date}${pe.detail ? ` (${pe.detail})` : ""}`);
  }
  if (x.resume) lignes.push(`Résumé : ${x.resume}`);
  if (x.tags.length > 0) lignes.push(`Tags : ${x.tags.join(", ")}`);
  const note = lignes.join("\n");
  return note.length <= BORNES.note ? note : `${note.slice(0, BORNES.note - 1)}…`;
}

/** L'extraction gardée en base (debriefs.extraction) : des clés stables, lues par le bloc « Appels transcrits ». */
export function extractionPourBase(donnees, { lignesTranscription = donnees.transcription.length, dureeS = donnees.appel.dureeS } = {}) {
  const x = donnees.extraction;
  const extraction = {
    version: VERSION_DEBRIEF,
    issue: x.issue,
    objection: x.objection,
    objection_texte: x.objectionTexte,
    interet: x.interet,
    decideur_joint: x.decideurJoint,
    resume: x.resume,
    douleurs: x.douleurs,
    croyances: x.croyances,
    citations: x.citations,
    champs: x.champs,
    prochaine_etape: x.prochaineEtape,
    tags: x.tags,
    verdict_accroche: donnees.verdict,
    duree_s: dureeS,
    transcription_lignes: lignesTranscription,
  };
  if (Buffer.byteLength(JSON.stringify(extraction), "utf8") > BORNES.extractionOctets) {
    throw Object.assign(new Error("extraction trop lourde"), { code: "EXTRACTION_TROP_LOURDE" });
  }
  return extraction;
}

/** La ligne retours_marche : la première douleur et la première citation (les principales), le verdict traduit pour la base. */
export function ligneRetour(donnees, { leadId, debriefId, appelLe }) {
  const x = donnees.extraction;
  return {
    lead_id: leadId,
    debrief_id: debriefId,
    appel_le: appelLe,
    issue: x.issue,
    douleur: x.douleurs[0] ?? null,
    objection_code: x.objection,
    objection_texte: x.objectionTexte,
    accroche_verdict: donnees.verdict ? VERDICT_EN_BASE[donnees.verdict] : null,
    interet: x.interet,
    decideur_joint: x.decideurJoint === true,
    citation: x.citations[0] ?? null,
    tags: x.tags,
  };
}

/**
 * La mise à jour de la fiche : seulement les champs VIDES (jamais écraser ce qui est rempli). Les réponses de découverte vont dans
 * leads.qualification (clé = id du champ, comme les réponses aux questions du script). `fiche` : la ligne verrouillée.
 * Renvoie { maj, remplis, dejaRemplis } (des noms de champs, jamais des valeurs).
 */
export function majFiche(fiche, donnees, { objection = true } = {}) {
  const x = donnees.extraction;
  const maj = {};
  const remplis = [];
  const dejaRemplis = [];
  const qualification = estObjet(fiche.qualification) ? { ...fiche.qualification } : {};
  let qualificationChangee = false;
  for (const [id, valeur] of Object.entries(x.champs)) {
    if (vide(qualification[id])) {
      qualification[id] = valeur;
      remplis.push(id);
      qualificationChangee = true;
    } else {
      dejaRemplis.push(id);
    }
  }
  if (qualificationChangee) maj.qualification = qualification;
  const simple = (colonne, valeur) => {
    if (valeur === null || valeur === undefined) return;
    if (vide(fiche[colonne])) {
      maj[colonne] = valeur;
      remplis.push(colonne);
    } else {
      dejaRemplis.push(colonne);
    }
  };
  if (objection) simple("objection", x.objection);
  simple("dirigeant", donnees.lead.dirigeant);
  simple("ville", donnees.lead.ville);
  return { maj, remplis, dejaRemplis };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fichiers temporaires : toujours HORS d'un dépôt git (le scratchpad de Claude Code)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Vrai si ce dossier est dans une copie de travail git. */
export function dansUnDepot(dossier) {
  try {
    const sortie = execFileSync("git", ["-C", dossier, "rev-parse", "--is-inside-work-tree"], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    return sortie.trim() === "true";
  } catch {
    return false;
  }
}

/** Le dossier de sortie d'un transcript : créé s'il manque, refusé s'il est dans un dépôt git (un transcript n'entre jamais dans un dépôt). */
export function dossierHorsDepot(chemin) {
  if (!chemin) return { ok: false, raison: "donne le dossier de sortie (le scratchpad de Claude Code, hors dépôt)" };
  const dossier = resolve(chemin);
  // Le contrôle porte sur le premier dossier existant : rien n'est créé dans un dépôt, même vide.
  let existant = dossier;
  while (!existsSync(existant) && dirname(existant) !== existant) existant = dirname(existant);
  if (dansUnDepot(realpathSync(existant))) {
    return { ok: false, raison: "ce dossier est dans un dépôt git : un transcript n'y entre jamais (choisis le scratchpad)" };
  }
  if (!existsSync(dossier)) mkdirSync(dossier, { recursive: true, mode: 0o700 });
  return { ok: true, dossier: realpathSync(dossier) };
}

/** Un horodatage pour un nom de fichier : 2026-11-09-15-20-00. */
export function horodatageFichier(maintenant = Date.now()) {
  return new Date(maintenant).toISOString().slice(0, 19).replace(/[:T]/g, "-");
}
