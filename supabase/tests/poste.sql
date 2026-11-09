-- Tests du Poste : chaque écriture des actions serveur du Poste et des prospects (app/_actions) passe la RLS et les déclencheurs comme
-- prévu, sous l'identité d'un appelant puis d'un membre : réserver une fiche au clic sur « Appeler », l'annonce d'enregistrement rattachée à
-- l'appel en cours, le rendez-vous de l'agenda interne (closer par défaut, chevauchement refusé), la saisie manuelle avec sa source (doublon
-- et opposition refusés), l'urgence, les coordonnées, la note, la file de l'appelant, « rendre mes leads », ne_plus_contacter vérifié par
-- lead_en_opposition, l'attribution. Données fictives ; transaction annulée.
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
select pg_temp.verifier(pg_temp.lignes($$update public.leads set assigned_to = 'a3000000-0000-4000-8000-000000000003' where id = 'ca100000-0000-4000-8000-000000000001' and assigned_to is null$$) = 1,
  'reserverFiche : un appelant prend une fiche libre');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set assigned_to = 'a3000000-0000-4000-8000-000000000003' where id = 'ca300000-0000-4000-8000-000000000003' and assigned_to is null$$) = 0,
  'reserverFiche : jamais la fiche d''un collègue');
select pg_temp.verifier((select count(*) from public.leads where id = 'ca300000-0000-4000-8000-000000000003') = 0, 'reserverFiche : la fiche du collègue reste invisible (dejaPrise)');

-- Un appel arrive par le webhook (clé service), l'appelant coche l'annonce pendant l'appel : elle est rattachée à CET appel à l'arrivée
-- de sa fin (jamais une annonce cochée après le raccroché).
select pg_temp.service();
select public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'appel-l1-1', 'direction', 'sortant', 'statut', 'repondu',
  'debut', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'numeroExterne', '+33199000101', 'emailAppelant', 'appelant.a@example.com'));
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.lead_activities (lead_id, type) values ('ca100000-0000-4000-8000-000000000001', 'annonce');
select pg_temp.verifier((select not annonce_lue from public.appels where externe_id = 'appel-l1-1'),
  'noterAnnonceLue : appel en cours (fin inconnue) : rien n''est encore rattaché');
select pg_temp.service();
select public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'appel-l1-1', 'fin', now(), 'dureeS', 60));
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select annonce_lue from public.appels where externe_id = 'appel-l1-1'),
  'noterAnnonceLue : à l''arrivée de la fin, l''annonce cochée pendant l''appel le couvre');
select pg_temp.verifier((select appel_id is not null from public.lead_activities where type = 'annonce' and lead_id = 'ca100000-0000-4000-8000-000000000001'),
  'noterAnnonceLue : l''activité désigne l''appel');

-- Rendez-vous interne (source poste) : closer par défaut, auteur, chevauchement refusé, la fiche connaît son RDV.
insert into public.rendez_vous (lead_id, closer_id, debut, fin, canal, source, statut, note)
values ('ca100000-0000-4000-8000-000000000001', null, now() + interval '2 days', now() + interval '2 days 20 minutes', 'visio', 'poste', 'pris', 'Zone : Lyon');
select pg_temp.verifier((select closer_id = 'a1000000-0000-4000-8000-000000000001' and pris_par = 'a3000000-0000-4000-8000-000000000003' from public.rendez_vous where note = 'Zone : Lyon'),
  'poserRdv : closer par défaut (le propriétaire), pris par l''appelant');
select pg_temp.doit_echouer($$insert into public.rendez_vous (lead_id, debut, fin, canal, source, statut) values ('ca100000-0000-4000-8000-000000000001', now() + interval '2 days 10 minutes', now() + interval '2 days 30 minutes', 'visio', 'poste', 'pris')$$,
  '23P01', 'poserRdv : un chevauchement du closer est refusé (message lisible)');
select pg_temp.verifier((select rdv_le is not null from public.leads where id = 'ca100000-0000-4000-8000-000000000001'), 'poserRdv : la fiche connaît son rendez-vous');
select public.enregistrer_issue('ca100000-0000-4000-8000-000000000001', 'rdv_fixe', 'Zone : Lyon', null, '{"final": true, "duree_s": 95}');
select pg_temp.verifier((select statut = 'rdv_fixe' from public.leads where id = 'ca100000-0000-4000-8000-000000000001'), 'enregistrerIssue : rdv_fixe après le rendez-vous');

-- Saisie manuelle : la fiche et sa source datée ; un doublon est refusé.
insert into public.leads (entreprise, telephone, sources, assigned_to)
values ('Atelier Test L1', '+33199000177', '[{"type": "annuaire", "le": "2026-11-09", "origine": "manuel"}]', 'a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select sources -> 0 ->> 'type' = 'annuaire' from public.leads where entreprise = 'Atelier Test L1'), 'creerProspect : la source datée est gardée');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, telephone) values ('Copie L1', '+33199000177')$$, '23505', 'creerProspect : un doublon (même numéro) est refusé');

-- Urgence, coordonnées et note sur sa fiche.
select pg_temp.verifier(pg_temp.lignes($$update public.leads set qualification = '{"urgent": true}' where entreprise = 'Atelier Test L1'$$) = 1, 'basculerUrgent : écrit');
select pg_temp.verifier((select count(*) from public.leads where qualification ->> 'urgent' = 'true') = 1, 'chargerPoste : le filtre des urgents (qualification->>urgent)');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set dirigeant = 'Lou Démo', sources = sources || '[{"type": "saisie_manuelle", "donnee": "dirigeant", "le": "2026-11-09"}]' where entreprise = 'Atelier Test L1'$$) = 1,
  'modifierContact : coordonnées et trace datée');
