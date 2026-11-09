// L'écriture d'un débrief contre la base locale (scripts/debrief/ecrire.mjs) : essai annulé, écriture réelle (debriefs, retours_marche,
// note datée, champs vides de la fiche), champs remplis jamais écrasés, RLS (un appelant, une autre équipe), --issue, appel en base
// conservable ou non (le comportement RÉEL de la base est vérifié), création de fiche, liste d'opposition.
// Chaque test tourne dans une transaction annulée (fixture des tests SQL : deux équipes). Sans base locale : sauté.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { traiterDebrief } from "../scripts/debrief/ecrire.mjs";
import { exemple } from "./aides.mjs";
import { admin, connecter, dansUneTransaction, FIXTURE, IDS, SANS_BASE } from "./debrief-base.mjs";
import { debrief } from "./debrief-exemple.mjs";

const niche = chargerNiche(exemple());
const options = { skip: SANS_BASE };
const ilYA = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const dansJours = (jours) => new Date(Date.now() + jours * 86_400_000).toISOString();

/** Le débrief d'exemple, adapté à la fixture : fiche A2 (numéro +33199000102), appel d'il y a 10 minutes, rappel dans 2 jours. */
const surA2 = (x = {}, r = {}) =>
  debrief(
    { prochaine_etape: { type: "rappel", date: dansJours(2), detail: null }, ...x },
    { lead: { telephone: "01 99 00 01 02" }, appel: { debut: ilYA(10), duree_s: 312 }, ...r },
  );

const traiter = (client, entree, autres = {}) => traiterDebrief({ client, entree, niche, imbriquee: true, ...autres });
const compter = async (c, table, lead) => (await c.query(`select count(*)::int as n from public.${table} where lead_id = $1`, [lead])).rows[0].n;

test("essai : tout est contrôlé par la base, puis annulé ; rien n'est écrit", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    const r = await traiter(c, surA2(), { appelant: "appelant.a@example.com" });
    assert.equal(r.statut, "essai", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    assert.equal(r.fiche.id, IDS.ficheA2);
    assert.equal(r.fiche.par, "telephone");
    assert.deepEqual(r.fiche.remplis, ["source_clients", "objection"]);
    assert.equal(r.debrief.transcription.gardee, true);
    assert.equal((await c.query("select current_user as u")).rows[0].u, "postgres", "l'identité empruntée est rendue");
    for (const table of ["debriefs", "retours_marche", "lead_activities"]) assert.equal(await compter(c, table, IDS.ficheA2), 0, table);
    const fiche = (await c.query("select qualification, objection from public.leads where id = $1", [IDS.ficheA2])).rows[0];
    assert.deepEqual([fiche.qualification, fiche.objection], [{}, null]);
  });
});

test("écriture : débrief, retour du marché, note datée, champs vides remplis, sous l'identité de l'appelant", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    const r = await traiter(c, surA2(), { appelant: "appelant.a@example.com", ecrire: true });
    assert.equal(r.statut, "ecrit", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    const d = (await c.query("select * from public.debriefs where lead_id = $1", [IDS.ficheA2])).rows;
    assert.equal(d.length, 1);
    assert.equal(d[0].appelant_id, IDS.appelantA);
    assert.equal(d[0].source, "colle");
    assert.equal(d[0].appel_id, null);
    assert.match(d[0].transcription, /^Appelant : Bonjour/);
    assert.equal(d[0].extraction.issue, "a_rappeler");
    assert.equal(d[0].extraction.verdict_accroche, "utile");
    assert.deepEqual(d[0].mots_cles, ["plateformes", "distance"]);
    const rm = (await c.query("select * from public.retours_marche where lead_id = $1", [IDS.ficheA2])).rows;
    assert.equal(rm.length, 1);
    assert.equal(rm[0].debrief_id, d[0].id);
    assert.equal(rm[0].appelant_id, IDS.appelantA);
    assert.equal(rm[0].accroche_verdict, "accroche");
    assert.equal(rm[0].objection_code, "pas-le-temps");
    assert.equal(rm[0].interet, 2);
    assert.equal(rm[0].decideur_joint, true);
    assert.match(rm[0].citation, /^Les plateformes m'envoient/);
    const act = (await c.query("select * from public.lead_activities where lead_id = $1", [IDS.ficheA2])).rows;
    assert.equal(act.length, 1);
    assert.equal(act[0].type, "note");
    assert.equal(act[0].appelant_id, IDS.appelantA);
    assert.equal(act[0].duree_s, 312);
    assert.match(act[0].note, /^Débrief de l'appel du .*\nIssue : À rappeler\n/);
    const fiche = (await c.query("select qualification, objection, statut, last_activity_at from public.leads where id = $1", [IDS.ficheA2])).rows[0];
    assert.deepEqual(fiche.qualification, { source_clients: "Bouche-à-oreille, un peu les plateformes" });
    assert.equal(fiche.objection, "pas-le-temps");
    assert.equal(fiche.statut, "a_appeler", "sans --issue, le statut ne bouge pas");
    assert.ok(fiche.last_activity_at, "la dernière activité suit la note");
  });
});

