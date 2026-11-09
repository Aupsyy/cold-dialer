-- Tests des AGRÉGATS des retours du marché (retours_marche_agreger, page /retours) : deux équipes, trois rôles ; l'agrégat ne voit
-- que l'équipe (et, pour un appelant, que ses propres retours), dans la fenêtre demandée (début inclus, fin exclue).
-- Au format de supabase/tests/ (fixture copiée, begin … rollback) : à y déplacer quand tests/sql-statique.test.mjs acceptera plus de
-- 13 fichiers. En attendant, tests/retours-agregats-sql.test.mjs le joue sur la base locale.
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

-- Retours de l'équipe A dans la fenêtre (les 30 derniers jours) : trois de l'appelant a3, un du second appelant a4.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.retours_marche (lead_id, appel_le, issue, objection_code, accroche_verdict, interet, decideur_joint, citation, douleur, tags) values
  ('ca200000-0000-4000-8000-000000000002', now() - interval '2 days', 'rdv_fixe', 'pas-le-temps', 'accroche', 3, true,
   'Citation fictive A1 : on manque de chantiers en hiver.', 'Hiver creux', array['saison', 'zone']),
  ('ca100000-0000-4000-8000-000000000001', now() - interval '3 days', 'pas_interesse', 'assez-de-travail', 'rejet', 1, false,
   null, null, array['saison']),
  ('ca200000-0000-4000-8000-000000000002', now() - interval '4 days', 'a_rappeler', 'pas-le-temps', null, null, true,
   'Citation fictive A2 : rappelez-moi après la saison.', null, array['saison']);
-- Hors fenêtre : 40 jours.
insert into public.retours_marche (appel_le, objection_code, citation) values (now() - interval '40 days', 'combien-ca-coute', 'Citation fictive ancienne');
select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
insert into public.retours_marche (lead_id, appel_le, issue, objection_code, accroche_verdict, interet, tags) values
  ('ca300000-0000-4000-8000-000000000003', now() - interval '1 day', 'a_rappeler', 'combien-ca-coute', 'neutre', 2, array['prix']);

-- Retours de l'équipe B : ils ne doivent jamais compter pour A.
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
insert into public.retours_marche (lead_id, appel_le, issue, objection_code, accroche_verdict, interet, decideur_joint, citation, tags) values
  ('cb100000-0000-4000-8000-000000000001', now() - interval '1 day', 'rdv_fixe', 'pas-le-temps', 'accroche', 3, true, 'Citation fictive de l''équipe B', array['equipe-b']),
  (null, now() - interval '5 days', 'rdv_fixe', 'pas-le-temps', 'accroche', 0, true, null, array['equipe-b']);

-- La propriétaire de A : toute son équipe, rien de B, rien hors fenêtre.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select set_config('test.a', public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute')::text, true);
select pg_temp.verifier((current_setting('test.a')::jsonb ->> 'total')::int = 4, 'agrégats : la propriétaire compte les 4 retours de son équipe dans la fenêtre');
select pg_temp.verifier((current_setting('test.a')::jsonb ->> 'decideurs')::int = 2 and (current_setting('test.a')::jsonb ->> 'rdv')::int = 1,
  'agrégats : décideurs joints et rendez-vous de l''équipe seulement');
select pg_temp.verifier(current_setting('test.a')::jsonb -> 'objections' = '[{"code": "pas-le-temps", "n": 2}, {"code": "assez-de-travail", "n": 1}, {"code": "combien-ca-coute", "n": 1}]'::jsonb,
  'agrégats : objections classées (fréquence, puis code), sans celles de B ni celles hors fenêtre');
select pg_temp.verifier(current_setting('test.a')::jsonb -> 'verdicts' = '{"accroche": 1, "neutre": 1, "rejet": 1}'::jsonb, 'agrégats : verdicts de l''accroche de l''équipe');
select pg_temp.verifier((current_setting('test.a')::jsonb ->> 'interetMoyen')::numeric = 2, 'agrégats : intérêt moyen sur les retours notés (3, 1 et 2)');
select pg_temp.verifier(current_setting('test.a')::jsonb -> 'tags' -> 0 = '{"tag": "saison", "n": 3}'::jsonb
  and not (current_setting('test.a')::jsonb -> 'tags') @> '[{"tag": "equipe-b"}]'::jsonb, 'agrégats : tags de l''équipe, le plus fréquent d''abord');
select pg_temp.verifier(
  (select array_agg(c ->> 'texte' order by o) from jsonb_array_elements(current_setting('test.a')::jsonb -> 'citations') with ordinality as x(c, o))
    = array['Citation fictive A1 : on manque de chantiers en hiver.', 'Citation fictive A2 : rappelez-moi après la saison.'],
  'agrégats : citations mot pour mot, la plus récente d''abord, ni celles de B ni l''ancienne');
select pg_temp.verifier(jsonb_array_length(current_setting('test.a')::jsonb -> 'douleurs') = 1, 'agrégats : douleurs de l''équipe');
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '90 days', now() + interval '1 minute') ->> 'total')::int = 5,
  'agrégats : une fenêtre plus large reprend le retour ancien');