insert into public.lead_activities (lead_id, type, note) select id, 'note', 'Préfère le matin' from public.leads where entreprise = 'Atelier Test L1';
select pg_temp.verifier((select count(*) from public.lead_activities la join public.leads l on l.id = la.lead_id where l.entreprise = 'Atelier Test L1' and la.type = 'note') = 1, 'ajouterNote : écrite');

-- La file de l'appelant : ses fiches et les fiches libres, jamais celles d'un collègue.
select pg_temp.verifier((select count(*) from public.leads where statut in ('a_appeler', 'a_rappeler') and (assigned_to = 'a3000000-0000-4000-8000-000000000003' or assigned_to is null)) = 2,
  'chargerPoste : la file de l''appelant (A2 et la fiche saisie ; A1 est en RDV)');

-- Rendre : seulement mes fiches jamais appelées.
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'messagerie', null, now() + interval '1 day', '{"final": false}');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set assigned_to = null where assigned_to = 'a3000000-0000-4000-8000-000000000003' and statut = 'a_appeler' and tentatives = 0 and derniere_issue is null$$) = 1,
  'rendreMesLeads : la fiche jamais appelée revient, pas celle déjà appelée');

-- Ne plus contacter : la base inscrit l'opposition ; lead_en_opposition le confirme ; une ressaisie est refusée par l'opposition.
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'ne_plus_contacter');
select pg_temp.verifier(public.lead_en_opposition('+33199000102', '000000002'), 'enregistrerIssue : ne_plus_contacter alimente l''opposition (vérifié par l''action)');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, telephone) values ('Ressaisie L1', '01 99 00 01 02')$$, '23514', 'creerProspect : une fiche de la liste d''opposition est refusée');

-- Gestionnaire : attribuer à un membre de l'équipe, jamais hors équipe.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set assigned_to = 'a4000000-0000-4000-8000-000000000004' where entreprise = 'Atelier Test L1'$$) = 1, 'attribuerFiche : un membre attribue');
select pg_temp.doit_echouer($$update public.leads set assigned_to = 'b1000000-0000-4000-8000-000000000001' where entreprise = 'Atelier Test L1'$$, '23503', 'attribuerFiche : jamais hors équipe');

-- Deux plafonds de tentatives : celui de la base (reglages.tentatives_max) et celui de la file (config.tentativesMax, passé par le Poste).
-- La base applique le plus bas : une fiche au plafond de la file ne reste jamais « a_appeler » hors de la file.
select pg_temp.admin();
insert into public.leads (id, workspace_id, entreprise, telephone, assigned_to) values
  ('cab00000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Plafond 3', '+33199000161', 'a3000000-0000-4000-8000-000000000003'),
  ('cac00000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Plafond 6', '+33199000162', 'a3000000-0000-4000-8000-000000000003');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select tentatives_max from public.reglages) = 4, 'tentatives : la base est au plafond par défaut (4)');
select public.enregistrer_issue('cab00000-0000-4000-8000-00000000000b', 'pas_repondu', null, null, '{"tentativesMax": 3}');
select public.enregistrer_issue('cab00000-0000-4000-8000-00000000000b', 'messagerie', null, null, '{"tentativesMax": 3}');
select set_config('test.plafond', public.enregistrer_issue('cab00000-0000-4000-8000-00000000000b', 'standard', null, null, '{"tentativesMax": 3}')::text, true);
select pg_temp.verifier(
  (current_setting('test.plafond')::jsonb ->> 'statut') = 'injoignable'
  and (select statut = 'injoignable' and tentatives = 3 from public.leads where id = 'cab00000-0000-4000-8000-00000000000b'),
  'tentatives : file à 3, base à 4 : la troisième tentative passe la fiche injoignable (elle ne reste pas coincée hors de la file)');
select public.enregistrer_issue('cac00000-0000-4000-8000-00000000000c', 'pas_repondu', null, null, '{"tentativesMax": 6}');
select public.enregistrer_issue('cac00000-0000-4000-8000-00000000000c', 'pas_repondu', null, null, '{"tentativesMax": 6}');
select public.enregistrer_issue('cac00000-0000-4000-8000-00000000000c', 'pas_repondu', null, null, '{"tentativesMax": 6}');
select pg_temp.verifier(
  (public.enregistrer_issue('cac00000-0000-4000-8000-00000000000c', 'pas_repondu', null, null, '{"tentativesMax": 6}') ->> 'statut') = 'injoignable',
  'tentatives : file à 6, base à 4 : la base garde son plafond (le plus bas)');
select pg_temp.doit_echouer($$select public.enregistrer_issue('cab00000-0000-4000-8000-00000000000b', 'pas_repondu', null, null, '{"tentativesMax": 0}')$$, '22023',
  'tentatives : un plafond hors de 1 à 10 est refusé');
select pg_temp.doit_echouer($$select public.enregistrer_issue('cab00000-0000-4000-8000-00000000000b', 'pas_repondu', null, null, '{"tentativesMax": 2.5}')$$, '22023',
  'tentatives : un plafond non entier est refusé');
select pg_temp.doit_echouer($$select public.enregistrer_issue('cab00000-0000-4000-8000-00000000000b', 'pas_repondu', null, null, '{"tentativesMax": "3"}')$$, '22023',
  'tentatives : un plafond écrit en texte est refusé');
select pg_temp.admin();

rollback;
