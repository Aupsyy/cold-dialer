// Les contrats gelés de la téléphonie et de l'agenda : registres, adaptateur « telephone », cohérence avec la migration SQL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRE_AGENDA, adaptateurAgenda } from "../lib/agenda/registre.ts";
import { CANAUX_RDV, CHAMPS_EVENEMENT_RDV, FOURNISSEURS_AGENDA, SOURCES_RDV, STATUTS_RDV } from "../lib/agenda/types.ts";
import { REGISTRE_TELEPHONIE, adaptateurTelephonie, originesMicro } from "../lib/telephonie/registre.ts";
import { estAppareilMobile, lienAppel, telephone } from "../lib/telephonie/telephone.ts";
import {
  CHAMPS_EVENEMENT_APPEL,
  FOURNISSEURS_TELEPHONIE,
  MODES_PAR_FOURNISSEUR,
  STATUTS_APPEL,
} from "../lib/telephonie/types.ts";
import { RE_ORIGINE_MICRO } from "../lib/securite/entetes.ts";
import { lire } from "./aides.mjs";

const SQL = lire("supabase/migrations/0001_schema.sql");

function fonctionSql(nom) {
  const debut = SQL.indexOf(`create or replace function public.${nom}(`);
  assert.ok(debut >= 0, `fonction SQL absente : ${nom}`);
  return SQL.slice(debut, SQL.indexOf("$$;", SQL.indexOf("as $$", debut)));
}

test("le registre de téléphonie : chaque adaptateur sous son identifiant, un fournisseur inconnu donne null", () => {
  for (const [id, a] of Object.entries(REGISTRE_TELEPHONIE)) assert.equal(a.id, id);
  assert.equal(adaptateurTelephonie("telephone"), telephone);
  assert.equal(adaptateurTelephonie("autre"), null);
  assert.deepEqual(originesMicro("autre"), []);
  for (const a of Object.values(REGISTRE_TELEPHONIE)) {
    assert.ok(FOURNISSEURS_TELEPHONIE.includes(a.id));
    assert.ok(a.originesMicro.every((o) => RE_ORIGINE_MICRO.test(o)), `${a.id} : origine de micro invalide`);
  }
  for (const f of FOURNISSEURS_TELEPHONIE) assert.ok(MODES_PAR_FOURNISSEUR[f].length > 0, f);
});

test("l'adaptateur telephone : lien tel: d'un numéro E.164, copie, mobile ou ordinateur", async () => {
  assert.equal(lienAppel("+33199000101"), "tel:+33199000101");
  assert.equal(lienAppel(" +33199000101 ", "sip"), "sip:+33199000101");
  for (const v of ["0199000101", "+33 1 99 00 01 01", "+0123", "javascript:alert(1)"]) assert.equal(lienAppel(v), null, v);
  assert.ok(estAppareilMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"));
  assert.ok(!estAppareilMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"));
  assert.equal(telephone.client.etat(), "pret");
  assert.equal(typeof telephone.client.preparer({}), "function");
  assert.equal(await telephone.client.appeler("+33199000101", { leadId: "x" }), "repli_tel", "sans presse-papiers ni navigateur : repli");
  await assert.rejects(() => telephone.client.appeler("0199000101", { leadId: "x" }), /format international/);
  assert.equal(telephone.webhook, undefined);
});

// (Les quatre adaptateurs d'agenda y sont rangés : tests/agenda-registre.test.mjs.)
test("le registre d'agenda : chaque adaptateur sous son identifiant, un fournisseur inconnu donne null", () => {
  for (const [id, a] of Object.entries(REGISTRE_AGENDA)) {
    assert.ok(FOURNISSEURS_AGENDA.includes(id), id);
    assert.equal(a.id, id);
    assert.equal(adaptateurAgenda(id), a);
  }
  assert.equal(adaptateurAgenda("autre"), null);
  assert.deepEqual([...FOURNISSEURS_AGENDA], ["calendly", "iclosed", "google", "aucun"]);
});

test("EvenementAppel : chaque clé lue par la base figure dans evenement_appel", () => {
  const corps = fonctionSql("evenement_appel");
  for (const cle of CHAMPS_EVENEMENT_APPEL) assert.ok(corps.includes(`'${cle}'`), `clé non lue par evenement_appel : ${cle}`);
  assert.ok(!corps.includes("'urlEnregistrement'"), "l'URL de l'audio n'est jamais lue par la base");
  for (const s of STATUTS_APPEL) assert.ok(corps.includes(`'${s}'`), `statut inconnu de la base : ${s}`);
  for (const f of FOURNISSEURS_TELEPHONIE) assert.ok(corps.includes(`'${f}'`), `fournisseur inconnu de la base : ${f}`);
});

test("EvenementRdv : chaque clé lue par la base figure dans evenement_agenda", () => {
  const corps = fonctionSql("evenement_agenda");
  for (const cle of CHAMPS_EVENEMENT_RDV) assert.ok(corps.includes(`'${cle}'`), `clé non lue par evenement_agenda : ${cle}`);
});

test("les listes fermées de l'agenda sont celles de la table rendez_vous", () => {
  const table = SQL.slice(SQL.indexOf("create table public.rendez_vous"), SQL.indexOf("create unique index rendez_vous_externe_unique"));
  for (const v of [...CANAUX_RDV, ...STATUTS_RDV, ...SOURCES_RDV]) assert.ok(table.includes(`'${v}'`), `valeur absente de rendez_vous : ${v}`);
});