test("un champ déjà rempli n'est jamais écrasé (qualification, objection, dirigeant)", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    await c.query(`update public.leads set qualification = '{"source_clients": "Noté au Poste"}', objection = 'combien-ca-coute', dirigeant = 'Sacha Démo' where id = $1`, [
      IDS.ficheA1,
    ]);
    const entree = surA2({ zone: "Vingt kilomètres autour de l'atelier" }, { lead: { id: IDS.ficheA1, dirigeant: "Autre Prénom Démo", ville: "Lyon" } });
    const r = await traiter(c, entree, { appelant: IDS.proprietaireA, ecrire: true });
    assert.equal(r.statut, "ecrit", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    assert.deepEqual(r.fiche.remplis, ["zone"]);
    assert.deepEqual(r.fiche.dejaRemplis, ["source_clients", "objection", "dirigeant", "ville"]);
    const fiche = (await c.query("select qualification, objection, dirigeant, ville from public.leads where id = $1", [IDS.ficheA1])).rows[0];
    assert.deepEqual(fiche.qualification, { source_clients: "Noté au Poste", zone: "Vingt kilomètres autour de l'atelier" });
    assert.deepEqual([fiche.objection, fiche.dirigeant, fiche.ville], ["combien-ca-coute", "Sacha Démo", "Lyon"]);
  });
});

test("RLS : un appelant ne débriefe pas la fiche d'un autre ; une autre équipe ne voit rien ; plusieurs comptes = --appelant", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    const autre = await traiter(c, surA2(), { appelant: "appelant2.a@example.com", ecrire: true });
    assert.equal(autre.statut, "arret");
    assert.match(autre.raison, /aucune fiche trouvée \(par telephone\)/);
    const b = await traiter(c, surA2({}, { lead: { id: IDS.ficheA1 } }), { appelant: "proprietaire.b@example.com", ecrire: true });
    assert.equal(b.statut, "arret");
    assert.match(b.raison, /aucune fiche trouvée \(par id\)/);
    const personne = await traiter(c, surA2(), { ecrire: true });
    assert.equal(personne.statut, "arret");
    assert.match(personne.raison, /plusieurs comptes dans l'équipe : précise --appelant/);
    const inconnu = await traiter(c, surA2(), { appelant: "personne@example.com", ecrire: true });
    assert.match(inconnu.raison, /aucun compte ne correspond/);
    for (const lead of [IDS.ficheA1, IDS.ficheA2]) assert.equal(await compter(c, "debriefs", lead), 0);
  });
});

test("--issue : l'issue est enregistrée comme au Poste (enregistrer_issue) ; jamais rdv_fixe", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    const rappel = dansJours(2);
    const entree = surA2({ prochaine_etape: { type: "rappel", date: rappel, detail: "jeudi matin" } }, { lead: { id: IDS.ficheA1 } });
    const r = await traiter(c, entree, { appelant: "appelant.a@example.com", ecrire: true, avecIssue: true });
    assert.equal(r.statut, "ecrit", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    assert.deepEqual(r.issue, { enregistree: true, statut: "a_rappeler" });
    const fiche = (await c.query("select statut, rappel_le, assigned_to, derniere_issue, objection from public.leads where id = $1", [IDS.ficheA1])).rows[0];
    assert.equal(fiche.statut, "a_rappeler");
    assert.equal(fiche.rappel_le.toISOString(), rappel);
    assert.equal(fiche.assigned_to, IDS.appelantA, "une fiche non attribuée revient à l'appelant, comme au Poste");
    assert.equal(fiche.derniere_issue, "a_rappeler");
    assert.equal(fiche.objection, "pas-le-temps");
    const act = (await c.query("select type, issue, note from public.lead_activities where lead_id = $1", [IDS.ficheA1])).rows;
    assert.equal(act.length, 1, "une seule activité : l'appel, avec la note datée");
    assert.deepEqual([act[0].type, act[0].issue], ["appel", "a_rappeler"]);
    assert.match(act[0].note, /^Débrief de l'appel/);
    const rdv = await traiter(c, surA2({ issue: "rdv_fixe" }), { appelant: "appelant.a@example.com", ecrire: true, avecIssue: true });
    assert.equal(rdv.statut, "invalide");
    assert.match(rdv.erreurs.join(), /rdv_fixe/);
  });
});

