-- Tests de la table profiles : l'inscription sur invitation (déclencheur sur auth.users), la RLS, les champs protégés, les rôles.
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

select pg_temp.verifier((select count(*) from public.profiles where workspace_id = 'a0000000-0000-4000-8000-000000000000') = 4,
  'profiles : l''inscription par invitation a créé les 4 comptes de A');
select pg_temp.verifier(
  (select role = 'appelant' and nom = 'Appelant A' and email = 'appelant.a@example.com' from public.profiles where id = 'a3000000-0000-4000-8000-000000000003'),
  'profiles : rôle, nom et e-mail viennent de l''inscription et de l''invitation');
select pg_temp.verifier(
  (select count(*) from public.invitations where workspace_id in ('a0000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000000') and acceptee_le is not null) = 5,
  'profiles : les invitations utilisées sont marquées acceptées');

-- Inscriptions refusées.
select pg_temp.doit_echouer($$insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values ('d1000000-0000-4000-8000-000000000001', 'intrus@example.com', 'authenticated', 'authenticated', '{}')$$, '42501',
  'profiles : pas d''inscription sans invitation');
insert into public.invitations (workspace_id, jeton, role, email) values ('a0000000-0000-4000-8000-000000000000', repeat('c1', 32), 'membre', 'prevu@example.com');
select pg_temp.doit_echouer($$insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values ('d1000000-0000-4000-8000-000000000003', 'autre@example.com', 'authenticated', 'authenticated',
          jsonb_build_object('jeton_invitation', repeat('c1', 32)))$$, '42501',
  'profiles : une invitation nominative refuse un autre e-mail');
insert into public.invitations (workspace_id, jeton, role, nom_invite, expire_le)
  values ('a0000000-0000-4000-8000-000000000000', repeat('c2', 32), 'membre', 'Invité en retard', now() - interval '1 day');
select pg_temp.doit_echouer($$insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values ('d1000000-0000-4000-8000-000000000004', 'retard@example.com', 'authenticated', 'authenticated',
          jsonb_build_object('jeton_invitation', repeat('c2', 32)))$$, '42501',
  'profiles : une invitation expirée est refusée');

-- Une invitation sans e-mail accepte celui que la personne choisit, et le garde.
insert into public.invitations (workspace_id, jeton, role, nom_invite) values ('a0000000-0000-4000-8000-000000000000', repeat('c3', 32), 'appelant', 'Nouvel appelant');
insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values ('d3000000-0000-4000-8000-000000000003', 'Libre@Example.com', 'authenticated', 'authenticated',
          jsonb_build_object('jeton_invitation', repeat('c3', 32)));
select pg_temp.verifier(
  (select nom = 'Nouvel appelant' and email = 'libre@example.com' and role = 'appelant'
     from public.profiles where id = 'd3000000-0000-4000-8000-000000000003'),
  'profiles : sans nom donné, le profil prend le nom de l''invitation ; e-mail en minuscules');
select pg_temp.verifier((select email from public.invitations where jeton = repeat('c3', 32)) = 'libre@example.com',
  'profiles : l''invitation sans e-mail garde celui qui a été choisi');
-- Le même jeton ne sert pas deux fois, même avec un autre e-mail (sur Supabase, un e-mail déjà inscrit est de toute façon refusé par
-- l'index unique d'auth.users, avant notre trigger : le test ne repasse donc jamais un e-mail existant).
select pg_temp.doit_echouer($$insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values ('d1000000-0000-4000-8000-000000000002', 'second.libre@example.com', 'authenticated', 'authenticated',
          jsonb_build_object('jeton_invitation', repeat('c3', 32)))$$, '42501',
  'profiles : une invitation ne sert qu''une fois');

-- RLS : l'appelant de A.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.profiles) = 5, 'profiles : un compte voit les profils de son équipe');
select pg_temp.verifier((select count(*) from public.profiles where workspace_id = 'b0000000-0000-4000-8000-000000000000') = 0, 'profiles : jamais ceux de B');
select pg_temp.verifier(pg_temp.lignes($$update public.profiles set nom = 'Appelant A (modifié)' where id = 'a3000000-0000-4000-8000-000000000003'$$) = 1,
  'profiles : on modifie son propre nom');
select pg_temp.doit_echouer($$update public.profiles set email_telephonie = 'poste.appelant@example.com' where id = 'a3000000-0000-4000-8000-000000000003'$$, '42501',
  'profiles : son e-mail chez le fournisseur de téléphonie ne se change pas soi-même');
select pg_temp.doit_echouer($$select public.definir_email_telephonie('a3000000-0000-4000-8000-000000000003', 'poste.appelant@example.com')$$, '42501',
  'profiles : un appelant ne pose pas d''e-mail de téléphonie');
select pg_temp.verifier(pg_temp.lignes($$update public.profiles set nom = 'Piraté' where id = 'a1000000-0000-4000-8000-000000000001'$$) = 0,
  'profiles : jamais le profil d''un autre');
