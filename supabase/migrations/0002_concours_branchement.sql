-- =================================================================================================================================
-- cold-dialer : migration 0002, le branchement à une session commune (concours d'appels, docs/concours.md).
--
-- Additive et rejouable : elle ne touche aucune table de la migration 0001, et chaque instruction peut être rejouée sans erreur.
-- Elle range, pour l'équipe, l'adresse du service, le code de la session, le pseudo et le JETON rendu par le service quand l'équipe
-- rejoint la session. Le jeton est un secret : il identifie l'équipe auprès du service.
--
-- Qui peut quoi :
--   - anon : rien (ni table ni fonction) ;
--   - authenticated : AUCUN droit sur la table, donc aucune lecture du jeton, même par un gestionnaire, même pour sa propre équipe.
--     Il passe par trois fonctions étroites : concours_poser et concours_retirer (réservées aux gestionnaires : propriétaire et membre),
--     concours_etat (toute l'équipe : l'état SANS le jeton) ;
--   - service_role (clé service, serveur seulement) : concours_jeton_serveur, la seule fonction qui rend le jeton, pour l'envoi des
--     compteurs. La clé service lit aussi la table (elle passe outre la RLS, comme partout dans cette application).
-- Aucune donnée de prospect ici, jamais.
-- =================================================================================================================================

create table if not exists public.concours_branchement (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  url text not null check (
    char_length(url) <= 300
    and (
      url ~ '^https://[^[:space:]?#@/]+(/[^[:space:]?#@]*)?$'
      or url ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/[^[:space:]?#@]*)?$'
    )
    and url !~ '/$'
  ),
  code text not null check (code ~ '^[A-Z0-9]{4,12}$'),
  pseudo text not null check (char_length(btrim(pseudo)) between 1 and 40 and pseudo !~ '[[:cntrl:]]'),
  jeton text not null check (char_length(jeton) between 8 and 512 and jeton ~ '^[!-~]+$'),
  rejoint_le timestamptz not null default now(),
  rejoint_par uuid references public.profiles (id) on delete set null
);
comment on table public.concours_branchement is 'Une ligne par équipe : la session commune rejointe (adresse du service, code, pseudo, jeton). Le jeton est un secret : aucun droit pour anon ni authenticated, seules les fonctions concours_* y touchent.';
comment on column public.concours_branchement.jeton is 'Le jeton rendu par le service. Jamais rendu à un compte connecté : seule concours_jeton_serveur (clé service) le lit.';

-- La contrainte du jeton est reposée à chaque passage : une première version de ce fichier bornait la longueur dans l'expression
-- régulière ({8,512}), ce que PostgreSQL refuse au-delà de 255 ; la longueur est maintenant vérifiée à part.
alter table public.concours_branchement drop constraint if exists concours_branchement_jeton_check;
alter table public.concours_branchement add constraint concours_branchement_jeton_check
  check (char_length(jeton) between 8 and 512 and jeton ~ '^[!-~]+$');

alter table public.concours_branchement enable row level security;
-- Aucune politique et aucun droit pour anon et authenticated : la table n'est lisible que par la clé service et par les fonctions
-- SECURITY DEFINER ci-dessous (comme integrations_evenements).
revoke all on public.concours_branchement from public, anon, authenticated;
grant all on public.concours_branchement to service_role;

-- Un gestionnaire branche l'équipe sur une session (remplace le branchement précédent). Les contraintes de la table revérifient chaque
-- champ (adresse https, code, pseudo, jeton) : une valeur invalide lève 23514.
create or replace function public.concours_poser(p_url text, p_code text, p_pseudo text, p_jeton text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
begin
  if auth.uid() is null or v_workspace is null or not public.est_gestionnaire() then
    raise exception 'Réservé aux gestionnaires.' using errcode = '42501';
  end if;
  insert into public.concours_branchement (workspace_id, url, code, pseudo, jeton, rejoint_le, rejoint_par)
  values (v_workspace, p_url, p_code, btrim(p_pseudo), p_jeton, now(), auth.uid())
  on conflict (workspace_id) do update
    set url = excluded.url, code = excluded.code, pseudo = excluded.pseudo, jeton = excluded.jeton,
        rejoint_le = excluded.rejoint_le, rejoint_par = excluded.rejoint_par;
end;
$$;

-- Un gestionnaire retire le branchement de l'équipe (le jeton est effacé de la base). Vrai s'il y en avait un.
create or replace function public.concours_retirer()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.current_workspace_id() is null or not public.est_gestionnaire() then
    raise exception 'Réservé aux gestionnaires.' using errcode = '42501';
  end if;
  delete from public.concours_branchement where workspace_id = public.current_workspace_id();
  return found;
end;
$$;

-- L'état du branchement de l'équipe, SANS le jeton : { url, code, pseudo, rejoint_le }, ou null si l'équipe n'est pas branchée.
create or replace function public.concours_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('url', c.url, 'code', c.code, 'pseudo', c.pseudo, 'rejoint_le', c.rejoint_le)
      from public.concours_branchement c
     where c.workspace_id = v_workspace
  );
end;
$$;

-- Pour l'envoi des compteurs (clé service seule) : { url, code, jeton } de l'équipe de l'instance (la demandée, sinon la seule équipe,
-- comme workspace_resolu), ou null si elle n'est pas branchée.
create or replace function public.concours_jeton_serveur(p_workspace_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.workspace_resolu(p_workspace_id);
begin
  if v_workspace is null then
    return null;
  end if;
  return (
    select jsonb_build_object('url', c.url, 'code', c.code, 'jeton', c.jeton)
      from public.concours_branchement c
     where c.workspace_id = v_workspace
  );
end;
$$;

-- La version du schéma passe à 2 (lue par /api/sante) : une instance dont la migration 0002 n'est pas jouée l'affiche.
create or replace function public.version_schema()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 2
$$;

-- Droits : PostgreSQL ouvre toute nouvelle fonction à PUBLIC, et Supabase aux rôles de l'API : on ferme d'abord, on ouvre ensuite.
revoke all on function public.concours_poser(text, text, text, text) from public, anon, authenticated;
revoke all on function public.concours_retirer() from public, anon, authenticated;
revoke all on function public.concours_etat() from public, anon, authenticated;
revoke all on function public.concours_jeton_serveur(uuid) from public, anon, authenticated;
revoke all on function public.version_schema() from public, anon;
grant execute on function public.concours_poser(text, text, text, text) to authenticated, service_role;
grant execute on function public.concours_retirer() to authenticated, service_role;
grant execute on function public.concours_etat() to authenticated, service_role;
grant execute on function public.concours_jeton_serveur(uuid) to service_role;
grant execute on function public.version_schema() to authenticated, service_role;

-- L'API relit le schéma tout de suite.
notify pgrst, 'reload schema';
