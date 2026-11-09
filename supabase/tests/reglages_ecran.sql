-- Tests de l'écran Réglages : chaque écriture de app/(app)/reglages/actions.ts, rejouée sous la vraie RLS et sous l'identité de
-- l'appelant, du membre puis de la propriétaire : un appelant ne change rien (réglages, invitations, rôles, e-mail de téléphonie,
-- fiches, purge) ; un membre invite un appelant (jeton tiré par la base, 14 jours) mais ne voit ni ne révoque une invitation
-- « propriétaire », ne change pas les rôles ; l'objectif et le plafond ; l'enregistrement refusé sans l'acceptation du cadre légal, puis
-- accepté (date de la base) et désactivé ; la propriétaire change un rôle, retire un compte (ses fiches redeviennent libres), pose et
-- efface un e-mail de téléphonie ; l'effacement d'une fiche (opposition d'abord, appels par la clé service, rendez-vous, retours, fiche ;
-- son journal et ses débriefs partent avec elle ; l'opposition reste et bloque un réimport) ; le comptage de la purge sous la RLS
-- égale ce que purger_fiches_inactives efface (clé service seule). Données fictives ; transaction annulée.
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

-- L'appelant : il lit son profil et les réglages ; il ne change rien d'autre que son nom.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.profiles where id = 'a3000000-0000-4000-8000-000000000003') = 1
  and (select count(*) from public.reglages) = 1, 'chargerReglages : un appelant lit son profil et les réglages de son équipe');
select pg_temp.verifier((select count(*) from public.invitations) = 0, 'chargerReglages : un appelant ne voit aucune invitation (ni jeton)');
select pg_temp.verifier(pg_temp.lignes($$update public.profiles set nom = 'Appelant A (renommé)' where id = 'a3000000-0000-4000-8000-000000000003'$$) = 1,
  'modifierMonNom : chacun change son propre nom');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set objectif_appels_jour = 10 where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 0,
  'modifierObjectif : sans effet pour un appelant');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set tentatives_max = 6 where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 0,
  'alignerTentatives : sans effet pour un appelant');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set annonce_lue_le = now(), enregistrement_complet = true where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 0,
  'activerEnregistrement : sans effet pour un appelant');
select pg_temp.doit_echouer($$insert into public.invitations (role, email) values ('appelant', 'invite.par.appelant@example.com')$$, '42501',
  'creerInvitation : un appelant n''invite personne');
select pg_temp.doit_echouer($$select public.changer_role('a4000000-0000-4000-8000-000000000004', 'membre')$$, '42501', 'changerRole : refusé à un appelant');
select pg_temp.doit_echouer($$select public.retirer_membre('a4000000-0000-4000-8000-000000000004')$$, '42501', 'retirerMembre : refusé à un appelant');
select pg_temp.doit_echouer($$select public.definir_email_telephonie('a3000000-0000-4000-8000-000000000003', 'poste.a3@example.com')$$, '42501',
  'definirEmailTelephonie : refusé à un appelant, même pour lui-même');
select pg_temp.verifier(pg_temp.lignes($$delete from public.leads where id = 'ca200000-0000-4000-8000-000000000002'$$) = 0,
  'effacerFiche : un appelant ne supprime aucune fiche, même la sienne');
select pg_temp.doit_echouer($$select public.purger_fiches_inactives(36)$$, '42501', 'purgerMaintenant : purger_fiches_inactives est fermée aux comptes connectés');
select pg_temp.doit_echouer($$select public.purger_integrations_evenements()$$, '42501', 'purgerMaintenant : purger_integrations_evenements aussi (clé service seule)');

-- La propriétaire crée une invitation « propriétaire » : le membre ne la verra pas.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
insert into public.invitations (role, nom_invite) values ('proprietaire', 'Associée Démo');
select pg_temp.verifier((select count(*) from public.invitations where role = 'proprietaire' and acceptee_le is null) = 1,
  'chargerReglages : la propriétaire voit son invitation « propriétaire » en attente');

-- Le membre.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select pg_temp.verifier((select count(*) from public.profiles) = 4, 'chargerReglages : un gestionnaire lit toute l''équipe');
with i as (insert into public.invitations (role, email, nom_invite) values ('appelant', 'Lou.Demo@example.com', null) returning jeton, expire_le)
select set_config('reglages.invitation', (select (count(*) = 1 and bool_and(jeton ~ '^[0-9a-f]{64}$')
  and bool_and(expire_le between now() + interval '13 days' and now() + interval '15 days'))::text from i), true);
select pg_temp.verifier(current_setting('reglages.invitation') = 'true',
  'creerInvitation : le membre crée une invitation et relit son jeton une fois (tiré par la base, 14 jours)');
