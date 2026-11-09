-- Tests de la table workspaces (l'équipe) et de l'amorçage de l'instance. Transaction annulée : rien n'est gardé.
begin;

-- Amorçage (base vide seulement, comme la base neuve de la CI) : la première équipe, ses réglages, l'invitation du propriétaire.
do $$
declare
  r jsonb;
begin
  if (select count(*) from public.workspaces) = 0 then
    r := public.amorcer_workspace('Équipe amorcée', 'fondateur@example.com', null, 'Europe/Paris', 'FR');
    if coalesce(r ->> 'jeton', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'ECHEC : workspaces : amorçage sans jeton';
    end if;
    if not exists (select 1 from public.reglages where workspace_id = (r ->> 'workspaceId')::uuid) then
      raise exception 'ECHEC : workspaces : amorçage sans réglages';
    end if;
    if (public.amorcer_workspace('Équipe amorcée', 'fondateur@example.com') ->> 'workspaceId') <> (r ->> 'workspaceId') then
      raise exception 'ECHEC : workspaces : un second amorçage doit viser la même équipe';
    end if;
    delete from public.workspaces where id = (r ->> 'workspaceId')::uuid;
    raise notice 'OK : workspaces : amorçage d''une base vide (équipe, réglages, invitation du propriétaire, rejouable)';
  end if;
end;
$$;

-- Rejouer l'amorçage ne laisse jamais deux liens « propriétaire » valables, et aucun lien d'amorçage ne sert plus une fois l'équipe dotée
-- d'un propriétaire (base vide seulement). Un lien sans e-mail : n'importe qui pourrait s'en servir.
do $$
declare
  r1 jsonb;
  r2 jsonb;
  v_ws uuid;
  v_oublie text;
  v_associe text;
  inscrire constant text := 'insert into auth.users (id, email, aud, role, raw_user_meta_data) values (%L, %L, ''authenticated'', ''authenticated'', jsonb_build_object(''jeton_invitation'', %L::text))';
begin
  if (select count(*) from public.workspaces) = 0 then
    r1 := public.amorcer_workspace('Équipe amorcée', null, 'Fondatrice', 'Europe/Paris', 'FR');
    r2 := public.amorcer_workspace('Équipe amorcée', null, 'Fondatrice', 'Europe/Paris', 'FR');
    v_ws := (r2 ->> 'workspaceId')::uuid;
    if (r1 ->> 'workspaceId')::uuid <> v_ws or (r1 ->> 'jeton') = (r2 ->> 'jeton') then
      raise exception 'ECHEC : workspaces : un rejeu vise la même équipe avec un nouveau lien';
    end if;
    if (select count(*) from public.invitations where workspace_id = v_ws and role = 'proprietaire' and acceptee_le is null) <> 1
       or public.invitation_publique(r1 ->> 'jeton') is not null then
      raise exception 'ECHEC : workspaces : après un rejeu, seul le nouveau lien d''amorçage est valable';
    end if;
    raise notice 'OK : workspaces : un rejeu de l''amorçage retire le lien précédent (un seul lien valable)';
    begin
      execute format(inscrire, 'e1000000-0000-4000-8000-000000000001', 'lien.ancien@example.com', r1 ->> 'jeton');
      raise exception 'ECHEC : workspaces : le premier lien d''amorçage sert encore après un rejeu';
    exception when insufficient_privilege then
      raise notice 'OK : workspaces : le premier lien d''amorçage est refusé après un rejeu';
    end;
    execute format(inscrire, 'e2000000-0000-4000-8000-000000000002', 'fondatrice@example.com', r2 ->> 'jeton');
    if (select count(*) from public.profiles where workspace_id = v_ws and role = 'proprietaire') <> 1 then
      raise exception 'ECHEC : workspaces : le nouveau lien d''amorçage crée le propriétaire';
    end if;
    raise notice 'OK : workspaces : le nouveau lien d''amorçage crée le propriétaire';
    begin
      perform public.amorcer_workspace('Équipe amorcée', null, 'Fondatrice', 'Europe/Paris', 'FR');
      raise exception 'ECHEC : workspaces : amorçage rejoué après l''inscription du propriétaire';
    exception when unique_violation then
      raise notice 'OK : workspaces : plus d''amorçage une fois le propriétaire inscrit';
    end;
    -- Un lien d'amorçage resté en attente (posé à la main, ou d'avant la correction) : refusé dès qu'il y a un propriétaire.
    insert into public.invitations (workspace_id, role, nom_invite) values (v_ws, 'proprietaire', 'Lien oublié') returning jeton into v_oublie;
    begin
      execute format(inscrire, 'e3000000-0000-4000-8000-000000000003', 'lien.oublie@example.com', v_oublie);
      raise exception 'ECHEC : workspaces : un lien d''amorçage sert après l''inscription du propriétaire';
    exception when insufficient_privilege then
      raise notice 'OK : workspaces : aucun lien d''amorçage ne sert une fois l''équipe dotée d''un propriétaire';
    end;
    -- Une invitation « propriétaire » créée PAR la propriétaire reste la voie normale d'un second propriétaire.
    insert into public.invitations (workspace_id, role, email, cree_par)
    values (v_ws, 'proprietaire', 'associee@example.com', 'e2000000-0000-4000-8000-000000000002') returning jeton into v_associe;
    execute format(inscrire, 'e4000000-0000-4000-8000-000000000004', 'associee@example.com', v_associe);
    if (select count(*) from public.profiles where workspace_id = v_ws and role = 'proprietaire') <> 2 then
      raise exception 'ECHEC : workspaces : une invitation de la propriétaire donne un second propriétaire';
    end if;
    raise notice 'OK : workspaces : une invitation créée par la propriétaire reste acceptée';
    delete from auth.users where id in ('e2000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000004');
    delete from public.workspaces where id = v_ws;
  end if;
end;
$$;

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

select pg_temp.verifier(
  (select count(*) from public.reglages where workspace_id in ('a0000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000000')) = 2,
  'workspaces : chaque équipe a sa ligne de réglages dès sa création');
select pg_temp.doit_echouer($$select public.amorcer_workspace('Autre équipe', 'autre@example.com')$$, '23505',
  'workspaces : amorçage refusé quand l''instance a déjà plusieurs équipes');
select pg_temp.doit_echouer($$insert into public.workspaces (nom, pays) values ('Pays faux', 'France')$$, '23514',
  'workspaces : le pays est un code à deux lettres');

-- La propriétaire de A.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.workspaces) = 1, 'workspaces : la propriétaire de A ne voit que son équipe');
select pg_temp.verifier((select nom from public.workspaces) = 'Équipe A (test)', 'workspaces : et c''est bien la sienne');
select pg_temp.verifier(pg_temp.lignes($$update public.workspaces set nom = 'Équipe A renommée'$$) = 1,
  'workspaces : la propriétaire renomme son équipe');
