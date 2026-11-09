// L'ordre de la file d'appels (lib/poste/file.ts) sur un jeu de fiches fictives : rappels dus d'abord, puis urgents, puis tier A, B, C,
// puis score décroissant et moins de tentatives ; exclusions (statuts finaux, opposition, tentatives au plafond).
import assert from "node:assert/strict";
import { test } from "node:test";
import { comparerFile, construireFile, estDansFile, ficheSuivante } from "../lib/poste/file.ts";

const MAINTENANT = Date.parse("2026-11-09T09:00:00Z");
let n = 0;
function fiche(id, champs = {}) {
  n += 1;
  return {
    id,
    entreprise: `Atelier Démo ${String(n).padStart(2, "0")}`,
    ville: "Lyon",
    tier: null,
    score: null,
    statut: "a_appeler",
    tentatives: 0,
    rappelLe: null,
    urgent: false,
    assigneA: null,
    derniereIssue: null,
    creeLe: `2026-10-${String(10 + n).padStart(2, "0")}T08:00:00Z`,
    ...champs,
  };
}

const JEU = [
  fiche("c-score-80", { tier: "C", score: 80 }),
  fiche("b-score-50", { tier: "B", score: 50 }),
  fiche("a-score-60-2-tentatives", { tier: "A", score: 60, tentatives: 2 }),
  fiche("a-score-60-0-tentative", { tier: "A", score: 60 }),
  fiche("a-score-90", { tier: "A", score: 90 }),
  fiche("sans-tier", { score: 99 }),
  fiche("urgent-c", { tier: "C", score: 10, urgent: true }),
  fiche("rappel-du-9h", { tier: "C", statut: "a_rappeler", rappelLe: "2026-11-09T08:00:00Z" }),
  fiche("rappel-du-hier", { tier: "B", statut: "a_appeler", rappelLe: "2026-11-08T15:00:00Z", tentatives: 1 }),
  fiche("rappel-a-venir", { tier: "A", statut: "a_rappeler", rappelLe: "2026-11-10T08:30:00Z" }),
  fiche("rdv-fixe", { tier: "A", score: 99, statut: "rdv_fixe" }),
  fiche("pas-interesse", { tier: "A", statut: "pas_interesse" }),
  fiche("hors-cible", { tier: "A", statut: "hors_cible" }),
  fiche("injoignable", { tier: "A", statut: "injoignable" }),
  fiche("opposition", { tier: "A", score: 100, statut: "ne_plus_contacter" }),
  fiche("au-plafond", { tier: "A", score: 95, tentatives: 4 }),
  fiche("rappel-promis-au-plafond", { tier: "B", statut: "a_rappeler", rappelLe: "2026-11-09T07:00:00Z", tentatives: 4 }),
  fiche("deja-appelee", { tier: "A", score: 99 }),
];

test("l'ordre de la file : rappels dus, urgents, tier, score, tentatives", () => {
  const f = construireFile(JEU, { maintenant: MAINTENANT, tentativesMax: 4, appeleesAujourdhui: new Set(["deja-appelee"]) });
  assert.deepEqual(
    f.dus.map((x) => x.id),
    ["rappel-du-hier", "rappel-promis-au-plafond", "rappel-du-9h"],
    "les rappels dus, le plus en retard d'abord (un rappel promis reste même au plafond de tentatives)",
  );
  assert.deepEqual(f.aAppeler.map((x) => x.id), [
    "urgent-c",
    "a-score-90",
    "a-score-60-0-tentative",
    "a-score-60-2-tentatives",
    "b-score-50",
    "c-score-80",
    "sans-tier",
  ]);
  assert.deepEqual(f.aVenir.map((x) => x.id), ["rappel-a-venir"]);
  assert.deepEqual(f.dejaAppelees.map((x) => x.id), ["deja-appelee"], "déjà appelée aujourd'hui : en bas, hors de l'enchaînement");
  assert.deepEqual(f.ordre, [...f.dus, ...f.aAppeler].map((x) => x.id));
});

test("hors de la file : statuts finaux, opposition, tentatives au plafond", () => {
  const f = construireFile(JEU, { maintenant: MAINTENANT, tentativesMax: 4 });
  const ids = new Set([...f.dus, ...f.aAppeler, ...f.aVenir, ...f.dejaAppelees].map((x) => x.id));
  for (const exclue of ["rdv-fixe", "pas-interesse", "hors-cible", "injoignable", "opposition", "au-plafond"]) {
    assert.ok(!ids.has(exclue), `${exclue} ne doit pas être dans la file`);
  }
  assert.ok(ids.has("deja-appelee"));
  // Le plafond vient de la config : avec 5 tentatives permises, la fiche à 4 revient.
  assert.ok(estDansFile(JEU.find((x) => x.id === "au-plafond"), { tentativesMax: 5 }));
  // Une opposition connue à part (en plus du statut, que la base garantit) exclut aussi.
  const enOpposition = (x) => x.id === "a-score-90";
  assert.ok(!construireFile(JEU, { maintenant: MAINTENANT, tentativesMax: 4, enOpposition }).ordre.includes("a-score-90"));
});

test("une fiche en double n'apparaît qu'une fois ; un rappel illisible compte comme absent", () => {
  const x = fiche("double", { tier: "A", score: 10 });
  const illisible = fiche("rappel-illisible", { tier: "B", rappelLe: "bientôt" });
  const f = construireFile([x, x, illisible], { maintenant: MAINTENANT, tentativesMax: 4 });
  assert.deepEqual(f.ordre, ["double", "rappel-illisible"]);
});

test("comparerFile est un ordre stable (à égalité : la fiche la plus ancienne)", () => {
  const a = fiche("x1", { tier: "A", score: 50, creeLe: "2026-01-01T00:00:00Z" });
  const b = fiche("x2", { tier: "A", score: 50, creeLe: "2026-02-01T00:00:00Z" });
  assert.ok(comparerFile(a, b) < 0 && comparerFile(b, a) > 0);
  assert.equal(comparerFile(a, a), 0);
});

test("la fiche suivante de l'enchaînement", () => {
  assert.equal(ficheSuivante(["a", "b", "c"], "a"), "b");
  assert.equal(ficheSuivante(["a", "b", "c"], "c"), "a", "en fin de file : on reprend au début");
  assert.equal(ficheSuivante(["a", "b", "c"], "z"), "a", "une fiche ouverte hors de la file : la première");
  assert.equal(ficheSuivante(["a"], "a"), null);
  assert.equal(ficheSuivante([], null), null);
});
