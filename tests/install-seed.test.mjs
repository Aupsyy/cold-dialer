// L'installation, la graine de démonstration (scripts/install/seed-demo.mjs) contre une VRAIE base PostgreSQL locale (migration 0001) :
// simulation sans trace, écriture, rejeu sans doublon, refus d'une base sans équipe ou qui a déjà des fiches réelles (sauf --forcer),
// effacement de la démonstration seule. Tout se passe dans UNE transaction annulée à la fin (le script travaille alors dans un point de
// sauvegarde : option transactionExterne) : rien ne reste, et les autres tests lancés en même temps sur la base ne voient rien.
// Seulement sur une base LOCALE (SUPABASE_DB_URL vers 127.0.0.1 ou localhost), sinon le test se saute : « npm test » le saute,
// « npm run test:base » le joue (il lit .env.local).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { configurationConnexion, estUrlLocale } from "../scripts/install/lib.mjs";
import { executerGraine } from "../scripts/install/seed-demo.mjs";

const url = process.env.SUPABASE_DB_URL ?? "";
let raison = estUrlLocale(url) ? null : "pas de base locale (SUPABASE_DB_URL vers 127.0.0.1 ou localhost)";
let client = null;
if (!raison) {
  client = new pg.Client(configurationConnexion(url));
  try {
    await client.connect();
    await client.query("select public.version_schema(), public.workspace_resolu(null)");
  } catch {
    raison = "base locale injoignable ou sans la migration 0001";
    await client.end().catch(() => {});
    client = null;
  }
}
after(async () => {
  await client?.end().catch(() => {});
});

const n = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);
const fichesDemo = (ws) => n("select count(*)::int as n from public.leads where workspace_id = $1 and sources @> '[{\"type\":\"demo\"}]'::jsonb", [ws]);
const toutesFiches = (ws) => n("select count(*)::int as n from public.leads where workspace_id = $1", [ws]);
const options = (o) => ({ transactionExterne: true, ...o });
const texte = (r) => [...r.lignes, r.erreur ?? ""].join("\n");

