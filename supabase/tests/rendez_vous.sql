-- Tests de la table rendez_vous : prise au Poste, chevauchement, RLS, événements d'agenda (evenement_agenda) et flux ICS.
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
insert into public.rendez_vous (lead_id, debut) values ('ca200000-0000-4000-8000-000000000002', date_trunc('hour', now()) + interval '2 days');
select pg_temp.verifier(
  (select count(*) from public.rendez_vous
    where lead_id = 'ca200000-0000-4000-8000-000000000002' and closer_id = 'a1000000-0000-4000-8000-000000000001' and pris_par = 'a3000000-0000-4000-8000-000000000003' and fin = debut + interval '30 minutes' and source = 'poste') = 1,
  'rendez_vous : pris au Poste, avec la fin et le closer par défaut (la propriétaire)');
select pg_temp.verifier((select rdv_le from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = date_trunc('hour', now()) + interval '2 days',
  'rendez_vous : la fiche suit son prochain rendez-vous (rdv_le)');
select pg_temp.doit_echouer($$insert into public.rendez_vous (lead_id, debut) values ('ca100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 days 15 minutes')$$,
  '23P01', 'rendez_vous : deux rendez-vous du même closer ne se chevauchent pas');
select pg_temp.doit_echouer($$insert into public.rendez_vous (lead_id, debut) values ('ca300000-0000-4000-8000-000000000003', now() + interval '5 days')$$, '42501',
  'rendez_vous : pas sur la fiche d''un autre appelant');
select pg_temp.doit_echouer($$insert into public.rendez_vous (lead_id, debut, source, externe_id) values ('ca200000-0000-4000-8000-000000000002', now() + interval '6 days', 'calendly', 'faux-1')$$,
  '42501', 'rendez_vous : un rendez-vous d''agenda externe ne s''écrit que par evenement_agenda');
select pg_temp.doit_echouer($$insert into public.rendez_vous (lead_id, debut, fin) values ('ca200000-0000-4000-8000-000000000002', now() + interval '7 days', now() + interval '6 days')$$,
  '23514', 'rendez_vous : la fin vient après le début');
select pg_temp.verifier((select count(*) from public.rendez_vous) = 1, 'rendez_vous : un appelant voit ceux qu''il a pris');
select pg_temp.doit_echouer($$update public.rendez_vous set lead_id = 'ca300000-0000-4000-8000-000000000003' where lead_id = 'ca200000-0000-4000-8000-000000000002'$$, '42501',
  'rendez_vous : un appelant ne repointe pas son rendez-vous sur la fiche d''un autre');
update public.rendez_vous set source = 'calendly', externe_id = 'evite-1' where lead_id = 'ca200000-0000-4000-8000-000000000002';
select pg_temp.verifier((select source = 'poste' and externe_id is null from public.rendez_vous where lead_id = 'ca200000-0000-4000-8000-000000000002'),
  'rendez_vous : la source d''un rendez-vous ne se change pas depuis l''application (pas d''échappée au contrôle de chevauchement)');

select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
select pg_temp.verifier((select count(*) from public.rendez_vous) = 0, 'rendez_vous : un autre appelant ne les voit pas');
select pg_temp.verifier(pg_temp.lignes($$update public.rendez_vous set statut = 'annule'$$) = 0, 'rendez_vous : ni ne les modifie');

select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(pg_temp.lignes($$update public.rendez_vous set statut = 'tenu' where lead_id = 'ca200000-0000-4000-8000-000000000002'$$) = 1,
  'rendez_vous : le closer note l''issue');
select pg_temp.verifier((select rdv_le from public.leads where id = 'ca200000-0000-4000-8000-000000000002') is null,
  'rendez_vous : un rendez-vous tenu n''est plus « à venir » sur la fiche');
select pg_temp.doit_echouer($$update public.rendez_vous set closer_id = 'b1000000-0000-4000-8000-000000000001'$$, '23503', 'rendez_vous : un closer de la même équipe seulement');
-- Retirer un membre qui tient un rendez-vous au même créneau que la propriétaire : le retrait passe, le rendez-vous reste sans closer.
insert into public.rendez_vous (lead_id, debut, closer_id, pris_par) values ('ca300000-0000-4000-8000-000000000003', date_trunc('hour', now()) + interval '6 days', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001');
insert into public.rendez_vous (lead_id, debut, closer_id, pris_par) values ('ca300000-0000-4000-8000-000000000003', date_trunc('hour', now()) + interval '6 days', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');
select public.retirer_membre('a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier((select count(*) filter (where closer_id is null) = 1 and count(*) = 2 from public.rendez_vous
                          where lead_id = 'ca300000-0000-4000-8000-000000000003' and debut = date_trunc('hour', now()) + interval '6 days'),
  'rendez_vous : retirer un closer ne bute pas sur un chevauchement (ses rendez-vous restent, sans closer)');
insert into public.rendez_vous (lead_id, debut, pris_par) values ('ca200000-0000-4000-8000-000000000002', date_trunc('hour', now()) + interval '4 days', 'a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select rdv_le from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = date_trunc('hour', now()) + interval '4 days',
  'rendez_vous : un nouveau rendez-vous redevient le prochain de la fiche');
select pg_temp.verifier(pg_temp.lignes($$delete from public.rendez_vous where lead_id = 'ca200000-0000-4000-8000-000000000002' and statut = 'pris'$$) = 1,
  'rendez_vous : un gestionnaire supprime un rendez-vous');
select pg_temp.verifier((select rdv_le from public.leads where id = 'ca200000-0000-4000-8000-000000000002') is null, 'rendez_vous : la fiche le sait aussitôt (suppression)');

select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.rendez_vous) = 0, 'rendez_vous : B ne voit rien de A');
select pg_temp.doit_echouer($$insert into public.rendez_vous (lead_id, debut) values ('ca100000-0000-4000-8000-000000000001', now() + interval '3 days')$$, '23503',
  'rendez_vous : B ne prend pas de rendez-vous sur une fiche de A');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.rendez_vous$$, '42501', 'rendez_vous : rien pour le visiteur');