select pg_temp.doit_echouer($$update public.profiles set role = 'proprietaire' where id = 'a3000000-0000-4000-8000-000000000003'$$, '42501',
  'profiles : on ne change pas son propre rôle');
select pg_temp.doit_echouer($$update public.profiles set workspace_id = 'b0000000-0000-4000-8000-000000000000' where id = 'a3000000-0000-4000-8000-000000000003'$$, '42501',
  'profiles : on ne change pas d''équipe');
select pg_temp.doit_echouer($$insert into public.profiles (id, workspace_id, role) values ('a3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000000', 'proprietaire')$$, '42501',
  'profiles : pas de création directe');
select pg_temp.doit_echouer($$delete from public.profiles where id = 'a3000000-0000-4000-8000-000000000003'$$, '42501', 'profiles : pas de suppression directe');
select pg_temp.verifier((public.contexte() ->> 'role') = 'appelant' and (public.contexte() ->> 'workspace_id') = 'a0000000-0000-4000-8000-000000000000',
  'profiles : contexte() rend l''équipe et le rôle de la personne connectée');
select pg_temp.doit_echouer($$select public.changer_role('a4000000-0000-4000-8000-000000000004', 'membre')$$, '42501', 'profiles : un appelant ne change pas les rôles');

-- Le membre, puis la propriétaire.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select public.definir_email_telephonie('a3000000-0000-4000-8000-000000000003', 'Poste.Appelant@example.com');
select pg_temp.verifier((select email_telephonie from public.profiles where id = 'a3000000-0000-4000-8000-000000000003') = 'poste.appelant@example.com',
  'profiles : un gestionnaire pose l''e-mail de téléphonie d''un membre (en minuscules)');
select pg_temp.doit_echouer($$select public.definir_email_telephonie('a4000000-0000-4000-8000-000000000004', 'proprietaire.a@example.com')$$, '23505',
  'profiles : jamais l''e-mail de connexion d''un autre compte (ses appels iraient au mauvais compte)');
select pg_temp.doit_echouer($$select public.definir_email_telephonie('a4000000-0000-4000-8000-000000000004', 'poste.appelant@example.com')$$, '23505',
  'profiles : ni l''e-mail de téléphonie d''un autre');
select pg_temp.doit_echouer($$select public.definir_email_telephonie('a4000000-0000-4000-8000-000000000004', 'pas-un-email')$$, '22023',
  'profiles : une adresse mal formée est refusée');
select pg_temp.doit_echouer($$select public.definir_email_telephonie('b1000000-0000-4000-8000-000000000001', 'b.poste@example.com')$$, 'P0002',
  'profiles : jamais pour un compte d''une autre équipe');
select pg_temp.doit_echouer($$select public.changer_role('a4000000-0000-4000-8000-000000000004', 'membre')$$, '42501', 'profiles : un membre ne change pas les rôles');
select pg_temp.doit_echouer($$select public.retirer_membre('a4000000-0000-4000-8000-000000000004')$$, '42501', 'profiles : un membre ne retire personne');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select public.changer_role('a4000000-0000-4000-8000-000000000004', 'membre');
select pg_temp.verifier((select role from public.profiles where id = 'a4000000-0000-4000-8000-000000000004') = 'membre', 'profiles : la propriétaire change le rôle d''un membre');
select pg_temp.doit_echouer($$select public.changer_role('a1000000-0000-4000-8000-000000000001', 'appelant')$$, '42501', 'profiles : jamais son propre rôle');
select pg_temp.doit_echouer($$select public.changer_role('b1000000-0000-4000-8000-000000000001', 'appelant')$$, 'P0002', 'profiles : jamais quelqu''un d''une autre équipe');
select pg_temp.doit_echouer($$select public.changer_role('a4000000-0000-4000-8000-000000000004', 'roi')$$, '22023', 'profiles : un rôle inconnu est refusé');
select public.retirer_membre('d3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.profiles where id = 'd3000000-0000-4000-8000-000000000003') = 0,
  'profiles : la propriétaire retire quelqu''un de l''équipe');
select pg_temp.doit_echouer($$select public.retirer_membre('a1000000-0000-4000-8000-000000000001')$$, '42501', 'profiles : pas soi-même');
select pg_temp.doit_echouer($$select public.retirer_membre('b1000000-0000-4000-8000-000000000001')$$, 'P0002', 'profiles : pas quelqu''un de B');

-- Un changement d'e-mail dans Supabase Auth est recopié.
select pg_temp.admin();
update auth.users set email = 'Nouvelle.Adresse@example.com' where id = 'a2000000-0000-4000-8000-000000000002';
select pg_temp.verifier((select email from public.profiles where id = 'a2000000-0000-4000-8000-000000000002') = 'nouvelle.adresse@example.com',
  'profiles : un changement d''e-mail dans Auth est recopié dans le profil');

-- L'autre équipe et le visiteur.
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.profiles) = 1, 'profiles : B ne voit que son profil');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.profiles$$, '42501', 'profiles : rien pour le visiteur');
select pg_temp.doit_echouer($$select public.contexte()$$, '42501', 'profiles : contexte() est fermé au visiteur');
select pg_temp.admin();

rollback;
