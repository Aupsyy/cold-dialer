-- Tests de la table invitations : qui invite qui, le jeton toujours tiré par la base, l'aperçu par la clé service.
begin;

-- >>> FIXTURE (copie exacte de supabase/tests/_fixture.sql en tête de chaque test ; tests/sql-statique.test.mjs vérifie qu'elle n'a pas bougé)
-- Deux équipes : A (une propriétaire, un membre, deux appelants) et B (un propriétaire). Les comptes passent par le vrai chemin
-- d'inscription : une invitation, puis le déclencheur sur auth.users. Quatre fiches : A1 non attribuée, A2 à l'appelant, A3 au second
-- appelant, B1 dans l'équipe B. Données fictives (example.com, numéros de la plage réservée 01 99 00, SIREN invalides).
insert into public.workspaces (id, nom) values
  ('a0000000-0000-4000-8000-000000000000', 'Équipe A (test)'),
  ('b0000000-0000-4000-8000-000000000000', 'Équipe B (test)');
insert into public.invitations (workspace_id, jeton, role, email) values
  ('a0000000-0000-4000-8000-000000000000', repeat('a1', 32), 'proprietaire', 'proprietaire.a@example.com'),
  ('a0000000-0000-4000-8000-000000000000', repeat('a2', 32), 'membre', 'membre.a@example.com'),
  ('a0000000-0000-4000-8000-000000000000', repeat('a3', 32), 'appelant', 'appelant.a@example.com'),
  ('a0000000-0000-4000-8000-000000000000', repeat('a4', 32), 'appelant', 'appelant2.a@example.com'),
  ('b0000000-0000-4000-8000-000000000000', repeat('b1', 32), 'proprietaire', 'proprietaire.b@example.com');
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'proprietaire.a@example.com', 'authenticated', 'authenticated',
   jsonb_build_object('jeton_invitation', repeat('a1', 32), 'nom', 'Propriétaire A')),
  ('a2000000-0000-4000-8000-000000000002', 'membre.a@example.com', 'authenticated', 'authenticated',
   jsonb_build_object('jeton_invitation', repeat('a2', 32), 'nom', 'Membre A')),
  ('a3000000-0000-4000-8000-000000000003', 'appelant.a@example.com', 'authenticated', 'authenticated',
   jsonb_build_object('jeton_invitation', repeat('a3', 32), 'nom', 'Appelant A')),
  ('a4000000-0000-4000-8000-000000000004', 'appelant2.a@example.com', 'authenticated', 'authenticated',
   jsonb_build_object('jeton_invitation', repeat('a4', 32), 'nom', 'Second appelant A')),
  ('b1000000-0000-4000-8000-000000000001', 'proprietaire.b@example.com', 'authenticated', 'authenticated',
   jsonb_build_object('jeton_invitation', repeat('b1', 32), 'nom', 'Propriétaire B'));
insert into public.leads (id, workspace_id, entreprise, siren, telephone, ville, assigned_to) values
  ('ca100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000000', 'Atelier Test A1', '000000001', '+33199000101', 'Lyon', null),
  ('ca200000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000000', 'Atelier Test A2', '000000002', '+33199000102', 'Lyon',
   'a3000000-0000-4000-8000-000000000003'),
  ('ca300000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000000', 'Atelier Test A3', '000000003', '+33199000103', 'Lyon',
   'a4000000-0000-4000-8000-000000000004'),
  ('cb100000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000000', 'Atelier Test B1', '000000004', '+33199000104', 'Lyon', null);

