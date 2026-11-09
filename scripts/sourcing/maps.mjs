// Google Maps (FACULTATIF et DÉSACTIVÉ par défaut) : le téléphone, le site, la note et le nombre d'avis des fiches d'établissements.
//
// Pourquoi désactivé : lire Google Maps avec un robot (un navigateur piloté par un script) va contre les conditions d'utilisation de
// Google. Les risques sont réels : captchas, blocage de l'adresse IP, compte Google suspendu, voire action de Google contre
// l'utilisateur. Activer ce script, et en porter le risque, est un choix de l'équipe qui l'installe. L'alternative officielle est
// l'API Google Places (clé et facturation Google), non fournie ici. Voir docs/sourcing.md.
//
// Pour l'activer : dans config/niche.json, sources.maps.actif = true (avec motsCles, villes et max), puis installer Playwright, qui
// n'est pas une dépendance du projet : npm install --no-save playwright && npx playwright install chromium
//
// Deux modes :
//   chercher             découverte : chaque mot-clé dans chaque ville (sources.maps.motsCles × villes), sources.maps.max fiches au
//                        plus. Pour un pays sans registre ouvert (Belgique, Suisse, Canada), ou pour compléter une base.
//   enrichir <base.csv>  pour chaque entreprise de la base qui n'a pas encore téléphone et site, cherche « <nom> <ville> » et garde
//                        jusqu'à 3 fiches, marquées siren_recherche ; appariement.mjs choisit ensuite la bonne (ou aucune).
// Cadence : une seule recherche à la fois, 4 à 8 secondes entre deux pages ; si Google bloque (captcha), 10 minutes de pause, et arrêt
// propre après 3 blocages de suite ; 12 recherches vides de suite (blocage silencieux) : arrêt propre. Reprise : l'état est gardé
// dans donnees/cache/maps-<mode>.json et le fichier de sortie est complété au fil de l'eau.
//
// Usage : node scripts/sourcing/maps.mjs chercher [--sortie <f.csv>] [--limite N] [--visible] [--essai] [--dossier <d>] [--config <c>]
//         node scripts/sourcing/maps.mjs enrichir <base.csv> [--sortie <f.csv>] [--limite N] [--visible] [--essai] [--dossier <d>]
//   --limite N : N recherches au plus ; --visible : montre la fenêtre du navigateur ; --essai : annonce le nombre de recherches et la
//   durée, sans ouvrir de navigateur.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { lireAdresse, lireNoteAvis } from "./appariement.mjs";
import {
  afficher,
  cheminAffiche,
  attendreVraiment,
  chargerNiche,
  dateDuJour,
  dossierDonnees,
  ecrireTableau,
  ErreurSourcing,
  estLance,
  estVide,
  lireArguments,
  lireTableau,
  messageSur,
  nettoyerTexte,
  normaliserCodePostal,
  normaliserDepartement,
  normaliserE164,
  normaliserSiren,
  normaliserSite,
  tel9,
} from "./lib.mjs";

const USAGE = [
  "Usage :",
  "  node scripts/sourcing/maps.mjs chercher [--sortie <f.csv>] [--limite N] [--visible] [--essai] [--dossier <d>] [--config <c>]",
  "  node scripts/sourcing/maps.mjs enrichir <base.csv> [--sortie <f.csv>] [--limite N] [--visible] [--essai] [--dossier <d>]",
  "  Désactivé par défaut (config/niche.json : sources.maps.actif). Lis docs/sourcing.md avant de l'activer.",
].join("\n");

