// La lecture d'un appel déjà transcrit en base (scripts/debrief/lire-appel.mjs), pour le débrief : liste en compteurs, export dans un
// fichier HORS dépôt (droits 600), refus si l'appel n'est pas conservable ou pas visible. Base locale (sinon sauté), transaction annulée.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exporterAppel, listerAppels } from "../scripts/debrief/lire-appel.mjs";
import { RACINE } from "./aides.mjs";
import { dansUneTransaction, FIXTURE, IDS, SANS_BASE } from "./debrief-base.mjs";

const ilYA = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

async function appel(c, externeId, { conservable }) {
  const e = (await c.query("select public.evenement_appel($1::jsonb, $2) as e", [
    JSON.stringify({ fournisseur: "onoff", externeId, numeroExterne: "+33199000101", statut: "repondu", debut: ilYA(30), dureeS: 125, emailAppelant: "proprietaire.a@example.com", annonceJouee: conservable }),
    IDS.equipeA,
  ])).rows[0].e;
  const lignes = [
    { t: 0, locuteur: "appelant", texte: "Bonjour, une question rapide sur vos chantiers." },
    { t: 3, locuteur: "prospect", texte: "Allez-y, mais vite, je suis sur un chantier." },
  ];
  await c.query("select public.transcription_appel('onoff', $1, $2::jsonb, null, $3)", [externeId, JSON.stringify(lignes), IDS.equipeA]);
  return e;
}

test("lire-appel : liste en compteurs, export hors dépôt, refus si non conservable ou non visible", { skip: SANS_BASE }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), "debrief-test-"));
  try {
    await dansUneTransaction(async (c) => {
      await c.query(FIXTURE);
      await c.query("update public.reglages set enregistrement_complet = true, annonce_lue_le = now() where workspace_id = $1", [IDS.equipeA]);
      await appel(c, "appel-l6-liste", { conservable: true });
      await appel(c, "appel-l6-muet", { conservable: false });

      const liste = await listerAppels({ client: c, appelant: "proprietaire.a@example.com", imbriquee: true });
      assert.equal(liste.ok, true, liste.raison);
      assert.equal(liste.appels.length, 1, "seul l'appel conservable a une transcription en base");
      const a = liste.appels[0];
      assert.deepEqual([a.externeId, a.fournisseur, a.lignes, a.conservable, a.aFiche, a.statut], ["appel-l6-liste", "onoff", 2, true, true, "répondu"]);
      assert.equal(a.duree, "2 min 05 s");
      assert.ok(!JSON.stringify(liste).includes("+33"), "jamais un numéro");
      assert.equal((await c.query("select current_user as u")).rows[0].u, "postgres");

      const r = await exporterAppel({ client: c, appelant: "proprietaire.a@example.com", externeId: "appel-l6-liste", dossier, imbriquee: true });
      assert.equal(r.ok, true, r.raison);
      assert.equal(r.lignes, 2);
      assert.equal(statSync(r.chemin).mode & 0o777, 0o600);
      const texte = readFileSync(r.chemin, "utf8");
      assert.match(texte, /^Fournisseur : onoff\nIdentifiant \(appel\.externe_id\) : appel-l6-liste\n/);
      assert.match(texte, /\nProspect : Allez-y, mais vite, je suis sur un chantier\.\n$/);

      const muet = await exporterAppel({ client: c, appelant: "proprietaire.a@example.com", externeId: "appel-l6-muet", dossier, imbriquee: true });
      assert.deepEqual([muet.ok, /non conservable/.test(muet.raison)], [false, true]);
      const autre = await exporterAppel({ client: c, appelant: "appelant.a@example.com", externeId: "appel-l6-liste", dossier, imbriquee: true });
      assert.deepEqual([autre.ok, /non visible pour ce compte/.test(autre.raison)], [false, true]);
      const inconnu = await exporterAppel({ client: c, appelant: "proprietaire.a@example.com", externeId: "appel-absent", dossier, imbriquee: true });
      assert.match(inconnu.raison, /introuvable/);
      const depot = await exporterAppel({ client: c, appelant: "proprietaire.a@example.com", externeId: "appel-l6-liste", dossier: new URL("./", RACINE).pathname, imbriquee: true });
      assert.match(depot.raison, /dans un dépôt git/);
    });
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
