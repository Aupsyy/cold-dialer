// macOS SEULEMENT. Lit la transcription d'un appel dans l'app Notes du Mac (l'app Téléphone y range la transcription d'un appel
// enregistré), pour le débrief : le texte va dans un FICHIER hors dépôt (le scratchpad de Claude Code), jamais à l'écran.
//
//   node scripts/debrief/notes-mac.mjs --liste [--n 5]           les N notes les plus récentes : rang, date, taille, pièces jointes,
//                                                                 « appel ? » (indice de transcription). Ni titre ni contenu.
//   node scripts/debrief/notes-mac.mjs --derniere <dossier>       écrit le texte de la note la plus récente dans <dossier>/note-<date>.txt
//   node scripts/debrief/notes-mac.mjs --rang 2 <dossier>         idem pour la note de ce rang (2 : l'avant-dernière)
//   node scripts/debrief/notes-mac.mjs --presse-papiers <dossier> écrit le presse-papiers (« Copier la transcription » dans Notes)
//
// Passe par osascript (JavaScript for Automation) ; rien n'est envoyé ailleurs. macOS demande une fois l'autorisation d'accès à Notes.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dossierHorsDepot, horodatageFichier } from "./lib.mjs";

const JXA = `
function run(argv) {
  const notes = Application("Notes").notes;
  const dates = notes.modificationDate();
  const ordre = dates.map((d, i) => [d ? d.getTime() : 0, i]).sort((a, b) => b[0] - a[0]);
  const lire = (i) => {
    const n = notes[i];
    let dossier = ""; try { dossier = n.container().name(); } catch (e) {}
    let texte = ""; try { texte = n.plaintext() || ""; } catch (e) {}
    let pj = 0; try { pj = n.attachments.length; } catch (e) {}
    return { titre: n.name(), date: dates[i] ? dates[i].toISOString() : null, dossier: dossier, texte: texte, pj: pj };
  };
  if (argv[0] === "liste") {
    const k = Math.max(1, Math.min(20, parseInt(argv[1] || "5", 10)));
    return JSON.stringify(ordre.slice(0, k).map(function (o) { return lire(o[1]); }));
  }
  const r = parseInt(argv[1], 10);
  if (!(r >= 1 && r <= ordre.length)) return JSON.stringify({ erreur: "rang hors limites" });
  return JSON.stringify(lire(ordre[r - 1][1]));
}
`;

const DOSSIER_APPEL = /appel|call|enregistr|recording|t[ée]l[ée]phone/i;
const TEXTE_APPEL = /transcri|^\s*(moi|vous|[A-Z][\w' -]{0,30})\s*:|\b\d{1,2}:\d{2}\b/im;

/** Indice : la note ressemble-t-elle à la transcription d'un appel (dossier, titre ou début du texte) ? */
export function ressembleAppel({ dossier = "", titre = "", texte = "" }) {
  return DOSSIER_APPEL.test(dossier) || DOSSIER_APPEL.test(titre) || TEXTE_APPEL.test(texte.slice(0, 400));
}

function jxa(...args) {
  const sortie = execFileSync("osascript", ["-l", "JavaScript", "-", ...args], { input: JXA, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(sortie.trim());
}

function valeur(args, option) {
  const i = args.indexOf(option);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

function ecrire(dossier, prefixe, contenu) {
  const sortie = dossierHorsDepot(dossier);
  if (!sortie.ok) {
    console.error(`ERREUR : ${sortie.raison}.`);
    process.exit(1);
  }
  const chemin = join(sortie.dossier, `${prefixe}-${horodatageFichier()}.txt`);
  writeFileSync(chemin, contenu, { encoding: "utf8", mode: 0o600 });
  console.log(chemin);
  console.log(`${contenu.length} caractères. Supprime ce fichier une fois le débrief écrit.`);
}

function main() {
  if (process.platform !== "darwin") {
    console.error("Ce script ne marche que sur macOS (app Notes). Ailleurs : colle la transcription dans un fichier du scratchpad.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const dossier = args.filter((a, i) => !a.startsWith("--") && !["--n", "--rang"].includes(args[i - 1])).pop();
  if (args.includes("--liste")) {
    const notes = jxa("liste", valeur(args, "--n") ?? "5");
    notes.forEach((n, i) => {
      const date = n.date ? new Date(n.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "date inconnue";
      console.log(`${i + 1}. ${date} · ${n.texte.length} caractères · ${n.pj} pièce(s) jointe(s) · appel ? ${ressembleAppel(n) ? "oui" : "non"}`);
    });
    return;
  }
  if (args.includes("--presse-papiers")) {
    const texte = execFileSync("pbpaste", [], { encoding: "utf8", env: { ...process.env, LANG: "fr_FR.UTF-8", LC_ALL: "fr_FR.UTF-8" } });
    if (!texte.trim()) {
      console.error("ERREUR : le presse-papiers est vide.");
      process.exit(1);
    }
    ecrire(dossier, "presse-papiers", texte);
    return;
  }
  const rang = args.includes("--derniere") ? "1" : valeur(args, "--rang");
  if (rang) {
    const n = jxa("rang", rang);
    if (n.erreur) {
      console.error(`ERREUR : ${n.erreur}.`);
      process.exit(1);
    }
    ecrire(dossier, "note", `Date de la note : ${n.date ?? "inconnue"}\n\n${n.texte}`);
    if (n.texte.trim().length < 40) {
      console.error("attention : la note n'a presque pas de texte (la transcription est peut-être dans l'audio) : copie-la depuis Notes, puis --presse-papiers.");
    }
    return;
  }
  console.error("Usage : --liste [--n 5] | --derniere <dossier> | --rang <n> <dossier> | --presse-papiers <dossier>   (macOS seulement)");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
