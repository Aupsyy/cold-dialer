// Accroches, la consigne : le modèle skills/accroches/consigne.md rempli depuis config/niche.exemple.json (niche fictive « paysagistes ») :
// tous les crochets remplis, aucun ne reste, les exemples et les règles de la config y sont, et rien d'interdit n'y entre.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { schemaNiche } from "../config/schema.ts";
import { consigneDepuisConfig, crochetsRestants, lireModele, remplirConsigne, valeursConsigne } from "../scripts/accroches/consigne.mjs";
import { RACINE, exemple } from "./aides.mjs";

const NICHE = schemaNiche.parse(exemple());

test("le modèle n'utilise que des crochets connus, et chacun a une valeur", () => {
  const modele = lireModele();
  const connus = Object.keys(valeursConsigne(NICHE)).map((n) => `[${n}]`);
  const presents = [...new Set(crochetsRestants(modele))];
  assert.ok(presents.length >= 10, presents.join(" "));
  for (const c of presents) assert.ok(connus.includes(c), `crochet inconnu : ${c}`);
  for (const c of connus) assert.ok(presents.includes(c), `crochet jamais utilisé : ${c}`);
});

test("consigne remplie depuis niche.exemple.json : aucun crochet restant, la config y est", async () => {
  const consigne = await consigneDepuisConfig(fileURLToPath(new URL("config/niche.exemple.json", RACINE)));
  assert.deepEqual(crochetsRestants(consigne), []);
  for (const e of NICHE.accroche.exemples) assert.ok(consigne.includes(`« ${e} »`), e);
  assert.ok(consigne.includes(NICHE.cible.description));
  assert.ok(consigne.includes(NICHE.offre.promesse.replace(/\.$/, "")));
  assert.ok(consigne.includes("de 15 à 30 mots, 160 caractères au plus"));
  assert.ok(consigne.includes("en vouvoyant"));
  assert.ok(consigne.includes("« terrasse », « bassin »"));
  assert.ok(consigne.includes("« numéro un »"));
  assert.ok(consigne.includes(`l'équipe « ${NICHE.marque.nomEquipe} »`));
  assert.ok(consigne.includes('{"id": "identifiant de la fiche", "accroche": "La phrase.", "source": {"url"'));
  assert.ok(!/—/.test(consigne), "aucun tiret cadratin");
});

test("la consigne suit la config : tutoiement, longueur, mots indices vides", () => {
  const n = structuredClone(NICHE);
  n.script.vouvoiement = false;
  n.accroche.longueurMax = 120;
  n.accroche.motsIndices = [];
  n.accroche.interdits = [];
  const c = remplirConsigne(lireModele(), n);
  assert.ok(c.includes("en tutoyant"));
  assert.ok(c.includes("120 caractères au plus"));
  assert.ok(c.includes("aucun mot propre à la niche"));
  assert.ok(c.includes("Mots refusés en plus pour cette niche : aucun."));
});

test("un crochet inconnu dans le modèle arrête tout", () => {
  assert.throws(() => remplirConsigne("Bonjour [inconnu] et [cible]", NICHE), /Crochets inconnus.*\[inconnu\]/);
});
