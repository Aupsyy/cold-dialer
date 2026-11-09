-- Tests de la table integrations_evenements : l'idempotence des webhooks, des codes seulement, la purge à 90 jours, rien pour l'application.
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

select pg_temp.service();
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-a',
  'rdvExterneId', 'rdv-a', 'debut', now() + interval '1 day', 'leadId', 'ca100000-0000-4000-8000-000000000001'));
select pg_temp.verifier(
  (select count(*) from public.integrations_evenements
    where fournisseur = 'calendly' and externe_id = 'evt-a' and workspace_id = 'a0000000-0000-4000-8000-000000000000' and lead_id = 'ca100000-0000-4000-8000-000000000001' and resultat = 'rdv_cree') = 1,
  'integrations_evenements : chaque événement est noté une fois, avec son résultat');
select pg_temp.verifier(
  (public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-a',
     'rdvExterneId', 'rdv-a', 'debut', now() + interval '1 day', 'leadId', 'ca100000-0000-4000-8000-000000000001')) ->> 'doublon')::boolean,
  'integrations_evenements : le même événement renvoyé est reconnu');
select pg_temp.verifier((select count(*) from public.integrations_evenements where externe_id = 'evt-a') = 1,
  'integrations_evenements : pas de doublon');

-- Les versions d'un même rendez-vous (Google : une clé par « updated ») : une version qui ne change rien n'écrit rien ; un aller-retour,
-- une annulation puis une restauration puis une nouvelle annulation sont tous appliqués.
create function pg_temp.google(p_cle text, p_type text, p_jours integer) returns text language sql as $f$
  select public.evenement_agenda(jsonb_build_object('fournisseur', 'google', 'type', p_type, 'externeId', p_cle, 'rdvExterneId', 'g-1',
    'debut', date_trunc('hour', now()) + make_interval(days => p_jours), 'fin', date_trunc('hour', now()) + make_interval(days => p_jours, mins => 30),
    'leadId', 'ca200000-0000-4000-8000-000000000002'), 'a0000000-0000-4000-8000-000000000000') ->> 'rendezVousId'
$f$;
create function pg_temp.resultat(p_cle text) returns text language sql as $f$
  select resultat from public.integrations_evenements where fournisseur = 'google' and externe_id = p_cle
$f$;
create function pg_temp.activites_rdv() returns bigint language sql as $f$
  select count(*) from public.lead_activities where lead_id = 'ca200000-0000-4000-8000-000000000002' and type = 'rdv'
