-- Tests du branchement à la session commune (migration 0002) : la table n'est ouverte à personne sauf à la clé service (ni lecture ni
-- écriture, pour un compte connecté comme pour le visiteur) ; un gestionnaire (propriétaire ou membre) branche et débranche son équipe
-- par les fonctions concours_poser et concours_retirer, un appelant non ; l'état rendu à l'équipe n'a JAMAIS le jeton ; seule la clé
-- service lit le jeton (concours_jeton_serveur) ; les contraintes refusent une adresse non sécurisée, un code ou un jeton mal formé ;
-- une équipe ne voit rien de l'autre ; remplacer le branchement remplace le jeton. Données fictives ; transaction annulée.
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

-- Au départ : rien n'est branché.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(public.concours_etat() is null, 'concours_etat : null tant que l''équipe n''est pas branchée');
select pg_temp.admin();
select pg_temp.service();
select pg_temp.verifier(public.concours_jeton_serveur() is null, 'concours_jeton_serveur : null tant qu''aucune équipe n''est branchée');
select pg_temp.admin();

-- Un appelant ne branche ni ne débranche rien.
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'ABCD1234', 'Soleil', 'jeton-de-test-0123456789')$$, '42501',
  'concours_poser : refusé à un appelant');
select pg_temp.doit_echouer($$select public.concours_retirer()$$, '42501', 'concours_retirer : refusé à un appelant');
select pg_temp.admin();

-- Rien en direct sur la table, pour personne d'autre que la clé service.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select pg_temp.doit_echouer($$select jeton from public.concours_branchement$$, '42501', 'concours_branchement : le jeton n''est pas lisible, même par la propriétaire');
select pg_temp.doit_echouer($$select * from public.concours_branchement$$, '42501', 'concours_branchement : aucune lecture directe par un compte connecté');
select pg_temp.doit_echouer($$insert into public.concours_branchement (workspace_id, url, code, pseudo, jeton)
  values ('a0000000-0000-4000-8000-000000000000', 'https://example.org', 'ABCD1234', 'Soleil', 'jeton-de-test-0123456789')$$, '42501',
  'concours_branchement : aucune écriture directe par un compte connecté');
select pg_temp.doit_echouer($$select public.concours_jeton_serveur()$$, '42501', 'concours_jeton_serveur : refusée à un compte connecté, même propriétaire');
select pg_temp.admin();

-- Une adresse non sécurisée, un code ou un jeton mal formé, un pseudo vide : refusés par la base.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select pg_temp.doit_echouer($$select public.concours_poser('http://example.org', 'ABCD1234', 'Soleil', 'jeton-de-test-0123456789')$$, '23514',
  'concours_poser : http refusé hors machine locale');
select pg_temp.doit_echouer($$select public.concours_poser('https://u:p@example.org', 'ABCD1234', 'Soleil', 'jeton-de-test-0123456789')$$, '23514',
  'concours_poser : identifiants dans l''adresse refusés');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org/?x=1', 'ABCD1234', 'Soleil', 'jeton-de-test-0123456789')$$, '23514',
  'concours_poser : paramètres dans l''adresse refusés');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org/', 'ABCD1234', 'Soleil', 'jeton-de-test-0123456789')$$, '23514',
  'concours_poser : « / » final refusé (l''application le retire avant)');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'abcd', 'Soleil', 'jeton-de-test-0123456789')$$, '23514', 'concours_poser : code en minuscules refusé');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'AB', 'Soleil', 'jeton-de-test-0123456789')$$, '23514', 'concours_poser : code trop court refusé');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'ABCD1234', '   ', 'jeton-de-test-0123456789')$$, '23514', 'concours_poser : pseudo vide refusé');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'ABCD1234', E'So\nleil', 'jeton-de-test-0123456789')$$, '23514', 'concours_poser : retour à la ligne dans le pseudo refusé');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'ABCD1234', 'Soleil', 'court')$$, '23514', 'concours_poser : jeton trop court refusé');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'ABCD1234', 'Soleil', 'jeton avec espace 0123')$$, '23514', 'concours_poser : jeton avec espace refusé');
select pg_temp.verifier(public.concours_etat() is null, 'concours_poser : une saisie refusée ne laisse rien');
select pg_temp.admin();

-- Un membre branche l'équipe ; l'état n'a jamais le jeton ; toute l'équipe le voit.
select pg_temp.connecter('a2000000-0000-4000-8000-000000000002');
select public.concours_poser('https://example.org', 'ABCD1234', ' Soleil ', 'jeton-de-test-0123456789');
select pg_temp.verifier(public.concours_etat() ->> 'pseudo' = 'Soleil' and public.concours_etat() ->> 'code' = 'ABCD1234'
  and public.concours_etat() ->> 'url' = 'https://example.org', 'concours_poser : un membre branche l''équipe (pseudo nettoyé)');
