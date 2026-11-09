-- Tests de la table opposition (liste STOP) : verrou des fiches concernées, lecture par l'équipe, jamais de retrait par un appelant.
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
insert into public.opposition (telephone, motif, source) values ('+33 1 99 00 01 01', 'Demande par e-mail', 'email');
select pg_temp.verifier((select statut from public.leads where id = 'ca100000-0000-4000-8000-000000000001') = 'ne_plus_contacter',
  'opposition : une entrée passe tout de suite la fiche concernée en ne_plus_contacter');
insert into public.opposition (siren, source) values ('000000003', 'manuel');
select pg_temp.admin();
select pg_temp.verifier((select statut from public.leads where id = 'ca300000-0000-4000-8000-000000000003') = 'ne_plus_contacter',
  'opposition : même une fiche que l''appelant ne voit pas est verrouillée');
select pg_temp.verifier((select statut from public.leads where id = 'ca200000-0000-4000-8000-000000000002') = 'a_appeler', 'opposition : les autres fiches ne bougent pas');

select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((select count(*) from public.opposition) = 4,
  'opposition : toute l''équipe lit la liste (chaque fiche verrouillée y inscrit aussi ses autres identifiants)');
select pg_temp.doit_echouer($$update public.leads set siren = null, telephone = null, statut = 'a_appeler' where id = 'ca100000-0000-4000-8000-000000000001'$$, '23514',
  'opposition : effacer le SIREN et le numéro ne libère pas une fiche verrouillée');
select pg_temp.doit_echouer($$update public.leads set telephone = '+33199000177' where id = 'ca100000-0000-4000-8000-000000000001'$$, '23514',
  'opposition : les identifiants d''une fiche verrouillée sont figés');
select pg_temp.verifier(pg_temp.lignes($$delete from public.opposition$$) = 0, 'opposition : un appelant ne retire jamais une entrée');
select pg_temp.doit_echouer($$update public.opposition set motif = 'x'$$, '42501', 'opposition : une entrée ne se modifie pas');
select pg_temp.doit_echouer($$insert into public.opposition (motif) values ('sans identifiant')$$, '23514',
  'opposition : il faut un SIREN ou un numéro');
select pg_temp.doit_echouer($$insert into public.opposition (siren, cree_par) values ('000000005', 'a1000000-0000-4000-8000-000000000001')$$, '42501',
  'opposition : on l''ajoute à son propre nom');
select pg_temp.doit_echouer($$insert into public.opposition (telephone) values ('01 99 00 01 01')$$, '23505',
  'opposition : pas de doublon d''un numéro (9 derniers chiffres)');

select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier((select count(*) from public.opposition) = 0, 'opposition : B ne voit pas la liste de A');
select pg_temp.verifier((select statut from public.leads where id = 'cb100000-0000-4000-8000-000000000001') = 'a_appeler', 'opposition : les fiches de B ne bougent pas');
insert into public.opposition (telephone) values ('01 99 00 01 01');
select pg_temp.verifier((select count(*) from public.opposition) = 1, 'opposition : chaque équipe tient sa propre liste');

select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, telephone) values ('Réimport sans SIREN', '01 99 00 01 03')$$, '23514',
  'opposition : un STOP par SIREN bloque aussi le numéro de la fiche (réimport sans SIREN)');
select pg_temp.verifier(pg_temp.lignes($$delete from public.opposition where siren = '000000003' or tel9 = '199000103'$$) = 2,
  'opposition : un gestionnaire peut retirer des entrées');
select pg_temp.verifier((select statut from public.leads where id = 'ca300000-0000-4000-8000-000000000003') = 'ne_plus_contacter',
  'opposition : la fiche reste verrouillée tant qu''on ne la rouvre pas à la main');
select pg_temp.doit_echouer($$update public.leads set statut = 'a_appeler' where id = 'ca300000-0000-4000-8000-000000000003'$$, '23514',
  'opposition : retirée de la liste, la fiche ne se rouvre pas pour autant depuis l''application');
