// Accroches, la base : export.mjs (fiches de l'équipe avec un site, sans accroche, hors opposition) et ecrire.mjs (contrôle anti-invention
// rejoué sur le crawl, essai par défaut, puis écriture, puis rejouer n'écrase rien ; jamais la fiche d'une autre équipe ; --workspace
// obligatoire s'il y a plusieurs équipes). Tourne seulement si SUPABASE_DB_URL (dans l'environnement) désigne une base LOCALE (127.0.0.1 ou
// localhost, migration 0001 jouée) ; sinon le test se saute : npm test reste sans base, comme en CI où la base démarre après.
// Avec la base : node --env-file-if-exists=.env.local --import ./scripts/charger-ts.mjs --test tests/*.test.mjs (npm run test:base).
// Chaque test ouvre UNE transaction annulée à la fin : rien n'est gardé. Fiches 100 % fictives : « Atelier Démo 9x », numéros de la
// plage réservée 01 99 00, sites en example.org.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PROMESSES_INTERDITES } from "../config/garde-fous.ts";
import { schemaNiche } from "../config/schema.ts";
import { baseLocale, resoudreEquipe } from "../scripts/accroches/lib/base.mjs";
import { ecrireAccroches, preparerControle, principal as ecrire, sourceSurLeSite } from "../scripts/accroches/ecrire.mjs";
import { exporterFiches, principal as exporter } from "../scripts/accroches/export.mjs";
import { RACINE, exemple } from "./aides.mjs";

const ADRESSE = process.env.SUPABASE_DB_URL ?? "";
/** Faux si la base locale est là ; sinon la raison du saut (l'adresse n'est jamais affichée). */
const RAISON = baseLocale(ADRESSE) ? false : "base locale absente (SUPABASE_DB_URL vers 127.0.0.1) : test sauté";
const CONFIG = fileURLToPath(new URL("config/niche.exemple.json", RACINE));
const PHRASE = "J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type de chantier que vous voulez développer ?";
const EXTRAIT = "Création d'un bassin naturel à Vienne en 2019.";
const NICHE = schemaNiche.parse(exemple());
const INCONNUE = "6f0c5a52-1111-4000-8000-0000000abcde";

/** Ce que le crawl et le texte compacté disent d'une fiche (la page de réalisations porte l'extrait). */
function lu(id, nn) {
  const site = `https://atelier-demo-${nn}.example.org`;
  return {
    crawl: {
      id,
      site: `${site}/`,
      origine: site,
      pages: [{ url: `${site}/realisations`, titre: "Réalisations", description: "", titres: [], texte: EXTRAIT, lu_le: "2026-11-02T09:00:00.000Z" }],
    },
    compact: { id, site: `${site}/`, indices: [{ url: `${site}/realisations`, type: "phrase", texte: EXTRAIT }] },
  };
}

/** Le crawl des fiches de la fixture (et d'une fiche lue mais absente de la base). */
function lectures(ids) {
  return [lu(ids.vide, 91), lu(ids.remplie, 92), lu(ids.stop, 93), lu(INCONNUE, 98), lu(ids.pasInteresse, 96)];
}

function controle(ids) {
  const l = lectures(ids);
  return preparerControle({ lignesCrawl: l.map((x) => x.crawl), lignesCompact: l.map((x) => x.compact), niche: NICHE, promesses: PROMESSES_INTERDITES });
}

/** Une connexion dans une transaction ouverte, ou null (test sauté) si la base locale ne répond pas ou n'a pas le schéma. */
async function ouvrir(t) {
  const client = new pg.Client({ connectionString: ADRESSE, ssl: false });
  try {
    await client.connect();
  } catch {
    t.skip("base locale injoignable");
    return null;
  }
  const { rows } = await client.query("select to_regclass('public.leads') is not null as ok");
  if (!rows[0].ok) {
    await client.end();
    t.skip("schéma absent (migration 0001 non jouée)");
    return null;
  }
  await client.query("begin");
  return client;
}

async function fermer(client) {
  await client.query("rollback").catch(() => {});
  await client.end();
}

