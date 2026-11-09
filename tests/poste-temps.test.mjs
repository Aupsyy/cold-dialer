// Le temps du Poste (lib/poste/temps.ts) : fuseau, heure d'été, jours fériés par pays, jours ouvrés, libellés.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  debutDuJour,
  depuisChampsLocaux,
  estJourOuvre,
  instantDans,
  jourDans,
  jourOuvreSuivant,
  joursFeries,
  libelleHeure,
  libelleJour,
  paques,
  partiesDans,
  versChampsLocaux,
} from "../lib/poste/temps.ts";

const PARIS = "Europe/Paris";
const iso = (t) => new Date(t).toISOString();

test("Pâques et les jours fériés de France", () => {
  assert.equal(paques(2026), "2026-04-05");
  assert.equal(paques(2027), "2027-03-28");
  assert.deepEqual(joursFeries(2026, "FR"), [
    "2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01",
    "2026-11-11", "2026-12-25",
  ]);
});

test("les jours fériés dépendent du pays de la config", () => {
  assert.ok(joursFeries(2026, "BE").includes("2026-07-21"), "fête nationale belge");
  assert.ok(!joursFeries(2026, "BE").includes("2026-07-14"));
  assert.ok(joursFeries(2026, "CH").includes("2026-08-01"));
  assert.ok(joursFeries(2026, "LU").includes("2026-06-23"));
  assert.ok(joursFeries(2026, "MC").includes("2026-11-19"));
  const ca = joursFeries(2026, "CA");
  for (const j of ["2026-04-03", "2026-05-18", "2026-06-24", "2026-07-01", "2026-09-07", "2026-10-12"]) assert.ok(ca.includes(j), j);
  assert.deepEqual(joursFeries(2026, "ZZ"), [], "pays inconnu : seulement le week-end");
});

test("jours ouvrés : ni samedi, ni dimanche, ni jour férié", () => {
  assert.ok(estJourOuvre("2026-11-09", "FR"), "lundi");
  assert.ok(!estJourOuvre("2026-11-11", "FR"), "11 novembre");
  assert.ok(!estJourOuvre("2026-11-14", "FR"), "samedi");
  assert.ok(estJourOuvre("2026-07-14", "BE"), "le 14 juillet est ouvré en Belgique");
  assert.equal(jourOuvreSuivant("2026-11-10", "FR"), "2026-11-12", "le férié du mercredi est sauté");
  assert.equal(jourOuvreSuivant("2026-11-13", "FR"), "2026-11-16", "vendredi -> lundi");
  assert.equal(jourOuvreSuivant("2026-12-24", "FR"), "2026-12-28", "Noël un vendredi -> lundi");
  assert.equal(estJourOuvre("2026-02-30", "FR"), false, "un jour qui n'existe pas");
});

test("une heure locale devient le bon instant, heure d'hiver comme heure d'été", () => {
  assert.equal(iso(instantDans("2026-03-27", 9, 30, PARIS)), "2026-03-27T08:30:00.000Z", "hiver : UTC+1");
  assert.equal(iso(instantDans("2026-03-30", 9, 30, PARIS)), "2026-03-30T07:30:00.000Z", "été : UTC+2");
  assert.equal(iso(instantDans("2026-11-09", 10, 0, "America/Toronto")), "2026-11-09T15:00:00.000Z");
  assert.equal(iso(instantDans("2026-07-01", 10, 0, "America/Toronto")), "2026-07-01T14:00:00.000Z");
  assert.ok(Number.isNaN(instantDans("bientôt", 9, 0, PARIS)));
});

test("le jour local d'un instant suit le fuseau", () => {
  const t = Date.parse("2026-11-09T23:30:00Z");
  assert.equal(jourDans(t, PARIS), "2026-11-10");
  assert.equal(jourDans(t, "America/Toronto"), "2026-11-09");
  assert.deepEqual(partiesDans(t, PARIS), { jour: "2026-11-10", heure: 0, minute: 30 });
  assert.equal(iso(debutDuJour(t, PARIS)), "2026-11-09T23:00:00.000Z");
});

test("libellés : heure et jour relatifs, en français", () => {
  const maintenant = Date.parse("2026-11-09T09:00:00Z"); // lundi 10 h à Paris
  assert.equal(libelleHeure(Date.parse("2026-11-10T08:30:00Z"), PARIS), "9 h 30");
  assert.equal(libelleHeure(Date.parse("2026-11-10T15:00:00Z"), PARIS), "16 h");
  assert.equal(libelleJour(maintenant, maintenant, PARIS), "aujourd'hui");
  assert.equal(libelleJour(Date.parse("2026-11-10T09:00:00Z"), maintenant, PARIS), "demain");
  assert.equal(libelleJour(Date.parse("2026-11-12T09:00:00Z"), maintenant, PARIS), "jeudi");
  assert.equal(libelleJour(Date.parse("2026-11-19T09:00:00Z"), maintenant, PARIS), "jeudi 19 novembre");
});

test("champs date et heure saisis, lus dans le fuseau de la config", () => {
  assert.equal(iso(depuisChampsLocaux("2026-11-10", "14:30", PARIS)), "2026-11-10T13:30:00.000Z");
  assert.equal(depuisChampsLocaux("2026-11-31", "14:30", PARIS), null);
  assert.equal(depuisChampsLocaux("2026-11-10", "25:00", PARIS), null);
  assert.equal(depuisChampsLocaux("", "", PARIS), null);
  assert.deepEqual(versChampsLocaux(Date.parse("2026-11-10T13:30:00Z"), PARIS), { date: "2026-11-10", heure: "14:30" });
});