test("appel en base NON conservable : la base refuse d'en garder la transcription ; le débrief s'écrit sans elle", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    const debut = ilYA(15);
    const e = (await c.query("select public.evenement_appel($1::jsonb, $2) as e", [
      JSON.stringify({ fournisseur: "onoff", externeId: "appel-l6-1", numeroExterne: "+33199000101", statut: "repondu", debut, fin: ilYA(10), dureeS: 300, emailAppelant: "proprietaire.a@example.com" }),
      IDS.equipeA,
    ])).rows[0].e;
    assert.equal(e.leadId, IDS.ficheA1);
    assert.equal(e.conserverAudio, false, "enregistrement complet désactivé : rien n'est conservable");
    // Le comportement réel de la base : un débrief lié à cet appel ne peut pas garder de transcription (déclencheur debriefs_verifier_appel).
    await connecter(c, IDS.proprietaireA);
    await c.query("savepoint direct");
    await assert.rejects(
      c.query("insert into public.debriefs (lead_id, appel_id, source, transcription) values ($1, $2, 'appel', 'Transcription fictive')", [IDS.ficheA1, e.id]),
      (err) => err.code === "42501",
    );
    await c.query("rollback to savepoint direct");
    await admin(c);
    // Le script le voit avant : il écrit le débrief sans la transcription, et le dit.
    const entree = surA2({}, { lead: null, source: undefined, appel: { externe_id: "appel-l6-1", fournisseur: "onoff" } });
    const r = await traiter(c, entree, { appelant: "proprietaire.a@example.com", ecrire: true });
    assert.equal(r.statut, "ecrit", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    assert.equal(r.fiche.par, "appel");
    assert.deepEqual(r.debrief.transcription, { gardee: false, lignes: 4, origine: "json", raison: "appel non conservable (enregistrement désactivé ou annonce non lue)" });
    const d = (await c.query("select appel_id, source, transcription, appel_le from public.debriefs where lead_id = $1", [IDS.ficheA1])).rows[0];
    assert.equal(d.appel_id, e.id);
    assert.equal(d.source, "appel");
    assert.equal(d.transcription, null);
    assert.equal(d.appel_le.toISOString(), debut, "sans appel.debut dans le JSON : la date de l'appel en base");
  });
});

test("appel en base conservable : sa transcription est reprise, gardée, et les citations y sont vérifiées", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    await c.query("update public.reglages set enregistrement_complet = true, annonce_lue_le = now() where workspace_id = $1", [IDS.equipeA]);
    const e = (await c.query("select public.evenement_appel($1::jsonb, $2) as e", [
      JSON.stringify({ fournisseur: "onoff", externeId: "appel-l6-2", numeroExterne: "+33199000101", statut: "repondu", debut: ilYA(20), dureeS: 240, emailAppelant: "proprietaire.a@example.com", annonceJouee: true }),
      IDS.equipeA,
    ])).rows[0].e;
    assert.equal(e.conserverAudio, true);
    const lignes = [
      { t: 0, locuteur: "appelant", texte: "Bonjour, je vous appelle au sujet de vos demandes de devis." },
      { t: 4, locuteur: "prospect", texte: "En ce moment on refuse des chantiers, on n'a pas assez de bras." },
    ];
    const t = (await c.query("select public.transcription_appel('onoff', 'appel-l6-2', $1::jsonb, null, $2) as t", [JSON.stringify(lignes), IDS.equipeA])).rows[0].t;
    assert.equal(t.garde, true);
    const base = { lead: null, source: undefined, transcription: [], appel: { externe_id: "appel-l6-2", fournisseur: "onoff" } };
    const faux = await traiter(c, surA2({ citations: ["On a trop de demandes."] }, base), { appelant: "proprietaire.a@example.com", ecrire: true });
    assert.equal(faux.statut, "invalide");
    assert.match(faux.erreurs.join(), /introuvable mot pour mot dans la transcription de l'appel/);
    const r = await traiter(c, surA2({ citations: ["on refuse des chantiers, on n'a pas assez de bras"], douleurs: ["Manque de bras"] }, base), {
      appelant: "proprietaire.a@example.com",
      ecrire: true,
    });
    assert.equal(r.statut, "ecrit", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    assert.deepEqual(r.debrief.transcription, { gardee: true, lignes: 2, origine: "appel", raison: null });
    const d = (await c.query("select transcription, appel_id from public.debriefs where lead_id = $1", [IDS.ficheA1])).rows[0];
    assert.equal(d.appel_id, e.id);
    assert.match(d.transcription, /\nProspect : En ce moment on refuse des chantiers/);
    const sans = await traiter(c, surA2({ citations: [] }, base), { appelant: "proprietaire.a@example.com", ecrire: true, sansTranscription: true });
    assert.equal(sans.debrief.transcription.raison, "option --sans-transcription");
  });
});