/** Une équipe et sept fiches fictives couvrant chaque cas. */
async function fixture(client) {
  const ws = (await client.query("insert into public.workspaces (nom) values ('Équipe test accroches (fictive)') returning id")).rows[0].id;
  const ajouter = async (nn, champs = {}) => {
    const { rows } = await client.query(
      `insert into public.leads (workspace_id, entreprise, telephone, site, statut, score, tier, accroche)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text as id`,
      [
        ws,
        `Atelier Démo ${nn}`,
        `+331990000${nn}`,
        "site" in champs ? champs.site : `https://atelier-demo-${nn}.example.org/`,
        champs.statut ?? "a_appeler",
        champs.score ?? 50,
        champs.tier ?? "B",
        champs.accroche ?? null,
      ],
    );
    return rows[0].id;
  };
  const ids = {
    vide: await ajouter(91, { score: 90, tier: "A" }),
    remplie: await ajouter(92, { accroche: "Accroche déjà présente, fictive." }),
    stop: await ajouter(93, { statut: "ne_plus_contacter" }),
    rappeler: await ajouter(94, { statut: "a_rappeler" }),
    sansSite: await ajouter(95, { site: null }),
    pasInteresse: await ajouter(96, { statut: "pas_interesse", score: 40 }),
    opposition: await ajouter(97),
  };
  // La fiche 97 entre sur la liste d'opposition : la base la passe d'elle-même en « ne plus contacter ».
  await client.query("insert into public.opposition (workspace_id, telephone, motif, source) values ($1, '+33199000097', 'Exemple fictif', 'manuel')", [ws]);
  return { ws, ids };
}

const source = (nn, url) => ({ url: url ?? `https://atelier-demo-${nn}.example.org/realisations`, extrait: EXTRAIT, le: "2026-11-02" });

function validees(ids, phrase = PHRASE) {
  return [
    { id: ids.vide, accroche: phrase, source: source(91), site: "https://atelier-demo-91.example.org/", motifs: [] },
    { id: ids.remplie, accroche: phrase, source: source(92), motifs: [] },
    { id: ids.stop, accroche: phrase, source: source(93), motifs: [] },
    { id: INCONNUE, accroche: phrase, source: source(98), motifs: [] },
    { id: ids.rappeler, accroche: "", source: null, motifs: [{ code: "lieu_absent" }], refusee: "Texte refusé, fictif." },
    { id: ids.pasInteresse, accroche: phrase, source: source(96, "https://ailleurs.example.net/page"), motifs: [] },
    { id: "pas-un-identifiant", accroche: phrase, source: source(99), motifs: [] },
    // Sans « motifs » : pas passée par valide.mjs, donc jamais écrite.
    { id: ids.vide, accroche: phrase, source: source(91) },
  ];
}

async function fiche(client, id) {
  const { rows } = await client.query("select accroche, accroche_source, sources from public.leads where id = $1", [id]);
  return rows[0];
}

test("export : site présent, accroche vide, à appeler ou à rappeler, hors opposition, les mieux notées d'abord", { skip: RAISON }, async (t) => {
  const client = await ouvrir(t);
  if (!client) return;
  try {
    const { ws, ids } = await fixture(client);
    const miennes = (liste) => liste.filter((f) => Object.values(ids).includes(f.id)).map((f) => f.id);
    assert.deepEqual(miennes(await exporterFiches(client, { workspace: ws })), [ids.vide, ids.rappeler]);
    assert.deepEqual(miennes(await exporterFiches(client, { workspace: ws, tiers: ["A"] })), [ids.vide]);
    const tous = miennes(await exporterFiches(client, { workspace: ws, statuts: ["a_appeler", "a_rappeler", "pas_interesse"] }));
    assert.deepEqual(tous, [ids.vide, ids.rappeler, ids.pasInteresse]);
    const une = (await exporterFiches(client, { workspace: ws })).find((f) => f.id === ids.vide);
    assert.deepEqual(une, { id: ids.vide, entreprise: "Atelier Démo 91", site: "https://atelier-demo-91.example.org/" });
  } finally {
    await fermer(client);
  }
});