select pg_temp.verifier((select count(*) from public.invitations where role = 'proprietaire') = 0,
  'chargerReglages : un membre ne voit pas l''invitation « propriétaire », ni son jeton');
select pg_temp.doit_echouer($$insert into public.invitations (role, nom_invite) values ('proprietaire', 'Autre associé')$$, '42501',
  'creerInvitation : un membre n''invite pas de propriétaire');
select pg_temp.doit_echouer($$insert into public.invitations (role) values ('appelant')$$, '23514', 'creerInvitation : il faut un e-mail ou un nom');
select pg_temp.verifier(pg_temp.lignes($$delete from public.invitations where role = 'proprietaire' and acceptee_le is null$$) = 0,
  'revoquerInvitation : un membre ne révoque pas une invitation « propriétaire »');
select pg_temp.verifier(pg_temp.lignes($$delete from public.invitations where email = 'appelant.a@example.com' and acceptee_le is null$$) = 0,
  'revoquerInvitation : une invitation déjà utilisée ne se révoque pas');
select pg_temp.verifier(pg_temp.lignes($$delete from public.invitations where email = 'lou.demo@example.com' and acceptee_le is null$$) = 1,
  'revoquerInvitation : le membre révoque une invitation en attente');
select public.definir_email_telephonie('a3000000-0000-4000-8000-000000000003', 'Poste.Appelant@example.com');
select pg_temp.verifier((select email_telephonie from public.profiles where id = 'a3000000-0000-4000-8000-000000000003') = 'poste.appelant@example.com',
  'definirEmailTelephonie : un membre pose l''e-mail de téléphonie d''un appelant');
select pg_temp.doit_echouer($$select public.changer_role('a3000000-0000-4000-8000-000000000003', 'membre')$$, '42501', 'changerRole : un membre est refusé');
select pg_temp.doit_echouer($$select public.retirer_membre('a3000000-0000-4000-8000-000000000003')$$, '42501', 'retirerMembre : un membre est refusé');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set objectif_appels_jour = 45 where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 1,
  'modifierObjectif : un membre fixe l''objectif du jour');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set tentatives_max = 6 where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 1,
  'alignerTentatives : un membre aligne le plafond de la base');
select pg_temp.verifier((select tentatives_max from public.reglages) = 6, 'alignerTentatives : le plafond de la base est celui de la configuration');
select pg_temp.doit_echouer($$update public.reglages set enregistrement_complet = true where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$, '23514',
  'activerEnregistrement : refusé sans l''acceptation du cadre légal (annonce_lue_le)');
