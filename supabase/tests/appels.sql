-- Tests de la table appels : événements de téléphonie (evenement_appel), audio et transcription gardés seulement si l'enregistrement est
-- activé ET l'annonce lue ou jouée pour CET appel, lecture par l'appelant de l'appel ou les gestionnaires, aucune écriture directe.
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

select pg_temp.verifier(public.normaliser_e164('01 99 00 01 01', 'FR') = '+33199000101', 'appels : un numéro français devient E.164');
select pg_temp.verifier(public.normaliser_e164('0033 1 99 00 01 01', 'FR') = '+33199000101', 'appels : 0033 devient +33');
select pg_temp.verifier(public.normaliser_e164('+33 (0)1 99 00 01 01', null) = '+33199000101', 'appels : le 0 national en trop disparaît');
select pg_temp.verifier(public.normaliser_e164('abc', 'FR') is null and public.normaliser_e164('', 'FR') is null,
  'appels : un numéro illisible donne null');
select pg_temp.verifier(public.tel9('+33 1 99 00 01 01') = '199000101' and public.tel9('12345') is null, 'appels : les 9 derniers chiffres');
select pg_temp.verifier(public.normaliser_e164('02 123 45 67', 'BE') = '+3221234567' and public.normaliser_e164('(514) 555-0100', 'CA') = '+15145550100',
  'appels : les numéros belges et canadiens aussi');
select pg_temp.verifier(public.horodatage_ou_null('pas une date') is null and public.horodatage_ou_null('2030-01-01T10:00:00Z') is not null,
  'appels : une date illisible dans un événement devient null, sans erreur');
select pg_temp.doit_echouer($$select public.workspace_resolu('99999999-0000-4000-8000-000000000000')$$, 'P0002',
  'appels : une équipe désignée qui n''existe pas est refusée');

-- Un appel sortant d'Onoff : l'équipe et l'appelant par son e-mail, la fiche par le numéro.
select pg_temp.service();
select set_config('test.r1', public.evenement_appel(jsonb_build_object(
  'fournisseur', 'onoff', 'externeId', 'appel-1', 'direction', 'sortant', 'statut', 'repondu', 'debut', now() - interval '5 minutes',
  'fin', null, 'dureeS', null, 'numeroExterne', '+33199000102', 'emailAppelant', 'Appelant.A@example.com', 'annonceJouee', false,
  'urlEnregistrement', 'https://example.org/audio-fictif.mp3'))::text, true);
select pg_temp.verifier(
  (current_setting('test.r1')::jsonb ->> 'leadId') = 'ca200000-0000-4000-8000-000000000002' and (current_setting('test.r1')::jsonb ->> 'appelantId') = 'a3000000-0000-4000-8000-000000000003'
  and (current_setting('test.r1')::jsonb ->> 'workspaceId') = 'a0000000-0000-4000-8000-000000000000' and (current_setting('test.r1')::jsonb ->> 'nouveau')::boolean,
  'appels : l''événement retrouve l''équipe et l''appelant (e-mail), la fiche (9 chiffres)');
select pg_temp.verifier(not (current_setting('test.r1')::jsonb ->> 'conserverAudio')::boolean,
  'appels : enregistrement désactivé : rien à garder');
select public.evenement_appel(jsonb_build_object(
  'fournisseur', 'onoff', 'externeId', 'appel-1', 'statut', 'inconnu', 'fin', now(), 'dureeS', 240));
select pg_temp.verifier(
  (select statut = 'repondu' and duree_s = 240 and fin is not null and debut is not null and lead_id = 'ca200000-0000-4000-8000-000000000002'
     from public.appels where externe_id = 'appel-1'),
  'appels : idempotent : « inconnu » n''écrase pas le statut, la fin et la durée complètent la ligne');
select pg_temp.verifier((select count(*) from public.appels where externe_id = 'appel-1') = 1, 'appels : une seule ligne par appel');
select pg_temp.verifier((select last_activity_at = now() from public.leads where id = 'ca200000-0000-4000-8000-000000000002'),
  'appels : un appel vu par le fournisseur compte comme dernière activité de la fiche');
select pg_temp.verifier(not exists (select 1 from public.appels where enregistrement_chemin is not null or numero_externe !~ '^\+'),
  'appels : l''URL de l''audio du fournisseur n''est jamais gardée');