-- Changer d'identité : un compte connecté (claims du jeton + rôle authenticated), le visiteur anonyme, la clé service, l'administrateur.
create function pg_temp.connecter(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.anonyme() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.service() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $f$;
create function pg_temp.admin() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $f$;
-- Une vérification : « OK : … » en avis, ou une exception « ECHEC : … » qui arrête le fichier.
create function pg_temp.verifier(p_condition boolean, p_message text) returns void language plpgsql as $f$
begin
  if p_condition is distinct from true then
    raise exception 'ECHEC : %', p_message;
  end if;
  raise notice 'OK : %', p_message;
end $f$;
-- Une instruction qui DOIT échouer avec ce code SQLSTATE.
create function pg_temp.doit_echouer(p_sql text, p_etat text, p_message text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_etat then
      raise notice 'OK : %', p_message;
      return;
    end if;
    raise exception 'ECHEC : % (erreur % au lieu de %)', p_message, sqlstate, p_etat;
  end;
  raise exception 'ECHEC : % (aucune erreur)', p_message;
end $f$;
-- Le nombre de lignes touchées par une instruction (une mise à jour hors périmètre doit en toucher 0).
create function pg_temp.lignes(p_sql text) returns integer language plpgsql as $f$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $f$;
-- <<< FIXTURE

select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
insert into public.invitations (role, email, cree_par, jeton) values ('membre', 'Nouveau.Membre@example.com', 'a1000000-0000-4000-8000-000000000001', repeat('0', 64));
select pg_temp.verifier(
  (select count(*) from public.invitations
    where email = 'nouveau.membre@example.com' and workspace_id = 'a0000000-0000-4000-8000-000000000000' and jeton ~ '^[0-9a-f]{64}$' and jeton <> repeat('0', 64)) = 1,
  'invitations : la propriétaire invite ; le jeton est tiré par la base, jamais celui du navigateur');
insert into public.invitations (role, nom_invite, cree_par) values ('proprietaire', 'Associée', 'a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.invitations where nom_invite = 'Associée') = 1,
  'invitations : la propriétaire peut inviter une autre propriétaire');
select pg_temp.doit_echouer($$insert into public.invitations (role, cree_par) values ('membre', 'a1000000-0000-4000-8000-000000000001')$$, '23514',
  'invitations : il faut un e-mail ou un nom');
select pg_temp.doit_echouer($$insert into public.invitations (workspace_id, role, email, cree_par) values ('b0000000-0000-4000-8000-000000000000', 'membre', 'x@example.com', 'a1000000-0000-4000-8000-000000000001')$$,
  '23503', 'invitations : jamais dans l''équipe B (l''auteur doit être de la même équipe)');
select pg_temp.doit_echouer($$insert into public.invitations (role, email, cree_par, expire_le) values ('membre', 'y@example.com', 'a1000000-0000-4000-8000-000000000001', now() + interval '90 days')$$,
  '42501', 'invitations : 30 jours de validité au plus');
select pg_temp.doit_echouer($$update public.invitations set role = 'proprietaire'$$, '42501', 'invitations : une invitation ne se modifie pas');

-- Le membre.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
insert into public.invitations (role, email, cree_par) values ('appelant', 'appelant3.a@example.com', 'a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier((select count(*) from public.invitations where email = 'appelant3.a@example.com') = 1,
  'invitations : un membre invite un appelant');
select pg_temp.doit_echouer($$insert into public.invitations (role, email, cree_par) values ('proprietaire', 'z@example.com', 'a2000000-0000-4000-8000-000000000002')$$,
  '42501', 'invitations : un membre n''invite pas de propriétaire');
select pg_temp.doit_echouer($$insert into public.invitations (role, email, cree_par) values ('membre', 'w@example.com', 'a1000000-0000-4000-8000-000000000001')$$,
  '42501', 'invitations : on invite à son propre nom');
select pg_temp.verifier((select count(*) from public.invitations) = 5, 'invitations : un membre voit celles de son équipe');
select pg_temp.verifier((select count(*) from public.invitations where role = 'proprietaire') = 0,
  'invitations : un membre ne voit pas les invitations de propriétaire (ni leur jeton)');
select pg_temp.verifier(pg_temp.lignes($$delete from public.invitations where nom_invite = 'Associée'$$) = 0,
  'invitations : un membre ne retire pas une invitation de propriétaire');

-- L'appelant.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.invitations) = 0, 'invitations : un appelant ne voit pas les invitations (ni leurs jetons)');
select pg_temp.doit_echouer($$insert into public.invitations (role, email, cree_par) values ('appelant', 'v@example.com', 'a3000000-0000-4000-8000-000000000003')$$,
  '42501', 'invitations : un appelant n''invite personne');

-- L'autre équipe.
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.invitations where workspace_id = 'a0000000-0000-4000-8000-000000000000') = 0, 'invitations : B ne voit pas celles de A');
select pg_temp.verifier(pg_temp.lignes($$delete from public.invitations where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 0,
  'invitations : B ne supprime pas celles de A');

-- Retirer une invitation, puis l'aperçu (clé service seule).
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.invitations) = 7, 'invitations : la propriétaire les voit toutes');
select pg_temp.verifier(pg_temp.lignes($$delete from public.invitations where email = 'appelant3.a@example.com'$$) = 1,
  'invitations : un gestionnaire retire une invitation');
select pg_temp.doit_echouer($$select public.invitation_publique(repeat('a1', 32))$$, '42501',
  'invitations : invitation_publique est fermée aux comptes connectés');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select public.invitation_publique(repeat('a1', 32))$$, '42501', 'invitations : et au visiteur anonyme');
select pg_temp.doit_echouer($$select * from public.invitations$$, '42501', 'invitations : rien pour le visiteur');
select pg_temp.service();
select pg_temp.verifier(
  (public.invitation_publique((select jeton from public.invitations where email = 'nouveau.membre@example.com')) ->> 'equipe') = 'Équipe A (test)',
  'invitations : la clé service lit l''aperçu d''une invitation valide (équipe, rôle)');
select pg_temp.verifier(public.invitation_publique(repeat('a1', 32)) is null, 'invitations : rien pour une invitation déjà acceptée');
select pg_temp.verifier(public.invitation_publique('pas-un-jeton') is null, 'invitations : rien pour un jeton illisible');
select pg_temp.admin();

rollback;
