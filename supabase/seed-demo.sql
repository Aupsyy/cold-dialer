-- =================================================================================================================================
-- Graine de démonstration : des fiches 100 % FICTIVES pour essayer le Poste sans aucune donnée réelle.
--   - entreprises « Atelier Démo 01 » à « Atelier Démo 40 » (la niche d'exemple : paysage et jardins) ;
--   - numéros dans les plages réservées à la fiction par l'ARCEP : 01 99 00 xx xx (fixes), 06 39 98 xx xx (mobiles) ;
--   - e-mails en @example.com, sites en https://example.org/… (domaines réservés aux exemples, RFC 2606) ;
--   - SIREN 000000001 et suivants, en sautant ceux qui passent la clé de Luhn : aucun ne peut être un vrai SIREN ;
--   - dirigeants « Prénom Démo ».
-- À jouer avec l'URL de la base APRÈS la création du compte propriétaire : les fiches vont dans la seule équipe de l'instance (une
-- « Équipe démo » est créée si la base est vide). Rejouable : une fiche déjà présente n'est pas recréée.
-- Pas de begin ni de commit ici : l'appelant décide (scripts/test-sql.mjs la joue dans une transaction annulée et la vérifie).
-- =================================================================================================================================

do $$
declare
  v_ws uuid := public.workspace_resolu(null);
  v_inserees integer;
begin
  if v_ws is null then
    if exists (select 1 from public.workspaces) then
      raise exception 'Plusieurs équipes sur cette instance : graine de démonstration impossible.' using errcode = '23505';
    end if;
    insert into public.workspaces (nom) values ('Équipe démo') returning id into v_ws;
  end if;

  with numeros as (
    select n, lpad(n::text, 9, '0') as siren from generate_series(1, 120) as n
  ),
  -- Clé de Luhn d'un SIREN : on ne garde que les numéros qui l'échouent (donc impossibles).
  invalides as (
    select m.siren, row_number() over (order by m.n) as i
      from numeros m
     where (select sum(case when (9 - k) % 2 = 1
                            then case when substr(m.siren, k, 1)::int * 2 > 9 then substr(m.siren, k, 1)::int * 2 - 9 else substr(m.siren, k, 1)::int * 2 end
                            else substr(m.siren, k, 1)::int end)
              from generate_series(1, 9) as k) % 10 <> 0
  ),
  fiches as (
    select v.i, v.siren, lpad(v.i::text, 2, '0') as nn,
           (array['Lyon', 'Villeurbanne', 'Grenoble', 'Saint-Étienne', 'Vienne', 'Bron', 'Échirolles', 'Roanne'])[1 + (v.i % 8)::int] as ville,
           (array['69003', '69100', '38000', '42000', '38200', '69500', '38130', '42300'])[1 + (v.i % 8)::int] as cp,
           (array['69', '69', '38', '42', '38', '69', '38', '42'])[1 + (v.i % 8)::int] as departement,
           30 + (v.i * 13) % 70 as score
      from invalides v
     where v.i <= 40
  )
  insert into public.leads (workspace_id, entreprise, siren, siret, naf, forme, date_creation, effectif, metier, ville, cp, departement,
                            dirigeant, telephone, mobile, email, email_source, site, note_google, nb_avis, score, tier, statut, rappel_le,
                            accroche, accroche_source, sources)
  select v_ws,
         'Atelier Démo ' || f.nn,
         f.siren,
         f.siren || '00010',
         '81.30Z',
         (array['SARL', 'SAS', 'SASU', 'EURL'])[1 + (f.i % 4)::int],
         date '2010-01-01' + ((f.i * 97) % 4000)::int,
         (array['1 ou 2 salariés', '3 à 5 salariés', '6 à 9 salariés', '10 à 19 salariés'])[1 + (f.i % 4)::int],
         (array['paysagiste', 'entretien de jardins', 'élagage'])[1 + (f.i % 3)::int],
         f.ville, f.cp, f.departement,
         (array['Camille', 'Alex', 'Sacha', 'Dominique', 'Claude', 'Morgane', 'Yannick', 'Lou'])[1 + (f.i % 8)::int] || ' Démo',
         '+3319900' || lpad(f.i::text, 4, '0'),
         case when f.i % 3 = 0 then '+3363998' || lpad(f.i::text, 4, '0') end,
         case when f.i % 2 = 0 then 'contact' || f.nn || '@example.com' end,
         case when f.i % 2 = 0 then 'https://example.org/atelier-demo-' || f.nn || '/contact' end,
         'https://example.org/atelier-demo-' || f.nn,
         case when f.i % 4 <> 0 then round(3.5 + (f.i % 15) / 10.0, 1) end,
         (f.i * 7) % 60,
         f.score,
         case when f.score >= 70 then 'A' when f.score >= 45 then 'B' else 'C' end,
         case f.i when 5 then 'a_rappeler' when 7 then 'pas_interesse' when 9 then 'rdv_fixe' when 11 then 'ne_plus_contacter' else 'a_appeler' end,
         case when f.i = 5 then now() + interval '1 day' end,
         case when f.i % 5 = 0 then 'Exemple fictif : vos jardins en terrasse sont le type de chantier que vous voulez développer ?' end,
         case when f.i % 5 = 0 then 'https://example.org/atelier-demo-' || f.nn || '/realisations' end,
         jsonb_build_array(jsonb_build_object('type', 'demo', 'le', current_date))
    from fiches f
  on conflict do nothing;
  get diagnostics v_inserees = row_count;

  -- La fiche 11 a demandé à ne plus être appelée : son numéro (fictif) entre dans la liste d'opposition.
  insert into public.opposition (workspace_id, telephone, motif, source)
  values (v_ws, '+33199000011', 'Exemple fictif de demande d''opposition', 'manuel')
  on conflict do nothing;

  insert into public.imports (workspace_id, source, simulation, lues, inserees, doublons)
  values (v_ws, 'demo', false, 40, v_inserees, 40 - v_inserees);
end;
$$;