-- Les créneaux occupés du closer : un appelant voit ceux que ses collègues ont posés avec lui, sans voir ni la fiche ni le rendez-vous.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.rendez_vous (lead_id, debut, fin, note) values ('ca200000-0000-4000-8000-000000000002',
  date_trunc('day', now()) + interval '1 day 10 hours', date_trunc('day', now()) + interval '1 day 10 hours 30 minutes', 'Créneau du collègue');
select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
select pg_temp.verifier((select count(*) from public.rendez_vous where note = 'Créneau du collègue') = 0,
  'rendez_vous : le second appelant ne voit pas le rendez-vous de son collègue');
select pg_temp.verifier(
  exists (select 1 from public.creneaux_occupes(now(), now() + interval '21 days') c
           where c.debut = date_trunc('day', now()) + interval '1 day 10 hours' and c.fin = date_trunc('day', now()) + interval '1 day 10 hours 30 minutes'),
  'rendez_vous : creneaux_occupes lui donne pourtant ce créneau du closer (début et fin seulement)');
select pg_temp.doit_echouer($$insert into public.rendez_vous (lead_id, debut, fin) values ('ca300000-0000-4000-8000-000000000003',
  date_trunc('day', now()) + interval '1 day 10 hours', date_trunc('day', now()) + interval '1 day 10 hours 30 minutes')$$, '23P01',
  'rendez_vous : ce créneau lui aurait été refusé (le Poste ne le propose donc plus)');
