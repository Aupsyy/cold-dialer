// La base des tests du débrief et des retours du marché : SUPABASE_DB_URL d'une base LOCALE seulement (127.0.0.1 ou localhost, migration
// 0001 jouée). Sinon les tests qui en ont besoin sont SAUTÉS : npm test reste sans base (comme en CI, où la base locale démarre après).
// Lancer avec la base : node --env-file-if-exists=.env.local --import ./scripts/charger-ts.mjs --test tests/debrief-*.test.mjs tests/retours-*.test.mjs
// Chaque test ouvre UNE transaction et l'annule à la fin : rien n'est jamais gardé. Données fictives seulement.
import pg from "pg";
import { lire } from "./aides.mjs";

const URL_BASE = process.env.SUPABASE_DB_URL ?? "";

/** Faux si la base locale est là ; sinon la raison du saut (l'URL n'est jamais affichée). */
export const SANS_BASE = /@(127\.0\.0\.1|localhost)[:/]/.test(URL_BASE) ? false : "base locale absente (SUPABASE_DB_URL vers 127.0.0.1) : test sauté";

/** La fixture partagée des tests SQL : deux équipes (A : propriétaire a1, membre a2, appelants a3 et a4 ; B : propriétaire b1), 4 fiches. */
export const FIXTURE = lire("supabase/tests/_fixture.sql");

export const IDS = {
  equipeA: "a0000000-0000-4000-8000-000000000000",
  equipeB: "b0000000-0000-4000-8000-000000000000",
  proprietaireA: "a1000000-0000-4000-8000-000000000001",
  membreA: "a2000000-0000-4000-8000-000000000002",
  appelantA: "a3000000-0000-4000-8000-000000000003",
  appelant2A: "a4000000-0000-4000-8000-000000000004",
  proprietaireB: "b1000000-0000-4000-8000-000000000001",
  ficheA1: "ca100000-0000-4000-8000-000000000001",
  ficheA2: "ca200000-0000-4000-8000-000000000002",
  ficheA3: "ca300000-0000-4000-8000-000000000003",
  ficheB1: "cb100000-0000-4000-8000-000000000001",
};

/** Joue `fn(client)` dans une transaction annulée à la fin, quoi qu'il arrive. */
export async function dansUneTransaction(fn) {
  const client = new pg.Client({ connectionString: URL_BASE });
  await client.connect();
  await client.query("begin");
  try {
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

/** Une équipe seule (un propriétaire et un appelant), puis la graine de démonstration (40 fiches « Atelier Démo »). Exige une base vide. */
export async function equipeDemo(client) {
  const { rows } = await client.query("select count(*)::int as n from public.workspaces");
  if (rows[0].n > 0) throw new Error("la base de test doit être vide (recrée-la) : la graine exige une seule équipe");
  await client.query(`
    insert into public.workspaces (id, nom) values ('d0000000-0000-4000-8000-000000000000', 'Équipe démo (test)');
    insert into public.invitations (workspace_id, jeton, role, email) values
      ('d0000000-0000-4000-8000-000000000000', repeat('d1', 32), 'proprietaire', 'proprietaire.demo@example.com'),
      ('d0000000-0000-4000-8000-000000000000', repeat('d2', 32), 'appelant', 'appelant.demo@example.com');
    insert into auth.users (id, email, aud, role, raw_user_meta_data) values
      ('d1000000-0000-4000-8000-000000000001', 'proprietaire.demo@example.com', 'authenticated', 'authenticated',
       jsonb_build_object('jeton_invitation', repeat('d1', 32), 'nom', 'Propriétaire démo')),
      ('d2000000-0000-4000-8000-000000000002', 'appelant.demo@example.com', 'authenticated', 'authenticated',
       jsonb_build_object('jeton_invitation', repeat('d2', 32), 'nom', 'Appelant démo'));
  `);
  await client.query(lire("supabase/seed-demo.sql"));
  return { proprietaire: "d1000000-0000-4000-8000-000000000001", appelant: "d2000000-0000-4000-8000-000000000002" };
}

/** Prend l'identité d'un compte (comme les tests SQL) ; admin() revient à la connexion du test. */
export async function connecter(client, uid) {
  await client.query("select set_config('role', 'none', true)");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await client.query("select set_config('role', 'authenticated', true)");
}

export async function admin(client) {
  await client.query("select set_config('role', 'none', true)");
  await client.query("select set_config('request.jwt.claims', '', true)");
}
