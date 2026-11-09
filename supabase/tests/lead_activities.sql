-- Tests de la table lead_activities : le journal d'une fiche (appels par enregistrer_issue, notes, annonces), visible avec la fiche.
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
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'pas_repondu', 'Sonne dans le vide', null, '{"duree_s": 12}');
select pg_temp.verifier(
  (select count(*) from public.lead_activities
    where lead_id = 'ca200000-0000-4000-8000-000000000002' and type = 'appel' and issue = 'pas_repondu' and duree_s = 12 and appelant_id = 'a3000000-0000-4000-8000-000000000003'
      and statut_apres = 'a_appeler' and note = 'Sonne dans le vide') = 1,
  'lead_activities : enregistrer_issue journalise l''appel (issue, durée, appelant, statut après)');
select pg_temp.verifier((select last_activity_at is not null from public.leads where id = 'ca200000-0000-4000-8000-000000000002'),
  'lead_activities : la fiche note sa dernière activité');
insert into public.lead_activities (lead_id, type, note, cree_le) values ('ca200000-0000-4000-8000-000000000002', 'note', 'Préfère être appelé le matin', now() - interval '2 years');
select pg_temp.verifier((select cree_le = now() and appel_id is null from public.lead_activities where type = 'note' and lead_id = 'ca200000-0000-4000-8000-000000000002'),
  'lead_activities : une activité écrite depuis l''application est horodatée par la base');
select pg_temp.verifier((select count(*) from public.lead_activities where lead_id = 'ca200000-0000-4000-8000-000000000002' and type = 'note' and appelant_id = 'a3000000-0000-4000-8000-000000000003') = 1,
  'lead_activities : un appelant ajoute une note à sa fiche, à son nom');
select pg_temp.doit_echouer($$insert into public.lead_activities (lead_id, type, issue) values ('ca200000-0000-4000-8000-000000000002', 'appel', 'rdv_fixe')$$, '42501',
  'lead_activities : un « appel » ne s''écrit que par enregistrer_issue');
select pg_temp.doit_echouer($$insert into public.lead_activities (lead_id, type, note) values ('ca300000-0000-4000-8000-000000000003', 'note', 'x')$$, '42501',
  'lead_activities : pas de note sur la fiche d''un autre appelant');
select pg_temp.doit_echouer($$insert into public.lead_activities (lead_id, appelant_id, type, note) values ('ca200000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000004', 'note', 'x')$$, '42501',
  'lead_activities : on écrit à son propre nom');
select pg_temp.doit_echouer($$insert into public.lead_activities (workspace_id, lead_id, type, note) values ('b0000000-0000-4000-8000-000000000000', 'cb100000-0000-4000-8000-000000000001', 'note', 'x')$$, '23503',
  'lead_activities : jamais dans l''équipe B');
select pg_temp.doit_echouer($$update public.lead_activities set note = 'réécrit'$$, '42501', 'lead_activities : le journal ne se réécrit pas');
select pg_temp.verifier(pg_temp.lignes($$delete from public.lead_activities$$) = 0, 'lead_activities : un appelant n''efface rien');

-- Le second appelant ne voit pas la fiche, donc pas son journal ; la propriétaire voit tout.
select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
select pg_temp.verifier((select count(*) from public.lead_activities where lead_id = 'ca200000-0000-4000-8000-000000000002') = 0,
  'lead_activities : invisibles pour un appelant qui ne voit pas la fiche');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.lead_activities where lead_id = 'ca200000-0000-4000-8000-000000000002') = 2, 'lead_activities : la propriétaire voit le journal');

-- Même pour l'administrateur de la base, une activité de A ne pointe pas vers une fiche de B.
select pg_temp.admin();
select pg_temp.doit_echouer($$insert into public.lead_activities (workspace_id, lead_id, type, note) values ('a0000000-0000-4000-8000-000000000000', 'cb100000-0000-4000-8000-000000000001', 'note', 'x')$$, '23503',
  'lead_activities : une activité de A ne désigne jamais une fiche de B');

