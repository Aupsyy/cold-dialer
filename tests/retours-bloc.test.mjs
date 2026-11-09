// Le bloc « Appels transcrits » de la fiche (lib/retours/appels-transcrits.ts) : lecture robuste des lignes appels et debriefs, verdict
// de l'accroche, regroupement d'un appel et de ses débriefs, et la règle de l'audio (jamais sans enregistrement conservable).
import assert from "node:assert/strict";
import { test } from "node:test";
import { assembler, audioJouable, lireAppel, lireDebrief, LIBELLES_STATUT_APPEL } from "../lib/retours/appels-transcrits.ts";

const APPEL = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  fournisseur: "onoff",
  direction: "sortant",
  statut: "repondu",
  debut: "2026-11-09T14:20:00+00:00",
  duree_s: 312,
  annonce_lue: true,
  enregistrement_chemin: "a0000000-0000-4000-8000-000000000000/onoff/appel-demo.mp3",
  created_at: "2026-11-09T14:26:00+00:00",
  premiere_ligne: { t: 0, locuteur: "appelant", texte: "Bonjour." },
};

const DEBRIEF = {
  id: "dddddddd-0000-4000-8000-000000000001",
  appel_id: APPEL.id,
  source: "appel",
  appel_le: "2026-11-09T14:20:00+00:00",
  created_at: "2026-11-09T14:40:00+00:00",
  extraction: {
    version: 1,
    issue: "a_rappeler",
    objection: "pas-le-temps",
    objection_texte: null,
    interet: 2,
    decideur_joint: true,
    resume: "Résumé fictif.",
    douleurs: ["Demandes trop loin", " ", 3],
    croyances: [],
    citations: ["Citation fictive mot pour mot."],
    champs: { source_clients: "Bouche-à-oreille", zone: "" },
    prochaine_etape: { type: "rappel", date: "2026-11-12T09:00:00.000Z", detail: null },
    tags: ["zone"],
    verdict_accroche: "utile",
    duree_s: 312,
    transcription_lignes: 4,
  },
};

test("lireAppel : statut, durée, présence d'enregistrement et de transcription", () => {
  const a = lireAppel(APPEL);
  assert.deepEqual(a, {
    id: APPEL.id,
    quand: APPEL.debut,
    statut: "repondu",
    dureeS: 312,
    fournisseur: "onoff",
    direction: "sortant",
    annonceLue: true,
    enregistrement: APPEL.enregistrement_chemin,
    aTranscription: true,
  });
  const vide = lireAppel({ id: "x", statut: "super", debut: null, created_at: "2026-11-09T10:00:00Z", premiere_ligne: null, duree_s: -4 });
  assert.deepEqual([vide.statut, vide.quand, vide.aTranscription, vide.dureeS, vide.enregistrement], ["inconnu", "2026-11-09T10:00:00Z", false, null, null]);
  assert.equal(lireAppel({}), null);
  assert.equal(LIBELLES_STATUT_APPEL.sans_reponse, "Sans réponse");
});

test("lireDebrief : extraction résumée ; le verdict noté dans retours_marche prime ; champs à plat d'une autre forme", () => {
  const d = lireDebrief(DEBRIEF, null, true);
  assert.equal(d.issue, "a_rappeler");
  assert.equal(d.verdict, "accroche", "« utile » du débrief, lu en valeur de base");
  assert.deepEqual(d.douleurs, ["Demandes trop loin"]);
  assert.deepEqual(d.champs, [{ id: "source_clients", valeur: "Bouche-à-oreille" }]);
  assert.deepEqual(d.prochaineEtape, { type: "rappel", date: "2026-11-12T09:00:00.000Z", detail: null });
  assert.equal(d.aTranscription, true);
  assert.equal(lireDebrief(DEBRIEF, "rejet").verdict, "rejet");
  const plat = lireDebrief({ id: "y", extraction: { zone: "Lyon", issue: "rdv_fixe", interet: 7, prochaine_etape: { type: "aucune" } } });
  assert.deepEqual(plat.champs, [{ id: "zone", valeur: "Lyon" }]);
  assert.deepEqual([plat.interet, plat.prochaineEtape, plat.verdict, plat.source], [null, null, null, "colle"]);
  assert.equal(lireDebrief({ extraction: {} }), null);
  assert.deepEqual(lireDebrief({ id: "z", extraction: "pas un objet" }).douleurs, []);
});

test("assembler : un appel et ses débriefs ensemble, les débriefs seuls à part, du plus récent au plus ancien", () => {
  const appel = lireAppel(APPEL);
  const ancien = lireAppel({ ...APPEL, id: "aaaaaaaa-0000-4000-8000-000000000002", debut: "2026-11-02T09:00:00Z" });
  const lie = lireDebrief(DEBRIEF);
  const seul = lireDebrief({ ...DEBRIEF, id: "dddddddd-0000-4000-8000-000000000002", appel_id: null, source: "colle", appel_le: "2026-11-05T09:00:00Z" });
  const orphelin = lireDebrief({ ...DEBRIEF, id: "dddddddd-0000-4000-8000-000000000003", appel_id: "inconnu", appel_le: "2026-11-01T09:00:00Z" });
  const e = assembler([ancien, appel], [seul, lie, orphelin]);
  assert.deepEqual(
    e.map((x) => [x.cle, x.debriefs.map((d) => d.id)]),
    [
      [`appel-${appel.id}`, [lie.id]],
      [`debrief-${seul.id}`, [seul.id]],
      [`appel-${ancien.id}`, []],
      [`debrief-${orphelin.id}`, [orphelin.id]],
    ],
  );
  assert.deepEqual(assembler([], []), []);
});

test("audio : seulement un enregistrement conservable (chemin posé, annonce lue, enregistrement complet toujours activé)", () => {
  const a = lireAppel(APPEL);
  assert.equal(audioJouable(a, true), true);
  assert.equal(audioJouable(a, false), false, "enregistrement coupé depuis dans les réglages");
  assert.equal(audioJouable({ ...a, annonceLue: false }, true), false);
  assert.equal(audioJouable({ ...a, enregistrement: null }, true), false);
});