select pg_temp.verifier(
  (public.enregistrement_appel('onoff', 'appel-1', 'a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3') ->> 'raison') = 'enregistrement_non_autorise',
  'appels : enregistrement désactivé : l''audio est refusé');
select pg_temp.verifier(
  not (public.transcription_appel('onoff', 'appel-1', '[{"t": 0, "locuteur": "appelant", "texte": "Bonjour"}]'::jsonb) ->> 'garde')::boolean,
  'appels : et la transcription aussi');

-- L'enregistrement activé ne suffit pas : il faut l'annonce lue à CET appel.
select pg_temp.admin();
update public.reglages set enregistrement_complet = true, annonce_lue_le = now() where workspace_id = 'a0000000-0000-4000-8000-000000000000';
select pg_temp.service();
select pg_temp.verifier(
  (public.enregistrement_appel('onoff', 'appel-1', 'a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3') ->> 'raison') = 'enregistrement_non_autorise',
  'appels : enregistrement activé mais annonce pas lue à cet appel : l''audio est refusé');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.lead_activities (lead_id, type) values ('ca200000-0000-4000-8000-000000000002', 'annonce');
select pg_temp.service();
select pg_temp.verifier((select annonce_lue from public.appels where externe_id = 'appel-1'),
  'appels : l''annonce lue au Poste (activité « annonce ») marque l''appel');
select pg_temp.verifier((public.enregistrement_appel('onoff', 'appel-1', 'a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3') ->> 'garde')::boolean,
  'appels : enregistrement activé et annonce lue : l''audio est gardé');
select pg_temp.verifier(
  (public.enregistrement_appel('onoff', 'appel-1', 'b0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3') ->> 'raison') = 'chemin_refuse',
  'appels : jamais un chemin hors du dossier de l''équipe');
select pg_temp.verifier(
  (public.transcription_appel('onoff', 'appel-1',
     '[{"t": 0, "locuteur": "appelant", "texte": "Bonjour"}, {"t": 2.5, "locuteur": "prospect", "texte": "Oui ?"}]'::jsonb,
     'Résumé fictif') ->> 'lignes')::int = 2,
  'appels : la transcription est gardée (2 lignes), avec son résumé');
select pg_temp.verifier(
  (public.transcription_appel('onoff', 'appel-1', '[{"t": "x", "texte": 1}]'::jsonb) ->> 'raison') = 'transcription_illisible',
  'appels : une transcription mal formée est refusée');
select pg_temp.verifier(
  (public.transcription_appel('onoff', 'appel-1', '[{"locuteur": "appelant"}]'::jsonb) ->> 'raison') = 'transcription_illisible',
  'appels : une ligne sans heure ni texte est refusée (un champ manquant ne passe pas)');
select pg_temp.verifier((public.transcription_appel('onoff', 'appel-1', '[]'::jsonb) ->> 'raison') = 'transcription_vide',
  'appels : une transcription vide n''écrase rien');
select pg_temp.verifier((select resume from public.appels where externe_id = 'appel-1') = 'Résumé fictif',
  'appels : le résumé gardé reste en place');
-- Une annonce ne vaut que pour UN appel : le second appel de la même fiche, quelques minutes plus tard, n'est pas couvert.
select pg_temp.verifier(
  not (public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'appel-6', 'statut', 'repondu',
     'debut', now() - interval '4 minutes', 'numeroExterne', '+33199000102', 'emailAppelant', 'appelant.a@example.com')) ->> 'conserverAudio')::boolean,
  'appels : une annonce déjà rattachée à un appel ne couvre pas l''appel suivant de la même fiche');
select pg_temp.verifier((select appel_id from public.lead_activities where type = 'annonce' and lead_id = 'ca200000-0000-4000-8000-000000000002')
                        = (select id from public.appels where externe_id = 'appel-1'),
  'appels : l''annonce est rattachée à l''appel en cours, et à lui seul');
-- Une annonce antidatée par le navigateur prend l'heure de la base, et couvre l'appel en cours à ce moment-là.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.lead_activities (lead_id, type, cree_le) values ('ca200000-0000-4000-8000-000000000002', 'annonce', now() - interval '1 hour');
select pg_temp.service();
select pg_temp.verifier(not exists (select 1 from public.lead_activities where type = 'annonce' and cree_le <> now()),
  'appels : une annonce ne peut pas être antidatée (heure de la base)');
