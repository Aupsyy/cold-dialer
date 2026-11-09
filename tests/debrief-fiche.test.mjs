// La recherche de la fiche d'un débrief (scripts/debrief/lib.mjs) : par id, par téléphone (9 derniers chiffres), par nom d'entreprise ;
// « plusieurs » ou « aucune » donnent les candidats (identifiants seulement). D'abord sur une base simulée, puis (si la base locale est là)
// sur la graine de démonstration, sous la RLS d'un compte. Données fictives seulement.
import assert from "node:assert/strict";
import { test } from "node:test";
import { choisirParEntreprise, rechercherFiche, tel9 } from "../scripts/debrief/lib.mjs";
import { admin, connecter, dansUneTransaction, equipeDemo, SANS_BASE } from "./debrief-base.mjs";

const FICHES = [
  { id: "11111111-1111-4111-8111-111111111111", entreprise: "Atelier Démo 01", telephone: "+33199000001", mobile: null, statut: "a_appeler", last_activity_at: null },
  { id: "22222222-2222-4222-8222-222222222222", entreprise: "Jardins Démo", telephone: "+33199000002", mobile: "+33639980002", statut: "a_rappeler", last_activity_at: "2026-11-02T10:00:00Z" },
  { id: "33333333-3333-4333-8333-333333333333", entreprise: "JARDINS DEMO", telephone: "+33199000003", mobile: "+33639980002", statut: "a_appeler", last_activity_at: null },
  { id: "44444444-4444-4444-8444-444444444444", entreprise: "Paysages Fictifs du Lac", telephone: null, mobile: null, statut: "clos", last_activity_at: null },
];

/** Une base simulée : elle répond aux trois requêtes de rechercherFiche, sur la liste FICHES. */
async function requeteSimulee(sql, params) {
  if (/where id = \$1/.test(sql)) return FICHES.filter((f) => f.id === params[0]);
  if (/telephone_9 = \$1/.test(sql)) return FICHES.filter((f) => tel9(f.telephone) === params[0] || tel9(f.mobile) === params[0]);
  return FICHES;
}

test("choisirParEntreprise : exacte (casse, accents, ponctuation ignorés), plusieurs, aucune avec des fiches proches", () => {
  assert.deepEqual(choisirParEntreprise("atelier demo 01", FICHES), { etat: "trouvee", par: "entreprise", id: FICHES[0].id, candidats: [] });
  const plusieurs = choisirParEntreprise("Jardins Démo", FICHES);
  assert.equal(plusieurs.etat, "plusieurs");
  assert.deepEqual(plusieurs.candidats.map((c) => c.id), [FICHES[1].id, FICHES[2].id]);
  assert.deepEqual(Object.keys(plusieurs.candidats[0]).sort(), ["derniere", "id", "statut"], "ni nom, ni ville, ni numéro");
  assert.equal(plusieurs.candidats[0].derniere, "2026-11-02");
  const aucune = choisirParEntreprise("Paysages Fictifs", FICHES);
  assert.equal(aucune.etat, "aucune");
  assert.deepEqual(aucune.candidats.map((c) => c.id), [FICHES[3].id]);
  assert.deepEqual(choisirParEntreprise("Inconnu Total", FICHES).candidats, []);
  assert.equal(choisirParEntreprise("  ", FICHES).etat, "aucune");
});

test("rechercherFiche (base simulée) : id, puis téléphone, puis entreprise", async () => {
  assert.equal((await rechercherFiche(requeteSimulee, { id: FICHES[3].id })).id, FICHES[3].id);
  const parId = await rechercherFiche(requeteSimulee, { id: "55555555-5555-4555-8555-555555555555", entreprise: "Atelier Démo 01" });
  assert.deepEqual(parId, { etat: "aucune", par: "id", candidats: [] }, "un id donné ne retombe jamais sur un autre critère");
  const parTel = await rechercherFiche(requeteSimulee, { telephone: "01 99 00 00 01" });
  assert.deepEqual([parTel.etat, parTel.par, parTel.id], ["trouvee", "telephone", FICHES[0].id]);
  const mobile = await rechercherFiche(requeteSimulee, { telephone: "06 39 98 00 02" });
  assert.deepEqual([mobile.etat, mobile.par, mobile.total], ["plusieurs", "telephone", 2]);
  const repli = await rechercherFiche(requeteSimulee, { telephone: "01 99 00 09 99", entreprise: "Paysages fictifs du lac" });
  assert.deepEqual([repli.etat, repli.par], ["trouvee", "entreprise"], "téléphone inconnu : on retombe sur le nom");
  assert.deepEqual(await rechercherFiche(requeteSimulee, { telephone: "01 99 00 09 99" }), { etat: "aucune", par: "telephone", candidats: [] });
});

test("rechercherFiche sur la graine de démonstration, sous la RLS (base locale)", { skip: SANS_BASE }, async () => {
  await dansUneTransaction(async (c) => {
    const comptes = await equipeDemo(c);
    const requete = async (sql, params) => (await c.query(sql, params)).rows;
    const fiche = async (entreprise) => (await c.query("select id from public.leads where entreprise = $1", [entreprise])).rows[0].id;
    const f07 = await fiche("Atelier Démo 07");
    const f08 = await fiche("Atelier Démo 08");
    // Un doublon de nom (autre numéro), et une fiche dont le mobile est le numéro de la fiche 08.
    await c.query(`insert into public.leads (entreprise, telephone, workspace_id) values ('ATELIER DEMO 07', '+33199000901', 'd0000000-0000-4000-8000-000000000000')`);
    await c.query(`insert into public.leads (entreprise, telephone, mobile, workspace_id) values ('Atelier Démo 41', '+33199000902', '01 99 00 00 08', 'd0000000-0000-4000-8000-000000000000')`);

    await connecter(c, comptes.appelant);
    assert.equal((await rechercherFiche(requete, { id: f07 })).id, f07);
    const parTel = await rechercherFiche(requete, { telephone: "+33 1 99 00 00 07" });
    assert.deepEqual([parTel.etat, parTel.par, parTel.id], ["trouvee", "telephone", f07]);
    const deux = await rechercherFiche(requete, { telephone: "01 99 00 00 08" });
    assert.deepEqual([deux.etat, deux.total], ["plusieurs", 2]);
    assert.ok(deux.candidats.some((x) => x.id === f08));
    const nom = await rechercherFiche(requete, { entreprise: "atelier demo 08" });
    assert.deepEqual([nom.etat, nom.id], ["trouvee", f08]);
    const doublon = await rechercherFiche(requete, { entreprise: "Atelier Démo 07" });
    assert.deepEqual([doublon.etat, doublon.par, doublon.total], ["plusieurs", "entreprise", 2]);
    const proches = await rechercherFiche(requete, { entreprise: "Démo 1" });
    assert.equal(proches.etat, "aucune");
    assert.ok(proches.candidats.length > 0 && proches.candidats.length <= 10);
    assert.deepEqual(await rechercherFiche(requete, { telephone: "01 99 00 09 99" }), { etat: "aucune", par: "telephone", candidats: [] });

    // Une fiche attribuée au propriétaire n'existe pas pour l'appelant.
    await admin(c);
    await c.query("update public.leads set assigned_to = $1 where id = $2", [comptes.proprietaire, f07]);
    await connecter(c, comptes.appelant);
    assert.equal((await rechercherFiche(requete, { telephone: "01 99 00 00 07" })).etat, "aucune");
    await connecter(c, comptes.proprietaire);
    assert.equal((await rechercherFiche(requete, { telephone: "01 99 00 00 07" })).id, f07);
    await admin(c);
  });
});