-- Le membre voit la même chose ; chaque appelant, seulement les siens.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute') ->> 'total')::int = 4, 'agrégats : le membre agrège toute l''équipe');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute') ->> 'total')::int = 3, 'agrégats : l''appelant a3 agrège ses 3 retours');
select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
select pg_temp.verifier(public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute') -> 'objections' = '[{"code": "combien-ca-coute", "n": 1}]'::jsonb,
  'agrégats : l''appelant a4 n''agrège que sa propre objection');

-- L'équipe B ne voit que la sienne, même en désignant A.
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select set_config('test.b', public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute', 'a0000000-0000-4000-8000-000000000000')::text, true);
select pg_temp.verifier((current_setting('test.b')::jsonb ->> 'total')::int = 2 and current_setting('test.b')::jsonb -> 'objections' = '[{"code": "pas-le-temps", "n": 2}]'::jsonb,
  'agrégats : B n''agrège que ses 2 retours, même en désignant l''équipe A');
select pg_temp.verifier(current_setting('test.b')::jsonb -> 'citations' -> 0 ->> 'texte' = 'Citation fictive de l''équipe B'
  and jsonb_array_length(current_setting('test.b')::jsonb -> 'citations') = 1, 'agrégats : B ne lit aucune citation de A');
select pg_temp.verifier((current_setting('test.b')::jsonb ->> 'interetMoyen')::numeric = 1.5, 'agrégats : intérêt moyen de B (3 et 0)');

-- Les bornes : début inclus, fin exclue.
select pg_temp.admin();
select set_config('test.borne', (select appel_le::text from public.retours_marche where objection_code = 'assez-de-travail'), true);
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(
  (public.retours_marche_agreger(current_setting('test.borne')::timestamptz, current_setting('test.borne')::timestamptz + interval '1 second') ->> 'total')::int = 1
  and (public.retours_marche_agreger(current_setting('test.borne')::timestamptz - interval '1 hour', current_setting('test.borne')::timestamptz) ->> 'total')::int = 0,
  'agrégats : le début de la fenêtre est inclus, la fin exclue');

-- Vingt citations au plus, les plus récentes.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.retours_marche (appel_le, citation)
select now() - make_interval(mins => n), 'Citation fictive en série ' || n from generate_series(1, 21) as n;
select set_config('test.c', public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute')::text, true);
select pg_temp.verifier(jsonb_array_length(current_setting('test.c')::jsonb -> 'citations') = 20
  and current_setting('test.c')::jsonb -> 'citations' -> 0 ->> 'texte' = 'Citation fictive en série 1', 'agrégats : vingt citations au plus, la plus récente d''abord');

-- La clé service (skill ajuster-script) désigne une équipe ; le visiteur n'a rien.
select pg_temp.service();
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute', 'b0000000-0000-4000-8000-000000000000') ->> 'total')::int = 2,
  'agrégats : la clé service agrège l''équipe désignée (B)');
select pg_temp.verifier((public.retours_marche_agreger(now() - interval '30 days', now() + interval '1 minute', 'a0000000-0000-4000-8000-000000000000') ->> 'total')::int = 25,
  'agrégats : et seulement elle (A : 4 retours et 21 citations en série)');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select public.retours_marche_agreger(now() - interval '30 days', now())$$, '42501', 'agrégats : rien pour le visiteur');
select pg_temp.admin();

rollback;
