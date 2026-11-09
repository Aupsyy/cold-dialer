-- Tests de la table leads : la RLS par rôle, l'anti-doublon, l'issue d'un appel (enregistrer_issue), le verrou de l'opposition, la purge.
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

select pg_temp.verifier((select telephone_9 from public.leads where id = 'ca100000-0000-4000-8000-000000000001') = '199000101',
  'leads : les 9 derniers chiffres du numéro sont calculés');

-- La propriétaire et l'appelant de A.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.leads) = 3, 'leads : la propriétaire voit les 3 fiches de A');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.leads) = 2, 'leads : un appelant voit ses fiches et les non attribuées');
select pg_temp.verifier((select count(*) from public.leads where id = 'ca300000-0000-4000-8000-000000000003') = 0, 'leads : jamais la fiche d''un autre appelant');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set notes = 'piratage' where id = 'ca300000-0000-4000-8000-000000000003'$$) = 0,
  'leads : ni la modifier');
select pg_temp.doit_echouer($$update public.leads set assigned_to = 'a4000000-0000-4000-8000-000000000004' where id = 'ca200000-0000-4000-8000-000000000002'$$, '42501',
  'leads : un appelant ne donne pas sa fiche à un autre');
select pg_temp.verifier(pg_temp.lignes($$delete from public.leads where id = 'ca200000-0000-4000-8000-000000000002'$$) = 0, 'leads : un appelant ne supprime rien');
insert into public.leads (entreprise, telephone, assigned_to) values ('Atelier Test A5', '01 99 00 01 05', 'a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.leads where entreprise = 'Atelier Test A5' and workspace_id = 'a0000000-0000-4000-8000-000000000000') = 1,
  'leads : un appelant saisit une fiche à son nom, dans son équipe');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, assigned_to) values ('Atelier Test A6', 'a4000000-0000-4000-8000-000000000004')$$, '42501',
  'leads : pas au nom d''un autre appelant');
select pg_temp.doit_echouer($$insert into public.leads (workspace_id, entreprise) values ('b0000000-0000-4000-8000-000000000000', 'Intrus')$$, '42501',
  'leads : jamais dans l''équipe B');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, siren) values ('Copie', '000000001')$$, '23505',
  'leads : un SIREN déjà présent est refusé (anti-doublon)');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, telephone) values ('Copie du numéro', '+33 1 99 00 01 05')$$, '23505',
  'leads : sans SIREN, le même numéro est un doublon');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, siren) values ('SIREN faux', '12345')$$, '23514',
  'leads : un SIREN a 9 chiffres');
insert into public.leads (entreprise, telephone, assigned_to, created_at, last_activity_at)
  values ('Atelier Test A7', '01 99 00 01 07 poste 3', 'a3000000-0000-4000-8000-000000000003', now() - interval '10 years', now() + interval '10 years');
select pg_temp.verifier((select created_at = now() and last_activity_at is null from public.leads where entreprise = 'Atelier Test A7'),
  'leads : la date de création et la dernière activité d''une fiche sont celles de la base (la purge s''y fie)');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set last_activity_at = now() + interval '10 years' where entreprise = 'Atelier Test A7'$$) = 1
  and (select last_activity_at is null from public.leads where entreprise = 'Atelier Test A7'),
  'leads : et ne se réécrivent pas pour échapper à la purge');

-- Le membre.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set assigned_to = 'a4000000-0000-4000-8000-000000000004' where id = 'ca100000-0000-4000-8000-000000000001'$$) = 1,
  'leads : un membre attribue une fiche');
select pg_temp.doit_echouer($$update public.leads set assigned_to = 'b1000000-0000-4000-8000-000000000001' where id = 'ca100000-0000-4000-8000-000000000001'$$, '23503',
  'leads : jamais à quelqu''un d''une autre équipe');
select pg_temp.verifier(pg_temp.lignes($$delete from public.leads where entreprise = 'Atelier Test A5'$$) = 1,
  'leads : un gestionnaire supprime une fiche');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set assigned_to = null where id = 'ca100000-0000-4000-8000-000000000001'$$) = 1,
  'leads : et la remet dans la file commune');

