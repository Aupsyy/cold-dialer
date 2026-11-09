// L'import contre une VRAIE base PostgreSQL locale (migration 0001 appliquée) : une équipe temporaire, des fiches et une opposition
// fictives, un CSV fictif ; simulation (rien n'est gardé), --appliquer, relance (rien de neuf). Tout se passe dans UNE transaction
// annulée à la fin : rien ne reste, et les autres tests qui tournent en même temps sur la base ne voient jamais l'équipe temporaire
// (l'import travaille alors dans un point de sauvegarde : option transactionExterne).
// Le test ne tourne que sur une base LOCALE : SUPABASE_DB_URL vers 127.0.0.1 ou localhost, jamais une base distante (qui pourrait
// être celle de production). Sinon, ou si la base est injoignable, il se saute lui-même. Il ne lit pas .env.local : le lanceur le fait
// (node --env-file-if-exists=.env.local --import ./scripts/charger-ts.mjs --test tests/*.test.mjs) ; « npm test » seul le saute.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { configurationConnexion, executer, resoudreWorkspace } from "../scripts/sourcing/importer.mjs";
import { normaliserE164, tel9 } from "../scripts/sourcing/lib.mjs";
import { e164, fixe, mobile, niche, sirenFictif } from "./sourcing-outils.mjs";

const url = process.env.SUPABASE_DB_URL ?? "";
let raison = /@(127\.0\.0\.1|localhost)[:/]/.test(url) ? null : "pas de base locale (SUPABASE_DB_URL vers 127.0.0.1 ou localhost)";
let client = null;
if (!raison) {
  client = new pg.Client(configurationConnexion(url));
  try {
    await client.connect();
    await client.query("select public.version_schema(), public.identifiants_en_opposition(null, null, null, null)");
  } catch {
    raison = "base locale injoignable ou sans la migration 0001";
    await client.end().catch(() => {});
    client = null;
  }
}
after(async () => {
  await client?.end().catch(() => {});
});

const S = sirenFictif;
const N = niche();
const MAINTENANT = new Date("2026-11-09T09:00:00Z");

const CSV = [
  "entreprise;siren;telephone;mobile;email;email_source;site;ville;code_postal;source;source_date",
  `Atelier Démo 01;${S(1)};${fixe(1)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 02;;;${mobile(2)};;;;Bron;69500;Annuaire démo;2026-11-02`,
  `Atelier Démo 01 bis;${S(1)};${fixe(3)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 04;${S(4)};${fixe(1)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 05;${S(5)};${fixe(5050)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 06;${S(6)};${fixe(6)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 07;${S(7)};${fixe(7)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 10;${S(10)};${fixe(61)};;contact@example.com;https://example.org/atelier-demo-10/contact;https://example.org/atelier-demo-10;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 11;${S(9)};${fixe(70)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 15;${S(11)};${fixe(80)};;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 10 encore;;${fixe(60)};;;;;Lyon;69003;sirene;2026-11-01`,
  `;${S(20)};;;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 13;12345;;;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 12;${S(13)};;;;;;Lyon;69003;sirene;2026-11-01`,
  `Atelier Démo 14;${S(14)};;;;;;Lyon;69003;sirene;2026-11-01`,
].join("\n");
const STOP = `siren;telephone\n${S(6)};\n;${fixe(7)}\n`;

async function compter(ws, table) {
  return Number((await client.query(`select count(*)::int as n from public.${table} where workspace_id = $1`, [ws])).rows[0].n);
}

test("les numéros : la règle JS est celle de la fonction SQL normaliser_e164 (et tel9)", { skip: raison ?? false }, async () => {
  const numeros = [
    "01 99 00 01 01", "+33 (0)1 99 00 01 01", "0033199000101", "33199000101", "06.39.98.00.01", "0199", "", "  ", "+33 1 99 00 01 01 99",
    "514 555 0123", "1 514 555 0123", "+1 514 555 0123", "0032 2 000 00 01", "02 000 00 01", "+41 0 00 000 00 01", "00 1 514 555 0123",
    "abc", "+0 12 34 56", "0 1 2", "(01) 99-00/01.01",
  ];
  for (const pays of ["FR", "BE", "CH", "LU", "MC", "CA", "ES"]) {
    for (const n of numeros) {
      const { rows } = await client.query("select public.normaliser_e164($1, $2) as e, public.tel9($1) as t", [n, pays]);
      assert.equal(normaliserE164(n, pays), rows[0].e, `normaliser_e164(${JSON.stringify(n)}, ${pays})`);
      assert.equal(tel9(n), rows[0].t, `tel9(${JSON.stringify(n)})`);
    }
  }
});

