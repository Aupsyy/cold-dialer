// L'installation, l'équipe (scripts/install/equipe.mjs) : la demande vérifiée (sans base), puis contre une VRAIE base PostgreSQL locale
// (migration 0001) : le propriétaire par amorcer_workspace (simulation sans trace, écriture avec le lien copié et jamais affiché, réglages
// d'après la config), son inscription (le déclencheur gerer_nouvel_utilisateur), le refus d'un second propriétaire, l'invitation d'un
// appelant, une copie impossible qui n'écrit rien. Tout se passe dans UNE transaction annulée à la fin (le script travaille dans un
// point de sauvegarde : option transactionExterne). Seulement sur une base LOCALE, sinon les tests de base se sautent.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { chargerNiche } from "../config/charger.ts";
import { configurationConnexion, ErreurInstall, estUrlLocale } from "../scripts/install/lib.mjs";
import { executerEquipe, lireDemande } from "../scripts/install/equipe.mjs";
import { exemple } from "./aides.mjs";

const url = process.env.SUPABASE_DB_URL ?? "";
let raison = estUrlLocale(url) ? null : "pas de base locale (SUPABASE_DB_URL vers 127.0.0.1 ou localhost)";
let client = null;
if (!raison) {
  client = new pg.Client(configurationConnexion(url));
  try {
    await client.connect();
    await client.query("select public.version_schema(), to_regclass('auth.users') is not null as auth");
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

const DOMAINE = "https://atelier-demo.example.org";
const EMAIL_PROPRIETAIRE = "proprietaire.equipe@example.com";
const RE_LIEN = /^https:\/\/atelier-demo\.example\.org\/signup\?invitation=([0-9a-f]{64})$/;

function niche() {
  const n = exemple();
  n.marque.nomEquipe = "Atelier Démo Conseil";
  n.tentativesMax = 6;
  return chargerNiche(n);
}

/** Un presse-papiers simulé : il garde ce qu'on lui confie. */
function pressePapiers(ok = true) {
  const copies = [];
  return { copies, copier: (valeur) => (copies.push(valeur), { ok, outil: ok ? "simule" : null }) };
}

const n = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);
const texte = (r) => [...r.lignes, r.erreur ?? ""].join("\n");

function sansDonnee(r, ...valeurs) {
  const t = texte(r);
  for (const v of valeurs) assert.ok(!t.includes(v), "une valeur sensible est affichée");
  assert.doesNotMatch(t, /[0-9a-f]{64}/, "aucun jeton");
  assert.doesNotMatch(t, /@example\.com|signup\?invitation/, "ni e-mail ni lien");
}

test("la demande : une action, un e-mail valide, une adresse https, un rôle permis, un objectif borné", () => {
  const ok = lireDemande({ proprietaire: "Proprietaire.Equipe@Example.com ", domaine: `${DOMAINE}/poste`, nom: " Camille Démo ", objectif: 60 });
  assert.deepEqual(ok, {
    mode: "proprietaire",
    appliquer: false,
    email: EMAIL_PROPRIETAIRE,
    nom: "Camille Démo",
    role: null,
    domaine: DOMAINE,
    objectif: 60,
  });
  assert.equal(lireDemande({ inviter: "appelant@example.com", role: "appelant", domaine: DOMAINE, appliquer: true }).role, "appelant");
  assert.equal(lireDemande({ reglages: true, objectif: 0 }).mode, "reglages");
  for (const [options, motif] of [
    [{}, /Choisis une action/],
    [{ proprietaire: "a@example.com", inviter: "b@example.com", domaine: DOMAINE }, /Choisis une action/],
    [{ proprietaire: "pas-un-email", domaine: DOMAINE }, /e-mail/],
    [{ proprietaire: EMAIL_PROPRIETAIRE }, /--domaine/],
    [{ proprietaire: EMAIL_PROPRIETAIRE, domaine: "http://atelier-demo.example.org" }, /--domaine/],
    [{ proprietaire: EMAIL_PROPRIETAIRE, domaine: DOMAINE, role: "appelant" }, /--role va avec --inviter/],
    [{ inviter: "b@example.com", domaine: DOMAINE }, /--role membre ou --role appelant/],
    [{ inviter: "b@example.com", domaine: DOMAINE, role: "proprietaire" }, /--role membre ou --role appelant/],
    [{ inviter: "b@example.com", domaine: DOMAINE, role: "appelant", objectif: 5 }, /--objectif va avec/],
    [{ reglages: true, objectif: 1001 }, /0 à 1000/],
    [{ reglages: true, domaine: DOMAINE }, /--reglages ne prend que/],
    [{ proprietaire: EMAIL_PROPRIETAIRE, domaine: DOMAINE, nom: "x".repeat(121) }, /--nom/],
  ]) {
    assert.throws(() => lireDemande(options), (e) => e instanceof ErreurInstall && motif.test(e.message), JSON.stringify(options));
  }
});

test("le propriétaire : simulation sans trace, écriture avec le lien copié (jamais affiché), réglages d'après la config, inscription, pas de second propriétaire", { skip: raison ?? false }, async () => {
  const config = niche();
  await client.query("begin");
  try {
    // 1. Simulation : rien ne reste, rien n'est copié.
    const pp0 = pressePapiers();
    const essai = await executerEquipe(client, lireDemande({ proprietaire: EMAIL_PROPRIETAIRE, domaine: DOMAINE, objectif: 45 }), {
      niche: config,
      copier: pp0.copier,
      transactionExterne: true,
    });
    assert.equal(essai.code, 0, texte(essai));
    assert.match(texte(essai), /Simulation/);
    assert.match(texte(essai), /équipe « Atelier Démo Conseil » : qui serait créée/);
    assert.match(texte(essai), /tentatives_max = 6 \(tentativesMax de la config\), objectif d'appels par jour : 45/);
    assert.equal(await n("select count(*)::int as n from public.workspaces"), 0);
    assert.equal(await n("select count(*)::int as n from public.invitations"), 0);
    assert.deepEqual(pp0.copies, []);
    sansDonnee(essai, EMAIL_PROPRIETAIRE);

    // 2. Écriture : l'équipe, l'invitation, les réglages ; le lien copié est celui de l'invitation.
    const pp1 = pressePapiers();
    const ecrit = await executerEquipe(
      client,
      lireDemande({ proprietaire: EMAIL_PROPRIETAIRE, domaine: DOMAINE, nom: "Camille Démo", objectif: 45, appliquer: true }),
      { niche: config, copier: pp1.copier, transactionExterne: true },
    );
    assert.equal(ecrit.code, 0, texte(ecrit));
    assert.equal(pp1.copies.length, 1);
    const lien = pp1.copies[0];
    const jeton = RE_LIEN.exec(lien)?.[1];
    assert.ok(jeton, "le lien d'inscription a la bonne forme");
    sansDonnee(ecrit, EMAIL_PROPRIETAIRE, lien, jeton);
    const ws = (await client.query("select id, nom, pays, fuseau from public.workspaces")).rows;
    assert.equal(ws.length, 1);
    assert.deepEqual({ nom: ws[0].nom, pays: ws[0].pays, fuseau: ws[0].fuseau }, { nom: "Atelier Démo Conseil", pays: "FR", fuseau: "Europe/Paris" });
    const inv = (await client.query("select role, email, nom_invite, jeton, expire_le > now() + interval '13 days' as longue from public.invitations")).rows;
    assert.equal(inv.length, 1);
    assert.deepEqual({ ...inv[0] }, { role: "proprietaire", email: EMAIL_PROPRIETAIRE, nom_invite: "Camille Démo", jeton, longue: true });
    const reg = (await client.query("select tentatives_max, objectif_appels_jour from public.reglages where workspace_id = $1", [ws[0].id])).rows[0];
    assert.deepEqual({ ...reg }, { tentatives_max: 6, objectif_appels_jour: 45 });
    // L'aperçu que montre la page d'inscription.
    const apercu = (await client.query("select public.invitation_publique($1) as a", [jeton])).rows[0].a;
    assert.deepEqual(apercu, { equipe: "Atelier Démo Conseil", role: "proprietaire", email: EMAIL_PROPRIETAIRE, nom: "Camille Démo" });

    // 3. Rejouable tant que personne n'a accepté : une nouvelle invitation, la même équipe ; le lien précédent ne sert plus.
    const pp2 = pressePapiers();
    const rejeu = await executerEquipe(client, lireDemande({ proprietaire: EMAIL_PROPRIETAIRE, domaine: DOMAINE, appliquer: true }), {
      niche: config,
      copier: pp2.copier,
      transactionExterne: true,
    });
    assert.equal(rejeu.code, 0, texte(rejeu));
    assert.match(texte(rejeu), /déjà là, sans propriétaire/);
    assert.equal(await n("select count(*)::int as n from public.workspaces"), 1);
    assert.equal(await n("select count(*)::int as n from public.invitations where role = 'proprietaire'"), 1, "un seul lien d'amorçage valable");
    const jeton2 = RE_LIEN.exec(pp2.copies[0] ?? "")?.[1];
    assert.ok(jeton2 && jeton2 !== jeton, "le rejeu copie un nouveau lien");
    assert.equal((await client.query("select public.invitation_publique($1) as a", [jeton])).rows[0].a, null, "l'ancien lien ne sert plus");

    // 4. L'inscription (ce que fait Supabase Auth) : l'ancien lien est refusé, le nouveau crée le profil propriétaire.
    const inscrire = (email, j) =>
      client.query(
        "insert into auth.users (id, email, aud, role, raw_user_meta_data) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', jsonb_build_object('jeton_invitation', $2::text, 'nom', 'Camille Démo'))",
        [email, j],
      );
    await client.query("savepoint ancien_lien");
    await assert.rejects(inscrire(EMAIL_PROPRIETAIRE, jeton), (e) => e.code === "42501");
    await client.query("rollback to savepoint ancien_lien");
    await inscrire(EMAIL_PROPRIETAIRE, jeton2);
    assert.equal(await n("select count(*)::int as n from public.profiles where role = 'proprietaire'"), 1);

    // 5. Un second propriétaire : refusé, rien de neuf.
    const pp3 = pressePapiers();
    const second = await executerEquipe(client, lireDemande({ proprietaire: "autre@example.com", domaine: DOMAINE, appliquer: true }), {
      niche: config,
      copier: pp3.copier,
      transactionExterne: true,
    });
    assert.equal(second.code, 1);
    assert.match(second.erreur, /déjà un propriétaire/);
    assert.deepEqual(pp3.copies, []);
    assert.equal(await n("select count(*)::int as n from public.invitations"), 1);

    // 6. Un appelant : invitation créée, lien copié ; une copie impossible n'écrit rien.
    const pp4 = pressePapiers();
    const appelant = await executerEquipe(
      client,
      lireDemande({ inviter: "appelant@example.com", role: "appelant", domaine: DOMAINE, nom: "Sacha Démo", appliquer: true }),
      { niche: config, copier: pp4.copier, transactionExterne: true },
    );
    assert.equal(appelant.code, 0, texte(appelant));
    assert.match(texte(appelant), /invitation « appelant » créée/);
    assert.match(pp4.copies[0] ?? "", RE_LIEN);
    sansDonnee(appelant, "appelant@example.com", pp4.copies[0]);
    assert.equal(await n("select count(*)::int as n from public.invitations where role = 'appelant'"), 1);

    const pp5 = pressePapiers(false);
    const sansCopie = await executerEquipe(
      client,
      lireDemande({ inviter: "membre@example.com", role: "membre", domaine: DOMAINE, appliquer: true }),
      { niche: config, copier: pp5.copier, transactionExterne: true },
    );
    assert.equal(sansCopie.code, 1);
    assert.match(sansCopie.erreur, /Copie impossible.*rien n'a été écrit/);
    assert.equal(await n("select count(*)::int as n from public.invitations where role = 'membre'"), 0);

    // 7. Les réglages seuls.
    const reglages = await executerEquipe(client, lireDemande({ reglages: true, objectif: 0, appliquer: true }), {
      niche: config,
      transactionExterne: true,
    });
    assert.equal(reglages.code, 0, texte(reglages));
    assert.equal(await n("select objectif_appels_jour as n from public.reglages"), 0);
  } finally {
    await client.query("rollback");
  }
});

test("avant le propriétaire : pas d'invitation ni de réglages ; une équipe sans propriétaire prend le nom de la config", { skip: raison ?? false }, async () => {
  const config = niche();
  await client.query("begin");
  try {
    const avant = await executerEquipe(client, lireDemande({ inviter: "appelant@example.com", role: "appelant", domaine: DOMAINE }), {
      niche: config,
      transactionExterne: true,
    });
    assert.equal(avant.code, 1);
    assert.match(avant.erreur, /Aucune équipe/);
    assert.equal((await executerEquipe(client, lireDemande({ reglages: true }), { niche: config, transactionExterne: true })).code, 1);

    // Une « Équipe démo » (graine avec --forcer) : sans propriétaire, elle reçoit le nom, le pays et le fuseau de la config.
    await client.query("insert into public.workspaces (nom, fuseau, pays) values ('Équipe démo', 'Europe/Brussels', 'BE')");
    const sansProprietaire = await executerEquipe(client, lireDemande({ inviter: "appelant@example.com", role: "appelant", domaine: DOMAINE }), {
      niche: config,
      transactionExterne: true,
    });
    assert.equal(sansProprietaire.code, 1);
    assert.match(sansProprietaire.erreur, /propriétaire n'est pas encore inscrit/);
    const pp = pressePapiers();
    const r = await executerEquipe(client, lireDemande({ proprietaire: EMAIL_PROPRIETAIRE, domaine: DOMAINE, appliquer: true }), {
      niche: config,
      copier: pp.copier,
      transactionExterne: true,
    });
    assert.equal(r.code, 0, texte(r));
    const ws = (await client.query("select nom, pays, fuseau from public.workspaces")).rows[0];
    assert.deepEqual({ ...ws }, { nom: "Atelier Démo Conseil", pays: "FR", fuseau: "Europe/Paris" });
  } finally {
    await client.query("rollback");
  }
});