select public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'appel-6', 'fin', now(), 'dureeS', 240));
select pg_temp.verifier((select annonce_lue from public.appels where externe_id = 'appel-6'),
  'appels : cochée pendant le second appel, elle couvre ce second appel (à l''arrivée de sa fin)');
-- Un appel dont l'appelant n'est pas reconnu n'est jamais couvert par une annonce.
select public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'appel-8', 'statut', 'repondu',
  'debut', now() - interval '1 minute', 'numeroExterne', '+33199000101', 'emailAppelant', 'inconnu@example.com'), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.lead_activities (lead_id, type) values ('ca100000-0000-4000-8000-000000000001', 'annonce');
select pg_temp.service();
select pg_temp.verifier(
  (select appelant_id is null and not annonce_lue from public.appels where externe_id = 'appel-8'),
  'appels : sans appelant reconnu, aucune annonce ne rend l''appel conservable');
select pg_temp.verifier((public.etat_recuperation_appel('onoff', 'appel-1', true) ->> 'tentatives')::int = 1,
  'appels : la récupération différée compte ses tentatives');
select pg_temp.verifier((public.etat_recuperation_appel('onoff', 'inconnu-1') ->> 'existe')::boolean = false,
  'appels : un appel inconnu est signalé comme tel');

-- L'annonce jouée par le fournisseur suffit aussi ; l'e-mail désigne l'équipe ; sans indice et à plusieurs équipes, refus.
select pg_temp.verifier(
  (public.evenement_appel(jsonb_build_object('fournisseur', 'aircall', 'externeId', '9007199254', 'statut', 'repondu', 'debut', now(),
     'numeroExterne', '+33199000101', 'emailAppelant', 'membre.a@example.com', 'annonceJouee', true)) ->> 'conserverAudio')::boolean,
  'appels : annonce jouée par le fournisseur et enregistrement activé : conservable');
select pg_temp.verifier(
  (public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'appel-3', 'statut', 'sans_reponse',
     'numeroExterne', '+33199000104', 'emailAppelant', 'proprietaire.b@example.com')) ->> 'workspaceId') = 'b0000000-0000-4000-8000-000000000000',
  'appels : l''e-mail de l''appelant désigne son équipe (B)');
select pg_temp.admin();
update public.profiles set email_telephonie = 'appelant.a@example.com' where id = 'a2000000-0000-4000-8000-000000000002';
select pg_temp.service();
select pg_temp.verifier(
  (public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'appel-9', 'statut', 'repondu',
     'emailAppelant', 'appelant.a@example.com'), 'a0000000-0000-4000-8000-000000000000') ->> 'appelantId') is null,
  'appels : un e-mail qui désigne deux comptes n''attribue l''appel à personne');
select pg_temp.admin();
update public.profiles set email_telephonie = null where id = 'a2000000-0000-4000-8000-000000000002';
select pg_temp.service();
select pg_temp.doit_echouer($$select public.evenement_appel('{"fournisseur": "onoff", "externeId": "appel-4", "statut": "inconnu"}'::jsonb)$$,
  'P0002', 'appels : plusieurs équipes et aucun indice : refus');
select pg_temp.verifier(
  not (public.evenement_appel('{"fournisseur": "onoff", "externeId": "appel-5", "annonceJouee": "oui"}'::jsonb, 'a0000000-0000-4000-8000-000000000000') ->> 'conserverAudio')::boolean,
  'appels : une annonce « jouée » mal écrite (pas un booléen) compte pour non');
select pg_temp.doit_echouer($$select public.evenement_appel('{"fournisseur": "fax", "externeId": "x"}'::jsonb)$$, '22023',
  'appels : un fournisseur inconnu est refusé');
select pg_temp.doit_echouer($$select public.evenement_appel('{"fournisseur": "onoff", "externeId": "a b"}'::jsonb)$$, '22023',
  'appels : un identifiant illisible est refusé');
select pg_temp.doit_echouer($$select public.evenement_appel('{"fournisseur": "onoff", "externeId": "a5", "dureeS": 999999}'::jsonb, 'a0000000-0000-4000-8000-000000000000')$$,
  '22023', 'appels : une durée hors bornes est refusée');

