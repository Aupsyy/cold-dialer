// scripts/niche/appliquer.mjs, lister.mjs et volume.mjs : la fusion d'une niche prête dans une config, sans toucher aux blocs protégés,
// avec essai, copie de sauvegarde et refus d'une config invalide. Toujours avec --config sur un fichier temporaire : config/niche.json
// du dépôt n'est jamais lu ni écrit par ces tests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyserNiche } from "../config/charger.ts";
import { BLOCS_PROTEGES, appliquerNiche, codesDesNiches, lireNiche } from "../scripts/niche/lib.mjs";
import { RACINE, exemple } from "./aides.mjs";

const dossiers = [];
function dossierTemporaire() {
  const d = mkdtempSync(join(tmpdir(), "niche-test-"));
  dossiers.push(d);
  return d;
}
test.after(() => dossiers.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Une config « remplie par la personne » : l'exemple, avec ses propres marque, offre, téléphonie, agenda et légal. */
function configRemplie() {
  const c = exemple();
  c.marque = { ...c.marque, nomEquipe: "Équipe Cible", nomProduit: "Mon poste", couleur: "#112233" };
  c.offre = { ...c.offre, nom: "Mon offre à moi", pourQui: "Ceux que je sers.", phrasePrix: "Le prix se voit ensemble, pendant l'échange." };
  c.telephonie = { ...c.telephonie, copierNumero: false };
  c.agenda = { fournisseur: "calendly", lienReservation: "https://calendly.com/exemple/echange", prefill: true, champLead: "utm_content" };
  c.legal = { ...c.legal, responsable: "Équipe Cible SAS", conservationMois: 12 };
  c.sources.sirene.departements = ["31"];
  c.sources.places = { actif: true, motsCles: ["ancien mot"], villes: ["Toulouse"], max: 50 };
  return c;
}

function lancer(script, ...args) {
  return spawnSync(process.execPath, [`scripts/niche/${script}.mjs`, ...args], { cwd: RACINE, encoding: "utf8" });
}

test("appliquer : chaque niche, sur une config remplie, ne change aucun bloc protégé et reste valide", async () => {
  for (const code of codesDesNiches()) {
    const base = configRemplie();
    const { config } = await appliquerNiche(base, lireNiche(code));
    for (const bloc of BLOCS_PROTEGES) assert.deepEqual(config[bloc], base[bloc], `${code} : ${bloc} a changé`);
    assert.deepEqual(config.sources.sirene.departements, ["31"], "les départements de la config restent");
    assert.deepEqual(config.sources.places.villes, ["Toulouse"], "les villes de la config restent");
    assert.equal(config.sources.places.actif, true, "Google reste activé ou non comme la personne l'a choisi");
    assert.deepEqual(config.sources.places.motsCles, lireNiche(code).google.motsCles);
    assert.equal(analyserNiche(config).ok, true);
  }
});

test("appliquer (commande) : écrit la config, garde l'ancienne dans .avant, protège les blocs, valide", () => {
  const d = dossierTemporaire();
  const fichier = join(d, "niche.json");
  const avant = configRemplie();
  writeFileSync(fichier, `${JSON.stringify(avant, null, 2)}\n`);
  const r = lancer("appliquer", "paysagistes", "--config", fichier, "--departements", "69,38");
  assert.equal(r.status, 0, r.stderr);
  const apres = JSON.parse(readFileSync(fichier, "utf8"));
  for (const bloc of BLOCS_PROTEGES) assert.deepEqual(apres[bloc], avant[bloc], bloc);
  assert.deepEqual(apres.sources.sirene.departements, ["69", "38"]);
  assert.deepEqual(apres.sources.sirene.naf, ["81.30Z"]);
  assert.deepEqual(JSON.parse(readFileSync(`${fichier}.avant`, "utf8")), avant, "la copie de sauvegarde est l'ancienne config");
  assert.equal(analyserNiche(apres).ok, true);
  assert.doesNotMatch(r.stdout, /Équipe Cible/, "aucun contenu de la config dans le compte rendu");
});

test("appliquer --departements tous ; une liste invalide est refusée sans rien écrire", () => {
  const d = dossierTemporaire();
  const fichier = join(d, "niche.json");
  writeFileSync(fichier, JSON.stringify(configRemplie()));
  assert.equal(lancer("appliquer", "cuisinistes", "--config", fichier, "--departements", "tous").status, 0);
  assert.equal(JSON.parse(readFileSync(fichier, "utf8")).sources.sirene.departements, "tous");
  const avant = readFileSync(fichier, "utf8");
  const r = lancer("appliquer", "pisciniers", "--config", fichier, "--departements", "99,ab");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /département/);
  assert.equal(readFileSync(fichier, "utf8"), avant, "rien n'a été écrit");
});