export const MESSAGE_DESACTIVE = [
  "Google Maps est désactivé : config/niche.json, sources.maps.actif vaut false (ou sources.maps est absent). Rien n'a été fait.",
  "",
  "Pourquoi : lire Google Maps avec un robot va contre les conditions d'utilisation de Google. Risques : captchas, adresse IP",
  "bloquée, compte Google suspendu, voire action de Google contre toi. Ce choix, et ce risque, sont ceux de ton équipe.",
  "Sans Maps : le registre SIRENE (sirene.mjs) donne les entreprises sans téléphone ; complète avec ton propre fichier",
  "(annuaire, export de ton CRM) et appariement.mjs, ou fais chercher le numéro par l'appelant. Voir docs/sourcing.md.",
  "",
  "Pour l'activer quand même : dans config/niche.json, sources.maps.actif = true (avec motsCles, villes, max), puis",
  "  npm install --no-save playwright && npx playwright install chromium",
];

export const MESSAGE_PLAYWRIGHT = [
  "Playwright n'est pas installé (il n'est pas une dépendance du projet : environ 150 Mo avec son navigateur).",
  "Installe-le dans ce dossier, sans toucher package.json :",
  "  npm install --no-save playwright && npx playwright install chromium",
  "puis relance la même commande.",
];

const PAUSE_BLOCAGE_MS = 10 * 60 * 1000;
const BLOCAGES_MAX = 3;
const VIDES_MAX = 12;
const FICHES_PAR_ENTREPRISE = 3;
const FICHES_PAR_RECHERCHE = 20;
const COLONNES_FICHE = [
  "entreprise",
  "telephone",
  "site",
  "ville",
  "code_postal",
  "departement",
  "note_google",
  "nb_avis",
  "maps_categorie",
  "siren_recherche",
  "source",
  "source_url",
  "source_date",
];

/** Vrai si la page est un blocage de Google (captcha, « trafic inhabituel »). */
export function estBloqueTexte(url, texte) {
  return /\/sorry\/|recaptcha/i.test(String(url ?? "")) || /trafic inhabituel|unusual traffic|not a robot|pas un robot/i.test(String(texte ?? ""));
}

/** Les recherches à faire : { requete, siren_recherche } (mode chercher : mots-clés × villes ; enrichir : une par entreprise). */
export function planRecherches(niche, mode, base = []) {
  const maps = niche.sources.maps;
  if (mode === "chercher") {
    const plan = [];
    for (const mot of maps.motsCles) for (const ville of maps.villes) plan.push({ requete: nettoyerTexte(`${mot} ${ville}`, 200), siren_recherche: "" });
    return plan;
  }
  return base
    .filter((l) => !estVide(l.entreprise) && (estVide(l.telephone) || estVide(l.site)))
    .map((l) => {
      const nom = String(l.enseigne ?? "").split("|")[0].trim() || l.entreprise;
      return { requete: nettoyerTexte(`${nom} ${l.ville ?? ""}`, 200), siren_recherche: normaliserSiren(l.siren) ?? "" };
    });
}

/** Une fiche lue sur Maps ({ titre, tel, site, adresse, noteAvis, categorie, lien }) au format d'import. */
export function versFiche(brut, { pays = "FR", le, siren = "" }) {
  const adresse = lireAdresse(brut.adresse);
  const na = lireNoteAvis(brut.noteAvis);
  const cp = normaliserCodePostal(adresse.codePostal, pays) ?? "";
  const lien = String(brut.lien ?? "");
  return {
    entreprise: nettoyerTexte(brut.titre, 200),
    telephone: normaliserE164(brut.tel, pays) ?? "",
    site: normaliserSite(String(brut.site ?? "").replace(/\?.*$/, "")) ?? "",
    ville: nettoyerTexte(adresse.ville, 120),
    code_postal: cp,
    departement: normaliserDepartement("", cp, pays) ?? "",
    note_google: na.note,
    nb_avis: na.nb,
    maps_categorie: nettoyerTexte(brut.categorie, 80),
    siren_recherche: siren,
    source: "maps",
    source_url: /^https:\/\/(?:www\.)?google\.[a-z.]+\/maps\//.test(lien) ? lien.slice(0, 500) : "",
    source_date: le,
  };
}