-- La RLS.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.appels) = 2, 'appels : un appelant voit ses appels, seulement');
select pg_temp.doit_echouer($$select public.evenement_appel('{}'::jsonb)$$, '42501', 'appels : evenement_appel est fermé aux comptes connectés');
select pg_temp.doit_echouer($$select public.enregistrement_appel('onoff', 'appel-1', 'x')$$, '42501',
  'appels : enregistrement_appel aussi');
select pg_temp.doit_echouer($$insert into public.appels (workspace_id, fournisseur, externe_id) values ('a0000000-0000-4000-8000-000000000000', 'onoff', 'faux')$$, '42501',
  'appels : aucune écriture directe');
select pg_temp.doit_echouer($$update public.appels set statut = 'repondu'$$, '42501', 'appels : aucune modification directe');
select pg_temp.verifier(public.enregistrement_lisible('a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3'),
  'appels : l''appelant peut lire l''enregistrement de son appel (bucket privé)');
select pg_temp.connecter('a4000000-0000-4000-8000-000000000004');
select pg_temp.verifier((select count(*) from public.appels) = 0, 'appels : un autre appelant ne voit rien');
select pg_temp.verifier(not public.enregistrement_lisible('a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3'), 'appels : ni l''enregistrement');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.appels) = 6, 'appels : la propriétaire voit les appels de son équipe');
select pg_temp.verifier(public.enregistrement_lisible('a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3'), 'appels : et peut écouter les enregistrements');
select pg_temp.verifier(not public.enregistrement_lisible('a0000000-0000-4000-8000-000000000000/onoff/appel-refuse.mp3'),
  'appels : jamais un fichier du bucket qui n''est rattaché à aucun appel gardé');
-- Un événement sans direction (transcription Aircall, enregistrement Ringover) garde la direction déjà connue de l'appel.
select pg_temp.admin();
select public.evenement_appel(jsonb_build_object('fournisseur', 'aircall', 'externeId', 'appel-dir', 'direction', 'entrant', 'statut', 'repondu'),
  'a0000000-0000-4000-8000-000000000000');
select public.evenement_appel(jsonb_build_object('fournisseur', 'aircall', 'externeId', 'appel-dir', 'statut', 'repondu', 'dureeS', 90),
  'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier((select direction from public.appels where fournisseur = 'aircall' and externe_id = 'appel-dir') = 'entrant',
  'appels : un événement sans direction garde la direction connue (entrant)');
select pg_temp.verifier((select direction from public.appels where fournisseur = 'aircall' and externe_id = 'appel-dir') = 'entrant'
  and (select duree_s from public.appels where fournisseur = 'aircall' and externe_id = 'appel-dir') = 90,
  'appels : le même événement met bien à jour la durée');
-- Le signal d'une transcription Aircall ou d'un enregistrement Ringover porte une direction par défaut (« sortant ») sans aucune donnée
-- d'appel (ni statut, ni dates, ni numéro) : il ne réécrit pas un appel entrant.
select public.evenement_appel(jsonb_build_object('fournisseur', 'aircall', 'externeId', 'appel-dir', 'direction', 'sortant', 'statut', 'inconnu'),
  'a0000000-0000-4000-8000-000000000000');
select pg_temp.verifier((select direction from public.appels where fournisseur = 'aircall' and externe_id = 'appel-dir') = 'entrant',
  'appels : le signal d''une transcription (direction par défaut, sans données d''appel) ne réécrit pas « entrant »');
-- Le fichier d'un enregistrement porte l'identifiant de CET appel : jamais l'audio d'un autre appel rattaché à celui-ci.
select pg_temp.verifier(
  (public.enregistrement_appel('onoff', 'appel-1', 'a0000000-0000-4000-8000-000000000000/onoff/appel-6.mp3') ->> 'raison') = 'chemin_refuse'
  and (select enregistrement_chemin from public.appels where externe_id = 'appel-1') = 'a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3',
  'appels : le fichier d''un autre appel n''est jamais rattaché à celui-ci');

select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.appels) = 1, 'appels : B ne voit que les siens');
select pg_temp.verifier(not public.enregistrement_lisible('a0000000-0000-4000-8000-000000000000/onoff/appel-1.mp3'), 'appels : B n''écoute pas ceux de A');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.appels$$, '42501', 'appels : rien pour le visiteur');
select pg_temp.admin();

rollback;