select pg_temp.verifier(not (public.concours_etat() ? 'jeton') and public.concours_etat()::text !~ 'jeton-de-test', 'concours_etat : le jeton n''est jamais rendu');
select pg_temp.admin();
select pg_temp.connecter('a3000000-0000-4000-8000-000000000003');
select pg_temp.verifier(public.concours_etat() ->> 'pseudo' = 'Soleil' and not (public.concours_etat() ? 'jeton'),
  'concours_etat : un appelant voit l''état de son équipe, sans le jeton');
select pg_temp.admin();

-- L'autre équipe ne voit rien et ne peut rien défaire.
select pg_temp.connecter('b1000000-0000-4000-8000-000000000001');
select pg_temp.verifier(public.concours_etat() is null, 'concours_etat : une équipe ne voit pas le branchement d''une autre');
select pg_temp.verifier(public.concours_retirer() = false, 'concours_retirer : ne touche pas au branchement d''une autre équipe');
select pg_temp.admin();
select pg_temp.verifier((select count(*) from public.concours_branchement) = 1, 'concours_retirer : le branchement de l''équipe A est intact');

-- La clé service seule lit le jeton (une équipe branchée, une autre non : la demande doit nommer l'équipe).
select pg_temp.service();
select pg_temp.verifier(public.concours_jeton_serveur('a0000000-0000-4000-8000-000000000000') ->> 'jeton' = 'jeton-de-test-0123456789'
  and public.concours_jeton_serveur('a0000000-0000-4000-8000-000000000000') ->> 'url' = 'https://example.org',
  'concours_jeton_serveur : la clé service lit le jeton de l''équipe demandée');
select pg_temp.verifier(public.concours_jeton_serveur('b0000000-0000-4000-8000-000000000000') is null, 'concours_jeton_serveur : null pour une équipe non branchée');
select pg_temp.verifier(public.concours_jeton_serveur() is null, 'concours_jeton_serveur : null quand l''instance a plusieurs équipes et qu''aucune n''est nommée');
select pg_temp.admin();
select pg_temp.anonyme();
select pg_temp.doit_echouer($$select public.concours_jeton_serveur('a0000000-0000-4000-8000-000000000000')$$, '42501', 'concours_jeton_serveur : refusée au visiteur');
select pg_temp.doit_echouer($$select public.concours_etat()$$, '42501', 'concours_etat : refusée au visiteur');
select pg_temp.doit_echouer($$select public.concours_poser('https://example.org', 'ABCD1234', 'Soleil', 'jeton-de-test-0123456789')$$, '42501', 'concours_poser : refusée au visiteur');
select pg_temp.doit_echouer($$select * from public.concours_branchement$$, '42501', 'concours_branchement : rien pour le visiteur');
select pg_temp.admin();

-- Rejoindre une autre session remplace le branchement (et le jeton) ; la propriétaire débranche, le jeton disparaît de la base.
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select public.concours_poser('http://localhost:3000', 'ZZZZ9999', 'Lune', 'autre-jeton-9876543210');
select pg_temp.verifier(public.concours_etat() ->> 'code' = 'ZZZZ9999' and public.concours_etat() ->> 'pseudo' = 'Lune', 'concours_poser : remplace le branchement précédent');
select pg_temp.admin();
select pg_temp.verifier((select count(*) from public.concours_branchement where workspace_id = 'a0000000-0000-4000-8000-000000000000') = 1
  and (select jeton from public.concours_branchement where workspace_id = 'a0000000-0000-4000-8000-000000000000') = 'autre-jeton-9876543210',
  'concours_poser : une seule ligne par équipe, avec le nouveau jeton');
select pg_temp.connecter('a1000000-0000-4000-8000-000000000001');
select set_config('test.retire', public.concours_retirer()::text, true);
select pg_temp.verifier(current_setting('test.retire') = 'true', 'concours_retirer : la propriétaire débranche son équipe');
select pg_temp.verifier(public.concours_etat() is null, 'concours_retirer : l''état redevient vide');
select set_config('test.retire', public.concours_retirer()::text, true);
select pg_temp.verifier(current_setting('test.retire') = 'false', 'concours_retirer : rien à retirer la deuxième fois');
select pg_temp.admin();
select pg_temp.verifier((select count(*) from public.concours_branchement) = 0, 'concours_retirer : le jeton est effacé de la base');

-- Le retrait d'une équipe emporte son branchement.
insert into public.concours_branchement (workspace_id, url, code, pseudo, jeton)
  values ('b0000000-0000-4000-8000-000000000000', 'https://example.org', 'ABCD1234', 'Etoile', 'jeton-de-test-b-0123456789');
delete from public.workspaces where id = 'b0000000-0000-4000-8000-000000000000';
select pg_temp.verifier((select count(*) from public.concours_branchement) = 0, 'concours_branchement : supprimée avec son équipe');
select pg_temp.verifier(public.version_schema() = 2, 'version_schema : 2 après la migration 0002');

rollback;
