// Les libellés, formats, périodes et la saisie rapide des retours du marché (lib/retours/libelles.ts, periode.ts, saisie.ts).
// Config d'exemple (niche fictive « paysagistes ») ; aucune donnée réelle.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import {
  champsDecouverte,
  dateLisible,
  dureeLisible,
  libelleChamp,
  libelleInteret,
  libelleIssue,
  libelleObjection,
  libellePourcentage,
  LIBELLES_VERDICT,
  pourcentage,
  verdictLu,
  VERDICT_EN_BASE,
} from "../lib/retours/libelles.ts";
import { bornesPeriode, libellePeriode, lirePeriode } from "../lib/retours/periode.ts";
import { MAX_SAISIE, sansGuillemets, validerSaisieRetour } from "../lib/retours/saisie.ts";
import { ErreurSaisie } from "../lib/server/validation.ts";
import { exemple } from "./aides.mjs";

const niche = chargerNiche(exemple());
const espaces = (t) => t.replace(/\s+/gu, " ");

test("libellés : objections et issues lues dans la config, codes retirés toujours lisibles", () => {
  assert.equal(libelleObjection("pas-le-temps", niche), "Je n'ai pas le temps");
  assert.equal(libelleObjection("libre", niche), "Autre objection (texte libre)");
  assert.equal(libelleObjection("ancien-code", niche), "ancien-code");
  assert.equal(libelleObjection(null, niche), "Aucune");
  assert.equal(libelleIssue("rdv_fixe", niche), "Rendez-vous fixé");
  assert.equal(libelleIssue("sous_contrat", niche), "Engagé ailleurs");
  assert.equal(libelleIssue(null, niche), "Sans issue");
});

test("champs de découverte : ceux du débrief, puis les questions du script qui manquent", () => {
  const ids = champsDecouverte(niche).map((c) => c.id);
  assert.deepEqual(ids, ["source_clients", "chantiers_voulus", "frein_principal", "zone", "capacite"]);
  assert.equal(libelleChamp("zone", niche), "Quelle zone couvre-t-il");
  assert.match(libelleChamp("capacite", niche), /^Si vous receviez plus de demandes/);
  assert.equal(libelleChamp("champ_retire", niche), "champ retire");
});

test("verdicts : la table débrief vers base, et la lecture des deux formes", () => {
  assert.deepEqual(VERDICT_EN_BASE, { utile: "accroche", neutre: "neutre", "contre-productive": "rejet" });
  assert.equal(verdictLu("utile"), "accroche");
  assert.equal(verdictLu("rejet"), "rejet");
  assert.equal(verdictLu("excellent"), null);
  assert.deepEqual(Object.values(LIBELLES_VERDICT), ["Utile", "Neutre", "Contre-productive"]);
});

test("pourcentages, intérêt moyen, durées", () => {
  assert.equal(pourcentage(1, 3), 33);
  assert.equal(pourcentage(2, 3), 67);
  assert.equal(pourcentage(1, 0), null);
  assert.equal(libellePourcentage(null), "n.d.");
  assert.equal(libellePourcentage(50), "50 %");
  assert.equal(espaces(libelleInteret(1.5)), "1,5 / 3");
  assert.equal(libelleInteret(null), "n.d.");
  assert.equal(dureeLisible(45), "45 s");
  assert.equal(dureeLisible(260), "4 min 20 s");
  assert.equal(dureeLisible(300), "5 min");
  assert.equal(dureeLisible(3720), "1 h 02 min");
  assert.equal(dureeLisible(null), "durée inconnue");
});

test("dates : dans le fuseau de l'équipe", () => {
  const iso = "2026-11-09T14:20:00Z";
  assert.equal(espaces(dateLisible(iso, "Europe/Paris")), "9 nov. 2026");
  assert.equal(espaces(dateLisible(iso, "Europe/Paris", true)), "9 nov. 2026 à 15 h 20");
  assert.equal(espaces(dateLisible(iso, "America/Montreal", true)), "9 nov. 2026 à 09 h 20");
  assert.equal(dateLisible("pas une date", "Europe/Paris"), "date inconnue");
  assert.equal(dateLisible(null, "Europe/Paris"), "date inconnue");
});

test("période : 7 jours par défaut, 30 sur demande ; bornes de la fonction SQL", () => {
  assert.equal(lirePeriode(undefined), 7);
  assert.equal(lirePeriode("30"), 30);
  assert.equal(lirePeriode(["30", "7"]), 30);
  assert.equal(lirePeriode("365"), 7);
  assert.equal(lirePeriode("trente"), 7);
  const maintenant = Date.parse("2026-11-09T12:00:00Z");
  const b = bornesPeriode(7, maintenant);
  assert.equal(b.debut, "2026-11-02T12:00:00.000Z");
  assert.equal(b.fin, "2026-11-09T12:01:00.000Z");
  assert.equal(libellePeriode(30), "30 derniers jours");
});

test("saisie rapide : objection de la config, verdict de la base, citation sans guillemets", () => {
  const codes = niche.objections.map((o) => o.code);
  assert.deepEqual(validerSaisieRetour({ objection: "pas-le-temps", verdict: "accroche", citation: " « Je suis sur les chantiers toute la semaine. » " }, codes), {
    objection_code: "pas-le-temps",
    objection_texte: null,
    accroche_verdict: "accroche",
    citation: "Je suis sur les chantiers toute la semaine.",
  });
  assert.deepEqual(validerSaisieRetour({ objection: "libre", objectionTexte: "Il attend la fin de la saison.", verdict: "" }, codes), {
    objection_code: "libre",
    objection_texte: "Il attend la fin de la saison.",
    accroche_verdict: null,
    citation: null,
  });
  assert.equal(sansGuillemets("“Exemple fictif”"), "Exemple fictif");
});

test("saisie rapide : refus lisibles", () => {
  const codes = niche.objections.map((o) => o.code);
  const refus = (brut, motif) => assert.throws(() => validerSaisieRetour(brut, codes), (e) => e instanceof ErreurSaisie && motif.test(e.message));
  refus({}, /au moins une objection/);
  refus({ objection: "", verdict: "", citation: "   " }, /au moins une objection/);
  refus({ objection: "inventee" }, /Objection : valeur non autorisée/);
  refus({ verdict: "excellent" }, /Verdict de l'accroche : valeur non autorisée/);
  refus({ verdict: "utile" }, /valeur non autorisée/);
  refus({ citation: "x".repeat(MAX_SAISIE.citation + 1) }, /300 caractères au plus/);
  refus({ objectionTexte: "Ses mots sans objection choisie." }, /Choisis l'objection/);
  refus({ objection: "libre", objectionTexte: "y".repeat(401) }, /400 caractères au plus/);
});