select pg_temp.doit_echouer($$update public.leads set statut = 'a_appeler' where id = 'ca100000-0000-4000-8000-000000000001'$$, '23514',
  'opposition : une fiche encore sur la liste ne se rouvre pas');
select pg_temp.admin();
select pg_temp.verifier(pg_temp.lignes($$update public.leads set statut = 'a_appeler' where id = 'ca300000-0000-4000-8000-000000000003'$$) = 1,
  'opposition : retirée de la liste, seul un administrateur de la base la rouvre (SQL Editor)');
select pg_temp.doit_echouer($$update public.leads set statut = 'a_appeler' where id = 'ca100000-0000-4000-8000-000000000001'$$, '23514',
  'opposition : même un administrateur ne rouvre pas une fiche encore sur la liste');

-- Une fiche « ne plus contacter » le reste pour tout compte connecté, même sans aucun identifiant sur la liste.
insert into public.leads (id, workspace_id, entreprise, statut, assigned_to) values
  ('ca400000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Verrou', 'ne_plus_contacter',
   'a3000000-0000-4000-8000-000000000003');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.doit_echouer($$update public.leads set statut = 'a_appeler' where id = 'ca400000-0000-4000-8000-000000000004'$$, '23514',
  'opposition : un appelant ne sort pas une fiche de « ne plus contacter », même sans SIREN ni numéro sur la liste');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$update public.leads set statut = 'a_rappeler', rappel_le = now() where id = 'ca400000-0000-4000-8000-000000000004'$$, '23514',
  'opposition : un gestionnaire non plus');
select pg_temp.doit_echouer($$select public.enregistrer_issue('ca400000-0000-4000-8000-000000000004', 'pas_repondu')$$, '23514',
  'opposition : ni par une issue du Poste');

-- Une fiche sans SIREN ni numéro lisible (« 01 99 00 01 » : 8 chiffres) : « ne plus contacter » inscrit sa clé nom et code postal.
select pg_temp.admin();
insert into public.leads (id, workspace_id, entreprise, telephone, cp, ville) values
  ('ca500000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Sans Numéro', '01 99 00 01', '69001', 'Lyon');
select pg_temp.verifier(public.cle_entreprise('  ATELIER démo, sans-numéro ', '69 001') = 'atelier demo sans numero|69001',
  'opposition : la clé nom et code postal ignore casse, accents, ponctuation et espaces');
select pg_temp.verifier(public.cle_entreprise(' ', '69001') is null, 'opposition : pas de clé sans nom');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier((public.enregistrer_issue('ca500000-0000-4000-8000-000000000005', 'ne_plus_contacter') ->> 'statut') = 'ne_plus_contacter',
  'opposition : l''appelant note « ne plus contacter » sur une fiche sans SIREN ni numéro lisible');
select pg_temp.verifier(
  (select count(*) from public.opposition where cle = 'atelier demo sans numero|69001' and siren is null and source = 'appel') = 1,
  'opposition : sa clé nom et code postal entre sur la liste (une trace durable)');
select pg_temp.verifier(public.lead_en_opposition('01 99 00 01', null, null, 'Atelier Démo Sans Numéro', '69001'),
  'opposition : lead_en_opposition la retrouve par son nom et son code postal');
select pg_temp.doit_echouer($$update public.leads set statut = 'a_appeler' where id = 'ca500000-0000-4000-8000-000000000005'$$, '23514',
  'opposition : l''appelant ne la remet pas dans la file par un PATCH direct');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(pg_temp.lignes($$delete from public.leads where id = 'ca500000-0000-4000-8000-000000000005'$$) = 1,
  'opposition : un gestionnaire supprime la fiche');
select pg_temp.doit_echouer($$insert into public.leads (entreprise, telephone, cp) values ('ATELIER DEMO - Sans numéro', '01 99 00 01', '69001')$$, '23514',
  'opposition : sa recréation (même nom et code postal, toujours sans numéro lisible) est refusée');