-- L'autre équipe et le visiteur.
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.leads) = 1, 'leads : B ne voit que sa fiche');
select pg_temp.verifier(pg_temp.lignes($$update public.leads set notes = 'x' where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 0, 'leads : B ne touche pas A');
select pg_temp.verifier(pg_temp.lignes($$delete from public.leads where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 0, 'leads : B ne supprime rien de A');
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.leads$$, '42501', 'leads : rien pour le visiteur');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca100000-0000-4000-8000-000000000001', 'pas_repondu')$$, '42501',
  'leads : enregistrer_issue est fermé au visiteur');

-- L'issue d'un appel, par l'appelant de A.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select public.enregistrer_issue('ca100000-0000-4000-8000-000000000001', 'messagerie', null, now() + interval '2 hours');
select pg_temp.verifier(
  (select statut = 'a_appeler' and tentatives = 1 and rappel_le is not null and assigned_to = 'a3000000-0000-4000-8000-000000000003' and derniere_issue = 'messagerie'
     from public.leads where id = 'ca100000-0000-4000-8000-000000000001'),
  'leads : messagerie = une tentative, le rappel automatique posé, la fiche non attribuée revient à l''appelant');
select public.enregistrer_issue('ca100000-0000-4000-8000-000000000001', 'pas_repondu');
select public.enregistrer_issue('ca100000-0000-4000-8000-000000000001', 'standard');
select pg_temp.verifier((select statut = 'a_appeler' and tentatives = 3 from public.leads where id = 'ca100000-0000-4000-8000-000000000001'),
  'leads : 3 tentatives sur 4 : toujours dans la file');
select public.enregistrer_issue('ca100000-0000-4000-8000-000000000001', 'pas_repondu');
select pg_temp.verifier((select statut = 'injoignable' and tentatives = 4 and rappel_le is null from public.leads where id = 'ca100000-0000-4000-8000-000000000001'),
  'leads : au plafond (reglages.tentatives_max = 4), la fiche passe injoignable');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'a_rappeler')$$, '22023', 'leads : a_rappeler exige une date');
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'a_rappeler', 'Rappeler après le chantier', now() + interval '3 days',
                                '{"objection": "pas-le-temps", "duree_s": 95}');
select pg_temp.verifier((select statut = 'a_rappeler' and objection = 'pas-le-temps' and rappel_le > now() from public.leads where id = 'ca200000-0000-4000-8000-000000000002'),
  'leads : a_rappeler avec sa date et l''objection notée');
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'sous_contrat', null, null, '{"final": true}');
select pg_temp.verifier((select statut from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = 'clos', 'leads : une issue de la config marquée finale clôt la fiche');
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'decideur_absent');
select pg_temp.verifier((select statut from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = 'a_appeler',
  'leads : une issue de la config non finale remet la fiche dans la file');
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'rdv_fixe', 'Diagnostic calé');
select pg_temp.verifier((select statut from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = 'rdv_fixe', 'leads : rdv_fixe');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca300000-0000-4000-8000-000000000003', 'pas_repondu')$$, 'P0002',
  'leads : un appelant ne note pas l''appel d''une fiche d''un autre');
select pg_temp.doit_echouer($$select public.enregistrer_issue('cb100000-0000-4000-8000-000000000001', 'pas_repondu')$$, 'P0002', 'leads : ni d''une fiche de B');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'Pas Répondu')$$, '22023', 'leads : une issue illisible est refusée');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'pas_repondu', null, null, '{"duree_s": -3}')$$, '22023',
  'leads : une durée négative est refusée');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'pas_repondu', null, null, '{"duree_s": "longue"}')$$, '22023',
  'leads : une durée qui n''est pas un nombre est refusée');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'pas_repondu', null, now() + interval '3 years')$$, '22023',
  'leads : un rappel dans 3 ans est refusé');

-- Ne plus contacter : la fiche et ses identifiants entrent dans la liste d'opposition (même un numéro écrit avec du texte).
select public.enregistrer_issue((select id from public.leads where entreprise = 'Atelier Test A7'), 'ne_plus_contacter');
select pg_temp.verifier(public.lead_en_opposition('01 99 00 01 07 poste 3', null),
  'leads : un numéro écrit avec du texte entre quand même dans la liste d''opposition');
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'ne_plus_contacter', 'Demande ferme');
select pg_temp.verifier((select statut from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = 'ne_plus_contacter', 'leads : ne_plus_contacter');
select pg_temp.verifier((select count(*) from public.opposition where siren = '000000002' or tel9 = '199000102') = 2,
  'leads : son SIREN et son numéro entrent dans la liste d''opposition');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'pas_repondu')$$, '23514',
  'leads : plus aucun appel sur une fiche en opposition');