test("ecrire : essai (compteurs, rien d'écrit), puis écriture, puis rejouer n'écrase rien", { skip: RAISON }, async (t) => {
  const client = await ouvrir(t);
  if (!client) return;
  try {
    const { ws, ids } = await fixture(client);
    const options = { transaction: "externe", controle: controle(ids), workspace: ws };
    const essai = await ecrireAccroches(client, validees(ids), options);
    assert.deepEqual(essai, { lues: 8, sansAccroche: 1, refusees: 3, aEcrire: 1, dejaRemplies: 1, inconnues: 1, ecartees: 1, ecrites: 0, nonEcrites: 0 });
    assert.equal((await fiche(client, ids.vide)).accroche, null);

    const ecrit = await ecrireAccroches(client, validees(ids), { ...options, appliquer: true });
    assert.equal(ecrit.ecrites, 1);
    assert.equal(ecrit.aEcrire, 1);
    const apres = await fiche(client, ids.vide);
    assert.equal(apres.accroche, PHRASE);
    assert.equal(apres.accroche_source, "https://atelier-demo-91.example.org/realisations");
    assert.deepEqual(apres.sources.at(-1), { type: "accroche", url: "https://atelier-demo-91.example.org/realisations", extrait: EXTRAIT, le: "2026-11-02" });
    assert.equal((await fiche(client, ids.remplie)).accroche, "Accroche déjà présente, fictive.");
    assert.equal((await fiche(client, ids.stop)).accroche, null);

    const autre = "Votre bassin naturel réalisé à Vienne en 2019 m'a arrêté : c'est un type de chantier que vous aimeriez faire plus souvent ?";
    const encore = await ecrireAccroches(client, validees(ids, autre), { ...options, appliquer: true });
    assert.equal(encore.ecrites, 0);
    assert.equal(encore.aEcrire, 0);
    assert.equal(encore.dejaRemplies, 2);
    assert.equal((await fiche(client, ids.vide)).accroche, PHRASE);
    assert.equal((await fiche(client, ids.vide)).sources.filter((s) => s.type === "accroche").length, 1);
  } finally {
    await fermer(client);
  }
});

test("export.mjs et ecrire.mjs en ligne de commande : essai par défaut, --appliquer, console en compteurs", { skip: RAISON }, async (t) => {
  const client = await ouvrir(t);
  if (!client) return;
  const dossier = mkdtempSync(join(tmpdir(), "accroches-base-"));
  const journal = [];
  const noter = (l) => journal.push(l);
  try {
    const { ws, ids } = await fixture(client);
    const equipe = ["--workspace", ws];
    assert.equal(await exporter(["--dossier", dossier, "--config", CONFIG, ...equipe], { client, journal: noter }), 0);
    const exportees = JSON.parse(readFileSync(join(dossier, "a-crawler.json"), "utf8"));
    assert.ok(exportees.some((f) => f.id === ids.vide) && !exportees.some((f) => f.id === ids.opposition));

    writeFileSync(join(dossier, "validees.json"), JSON.stringify(validees(ids)));
    // Sans crawl.jsonl ni compact.jsonl, le contrôle ne peut pas être rejoué : rien n'est écrit.
    await assert.rejects(ecrire(["--dossier", dossier, "--config", CONFIG, ...equipe], { client, journal: noter }), /crawl\.jsonl ou compact\.jsonl absent/);
    const l = lectures(ids);
    writeFileSync(join(dossier, "crawl.jsonl"), `${l.map((x) => JSON.stringify(x.crawl)).join("\n")}\n`);
    writeFileSync(join(dossier, "compact.jsonl"), `${l.map((x) => JSON.stringify(x.compact)).join("\n")}\n`);
    assert.equal(await ecrire(["--dossier", dossier, "--config", CONFIG, ...equipe], { client, journal: noter }), 0);
    assert.ok(journal.some((l) => l.startsWith("Mode : ESSAI")));
    assert.ok(journal.some((l) => l.includes("À écrire : 1 ; déjà remplies (jamais écrasées) : 1 ; inconnues : 1 ; écartées (ne plus contacter) : 1.")));
    assert.equal((await fiche(client, ids.vide)).accroche, null);

    assert.equal(await ecrire(["--dossier", dossier, "--config", CONFIG, "--appliquer", ...equipe], { client, journal: noter }), 0);
    assert.ok(journal.some((l) => l === "Écrites : 1."));
    assert.equal((await fiche(client, ids.vide)).accroche, PHRASE);
    await assert.rejects(ecrire(["--dossier", dossier, "--appliquer", "--essai"], { client, journal: noter }), /pas les deux/);
    assert.ok(journal.every((l) => !/example\.(org|net)|Atelier Démo|bassin|postgres/i.test(l)), journal.join("\n"));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
    await fermer(client);
  }
});