select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.lead_activities where workspace_id = 'a0000000-0000-4000-8000-000000000000') = 0, 'lead_activities : B ne voit rien de A');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(pg_temp.lignes($$delete from public.lead_activities where type = 'note'$$) = 1, 'lead_activities : un gestionnaire retire une note');
-- L'annonce d'enregistrement ne vaut que cochée PENDANT l'appel : cochée après le raccroché, l'appel n'est jamais conservable.
select pg_temp.admin();
update public.reglages set enregistrement_complet = true, annonce_lue_le = now() where workspace_id = 'a0000000-0000-4000-8000-000000000000';
create function pg_temp.appel(p_externe text, p_debut timestamptz, p_fin timestamptz, p_duree integer) returns jsonb language sql as $f$
  select public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', p_externe, 'statut', 'repondu', 'debut', p_debut,
    'fin', p_fin, 'dureeS', p_duree, 'numeroExterne', '+33199000101', 'emailAppelant', 'appelant.a@example.com'))
$f$;
create function pg_temp.cocher() returns void language plpgsql as $f$
begin
  perform pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
  insert into public.lead_activities (lead_id, type) values ('ca100000-0000-4000-8000-000000000001', 'annonce');
  perform pg_temp.service();
end $f$;
create function pg_temp.conservable(p_externe text) returns boolean language sql as $f$
  select public.appel_conservable((select id from public.appels where externe_id = p_externe))
$f$;

-- 1. Appel terminé depuis 30 secondes ; l'appelant, qui n'a pas lu l'annonce, coche après coup.
select pg_temp.service();
select pg_temp.appel('annonce-1', now() - interval '3 minutes', now() - interval '30 seconds', 150);
select pg_temp.cocher();
select pg_temp.verifier(not pg_temp.conservable('annonce-1'),
  'lead_activities : une annonce cochée 30 secondes après la fin de l''appel ne le rend pas conservable');
select pg_temp.verifier(
  (public.enregistrement_appel('onoff', 'annonce-1', 'a0000000-0000-4000-8000-000000000000/onoff/annonce-1.mp3') ->> 'raison') = 'enregistrement_non_autorise',
  'lead_activities : son audio est refusé (ni le webhook ni la reprise ne le gardent)');
select pg_temp.verifier(not (pg_temp.appel('annonce-1', null, null, null) ->> 'conserverAudio')::boolean,
  'lead_activities : un nouvel événement du même appel ne le rattrape pas');
select pg_temp.admin();
delete from public.lead_activities where type = 'annonce';

-- 2. Appel en cours (fin inconnue), annonce cochée ; puis la fin arrive : elle était ANTÉRIEURE à la coche (webhook en retard).
select pg_temp.service();
select pg_temp.appel('annonce-2', now() - interval '2 minutes', null, null);
select pg_temp.cocher();
select pg_temp.verifier((select not annonce_lue from public.appels where externe_id = 'annonce-2'),
  'lead_activities : appel dont la fin est inconnue : rien n''est rattaché (pas de fenêtre sans fin)');
select pg_temp.appel('annonce-2', null, now() - interval '10 seconds', 110);
select pg_temp.verifier(not pg_temp.conservable('annonce-2'),
  'lead_activities : une annonce cochée après la fin connue plus tard ne rend pas l''appel conservable');
select pg_temp.admin();
delete from public.lead_activities where type = 'annonce';

-- 3. Appel en cours, annonce cochée pendant l'appel ; la fin arrive ensuite : l'appel est couvert (par l'heure de fin, ou par la durée).
select pg_temp.service();
select pg_temp.appel('annonce-3', now() - interval '2 minutes', null, null);
select pg_temp.cocher();
select pg_temp.appel('annonce-3', null, now(), 120);
select pg_temp.verifier(pg_temp.conservable('annonce-3'), 'lead_activities : cochée pendant l''appel, l''annonce le couvre à l''arrivée de sa fin');
select pg_temp.appel('annonce-4', now() - interval '2 minutes', null, null);
select pg_temp.cocher();
select pg_temp.appel('annonce-4', null, null, 150);
select pg_temp.verifier(pg_temp.conservable('annonce-4'), 'lead_activities : sans heure de fin, le début et la durée bornent l''appel');
select pg_temp.admin();
delete from public.lead_activities where type = 'annonce';

-- 4. Une annonce cochée une minute avant le début d'un appel (pendant l'appel précédent) ne le couvre pas (30 secondes de tolérance).
select pg_temp.service();
select pg_temp.cocher();
select pg_temp.appel('annonce-5', now() + interval '1 minute', now() + interval '3 minutes', 120);
select pg_temp.verifier(not pg_temp.conservable('annonce-5'), 'lead_activities : une annonce d''avant le début de l''appel ne le couvre pas');
select pg_temp.admin();

select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.lead_activities$$, '42501', 'lead_activities : rien pour le visiteur');
select pg_temp.admin();

rollback;
