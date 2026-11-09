-- Tests de la table retours_marche : le journal des retours du marché et ses agrégats (retours_marche_agreger, sous la RLS).
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
insert into public.retours_marche (lead_id, issue, douleur, objection_code, accroche_verdict, interet, citation, tags, decideur_joint) values
  ('ca200000-0000-4000-8000-000000000002', 'rdv_fixe', 'Demandes trop loin', 'pas-le-temps', 'accroche', 3, 'Les plateformes m''envoient trop loin.',
   array['distance', 'plateformes'], true),
  ('ca100000-0000-4000-8000-000000000001', 'pas_interesse', null, 'assez-de-travail', 'rejet', 0, null, array['plateformes'], false);
select pg_temp.verifier((select count(*) from public.retours_marche where appelant_id = 'a3000000-0000-4000-8000-000000000003') = 2, 'retours_marche : l''appelant note ses retours');
select pg_temp.doit_echouer($$insert into public.retours_marche (interet) values (7)$$, '23514', 'retours_marche : intérêt de 0 à 3');
select pg_temp.doit_echouer($$insert into public.retours_marche (accroche_verdict) values ('excellent')$$, '23514',
  'retours_marche : verdicts connus seulement');
select pg_temp.doit_echouer($$insert into public.retours_marche (citation) values (repeat('x', 301))$$, '23514',
  'retours_marche : une citation courte (300 caractères au plus)');
select pg_temp.doit_echouer($$insert into public.retours_marche (lead_id, douleur) values ('ca300000-0000-4000-8000-000000000003', 'x')$$, '42501',
  'retours_marche : pas sur la fiche d''un autre appelant');
select pg_temp.doit_echouer($$insert into public.retours_marche (appelant_id, douleur) values ('a4000000-0000-4000-8000-000000000004', 'x')$$, '42501',
  'retours_marche : on écrit à son propre nom');
select pg_temp.doit_echouer($$update public.retours_marche set interet = 1$$, '42501', 'retours_marche : un journal ne se réécrit pas');

select set_config('test.agg', public.retours_marche_agreger(now() - interval '1 day', now() + interval '1 day')::text, true);
select pg_temp.verifier(
  (current_setting('test.agg')::jsonb ->> 'total')::int = 2 and (current_setting('test.agg')::jsonb ->> 'rdv')::int = 1
  and (current_setting('test.agg')::jsonb #>> '{verdicts,accroche}')::int = 1 and (current_setting('test.agg')::jsonb #>> '{verdicts,rejet}')::int = 1,
  'retours_marche : les agrégats (total, rendez-vous, verdicts de l''accroche)');
select pg_temp.verifier(
  (current_setting('test.agg')::jsonb -> 'tags' -> 0 ->> 'tag') = 'plateformes' and (current_setting('test.agg')::jsonb -> 'tags' -> 0 ->> 'n')::int = 2,
  'retours_marche : les tags sont comptés, du plus fréquent au moins fréquent');
select pg_temp.verifier((current_setting('test.agg')::jsonb ->> 'interetMoyen')::numeric = 1.5, 'retours_marche : l''intérêt moyen');
select pg_temp.verifier(jsonb_array_length(current_setting('test.agg')::jsonb -> 'citations') = 1, 'retours_marche : les citations');

select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
insert into public.retours_marche (lead_id, objection_code, interet) values ('ca300000-0000-4000-8000-000000000003', 'combien-ca-coute', 2);
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '1 day', now() + interval '1 day') ->> 'total')::int = 1,
  'retours_marche : un appelant n''agrège que ses propres retours');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '1 day', now() + interval '1 day') ->> 'total')::int = 3,
  'retours_marche : la propriétaire agrège toute l''équipe');
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '1 day', now() + interval '1 day', 'b0000000-0000-4000-8000-000000000000') ->> 'total')::int = 3,
  'retours_marche : désigner une autre équipe ne change rien pour un compte connecté');
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '1 day', now() + interval '1 day') ->> 'total')::int = 0,
  'retours_marche : B n''agrège rien de A');
select pg_temp.verifier((select count(*) from public.retours_marche) = 0, 'retours_marche : B ne voit rien de A');
select pg_temp.service();
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '1 day', now() + interval '1 day', 'a0000000-0000-4000-8000-000000000000') ->> 'total')::int = 3,
  'retours_marche : la clé service agrège l''équipe désignée (skill ajuster-script)');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(pg_temp.lignes($$delete from public.retours_marche where objection_code = 'combien-ca-coute'$$) = 1,
  'retours_marche : un gestionnaire retire une ligne');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.retours_marche$$, '42501', 'retours_marche : rien pour le visiteur');
select pg_temp.doit_echouer($$select public.retours_marche_agreger(now(), now())$$, '42501', 'retours_marche : ni les agrégats');
select pg_temp.admin();

rollback;
