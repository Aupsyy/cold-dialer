// L'annonce d'enregistrement au Poste : la case se coche PENDANT l'appel seulement (lancé, pas encore raccroché) ; après, l'écran
// informe que l'audio ne sera pas conservé, sans jamais inviter à cocher après coup. Une annonce ne vaut que pour UN appel.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ALERTE_SANS_ANNONCE, annonceCochable, appliquerSignal, libelleCaseAnnonce, nouvelAppel, refusCocheAnnonce } from "../lib/poste/appel.ts";
import { lire } from "./aides.mjs";

const T0 = Date.parse("2026-11-09T09:00:00Z");
const INVITATION = /coche-la|coche l'annonce|si tu l'as lue|sans annonce et suivant/i;

test("la case de l'annonce : cochable pendant l'appel seulement", () => {
  assert.equal(annonceCochable(null), false, "avant « Appeler »");
  const enCours = nouvelAppel(T0);
  assert.equal(annonceCochable(enCours), true, "pendant l'appel");
  assert.equal(annonceCochable({ ...enCours, fin: T0 + 60_000 }), false, "après « Raccroché »");
  const finParLeTelephone = appliquerSignal(enCours, { etat: "termine", direction: "sortant", dureeS: 60, leadId: null }, T0 + 60_000);
  assert.equal(annonceCochable(finParLeTelephone), false, "après la fin signalée par le téléphone");
  assert.match(refusCocheAnnonce(null) ?? "", /Lance l'appel d'abord/);
  assert.equal(refusCocheAnnonce(enCours), null);
  assert.match(refusCocheAnnonce({ ...enCours, fin: T0 + 1000 }) ?? "", /ne se coche que pendant l'appel/);
});

test("après la fin de l'appel : une information, jamais une invitation à cocher", () => {
  const fini = { ...nouvelAppel(T0), fin: T0 + 60_000 };
  for (const texte of [libelleCaseAnnonce(fini, null), ALERTE_SANS_ANNONCE]) {
    assert.match(texte, /ne seront pas conservés/);
    assert.doesNotMatch(texte, INVITATION);
  }
  assert.equal(libelleCaseAnnonce(nouvelAppel(T0), null), "J'ai lu l'annonce au prospect");
  assert.match(libelleCaseAnnonce(null, null), /s'active pendant l'appel/);
  assert.match(libelleCaseAnnonce(fini, "9 h 01"), /^Annonce lue à 9 h 01/);
});

test("le Poste branche ces règles : case désactivée hors de l'appel, aucune confirmation « sans annonce », un nouvel appel repart d'une case vide", () => {
  const src = lire("app/(app)/poste/AppelFiche.tsx");
  assert.match(src, /disabled=\{!annonceCochable\(appel\)/);
  assert.match(src, /refusCocheAnnonce\(appel\)/);
  assert.doesNotMatch(src, INVITATION);
  assert.doesNotMatch(src, /confirmerSansAnnonce/);
  assert.match(src, /setAppel\(nouvelAppel\(Date\.now\(\)\)\);\n(\s*\/\/[^\n]*\n)*\s*setAnnonceLue\(null\);/);
});

test("« Appeler » réserve la fiche AVANT de composer : si un collègue vient de la prendre, aucun appel ne part", () => {
  const src = lire("app/(app)/poste/AppelFiche.tsx");
  const debut = src.indexOf("async function appeler()");
  const fin = src.indexOf("\n  }\n", debut);
  const corps = src.slice(debut, fin);
  const reserve = corps.indexOf("await reserverFiche(");
  assert.ok(reserve > 0, "la réservation est attendue dans appeler()");
  for (const appel of ["client.appeler(", "window.location.href"]) {
    assert.ok(corps.indexOf(appel) > reserve, `${appel} vient après la réservation`);
  }
  assert.match(corps.slice(reserve, corps.indexOf("client.appeler(")), /dejaPrise\)\s*\{[^}]*return;/, "fiche déjà prise : on s'arrête sans composer");
});