select pg_temp.verifier(
  pg_temp.lignes($$update public.reglages set annonce_lue_le = '2020-01-01T00:00:00Z', enregistrement_complet = true where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 1,
  'activerEnregistrement : la ligne de l''écran (acceptation et activation en une écriture) passe');
select pg_temp.verifier((select enregistrement_complet and annonce_lue_le = now() from public.reglages),
  'activerEnregistrement : la date d''acceptation est celle de la base, jamais celle du navigateur');
select pg_temp.verifier(pg_temp.lignes($$update public.reglages set enregistrement_complet = false where workspace_id = 'a0000000-0000-4000-8000-000000000000'$$) = 1,
  'desactiverEnregistrement : libre, sans condition');
select pg_temp.verifier((select not enregistrement_complet and annonce_lue_le is not null from public.reglages),
  'desactiverEnregistrement : la date de la dernière acceptation reste');

-- La propriétaire : rôles, retrait, e-mail de téléphonie.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select public.changer_role('a3000000-0000-4000-8000-000000000003', 'membre');
select pg_temp.verifier((select role from public.profiles where id = 'a3000000-0000-4000-8000-000000000003') = 'membre', 'changerRole : la propriétaire change un rôle');
select public.changer_role('a3000000-0000-4000-8000-000000000003', 'appelant');
select pg_temp.doit_echouer($$select public.changer_role('a1000000-0000-4000-8000-000000000001', 'membre')$$, '42501',
  'changerRole : jamais son propre rôle (l''équipe garde un propriétaire)');
select pg_temp.doit_echouer($$select public.retirer_membre('a1000000-0000-4000-8000-000000000001')$$, '42501', 'retirerMembre : jamais soi-même');
select public.retirer_membre('a4000000-0000-4000-8000-000000000004');
select pg_temp.verifier((select count(*) from public.profiles where id = 'a4000000-0000-4000-8000-000000000004') = 0,
  'retirerMembre : la propriétaire retire un compte');
select pg_temp.verifier((select assigned_to is null from public.leads where id = 'ca300000-0000-4000-8000-000000000003'),
  'retirerMembre : ses fiches redeviennent non attribuées');
select pg_temp.doit_echouer($$select public.definir_email_telephonie('a3000000-0000-4000-8000-000000000003', 'proprietaire.a@example.com')$$, '23505',
  'definirEmailTelephonie : jamais l''e-mail d''un autre compte');
select public.definir_email_telephonie('a3000000-0000-4000-8000-000000000003', null);
select pg_temp.verifier((select email_telephonie is null from public.profiles where id = 'a3000000-0000-4000-8000-000000000003'),
  'definirEmailTelephonie : vide, l''e-mail de téléphonie est effacé');

-- L'effacement d'une fiche (A1) : son rendez-vous, un retour, une note, un débrief, un appel rattaché et un appel arrivé sans fiche à
-- son numéro.
insert into public.rendez_vous (lead_id, debut, fin, canal, source, statut) values
  ('ca100000-0000-4000-8000-000000000001', now() + interval '3 days', now() + interval '3 days 20 minutes', 'visio', 'poste', 'pris');
insert into public.retours_marche (lead_id, issue, citation) values ('ca100000-0000-4000-8000-000000000001', 'rdv_fixe', 'On en reparle au diagnostic.');
insert into public.lead_activities (lead_id, type, note) values ('ca100000-0000-4000-8000-000000000001', 'note', 'Rappeler le matin.');
insert into public.debriefs (lead_id, source, extraction) values ('ca100000-0000-4000-8000-000000000001', 'colle', '{"resume": "Intéressé"}');
select pg_temp.service();
select public.evenement_appel(jsonb_build_object('fournisseur', 'onoff', 'externeId', 'reglages-effacement-1', 'direction', 'sortant', 'statut', 'repondu',
  'numeroExterne', '+33199000101'), 'a0000000-0000-4000-8000-000000000000');
select pg_temp.admin();
insert into public.appels (workspace_id, fournisseur, externe_id, lead_id, numero_externe)
values ('a0000000-0000-4000-8000-000000000000', 'aircall', 'reglages-sans-fiche-1', null, '+33199000101');
select pg_temp.verifier((select count(*) from public.appels where lead_id = 'ca100000-0000-4000-8000-000000000001') = 1,
  'effacerFiche (préparation) : un appel rattaché à la fiche, un autre sans fiche à son numéro');

select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
insert into public.opposition (siren, motif, source) values ('000000001', 'Demande d''effacement', 'manuel');
select pg_temp.verifier((select statut from public.leads where id = 'ca100000-0000-4000-8000-000000000001') = 'ne_plus_contacter',
  'effacerFiche : l''opposition inscrite d''abord verrouille la fiche');
select pg_temp.verifier((select count(*) from public.appels where lead_id = 'ca100000-0000-4000-8000-000000000001') = 1,
  'effacerFiche : la propriétaire voit les appels de la fiche (comptage sans clé service)');
select pg_temp.doit_echouer($$delete from public.appels where lead_id = 'ca100000-0000-4000-8000-000000000001'$$, '42501',
  'effacerFiche : un compte connecté n''efface pas les appels : la clé service le fait');
select pg_temp.service();
select pg_temp.verifier(pg_temp.lignes($$delete from public.appels where workspace_id = 'a0000000-0000-4000-8000-000000000000' and lead_id = 'ca100000-0000-4000-8000-000000000001'$$) = 1
  and pg_temp.lignes($$delete from public.appels where workspace_id = 'a0000000-0000-4000-8000-000000000000' and lead_id is null and numero_externe like '%199000101'$$) = 1,
  'effacerFiche : la clé service efface ses appels et l''appel arrivé sans fiche à son numéro');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(pg_temp.lignes($$delete from public.rendez_vous where lead_id = 'ca100000-0000-4000-8000-000000000001'$$) = 1,
  'effacerFiche : son rendez-vous');
select pg_temp.verifier(pg_temp.lignes($$delete from public.retours_marche where lead_id = 'ca100000-0000-4000-8000-000000000001'$$) = 1,
  'effacerFiche : son retour du marché');
select pg_temp.verifier(pg_temp.lignes($$delete from public.leads where id = 'ca100000-0000-4000-8000-000000000001'$$) = 1, 'effacerFiche : la fiche');
select pg_temp.admin();
select pg_temp.verifier((select count(*) from public.lead_activities where lead_id = 'ca100000-0000-4000-8000-000000000001') = 0
  and (select count(*) from public.debriefs where lead_id = 'ca100000-0000-4000-8000-000000000001') = 0,
  'effacerFiche : son journal et ses débriefs sont partis avec elle');
select pg_temp.verifier((select count(*) from public.opposition where workspace_id = 'a0000000-0000-4000-8000-000000000000' and (siren = '000000001' or tel9 = '199000101')) = 2,
  'effacerFiche : l''opposition reste (SIREN et numéro)');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(public.lead_en_opposition('01 99 00 01 01', null), 'effacerFiche : son numéro reste sur la liste d''opposition');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, siren, telephone) values ('Atelier Test A1 (réimport)', '000000001', '+33199000101')$$, '23514',
  'effacerFiche : un réimport de la personne effacée est refusé (statut autre que « ne plus contacter »)');