/**
 * Le navigateur réel (Playwright). Renvoie { chercher(requete, { max }) → { statut: "ok" | "bloque", fiches: [brut] }, fermer() }.
 * Non couvert par les tests (il faut Playwright et un accès à Google) : la logique autour l'est, avec un faux navigateur.
 */
export function navigateurPlaywright(playwright, { visible = false, fuseau = "Europe/Paris", attendre = attendreVraiment, alea = Math.random } = {}) {
  let navigateur = null;
  let page = null;
  const pause = (a, b) => attendre(a + alea() * (b - a));

  async function ouvrir() {
    navigateur = await playwright.chromium.launch({ headless: !visible });
    const contexte = await navigateur.newContext({ locale: "fr-FR", timezoneId: fuseau, viewport: { width: 1280, height: 900 } });
    page = await contexte.newPage();
  }
  async function bloque() {
    const texte = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "").catch(() => "");
    if (estBloqueTexte(page.url(), texte)) return true;
    return (await page.locator('iframe[src*="recaptcha"]').count().catch(() => 0)) > 0;
  }
  async function consentement() {
    if (!/consent\.google/.test(page.url())) return;
    const refuser = page.getByRole("button", { name: /Tout refuser|Reject all/i }).first();
    if (await refuser.count()) await refuser.click().catch(() => {});
    await page.waitForURL(/google\.[a-z.]+\/maps/, { timeout: 15000 }).catch(() => {});
  }
  async function lireFiche() {
    await page.waitForSelector("h1", { timeout: 10000 }).catch(() => {});
    await pause(1200, 2000);
    return page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const titres = [...document.querySelectorAll("h1")].map((x) => x.innerText.trim()).filter((t) => t && t !== "Résultats");
      return {
        titre: titres.at(-1) ?? "",
        tel: q('button[data-item-id^="phone:tel:"]')?.getAttribute("data-item-id")?.replace("phone:tel:", "") ?? "",
        site: q('a[data-item-id="authority"]')?.href ?? "",
        adresse: q('button[data-item-id="address"]')?.getAttribute("aria-label") ?? "",
        noteAvis: q("div.F7nice")?.innerText ?? "",
        categorie: q("button.DkEaL")?.innerText?.trim() ?? "",
        lien: location.href,
      };
    });
  }
  const liensResultats = () => page.$$eval("a.hfpxzc", (els) => els.map((e) => ({ titre: e.getAttribute("aria-label") ?? "", href: e.href })));

  return {
    async chercher(requete, { max }) {
      if (!page) await ouvrir();
      await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(requete)}?hl=fr`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await consentement();
      if (await bloque()) return { statut: "bloque", fiches: [] };
      await page.waitForSelector("a.hfpxzc, h1", { timeout: 15000 }).catch(() => {});
      if (await bloque()) return { statut: "bloque", fiches: [] };
      await pause(1200, 2000);
      let liens = await liensResultats();
      for (let tour = 0; liens.length < max && liens.length > 0 && tour < 5; tour++) {
        await page.evaluate(() => document.querySelector('div[role="feed"]')?.scrollBy(0, 2500)).catch(() => {});
        await pause(1500, 2500);
        const plus = await liensResultats();
        if (plus.length === liens.length) break;
        liens = plus;
      }
      if (liens.length === 0) {
        // Une seule réponse : Google ouvre directement la fiche.
        const d = await lireFiche();
        return { statut: "ok", fiches: d.titre && /\/maps\/place\//.test(page.url()) ? [d] : [] };
      }
      const fiches = [];
      for (const l of liens.slice(0, max)) {
        await pause(4000, 8000);
        await page.goto(l.href, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (await bloque()) return { statut: "bloque", fiches };
        fiches.push(await lireFiche());
      }
      return { statut: "ok", fiches };
    },
    async fermer() {
      await navigateur?.close().catch(() => {});
    },
  };
}

/**
 * Fait tout le travail. dependances : { chargerPlaywright, navigateur (un faux, pour les tests), attendre, alea, maintenant }.
 * Renvoie { code, lignes (le rapport), compteurs }.
 */
export async function executer({ niche, mode, base = null, sortie = null, dossier, limite = null, essai = false, visible = false, dependances = {} }) {
  const maps = niche.sources.maps;
  if (!maps?.actif) return { code: 1, lignes: MESSAGE_DESACTIVE, compteurs: { desactive: true } };
  if (mode === "chercher" && (maps.motsCles.length === 0 || maps.villes.length === 0)) {
    throw new ErreurSourcing("sources.maps.motsCles et sources.maps.villes doivent avoir au moins une valeur chacun pour « chercher ».");
  }
  const tableau = mode === "enrichir" ? lireTableau(base) : null;
  if (tableau && tableau.lignes.length === 0) throw new ErreurSourcing("La base ne contient aucune ligne de données.");
  let plan = planRecherches(niche, mode, tableau?.lignes ?? []);
  if (limite) plan = plan.slice(0, limite);
  const parRecherche = mode === "enrichir" ? FICHES_PAR_ENTREPRISE : FICHES_PAR_RECHERCHE;
  const maxFiches = mode === "chercher" ? maps.max : Infinity;

  if (essai) {
    const pages = plan.length * (parRecherche + 1);
    return {
      code: 0,
      lignes: [
        `Google Maps (${mode}) : ${plan.length} recherche(s) prévue(s), ${mode === "chercher" ? `${maps.max} fiches au plus` : `${FICHES_PAR_ENTREPRISE} fiches au plus par entreprise`}`,
        `Durée : environ ${Math.ceil((pages * 6) / 60)} min au plus (une page toutes les 4 à 8 secondes)`,
        "ESSAI : aucun navigateur ouvert, rien n'a été écrit.",
      ],
      compteurs: { recherches: plan.length },
    };
  }

  let navigateur = dependances.navigateur;
  if (!navigateur) {
    let playwright;
    try {
      playwright = await (dependances.chargerPlaywright ?? (() => import("playwright")))();
    } catch {
      return { code: 1, lignes: MESSAGE_PLAYWRIGHT, compteurs: { playwright: false } };
    }
    navigateur = navigateurPlaywright(playwright.chromium ? playwright : playwright.default, {
      visible,
      fuseau: niche.pays.fuseau,
      attendre: dependances.attendre,
      alea: dependances.alea,
    });
  }

  const attendre = dependances.attendre ?? attendreVraiment;
  const alea = dependances.alea ?? Math.random;
  const le = dateDuJour(niche.pays.fuseau, dependances.maintenant ?? new Date());
  const cheminSortieMaps = sortie ?? join(dossier, `maps-${mode}-${le}.csv`);
  const cheminEtat = join(dossier, "cache", `maps-${mode}.json`);
  mkdirSync(dirname(cheminEtat), { recursive: true });
  let etat = { sortie: cheminSortieMaps, prochain: 0, blocages: 0 };
  if (existsSync(cheminEtat) && existsSync(cheminSortieMaps)) {
    try {
      const lu = JSON.parse(readFileSync(cheminEtat, "utf8"));
      if (lu.sortie === cheminSortieMaps) etat = { ...etat, ...lu };
    } catch {
      // état illisible : on repart du début
    }
  }
  const fiches = existsSync(cheminSortieMaps) && etat.prochain > 0 ? lireTableau(cheminSortieMaps).lignes : [];
  const vus = new Set(fiches.map((f) => f.source_url || tel9(f.telephone) || `${f.entreprise}|${f.code_postal}`));
  const c = { recherches: 0, fiches_lues: 0, fiches_gardees: 0, doublons: 0, blocages: 0, vides: 0 };
  let blocagesDeSuite = 0;
  let videsDeSuite = 0;
  let arret = null;
  const sauver = () => {
    ecrireTableau(cheminSortieMaps, fiches, COLONNES_FICHE);
    writeFileSync(cheminEtat, JSON.stringify(etat));
  };

  try {
    while (etat.prochain < plan.length && fiches.length < maxFiches) {
      const r = plan[etat.prochain];
      let res;
      try {
        res = await navigateur.chercher(r.requete, { max: Math.min(parRecherche, maxFiches - fiches.length) });
      } catch {
        res = { statut: "ok", fiches: [], erreur: true };
      }
      if (res.statut === "bloque") {
        c.blocages++;
        etat.blocages++;
        blocagesDeSuite++;
        sauver();
        if (blocagesDeSuite >= BLOCAGES_MAX) {
          arret = `arrêt propre après ${BLOCAGES_MAX} blocages de suite : relance plus tard, la récolte reprendra ici`;
          break;
        }
        await attendre(PAUSE_BLOCAGE_MS);
        continue;
      }
      blocagesDeSuite = 0;
      c.recherches++;
      const lues = res.fiches ?? [];
      videsDeSuite = lues.length === 0 && !res.erreur ? videsDeSuite + 1 : 0;
      for (const brut of lues) {
        c.fiches_lues++;
        const f = versFiche(brut, { pays: niche.pays.code, le, siren: r.siren_recherche });
        if (!f.entreprise) continue;
        const cle = f.source_url || tel9(f.telephone) || `${f.entreprise}|${f.code_postal}`;
        if (mode === "chercher" && vus.has(cle)) {
          c.doublons++;
          continue;
        }
        vus.add(cle);
        fiches.push(f);
        c.fiches_gardees++;
        if (fiches.length >= maxFiches) break;
      }
      etat.prochain++;
      if (c.recherches % 5 === 0) sauver();
      if (videsDeSuite >= VIDES_MAX) {
        c.vides = videsDeSuite;
        arret = `arrêt propre après ${VIDES_MAX} recherches vides de suite (blocage silencieux probable) : relance plus tard`;
        break;
      }
      if (etat.prochain < plan.length) await attendre(4000 + alea() * 4000);
    }
  } finally {
    sauver();
    await navigateur.fermer?.();
  }

  const avecTelephone = fiches.filter((f) => !estVide(f.telephone)).length;
  const lignes = [
    `Google Maps (${mode}) : ${c.recherches} recherche(s) faites, ${etat.prochain} sur ${plan.length} au total`,
    `Fiches lues : ${c.fiches_lues} ; gardées : ${c.fiches_gardees} (doublons : ${c.doublons}) ; dans le fichier : ${fiches.length}, dont ${avecTelephone} avec téléphone`,
    `Blocages de Google : ${c.blocages}`,
  ];
  if (arret) lignes.push(`ARRÊT : ${arret}.`);
  else if (fiches.length >= maxFiches) lignes.push(`Maximum atteint (sources.maps.max : ${maxFiches}).`);
  lignes.push(`Écrit : ${cheminAffiche(cheminSortieMaps)}`);
  if (mode === "enrichir") lignes.push("Étape suivante : appariement.mjs <base.csv> <ce fichier> (choisit la bonne fiche, ou aucune).");
  return { code: arret ? 1 : 0, lignes, compteurs: { ...c, total: fiches.length } };
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--sortie": "texte",
      "--limite": "entier",
      "--visible": "booleen",
      "--essai": "booleen",
      "--dossier": "texte",
      "--config": "texte",
    });
    const mode = positionnels[0];
    const valide = (mode === "chercher" && positionnels.length === 1) || (mode === "enrichir" && positionnels.length === 2);
    if (options.aide || !valide) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const r = await executer({
      niche,
      mode,
      base: mode === "enrichir" ? resolve(positionnels[1]) : null,
      sortie: options.sortie ? resolve(options.sortie) : null,
      dossier: dossierDonnees(options.dossier),
      limite: options.limite ?? null,
      essai: Boolean(options.essai),
      visible: Boolean(options.visible),
    });
    afficher(r.lignes);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();