test("la graine : simulation sans trace, écriture, rejeu sans doublon, effacement de la démonstration seule", { skip: raison ?? false }, async () => {
  await client.query("begin");
  try {
    // Une base sans équipe : refus, sauf --forcer (simulation : rien ne reste).
    const sansEquipe = await executerGraine(client, options({}));
    if ((await n("select count(*)::int as n from public.workspaces")) === 0) {
      assert.equal(sansEquipe.code, 1);
      assert.match(sansEquipe.erreur, /Aucune équipe/);
      const force = await executerGraine(client, options({ forcer: true }));
      assert.equal(force.code, 0, texte(force));
      assert.match(texte(force), /« Équipe démo », qui serait créée/);
      assert.equal(await n("select count(*)::int as n from public.workspaces"), 0, "la simulation ne laisse aucune équipe");
    }

    const ws = (await client.query("insert into public.workspaces (nom) values ('Équipe test graine (temporaire)') returning id")).rows[0].id;
    if ((await n("select count(*)::int as n from public.workspaces")) !== 1) {
      // Une autre équipe VALIDÉE existe dans cette base locale : la graine refuse (une instance, une équipe). Rien à tester de plus ici.
      const r = await executerGraine(client, options({}));
      assert.equal(r.code, 1);
      assert.match(r.erreur, /plusieurs équipes/);
      return;
    }

    // Simulation : des compteurs exacts, rien de gardé.
    const essai = await executerGraine(client, options({}));
    assert.equal(essai.code, 0, texte(essai));
    assert.match(texte(essai), /Simulation \(rien n'est gardé\)/);
    assert.match(texte(essai), /fiches fictives qui seraient ajoutées : 40 \(déjà là : 0\)/);
    assert.match(texte(essai), /dont en « ne plus contacter », sur la liste d'opposition : 1/);
    assert.equal(await toutesFiches(ws), 0, "la simulation n'a rien gardé");

    // Écriture, puis rejeu : rien de neuf.
    const ecrit = await executerGraine(client, options({ appliquer: true }));
    assert.equal(ecrit.code, 0, texte(ecrit));
    assert.equal(await fichesDemo(ws), 40);
    // La fiche « ne plus contacter » : son numéro et, par le déclencheur de l'opposition, son SIREN.
    assert.equal(await n("select count(*)::int as n from public.opposition where workspace_id = $1", [ws]), 2);
    assert.equal(await n("select count(*)::int as n from public.imports where workspace_id = $1 and source = 'demo'", [ws]), 1);
    const rejeu = await executerGraine(client, options({ appliquer: true }));
    assert.equal(rejeu.code, 0, texte(rejeu));
    assert.match(texte(rejeu), /fiches fictives ajoutées : 0 \(déjà là : 40\)/);
    assert.equal(await fichesDemo(ws), 40);

    // Une fiche réelle (fictive pour le test, mais sans la marque « demo ») : refus, sauf --forcer.
    await client.query(
      "insert into public.leads (workspace_id, entreprise, siren, telephone, sources) values ($1, 'Auto-école Démo 01', '000000902', '+33199009902', '[{\"type\":\"manuel\",\"le\":\"2026-11-09\"}]'::jsonb)",
      [ws],
    );
    await client.query("insert into public.opposition (workspace_id, telephone, motif, source) values ($1, '+33639989902', 'Opposition hors démonstration (fictive)', 'manuel')", [ws]);
    const refus = await executerGraine(client, options({}));
    assert.equal(refus.code, 1);
    assert.match(refus.erreur, /déjà 1 fiche\(s\) réelle\(s\)/);
    assert.equal((await executerGraine(client, options({ forcer: true }))).code, 0);

    // Effacement : simulation, puis pour de bon ; la fiche réelle reste.
    const essaiEffacer = await executerGraine(client, options({ effacer: true }));
    assert.equal(essaiEffacer.code, 0, texte(essaiEffacer));
    assert.match(texte(essaiEffacer), /fiches fictives qui seraient retirées : 40/);
    assert.match(texte(essaiEffacer), /leurs lignes d'opposition : 2 ; ligne d'import « demo » : 2/, "le rejeu a noté sa propre ligne d'import");
    assert.match(texte(essaiEffacer), /fiches réelles : 1, jamais touchées/);
    assert.equal(await fichesDemo(ws), 40, "la simulation n'efface rien");
    const efface = await executerGraine(client, options({ effacer: true, appliquer: true }));
    assert.equal(efface.code, 0, texte(efface));
    assert.equal(await fichesDemo(ws), 0);
    assert.equal(await toutesFiches(ws), 1, "la fiche réelle est toujours là");
    assert.equal(await n("select count(*)::int as n from public.opposition where workspace_id = $1", [ws]), 1, "seule l'opposition hors démonstration reste");
    assert.equal(await n("select count(*)::int as n from public.imports where workspace_id = $1 and source = 'demo'", [ws]), 0);

    // La sortie : des compteurs, jamais un numéro, un e-mail ni un SIREN.
    for (const r of [essai, ecrit, rejeu, refus, essaiEffacer, efface]) {
      assert.doesNotMatch(texte(r), /\+33|@example|0000000\d\d|example\.org/);
    }
  } finally {
    await client.query("rollback");
  }
});

test("la graine : une erreur de la base n'affiche que son code et n'écrit rien", { skip: raison ?? false }, async () => {
  await client.query("begin");
  try {
    const ws = (await client.query("insert into public.workspaces (nom) values ('Équipe test graine (temporaire)') returning id")).rows[0].id;
    const r = await executerGraine(client, options({ appliquer: true, forcer: true, sql: "select 1/0" }));
    assert.equal(r.code, 1);
    assert.match(r.erreur, /la base a refusé \(code 22012\) ; rien n'a été écrit/);
    assert.equal(await toutesFiches(ws), 0);
  } finally {
    await client.query("rollback");
  }
});
