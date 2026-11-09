// La purge en ligne de commande (scripts/maintenance/purger.mjs) : les variables du stockage lues sans être affichées ; la simulation
// (purge jouée puis annulée) ; --appliquer avec la clé service (audios effacés, balayage) ou sans (la base purgée, le NOMBRE d'audios
// restants et la consigne d'utiliser l'écran, code 2) ; un refus de la base (code 1, rien d'effacé) ; jamais un identifiant ni un chemin
// dans la sortie. Puis contre une VRAIE base PostgreSQL locale (migration 0001), dans une transaction annulée à la fin : les compteurs
// exacts, la simulation sans trace, l'écriture, et la date limite de conservation de lib/reglages/rgpd.ts comparée à PostgreSQL.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import pg from "pg";
import { configurationConnexion, estUrlLocale } from "../scripts/install/lib.mjs";
import { envStockage, executerPurgeScript, stockageDisponible } from "../scripts/maintenance/purger.mjs";

const { lirePurge, limiteConservation } = await import("../lib/reglages/rgpd.ts");

const WS = "e9000000-0000-4000-8000-000000000000";
const CHEMINS = [`${WS}/onoff/purge-script-1.mp3`, `${WS}/aircall/purge-script-2.wav`];

/** Une connexion pg simulée : chaque ordre est noté ; la purge rend `purge`, ou lève l'erreur `erreur` ; `erreurCommit` fait échouer la validation. */
function clientSimule({ purge = { fiches: 3, appels: 4, rendezVous: 1, debriefs: 2, retours: 0, enregistrementsAEffacer: CHEMINS }, evenements = 6, erreur = null, erreurCommit = null } = {}) {
  const ordres = [];
  return {
    ordres,
    query: async (sql) => {
      ordres.push(sql.replace(/\s+/g, " ").trim());
      if (sql === "commit" && erreurCommit) throw erreurCommit;
      if (/purger_fiches_inactives/.test(sql)) {
        if (erreur) throw erreur;
        return { rows: [{ r: purge }] };
      }
      if (/purger_integrations_evenements/.test(sql)) return { rows: [{ n: evenements }] };
      return { rows: [] };
    },
  };
}

function stockageSimule({ echecs = [], balayage = { examines: 12, orphelins: 1, effaces: 1, enEchec: 0, complet: true, code: null } } = {}) {
  const effaces = [];
  return {
    effaces,
    outils: {
      effacer: async (chemin) => (echecs.includes(chemin) ? { ok: false, code: "stockage_500" } : (effaces.push(chemin), { ok: true })),
      balayer: async () => balayage,
    },
  };
}

