// Les scripts de la session commune : rejoindre.mjs écrit les trois lignes sans toucher aux autres et n'affiche jamais le jeton ;
// une adresse non https est refusée ; classement.mjs n'affiche que des pseudos et des compteurs. Réseau et presse-papiers simulés.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as client from "../lib/concours/client.ts";
import * as configuration from "../lib/concours/configuration.ts";
import { executerClassement, lignesClassement } from "../scripts/concours/classement.mjs";
import { ecrireEnvLocal, poserLignes } from "../scripts/concours/lib.mjs";
import { executerRejoindre, pseudoValide } from "../scripts/concours/rejoindre.mjs";
import { RACINE } from "./aides.mjs";

const m = { ...configuration, ...client };
const JETON = "jeton-secret-0123456789";
const racine = new URL("../", import.meta.url).pathname;

test("rejoindre : écrit les trois lignes dans .env.local sans toucher aux autres, et n'affiche pas le jeton", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "concours-"));
  try {
    const avant = "SUPABASE_X=abc\n# un commentaire\nCONCOURS_CODE=ANCIEN\n\nAUTRE=1\n";
    writeFileSync(join(dossier, ".env.local"), avant);
    const appels = [];
    const r = await executerRejoindre(
      { url: "https://concours.example.org", code: "abcd1234", pseudo: " Soleil ", copierJeton: true },
      {
        rejoindre: async (c, p) => (appels.push({ c, p }), { ok: true, jeton: JETON, pseudo: p }),
        ecrire: (v) => ecrireEnvLocal(v, dossier),
        copier: (j) => (appels.push({ copie: j }), { ok: true }),
      },
      m,
    );
    assert.equal(r.code, 0);
    assert.deepEqual(appels[0], { c: { url: "https://concours.example.org", code: "ABCD1234" }, p: "Soleil" });
    const apres = readFileSync(join(dossier, ".env.local"), "utf8");
    assert.equal(
      apres,
      `SUPABASE_X=abc\n# un commentaire\nCONCOURS_CODE=ABCD1234\n\nAUTRE=1\nCONCOURS_URL=https://concours.example.org\nCONCOURS_JETON=${JETON}\n`,
    );
    const sortie = r.lignes.join("\n");
    assert.ok(!sortie.includes(JETON), "le jeton ne s'affiche pas");
    assert.ok(!sortie.includes("SUPABASE_X"), "le reste du fichier ne s'affiche pas");
    assert.match(sortie, /CONCOURS_URL, CONCOURS_CODE, CONCOURS_JETON/);
    assert.match(sortie, /Vercel/);
    assert.equal(appels[1].copie, JETON, "--copier-jeton copie sans afficher");
    // rejouer remplace sans doubler
    ecrireEnvLocal({ CONCOURS_URL: "https://concours.example.org", CONCOURS_CODE: "ABCD1234", CONCOURS_JETON: "autre-jeton-9876543" }, dossier);
    const encore = readFileSync(join(dossier, ".env.local"), "utf8");
    assert.equal((encore.match(/^CONCOURS_/gm) ?? []).length, 3);
    assert.match(encore, /^SUPABASE_X=abc$/m);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("rejoindre : crée .env.local s'il manque ; refuse une valeur à retour à la ligne", () => {
  assert.equal(poserLignes("", { CONCOURS_URL: "https://a.example.org", CONCOURS_CODE: "ABCD", CONCOURS_JETON: "12345678" }), "CONCOURS_URL=https://a.example.org\nCONCOURS_CODE=ABCD\nCONCOURS_JETON=12345678\n");
  assert.throws(() => poserLignes("", { CONCOURS_URL: "https://a.example.org", CONCOURS_CODE: "ABCD", CONCOURS_JETON: "1\nAUTRE=2" }));
});

test("rejoindre : adresse non https, code et pseudo invalides refusés avant tout appel", async () => {
  let appele = false;
  const d = { rejoindre: async () => ((appele = true), { ok: true, jeton: JETON, pseudo: "x" }), ecrire: () => { appele = true; }, copier: () => ({ ok: true }) };
  for (const options of [
    { url: "http://concours.example.org", code: "ABCD", pseudo: "x" },
    { url: "ftp://concours.example.org", code: "ABCD", pseudo: "x" },
    { url: "https://concours.example.org", code: "a", pseudo: "x" },
    { url: "https://concours.example.org", code: "ABCD", pseudo: "  " },
    { url: "https://concours.example.org", code: "ABCD", pseudo: "a\nb" },
  ]) {
    const r = await executerRejoindre(options, d, m);
    assert.equal(r.code, 1, JSON.stringify(options));
    assert.ok(r.erreur);
  }
  assert.equal(appele, false);
  assert.equal(pseudoValide("x".repeat(41)), null);
  const essai = await executerRejoindre({ url: "http://localhost:3000", code: "ABCD", pseudo: "x", essai: true }, d, m);
  assert.equal(essai.code, 0);
  assert.equal(appele, false, "--essai n'appelle ni n'écrit");
});

test("rejoindre : un refus du service est dit sans rien écrire", async () => {
  let ecrit = false;
  const r = await executerRejoindre(
    { url: "https://concours.example.org", code: "ABCD", pseudo: "x" },
    { rejoindre: async () => ({ ok: false, erreur: "Ce pseudo est déjà pris : choisis-en un autre." }), ecrire: () => { ecrit = true; }, copier: () => ({ ok: true }) },
    m,
  );
  assert.equal(r.code, 1);
  assert.equal(ecrit, false);
});

test("scripts : --aide sur les deux, et une adresse http est refusée en ligne de commande", () => {
  for (const s of ["rejoindre", "classement"]) {
    const r = spawnSync(process.execPath, [`scripts/concours/${s}.mjs`, "--aide"], { cwd: racine, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage/);
  }
  const r = spawnSync(process.execPath, ["scripts/concours/rejoindre.mjs", "--url", "http://concours.example.org", "--code", "ABCD", "--pseudo", "x"], { cwd: racine, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /https/);
});

test("classement : pseudos et compteurs seulement, triés ; sans session configurée, une erreur claire", async () => {
  const c = { titre: "Défi", ouverte: true, participants: [{ pseudo: "B", appels: 9, conversations: 2, rdv: 0 }, { pseudo: "A", appels: 5, conversations: 2, rdv: 1 }] };
  const lignes = lignesClassement(c);
  assert.match(lignes[1], /^ 1\. A : 5 appels, 2 conversations, 1 rendez-vous/);
  assert.match(lignes[2], /B/);
  const sans = await executerClassement({ variables: {}, lire: async () => c }, m);
  assert.equal(sans.code, 1);
  const bon = await executerClassement({ variables: { CONCOURS_URL: "https://concours.example.org", CONCOURS_CODE: "ABCD" }, lire: async () => c }, m);
  assert.equal(bon.code, 0);
  const rate = await executerClassement({ variables: { CONCOURS_URL: "https://concours.example.org", CONCOURS_CODE: "ABCD" }, lire: async () => null }, m);
  assert.equal(rate.code, 1);
  void RACINE;
});
