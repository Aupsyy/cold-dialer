// L'import de fiches dans la base (table leads) depuis un CSV : celui du sourcing (sirene.mjs, appariement.mjs, emails.mjs,
// score.mjs) ou un fichier apporté par l'équipe (Belgique, Suisse, Canada, un annuaire, un export de CRM), au format de
// docs/sourcing.md.
//
// SIMULATION PAR DÉFAUT : tout est joué dans une transaction annulée à la fin ; rien n'est gardé, mais les compteurs sont exacts
// (la base vérifie chaque fiche). --appliquer : la même transaction, validée ; au moindre échec, tout est annulé (rien n'est écrit).
//
// Pour chaque ligne, dans cet ordre :
//   1. lecture : l'entreprise est obligatoire, avec au moins un identifiant (SIREN, téléphone ou mobile) ; les numéros sont mis au
//      format E.164 selon config.pays (la règle de la fonction SQL normaliser_e164) ; sinon la ligne est rejetée ;
//   2. liste STOP (donnees/stop.csv s'il existe, ou --stop) : des SIREN ou des numéros à ne jamais importer ;
//   3. doublons dans le fichier : même SIREN, puis même numéro (9 derniers chiffres) ; la première ligne l'emporte ;
//   4. opposition : écartée si l'un de ses identifiants est sur la liste d'opposition de l'équipe (fonction SQL
//      identifiants_en_opposition, la même que lead_en_opposition avec le mobile en plus : SIREN, numéros, et la clé nom et code
//      postal d'une fiche opposée sans SIREN, cle_entreprise), ou si la fiche existante est en « ne_plus_contacter » ;
//   5. déjà en base (même SIREN, sinon même numéro sans SIREN contradictoire) : les champs VIDES de la fiche existante sont complétés,
//      jamais remplacés (statut, attribution, notes et rappels ne bougent pas), et les sources datées s'ajoutent ; un numéro déjà
//      porté par une fiche d'un autre SIREN : la ligne est écartée (conflit) ;
//   6. sinon, une nouvelle fiche (statut a_appeler), avec ses sources datées ([{ type, detail, url, le }]), son score et son tier
//      (colonnes score et tier du fichier, sinon calculés avec la grille de config/niche.json).
// Enfin une ligne dans la table imports : des compteurs seulement.
//
// Équipe : celle de la base (une instance, une équipe) ; s'il y en a plusieurs, --workspace <identifiant> est obligatoire.
// Connexion : SUPABASE_DB_URL (variable d'environnement, sinon .env.local à la racine du dépôt) ; sa valeur n'est jamais affichée.
// Sortie : des compteurs seulement ; jamais un nom, un numéro, un SIREN ni un e-mail, même dans une erreur (son code seulement).
//
// Usage : node scripts/sourcing/importer.mjs <fichier.csv> [--appliquer] [--workspace <uuid>] [--stop <fichier.csv>]
//           [--source sirene|maps|csv|manuel] [--metier <texte>] [--limite N] [--exiger-telephone] [--config <niche.json>]
//   --essai : la simulation (c'est déjà le comportement par défaut).

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { optionsTls } from "../accroches/lib/base.mjs";
import { decoderUtf8, lireCsv } from "./csv.mjs";
import {
  afficher,
  canoniserTableau,
  chargerNiche,
  codeErreur,
  contientMotEntier,
  dateDuJour,
  DOSSIER_DONNEES,
  ErreurSourcing,
  estLance,
  estVide,
  libelleCategorieJuridique,
  lireArguments,
  messageSur,
  nettoyerTexte,
  normaliserCodePostal,
  normaliserDate,
  normaliserDepartement,
  normaliserE164,
  normaliserEmail,
  normaliserNaf,
  normaliserNbAvis,
  normaliserNote,
  normaliserScore,
  normaliserSiren,
  normaliserSiret,
  normaliserSite,
  RACINE,
  tel9,
  texteComparable,
} from "./lib.mjs";
import { calculerScore, tierDepuisScore } from "./score.mjs";