select pg_temp.verifier((select count(*) from public.creneaux_occupes(now(), now() + interval '90 days')) = 0,
  'rendez_vous : creneaux_occupes : 62 jours au plus');
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.creneaux_occupes(now(), now() + interval '21 days', 'a1000000-0000-4000-8000-000000000001')) = 0,
  'rendez_vous : jamais les créneaux du closer d''une autre équipe');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.creneaux_occupes(now(), now() + interval '1 day')$$, '42501',
  'rendez_vous : creneaux_occupes est fermé au visiteur');
select pg_temp.admin();
delete from public.rendez_vous where note = 'Créneau du collègue';

-- Les événements d'agenda (clé service).
select pg_temp.admin();
update public.leads set email = 'contact.a1@example.com' where id = 'ca100000-0000-4000-8000-000000000001';
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$select public.evenement_agenda('{}'::jsonb)$$, '42501', 'rendez_vous : evenement_agenda est fermé aux comptes connectés');
select pg_temp.service();
select public.evenement_agenda(jsonb_build_object(
  'fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-1', 'rdvExterneId', 'rdv-1',
  'debut', date_trunc('hour', now()) + interval '10 days', 'fin', date_trunc('hour', now()) + interval '10 days 30 minutes', 'email', 'Contact.A1@example.com', 'nom', 'Contact A1',
  'canal', 'visio', 'lienVisio', 'https://example.org/visio/1', 'emailCloser', 'proprietaire.a@example.com'));
select pg_temp.verifier((select statut from public.leads where id = 'ca100000-0000-4000-8000-000000000001') = 'rdv_fixe',
  'rendez_vous : une réservation retrouve la fiche par l''e-mail et la passe rdv_fixe');
select pg_temp.verifier(
  (select count(*) from public.rendez_vous
    where source = 'calendly' and externe_id = 'rdv-1' and lead_id = 'ca100000-0000-4000-8000-000000000001' and closer_id = 'a1000000-0000-4000-8000-000000000001' and not a_verifier) = 1,
  'rendez_vous : créé avec son closer (l''e-mail de l''hôte)');
select pg_temp.verifier(
  (public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-1', 'rdvExterneId', 'rdv-1',
     'debut', date_trunc('hour', now()) + interval '10 days', 'emailCloser', 'proprietaire.a@example.com')) ->> 'doublon')::boolean,
  'rendez_vous : un événement renvoyé est reconnu et ignoré (idempotence)');
select public.evenement_agenda(jsonb_build_object(
  'fournisseur', 'calendly', 'type', 'deplace', 'externeId', 'evt-2', 'rdvExterneId', 'rdv-1',
  'debut', date_trunc('hour', now()) + interval '11 days', 'fin', date_trunc('hour', now()) + interval '11 days 30 minutes', 'emailCloser', 'proprietaire.a@example.com'));
select pg_temp.verifier(
  (select debut from public.rendez_vous where externe_id = 'rdv-1') = date_trunc('hour', now()) + interval '11 days'
  and (select rdv_le from public.leads where id = 'ca100000-0000-4000-8000-000000000001') = date_trunc('hour', now()) + interval '11 days',
  'rendez_vous : un déplacement met à jour le créneau et la fiche');
select public.evenement_agenda(jsonb_build_object(
  'fournisseur', 'calendly', 'type', 'annule', 'externeId', 'evt-3', 'rdvExterneId', 'rdv-1', 'emailCloser', 'proprietaire.a@example.com'));
select pg_temp.verifier(
  (select statut from public.rendez_vous where externe_id = 'rdv-1') = 'annule'
  and (select statut = 'a_rappeler' and rdv_le is null from public.leads where id = 'ca100000-0000-4000-8000-000000000001'),
  'rendez_vous : une annulation remet la fiche à rappeler');
