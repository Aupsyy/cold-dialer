// Le rapprochement de fiches (Google Places, ou toute liste de contacts : nom, ville, code postal, téléphone, site) avec les
// entreprises de la base (SIRENE ou CSV). Règle : jamais un mauvais téléphone plutôt que pas de téléphone.
//
// Les noms sont comparés sur leurs mots distinctifs : accents, casse et ponctuation retirés, formes juridiques (SARL, SAS…), petits
// mots et mots vides de config/niche.json (sources.motsVidesAppariement : les mots du métier) écartés. Fiabilité d'un rapprochement :
//   telephone   le même numéro des deux côtés (9 derniers chiffres) ;
//   zone+nom    au moins un mot distinctif en commun ET le même code postal ou la même commune ; au seul niveau du département, il
//               faut des noms identiques (les mêmes mots distinctifs des deux côtés). Une fiche dont le numéro diffère de celui de la
//               base est écartée ;
//   zone seule  seulement pour une fiche cherchée pour cette entreprise (colonne siren_recherche) : le nom de la base n'a aucun mot
//               distinctif, une seule fiche trouvée, au même code postal.
// Une fiche disputée par plusieurs entreprises va à la meilleure ; à égalité, à aucune.
//
// Usage : node scripts/sourcing/appariement.mjs <base.csv> <fiches.csv> [--sortie <fichier.csv>] [--essai] [--config <niche.json>]
//   base.csv    la base : sirene.mjs build, ou un CSV au format d'import (docs/sourcing.md) ;
//   fiches.csv  les fiches : places.mjs, ou un annuaire au même format (entreprise, ville, code_postal, telephone, site, source…).
//   Écrit <base>-apparie.csv : le téléphone, le site, la note et le nombre d'avis s'ajoutent quand la base ne les a pas (jamais
//   remplacés), avec la provenance (coordonnees_source, coordonnees_url, coordonnees_date, coordonnees_fiabilite) et la liste des
//   champs qu'elle couvre (coordonnees_champs). RGPD : rien n'entre sans sa source DATÉE. Une fiche sans date de lecture (colonne
//   source_date, AAAA-MM-JJ) n'apporte rien ; une ligne qui a déjà la provenance d'une autre fiche (un appariement précédent) ne reçoit
//   rien d'une nouvelle : une seule provenance par ligne, jamais écrasée.

import { resolve } from "node:path";
import {
  afficher,
  cheminAffiche,
  chargerNiche,
  cheminSortie,
  departementDepuisCodePostal,
  ecrireTableau,
  ErreurSourcing,
  estLance,
  estVide,
  lireArguments,
  lireTableau,
  messageSur,
  normaliserSiren,
  normaliserVille,
  tel9,
  texteComparable,
  verifierSortie,
} from "./lib.mjs";

const USAGE = [
  "Usage : node scripts/sourcing/appariement.mjs <base.csv> <fiches.csv> [--sortie <fichier.csv>] [--essai] [--config <niche.json>]",
  "  Ajoute à la base le téléphone, le site, la note et les avis des fiches rapprochées (jamais à la place d'une valeur existante).",
  "  --sortie   le fichier écrit (défaut : <base>-apparie.csv)",
  "  --essai    compteurs seulement, rien n'est écrit",
].join("\n");

/** Les mots qui ne distinguent pas une entreprise d'une autre : formes juridiques, petits mots, mots génériques. */
export const MOTS_GENERIQUES = new Set([
  "sarl", "sarlu", "sas", "sasu", "eurl", "sa", "sci", "snc", "scop", "scp", "scm", "selarl", "selas", "selafa", "sel", "earl", "gaec",
  "gie", "geie", "ei", "eirl", "spfpl", "srl", "sprl", "inc", "ltd", "ltee", "ste", "societe", "ets", "etablissement",
  "etablissements", "entreprise", "entreprises", "cie", "compagnie", "groupe", "et", "de", "des", "du", "la", "le", "les", "au", "aux",
  "en", "sur", "pour", "par", "chez", "and", "the", "of", "fils", "freres", "associes", "associe", "france",
]);

/** Les mots distinctifs d'un nom (3 lettres au moins, ou 2 caractères dont un chiffre), sans mots génériques ni mots vides. */
export function motsDistinctifs(nom, motsVides = []) {
  const vides = new Set(MOTS_GENERIQUES);
  for (const m of motsVides) for (const mot of texteComparable(m).split(" ")) if (mot) vides.add(mot);
  const mots = texteComparable(nom)
    .split(" ")
    .filter((m) => m.length >= 3 || (m.length === 2 && /\d/.test(m)))
    .filter((m) => !vides.has(m));
  return [...new Set(mots)];
}

