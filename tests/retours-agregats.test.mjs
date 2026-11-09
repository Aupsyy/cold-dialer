// Les agrégats des retours du marché (lib/retours/agregats.ts) : lecture de la réponse de retours_marche_agreger, calcul TypeScript sur
// un jeu fictif, et (avec la base locale) ÉGALITÉ du calcul TypeScript et de la fonction SQL sur les mêmes lignes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agregatsVides, agregerLignes, lireAgregats, lireLigneRetour, moyenneArrondie, repartitionIssues } from "../lib/retours/agregats.ts";
import { admin, connecter, dansUneTransaction, FIXTURE, IDS, SANS_BASE } from "./debrief-base.mjs";

const ligne = (jour, extra = {}) => ({
  appel_le: `2026-11-0${jour}T10:00:00Z`,
  issue: null,
  objection_code: null,
  accroche_verdict: null,
  interet: null,
  decideur_joint: false,
  citation: null,
  douleur: null,
  tags: [],
  ...extra,
});

// Un jeu fictif (niche « paysagistes ») : 6 retours.
const JEU = [
  ligne(2, { issue: "rdv_fixe", objection_code: "pas-le-temps", accroche_verdict: "accroche", interet: 3, decideur_joint: true, citation: "On manque de chantiers en hiver.", tags: ["saison", "zone"] }),
  ligne(3, { issue: "pas_interesse", objection_code: "assez-de-travail", accroche_verdict: "rejet", interet: 0, tags: ["saison"] }),
  ligne(4, { issue: "a_rappeler", objection_code: "pas-le-temps", accroche_verdict: "neutre", interet: 2, douleur: "Demandes trop loin", citation: "  " }),
  ligne(5, { issue: "a_rappeler", objection_code: "combien-ca-coute", interet: 2, decideur_joint: true, citation: "Les plateformes m'envoient trop loin.", tags: ["plateformes", "zone"] }),
  ligne(6, { issue: "rdv_fixe", accroche_verdict: "accroche", douleur: "Mois creux en hiver", tags: ["saison"] }),
  ligne(7, { objection_code: "assez-de-travail" }),
];

test("agregerLignes : comptes, intérêt moyen, objections et tags classés, textes récents d'abord", () => {
  const a = agregerLignes(JEU);
  assert.equal(a.total, 6);
  assert.equal(a.decideurs, 2);
  assert.equal(a.rdv, 2);
  assert.equal(a.interetMoyen, 1.75);
  assert.deepEqual(a.objections, [
    { code: "assez-de-travail", n: 2 },
    { code: "pas-le-temps", n: 2 },
    { code: "combien-ca-coute", n: 1 },
  ]);
  assert.deepEqual(a.verdicts, { accroche: 2, neutre: 1, rejet: 1 });
  assert.deepEqual(a.tags, [
    { tag: "saison", n: 3 },
    { tag: "zone", n: 2 },
    { tag: "plateformes", n: 1 },
  ]);
  assert.deepEqual(a.citations.map((c) => c.texte), ["Les plateformes m'envoient trop loin.", "On manque de chantiers en hiver."]);
  assert.deepEqual(a.douleurs.map((d) => d.texte), ["Mois creux en hiver", "Demandes trop loin"]);
  assert.deepEqual(agregerLignes([]), agregatsVides());
});

test("moyenneArrondie : comme round(avg(), 2) de la base, sans erreur de virgule flottante", () => {
  assert.equal(moyenneArrondie([]), null);
  assert.equal(moyenneArrondie([1, 2]), 1.5);
  assert.equal(moyenneArrondie([1, 2, 2]), 1.67);
  // 201 / 200 = 1,005 exactement : la base arrondit à 1,01 ; le calcul flottant naïf (Math.round(1.005 * 100) / 100) donne 1.
  const valeurs = [...Array(67).fill(3), ...Array(133).fill(0)];
  assert.equal(valeurs.length, 200);
  assert.equal(Math.round((201 / 200) * 100) / 100, 1);
  assert.equal(moyenneArrondie(valeurs), 1.01);
});

test("lireAgregats : la réponse SQL normalisée, et rien ne plante sur une forme inattendue", () => {
  const a = lireAgregats({
    total: 3,
    decideurs: "1",
    rdv: 1,
    interetMoyen: 1.5,
    objections: [{ code: "pas-le-temps", n: 2 }, { code: "", n: 4 }, null],
    verdicts: { accroche: 1, neutre: 0, rejet: 2 },
    tags: [{ tag: "saison", n: 2 }],
    citations: [{ texte: "Citation fictive.", le: "2026-11-09T10:00:00+00:00" }, { texte: "", le: "x" }],
    douleurs: "pas une liste",
  });
  assert.equal(a.total, 3);
  assert.equal(a.decideurs, 1);
  assert.equal(a.interetMoyen, 1.5);
  assert.deepEqual(a.objections, [{ code: "pas-le-temps", n: 2 }]);
  assert.deepEqual(a.verdicts, { accroche: 1, neutre: 0, rejet: 2 });
  assert.equal(a.citations.length, 1);
  assert.deepEqual(a.douleurs, []);
  assert.deepEqual(lireAgregats(null), agregatsVides());
  assert.deepEqual(lireAgregats([1, 2]), agregatsVides());
  assert.equal(lireAgregats({ interetMoyen: "n'importe" }).interetMoyen, null);
});

test("lireLigneRetour : colonnes inattendues ignorées, date obligatoire", () => {
  assert.equal(lireLigneRetour({ appel_le: "pas une date" }), null);
  const l = lireLigneRetour({ appel_le: "2026-11-09T10:00:00Z", accroche_verdict: "super", interet: 9, tags: ["a", 3, ""], decideur_joint: "oui" });
  assert.equal(l.accroche_verdict, null);
  assert.equal(l.interet, null);
  assert.deepEqual(l.tags, ["a"]);
  assert.equal(l.decideur_joint, false);
});

test("repartitionIssues : de la plus fréquente à la moins fréquente, « sans issue » en dernier à égalité", () => {
  assert.deepEqual(repartitionIssues(JEU.map((l) => l.issue)), [
    { code: "a_rappeler", n: 2 },
    { code: "rdv_fixe", n: 2 },
    { code: "pas_interesse", n: 1 },
    { code: null, n: 1 },
  ]);
  assert.deepEqual(repartitionIssues([]), []);
});

test("le calcul TypeScript donne EXACTEMENT les agrégats de retours_marche_agreger (base locale)", { skip: SANS_BASE }, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    await connecter(c, IDS.appelantA);
    for (const l of JEU) {
      await c.query(
        `insert into public.retours_marche (lead_id, appel_le, issue, objection_code, accroche_verdict, interet, decideur_joint, citation, douleur, tags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[])`,
        [IDS.ficheA2, l.appel_le, l.issue, l.objection_code, l.accroche_verdict, l.interet, l.decideur_joint, l.citation, l.douleur, l.tags],
      );
    }
    const sql = lireAgregats((await c.query("select public.retours_marche_agreger($1, $2) as a", ["2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z"])).rows[0].a);
    const lignes = (await c.query("select * from public.retours_marche")).rows.map((r) => lireLigneRetour({ ...r, appel_le: r.appel_le.toISOString() }));
    const ts = agregerLignes(lignes);
    const sansDates = (a) => ({
      ...a,
      citations: a.citations.map((x) => ({ texte: x.texte, le: new Date(x.le).toISOString() })),
      douleurs: a.douleurs.map((x) => ({ texte: x.texte, le: new Date(x.le).toISOString() })),
    });
    assert.deepEqual(sansDates(ts), sansDates(sql));
    await admin(c);
  });
});