test("l'import réel : simulation sans trace, --appliquer, relance sans rien de neuf, opposition et STOP respectées", { skip: raison ?? false }, async (t) => {
  await client.query("begin");
  try {
    const ws = (await client.query("insert into public.workspaces (nom) values ('Équipe test import (temporaire)') returning id")).rows[0].id;
    // L'opposition fictive, puis les fiches déjà en base.
    await client.query("insert into public.opposition (workspace_id, telephone, motif, source) values ($1, $2, 'Exemple fictif', 'manuel')", [ws, e164(fixe(5050))]);
    const existante = async (entreprise, siren, telephone, autres = {}) =>
      (
        await client.query(
          `insert into public.leads (workspace_id, entreprise, siren, telephone, statut, notes, email, site, ville, cp, departement, score, tier, sources)
           values ($1, $2, $3, $4, coalesce($5, 'a_appeler'), $6, $7, $8, $9, $10, $11, $12, $13, coalesce($14::jsonb, '[]'::jsonb)) returning id`,
          [ws, entreprise, siren, telephone, autres.statut, autres.notes, autres.email, autres.site, autres.ville, autres.cp, autres.departement, autres.score, autres.tier, autres.sources],
        )
      ).rows[0].id;
    const l1 = await existante("Atelier Démo 10", S(10), e164(fixe(60)), { notes: "Note de l'équipe (fictive)", sources: '[{"type":"manuel","le":"2026-10-01"}]' });
    const l2 = await existante("Atelier Démo 11", null, e164(fixe(70)));
    const l3 = await existante("Atelier Démo 12", S(13), e164(fixe(90)), { statut: "ne_plus_contacter" });
    const l4 = await existante("Atelier Démo 13", S(12), e164(fixe(80)));
    await existante("Atelier Démo 14", S(14), e164(fixe(100)), { email: "contact@example.com", site: "https://example.org/atelier-demo-14", ville: "Lyon", cp: "69003", departement: "69", score: 50, tier: "B" });
    const options = { niche: N, texteCsv: CSV, texteStop: STOP, workspace: ws, maintenant: MAINTENANT, transactionExterne: true };
    const attendus = { invalides: 2, stop: 2, doublons_siren: 1, doublons_telephone: 1, opposition: 2, conflits: 1, meme_fiche: 1, inchangees: 1, mises_a_jour: 2, creees: 2 };
    const verifier = (c, a) => {
      for (const [cle, valeur] of Object.entries(a)) assert.equal(c[cle], valeur, `compteur ${cle}`);
      const somme = c.invalides + c.stop + c.doublons_siren + c.doublons_telephone + c.sans_numero + c.opposition + c.conflits + c.meme_fiche + c.inchangees + c.mises_a_jour + c.creees;
      assert.equal(somme, c.lues, "chaque ligne lue est comptée une fois");
    };

    await t.test("simulation (par défaut) : compteurs exacts, rien n'est gardé", async () => {
      const r = await executer(client, options);
      assert.equal(r.erreur, null);
      verifier(r.compteurs, attendus);
      assert.ok(!/Démo|example|\d{7,}/.test(r.lignes.join("\n")), "la sortie ne cite aucune donnée");
      assert.equal(await compter(ws, "leads"), 5);
      assert.equal(await compter(ws, "imports"), 0, "le journal de la simulation est annulé avec elle");
    });

    await t.test("--appliquer : fiches créées et complétées, verrous respectés, journal des imports", async () => {
      const r = await executer(client, { ...options, appliquer: true });
      assert.equal(r.erreur, null);
      verifier(r.compteurs, attendus);
      assert.equal(await compter(ws, "leads"), 7);

      const { rows: nouvelles } = await client.query(
        "select siren, telephone, mobile, cp, departement, statut, score, tier, sources, last_activity_at from public.leads where workspace_id = $1 and entreprise in ('Atelier Démo 01', 'Atelier Démo 02') order by entreprise",
        [ws],
      );
      assert.deepEqual(
        nouvelles.map((l) => [l.siren, l.telephone, l.mobile, l.cp, l.departement, l.statut, l.last_activity_at]),
        [
          [S(1), e164(fixe(1)), null, "69003", "69", "a_appeler", null],
          [null, null, e164(mobile(2)), "69500", "69", "a_appeler", null],
        ],
      );
      assert.deepEqual(nouvelles[0].sources, [{ type: "sirene", detail: "registre SIRENE (API Recherche Entreprises)", le: "2026-11-01" }]);
      assert.deepEqual(nouvelles[1].sources, [{ type: "fichier", detail: "Annuaire démo", le: "2026-11-02" }]);
      assert.ok(Number.isInteger(nouvelles[0].score) && ["A", "B", "C"].includes(nouvelles[0].tier));

      const fiche = async (id) => (await client.query("select * from public.leads where id = $1", [id])).rows[0];
      const f1 = await fiche(l1);
      assert.equal(f1.telephone, e164(fixe(60)), "un numéro présent n'est jamais remplacé");
      assert.deepEqual([f1.email, f1.email_source, f1.site, f1.ville, f1.cp], [
        "contact@example.com",
        "https://example.org/atelier-demo-10/contact",
        "https://example.org/atelier-demo-10",
        "Lyon",
        "69003",
      ]);
      assert.equal(f1.notes, "Note de l'équipe (fictive)");
      assert.equal(f1.statut, "a_appeler");
      assert.deepEqual(f1.sources.map((s) => s.type), ["manuel", "sirene", "site"], "les sources s'ajoutent, datées");
      assert.equal((await fiche(l2)).siren, S(9), "fiche trouvée par son numéro : le SIREN manquant est complété");
      assert.equal((await fiche(l3)).statut, "ne_plus_contacter");
      assert.equal((await fiche(l4)).siren, S(12));
      const { rows: opposees } = await client.query("select count(*)::int as n from public.leads where workspace_id = $1 and telephone_9 = $2", [ws, tel9(fixe(5050))]);
      assert.equal(opposees[0].n, 0, "la fiche en opposition n'est pas importée");
      const { rows: stop } = await client.query("select count(*)::int as n from public.leads where workspace_id = $1 and (siren = $2 or telephone_9 = $3)", [ws, S(6), tel9(fixe(7))]);
      assert.equal(stop[0].n, 0, "la liste STOP est respectée");

      const { rows: journal } = await client.query(
        "select source, simulation, lues, inserees, mises_a_jour, doublons, exclues_opposition, rejetees, cree_par from public.imports where workspace_id = $1",
        [ws],
      );
      assert.deepEqual(journal, [
        { source: "csv", simulation: false, lues: 15, inserees: 2, mises_a_jour: 2, doublons: 5, exclues_opposition: 4, rejetees: 2, cree_par: null },
      ]);
    });

    await t.test("relance : rien de neuf (aucune fiche créée ni modifiée)", async () => {
      const r = await executer(client, { ...options, appliquer: true });
      assert.equal(r.erreur, null);
      assert.deepEqual([r.compteurs.creees, r.compteurs.mises_a_jour, r.compteurs.inchangees], [0, 0, 5]);
      assert.equal(await compter(ws, "leads"), 7);
      assert.equal(await compter(ws, "imports"), 2);
    });

    await t.test("plusieurs équipes dans la base : --workspace obligatoire", async () => {
      await client.query("insert into public.workspaces (nom) values ('Équipe test bis (temporaire)')");
      await assert.rejects(resoudreWorkspace(client, null), /--workspace/);
      assert.equal(await resoudreWorkspace(client, ws), ws);
    });
  } finally {
    await client.query("rollback");
  }
});