function sansDonnee(r) {
  const t = [...r.lignes, r.erreur ?? ""].join("\n");
  assert.doesNotMatch(t, /[0-9a-f]{8}-[0-9a-f]{4}-/, "aucun identifiant");
  assert.doesNotMatch(t, /\.(mp3|wav)\b|onoff\/|aircall\//, "aucun chemin d'audio");
  return t;
}

test("les variables du stockage : l'environnement d'abord, sinon .env.local (ces deux noms seulement), jamais affichées", () => {
  const dossier = mkdtempSync(join(tmpdir(), "purge-env-"));
  try {
    const cle = `cle-${Math.random().toString(36).slice(2)}`;
    writeFileSync(join(dossier, ".env.local"), `SUPABASE_DB_URL=postgresql://exemple\nSUPABASE_SERVICE_ROLE_KEY=${cle}\nAUTRE=1\n`);
    assert.deepEqual(envStockage({ NEXT_PUBLIC_SUPABASE_URL: " https://projet.example.org " }, dossier), {
      NEXT_PUBLIC_SUPABASE_URL: "https://projet.example.org",
      SUPABASE_SERVICE_ROLE_KEY: cle,
    });
    assert.equal(stockageDisponible(envStockage({ NEXT_PUBLIC_SUPABASE_URL: "https://projet.example.org" }, dossier)), true);
    assert.deepEqual(envStockage({}, join(dossier, "absent")), {});
    assert.equal(stockageDisponible({ NEXT_PUBLIC_SUPABASE_URL: "https://projet.example.org" }), false);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("la simulation : la purge jouée puis ANNULÉE, les compteurs, aucun audio touché", async () => {
  const client = clientSimule();
  const s = stockageSimule();
  const r = await executerPurgeScript(client, { appliquer: false }, { mois: 36, stockage: s.outils, lirePurge });
  assert.equal(r.code, 0);
  assert.deepEqual(client.ordres, ["begin", "select public.purger_fiches_inactives($1) as r", "select public.purger_integrations_evenements() as n", "rollback"]);
  const t = sansDonnee(r);
  assert.match(t, /^Simulation, la purge est jouée puis annulée : rien n'est effacé \(conservation : 36 mois/);
  assert.match(t, /fiches sans activité à effacer : 3/);
  assert.match(t, /appels 4, rendez-vous 1, débriefs 2, retours du marché 0/);
  assert.match(t, /événements de webhooks de plus de 90 jours à effacer : 6/);
  assert.match(t, /audios à effacer du stockage : 2$/m);
  assert.match(t, /--appliquer/);
  assert.deepEqual(s.effaces, []);
  const sans = await executerPurgeScript(clientSimule(), { appliquer: false }, { mois: 36, stockage: null, lirePurge });
  assert.match(sans.lignes.join("\n"), /absentes ici : ils resteraient à effacer depuis l'écran Réglages/);
});

test("--appliquer avec la clé service : la base validée, puis ses audios, puis les audios restés sans appel", async () => {
  const client = clientSimule();
  const s = stockageSimule();
  const r = await executerPurgeScript(client, { appliquer: true }, { mois: 24, stockage: s.outils, lirePurge });
  assert.equal(r.code, 0);
  assert.equal(client.ordres.at(-1), "commit");
  assert.deepEqual(s.effaces, CHEMINS);
  const t = sansDonnee(r);
  assert.match(t, /^Fait \(conservation : 24 mois/);
  assert.match(t, /fiches sans activité effacées : 3/);
  assert.match(t, /audios effacés du stockage : 2$/m);
  assert.match(t, /audios restés sans appel : 1 effacé sur 1 trouvés \(12 fichiers examinés\)/);

  const echec = stockageSimule({ echecs: [CHEMINS[1]], balayage: { examines: 0, orphelins: 0, effaces: 0, enEchec: 0, complet: false, code: "liste_403" } });
  const r2 = await executerPurgeScript(clientSimule(), { appliquer: true }, { mois: 24, stockage: echec.outils, lirePurge });
  assert.equal(r2.code, 2, "des audios restent : code 2");
  const t2 = sansDonnee(r2);
  assert.match(t2, /audios effacés du stockage : 1 ; en échec : 1 \(code stockage_500\)/);
  assert.match(t2, /recherche arrêtée avant la fin \(code liste_403\)/);
});

test("--appliquer sans la clé service : la base est purgée, le NOMBRE d'audios restants et la consigne d'utiliser l'écran (code 2)", async () => {
  const client = clientSimule();
  const r = await executerPurgeScript(client, { appliquer: true }, { mois: 36, stockage: null, lirePurge });
  assert.equal(r.code, 2);
  assert.equal(client.ordres.at(-1), "commit", "la base est purgée quand même");
  const t = sansDonnee(r);
  assert.match(t, /À FAIRE : 2 audios restent dans le bucket « enregistrements » : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquent ici/);
  assert.match(t, /Lance « Purger les fiches inactives » dans l'écran Réglages/);
  const rien = await executerPurgeScript(clientSimule({ purge: { fiches: 0, appels: 0, rendezVous: 0, debriefs: 0, retours: 0, enregistrementsAEffacer: [] } }), { appliquer: true }, { mois: 36, stockage: null, lirePurge });
  assert.equal(rien.code, 0, "aucun audio : tout est fait");
});

test("un refus de la base, ou une réponse illisible : code 1, la transaction annulée, le code seulement", async () => {
  const client = clientSimule({ erreur: Object.assign(new Error("Atelier Démo 01 +33199000101"), { code: "42501" }) });
  const r = await executerPurgeScript(client, { appliquer: true }, { mois: 36, stockage: null, lirePurge });
  assert.equal(r.code, 1);
  assert.equal(client.ordres.at(-1), "rollback");
  assert.match(r.erreur, /code 42501/);
  assert.doesNotMatch(r.erreur, /Atelier|\+33/);
  const illisible = await executerPurgeScript(clientSimule({ purge: { fiches: "x" } }), { appliquer: true }, { mois: 36, stockage: null, lirePurge });
  assert.equal(illisible.code, 1);
  assert.match(illisible.erreur, /compteurs lisibles/);
});

test("une validation (COMMIT) qui échoue : code 1, aucun audio touché (ses appels sont peut-être encore en base)", async () => {
  const client = clientSimule({ erreurCommit: Object.assign(new Error("serialisation"), { code: "40001" }) });
  const s = stockageSimule();
  const r = await executerPurgeScript(client, { appliquer: true }, { mois: 36, stockage: s.outils, lirePurge });
  assert.equal(r.code, 1);
  assert.match(r.erreur, /validation de la purge a échoué \(code 40001\) ; rien n'a été effacé/);
  assert.deepEqual(client.ordres.slice(-2), ["commit", "rollback"]);
  assert.deepEqual(s.effaces, [], "aucun appel au stockage");
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Sur une vraie base locale
// ---------------------------------------------------------------------------------------------------------------------------------

const url = process.env.SUPABASE_DB_URL ?? "";
let raison = estUrlLocale(url) ? null : "pas de base locale (SUPABASE_DB_URL vers 127.0.0.1 ou localhost)";
let client = null;
if (!raison) {
  client = new pg.Client(configurationConnexion(url));
  try {
    await client.connect();
    await client.query("select public.version_schema()");
    if ((await client.query("select count(*)::int as n from public.workspaces")).rows[0].n !== 0) {
      raison = "la base locale a déjà une équipe validée : ces tests veulent une base vide (scratchpad : node appliquer.mjs <base>)";
    }
  } catch {
    raison = "base locale injoignable ou sans la migration 0001";
  }
  if (raison) {
    await client.end().catch(() => {});
    client = null;
  }
}
after(async () => {
  await client?.end().catch(() => {});
});

test("sur la base locale : la date limite comme PostgreSQL, la simulation sans trace, puis la purge pour de bon", { skip: raison ?? false }, async () => {
  await client.query("begin");
  try {
    await client.query("set local time zone 'UTC'");
    for (const [instant, mois] of [["2026-05-31T10:00:00Z", 3], ["2028-05-31T10:00:00Z", 3], ["2026-11-09T09:00:00Z", 36], ["2026-03-31T23:30:00Z", 1]]) {
      const r = await client.query("select ($1::timestamptz - make_interval(months => $2)) as limite", [instant, mois]);
      assert.equal(r.rows[0].limite.toISOString(), limiteConservation(Date.parse(instant), mois), `${instant} moins ${mois} mois`);
    }

    await client.query("insert into public.workspaces (id, nom) values ($1, 'Équipe purge (test)')", [WS]);
    await client.query(
      `insert into public.leads (id, workspace_id, entreprise, telephone, created_at) values
         ('e9100000-0000-4000-8000-000000000001', $1, 'Atelier Test purge 1', '+33199000171', now() - interval '40 months'),
         ('e9100000-0000-4000-8000-000000000002', $1, 'Atelier Test purge 2', '+33199000172', now())`,
      [WS],
    );
    await client.query(
      `insert into public.appels (workspace_id, fournisseur, externe_id, lead_id, created_at, enregistrement_chemin) values
         ($1, 'onoff', 'purge-script-1', 'e9100000-0000-4000-8000-000000000001', now() - interval '40 months', $2)`,
      [WS, CHEMINS[0]],
    );
    await client.query("insert into public.integrations_evenements (fournisseur, externe_id, type, recu_le) values ('calendly', 'purge-script-ev', 'reserve', now() - interval '100 days')");
    const compter = async () =>
      (await client.query(
        `select (select count(*)::int from public.leads where workspace_id = $1) as fiches,
                (select count(*)::int from public.appels where workspace_id = $1) as appels,
                (select count(*)::int from public.integrations_evenements where externe_id = 'purge-script-ev') as evenements`,
        [WS],
      )).rows[0];

    const s = stockageSimule();
    const essai = await executerPurgeScript(client, { appliquer: false }, { mois: 36, stockage: s.outils, transactionExterne: true, lirePurge });
    assert.equal(essai.code, 0);
    const te = sansDonnee(essai);
    assert.match(te, /fiches sans activité à effacer : 1 /);
    assert.match(te, /appels 1, rendez-vous 0, débriefs 0, retours du marché 0/);
    assert.match(te, /événements de webhooks de plus de 90 jours à effacer : 1/);
    assert.match(te, /audios à effacer du stockage : 1$/m);
    assert.deepEqual(await compter(), { fiches: 2, appels: 1, evenements: 1 }, "la simulation ne laisse aucune trace");
    assert.deepEqual(s.effaces, []);

    const fait = await executerPurgeScript(client, { appliquer: true }, { mois: 36, stockage: s.outils, transactionExterne: true, lirePurge });
    assert.equal(fait.code, 0);
    assert.match(sansDonnee(fait), /fiches sans activité effacées : 1 /);
    assert.deepEqual(await compter(), { fiches: 1, appels: 0, evenements: 0 }, "la fiche récente reste");
    assert.deepEqual(s.effaces, [CHEMINS[0]], "l'audio de l'appel purgé");
  } finally {
    await client.query("rollback");
  }
});