/** 1 si les noms sont identiques ou l'un contient l'autre (5 caractères au moins) ; sinon la part des mots distinctifs de a retrouvés dans b. */
export function similariteNom(a, b, motsVides = []) {
  const ca = texteComparable(a).replace(/ /g, "");
  const cb = texteComparable(b).replace(/ /g, "");
  if (!ca || !cb) return 0;
  if (ca === cb || (ca.length >= 5 && cb.length >= 5 && (ca.includes(cb) || cb.includes(ca)))) return 1;
  const motsA = motsDistinctifs(a, motsVides);
  const motsB = new Set(motsDistinctifs(b, motsVides));
  if (motsA.length === 0 || motsB.size === 0) return 0;
  return motsA.filter((m) => motsB.has(m)).length / motsA.length;
}

const departementDe = (x) => String(x.departement ?? "").trim().toUpperCase() || departementDepuisCodePostal(x.code_postal) || "";
const cpComparable = (cp) => String(cp ?? "").replace(/\s+/g, "").toUpperCase();

/** Le niveau de zone commun : "cp" (même code postal), "ville" (même commune), "dept" (même département français) ou null. */
export function niveauZone(a, b) {
  const cpA = cpComparable(a.code_postal);
  const cpB = cpComparable(b.code_postal);
  if (cpA && cpB && cpA === cpB) return "cp";
  const vA = normaliserVille(a.ville);
  const vB = normaliserVille(b.ville);
  if (vA && vB && vA === vB) return "ville";
  const dA = departementDe(a);
  const dB = departementDe(b);
  return dA && dB && dA === dB ? "dept" : null;
}

const RANG_ZONE = { cp: 0, ville: 1, dept: 2 };
const RANG_FIABILITE = { telephone: 0, "zone+nom": 1, "zone seule": 2 };

const numeros = (x) => [tel9(x.telephone), tel9(x.mobile)].filter(Boolean);

/**
 * La meilleure fiche pour une entreprise : { fiche, fiabilite, similarite } ou null. zoneSeule : permet le rapprochement « zone seule »
 * (seulement quand les candidats ont été cherchés pour cette entreprise).
 */
export function choisirFiche(prospect, candidats, { motsVides = [], zoneSeule = false } = {}) {
  const nos = numeros(prospect);
  if (nos.length > 0) {
    const meme = candidats.find((c) => numeros(c).some((n) => nos.includes(n)));
    if (meme) return { fiche: meme, fiabilite: "telephone", similarite: 1 };
  }
  const retenus = candidats
    .filter((c) => !estVide(c.entreprise))
    // Un autre numéro que le nôtre : une autre entreprise, ou un autre établissement. On ne le prend pas.
    .filter((c) => !(nos.length > 0 && numeros(c).length > 0))
    .map((c) => {
      const sim = Math.max(
        similariteNom(prospect.entreprise, c.entreprise, motsVides),
        estVide(prospect.enseigne) ? 0 : similariteNom(prospect.enseigne, c.entreprise, motsVides),
      );
      const couverture = Math.max(similariteNom(c.entreprise, prospect.entreprise, motsVides), estVide(prospect.enseigne) ? 0 : similariteNom(c.entreprise, prospect.enseigne, motsVides));
      return { c, sim, couverture, zone: niveauZone(prospect, c) };
    })
    // Au seul niveau du département, les mots distinctifs doivent coïncider dans les deux sens (des noms identiques).
    .filter((x) => x.sim > 0 && x.zone !== null && (x.zone !== "dept" || (x.sim >= 1 && x.couverture >= 1)))
    .sort(
      (a, b) =>
        b.sim - a.sim ||
        b.couverture - a.couverture ||
        RANG_ZONE[a.zone] - RANG_ZONE[b.zone] ||
        Number(!estVide(b.c.telephone)) - Number(!estVide(a.c.telephone)),
    );
  if (retenus.length > 0) return { fiche: retenus[0].c, fiabilite: "zone+nom", similarite: retenus[0].sim };
  if (zoneSeule && candidats.length === 1 && !estVide(candidats[0].entreprise)) {
    const c = candidats[0];
    if (motsDistinctifs(prospect.entreprise, motsVides).length === 0 && niveauZone(prospect, c) === "cp") {
      return { fiche: c, fiabilite: "zone seule", similarite: 0 };
    }
  }
  return null;
}

