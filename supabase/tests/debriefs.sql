-- Tests de la table debriefs : le débrief d'un appel (transcription, extraction, mots-clés), par son auteur, lu par les gestionnaires.
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
insert into public.debriefs (lead_id, source, transcription, extraction, mots_cles)
values ('ca200000-0000-4000-8000-000000000002', 'colle', 'Transcription fictive d''un appel de démonstration.', '{"source_clients": "bouche-à-oreille"}', array['délais']);
select pg_temp.verifier((select count(*) from public.debriefs where lead_id = 'ca200000-0000-4000-8000-000000000002' and appelant_id = 'a3000000-0000-4000-8000-000000000003' and workspace_id = 'a0000000-0000-4000-8000-000000000000') = 1,
  'debriefs : un appelant débriefe un appel de sa fiche');
select pg_temp.doit_echouer($$insert into public.debriefs (lead_id, transcription) values ('ca300000-0000-4000-8000-000000000003', 'x')$$, '42501',
  'debriefs : pas sur la fiche d''un autre appelant');
select pg_temp.doit_echouer($$insert into public.debriefs (lead_id, extraction) values ('ca200000-0000-4000-8000-000000000002', '[]')$$, '23514',
  'debriefs : l''extraction est un objet JSON');
select pg_temp.doit_echouer($$insert into public.debriefs (lead_id, source) values ('ca200000-0000-4000-8000-000000000002', 'micro_cache')$$, '23514',
  'debriefs : des sources connues seulement');
select pg_temp.doit_echouer($$insert into public.debriefs (lead_id, source, transcription) values ('ca200000-0000-4000-8000-000000000002', 'appel', 'x')$$, '23514',
  'debriefs : un débrief tiré d''un appel désigne cet appel');
select pg_temp.verifier(pg_temp.lignes($$update public.debriefs set mots_cles = array['prix'] where lead_id = 'ca200000-0000-4000-8000-000000000002'$$) = 1,
  'debriefs : l''auteur corrige son débrief');
select pg_temp.verifier(pg_temp.lignes($$delete from public.debriefs$$) = 0, 'debriefs : un appelant n''efface pas');

select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
select pg_temp.verifier((select count(*) from public.debriefs) = 0, 'debriefs : invisibles pour un autre appelant');
select pg_temp.verifier(pg_temp.lignes($$update public.debriefs set mots_cles = '{}'$$) = 0, 'debriefs : qui ne les modifie pas');

-- Un débrief de A ne pointe jamais vers un appel de B.
select pg_temp.admin();
insert into public.appels (workspace_id, fournisseur, externe_id) values ('b0000000-0000-4000-8000-000000000000', 'onoff', 'appel-b');
select set_config('test.appel_b', (select id::text from public.appels where externe_id = 'appel-b'), true);
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.debriefs) = 1, 'debriefs : la propriétaire voit ceux de son équipe');
select pg_temp.doit_echouer($$insert into public.debriefs (lead_id, appel_id, transcription)
  values ('ca100000-0000-4000-8000-000000000001', current_setting('test.appel_b')::uuid, 'x')$$, '23503',
  'debriefs : jamais lié à un appel d''une autre équipe');
-- La transcription d'un appel non conservable (enregistrement désactivé ou annonce non lue) ne se recopie pas dans un débrief.
select pg_temp.admin();
insert into public.appels (workspace_id, fournisseur, externe_id, lead_id, appelant_id) values ('a0000000-0000-4000-8000-000000000000', 'onoff', 'appel-a', 'ca100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');
select set_config('test.appel_a', (select id::text from public.appels where externe_id = 'appel-a'), true);
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$insert into public.debriefs (lead_id, appel_id, source, transcription)
  values ('ca100000-0000-4000-8000-000000000001', current_setting('test.appel_a')::uuid, 'appel', 'Transcription d''un appel non autorisé')$$, '42501',
  'debriefs : la transcription d''un appel non conservable est refusée');
insert into public.debriefs (lead_id, appel_id, source, extraction) values ('ca100000-0000-4000-8000-000000000001', current_setting('test.appel_a')::uuid, 'appel', '{"zone": "Lyon"}');
select pg_temp.verifier((select count(*) from public.debriefs where appel_id = current_setting('test.appel_a')::uuid) = 1,
  'debriefs : sans transcription, le débrief de cet appel reste possible (notes, extraction)');
select pg_temp.verifier(pg_temp.lignes($$delete from public.debriefs$$) = 2, 'debriefs : un gestionnaire efface');

select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.debriefs where workspace_id = 'a0000000-0000-4000-8000-000000000000') = 0, 'debriefs : B ne voit rien de A');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.debriefs$$, '42501', 'debriefs : rien pour le visiteur');
select pg_temp.admin();

rollback;