select public.evenement_agenda(jsonb_build_object(
  'fournisseur', 'iclosed', 'type', 'reserve', 'externeId', 'evt-4', 'rdvExterneId', 'rdv-2', 'debut', date_trunc('hour', now()) + interval '12 days',
  'email', 'inconnu@example.com', 'telephone', '+33 1 99 00 09 99', 'nom', 'Personne inconnue'), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier((select a_verifier and lead_id is null and invite_nom = 'Personne inconnue' from public.rendez_vous where externe_id = 'rdv-2'),
  'rendez_vous : sans fiche retrouvée, le rendez-vous est gardé « à vérifier »');
select public.evenement_agenda(jsonb_build_object(
  'fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-5', 'rdvExterneId', 'rdv-3', 'debut', date_trunc('hour', now()) + interval '13 days',
  'leadId', 'ca300000-0000-4000-8000-000000000003'));
select pg_temp.verifier((select lead_id from public.rendez_vous where externe_id = 'rdv-3') = 'ca300000-0000-4000-8000-000000000003',
  'rendez_vous : leadId (utm_content) retrouve la fiche et son équipe');
select pg_temp.doit_echouer($$select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-6',
  'rdvExterneId', 'rdv-4', 'debut', date_trunc('hour', now()) + interval '14 days', 'telephone', '01 99 00 01 04'))$$, 'P0002',
  'rendez_vous : plusieurs équipes et aucun indice : refus');
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-7',
  'rdvExterneId', 'rdv-4', 'debut', date_trunc('hour', now()) + interval '14 days', 'telephone', '01 99 00 01 04'), 'b0000000-0000-4000-8000-000000000000');
select pg_temp.verifier((select lead_id from public.rendez_vous where externe_id = 'rdv-4') = 'cb100000-0000-4000-8000-000000000001',
  'rendez_vous : le téléphone (9 chiffres) retrouve la fiche dans l''équipe désignée');
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'issue', 'externeId', 'evt-8',
  'rdvExterneId', 'rdv-3', 'issue', 'no_show'), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier(
  (select statut from public.rendez_vous where externe_id = 'rdv-3') = 'no_show'
  and (select statut from public.leads where id = 'ca300000-0000-4000-8000-000000000003') = 'rdv_fixe',
  'rendez_vous : un no-show ne rouvre pas une fiche qui a encore un autre rendez-vous actif');
select pg_temp.admin();
update public.rendez_vous set statut = 'annule' where lead_id = 'ca300000-0000-4000-8000-000000000003' and statut in ('pris', 'confirme');
select pg_temp.service();
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-5b', 'rdvExterneId', 'rdv-5',
  'debut', date_trunc('hour', now()) + interval '15 days', 'leadId', 'ca300000-0000-4000-8000-000000000003', 'emailCloser', 'appelant2.a@example.com'));
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'issue', 'externeId', 'evt-5c',
  'rdvExterneId', 'rdv-5', 'issue', 'no_show'), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier(
  (select statut = 'a_rappeler' and rappel_le is not null from public.leads where id = 'ca300000-0000-4000-8000-000000000003'),
  'rendez_vous : un no-show remet à rappeler une fiche qui n''a plus d''autre rendez-vous actif');
select pg_temp.doit_echouer($$select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-inf',
  'rdvExterneId', 'rdv-inf', 'debut', 'infinity'), 'a0000000-0000-4000-8000-000000000000')$$, '22023',
  'rendez_vous : une date « infinity » compte pour absente (refus net, pas de rendez-vous infini)');
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-long',
  'rdvExterneId', 'rdv-long', 'debut', date_trunc('hour', now()) + interval '20 days', 'email', repeat('x', 300) || '@example.com',
  'nom', repeat('N', 400)), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier((select invite_email is null and char_length(invite_nom) = 160 from public.rendez_vous where externe_id = 'rdv-long'),
  'rendez_vous : un e-mail ou un nom démesuré est écarté ou tronqué, l''événement passe (pas de renvoi sans fin)');
select pg_temp.doit_echouer($$select public.evenement_agenda('{"fournisseur":"autre","type":"reserve","externeId":"e","rdvExterneId":"r"}'::jsonb)$$,
  '22023', 'rendez_vous : un fournisseur inconnu est refusé');