test("la source doit être sur le site de la fiche (ou sur l'origine atteinte au crawl si le site redirigeait)", () => {
  assert.ok(sourceSurLeSite({ url: "https://www.atelier-demo-91.example.org/p" }, "https://atelier-demo-91.example.org/"));
  assert.ok(!sourceSurLeSite({ url: "https://atelier-demo-92.example.org/p" }, "https://atelier-demo-91.example.org/"));
  const redirige = { url: "https://nouveau-domaine.example.net/p", site: "https://atelier-demo-91.example.org/", origine: "https://nouveau-domaine.example.net" };
  assert.ok(sourceSurLeSite(redirige, "https://atelier-demo-91.example.org/"));
  assert.ok(!sourceSurLeSite(redirige, "https://atelier-demo-93.example.org/"));
  assert.ok(!sourceSurLeSite({ url: "https://atelier-demo-91.example.org/p" }, null));
});

test("M16 : export et écriture s'en tiennent à l'équipe ; plusieurs équipes sans --workspace : refus", { skip: RAISON }, async (t) => {
  const client = await ouvrir(t);
  if (!client) return;
  try {
    const { ws, ids } = await fixture(client);
    const autre = (await client.query("insert into public.workspaces (nom) values ('Seconde équipe test accroches (fictive)') returning id::text as id")).rows[0].id;
    const { rows } = await client.query(
      `insert into public.leads (workspace_id, entreprise, telephone, site, statut, score)
       values ($1, 'Atelier Démo 89', '+33199000089', 'https://atelier-demo-89.example.org/', 'a_appeler', 99) returning id::text as id`,
      [autre],
    );
    const etrangere = rows[0].id;
    assert.ok(!(await exporterFiches(client, { workspace: ws })).some((f) => f.id === etrangere), "jamais la fiche d'une autre équipe");
    assert.ok((await exporterFiches(client, { workspace: autre })).some((f) => f.id === etrangere));

    const l = [lu(ids.vide, 91), lu(etrangere, 89)];
    const ctl = preparerControle({ lignesCrawl: l.map((x) => x.crawl), lignesCompact: l.map((x) => x.compact), niche: NICHE, promesses: PROMESSES_INTERDITES });
    const entrees = [
      { id: ids.vide, accroche: PHRASE, source: source(91), motifs: [] },
      { id: etrangere, accroche: PHRASE, source: source(89), motifs: [] },
    ];
    const c = await ecrireAccroches(client, entrees, { appliquer: true, transaction: "externe", controle: ctl, workspace: ws });
    assert.deepEqual([c.ecrites, c.inconnues], [1, 1], "la fiche de l'autre équipe est inconnue pour celle-ci");
    assert.equal((await fiche(client, etrangere)).accroche, null);

    await assert.rejects(resoudreEquipe(client, null), /plusieurs équipes/);
    assert.equal(await resoudreEquipe(client, ws), ws);
    await assert.rejects(resoudreEquipe(client, "0a000000-0000-4000-8000-0000000000ff"), /Équipe inconnue/);
    await assert.rejects(resoudreEquipe(client, "pas-une-equipe"), /--workspace attend/);
  } finally {
    await fermer(client);
  }
});