test("appliquer --essai : montre les changements, n'écrit ni la config ni la sauvegarde", () => {
  const d = dossierTemporaire();
  const fichier = join(d, "niche.json");
  const texte = JSON.stringify(configRemplie());
  writeFileSync(fichier, texte);
  const r = lancer("appliquer", "experts-comptables", "--config", fichier, "--essai");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /69\.20Z/);
  assert.match(r.stdout, /Essai : rien n'a été écrit/);
  assert.equal(readFileSync(fichier, "utf8"), texte);
  assert.ok(!existsSync(`${fichier}.avant`));
});

test("appliquer sur une config absente ou encore égale à l'exemple : part de l'exemple et prévient de ce qui reste à écrire", () => {
  const d = dossierTemporaire();
  const absent = join(d, "absent.json");
  const r = lancer("appliquer", "traiteurs-evenementiels", "--config", absent);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /niche d'exemple/);
  assert.match(r.stdout, /offre, marque/);
  assert.equal(analyserNiche(JSON.parse(readFileSync(absent, "utf8"))).ok, true);
  assert.ok(!existsSync(`${absent}.avant`), "pas de sauvegarde quand il n'y avait rien");
  const identique = join(d, "exemple.json");
  writeFileSync(identique, JSON.stringify(exemple()));
  assert.match(lancer("appliquer", "paysagistes", "--config", identique, "--essai").stdout, /niche d'exemple/);
});

test("appliquer : niche inconnue, config illisible, aucun argument, --aide", () => {
  const d = dossierTemporaire();
  const fichier = join(d, "casse.json");
  writeFileSync(fichier, "pas du json");
  assert.equal(lancer("appliquer", "inconnue", "--config", fichier).status, 1);
  assert.match(lancer("appliquer", "paysagistes", "--config", fichier).stderr, /JSON lisible/);
  assert.equal(lancer("appliquer").status, 1);
  assert.equal(lancer("appliquer", "--aide").status, 0);
});

test("appliquer refuse une config dont la fusion violerait les garde-fous (rien n'est écrit)", () => {
  const d = dossierTemporaire();
  const fichier = join(d, "niche.json");
  const c = configRemplie();
  c.offre.promesse = "Des résultats garantis pour tous nos clients, sans exception.";
  writeFileSync(fichier, JSON.stringify(c));
  const r = lancer("appliquer", "paysagistes", "--config", fichier);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /offre\.promesse/);
  assert.ok(!existsSync(`${fichier}.avant`));
});

test("lister : une ligne par niche prête avec son code, son métier et ses codes NAF ; volume --aide", () => {
  const r = lancer("lister");
  assert.equal(r.status, 0);
  const lignes = r.stdout.trim().split("\n");
  assert.equal(lignes.length, codesDesNiches().length);
  for (const code of codesDesNiches()) assert.ok(lignes.some((l) => l.startsWith(code) && /NAF \d{2}\.\d{2}[A-Z]/.test(l)), code);
  assert.equal(lancer("volume", "--aide").status, 0);
  assert.match(lancer("volume", "--aide").stdout, /sirene|registre/i);
  assert.equal(lancer("volume", "inconnue").status, 1);
});

test(".gitignore couvre la copie de sauvegarde de la config", () => {
  assert.match(readFileSync(new URL("../.gitignore", import.meta.url), "utf8"), /^config\/niche\.json\.avant$/m);
});