-- La purge : deux fiches sans activité depuis 40 mois (l'une a un rendez-vous à venir), un vieil appel avec un audio, un vieil événement
-- de webhook. Le comptage de l'écran (sous la RLS du membre) égale ce que la fonction efface.
select pg_temp.admin();
insert into public.leads (id, workspace_id, entreprise, telephone, created_at) values
  ('ca900000-0000-4000-8000-000000000091', 'a0000000-0000-4000-8000-000000000000', 'Atelier Test vieux 1', '+33199000191', now() - interval '40 months'),
  ('ca900000-0000-4000-8000-000000000092', 'a0000000-0000-4000-8000-000000000000', 'Atelier Test vieux 2', '+33199000192', now() - interval '40 months');
insert into public.rendez_vous (workspace_id, lead_id, debut, fin, canal, source, statut) values
  ('a0000000-0000-4000-8000-000000000000', 'ca900000-0000-4000-8000-000000000092', now() + interval '5 days', now() + interval '5 days 20 minutes', 'visio', 'poste', 'pris');
insert into public.appels (workspace_id, fournisseur, externe_id, lead_id, created_at, enregistrement_chemin)
values ('a0000000-0000-4000-8000-000000000000', 'onoff', 'reglages-vieil-appel', 'ca900000-0000-4000-8000-000000000091', now() - interval '40 months',
        'a0000000-0000-4000-8000-000000000000/onoff/reglages-vieil-appel.mp3');
insert into public.integrations_evenements (fournisseur, externe_id, type, recu_le) values ('calendly', 'reglages-vieil-evenement', 'reserve', now() - interval '100 days');

select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select set_config('reglages.fiches', (
    (select count(*) from public.leads
      where last_activity_at < now() - make_interval(months => 36) or (last_activity_at is null and created_at < now() - make_interval(months => 36)))
    - (select count(*) from public.leads
        where id in (select lead_id from public.rendez_vous where lead_id is not null and debut > now() and statut in ('pris', 'confirme'))
          and (last_activity_at < now() - make_interval(months => 36) or (last_activity_at is null and created_at < now() - make_interval(months => 36))))
  )::text, true),
  set_config('reglages.appels', (select count(*) from public.appels where created_at < now() - make_interval(months => 36))::text, true);
select pg_temp.verifier(current_setting('reglages.fiches') = '1' and current_setting('reglages.appels') = '1',
  'compterPurge : sous la RLS du membre, une fiche à purger (l''autre a un rendez-vous à venir) et un vieil appel');
select pg_temp.service();
select set_config('reglages.purge', public.purger_fiches_inactives(36)::text, true),
       set_config('reglages.evenements', public.purger_integrations_evenements()::text, true);
select pg_temp.verifier((current_setting('reglages.purge')::jsonb ->> 'fiches') = current_setting('reglages.fiches')
  and (current_setting('reglages.purge')::jsonb ->> 'appels') = current_setting('reglages.appels'),
  'purgerMaintenant : la purge efface ce que l''écran a compté');
select pg_temp.verifier(current_setting('reglages.purge')::jsonb -> 'enregistrementsAEffacer' = '["a0000000-0000-4000-8000-000000000000/onoff/reglages-vieil-appel.mp3"]'::jsonb,
  'purgerMaintenant : la base rend le chemin de l''audio à effacer du stockage');
select pg_temp.verifier(current_setting('reglages.evenements')::int >= 1, 'purgerMaintenant : le journal des webhooks de plus de 90 jours est vidé');
select pg_temp.admin();
select pg_temp.verifier((select count(*) from public.leads where id = 'ca900000-0000-4000-8000-000000000091') = 0
  and (select count(*) from public.leads where id = 'ca900000-0000-4000-8000-000000000092') = 1,
  'purgerMaintenant : la fiche inactive est partie, celle qui a un rendez-vous à venir reste');
select pg_temp.verifier((select count(*) from public.opposition where siren = '000000001') = 1, 'purgerMaintenant : la liste d''opposition n''est jamais purgée');

rollback;