select pg_temp.doit_echouer($$update public.leads set statut = 'a_appeler' where id = 'ca200000-0000-4000-8000-000000000002'$$, '23514',
  'leads : le déclencheur refuse de sortir la fiche de ne_plus_contacter');
select pg_temp.verifier(public.lead_en_opposition('01 99 00 01 02', null), 'leads : lead_en_opposition reconnaît le numéro (9 chiffres)');
select pg_temp.verifier(public.lead_en_opposition(null, '000 000 002'), 'leads : et le SIREN');
select pg_temp.verifier(not public.lead_en_opposition('+33199000199', '000000009'), 'leads : et laisse passer les autres');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, telephone) values ('Réimport', '+33 1 99 00 01 02')$$, '23514',
  'leads : une fiche en opposition ne peut pas être réimportée, même par la propriétaire');
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(not public.lead_en_opposition('01 99 00 01 02', '000000002'),
  'leads : la liste d''opposition de A ne vaut pas pour B');

-- La purge RGPD (clé service seule). Une fiche de B inactive depuis 40 mois, ses appels, un rendez-vous ancien ; un appel récent de A.
select pg_temp.admin();
update public.leads set last_activity_at = now() - interval '40 months' where id = 'cb100000-0000-4000-8000-000000000001';
insert into public.appels (workspace_id, fournisseur, externe_id, lead_id, enregistrement_chemin, created_at) values
  ('b0000000-0000-4000-8000-000000000000', 'onoff', 'appel-ancien', null, 'b0000000-0000-4000-8000-000000000000/onoff/appel-ancien.mp3', now() - interval '40 months'),
  ('b0000000-0000-4000-8000-000000000000', 'onoff', 'appel-b1', 'cb100000-0000-4000-8000-000000000001', null, now() - interval '1 month'),
  ('a0000000-0000-4000-8000-000000000000', 'onoff', 'appel-recent', 'ca100000-0000-4000-8000-000000000001', null, now());
insert into public.rendez_vous (workspace_id, lead_id, debut, source, statut, note) values
  ('b0000000-0000-4000-8000-000000000000', 'cb100000-0000-4000-8000-000000000001', now() - interval '40 months', 'manuel', 'pris', 'Rendez-vous ancien'),
  ('b0000000-0000-4000-8000-000000000000', null, now() - interval '40 months' + interval '10 minutes', 'manuel', 'pris', 'Rendez-vous ancien');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$select public.purger_fiches_inactives(36)$$, '42501', 'leads : la purge est réservée à la clé service');
select pg_temp.service();
select pg_temp.doit_echouer($$select public.purger_fiches_inactives(48)$$, '22023', 'leads : jamais plus de 36 mois de conservation');
select set_config('test.purge', public.purger_fiches_inactives(36)::text, true);
select pg_temp.verifier((current_setting('test.purge')::jsonb ->> 'fiches')::int >= 1 and not exists (select 1 from public.leads where id = 'cb100000-0000-4000-8000-000000000001')
                        and exists (select 1 from public.leads where id = 'ca100000-0000-4000-8000-000000000001'),
  'leads : la purge retire les fiches sans contact depuis 36 mois, et elles seules');
select pg_temp.verifier(
  not exists (select 1 from public.appels where externe_id in ('appel-ancien', 'appel-b1'))
  and exists (select 1 from public.appels where externe_id = 'appel-recent')
  and (current_setting('test.purge')::jsonb -> 'enregistrementsAEffacer') ? 'b0000000-0000-4000-8000-000000000000/onoff/appel-ancien.mp3',
  'leads : elle retire aussi les appels anciens ou liés aux fiches parties, et rend les audios à effacer du bucket');
select pg_temp.verifier(not exists (select 1 from public.rendez_vous where note = 'Rendez-vous ancien'),
  'leads : et les rendez-vous anciens, sans buter sur un chevauchement');
select pg_temp.admin();

rollback;