const USAGE = [
  "Usage : node scripts/sourcing/importer.mjs <fichier.csv> [--appliquer] [--workspace <uuid>] [--stop <fichier.csv>]",
  "          [--source sirene|maps|csv|manuel] [--metier <texte>] [--limite N] [--exiger-telephone] [--config <niche.json>]",
  "  (sans option)        SIMULATION : tout est vérifié dans une transaction annulée, rien n'est gardé",
  "  --appliquer          écrit pour de bon (une seule transaction : tout ou rien)",
  "  --workspace <uuid>   l'équipe, obligatoire si la base en a plusieurs",
  "  --stop <fichier>     liste STOP (colonnes siren et/ou telephone) ; par défaut donnees/stop.csv s'il existe",
  "  --source             l'origine notée au journal des imports (sinon déduite de la colonne source, ou csv)",
  "  --metier <texte>     le métier des fiches qui n'en ont pas",
  "  --limite N           ne lit que les N premières lignes du fichier",
  "  --exiger-telephone   écarte les fiches sans aucun numéro",
].join("\n");

export const TAILLE_LOT = 500;
export const SOURCES_MAX = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES_IMPORT = ["sirene", "maps", "csv", "manuel"];

/** Le type d'une source (colonne source du fichier) et sa description par défaut. */
const TYPES_SOURCE = {
  sirene: ["sirene", "registre SIRENE (API Recherche Entreprises)"],
  maps: ["maps", "fiche Google Maps"],
  site: ["site", "site de l'entreprise"],
  manuel: ["manuel", "saisie manuelle"],
};

export const RAISONS = {
  colonnes_en_trop: "trop de colonnes (séparateur dans un champ sans guillemets ?)",
  entreprise_manquante: "entreprise manquante",
  siren_illisible: "SIREN illisible (9 chiffres attendus)",
  aucun_identifiant: "ni SIREN ni numéro lisible",
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture d'une ligne
// ---------------------------------------------------------------------------------------------------------------------------------

const sansVides = (objet) => Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== null && v !== undefined && v !== ""));

/** Les champs qu'une provenance de coordonnées peut couvrir (colonne coordonnees_champs de l'appariement), lisibles. */
const LIBELLES_CHAMPS_COORDONNEES = { telephone: "téléphone", mobile: "mobile", site: "site", note_google: "note", nb_avis: "nombre d'avis" };