test("opposition par la clé nom et code postal : une entreprise opposée sans SIREN n'est pas réimportée, et l'import n'échoue pas", { skip: raison ?? false }, async () => {
  await client.query("begin");
  try {
    const ws = (await client.query("insert into public.workspaces (nom) values ('Équipe test import clé (temporaire)') returning id")).rows[0].id;
    // Une fiche venue de Maps, sans SIREN, opposée par son numéro : sa clé nom et code postal entre aussi sur la liste.
    await client.query("insert into public.leads (workspace_id, entreprise, telephone, cp) values ($1, 'Atelier Démo 30', $2, '69003')", [ws, e164(fixe(30))]);
    await client.query("insert into public.opposition (workspace_id, telephone, motif, source) values ($1, $2, 'Exemple fictif', 'manuel')", [ws, e164(fixe(30))]);
    // La même entreprise par le registre (avec SIREN, sans numéro : le parcours par défaut), et une autre.
    const csv = [
      "entreprise;siren;telephone;mobile;email;email_source;site;ville;code_postal;source;source_date",
      `ATELIER DÉMO 30;${S(30)};;;;;;Lyon;69003;sirene;2026-11-01`,
      `Atelier Démo 31;${S(31)};;;;;;Lyon;69003;sirene;2026-11-01`,
    ].join("\n");
    const r = await executer(client, { niche: N, texteCsv: csv, texteStop: "siren;telephone\n", workspace: ws, maintenant: MAINTENANT, transactionExterne: true, appliquer: true });
    assert.equal(r.erreur, null, "l'import n'est pas annulé par le refus de la base");
    assert.equal(r.compteurs.opposition, 1, "la ligne de l'entreprise opposée est écartée");
    assert.equal(r.compteurs.creees, 1);
    assert.equal(Number((await client.query("select count(*)::int as n from public.leads where workspace_id = $1 and siren = $2", [ws, S(30)])).rows[0].n), 0);
  } finally {
    await client.query("rollback");
  }
});