-- Une fiche sans SIREN opposée par son numéro (fiche Maps) : un import SIRENE de la même entreprise, avec SIREN et sans numéro, est écarté.
select pg_temp.admin();
insert into public.leads (id, workspace_id, entreprise, telephone, cp) values
  ('ca600000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Maps', '+33199000151', '69002');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select public.enregistrer_issue('ca600000-0000-4000-8000-000000000006', 'ne_plus_contacter');
select pg_temp.verifier((select count(*) from public.opposition where tel9 = '199000151' or cle = 'atelier demo maps|69002') = 2,
  'opposition : une fiche sans SIREN entre avec son numéro ET sa clé nom et code postal');
select pg_temp.service();
select pg_temp.verifier(
  public.identifiants_en_opposition('a0000000-0000-4000-8000-000000000000', '000000097', null, null, public.cle_entreprise('ATELIER DÉMO MAPS', '69002')),
  'opposition : l''import la retrouve par sa clé, même avec un SIREN et sans numéro');
select pg_temp.admin();
select pg_temp.doit_echouer($$insert into public.leads (workspace_id, entreprise, siren, cp) values ('a0000000-0000-4000-8000-000000000000', 'ATELIER DÉMO MAPS', '000000097', '69002')$$,
  '23514', 'opposition : et la base refuse de la recréer « à appeler »');

-- Une fiche AVEC SIREN opposée n'inscrit pas sa clé : un homonyme d'un autre SIREN reste appelable.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select public.enregistrer_issue('ca200000-0000-4000-8000-000000000002', 'ne_plus_contacter');
select pg_temp.verifier((select count(*) from public.opposition where cle = public.cle_entreprise('Atelier Test A2', null)) = 0,
  'opposition : une fiche avec SIREN n''inscrit que son SIREN et ses numéros');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(pg_temp.lignes($$insert into public.leads (entreprise, siren) values ('Atelier Test A2', '000000098')$$) = 1,
  'opposition : un homonyme d''un autre SIREN reste appelable');

-- Une entrée par clé, posée à la main, verrouille tout de suite la fiche concernée et inscrit ses numéros.
select pg_temp.admin();
insert into public.leads (id, workspace_id, entreprise, telephone, cp) values
  ('ca700000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000000', 'Atelier Démo Cascade', '+33199000152', '69003');
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
insert into public.opposition (cle, source) values (public.cle_entreprise('Atelier Démo Cascade', '69003'), 'email');
select pg_temp.admin();
select pg_temp.verifier((select statut from public.leads where id = 'ca700000-0000-4000-8000-000000000007') = 'ne_plus_contacter',
  'opposition : une entrée par clé passe la fiche en ne_plus_contacter');
select pg_temp.verifier((select count(*) from public.opposition where tel9 = '199000152') = 1, 'opposition : et inscrit son numéro');
select pg_temp.doit_echouer($$insert into public.opposition (workspace_id, cle) values ('a0000000-0000-4000-8000-000000000000', 'Pas une clé')$$, '23514',
  'opposition : une clé a la forme de cle_entreprise');

select pg_temp.anonyme();
select pg_temp.doit_echouer($$select * from public.opposition$$, '42501', 'opposition : rien pour le visiteur');
select pg_temp.doit_echouer($$select public.lead_en_opposition('0199000101', null)$$, '42501',
  'opposition : lead_en_opposition est fermé au visiteur');
select pg_temp.service();
select pg_temp.verifier(public.lead_en_opposition('+33199000101', null, 'a0000000-0000-4000-8000-000000000000'),
  'opposition : la clé service vérifie un numéro pour une équipe désignée (import)');
select pg_temp.verifier(not public.lead_en_opposition('+33199000103', '000000003', 'a0000000-0000-4000-8000-000000000000'),
  'opposition : une entrée retirée ne bloque plus');
select pg_temp.admin();

rollback;