select pg_temp.doit_echouer($$select public.evenement_agenda('{"fournisseur":"calendly","type":"issue","externeId":"e9","rdvExterneId":"r","issue":"peut-etre"}'::jsonb)$$,
  '22023', 'rendez_vous : une issue inconnue est refusée');
select pg_temp.verifier(
  (public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'annule', 'externeId', 'evt-9', 'rdvExterneId', 'rdv-jamais-vu'), 'a0000000-0000-4000-8000-000000000000')
     ->> 'rendezVousId') is null,
  'rendez_vous : annuler un rendez-vous inconnu ne crée rien');
select pg_temp.verifier((select resultat from public.integrations_evenements where externe_id = 'evt-9') = 'rdv_inconnu',
  'rendez_vous : et le journal le dit');

-- Une fiche qui a un rendez-vous actif à venir ne revient pas dans la file (un appel pour confirmer qui ne répond pas, un rappel noté).
select pg_temp.admin();
insert into public.leads (id, workspace_id, entreprise, telephone, assigned_to) values
  ('ca800000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Rdv', '+33199000153', 'a3000000-0000-4000-8000-000000000003'),
  ('ca900000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Deux Rdv', '+33199000154', null),
  ('caa00000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Rdv Passé', '+33199000155', 'a3000000-0000-4000-8000-000000000003');
select pg_temp.service();
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-10', 'rdvExterneId', 'rdv-10',
  'debut', date_trunc('hour', now()) + interval '2 days', 'leadId', 'ca800000-0000-4000-8000-000000000008', 'emailCloser', 'appelant2.a@example.com'));
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select set_config('test.issue', public.enregistrer_issue('ca800000-0000-4000-8000-000000000008', 'pas_repondu', null, now() + interval '2 hours')::text, true);
select pg_temp.verifier(
  (current_setting('test.issue')::jsonb ->> 'statut') = 'rdv_fixe'
  and (select statut = 'rdv_fixe' and tentatives = 0 and rappel_le is null and derniere_issue = 'pas_repondu'
         from public.leads where id = 'ca800000-0000-4000-8000-000000000008'),
  'rendez_vous : « pas répondu » sur une fiche qui a un rendez-vous à venir : elle reste rdv_fixe, sans tentative ni rappel');
select pg_temp.verifier(
  (select count(*) from public.lead_activities where lead_id = 'ca800000-0000-4000-8000-000000000008' and type = 'appel' and statut_apres = 'rdv_fixe') = 1,
  'rendez_vous : l''appel reste journalisé');
select public.enregistrer_issue('ca800000-0000-4000-8000-000000000008', 'a_rappeler', 'Rappeler pour confirmer', now() + interval '1 day');
select pg_temp.verifier((select statut = 'rdv_fixe' and rappel_le is null from public.leads where id = 'ca800000-0000-4000-8000-000000000008'),
  'rendez_vous : un rappel noté en appelant pour confirmer ne la renvoie pas dans la file');
update public.leads set statut = 'a_appeler' where id = 'ca800000-0000-4000-8000-000000000008';
select pg_temp.verifier((select statut from public.leads where id = 'ca800000-0000-4000-8000-000000000008') = 'rdv_fixe',
  'rendez_vous : ni une requête directe');
select pg_temp.service();
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'annule', 'externeId', 'evt-10b', 'rdvExterneId', 'rdv-10'),
  'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier((select statut = 'a_rappeler' and rappel_le is not null from public.leads where id = 'ca800000-0000-4000-8000-000000000008'),
  'rendez_vous : son annulation par l''outil d''agenda la remet ensuite à rappeler');