$f$;
select pg_temp.google('g-1:v1', 'reserve', 3);
select pg_temp.admin();
update public.leads set statut = 'pas_interesse' where id = 'ca200000-0000-4000-8000-000000000002';
select pg_temp.service();
select pg_temp.google('g-1:v2', 'deplace', 3);
select pg_temp.verifier(pg_temp.resultat('g-1:v2') = 'rdv_inchange' and pg_temp.activites_rdv() = 1
  and (select statut from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = 'pas_interesse',
  'integrations_evenements : une nouvelle version sans changement (réponse de l''invité) : rdv_inchange, ni activité ni statut de fiche touchés');
select pg_temp.google('g-1:v3', 'deplace', 4);
select pg_temp.google('g-1:v4', 'deplace', 3);
select pg_temp.verifier(pg_temp.resultat('g-1:v4') = 'rdv_deplace'
  and (select debut from public.rendez_vous where source = 'google' and externe_id = 'g-1') = date_trunc('hour', now()) + interval '3 days',
  'integrations_evenements : A, puis B, puis de nouveau A : le retour en A est appliqué');
select pg_temp.google('annule:g-1:v5', 'annule', 3);
select pg_temp.google('annule:g-1:v6', 'annule', 3);
select pg_temp.verifier(pg_temp.resultat('annule:g-1:v5') = 'rdv_annule' and pg_temp.resultat('annule:g-1:v6') = 'rdv_inchange',
  'integrations_evenements : une annulation renvoyée sous une autre version ne réécrit rien');
select pg_temp.google('g-1:v7', 'deplace', 3);
select pg_temp.google('annule:g-1:v8', 'annule', 3);
select pg_temp.verifier(pg_temp.resultat('g-1:v7') = 'rdv_deplace' and pg_temp.resultat('annule:g-1:v8') = 'rdv_annule'
  and (select statut from public.rendez_vous where source = 'google' and externe_id = 'g-1') = 'annule',
  'integrations_evenements : annulé, restauré, ré-annulé : le rendez-vous finit annulé');
select public.evenement_agenda(jsonb_build_object('fournisseur', 'google', 'type', 'reserve', 'externeId', 'g-2:v1', 'rdvExterneId', 'g-2',
  'debut', date_trunc('hour', now()) - interval '1 day', 'leadId', 'ca200000-0000-4000-8000-000000000002'), 'a0000000-0000-4000-8000-000000000000');
select public.evenement_agenda(jsonb_build_object('fournisseur', 'google', 'type', 'issue', 'externeId', 'g-2:i1', 'rdvExterneId', 'g-2', 'issue', 'no_show'),
  'a0000000-0000-4000-8000-000000000000');
select pg_temp.admin();
update public.leads set statut = 'pas_interesse' where id = 'ca200000-0000-4000-8000-000000000002';
select pg_temp.service();
select public.evenement_agenda(jsonb_build_object('fournisseur', 'google', 'type', 'issue', 'externeId', 'g-2:i2', 'rdvExterneId', 'g-2', 'issue', 'no_show'),
  'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier(pg_temp.resultat('g-2:i2') = 'rdv_inchange'
  and (select statut from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = 'pas_interesse',
  'integrations_evenements : un no-show renvoyé ne rouvre pas une fiche traitée depuis');
-- Google lit tout l'agenda du closer : un événement qui ne se rattache à aucune fiche (réunion, invitation reçue) n'est pas gardé.
select public.evenement_agenda(jsonb_build_object('fournisseur', 'google', 'type', 'reserve', 'externeId', 'g-3:v1', 'rdvExterneId', 'g-3',
  'debut', date_trunc('hour', now()) + interval '5 days', 'email', 'fournisseur.demo@example.com', 'nom', 'Fournisseur Démo',
  'telephone', '+33199000199'), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier(pg_temp.resultat('g-3:v1') = 'ignore_sans_fiche'
  and not exists (select 1 from public.rendez_vous where source = 'google' and externe_id = 'g-3')
  and not exists (select 1 from public.rendez_vous where invite_email = 'fournisseur.demo@example.com'),
  'integrations_evenements : Google, sans fiche : ni rendez-vous « à vérifier » ni données de l''invité');
select pg_temp.verifier(
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'integrations_evenements'
               and column_name in ('email', 'telephone', 'nom', 'charge', 'corps', 'brut')),
  'integrations_evenements : aucune colonne pour un e-mail, un numéro ou le corps d''un webhook');
select pg_temp.doit_echouer($$insert into public.integrations_evenements (fournisseur, externe_id, type, resultat)
  values ('calendly', 'evt-b', 'reserve', 'Contact : quelqu''un@example.com')$$, '23514',
  'integrations_evenements : le résultat est un code, jamais un texte libre');

-- La purge (clé service seule).
select pg_temp.admin();
insert into public.integrations_evenements (fournisseur, externe_id, type, recu_le) values ('calendly', 'evt-vieux', 'reserve', now() - interval '91 days');
select pg_temp.service();
select set_config('test.purges', public.purger_integrations_evenements()::text, true);
select pg_temp.verifier(
  current_setting('test.purges')::int >= 1 and not exists (select 1 from public.integrations_evenements where externe_id = 'evt-vieux')
  and exists (select 1 from public.integrations_evenements where externe_id = 'evt-a'),
  'integrations_evenements : la purge retire ce qui a plus de 90 jours, rien d''autre');

-- Rien pour l'application ni pour le visiteur.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$select * from public.integrations_evenements$$, '42501',
  'integrations_evenements : rien pour un compte connecté, même propriétaire');
select pg_temp.doit_echouer($$select public.purger_integrations_evenements()$$, '42501',
  'integrations_evenements : la purge est réservée à la clé service');
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$insert into public.integrations_evenements (fournisseur, externe_id, type) values ('calendly', 'evt-c', 'reserve')$$, '42501',
  'integrations_evenements : aucune écriture par un compte connecté');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.integrations_evenements$$, '42501', 'integrations_evenements : rien pour le visiteur');
select pg_temp.admin();

rollback;
