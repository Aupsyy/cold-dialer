-- Tests de la table reglages : lecture par l'équipe, modification par les gestionnaires, l'enregistrement conditionné au cadre légal.
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

select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.reglages) = 1 and (select tentatives_max from public.reglages) = 4,
  'reglages : un appelant lit les réglages de son équipe (tentatives, objectif)');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set tentatives_max = 9$$) = 0, 'reglages : un appelant ne les modifie pas');

select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set objectif_appels_jour = 80, tentatives_max = 5$$) = 1,
  'reglages : un membre modifie l''objectif et les tentatives');
select pg_temp.verifier((select updated_by from public.reglages) = 'a2000000-0000-4000-8000-000000000002', 'reglages : l''auteur de la modification est noté');
select pg_temp.verifier((select enregistrement_complet from public.reglages) = false, 'reglages : l''enregistrement est désactivé par défaut');
select pg_temp.doit_echouer($$update public.reglages set enregistrement_complet = true$$, '23514',
  'reglages : pas d''enregistrement sans lecture du cadre légal (annonce_lue_le)');
select pg_temp.verifier(
  pg_temp.lignes($$update public.reglages set enregistrement_complet = true, annonce_lue_le = '2020-01-01T00:00:00Z'$$) = 1,
  'reglages : enregistrement activé après lecture du cadre légal');
select pg_temp.verifier((select annonce_lue_le from public.reglages) = now(),
  'reglages : la lecture du cadre légal est horodatée par la base, jamais par le navigateur');
select pg_temp.doit_echouer($$update public.reglages set tentatives_max = 50$$, '23514', 'reglages : tentatives bornées de 1 à 10');
select pg_temp.doit_echouer($$update public.reglages set workspace_id = 'b0000000-0000-4000-8000-000000000000'$$, '42501', 'reglages : une ligne ne change pas d''équipe');
select pg_temp.doit_echouer($$insert into public.reglages (workspace_id) values ('a0000000-0000-4000-8000-000000000000')$$, '42501', 'reglages : pas d''insertion directe');
select pg_temp.doit_echouer($$delete from public.reglages$$, '42501', 'reglages : pas de suppression');

select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.reglages where workspace_id = 'a0000000-0000-4000-8000-000000000000') = 0, 'reglages : B ne voit pas ceux de A');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set objectif_appels_jour = 1 where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 0,
  'reglages : B ne modifie pas ceux de A');
select pg_temp.verifier((select enregistrement_complet from public.reglages) = false, 'reglages : ceux de B n''ont pas bougé');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.reglages$$, '42501', 'reglages : rien pour le visiteur');
select pg_temp.admin();

rollback;