-- Deux rendez-vous : le no-show du premier (passé) ne change rien tant que le second (dans trois jours) est actif.
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-11', 'rdvExterneId', 'rdv-11',
  'debut', date_trunc('hour', now()) - interval '1 day', 'leadId', 'ca900000-0000-4000-8000-000000000009', 'emailCloser', 'appelant2.a@example.com'));
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'reserve', 'externeId', 'evt-12', 'rdvExterneId', 'rdv-12',
  'debut', date_trunc('hour', now()) + interval '3 days', 'leadId', 'ca900000-0000-4000-8000-000000000009', 'emailCloser', 'appelant2.a@example.com'));
select public.evenement_agenda(jsonb_build_object('fournisseur', 'calendly', 'type', 'issue', 'externeId', 'evt-11b', 'rdvExterneId', 'rdv-11',
  'issue', 'no_show'), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier((select statut = 'rdv_fixe' and rappel_le is null from public.leads where id = 'ca900000-0000-4000-8000-000000000009'),
  'rendez_vous : le no-show d''un rendez-vous ne met pas en tête de file une fiche qui en a un autre à venir');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
update public.leads set statut = 'a_rappeler', rappel_le = now() where id = 'ca900000-0000-4000-8000-000000000009';
select pg_temp.verifier((select statut = 'rdv_fixe' and rappel_le is null from public.leads where id = 'ca900000-0000-4000-8000-000000000009'),
  'rendez_vous : ni le no-show noté dans l''écran Agenda (le filet de la base)');

-- Un rendez-vous déjà passé et jamais noté ne protège plus la fiche.
select pg_temp.admin();
insert into public.rendez_vous (lead_id, workspace_id, closer_id, debut, fin, source, statut) values
  ('caa00000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000000', 'a4000000-0000-4000-8000-000000000004',
   now() - interval '2 days', now() - interval '2 days' + interval '30 minutes', 'manuel', 'pris');
update public.leads set statut = 'rdv_fixe' where id = 'caa00000-0000-4000-8000-00000000000a';
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select public.enregistrer_issue('caa00000-0000-4000-8000-00000000000a', 'pas_repondu', null, now() + interval '2 hours');
select pg_temp.verifier((select statut = 'a_appeler' and tentatives = 1 from public.leads where id = 'caa00000-0000-4000-8000-00000000000a'),
  'rendez_vous : un rendez-vous passé ne retient plus la fiche hors de la file');

-- Le flux ICS : jeton tiré par la base, montré une fois, empreinte seule gardée, lu par la clé service.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select set_config('test.jeton', public.agenda_jeton_creer(), true);
select pg_temp.verifier(current_setting('test.jeton') ~ '^[0-9a-f]{64}$', 'rendez_vous : le jeton du flux ICS est tiré par la base');
select pg_temp.verifier(
  (select agenda_jeton_empreinte from public.profiles where id = 'a1000000-0000-4000-8000-000000000001') = encode(sha256(convert_to(current_setting('test.jeton'), 'UTF8')), 'hex'),
  'rendez_vous : seule l''empreinte du jeton est gardée');
select pg_temp.doit_echouer($$select public.agenda_flux(current_setting('test.jeton'))$$, '42501',
  'rendez_vous : le flux ICS se lit par la clé service seulement');
select pg_temp.service();
select pg_temp.verifier(jsonb_array_length(public.agenda_flux(current_setting('test.jeton')) -> 'rendezVous') = 6,
  'rendez_vous : le flux ICS liste les 6 rendez-vous du closer (Poste et agendas externes)');
select pg_temp.verifier(position('@' in public.agenda_flux(current_setting('test.jeton'))::text) = 0,
  'rendez_vous : le flux ne contient aucun e-mail');
select pg_temp.verifier(public.agenda_flux(repeat('0', 64)) is null, 'rendez_vous : un jeton inconnu ne donne rien');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(public.agenda_jeton_revoquer(), 'rendez_vous : le jeton se révoque');
select pg_temp.service();
select pg_temp.verifier(public.agenda_flux(current_setting('test.jeton')) is null, 'rendez_vous : un jeton révoqué ne donne plus rien');
select pg_temp.admin();

rollback;