/** Les sources datées d'une ligne ([{ type, detail, url?, le }]) : l'origine de la fiche, de ses coordonnées et de son e-mail. */
export function construireSources(ligne, { aujourdhui, email = null, coordonnees = false }) {
  const date = (v) => normaliserDate(v) ?? aujourdhui;
  const typer = (brut) => {
    const connu = TYPES_SOURCE[texteComparable(brut)];
    return connu ?? ["fichier", nettoyerTexte(brut, 200) || "fichier importé"];
  };
  const [type, detail] = typer(ligne.source);
  const sources = [sansVides({ type, detail, url: normaliserSite(ligne.source_url), le: date(ligne.source_date) })];
  if (coordonnees && !estVide(ligne.coordonnees_source)) {
    const [t, d] = typer(ligne.coordonnees_source);
    // Ce que la provenance couvre vraiment (l'appariement le dit dans coordonnees_champs), sinon « téléphone et site ».
    const champs = String(ligne.coordonnees_champs ?? "")
      .split(",")
      .map((c) => LIBELLES_CHAMPS_COORDONNEES[c.trim()])
      .filter(Boolean);
    const quoi = champs.length > 0 ? champs.join(", ") : "téléphone et site";
    sources.push(sansVides({ type: t, detail: `${quoi} : ${d}`, url: normaliserSite(ligne.coordonnees_url), le: date(ligne.coordonnees_date) }));
  }
  if (email) {
    sources.push(sansVides({ type: "site", detail: "e-mail publié sur le site de l'entreprise", url: normaliserSite(ligne.email_source), le: date(ligne.email_date) }));
  }
  const vues = new Set();
  return sources.filter((s) => {
    const cle = `${s.type}|${s.url ?? ""}|${s.le}|${s.detail}`;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}

/**
 * Une ligne du fichier (colonnes canoniques) devient une fiche : { ok: true, fiche, illisibles } ou { ok: false, raison }.
 * contexte : { pays, aujourdhui, grille (config.score), metier (par défaut) }.
 */
export function preparerLigne(brut, { pays, aujourdhui, grille, metier = null }) {
  if (brut.enTrop) return { ok: false, raison: "colonnes_en_trop" };
  let entreprise = nettoyerTexte(brut.entreprise, 200);
  if (!entreprise) return { ok: false, raison: "entreprise_manquante" };
  const enseigne = nettoyerTexte(String(brut.enseigne ?? "").split("|")[0], 120);
  if (enseigne && !contientMotEntier(entreprise, enseigne)) entreprise = nettoyerTexte(`${entreprise} (${enseigne})`, 200);
  const siren = normaliserSiren(brut.siren);
  if (!estVide(brut.siren) && !siren) return { ok: false, raison: "siren_illisible" };
  const telephone = normaliserE164(brut.telephone, pays);
  let mobile = normaliserE164(brut.mobile, pays);
  if (mobile && mobile === telephone) mobile = null;
  const illisibles = (!estVide(brut.telephone) && !telephone ? 1 : 0) + (!estVide(brut.mobile) && !normaliserE164(brut.mobile, pays) ? 1 : 0);
  if (!siren && !telephone && !mobile) return { ok: false, raison: "aucun_identifiant" };

  const cp = normaliserCodePostal(brut.code_postal, pays);
  const email = normaliserEmail(brut.email);
  let score = normaliserScore(brut.score);
  if (score === null) score = calculerScore(brut, grille, { aujourdhui }).score;
  const fiche = {
    entreprise,
    siren,
    siret: normaliserSiret(brut.siret, siren),
    naf: normaliserNaf(brut.naf),
    forme: nettoyerTexte(brut.forme_juridique, 80) || libelleCategorieJuridique(brut.categorie_juridique) || null,
    date_creation: normaliserDate(brut.date_creation),
    effectif: nettoyerTexte(brut.effectif, 60) || null,
    metier: nettoyerTexte(brut.metier, 80) || nettoyerTexte(metier, 80) || null,
    ville: nettoyerTexte(brut.ville, 120) || null,
    cp,
    departement: normaliserDepartement(brut.departement, cp, pays),
    dirigeant: nettoyerTexte(brut.dirigeant, 160) || null,
    telephone,
    mobile,
    email,
    email_source: email ? nettoyerTexte(brut.email_source, 500) || null : null,
    site: normaliserSite(brut.site),
    note_google: normaliserNote(brut.note_google),
    nb_avis: normaliserNbAvis(brut.nb_avis),
    score,
    tier: tierDepuisScore(score, grille.seuils),
    sources: construireSources(brut, { aujourdhui, email, coordonnees: Boolean(telephone || mobile || normaliserSite(brut.site)) }),
  };
  return { ok: true, fiche, illisibles };
}

/** La liste STOP : { sirens, tels (9 derniers chiffres), entrees }. Sans colonne siren ni telephone : erreur (jamais une liste ignorée). */
export function lireStop(texte) {
  const { colonnes, lignes } = lireCsv(texte);
  const colSiren = ["siren", "siret"].filter((c) => colonnes.includes(c));
  const colTel = ["telephone", "tel", "mobile", "portable", "numero", "telephone_mobile"].filter((c) => colonnes.includes(c));
  if (lignes.length > 0 && colSiren.length === 0 && colTel.length === 0) {
    throw new ErreurSourcing("La liste STOP n'a ni colonne « siren » ni colonne « telephone » : corrige son en-tête (elle n'a pas été appliquée).");
  }
  const sirens = new Set();
  const tels = new Set();
  for (const l of lignes) {
    for (const c of colSiren) {
      const chiffres = String(l[c] ?? "").replace(/\D/g, "");
      if (chiffres.length === 9 || chiffres.length === 14) sirens.add(chiffres.slice(0, 9));
    }
    for (const c of colTel) {
      const t = tel9(l[c]);
      if (t) tels.add(t);
    }
  }
  return { sirens, tels, entrees: sirens.size + tels.size };
}

const numerosDe = (f) => [tel9(f.telephone), tel9(f.mobile)].filter(Boolean);

/**
 * Lecture, STOP et doublons du fichier (sans la base). Renvoie { candidates (fiches), compteurs }.
 * Toujours : lues = invalides + stop + doublons_siren + doublons_telephone + sans_numero + candidates.
 */
export function preparer(lignes, { pays, aujourdhui, grille, metier = null, stop = null, exigerTelephone = false }) {
  const c = {
    lues: lignes.length,
    invalides: 0,
    raisons: {},
    telephones_illisibles: 0,
    stop: 0,
    doublons_siren: 0,
    doublons_telephone: 0,
    sans_numero: 0,
  };
  const candidates = [];
  const sirensVus = new Set();
  const telsVus = new Set();
  for (const brut of lignes) {
    const r = preparerLigne(brut, { pays, aujourdhui, grille, metier });
    if (!r.ok) {
      c.invalides++;
      c.raisons[r.raison] = (c.raisons[r.raison] ?? 0) + 1;
      continue;
    }
    c.telephones_illisibles += r.illisibles;
    const f = r.fiche;
    const nums = numerosDe(f);
    if (stop && ((f.siren && stop.sirens.has(f.siren)) || nums.some((n) => stop.tels.has(n)))) {
      c.stop++;
      continue;
    }
    if (f.siren && sirensVus.has(f.siren)) {
      c.doublons_siren++;
      continue;
    }
    if (nums.some((n) => telsVus.has(n))) {
      c.doublons_telephone++;
      continue;
    }
    if (exigerTelephone && nums.length === 0) {
      c.sans_numero++;
      continue;
    }
    if (f.siren) sirensVus.add(f.siren);
    for (const n of nums) telsVus.add(n);
    candidates.push(f);
  }
  return { candidates, compteurs: c };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------------------------------------------------------------

/** L'équipe de l'import : celle demandée (elle doit exister), sinon la seule de la base. */
export async function resoudreWorkspace(client, demande = null) {
  if (demande !== null && demande !== undefined) {
    if (!UUID.test(String(demande))) throw new ErreurSourcing("--workspace attend l'identifiant (uuid) d'une équipe.");
    const { rows } = await client.query("select id from public.workspaces where id = $1::uuid", [demande]);
    if (rows.length === 0) throw new ErreurSourcing("Équipe inconnue : vérifie l'identifiant donné à --workspace.");
    return rows[0].id;
  }
  const { rows } = await client.query("select id from public.workspaces order by created_at, id limit 2");
  if (rows.length === 0) throw new ErreurSourcing("Aucune équipe dans cette base : crée d'abord le compte propriétaire (installation), puis relance.");
  if (rows.length > 1) throw new ErreurSourcing("Cette base a plusieurs équipes : précise laquelle avec --workspace <identifiant>.");
  return rows[0].id;
}

const SQL_OPPOSITION = `
  select u.i::int as i
    from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) with ordinality as u(siren, telephone, mobile, entreprise, cp, i)
   where public.identifiants_en_opposition($1::uuid, u.siren, u.telephone, u.mobile, public.cle_entreprise(u.entreprise, u.cp))`;

const SQL_EXISTANTS = `
  select id, siren, siret, naf, forme, date_creation::text as date_creation, effectif, metier, ville, cp, departement, dirigeant,
         telephone, mobile, email, email_source, site, note_google::text as note_google, nb_avis, score, tier, statut, sources,
         telephone_9, mobile_9
    from public.leads
   where workspace_id = $1::uuid
     and (siren = any($2::text[]) or telephone_9 = any($3::text[]) or mobile_9 = any($3::text[]))
   order by created_at desc, id`;

/** Les colonnes écrites à la création (nom, type SQL). */
export const COLONNES_FICHE = [
  ["entreprise", "text"],
  ["siren", "text"],
  ["siret", "text"],
  ["naf", "text"],
  ["forme", "text"],
  ["date_creation", "date"],
  ["effectif", "text"],
  ["metier", "text"],
  ["ville", "text"],
  ["cp", "text"],
  ["departement", "text"],
  ["dirigeant", "text"],
  ["telephone", "text"],
  ["mobile", "text"],
  ["email", "text"],
  ["email_source", "text"],
  ["site", "text"],
  ["note_google", "numeric"],
  ["nb_avis", "integer"],
  ["score", "integer"],
  ["tier", "text"],
];
const CHAMPS_COMPLETABLES = COLONNES_FICHE.map(([nom]) => nom).filter((nom) => nom !== "entreprise");

const SQL_INSERT = `
  insert into public.leads (workspace_id, statut, sources, ${COLONNES_FICHE.map(([n]) => n).join(", ")})
  select $1::uuid, 'a_appeler', coalesce(x.sources, '[]'::jsonb), ${COLONNES_FICHE.map(([n]) => `x.${n}`).join(", ")}
    from jsonb_to_recordset($2::jsonb) as x(sources jsonb, ${COLONNES_FICHE.map(([n, t]) => `${n} ${t}`).join(", ")})
  on conflict do nothing
  returning tier, (telephone is null and mobile is null) as sans_numero`;

const SQL_UPDATE = `
  update public.leads l
     set ${CHAMPS_COMPLETABLES.map((n) => `${n} = coalesce(l.${n}, x.${n})`).join(", ")},
         sources = l.sources || coalesce(x.sources_ajout, '[]'::jsonb)
    from jsonb_to_recordset($2::jsonb) as x(id uuid, sources_ajout jsonb, ${COLONNES_FICHE.filter(([n]) => n !== "entreprise").map(([n, t]) => `${n} ${t}`).join(", ")})
   where l.id = x.id and l.workspace_id = $1::uuid`;

const videEnBase = (v) => v === null || v === undefined || v === "";

/**
 * Ce qu'une ligne apporte à une fiche existante : seulement les champs vides de la fiche, et les sources nouvelles si au moins un champ
 * est complété. Renvoie { id, ...champs, sources_ajout } ou null (rien de nouveau). numeroPris(t9, id) : vrai si ce numéro appartient à
 * une autre fiche.
 */
export function completer(existante, fiche, { seuils, numeroPris = () => false }) {
  const patch = { id: existante.id };
  let change = false;
  for (const champ of CHAMPS_COMPLETABLES) {
    if (!videEnBase(existante[champ]) || videEnBase(fiche[champ])) continue;
    if ((champ === "telephone" || champ === "mobile") && numeroPris(tel9(fiche[champ]), existante.id)) continue;
    if (champ === "email_source" && !(patch.email || existante.email === fiche.email)) continue;
    if (champ === "tier" && !videEnBase(existante.score)) {
      patch.tier = tierDepuisScore(Number(existante.score), seuils);
      change = true;
      continue;
    }
    patch[champ] = fiche[champ];
    change = true;
  }
  if (!change) return null;
  const actuelles = Array.isArray(existante.sources) ? existante.sources : [];
  const nouvelles = fiche.sources.filter(
    (s) => !actuelles.some((a) => a && a.type === s.type && (a.url ?? null) === (s.url ?? null) && (a.le ?? null) === s.le),
  );
  if (nouvelles.length > 0) {
    // Jamais une coordonnée sans sa source datée (RGPD) : si la fiche ne peut plus prendre de source, rien n'est complété.
    if (actuelles.length + nouvelles.length > SOURCES_MAX) return null;
    patch.sources_ajout = nouvelles;
  }
  return patch;
}

/** Une écriture par lots de TAILLE_LOT lignes (un seul paramètre JSON par lot) : { total (lignes touchées), rows (returning) }. */
async function parLots(client, sql, ws, lignes) {
  let total = 0;
  const rows = [];
  for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
    const r = await client.query(sql, [ws, JSON.stringify(lignes.slice(i, i + TAILLE_LOT))]);
    total += r.rowCount ?? 0;
    if (Array.isArray(r.rows)) rows.push(...r.rows);
  }
  return { total, rows };
}

/** La source du journal des imports : --source, sinon celle de toutes les lignes si elle est connue (sirene, maps, manuel), sinon csv. */
export function sourceImport(lignes, demandee = null) {
  if (demandee) return demandee;
  const valeurs = new Set(lignes.map((l) => texteComparable(l.source)).filter(Boolean));
  if (valeurs.size === 1) {
    const seule = [...valeurs][0];
    if (SOURCES_IMPORT.includes(seule)) return seule;
  }
  return "csv";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------------------------------------------------------------

/** Le rapport : des compteurs seulement. */
export function formaterRapport(c, { appliquer, limite = null, stop = null, ignorees = 0 }) {
  const l = [];
  l.push(appliquer ? "Import de fiches : --appliquer (écriture en base)" : "Import de fiches : SIMULATION (rien n'est gardé)");
  l.push(`Lignes lues : ${c.lues}${limite ? ` (--limite ${limite})` : ""}`);
  l.push(`  invalides : ${c.invalides}`);
  for (const [raison, n] of Object.entries(c.raisons)) l.push(`    ${RAISONS[raison] ?? "autre raison"} : ${n}`);
  if (c.telephones_illisibles > 0) l.push(`  numéros illisibles (ignorés, la fiche est gardée si elle a un autre identifiant) : ${c.telephones_illisibles}`);
  l.push(stop ? `  liste STOP (${stop.entrees} entrées) : ${c.stop} écartée(s)` : "  liste STOP : aucune");
  l.push(`  doublons dans le fichier : même SIREN ${c.doublons_siren} ; même numéro ${c.doublons_telephone}`);
  if (c.sans_numero > 0) l.push(`  sans aucun numéro, écartées (--exiger-telephone) : ${c.sans_numero}`);
  l.push(`Face à la base :`);
  l.push(`  en opposition (ne plus contacter) : ${c.opposition}`);
  l.push(`  numéro déjà porté par une fiche d'un autre SIREN : ${c.conflits}`);
  l.push(`  même fiche en base qu'une ligne précédente : ${c.meme_fiche}`);
  l.push(`  déjà en base, rien de nouveau : ${c.inchangees}`);
  l.push(`  déjà en base, champs vides complétés : ${c.mises_a_jour}`);
  l.push(`  nouvelles fiches : ${c.creees}${ignorees > 0 ? ` (et ${ignorees} refusée(s) par la base comme doublon)` : ""}`);
  l.push(`    tiers : A ${c.tiers.A}, B ${c.tiers.B}, C ${c.tiers.C} ; sans aucun numéro : ${c.creees_sans_numero}`);
  l.push(
    appliquer
      ? `APPLIQUÉ : ${c.creees} fiche(s) créée(s), ${c.mises_a_jour} complétée(s), une ligne au journal des imports.`
      : "SIMULATION : rien n'a été gardé. Relance avec --appliquer pour écrire.",
  );
  return l;
}

/**
 * Fait tout le travail avec un client pg (ou un faux client { query } en test). Renvoie { code, lignes, erreur, compteurs }.
 * options : { niche, texteCsv, texteStop, appliquer, workspace, source, metier, limite, exigerTelephone, maintenant,
 * transactionExterne }. transactionExterne : l'appelant a déjà ouvert une transaction (un test qui annule tout à la fin) ; l'import
 * travaille alors dans un point de sauvegarde, validé ou annulé, au lieu de sa propre transaction.
 */
export async function executer(client, options) {
  const { niche, texteCsv, texteStop = null, appliquer = false, workspace = null, source = null, metier = null, limite = null } = options;
  const resultat = { code: 1, lignes: [], erreur: null, compteurs: null };
  try {
    if (source !== null && !SOURCES_IMPORT.includes(source)) throw new ErreurSourcing(`--source attend : ${SOURCES_IMPORT.join(", ")}.`);
    const aujourdhui = dateDuJour(niche.pays.fuseau, options.maintenant ?? new Date());
    const lu = lireCsv(texteCsv);
    const { colonnes, lignes } = canoniserTableau(lu.colonnes, lu.lignes);
    if (!colonnes.includes("entreprise")) throw new ErreurSourcing("Colonne « entreprise » (ou nom, raison_sociale) introuvable dans l'en-tête du CSV.");
    if (!["siren", "telephone", "mobile"].some((c) => colonnes.includes(c))) {
      throw new ErreurSourcing("Il faut au moins une colonne siren, telephone ou mobile (l'anti-doublon et l'opposition en dépendent).");
    }
    const lues = limite ? lignes.slice(0, limite) : lignes;
    if (lues.length === 0) throw new ErreurSourcing("Le CSV ne contient aucune ligne de données.");
    const stop = texteStop === null ? null : lireStop(texteStop);

    const { candidates, compteurs: c } = preparer(lues, {
      pays: niche.pays.code,
      aujourdhui,
      grille: niche.score,
      metier,
      stop,
      exigerTelephone: Boolean(options.exigerTelephone),
    });
    Object.assign(c, { opposition: 0, conflits: 0, meme_fiche: 0, inchangees: 0, mises_a_jour: 0, creees: 0, creees_sans_numero: 0, tiers: { A: 0, B: 0, C: 0 } });

    const ws = await resoudreWorkspace(client, workspace);
    const externe = Boolean(options.transactionExterne);
    const ordres = externe
      ? { debut: "savepoint import_sourcing", valider: "release savepoint import_sourcing", annuler: "rollback to savepoint import_sourcing" }
      : { debut: "begin", valider: "commit", annuler: "rollback" };
    let ignorees = 0;
    let etape = "lecture";
    await client.query(ordres.debut);
    try {
      // 4. Opposition, d'un seul aller-retour.
      const opposees = new Set(
        (
          await client.query(SQL_OPPOSITION, [
            ws,
            candidates.map((f) => f.siren),
            candidates.map((f) => f.telephone),
            candidates.map((f) => f.mobile),
            candidates.map((f) => f.entreprise),
            candidates.map((f) => f.cp),
          ])
        ).rows.map((r) => r.i - 1),
      );
      // 5. Les fiches existantes qui partagent un SIREN ou un numéro.
      const { rows: existantes } = await client.query(SQL_EXISTANTS, [
        ws,
        candidates.map((f) => f.siren).filter(Boolean),
        candidates.flatMap(numerosDe),
      ]);
      const parSiren = new Map();
      const parNumero = new Map();
      for (const e of existantes) {
        if (e.siren && !parSiren.has(e.siren)) parSiren.set(e.siren, e);
        for (const n of [e.telephone_9, e.mobile_9]) if (n && !parNumero.has(n)) parNumero.set(n, e);
      }
      const numeroPris = (t9, id) => Boolean(t9) && parNumero.has(t9) && parNumero.get(t9).id !== id;

      const aCreer = [];
      const aCompleter = [];
      const touchees = new Set();
      candidates.forEach((f, i) => {
        if (opposees.has(i)) {
          c.opposition++;
          return;
        }
        let existante = f.siren ? parSiren.get(f.siren) : undefined;
        if (!existante) {
          existante = numerosDe(f)
            .map((n) => parNumero.get(n))
            .find(Boolean);
          if (existante && existante.siren && f.siren && existante.siren !== f.siren) {
            c.conflits++;
            return;
          }
        }
        if (existante) {
          if (existante.statut === "ne_plus_contacter") {
            c.opposition++;
            return;
          }
          if (touchees.has(existante.id)) {
            c.meme_fiche++;
            return;
          }
          touchees.add(existante.id);
          const patch = completer(existante, f, { seuils: niche.score.seuils, numeroPris });
          if (patch) {
            aCompleter.push(patch);
            c.mises_a_jour++;
          } else c.inchangees++;
          return;
        }
        aCreer.push(f);
      });

      // 6. Les écritures (annulées à la fin en simulation).
      etape = "ecriture";
      const inserees = await parLots(client, SQL_INSERT, ws, aCreer);
      ignorees = aCreer.length - inserees.total;
      c.creees = inserees.total;
      for (const r of inserees.rows) {
        if (r.tier in c.tiers) c.tiers[r.tier]++;
        if (r.sans_numero) c.creees_sans_numero++;
      }
      c.mises_a_jour = (await parLots(client, SQL_UPDATE, ws, aCompleter)).total;
      await client.query(
        `insert into public.imports (workspace_id, source, simulation, lues, inserees, mises_a_jour, doublons, exclues_opposition, rejetees)
         values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ws,
          sourceImport(lues, source),
          !appliquer,
          c.lues,
          c.creees,
          c.mises_a_jour,
          c.doublons_siren + c.doublons_telephone + c.conflits + c.meme_fiche + c.inchangees + ignorees,
          c.opposition + c.stop,
          c.invalides + c.sans_numero,
        ],
      );
      etape = "fin";
      await client.query(appliquer ? ordres.valider : ordres.annuler);
    } catch (e) {
      await client.query(ordres.annuler).catch(() => {});
      throw new ErreurSourcing(
        etape === "fin"
          ? `La validation (COMMIT) a échoué (code ${codeErreur(e)}) : vérifie les fiches de l'équipe avant de relancer ; relancer est sans risque, les doublons sont écartés.`
          : `Import annulé (ROLLBACK), rien n'a été écrit (code ${codeErreur(e)}).`,
      );
    }
    resultat.compteurs = c;
    resultat.lignes = formaterRapport(c, { appliquer, limite, stop, ignorees });
    resultat.code = 0;
  } catch (e) {
    resultat.erreur = messageSur(e);
  }
  return resultat;
}

/** L'URL de la base : SUPABASE_DB_URL, sinon lue dans .env.local à la racine du dépôt. Jamais affichée. */
export function urlBase() {
  if (!process.env.SUPABASE_DB_URL) {
    const fichier = join(RACINE, ".env.local");
    if (existsSync(fichier)) {
      try {
        process.loadEnvFile(fichier);
      } catch {
        // fichier illisible : on le dit plus bas, sans rien en citer
      }
    }
  }
  return process.env.SUPABASE_DB_URL ?? "";
}

/**
 * La configuration du client pg : rien en local ; vers une base distante, TLS avec le certificat vérifié si SUPABASE_DB_CA est posée
 * (sinon un avertissement, sans aucune valeur). La même règle que les autres scripts : optionsTls (scripts/accroches/lib/base.mjs).
 */
export function configurationConnexion(url) {
  let ssl;
  try {
    ssl = optionsTls(url);
  } catch {
    throw new ErreurSourcing("SUPABASE_DB_CA illisible : le chemin du certificat racine de la base, ou son texte PEM.");
  }
  return { connectionString: url, ssl, application_name: "cold-dialer-import" };
}

function lireFichier(chemin, quoi) {
  if (!existsSync(chemin)) throw new ErreurSourcing(`${quoi} introuvable.`);
  try {
    return decoderUtf8(readFileSync(chemin));
  } catch (e) {
    throw e?.name === "ErreurCsv" ? new ErreurSourcing(`${quoi} : ${e.message}`) : new ErreurSourcing(`${quoi} illisible (code ${codeErreur(e)}).`);
  }
}

async function main() {
  let client = null;
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--appliquer": "booleen",
      "--essai": "booleen",
      "--workspace": "texte",
      "--stop": "texte",
      "--source": SOURCES_IMPORT,
      "--metier": "texte",
      "--limite": "entier",
      "--exiger-telephone": "booleen",
      "--config": "texte",
    });
    if (options.aide || positionnels.length !== 1) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    if (options.appliquer && options.essai) throw new ErreurSourcing("--appliquer et --essai s'excluent.");
    const texteCsv = lireFichier(resolve(positionnels[0]), "Fichier CSV");
    const stopParDefaut = join(DOSSIER_DONNEES, "stop.csv");
    const cheminStop = options.stop ? resolve(options.stop) : existsSync(stopParDefaut) ? stopParDefaut : null;
    const texteStop = cheminStop ? lireFichier(cheminStop, "Liste STOP") : null;
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const url = urlBase();
    if (!url) throw new ErreurSourcing("SUPABASE_DB_URL manquante : mets l'URL de ta base dans .env.local (jamais dans le dépôt), puis relance.");
    const { default: pg } = await import("pg");
    client = new pg.Client(configurationConnexion(url));
    client.on("error", (e) => console.error(`ERREUR : connexion à la base interrompue (code ${codeErreur(e)}).`));
    try {
      await client.connect();
    } catch (e) {
      throw new ErreurSourcing(`Connexion à la base impossible (code ${codeErreur(e)}).`);
    }
    const r = await executer(client, {
      niche,
      texteCsv,
      texteStop,
      appliquer: Boolean(options.appliquer),
      workspace: options.workspace ?? null,
      source: options.source ?? null,
      metier: options.metier ?? null,
      limite: options.limite ?? null,
      exigerTelephone: Boolean(options.exigerTelephone),
    });
    afficher(r.lignes);
    if (r.erreur) console.error(`ERREUR : ${r.erreur}`);
    process.exitCode = r.erreur ? 1 : 0;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}

if (estLance(import.meta.url)) await main();
