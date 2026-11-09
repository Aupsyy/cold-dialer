// Les scripts du débrief en ligne de commande : usage, JSON illisible ou refusé (sans jamais recopier une valeur), connexion absente
// (l'URL de la base n'est jamais affichée), dossier de sortie hors dépôt, indice « appel ? » des notes du Mac. Les fichiers de test sont
// écrits dans un dossier temporaire puis supprimés.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dansUnDepot, dossierHorsDepot, horodatageFichier } from "../scripts/debrief/lib.mjs";
import { refusFichierDebrief } from "../scripts/debrief/ecrire.mjs";
import { ressembleAppel } from "../scripts/debrief/notes-mac.mjs";
import { RACINE } from "./aides.mjs";
import { debrief } from "./debrief-exemple.mjs";

const racine = fileURLToPath(RACINE);
const SECRET = "Valeur-Fictive-A-Ne-Pas-Recopier";
/** Une URL de base inventée : le script ne doit jamais l'afficher (pas de serveur sur ce port : la connexion échoue). */
const URL_INVENTEE = "postgresql://compte-fictif:mot-de-passe-fictif@127.0.0.1:9/base_fictive";

function lancer(script, args, env = {}) {
  const r = spawnSync(process.execPath, [join(racine, "scripts/debrief", script), ...args], {
    cwd: racine,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    timeout: 60_000,
  });
  return { code: r.status, sortie: `${r.stdout}${r.stderr}` };
}

function avecDossier(fn) {
  const dossier = mkdtempSync(join(tmpdir(), "debrief-cli-"));
  try {
    return fn(dossier);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

test("ecrire.mjs : usage, option inconnue, fichier illisible", () => {
  assert.match(lancer("ecrire.mjs", []).sortie, /^Usage : node scripts\/debrief\/ecrire\.mjs <debrief\.json> \[--ecrire\]/);
  const inconnue = lancer("ecrire.mjs", ["x.json", "--force"]);
  assert.equal(inconnue.code, 1);
  assert.match(inconnue.sortie, /Option inconnue : --force/);
  avecDossier((d) => {
    writeFileSync(join(d, "casse.json"), "{ pas du json");
    const r = lancer("ecrire.mjs", [join(d, "casse.json")]);
    assert.equal(r.code, 1);
    assert.match(r.sortie, /le fichier est illisible ou n'est pas du JSON/);
  });
});

test("ecrire.mjs : un débrief posé dans un dépôt git est refusé avant d'être lu (un transcript n'entre jamais dans un dépôt)", () => {
  avecDossier((d) => {
    const depot = join(d, "depot");
    assert.equal(spawnSync("git", ["init", "-q", depot]).status, 0);
    const dedans = join(depot, "debrief.json");
    writeFileSync(dedans, JSON.stringify(debrief({ resume: SECRET })));
    assert.match(refusFichierDebrief(dedans) ?? "", /dans un dépôt git/);
    const r = lancer("ecrire.mjs", [dedans], { SUPABASE_DB_URL: URL_INVENTEE });
    assert.equal(r.code, 1);
    assert.match(r.sortie, /ERREUR : le fichier est dans un dépôt git.*Rien n'est lu\./);
    assert.ok(!r.sortie.includes(SECRET) && !r.sortie.includes("connexion"), "ni le contenu ni la base ne sont touchés");
    const dehors = join(d, "debrief.json");
    writeFileSync(dehors, "{}");
    assert.equal(refusFichierDebrief(dehors), null, "hors dépôt : lu");
    assert.match(refusFichierDebrief(join(d, "absent.json")) ?? "", /introuvable/);
  });
});

test("ecrire.mjs : connexion impossible, l'URL de la base n'est jamais affichée", () => {
  avecDossier((d) => {
    const fichier = join(d, "debrief.json");
    writeFileSync(fichier, JSON.stringify(debrief()));
    const r = lancer("ecrire.mjs", [fichier], { SUPABASE_DB_URL: URL_INVENTEE });
    assert.equal(r.code, 1);
    assert.match(r.sortie, /ERREUR : connexion à la base impossible/);
    for (const morceau of ["mot-de-passe-fictif", "compte-fictif", "base_fictive", URL_INVENTEE]) assert.ok(!r.sortie.includes(morceau), "l'URL apparaît");
  });
});

test("lire-appel.mjs : usage, et aucune URL affichée quand la connexion échoue", () => {
  assert.match(lancer("lire-appel.mjs", []).sortie, /^Usage : node scripts\/debrief\/lire-appel\.mjs --liste/);
  const r = lancer("lire-appel.mjs", ["--liste"], { SUPABASE_DB_URL: URL_INVENTEE });
  assert.equal(r.code, 1);
  assert.ok(!r.sortie.includes("mot-de-passe-fictif"));
});

test("dossier de sortie d'un transcript : jamais dans un dépôt git", () => {
  assert.equal(dansUnDepot(racine), true);
  const refuse = dossierHorsDepot(join(racine, "scripts"));
  assert.equal(refuse.ok, false);
  assert.match(refuse.raison, /dans un dépôt git/);
  const nouveau = join(racine, "scripts", "jamais-cree");
  assert.equal(dossierHorsDepot(nouveau).ok, false);
  assert.equal(existsSync(nouveau), false, "rien n'est créé dans le dépôt");
  assert.equal(dossierHorsDepot("").ok, false);
  avecDossier((d) => {
    const ok = dossierHorsDepot(join(d, "sous-dossier"));
    assert.equal(ok.ok, true);
    assert.equal(dansUnDepot(ok.dossier), false);
  });
  assert.equal(horodatageFichier(Date.parse("2026-11-09T14:20:05Z")), "2026-11-09-14-20-05");
});

test("notes du Mac : l'indice « appel ? » (dossier, titre ou début du texte)", () => {
  assert.equal(ressembleAppel({ dossier: "Enregistrements d'appels" }), true);
  assert.equal(ressembleAppel({ dossier: "Call Recordings" }), true);
  assert.equal(ressembleAppel({ dossier: "Notes", titre: "Courses", texte: "lait, pain" }), false);
  assert.equal(ressembleAppel({ texte: "Vous : Bonjour\nMoi : Bonjour, je vous appelle…" }), true);
  assert.equal(ressembleAppel({ texte: `${SECRET} 10:42` }), true);
});