/** Une adresse (« 10 Rue X, 69003 Lyon », « Rue X 10, 1000 Bruxelles », « … , Montréal, QC H2X 1Y4 ») : { codePostal, ville }. */
export function lireAdresse(adresse) {
  const s = String(adresse ?? "")
    .replace(/^Adresse\s*:\s*/i, "")
    .trim();
  const parties = s.split(",").map((p) => p.trim());
  for (let k = parties.length - 1; k >= 0; k--) {
    const m = parties[k].match(/^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(\D.*)$/);
    if (m) return { codePostal: m[1], ville: m[2].trim() };
  }
  const ca = s.match(/,\s*([^,]+?),\s*[A-Z]{2}\s+([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/);
  if (ca) return { codePostal: `${ca[2]} ${ca[3]}`, ville: ca[1].trim() };
  return { codePostal: "", ville: "" };
}

/** La note et le nombre d'avis d'un texte de fiche (« 4,8\n(17) », « 4.5 (1 234) ») : { note: "4.8", nb: "17" } (vides si absents). */
export function lireNoteAvis(texte) {
  const t = String(texte ?? "").replace(/[  ]/g, " ");
  const note = t.match(/(\d)[,.](\d)/);
  const nb = t.match(/\((\d[\d ]*)\)/);
  return { note: note ? `${note[1]}.${note[2]}` : "", nb: nb ? nb[1].replace(/\s/g, "") : "" };
}

function clesZone(x) {
  const cles = [];
  const d = departementDe(x);
  if (d) cles.push(`d:${d}`);
  const v = normaliserVille(x.ville);
  if (v) cles.push(`v:${v}`);
  const cp = cpComparable(x.code_postal);
  if (cp) cles.push(`c:${cp}`);
  return cles;
}

const DATE_SOURCE = /^\d{4}-\d{2}-\d{2}$/;

function provenance(fiche) {
  const source = String(fiche.source ?? "").trim() || "fichier";
  return {
    coordonnees_source: source.slice(0, 200),
    coordonnees_url: String(fiche.source_url ?? "").trim(),
    coordonnees_date: String(fiche.source_date ?? "").trim(),
  };
}

/** Vrai si la ligne porte déjà une provenance de coordonnées (un appariement précédent). */
function aUneProvenance(ligne) {
  return !estVide(ligne.coordonnees_source) || !estVide(ligne.coordonnees_url) || !estVide(ligne.coordonnees_date);
}

/** Vrai si la provenance déjà notée est celle de cette fiche (même source, même adresse, même date) : rejouer ne change rien. */
function memeProvenance(ligne, fiche) {
  const p = provenance(fiche);
  return (
    String(ligne.coordonnees_source ?? "").trim() === p.coordonnees_source &&
    String(ligne.coordonnees_url ?? "").trim() === p.coordonnees_url &&
    String(ligne.coordonnees_date ?? "").trim() === p.coordonnees_date
  );
}

/**
 * Rapproche les fiches des entreprises de la base. Renvoie { lignes (la base, enrichie), compteurs }. Les valeurs déjà présentes dans
 * la base ne sont jamais remplacées.
 */
export function apparier(base, fiches, { motsVides = [] } = {}) {
  const compteurs = {
    base: base.length,
    fiches: fiches.length,
    rapprochees: { telephone: 0, "zone+nom": 0, "zone seule": 0 },
    disputees: 0,
    telephones_ajoutes: 0,
    sites_ajoutes: 0,
    sans_date: 0,
    autre_provenance: 0,
    fiches_non_retenues: 0,
  };
  const parSiren = new Map();
  const index = new Map();
  fiches.forEach((f, i) => {
    const siren = normaliserSiren(f.siren_recherche);
    if (siren) {
      if (!parSiren.has(siren)) parSiren.set(siren, []);
      parSiren.get(siren).push(i);
    } else {
      for (const cle of clesZone(f)) {
        if (!index.has(cle)) index.set(cle, []);
        index.get(cle).push(i);
      }
    }
  });

  // 1. Le meilleur choix de chaque entreprise.
  const choix = base.map((p) => {
    const siren = normaliserSiren(p.siren);
    const propres = siren ? parSiren.get(siren) : undefined;
    const indices = propres ?? [...new Set(clesZone(p).flatMap((cle) => index.get(cle) ?? []))];
    if (indices.length === 0) return null;
    const r = choisirFiche(
      p,
      indices.map((i) => fiches[i]),
      { motsVides, zoneSeule: Boolean(propres) },
    );
    return r ? { ...r, i: indices[indices.map((i) => fiches[i]).indexOf(r.fiche)] } : null;
  });

  // 2. Une fiche disputée va à la meilleure entreprise (fiabilité, puis similarité) ; à égalité, à aucune.
  const parFiche = new Map();
  choix.forEach((c, k) => {
    if (!c) return;
    if (!parFiche.has(c.i)) parFiche.set(c.i, []);
    parFiche.get(c.i).push(k);
  });
  for (const [, prospects] of parFiche) {
    if (prospects.length < 2) continue;
    compteurs.disputees++;
    const classes = prospects
      .map((k) => ({ k, rang: RANG_FIABILITE[choix[k].fiabilite], sim: choix[k].similarite }))
      .sort((a, b) => a.rang - b.rang || b.sim - a.sim);
    const egalite = classes[0].rang === classes[1].rang && classes[0].sim === classes[1].sim;
    for (const [n, { k }] of classes.entries()) if (egalite || n > 0) choix[k] = null;
  }

  // 3. L'enrichissement : seulement ce qui manque.
  const utilisees = new Set();
  const lignes = base.map((p, k) => {
    const c = choix[k];
    if (!c) return { ...p };
    utilisees.add(c.i);
    compteurs.rapprochees[c.fiabilite]++;
    const f = c.fiche;
    const r = { ...p };
    const champs = ["telephone", "site", "note_google", "nb_avis", "maps_categorie"].filter((k) => estVide(r[k]) && !estVide(f[k]));
    if (champs.length === 0) return r;
    // RGPD : un champ n'entre qu'avec sa source datée, et une ligne n'a qu'une provenance (jamais écrasée par un second appariement).
    if (!DATE_SOURCE.test(String(f.source_date ?? "").trim())) {
      compteurs.sans_date++;
      return r;
    }
    if (aUneProvenance(r) && !memeProvenance(r, f)) {
      compteurs.autre_provenance++;
      return r;
    }
    for (const k of champs) r[k] = f[k];
    if (champs.includes("telephone")) compteurs.telephones_ajoutes++;
    if (champs.includes("site")) compteurs.sites_ajoutes++;
    Object.assign(r, provenance(f), { coordonnees_fiabilite: c.fiabilite, coordonnees_champs: champs.join(",") });
    return r;
  });
  compteurs.fiches_non_retenues = fiches.length - utilisees.size;
  return { lignes, compteurs };
}

const COLONNES_AJOUTEES = [
  "telephone",
  "site",
  "note_google",
  "nb_avis",
  "maps_categorie",
  "coordonnees_source",
  "coordonnees_url",
  "coordonnees_date",
  "coordonnees_fiabilite",
  "coordonnees_champs",
];

/** Lit la base et les fiches, rapproche, écrit (sauf --essai). Renvoie { code, lignes, compteurs }. */
export async function executer({ niche, base, fiches, sortie, essai = false }) {
  const tBase = lireTableau(base);
  const tFiches = lireTableau(fiches);
  if (tBase.lignes.length === 0) throw new ErreurSourcing("La base ne contient aucune ligne de données.");
  if (!tFiches.colonnes.includes("entreprise")) throw new ErreurSourcing("Le fichier de fiches n'a pas de colonne « entreprise » (ou nom).");
  const { lignes, compteurs } = apparier(tBase.lignes, tFiches.lignes, { motsVides: niche.sources.motsVidesAppariement });
  const total = compteurs.rapprochees.telephone + compteurs.rapprochees["zone+nom"] + compteurs.rapprochees["zone seule"];
  const rapport = [
    "Rapprochement des fiches avec la base",
    `Base : ${compteurs.base} entreprises ; fiches : ${compteurs.fiches}`,
    `Rapprochées : ${total} (même téléphone : ${compteurs.rapprochees.telephone} ; nom et zone : ${compteurs.rapprochees["zone+nom"]} ; zone seule : ${compteurs.rapprochees["zone seule"]})`,
    `Téléphones ajoutés : ${compteurs.telephones_ajoutes} ; sites ajoutés : ${compteurs.sites_ajoutes}`,
    `Rien d'ajouté, faute de source datée (colonne source_date, AAAA-MM-JJ) : ${compteurs.sans_date} ; ligne déjà sourcée par une autre fiche : ${compteurs.autre_provenance}`,
    `Fiches disputées par plusieurs entreprises : ${compteurs.disputees} ; fiches non retenues : ${compteurs.fiches_non_retenues}`,
  ];
  if (essai) {
    rapport.push("ESSAI : rien n'a été écrit.");
  } else {
    const chemin = sortie ?? cheminSortie(base, "apparie");
    verifierSortie(base, chemin);
    verifierSortie(fiches, chemin);
    ecrireTableau(chemin, lignes, tBase.colonnes, COLONNES_AJOUTEES);
    rapport.push(`Écrit : ${cheminAffiche(chemin)}`);
  }
  return { code: 0, lignes: rapport, compteurs };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), { "--sortie": "texte", "--essai": "booleen", "--config": "texte" });
    if (options.aide || positionnels.length !== 2) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const r = await executer({
      niche,
      base: resolve(positionnels[0]),
      fiches: resolve(positionnels[1]),
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