select pg_temp.verifier(pg_temp.lignes($$update public.workspaces set nom = 'Piratée' where id = 'b0000000-0000-4000-8000-000000000000'$$) = 0,
  'workspaces : elle ne touche pas à l''équipe B');
select pg_temp.doit_echouer($$insert into public.workspaces (nom) values ('Nouvelle équipe')$$, '42501',
  'workspaces : un compte ne crée pas d''équipe');
select pg_temp.doit_echouer($$delete from public.workspaces$$, '42501', 'workspaces : un compte ne supprime pas d''équipe');
select pg_temp.doit_echouer($$update public.workspaces set id = gen_random_uuid()$$, '42501',
  'workspaces : l''identifiant d''une équipe ne change pas');
select pg_temp.doit_echouer($$select public.amorcer_workspace('X', 'x@example.com')$$, '42501',
  'workspaces : amorcer_workspace est fermé aux comptes connectés');

-- Le membre et l'appelant de A.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier(pg_temp.lignes($$update public.workspaces set nom = 'Par le membre'$$) = 0,
  'workspaces : un membre ne renomme pas l''équipe');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.workspaces) = 1, 'workspaces : un appelant voit son équipe');
select pg_temp.verifier(pg_temp.lignes($$update public.workspaces set nom = 'Par l''appelant'$$) = 0,
  'workspaces : un appelant ne la renomme pas');

-- L'autre équipe et le visiteur anonyme.
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.workspaces where id = 'a0000000-0000-4000-8000-000000000000') = 0, 'workspaces : B ne voit pas A');
select pg_temp.verifier((select nom from public.workspaces) = 'Équipe B (test)', 'workspaces : B voit la sienne');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select count(*) from public.workspaces$$, '42501', 'workspaces : le visiteur anonyme n''a aucun accès');
select pg_temp.doit_echouer($$select public.amorcer_workspace('X', 'x@example.com')$$, '42501',
  'workspaces : amorcer_workspace est fermé au visiteur');
select pg_temp.doit_echouer($$select public.version_schema()$$, '42501', 'workspaces : version_schema est fermé au visiteur');

-- La clé service : la version du schéma lue par /api/sante.
select pg_temp.service();
select pg_temp.verifier(public.version_schema() = 1, 'workspaces : version_schema() vaut 1 (comparée par /api/sante)');
select pg_temp.admin();

-- Aucune fonction du schéma public n'est exécutable par le visiteur anonyme (directement ou par PUBLIC) : une fonction ajoutée par une
-- migration suivante sans « revoke … from public, anon » fait échouer ce test, quelle que soit la façon dont elle est écrite.
select pg_temp.verifier(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  'workspaces : aucune fonction de public n''est exécutable par anon');
select pg_temp.verifier(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'workspaces : ni par PUBLIC');

rollback;