test("créer la fiche si elle manque ; jamais pour un numéro de la liste d'opposition", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    const nouvelle = { lead: { telephone: "01 99 00 09 98", entreprise: "Atelier Démo 98", ville: "Vienne" }, creer_si_absent: true };
    const sansCreer = await traiter(c, surA2({}, { ...nouvelle, creer_si_absent: false }), { appelant: IDS.membreA, ecrire: true });
    assert.equal(sansCreer.statut, "arret");
    assert.match(sansCreer.raison, /"creer_si_absent": true/);
    const r = await traiter(c, surA2({}, nouvelle), { appelant: IDS.membreA, ecrire: true });
    assert.equal(r.statut, "ecrit", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    assert.equal(r.fiche.par, "creee");
    const f = (await c.query("select entreprise, telephone, ville, sources, workspace_id from public.leads where id = $1", [r.fiche.id])).rows[0];
    assert.deepEqual([f.entreprise, f.telephone, f.ville, f.workspace_id], ["Atelier Démo 98", "+33199000998", "Vienne", IDS.equipeA]);
    assert.equal(f.sources[0].type, "debrief");
    await c.query("insert into public.opposition (workspace_id, telephone, motif) values ($1, '+33199000997', 'Exemple fictif')", [IDS.equipeA]);
    const oppose = await traiter(c, surA2({}, { lead: { telephone: "01 99 00 09 97", entreprise: "Atelier Démo 97" }, creer_si_absent: true }), {
      appelant: IDS.membreA,
      ecrire: true,
    });
    assert.equal(oppose.statut, "arret");
    assert.match(oppose.raison, /liste d'opposition/);
  });
});

test("« ne plus contacter » dit pendant l'appel : l'issue est enregistrée d'office (statut et liste d'opposition), même sans --issue", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    const entree = surA2({ issue: "ne_plus_contacter", objection: null, interet: 0, prochaine_etape: null }, { lead: { id: IDS.ficheA1 } });
    const r = await traiter(c, entree, { appelant: "appelant.a@example.com", ecrire: true });
    assert.equal(r.statut, "ecrit", JSON.stringify(r.erreurs ?? r.raison ?? r.erreur));
    assert.deepEqual(r.issue, { enregistree: true, statut: "ne_plus_contacter" });
    assert.equal(r.journal.type, "appel");
    assert.match(r.avertissements.join(" | "), /enregistrée d'office/);
    const fiche = (await c.query("select statut, derniere_issue from public.leads where id = $1", [IDS.ficheA1])).rows[0];
    assert.deepEqual([fiche.statut, fiche.derniere_issue], ["ne_plus_contacter", "ne_plus_contacter"]);
    const opp = (await c.query("select count(*)::int as n from public.opposition where workspace_id = $1 and siren = '000000001'", [IDS.equipeA])).rows[0].n;
    assert.equal(opp, 1, "le SIREN de la fiche est sur la liste d'opposition");
    const act = (await c.query("select type, issue from public.lead_activities where lead_id = $1", [IDS.ficheA1])).rows;
    assert.deepEqual(act.map((a) => [a.type, a.issue]), [["appel", "ne_plus_contacter"]], "une seule activité : l'appel, pas une note de plus");
    // Une fiche déjà opposée : rien de neuf à verrouiller, le débrief s'écrit en note.
    const encore = await traiter(c, entree, { appelant: "appelant.a@example.com", ecrire: true });
    assert.equal(encore.statut, "ecrit", JSON.stringify(encore.erreurs ?? encore.raison ?? encore.erreur));
    assert.deepEqual(encore.issue, { enregistree: false });
    assert.equal(encore.journal.type, "note");
  });
});

test("créer une fiche : jamais pour une entreprise sur la liste d'opposition (clé nom et code postal), même sans numéro connu", options, async () => {
  await dansUneTransaction(async (c) => {
    await c.query(FIXTURE);
    await c.query("insert into public.opposition (workspace_id, cle, motif) values ($1, public.cle_entreprise('Atelier Démo 96', null), 'Exemple fictif')", [IDS.equipeA]);
    const r = await traiter(c, surA2({}, { lead: { telephone: "01 99 00 09 96", entreprise: "ATELIER DÉMO 96" }, creer_si_absent: true }), {
      appelant: IDS.membreA,
      ecrire: true,
    });
    assert.equal(r.statut, "arret");
    assert.match(r.raison, /liste d'opposition/);
  });
});
