-- =================================================================================================================================
-- cold-dialer : migration 0001, le schéma complet. Une fois publiée, elle ne se réécrit plus : tout changement passe par une NOUVELLE
-- migration (0002…), avec son test SQL.
--
-- Une équipe par instance. Chaque table porte workspace_id ; la RLS isole les équipes. Trois rôles : proprietaire, membre (les deux
-- « gestionnaires ») et appelant (ses fiches et les fiches non attribuées de la file).
--
-- Accès :
--   - anon (visiteur sans compte) : RIEN, ni table ni fonction ;
--   - authenticated : les tables sous RLS, et les fonctions de l'application (enregistrer_issue, contexte…) ;
--   - service_role (clé service, routes serveur seulement) : les fonctions SECURITY DEFINER des webhooks (evenement_appel,
--     enregistrement_appel, transcription_appel, evenement_agenda…), seules portes d'écriture des intégrations.
-- Chaque fonction a un search_path fixé (public, pg_temp : pg_temp en dernier, aucun objet temporaire ne peut masquer une table).
--
-- Règles pour les migrations suivantes :
--   - toute nouvelle table : RLS activée, politiques « to authenticated », grants explicites, un test supabase/tests/<table>.sql ;
--   - toute nouvelle fonction : « set search_path = public, pg_temp », puis « revoke all on function … from public, anon »
--     (PostgreSQL donne EXECUTE à tout le monde par défaut), puis les grants voulus.
--
-- Données personnelles : aucune donnée de prospect ici. Le journal des intégrations ne garde que des codes (jamais un e-mail, un
-- numéro ni le corps d'un webhook) et se purge à 90 jours.
-- =================================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1) Petits outils purs
-- ---------------------------------------------------------------------------------------------------------------------------------

-- Les 9 derniers chiffres d'un numéro (rapprochement d'une fiche, liste d'opposition), ou null s'il y en a moins de 9.
create or replace function public.tel9(p_numero text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when length(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g')) >= 9
      then right(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), 9)
  end
$$;

-- La clé de repli d'une entreprise sur la liste d'opposition, pour une fiche SANS SIREN : son nom (minuscules, sans accents ni
-- ponctuation) et son code postal, « atelier demo 01|69001 ». Elle survit à la suppression de la fiche et bloque sa recréation, même
-- sans numéro lisible. Null sans nom.
create or replace function public.cle_entreprise(p_entreprise text, p_cp text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when v.nom <> '' then left(v.nom, 200) || '|' || left(regexp_replace(upper(coalesce(p_cp, '')), '[^0-9A-Z]', '', 'g'), 10) end
    from (
      select btrim(regexp_replace(
               lower(translate(replace(replace(replace(replace(coalesce(p_entreprise, ''), 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae'),
                               'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
                               'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy')),
               '[^a-z0-9]+', ' ', 'g')) as nom
    ) v
$$;

-- Un numéro au format E.164 (« +33199000101 »), ou null s'il est illisible. p_pays : FR, BE, CH, LU, MC (préfixe national 0) ou CA
-- (10 chiffres) ; les numéros déjà internationaux (« +… », « 00… ») sont acceptés pour tous les pays.
create or replace function public.normaliser_e164(p_numero text, p_pays text default 'FR')
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := regexp_replace(btrim(coalesce(p_numero, '')), '[[:space:].()/-]', '', 'g');
  v_indicatif text := case upper(coalesce(p_pays, 'FR'))
    when 'FR' then '33' when 'BE' then '32' when 'CH' then '41' when 'LU' then '352' when 'MC' then '377' when 'CA' then '1'
  end;
begin
  if v = '' then
    return null;
  end if;
  if v ~ '^00[1-9]' then
    v := '+' || substr(v, 3);
  elsif v !~ '^\+' then
    if v_indicatif = '1' and v ~ '^1?[2-9][0-9]{9}$' then
      v := '+1' || right(v, 10);
    elsif v_indicatif is not null and v_indicatif <> '1' and v ~ '^0[1-9][0-9]{4,13}$' then
      v := '+' || v_indicatif || substr(v, 2);
    elsif v_indicatif is not null and v ~ ('^' || v_indicatif || '[1-9][0-9]{4,13}$') then
      v := '+' || v;
    else
      return null;
    end if;
  end if;
  -- « +33 0 1 99… » : le 0 national en trop.
  if v ~ '^\+(33|32|41|352|377)0[1-9]' then
    v := regexp_replace(v, '^\+(33|32|41|352|377)0', '+\1');
  end if;
  if v ~ '^\+33' and v !~ '^\+33[1-9][0-9]{8}$' then
    return null;
  end if;
  return case when v ~ '^\+[1-9][0-9]{5,14}$' then v end;
end;
$$;

-- Un jeton secret de 64 caractères hexadécimaux (invitations, flux d'agenda), tiré de gen_random_uuid() (aléa fort de PostgreSQL).
create or replace function public.jeton_aleatoire()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')
$$;

-- Une date lue dans un événement JSON : ISO 8601 entre 2000 et 2100, sinon null (jamais d'erreur, jamais « infinity » ni « now »).
create or replace function public.horodatage_ou_null(p text)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v timestamptz;
begin
  if p is null or length(p) > 40
     or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?$' then
    return null;
  end if;
  v := p::timestamptz;
  return case when v between '2000-01-01'::timestamptz and '2100-01-01'::timestamptz then v end;
exception when others then
  return null;
end;
$$;

-- Un identifiant lu dans un événement JSON : null s'il n'a pas la forme d'un uuid.
create or replace function public.uuid_ou_null(p text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2) L'équipe : workspaces, profiles, invitations, reglages
-- ---------------------------------------------------------------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(btrim(nom)) between 1 and 120),
  fuseau text not null default 'Europe/Paris' check (fuseau ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  pays text not null default 'FR' check (pays ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now()
);
comment on table public.workspaces is 'L''équipe. Une seule par instance (amorcer_workspace) ; workspace_id isole les données de chaque équipe.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  role text not null check (role in ('proprietaire', 'membre', 'appelant')),
  nom text check (nom is null or char_length(btrim(nom)) between 1 and 120),
  email text check (email is null or char_length(email) <= 254),
  email_telephonie text check (
    email_telephonie is null or (char_length(email_telephonie) <= 254 and email_telephonie ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  agenda_jeton_empreinte text unique check (agenda_jeton_empreinte is null or agenda_jeton_empreinte ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_workspace on public.profiles (workspace_id);
create unique index profiles_email_telephonie_unique on public.profiles (lower(email_telephonie)) where email_telephonie is not null;
comment on table public.profiles is 'Un compte (id = auth.users.id), son équipe et son rôle. email_telephonie : l''e-mail du membre chez le fournisseur de téléphonie (rattachement des appels), posé par un gestionnaire (definir_email_telephonie).';

-- Les fonctions d'identité (lisent profiles sans repasser par sa RLS : SECURITY DEFINER, pas de récursion).
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.workspace_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.role_courant()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.est_gestionnaire()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.role_courant() in ('proprietaire', 'membre'), false)
$$;

create or replace function public.est_proprietaire()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.role_courant() = 'proprietaire', false)
$$;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  jeton text not null unique default public.jeton_aleatoire() check (jeton ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('proprietaire', 'membre', 'appelant')),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  nom_invite text check (nom_invite is null or char_length(btrim(nom_invite)) between 1 and 120),
  cree_par uuid default auth.uid() references public.profiles (id) on delete set null,
  expire_le timestamptz not null default now() + interval '14 days',
  acceptee_le timestamptz,
  acceptee_par uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index invitations_workspace on public.invitations (workspace_id, created_at desc);
comment on table public.invitations is 'Les liens d''inscription (/signup?invitation=<jeton>), valables 14 jours. Sans e-mail : la personne choisit le sien.';

create table public.reglages (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  enregistrement_complet boolean not null default false,
  annonce_lue_le timestamptz,
  tentatives_max integer not null default 4 check (tentatives_max between 1 and 10),
  objectif_appels_jour integer not null default 60 check (objectif_appels_jour between 0 and 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint reglages_annonce_avant_enregistrement check (not enregistrement_complet or annonce_lue_le is not null)
);
comment on table public.reglages is 'Une ligne par équipe. enregistrement_complet : audio et transcription gardés (seulement si annonce_lue_le est posé, et si l''annonce a été lue à l''appel).';
comment on column public.reglages.annonce_lue_le is 'Quand un gestionnaire a lu et accepté le cadre légal de l''enregistrement (art. 226-1 du Code pénal, CNIL). Obligatoire pour activer l''enregistrement.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3) La prospection : leads, appels, lead_activities, rendez_vous, opposition, imports
-- ---------------------------------------------------------------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  entreprise text not null check (char_length(btrim(entreprise)) between 1 and 200),
  siren text check (siren is null or siren ~ '^[0-9]{9}$'),
  siret text check (siret is null or siret ~ '^[0-9]{14}$'),
  naf text check (naf is null or naf ~ '^[0-9]{2}\.[0-9]{2}[A-Z]$'),
  forme text check (forme is null or char_length(forme) <= 80),
  date_creation date,
  effectif text check (effectif is null or char_length(effectif) <= 60),
  metier text check (metier is null or char_length(metier) <= 80),
  ville text check (ville is null or char_length(ville) <= 120),
  cp text check (cp is null or cp ~ '^[0-9A-Za-z -]{3,10}$'),
  departement text check (departement is null or departement ~ '^([0-9]{2,3}|2[AB])$'),
  dirigeant text check (dirigeant is null or char_length(dirigeant) <= 160),
  telephone text check (telephone is null or char_length(telephone) <= 30),
  mobile text check (mobile is null or char_length(mobile) <= 30),
  email text check (email is null or char_length(email) <= 254),
  email_source text check (email_source is null or char_length(email_source) <= 500),
  site text check (site is null or (char_length(site) <= 500 and site ~* '^https?://')),
  note_google numeric(2, 1) check (note_google is null or note_google between 0 and 5),
  nb_avis integer check (nb_avis is null or nb_avis >= 0),
  score integer check (score is null or score between 0 and 100),
  tier text check (tier is null or tier in ('A', 'B', 'C')),
  statut text not null default 'a_appeler' check (
    statut in ('a_appeler', 'a_rappeler', 'rdv_fixe', 'pas_interesse', 'hors_cible', 'injoignable', 'clos', 'ne_plus_contacter')
  ),
  objection text check (objection is null or objection ~ '^[a-z][a-z0-9-]{1,39}$'),
  derniere_issue text check (derniere_issue is null or derniere_issue ~ '^[a-z][a-z0-9_]{1,39}$'),
  tentatives integer not null default 0 check (tentatives between 0 and 1000),
  rappel_le timestamptz,
  rdv_le timestamptz,
  assigned_to uuid references public.profiles (id) on delete set null,
  accroche text check (accroche is null or char_length(accroche) <= 300),
  accroche_source text check (accroche_source is null or (char_length(accroche_source) <= 500 and accroche_source ~* '^https?://')),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) <= 8000),
  qualification jsonb not null default '{}'::jsonb check (jsonb_typeof(qualification) = 'object' and pg_column_size(qualification) <= 16000),
  notes text check (notes is null or char_length(notes) <= 10000),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  telephone_9 text generated always as (public.tel9(telephone)) stored,
  mobile_9 text generated always as (public.tel9(mobile)) stored,
  -- La clé anti-doublon : le SIREN, sinon les 9 derniers chiffres du téléphone, sinon « entreprise|code postal ».
  cle_doublon text generated always as (
    coalesce(siren, public.tel9(telephone), lower(btrim(entreprise)) || '|' || coalesce(cp, ''))
  ) stored
);
create unique index leads_siren_unique on public.leads (workspace_id, siren) where siren is not null;
create unique index leads_cle_doublon_unique on public.leads (workspace_id, cle_doublon);
create index leads_file on public.leads (workspace_id, statut, rappel_le);
create index leads_attribution on public.leads (workspace_id, assigned_to);
create index leads_score on public.leads (workspace_id, score desc nulls last);
create index leads_telephone_9 on public.leads (workspace_id, telephone_9) where telephone_9 is not null;
create index leads_mobile_9 on public.leads (workspace_id, mobile_9) where mobile_9 is not null;
create index leads_email on public.leads (workspace_id, lower(email)) where email is not null;
create index leads_cle_entreprise on public.leads (workspace_id, public.cle_entreprise(entreprise, cp));
comment on table public.leads is 'Les fiches prospects. sources : tableau daté [{type, url?, le}] (RGPD). qualification : réponses aux questions du script. Statut « ne_plus_contacter » : jamais quitté depuis l''application, et imposé tant que la fiche est dans opposition.';

create table public.appels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  fournisseur text not null check (fournisseur in ('onoff', 'aircall', 'ringover', 'softphone', 'telephone')),
  externe_id text not null check (externe_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  lead_id uuid references public.leads (id) on delete set null,
  appelant_id uuid references public.profiles (id) on delete set null,
  direction text not null default 'sortant' check (direction in ('sortant', 'entrant')),
  statut text not null default 'inconnu' check (statut in ('repondu', 'sans_reponse', 'occupe', 'messagerie', 'faux_numero', 'inconnu')),
  debut timestamptz,
  fin timestamptz,
  duree_s integer check (duree_s is null or duree_s between 0 and 86400),
  numero_externe text check (numero_externe is null or numero_externe ~ '^\+[1-9][0-9]{5,14}$'),
  annonce_lue boolean not null default false,
  enregistrement_chemin text check (
    enregistrement_chemin is null
    or enregistrement_chemin ~ '^[0-9a-f-]{36}/(onoff|aircall|ringover)/[A-Za-z0-9_.:-]{1,80}\.(mp3|mp4|m4a|wav|ogg|webm)$'
  ),
  transcription jsonb not null default '[]'::jsonb check (jsonb_typeof(transcription) = 'array' and pg_column_size(transcription) <= 400000),
  resume text check (resume is null or char_length(resume) <= 4000),
  tentatives integer not null default 0 check (tentatives between 0 and 1000),
  derniere_tentative timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appels_externe_unique unique (workspace_id, fournisseur, externe_id)
);
create index appels_equipe on public.appels (workspace_id, created_at desc);
create index appels_fiche on public.appels (lead_id, created_at desc);
create index appels_appelant on public.appels (appelant_id, created_at desc);
comment on table public.appels is 'Un appel vu par le fournisseur de téléphonie (webhook). Enregistrement et transcription gardés seulement si reglages.enregistrement_complet ET annonce_lue (annonce jouée par le fournisseur, ou cochée par CET appelant pendant CET appel, jamais après sa fin).';

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  appelant_id uuid default auth.uid() references public.profiles (id) on delete set null,
  type text not null default 'note' check (type in ('appel', 'note', 'rdv', 'statut', 'annonce', 'import')),
  issue text check (issue is null or issue ~ '^[a-z][a-z0-9_]{1,39}$'),
  objection text check (objection is null or objection ~ '^[a-z][a-z0-9-]{1,39}$'),
  statut_apres text,
  rappel_le timestamptz,
  note text check (note is null or char_length(note) <= 5000),
  duree_s integer check (duree_s is null or duree_s between 0 and 86400),
  -- Pour une activité « annonce » : l'appel qu'elle couvre, posé par la base (une annonce ne vaut que pour UN appel).
  appel_id uuid references public.appels (id) on delete set null,
  cree_le timestamptz not null default now()
);
create index lead_activities_fiche on public.lead_activities (lead_id, cree_le desc);
create index lead_activities_equipe on public.lead_activities (workspace_id, cree_le desc);
create index lead_activities_appelant on public.lead_activities (appelant_id, cree_le desc);
comment on table public.lead_activities is 'Le journal d''une fiche. « appel » : écrit par enregistrer_issue seulement. « annonce » : l''appelant a lu l''annonce d''enregistrement pendant l''appel en cours (horodatée par la base, rattachée à un seul appel).';

create table public.rendez_vous (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  closer_id uuid references public.profiles (id) on delete set null,
  pris_par uuid default auth.uid() references public.profiles (id) on delete set null,
  debut timestamptz not null,
  fin timestamptz not null,
  canal text not null default 'visio' check (canal in ('visio', 'telephone', 'sur_place')),
  statut text not null default 'pris' check (statut in ('pris', 'confirme', 'tenu', 'no_show', 'annule', 'reporte')),
  source text not null default 'poste' check (source in ('poste', 'manuel', 'calendly', 'iclosed', 'google')),
  externe_id text check (externe_id is null or externe_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  lien_visio text check (lien_visio is null or (char_length(lien_visio) <= 300 and lien_visio ~* '^https://[^[:space:]]+$')),
  note text check (note is null or char_length(note) <= 5000),
  a_verifier boolean not null default false,
  invite_nom text check (invite_nom is null or char_length(invite_nom) <= 160),
  invite_email text check (invite_email is null or char_length(invite_email) <= 254),
  invite_telephone text check (invite_telephone is null or char_length(invite_telephone) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rendez_vous_duree check (fin > debut and fin <= debut + interval '8 hours'),
  constraint rendez_vous_externe check ((source in ('poste', 'manuel')) = (externe_id is null))
);
create unique index rendez_vous_externe_unique on public.rendez_vous (workspace_id, source, externe_id) where externe_id is not null;
create index rendez_vous_agenda on public.rendez_vous (workspace_id, debut);
create index rendez_vous_closer on public.rendez_vous (closer_id, debut) where statut in ('pris', 'confirme');
create index rendez_vous_fiche on public.rendez_vous (lead_id);
comment on table public.rendez_vous is 'Les rendez-vous : pris au Poste, ou reçus de Calendly, iClosed, Google (evenement_agenda). a_verifier : aucune fiche retrouvée.';

create table public.opposition (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  siren text check (siren is null or siren ~ '^[0-9]{9}$'),
  telephone text check (telephone is null or telephone ~ '^\+?[0-9 .()-]{6,30}$'),
  tel9 text generated always as (public.tel9(telephone)) stored,
  -- La clé de repli d'une fiche opposée sans SIREN (cle_entreprise : nom et code postal).
  cle text check (cle is null or (char_length(cle) <= 220 and cle ~ '^[a-z0-9][a-z0-9 ]*\|[0-9A-Z]*$')),
  motif text check (motif is null or char_length(motif) <= 300),
  -- Le canal de la demande (au téléphone, à l'import, saisie à la main, reçue par e-mail), pas un type d'identifiant.
  source text not null default 'manuel' check (source in ('appel', 'import', 'manuel', 'email')),
  cree_par uuid default auth.uid() references public.profiles (id) on delete set null,
  cree_le timestamptz not null default now(),
  constraint opposition_identifiant check (siren is not null or public.tel9(telephone) is not null or cle is not null)
);
create unique index opposition_siren_unique on public.opposition (workspace_id, siren) where siren is not null;
create unique index opposition_tel9_unique on public.opposition (workspace_id, tel9) where tel9 is not null;
create unique index opposition_cle_unique on public.opposition (workspace_id, cle) where cle is not null;
comment on table public.opposition is 'La liste STOP : un SIREN, un numéro (rapproché par ses 9 derniers chiffres) ou, pour une fiche sans SIREN, la clé nom et code postal. Bloque les fiches concernées (statut ne_plus_contacter) et tout réimport ou recréation.';

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  cree_par uuid default auth.uid() references public.profiles (id) on delete set null,
  source text not null check (source in ('sirene', 'maps', 'csv', 'manuel', 'demo')),
  simulation boolean not null default true,
  lues integer not null default 0 check (lues >= 0),
  inserees integer not null default 0 check (inserees >= 0),
  mises_a_jour integer not null default 0 check (mises_a_jour >= 0),
  doublons integer not null default 0 check (doublons >= 0),
  exclues_opposition integer not null default 0 check (exclues_opposition >= 0),
  rejetees integer not null default 0 check (rejetees >= 0),
  created_at timestamptz not null default now()
);
create index imports_workspace on public.imports (workspace_id, created_at desc);
comment on table public.imports is 'Le journal des imports de fiches : des compteurs seulement, jamais une ligne du fichier.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4) Ce qu'on tire des appels : debriefs, retours_marche, integrations_evenements
-- ---------------------------------------------------------------------------------------------------------------------------------

create table public.debriefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  appel_id uuid references public.appels (id) on delete set null,
  appelant_id uuid default auth.uid() references public.profiles (id) on delete set null,
  source text not null default 'colle' check (source in ('colle', 'fichier', 'appel', 'notes_mac')),
  transcription text check (transcription is null or char_length(transcription) <= 200000),
  extraction jsonb not null default '{}'::jsonb check (jsonb_typeof(extraction) = 'object' and pg_column_size(extraction) <= 64000),
  mots_cles text[] not null default '{}' check (cardinality(mots_cles) <= 50 and array_position(mots_cles, null) is null),
  appel_le timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index debriefs_fiche on public.debriefs (lead_id, created_at desc);
create index debriefs_equipe on public.debriefs (workspace_id, created_at desc);
comment on table public.debriefs is 'Le débrief d''un appel : la transcription, ce qu''on en a extrait (extraction, selon config.debrief.champs) et des mots-clés.';

create table public.retours_marche (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  debrief_id uuid references public.debriefs (id) on delete set null,
  appelant_id uuid default auth.uid() references public.profiles (id) on delete set null,
  appel_le timestamptz not null default now(),
  issue text check (issue is null or issue ~ '^[a-z][a-z0-9_]{1,39}$'),
  douleur text check (douleur is null or char_length(douleur) <= 400),
  objection_code text check (objection_code is null or objection_code ~ '^[a-z][a-z0-9-]{1,39}$'),
  objection_texte text check (objection_texte is null or char_length(objection_texte) <= 400),
  accroche_verdict text check (accroche_verdict is null or accroche_verdict in ('accroche', 'neutre', 'rejet')),
  interet integer check (interet is null or interet between 0 and 3),
  decideur_joint boolean not null default false,
  citation text check (citation is null or char_length(citation) <= 300),
  tags text[] not null default '{}' check (cardinality(tags) <= 10 and array_position(tags, null) is null and char_length(array_to_string(tags, ',')) <= 400),
  created_at timestamptz not null default now()
);
create index retours_marche_equipe on public.retours_marche (workspace_id, appel_le);
create index retours_marche_appelant on public.retours_marche (appelant_id, appel_le);
comment on table public.retours_marche is 'Ce que dit le marché après un appel décroché : douleur, objection, verdict de l''accroche, intérêt de 0 à 3, citation courte (jamais un nom ni un numéro), tags.';

create table public.integrations_evenements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  fournisseur text not null check (fournisseur ~ '^[a-z][a-z0-9_]{1,30}$'),
  externe_id text not null check (externe_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  type text not null check (type ~ '^[A-Za-z0-9_.:-]{1,60}$'),
  resultat text check (resultat is null or resultat ~ '^[a-z_]{1,40}$'),
  lead_id uuid references public.leads (id) on delete set null,
  rendez_vous_id uuid references public.rendez_vous (id) on delete set null,
  recu_le timestamptz not null default now(),
  constraint integrations_evenements_unique unique (fournisseur, externe_id)
);
create index integrations_evenements_recu on public.integrations_evenements (recu_le);
comment on table public.integrations_evenements is 'Idempotence des webhooks : un (fournisseur, externe_id) n''est traité qu''une fois. Des codes seulement ; purge à 90 jours.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5) Fonctions d'accès et de rapprochement
-- ---------------------------------------------------------------------------------------------------------------------------------

-- Une fiche visible par la personne connectée : de son équipe, et (gestionnaire, ou fiche à elle, ou fiche non attribuée).
create or replace function public.lead_visible(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.leads l
     where l.id = p_lead_id
       and l.workspace_id = public.current_workspace_id()
       and (public.est_gestionnaire() or l.assigned_to is null or l.assigned_to = auth.uid())
  )
$$;

-- Le contexte de la personne connectée en un aller-retour (lib/server/contexte.ts) : { uid, workspace_id, role, nom }.
create or replace function public.contexte()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('uid', auth.uid(), 'workspace_id', p.workspace_id, 'role', p.role, 'nom', p.nom)
    from (select 1) x
    left join public.profiles p on p.id = auth.uid()
$$;

-- L'équipe d'une écriture venue d'un webhook : celle demandée (elle doit exister), sinon LA seule équipe de l'instance, sinon null.
create or replace function public.workspace_resolu(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_nombre integer;
begin
  if p_workspace_id is not null then
    select w.id into v_id from public.workspaces w where w.id = p_workspace_id;
    if v_id is null then
      raise exception 'Équipe inconnue.' using errcode = 'P0002';
    end if;
    return v_id;
  end if;
  select count(*), (array_agg(w.id))[1] into v_nombre, v_id from public.workspaces w;
  return case when v_nombre = 1 then v_id end;
end;
$$;

-- Le closer par défaut d'une équipe : son propriétaire le plus ancien.
create or replace function public.closer_par_defaut(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id from public.profiles p
   where p.workspace_id = p_workspace_id and p.role = 'proprietaire'
   order by p.created_at, p.id
   limit 1
$$;

-- La fiche d'une équipe qui porte ce numéro (téléphone ou mobile, par les 9 derniers chiffres), la plus récemment travaillée d'abord.
create or replace function public.rattacher_fiche(p_numero text, p_workspace_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid := public.workspace_resolu(p_workspace_id);
  v_tel9 text := public.tel9(p_numero);
  v_id uuid;
begin
  if v_ws is null or v_tel9 is null then
    return null;
  end if;
  select l.id into v_id
    from public.leads l
   where l.workspace_id = v_ws and (l.telephone_9 = v_tel9 or l.mobile_9 = v_tel9)
   order by l.last_activity_at desc nulls last, l.created_at desc
   limit 1;
  return v_id;
end;
$$;

-- Vrai si ce numéro, ce SIREN ou, sans SIREN, cette entreprise (nom et code postal : cle_entreprise) est sur la liste d'opposition de
-- l'équipe (la personne connectée : la sienne ; la clé service ou un script : p_workspace_id, sinon la seule équipe de l'instance).
create or replace function public.lead_en_opposition(
  p_telephone text,
  p_siren text,
  p_workspace_id uuid default null,
  p_entreprise text default null,
  p_cp text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
  v_siren text := nullif(regexp_replace(coalesce(p_siren, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is not null then
    v_ws := public.current_workspace_id();
  else
    v_ws := public.workspace_resolu(p_workspace_id);
  end if;
  if v_ws is null then
    return false;
  end if;
  return public.identifiants_en_opposition(v_ws, v_siren, p_telephone, null, public.cle_entreprise(p_entreprise, p_cp));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6) Déclencheurs
-- ---------------------------------------------------------------------------------------------------------------------------------

-- Inscription : un compte n'est créé qu'avec une invitation valide (jeton existant, non expiré, non utilisé ; même e-mail si
-- l'invitation en porte un). Sinon la base refuse : Supabase annule la création du compte. Vaut aussi pour « Add user » du tableau de
-- bord de Supabase : on passe toujours par une invitation (amorcer_workspace pour la première). Une invitation d'amorçage (propriétaire,
-- sans auteur) ne sert plus dès que l'équipe a un propriétaire : un ancien lien d'installation resté dans un terminal, une conversation
-- ou un journal ne donne jamais un second propriétaire.
create or replace function public.gerer_nouvel_utilisateur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jeton text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'jeton_invitation', '')), '');
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_nom text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nom', '')), '');
  v_invitation public.invitations%rowtype;
begin
  if v_jeton is null then
    raise exception 'Inscription refusée : accès sur invitation uniquement.' using errcode = '42501';
  end if;
  -- « for update » : un même jeton ne sert jamais deux fois, même avec deux inscriptions simultanées.
  select i.* into v_invitation
    from public.invitations i
   where i.jeton = v_jeton
     and i.acceptee_le is null
     and i.expire_le > now()
     and (i.email is null or lower(i.email) = v_email)
   for update;
  if not found or v_email = '' then
    -- Message générique : aucune donnée personnelle dans les journaux.
    raise exception 'Inscription refusée : invitation invalide, expirée, déjà utilisée ou prévue pour un autre e-mail.' using errcode = '42501';
  end if;
  if v_invitation.role = 'proprietaire' and v_invitation.cree_par is null then
    -- L'équipe verrouillée : deux liens d'amorçage acceptés en même temps ne donnent pas deux propriétaires.
    perform 1 from public.workspaces w where w.id = v_invitation.workspace_id for update;
    if exists (select 1 from public.profiles p where p.workspace_id = v_invitation.workspace_id and p.role = 'proprietaire') then
      raise exception 'Inscription refusée : invitation invalide, expirée, déjà utilisée ou prévue pour un autre e-mail.' using errcode = '42501';
    end if;
  end if;

  insert into public.profiles (id, workspace_id, role, nom, email)
  values (new.id, v_invitation.workspace_id, v_invitation.role, left(coalesce(v_nom, btrim(v_invitation.nom_invite)), 120), v_email);

  update public.invitations
     set acceptee_le = now(), acceptee_par = new.id, email = coalesce(email, v_email)
   where id = v_invitation.id;
  return new;
end;
$$;

create trigger profiles_depuis_invitation
  after insert on auth.users
  for each row execute function public.gerer_nouvel_utilisateur();

-- Un changement d'e-mail dans Supabase Auth est recopié dans le profil (affichage de l'équipe, rattachement des rendez-vous).
create or replace function public.synchroniser_email_profil()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger profiles_email_synchro
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.synchroniser_email_profil();

-- Un compte ne change jamais lui-même son équipe, son rôle ni ses e-mails (les fonctions prévues le font, sous le rôle propriétaire de la
-- base). SECURITY INVOKER : current_user est celui de la requête.
create or replace function public.profiles_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.id is distinct from old.id
          or new.workspace_id is distinct from old.workspace_id
          or new.role is distinct from old.role
          or new.email is distinct from old.email
          or new.email_telephonie is distinct from old.email_telephonie
          or new.agenda_jeton_empreinte is distinct from old.agenda_jeton_empreinte) then
    raise exception 'Équipe, rôle et e-mails ne se changent que par les fonctions prévues.' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_proteger
  before update on public.profiles
  for each row execute function public.profiles_proteger();

-- Une invitation créée depuis l'application reçoit TOUJOURS un jeton tiré par la base (jamais un jeton choisi par le navigateur).
create or replace function public.invitations_avant_insertion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.jeton := public.jeton_aleatoire();
    new.acceptee_le := null;
    new.acceptee_par := null;
    new.created_at := now();
  end if;
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.nom_invite := nullif(btrim(coalesce(new.nom_invite, '')), '');
  if new.email is null and new.nom_invite is null then
    raise exception 'Une invitation porte un e-mail ou un nom.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invitations_avant_insertion
  before insert on public.invitations
  for each row execute function public.invitations_avant_insertion();

-- Chaque équipe a sa ligne de réglages dès sa création.
create or replace function public.workspaces_creer_reglages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.reglages (workspace_id) values (new.id) on conflict (workspace_id) do nothing;
  return new;
end;
$$;

create trigger workspaces_creer_reglages
  after insert on public.workspaces
  for each row execute function public.workspaces_creer_reglages();

create or replace function public.reglages_toucher()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.workspace_id := old.workspace_id;
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- La date d'acceptation du cadre légal est celle de la base, jamais une date envoyée par le navigateur.
  if current_user in ('authenticated', 'anon') and new.annonce_lue_le is not null
     and new.annonce_lue_le is distinct from old.annonce_lue_le then
    new.annonce_lue_le := now();
  end if;
  return new;
end;
$$;

create trigger reglages_toucher
  before update on public.reglages
  for each row execute function public.reglages_toucher();

-- updated_at à jour ; identifiant et date de création figés.
create or replace function public.toucher()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger leads_toucher before update on public.leads for each row execute function public.toucher();

-- Depuis l'application, la date de création et la « dernière activité » d'une fiche sont celles de la base (la purge RGPD s'y fie).
create or replace function public.leads_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_at := now();
      new.last_activity_at := null;
    else
      new.last_activity_at := old.last_activity_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_proteger before insert or update on public.leads for each row execute function public.leads_proteger();
create trigger appels_toucher before update on public.appels for each row execute function public.toucher();
create trigger debriefs_toucher before update on public.debriefs for each row execute function public.toucher();

-- Un débrief tiré d'un appel désigne cet appel, et ne garde sa transcription que si l'appel l'autorise (enregistrement activé et annonce
-- lue ou jouée pour cet appel). Une transcription collée ou venue d'un fichier reste sous la responsabilité de l'équipe (docs/legal.md).
create or replace function public.debriefs_verifier_appel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'appel' and new.appel_id is null then
    raise exception 'Un débrief tiré d''un appel désigne cet appel.' using errcode = '23514';
  end if;
  if new.appel_id is not null and new.transcription is not null
     and (tg_op = 'INSERT' or new.appel_id is distinct from old.appel_id or new.transcription is distinct from old.transcription)
     and not public.appel_conservable(new.appel_id) then
    raise exception 'Cet appel n''autorise pas à garder sa transcription (enregistrement désactivé ou annonce non lue).' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger debriefs_verifier_appel before insert or update on public.debriefs for each row execute function public.debriefs_verifier_appel();

-- Un lien vers une autre table reste DANS la même équipe : sinon refus, avec le même message que la ligne existe ou non (on ne révèle
-- rien d'une autre équipe). Arguments : (table référencée, colonne de la ligne modifiée).
create or replace function public.verifier_meme_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table text := tg_argv[0];
  v_colonne text := tg_argv[1];
  v_ref uuid;
  v_ws uuid;
begin
  v_ref := public.uuid_ou_null(to_jsonb(new) ->> v_colonne);
  if v_ref is null then
    return new;
  end if;
  if v_table not in ('leads', 'profiles', 'appels', 'debriefs', 'rendez_vous') then
    raise exception 'verifier_meme_workspace : table non prévue (%)', v_table using errcode = '22023';
  end if;
  execute format('select workspace_id from public.%I where id = $1', v_table) into v_ws using v_ref;
  if v_ws is null or v_ws is distinct from new.workspace_id then
    raise exception 'Lien refusé : %.% doit désigner une ligne de la même équipe.', tg_table_name, v_colonne using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger leads_meme_workspace_attribution before insert or update of workspace_id, assigned_to on public.leads
  for each row execute function public.verifier_meme_workspace('profiles', 'assigned_to');
create trigger invitations_meme_workspace_auteur before insert or update of workspace_id, cree_par on public.invitations
  for each row execute function public.verifier_meme_workspace('profiles', 'cree_par');
create trigger lead_activities_meme_workspace_fiche before insert or update of workspace_id, lead_id on public.lead_activities
  for each row execute function public.verifier_meme_workspace('leads', 'lead_id');
create trigger lead_activities_meme_workspace_appelant before insert or update of workspace_id, appelant_id on public.lead_activities
  for each row execute function public.verifier_meme_workspace('profiles', 'appelant_id');
create trigger lead_activities_meme_workspace_appel before insert or update of workspace_id, appel_id on public.lead_activities
  for each row execute function public.verifier_meme_workspace('appels', 'appel_id');
create trigger rendez_vous_meme_workspace_fiche before insert or update of workspace_id, lead_id on public.rendez_vous
  for each row execute function public.verifier_meme_workspace('leads', 'lead_id');
create trigger rendez_vous_meme_workspace_closer before insert or update of workspace_id, closer_id on public.rendez_vous
  for each row execute function public.verifier_meme_workspace('profiles', 'closer_id');
create trigger rendez_vous_meme_workspace_auteur before insert or update of workspace_id, pris_par on public.rendez_vous
  for each row execute function public.verifier_meme_workspace('profiles', 'pris_par');
create trigger appels_meme_workspace_fiche before insert or update of workspace_id, lead_id on public.appels
  for each row execute function public.verifier_meme_workspace('leads', 'lead_id');
create trigger appels_meme_workspace_appelant before insert or update of workspace_id, appelant_id on public.appels
  for each row execute function public.verifier_meme_workspace('profiles', 'appelant_id');
create trigger debriefs_meme_workspace_fiche before insert or update of workspace_id, lead_id on public.debriefs
  for each row execute function public.verifier_meme_workspace('leads', 'lead_id');
create trigger debriefs_meme_workspace_appel before insert or update of workspace_id, appel_id on public.debriefs
  for each row execute function public.verifier_meme_workspace('appels', 'appel_id');
create trigger debriefs_meme_workspace_appelant before insert or update of workspace_id, appelant_id on public.debriefs
  for each row execute function public.verifier_meme_workspace('profiles', 'appelant_id');
create trigger retours_marche_meme_workspace_fiche before insert or update of workspace_id, lead_id on public.retours_marche
  for each row execute function public.verifier_meme_workspace('leads', 'lead_id');
create trigger retours_marche_meme_workspace_debrief before insert or update of workspace_id, debrief_id on public.retours_marche
  for each row execute function public.verifier_meme_workspace('debriefs', 'debrief_id');
create trigger retours_marche_meme_workspace_appelant before insert or update of workspace_id, appelant_id on public.retours_marche
  for each row execute function public.verifier_meme_workspace('profiles', 'appelant_id');
create trigger integrations_evenements_meme_workspace_fiche before insert or update of workspace_id, lead_id on public.integrations_evenements
  for each row execute function public.verifier_meme_workspace('leads', 'lead_id');
create trigger integrations_evenements_meme_workspace_rdv before insert or update of workspace_id, rendez_vous_id on public.integrations_evenements
  for each row execute function public.verifier_meme_workspace('rendez_vous', 'rendez_vous_id');
create trigger opposition_meme_workspace_auteur before insert or update of workspace_id, cree_par on public.opposition
  for each row execute function public.verifier_meme_workspace('profiles', 'cree_par');
create trigger imports_meme_workspace_auteur before insert or update of workspace_id, cree_par on public.imports
  for each row execute function public.verifier_meme_workspace('profiles', 'cree_par');

-- Vrai si l'un de ces identifiants (SIREN, numéros comparés par leurs 9 derniers chiffres, clé nom et code postal) est sur la liste
-- d'opposition de l'équipe.
create or replace function public.identifiants_en_opposition(
  p_workspace_id uuid,
  p_siren text,
  p_telephone text,
  p_mobile text,
  p_cle text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.opposition o
     where o.workspace_id = p_workspace_id
       and ((p_siren is not null and o.siren = p_siren)
            or (o.tel9 is not null and o.tel9 in (public.tel9(p_telephone), public.tel9(p_mobile)))
            or (p_cle is not null and o.cle = p_cle))
  )
$$;

-- Inscrit les identifiants d'une fiche sur la liste d'opposition (SIREN, numéros tels quels, en chiffres : leurs 9 derniers chiffres
-- sont ceux de la fiche ; sans SIREN, la clé nom et code postal, qui reste même sans numéro lisible). Ce qui y est déjà est ignoré.
create or replace function public.opposition_inscrire(
  p_workspace_id uuid,
  p_siren text,
  p_numeros text[],
  p_cle text,
  p_source text,
  p_cree_par uuid,
  p_motif text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_numero text;
begin
  if p_siren is not null then
    insert into public.opposition (workspace_id, siren, motif, source, cree_par)
    values (p_workspace_id, p_siren, p_motif, p_source, p_cree_par)
    on conflict do nothing;
  elsif p_cle is not null then
    insert into public.opposition (workspace_id, cle, motif, source, cree_par)
    values (p_workspace_id, p_cle, p_motif, p_source, p_cree_par)
    on conflict do nothing;
  end if;
  foreach v_numero in array coalesce(p_numeros, '{}'::text[]) loop
    continue when public.tel9(v_numero) is null;
    insert into public.opposition (workspace_id, telephone, motif, source, cree_par)
    values (p_workspace_id, right(regexp_replace(v_numero, '\D', '', 'g'), 30), p_motif, p_source, p_cree_par)
    on conflict do nothing;
  end loop;
end;
$$;

-- La liste d'opposition verrouille une fiche : son statut ne quitte jamais « ne_plus_contacter », ses identifiants sont figés, et une
-- fiche opposée ne peut pas être (ré)importée ni recréée avec un autre statut. Depuis l'application (un compte connecté, directement ou
-- par une fonction), une fiche « ne_plus_contacter » le reste même sans identifiant sur la liste : seul un administrateur de la base
-- (SQL Editor) la rouvre. current_setting('role') : le rôle de la requête, même dans une fonction SECURITY DEFINER.
create or replace function public.leads_verifier_opposition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nouveau boolean := public.identifiants_en_opposition(new.workspace_id, new.siren, new.telephone, new.mobile,
                                                         public.cle_entreprise(new.entreprise, new.cp));
  v_ancien boolean := false;
begin
  if tg_op = 'UPDATE' then
    if old.statut = 'ne_plus_contacter' and new.statut is distinct from 'ne_plus_contacter'
       and coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
      raise exception 'Fiche « ne plus contacter » : son statut ne se change pas depuis l''application.' using errcode = '23514';
    end if;
    v_ancien := public.identifiants_en_opposition(old.workspace_id, old.siren, old.telephone, old.mobile,
                                                  public.cle_entreprise(old.entreprise, old.cp));
    -- Effacer ou changer le SIREN ou un numéro ne libère pas une fiche verrouillée : ses identifiants sont figés.
    if v_ancien and (new.siren is distinct from old.siren or new.telephone is distinct from old.telephone
                     or new.mobile is distinct from old.mobile or new.workspace_id is distinct from old.workspace_id) then
      raise exception 'Fiche sur la liste d''opposition : son SIREN et ses numéros ne se modifient pas.' using errcode = '23514';
    end if;
  end if;
  if (v_nouveau or v_ancien) and new.statut is distinct from 'ne_plus_contacter' then
    raise exception 'Fiche sur la liste d''opposition : son statut reste « ne_plus_contacter ».' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger leads_opposition
  before insert or update on public.leads
  for each row execute function public.leads_verifier_opposition();

-- Une entrée de la liste d'opposition passe tout de suite les fiches concernées en « ne_plus_contacter » (même celles qu'un appelant
-- ne voit pas : SECURITY DEFINER) et inscrit leurs autres identifiants.
create or replace function public.opposition_appliquer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fiche record;
begin
  for v_fiche in
    select l.id, l.siren, l.telephone, l.mobile, l.entreprise, l.cp
      from public.leads l
     where l.workspace_id = new.workspace_id
       and ((new.siren is not null and l.siren = new.siren)
            or (new.tel9 is not null and (l.telephone_9 = new.tel9 or l.mobile_9 = new.tel9))
            or (new.cle is not null and public.cle_entreprise(l.entreprise, l.cp) = new.cle))
  loop
    update public.leads set statut = 'ne_plus_contacter', rappel_le = null where id = v_fiche.id and statut <> 'ne_plus_contacter';
    -- Les autres identifiants de la fiche entrent aussi sur la liste : un STOP par SIREN bloque aussi ses numéros (réimport sans SIREN),
    -- un STOP par numéro d'une fiche sans SIREN bloque aussi son nom et son code postal (réimport SIRENE sans numéro).
    perform public.opposition_inscrire(new.workspace_id, v_fiche.siren, array[v_fiche.telephone, v_fiche.mobile],
                                       public.cle_entreprise(v_fiche.entreprise, v_fiche.cp), new.source, new.cree_par, new.motif);
  end loop;
  return new;
end;
$$;

create trigger opposition_appliquer
  after insert on public.opposition
  for each row execute function public.opposition_appliquer();

-- Une activité écrite depuis l'application est horodatée par la base, et son appel_id n'est posé que par la base : on ne peut ni
-- antidater une annonce d'enregistrement, ni l'attribuer à un appel choisi.
create or replace function public.lead_activities_avant_insertion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.cree_le := now();
    new.appel_id := null;
  end if;
  return new;
end;
$$;

create trigger lead_activities_avant_insertion
  before insert on public.lead_activities
  for each row execute function public.lead_activities_avant_insertion();

-- Une activité met à jour la « dernière activité » de la fiche.
create or replace function public.lead_activities_toucher_fiche()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.leads set last_activity_at = greatest(coalesce(last_activity_at, new.cree_le), new.cree_le) where id = new.lead_id;
  return new;
end;
$$;

create trigger lead_activities_toucher_fiche
  after insert on public.lead_activities
  for each row execute function public.lead_activities_toucher_fiche();

-- L'annonce d'enregistrement lue au Poste (activité « annonce », horodatée par la base) ne vaut que pour UN appel : celui que le même
-- appelant passe sur la même fiche à ce moment-là, PENDANT l'appel : cochée au plus 30 secondes avant son début (horloges du fournisseur
-- et de la base) et jamais après sa fin. Tant que la fin de l'appel n'est pas connue (heure de fin, ou début et durée), rien n'est
-- rattaché : l'événement de fin le fera, et une annonce cochée après le raccroché ne rend jamais l'appel conservable. Une fois rattachée
-- à un appel (lead_activities.appel_id), elle ne sert plus à un autre. Un appel dont l'appelant n'est pas reconnu n'est jamais marqué.
create or replace function public.appels_marquer_annonce(p_appel_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appel public.appels%rowtype;
  v_fin timestamptz;
  v_annonce uuid;
begin
  select a.* into v_appel from public.appels a where a.id = p_appel_id for update;
  -- Sans fiche, sans appelant reconnu ou sans heure de début, aucune annonce ne peut être rattachée : rien n'est gardé.
  if not found or v_appel.annonce_lue or v_appel.lead_id is null or v_appel.appelant_id is null or v_appel.debut is null then
    return;
  end if;
  v_fin := coalesce(v_appel.fin, v_appel.debut + make_interval(secs => v_appel.duree_s));
  if v_fin is null then
    return;
  end if;
  select la.id into v_annonce
    from public.lead_activities la
   where la.workspace_id = v_appel.workspace_id
     and la.lead_id = v_appel.lead_id
     and la.appelant_id = v_appel.appelant_id
     and la.type = 'annonce'
     and la.appel_id is null
     and la.cree_le between v_appel.debut - interval '30 seconds' and v_fin
   order by la.cree_le
   limit 1
   for update;
  if v_annonce is null then
    return;
  end if;
  update public.lead_activities set appel_id = v_appel.id where id = v_annonce;
  update public.appels set annonce_lue = true where id = v_appel.id;
end;
$$;

-- Une annonce cochée : rattachée tout de suite à l'appel terminé qu'elle couvre ; pour un appel encore en cours (fin inconnue), c'est
-- l'événement de fin qui la rattachera (appels_marquer_annonce, appelée par evenement_appel).
create or replace function public.lead_activities_annonce()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appel uuid;
begin
  select a.id into v_appel
    from public.appels a
   where a.workspace_id = new.workspace_id
     and a.lead_id = new.lead_id
     and a.appelant_id = new.appelant_id
     and not a.annonce_lue
     and a.debut is not null
     and new.cree_le between a.debut - interval '30 seconds' and coalesce(a.fin, a.debut + make_interval(secs => a.duree_s))
   order by a.debut desc
   limit 1;
  if v_appel is not null then
    perform public.appels_marquer_annonce(v_appel);
  end if;
  return new;
end;
$$;

create trigger lead_activities_annonce
  after insert on public.lead_activities
  for each row when (new.type = 'annonce')
  execute function public.lead_activities_annonce();

-- Les règles d'un rendez-vous avant chaque écriture : à la création, fin par défaut (30 minutes) et closer par défaut (le propriétaire) ;
-- ensuite, dates figées et, pour l'application, source, identifiant externe et auteur figés. Deux rendez-vous actifs et à venir d'un même
-- closer ne se recouvrent jamais quand on en pose un au Poste (contrôlé à la création, ou si le créneau, le closer ou le statut change).
create or replace function public.rendez_vous_avant_ecriture()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.fin is null then
      new.fin := new.debut + interval '30 minutes';
    end if;
    if new.closer_id is null then
      new.closer_id := public.closer_par_defaut(new.workspace_id);
    end if;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.updated_at := now();
    if current_setting('role', true) in ('authenticated', 'anon') then
      new.source := old.source;
      new.externe_id := old.externe_id;
      new.pris_par := old.pris_par;
    end if;
  end if;
  -- (un créneau à l'envers est laissé à la contrainte rendez_vous_duree, qui le refuse proprement)
  if new.source in ('poste', 'manuel') and new.closer_id is not null and new.statut in ('pris', 'confirme')
     and new.fin > new.debut and new.fin > now()
     and (tg_op = 'INSERT' or new.debut is distinct from old.debut or new.fin is distinct from old.fin
          or new.closer_id is distinct from old.closer_id or new.statut is distinct from old.statut)
     and exists (
       select 1 from public.rendez_vous r
        where r.closer_id = new.closer_id
          and r.id <> new.id
          and r.statut in ('pris', 'confirme')
          and tstzrange(r.debut, r.fin, '[)') && tstzrange(new.debut, new.fin, '[)')
     ) then
    raise exception 'Ce créneau chevauche un autre rendez-vous du closer.' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger rendez_vous_avant_ecriture
  before insert or update on public.rendez_vous
  for each row execute function public.rendez_vous_avant_ecriture();

-- leads.rdv_le suit le prochain rendez-vous actif (pris ou confirmé) de la fiche.
create or replace function public.rendez_vous_synchroniser_fiche()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
begin
  foreach v_lead in array array_remove(array[
    case when tg_op in ('INSERT', 'UPDATE') then new.lead_id end,
    case when tg_op in ('UPDATE', 'DELETE') then old.lead_id end
  ], null)
  loop
    update public.leads l
       set rdv_le = (select min(r.debut) from public.rendez_vous r where r.lead_id = v_lead and r.statut in ('pris', 'confirme'))
     where l.id = v_lead;
  end loop;
  return null;
end;
$$;

create trigger rendez_vous_synchroniser_fiche
  after insert or update of lead_id, debut, statut or delete on public.rendez_vous
  for each row execute function public.rendez_vous_synchroniser_fiche();

-- Le filet de toutes les écritures (écran Agenda, webhooks, requête directe) : une fiche « rdv_fixe » qui a un rendez-vous actif à venir
-- (pris ou confirmé, pas encore fini) ne revient pas dans la file (« a_appeler », « a_rappeler ») ; elle garde son statut et son rappel.
-- Le no-show ou l'annulation d'UN rendez-vous ne la rouvre donc que si elle n'en a plus d'autre. SECURITY DEFINER : tous les
-- rendez-vous de la fiche comptent, même ceux qu'un appelant ne voit pas.
create or replace function public.leads_garder_rdv_fixe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.statut = 'rdv_fixe' and new.statut in ('a_appeler', 'a_rappeler')
     and exists (select 1 from public.rendez_vous r where r.lead_id = new.id and r.statut in ('pris', 'confirme') and r.fin > now()) then
    new.statut := 'rdv_fixe';
    new.rappel_le := old.rappel_le;
  end if;
  return new;
end;
$$;

create trigger leads_garder_rdv_fixe
  before update of statut on public.leads
  for each row execute function public.leads_garder_rdv_fixe();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7) Le Poste : l'issue d'un appel (seule porte d'écriture des activités « appel »)
-- ---------------------------------------------------------------------------------------------------------------------------------

-- enregistrer_issue(fiche, issue, note, rappel_le, détails) : journalise l'appel et fait avancer la fiche, en une transaction.
--   - pas_repondu, messagerie, standard : une tentative de plus ; au plafond (reglages.tentatives_max) la fiche passe « injoignable »,
--     sinon elle reste « a_appeler » avec le rappel automatique calculé par le Poste (p_rappel_le) ;
--   - a_rappeler : rappel obligatoire ; rdv_fixe, pas_interesse, hors_cible : leur statut ;
--   - ne_plus_contacter : la fiche ET ses identifiants (SIREN, numéros ; sans SIREN, nom et code postal) entrent dans opposition ;
--   - une issue ajoutée par la config : « clos » si p_details.final, « a_rappeler » avec un rappel, sinon « a_appeler » ;
--   - une fiche « rdv_fixe » qui a un rendez-vous actif à venir le reste (ni la file, ni une tentative de plus) : voir plus bas.
-- p_details (jsonb) : { final: boolean, duree_s: nombre, objection: "code-kebab", tentativesMax: 1 à 10 }. Le plafond des tentatives est
-- celui de la base (reglages.tentatives_max) ou, s'il est plus bas, celui de la file du Poste (config.tentativesMax, passé dans
-- tentativesMax) : une fiche qui a atteint le plafond de la file passe « injoignable », elle ne reste jamais « a_appeler » hors de la
-- file. Un appelant ne touche que ses fiches et les fiches non attribuées (la fiche lui revient alors). Une fiche en opposition
-- n'accepte plus que « ne_plus_contacter ».
create or replace function public.enregistrer_issue(
  p_lead_id uuid,
  p_issue text,
  p_note text default null,
  p_rappel_le timestamptz default null,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid := public.current_workspace_id();
  v_role text := public.role_courant();
  v_details jsonb := case when jsonb_typeof(p_details) = 'object' then p_details else '{}'::jsonb end;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_objection text := nullif(btrim(coalesce(v_details ->> 'objection', '')), '');
  v_final boolean := case when jsonb_typeof(v_details -> 'final') = 'boolean' then (v_details ->> 'final')::boolean else false end;
  v_duree integer;
  v_plafond_poste integer;
  v_lead public.leads%rowtype;
  v_max integer;
  v_statut text;
  v_rappel timestamptz;
  v_tentatives integer;
  v_activite uuid;
begin
  if v_uid is null or v_ws is null or v_role is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if p_issue is null or p_issue !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Issue illisible.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 5000 then
    raise exception 'Note trop longue (5000 caractères au plus).' using errcode = '22023';
  end if;
  if v_objection is not null and v_objection !~ '^[a-z][a-z0-9-]{1,39}$' then
    raise exception 'Code d''objection illisible.' using errcode = '22023';
  end if;
  if v_details ? 'duree_s' then
    if (case when jsonb_typeof(v_details -> 'duree_s') = 'number' then (v_details ->> 'duree_s')::numeric not between 0 and 86400 else true end) then
      raise exception 'Durée illisible (0 à 86400 secondes).' using errcode = '22023';
    end if;
    v_duree := round((v_details ->> 'duree_s')::numeric)::integer;
  end if;
  if p_rappel_le is not null and (p_rappel_le < now() - interval '1 day' or p_rappel_le > now() + interval '400 days') then
    raise exception 'Date de rappel hors bornes.' using errcode = '22023';
  end if;
  if v_details ? 'tentativesMax' then
    if (case when jsonb_typeof(v_details -> 'tentativesMax') = 'number'
             then (v_details ->> 'tentativesMax')::numeric not between 1 and 10
                  or (v_details ->> 'tentativesMax')::numeric <> trunc((v_details ->> 'tentativesMax')::numeric)
             else true end) then
      raise exception 'Plafond de tentatives illisible (un entier de 1 à 10).' using errcode = '22023';
    end if;
    v_plafond_poste := (v_details ->> 'tentativesMax')::numeric::integer;
  end if;

  select l.* into v_lead from public.leads l where l.id = p_lead_id and l.workspace_id = v_ws for update;
  if not found or (v_role = 'appelant' and v_lead.assigned_to is not null and v_lead.assigned_to <> v_uid) then
    raise exception 'Fiche introuvable.' using errcode = 'P0002';
  end if;
  if v_lead.statut = 'ne_plus_contacter' and p_issue <> 'ne_plus_contacter' then
    raise exception 'Fiche sur la liste d''opposition : plus aucun appel.' using errcode = '23514';
  end if;

  select coalesce(r.tentatives_max, 4) into v_max from public.reglages r where r.workspace_id = v_ws;
  v_max := least(coalesce(v_max, 4), coalesce(v_plafond_poste, v_max, 4));
  v_tentatives := v_lead.tentatives;
  v_rappel := null;

  case p_issue
    when 'pas_repondu', 'messagerie', 'standard' then
      v_tentatives := least(v_lead.tentatives + 1, 1000);
      if v_tentatives >= v_max then
        v_statut := 'injoignable';
      else
        v_statut := 'a_appeler';
        v_rappel := p_rappel_le;
      end if;
    when 'a_rappeler' then
      if p_rappel_le is null then
        raise exception 'Une date de rappel est obligatoire.' using errcode = '22023';
      end if;
      v_statut := 'a_rappeler';
      v_rappel := p_rappel_le;
    when 'rdv_fixe', 'pas_interesse', 'hors_cible', 'ne_plus_contacter' then
      v_statut := p_issue;
    else
      if v_final then
        v_statut := 'clos';
      elsif p_rappel_le is not null then
        v_statut := 'a_rappeler';
        v_rappel := p_rappel_le;
      else
        v_statut := 'a_appeler';
      end if;
  end case;

  -- Une fiche qui a un rendez-vous actif à venir ne revient pas dans la file : un appel sans suite (pas de réponse, messagerie,
  -- standard, et le plafond de tentatives n'y compte pas) ou un rappel noté en appelant pour confirmer gardent « rdv_fixe », ses
  -- tentatives et son rappel ; l'appel reste journalisé. Pour la rouvrir, on annule ou on reporte d'abord le rendez-vous.
  if v_lead.statut = 'rdv_fixe'
     and (p_issue in ('pas_repondu', 'messagerie', 'standard', 'a_rappeler') or v_statut in ('a_appeler', 'a_rappeler'))
     and exists (select 1 from public.rendez_vous r
                  where r.lead_id = v_lead.id and r.statut in ('pris', 'confirme') and r.fin > now()) then
    v_statut := 'rdv_fixe';
    v_rappel := v_lead.rappel_le;
    v_tentatives := v_lead.tentatives;
  end if;

  update public.leads l
     set statut = v_statut,
         rappel_le = v_rappel,
         tentatives = v_tentatives,
         derniere_issue = p_issue,
         objection = coalesce(v_objection, l.objection),
         assigned_to = case when v_role = 'appelant' and l.assigned_to is null then v_uid else l.assigned_to end,
         last_activity_at = now()
   where l.id = v_lead.id;

  insert into public.lead_activities (workspace_id, lead_id, appelant_id, type, issue, objection, statut_apres, rappel_le, note, duree_s)
  values (v_ws, v_lead.id, v_uid, 'appel', p_issue, v_objection, v_statut, v_rappel, v_note, v_duree)
  returning id into v_activite;

  if p_issue = 'ne_plus_contacter' then
    perform public.opposition_inscrire(v_ws, v_lead.siren, array[v_lead.telephone, v_lead.mobile],
                                       public.cle_entreprise(v_lead.entreprise, v_lead.cp), 'appel', v_uid, 'Demande faite au téléphone');
  end if;

  return jsonb_build_object(
    'leadId', v_lead.id,
    'statut', v_statut,
    'rappelLe', v_rappel,
    'tentatives', v_tentatives,
    'activiteId', v_activite
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8) Téléphonie : les portes d'écriture des webhooks (clé service seule)
-- ---------------------------------------------------------------------------------------------------------------------------------

-- Audio et transcription d'un appel peuvent-ils être gardés ? Seulement si l'équipe a activé l'enregistrement complet ET si l'annonce a
-- été lue (au Poste) ou jouée (par le fournisseur) pour CET appel. Sinon, la base les ignore (art. 226-1 du Code pénal, CNIL).
create or replace function public.appel_conservable(p_appel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select a.annonce_lue and coalesce(r.enregistrement_complet, false)
      from public.appels a
      left join public.reglages r on r.workspace_id = a.workspace_id
     where a.id = p_appel_id
  ), false)
$$;

-- L'appel d'un webhook par (fournisseur, externeId) ; p_workspace_id s'il y a plusieurs équipes.
create or replace function public.appel_par_externe(p_fournisseur text, p_externe_id text, p_workspace_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select array_agg(a.id) into v_ids
    from public.appels a
   where a.fournisseur = p_fournisseur and a.externe_id = p_externe_id
     and (p_workspace_id is null or a.workspace_id = p_workspace_id);
  return case when cardinality(v_ids) = 1 then v_ids[1] end;
end;
$$;

-- Un événement d'appel normalisé (EvenementAppel de lib/telephonie/types.ts, clés en camelCase). Idempotent : la ligne est retrouvée par
-- (équipe, fournisseur, externeId) ; « inconnu » n'écrase jamais un statut connu ; les dates connues restent. L'équipe : p_workspace_id,
-- sinon celle de l'appelant (son e-mail chez le fournisseur, s'il désigne un seul compte), sinon celle de l'appel déjà connu, sinon la
-- seule équipe de l'instance.
-- La fiche : par le numéro (9 chiffres).
create or replace function public.evenement_appel(p_evenement jsonb, p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e jsonb := case when jsonb_typeof(p_evenement) = 'object' then p_evenement else '{}'::jsonb end;
  v_fournisseur text := e ->> 'fournisseur';
  v_externe text := e ->> 'externeId';
  v_direction text := case when e ->> 'direction' = 'entrant' then 'entrant' else 'sortant' end;
  v_statut text := case
    when e ->> 'statut' in ('repondu', 'sans_reponse', 'occupe', 'messagerie', 'faux_numero', 'inconnu') then e ->> 'statut'
    else 'inconnu' end;
  v_debut timestamptz := public.horodatage_ou_null(e ->> 'debut');
  v_fin timestamptz := public.horodatage_ou_null(e ->> 'fin');
  v_duree integer;
  v_numero text := public.normaliser_e164(e ->> 'numeroExterne', null);
  v_email text := nullif(lower(btrim(coalesce(e ->> 'emailAppelant', ''))), '');
  v_annonce boolean := case when jsonb_typeof(e -> 'annonceJouee') = 'boolean' then (e ->> 'annonceJouee')::boolean else false end;
  v_ws uuid;
  v_appelant uuid;
  v_lead uuid;
  v_id uuid;
  v_existant public.appels%rowtype;
  v_nouveau boolean := false;
  v_comptes integer;
begin
  if v_fournisseur is null or v_fournisseur not in ('onoff', 'aircall', 'ringover', 'softphone', 'telephone') then
    raise exception 'evenement_appel : fournisseur inconnu.' using errcode = '22023';
  end if;
  if v_externe is null or v_externe !~ '^[A-Za-z0-9_.:-]{1,80}$' then
    raise exception 'evenement_appel : identifiant d''appel illisible.' using errcode = '22023';
  end if;
  if jsonb_typeof(e -> 'dureeS') = 'number' then
    if (e ->> 'dureeS')::numeric not between 0 and 86400 then
      raise exception 'evenement_appel : durée hors bornes.' using errcode = '22023';
    end if;
    v_duree := round((e ->> 'dureeS')::numeric)::integer;
  end if;

  if p_workspace_id is not null then
    v_ws := public.workspace_resolu(p_workspace_id);
  elsif v_email is not null then
    -- Un e-mail qui désigne plusieurs comptes ne désigne personne (ni appelant, ni équipe).
    select count(*), (array_agg(p.workspace_id))[1], (array_agg(p.id))[1] into v_comptes, v_ws, v_appelant
      from public.profiles p
     where lower(p.email_telephonie) = v_email or lower(p.email) = v_email;
    if v_comptes <> 1 then
      v_ws := null;
      v_appelant := null;
    end if;
  end if;
  if v_ws is null then
    -- La suite d'un appel déjà connu (même fournisseur, même identifiant) : son équipe.
    select a.workspace_id into v_ws from public.appels a where a.id = public.appel_par_externe(v_fournisseur, v_externe, null);
  end if;
  v_ws := coalesce(v_ws, public.workspace_resolu(null));
  if v_ws is null then
    raise exception 'evenement_appel : équipe introuvable (plusieurs équipes : passer p_workspace_id).' using errcode = 'P0002';
  end if;
  if v_appelant is null and v_email is not null then
    select count(*), (array_agg(p.id))[1] into v_comptes, v_appelant
      from public.profiles p
     where p.workspace_id = v_ws and (lower(p.email_telephonie) = v_email or lower(p.email) = v_email);
    if v_comptes <> 1 then
      v_appelant := null;
    end if;
  end if;

  select a.* into v_existant
    from public.appels a
   where a.workspace_id = v_ws and a.fournisseur = v_fournisseur and a.externe_id = v_externe
   for update;
  v_lead := coalesce(v_existant.lead_id, public.rattacher_fiche(v_numero, v_ws));
  v_appelant := coalesce(v_existant.appelant_id, v_appelant);

  if v_existant.id is null then
    insert into public.appels (workspace_id, fournisseur, externe_id, lead_id, appelant_id, direction, statut, debut, fin, duree_s,
                               numero_externe, annonce_lue)
    values (v_ws, v_fournisseur, v_externe, v_lead, v_appelant, v_direction, v_statut, v_debut, v_fin, v_duree, v_numero, v_annonce)
    on conflict on constraint appels_externe_unique do nothing
    returning id into v_id;
    v_nouveau := v_id is not null;
  end if;

  if v_id is null then
    -- Déjà là (ou inséré à l'instant par un événement concurrent) : on complète sans rien effacer.
    update public.appels a
       set lead_id = coalesce(a.lead_id, v_lead),
           appelant_id = coalesce(a.appelant_id, v_appelant),
           -- Un événement sans direction, ou un simple signal sans données d'appel (transcription Aircall, enregistrement Ringover :
           -- ni statut, ni dates, ni numéro, et une direction par défaut), ne change pas la direction déjà connue.
           direction = case when e ->> 'direction' in ('entrant', 'sortant')
                             and (v_statut <> 'inconnu' or v_debut is not null or v_fin is not null or v_numero is not null)
                            then e ->> 'direction' else a.direction end,
           statut = case when v_statut = 'inconnu' then a.statut else v_statut end,
           debut = coalesce(a.debut, v_debut),
           fin = coalesce(v_fin, a.fin),
           duree_s = coalesce(v_duree, a.duree_s),
           numero_externe = coalesce(a.numero_externe, v_numero),
           annonce_lue = a.annonce_lue or v_annonce
     where a.workspace_id = v_ws and a.fournisseur = v_fournisseur and a.externe_id = v_externe
    returning a.id, a.lead_id, a.appelant_id into v_id, v_lead, v_appelant;
  end if;

  if v_lead is not null then
    update public.leads set last_activity_at = greatest(coalesce(last_activity_at, now()), now()) where id = v_lead;
  end if;
  perform public.appels_marquer_annonce(v_id);

  return jsonb_build_object(
    'id', v_id,
    'workspaceId', v_ws,
    'leadId', v_lead,
    'appelantId', v_appelant,
    'nouveau', v_nouveau,
    'conserverAudio', public.appel_conservable(v_id)
  );
end;
$$;

-- L'audio déposé dans le bucket privé « enregistrements » (<workspace>/<fournisseur>/<externeId>.<ext>) : noté seulement si conservable.
create or replace function public.enregistrement_appel(p_fournisseur text, p_externe_id text, p_chemin text, p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public.appel_par_externe(p_fournisseur, p_externe_id, p_workspace_id);
  v_ws uuid;
begin
  if v_id is null then
    return jsonb_build_object('garde', false, 'raison', 'appel_inconnu');
  end if;
  perform public.appels_marquer_annonce(v_id);
  if not public.appel_conservable(v_id) then
    return jsonb_build_object('garde', false, 'raison', 'enregistrement_non_autorise');
  end if;
  select a.workspace_id into v_ws from public.appels a where a.id = v_id;
  -- Le fichier porte l'identifiant de CET appel : jamais l'audio d'un autre appel rattaché à celui-ci.
  if p_chemin is null
     or p_chemin !~ '^[0-9a-f-]{36}/(onoff|aircall|ringover)/[A-Za-z0-9_.:-]{1,80}\.(mp3|mp4|m4a|wav|ogg|webm)$'
     or split_part(p_chemin, '/', 1) <> v_ws::text
     or split_part(p_chemin, '/', 2) <> p_fournisseur
     or regexp_replace(split_part(p_chemin, '/', 3), '\.(mp3|mp4|m4a|wav|ogg|webm)$', '') <> p_externe_id then
    return jsonb_build_object('garde', false, 'raison', 'chemin_refuse');
  end if;
  update public.appels set enregistrement_chemin = p_chemin where id = v_id;
  return jsonb_build_object('garde', true, 'raison', null);
end;
$$;

-- La transcription (tableau de { t, locuteur, texte }) et le résumé d'un appel : gardés seulement si conservable.
create or replace function public.transcription_appel(
  p_fournisseur text,
  p_externe_id text,
  p_lignes jsonb,
  p_resume text default null,
  p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public.appel_par_externe(p_fournisseur, p_externe_id, p_workspace_id);
  v_lignes jsonb := case when jsonb_typeof(p_lignes) = 'array' then p_lignes else '[]'::jsonb end;
  v_resume text := nullif(left(btrim(coalesce(p_resume, '')), 4000), '');
begin
  if v_id is null then
    return jsonb_build_object('garde', false, 'raison', 'appel_inconnu', 'lignes', 0);
  end if;
  perform public.appels_marquer_annonce(v_id);
  if not public.appel_conservable(v_id) then
    return jsonb_build_object('garde', false, 'raison', 'enregistrement_non_autorise', 'lignes', 0);
  end if;
  if jsonb_array_length(v_lignes) > 5000 or pg_column_size(v_lignes) > 400000 or exists (
    select 1 from jsonb_array_elements(v_lignes) l
     where coalesce(jsonb_typeof(l), '') <> 'object'
        or coalesce(jsonb_typeof(l -> 't'), '') <> 'number'
        or coalesce(l ->> 'locuteur', '') not in ('appelant', 'prospect', 'inconnu')
        or coalesce(jsonb_typeof(l -> 'texte'), '') <> 'string'
        or coalesce(char_length(l ->> 'texte'), 0) > 4000
  ) then
    return jsonb_build_object('garde', false, 'raison', 'transcription_illisible', 'lignes', 0);
  end if;
  if jsonb_array_length(v_lignes) = 0 and v_resume is null then
    return jsonb_build_object('garde', false, 'raison', 'transcription_vide', 'lignes', 0);
  end if;
  update public.appels
     set transcription = case when jsonb_array_length(v_lignes) > 0 then v_lignes else transcription end,
         resume = coalesce(v_resume, resume)
   where id = v_id;
  return jsonb_build_object('garde', true, 'raison', null, 'lignes', jsonb_array_length(v_lignes));
end;
$$;

-- Où en est la récupération différée d'un appel (l'audio arrive souvent plusieurs minutes après la fin). p_compter : compte une tentative
-- (la route la borne ainsi). Clé service seule.
create or replace function public.etat_recuperation_appel(
  p_fournisseur text,
  p_externe_id text,
  p_compter boolean default false,
  p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public.appel_par_externe(p_fournisseur, p_externe_id, p_workspace_id);
  v_appel public.appels%rowtype;
begin
  if v_id is null then
    return jsonb_build_object('existe', false);
  end if;
  if p_compter then
    update public.appels set tentatives = least(tentatives + 1, 1000), derniere_tentative = now() where id = v_id;
  end if;
  select a.* into v_appel from public.appels a where a.id = v_id;
  return jsonb_build_object(
    'existe', true,
    'workspaceId', v_appel.workspace_id,
    'conserverAudio', public.appel_conservable(v_id),
    'aEnregistrement', v_appel.enregistrement_chemin is not null,
    'aTranscription', jsonb_array_length(v_appel.transcription) > 0 or v_appel.resume is not null,
    'tentatives', v_appel.tentatives,
    'derniereTentative', v_appel.derniere_tentative
  );
end;
$$;

-- La lecture d'un enregistrement dans le bucket (politique de storage.objects) : un fichier rattaché à un appel de MON équipe, et je
-- suis gestionnaire ou l'appelant de cet appel.
create or replace function public.enregistrement_lisible(p_nom text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_nom ~ '^[0-9a-f-]{36}/(onoff|aircall|ringover)/[A-Za-z0-9_.:-]{1,80}\.(mp3|mp4|m4a|wav|ogg|webm)$'
    and exists (
      select 1 from public.appels a
       where a.enregistrement_chemin = p_nom
         and a.workspace_id = public.current_workspace_id()
         and (public.est_gestionnaire() or a.appelant_id = auth.uid())
    ),
    false
  )
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9) Agenda : la porte d'écriture des webhooks (clé service seule) et le flux ICS
-- ---------------------------------------------------------------------------------------------------------------------------------

-- Un événement de rendez-vous normalisé (EvenementRdv de lib/agenda/types.ts, clés en camelCase).
--   1. Idempotence : (fournisseur, externeId) n'est traité qu'une fois (integrations_evenements) ; un renvoi répond « doublon ». Les
--      clés portent la version de l'événement (Google : « updated » ; iClosed : la minute de réception) : un aller-retour est traité, et
--      un événement qui ne change rien (même créneau, même fiche…) donne « rdv_inchange » sans rien écrire.
--   2. L'équipe : p_workspace_id, sinon celle de la fiche (leadId), sinon celle du closer (emailCloser), sinon la seule équipe.
--   3. La fiche : celle du rendez-vous déjà connu, puis leadId (utm_content), puis l'e-mail, puis le téléphone (9 chiffres) ; sinon le
--      rendez-vous est gardé « à vérifier » (sauf Google, qui lit tout l'agenda : un événement sans fiche n'y est pas gardé).
--   4. reserve / deplace : le rendez-vous est créé ou déplacé, la fiche passe « rdv_fixe » ; annule : il est annulé et la fiche revient
--      « a_rappeler » (rappel immédiat) si elle n'a plus d'autre rendez-vous actif ; issue : tenu ou no_show (no_show : rappel immédiat,
--      lui aussi seulement sans autre rendez-vous actif).
--   Une fiche en opposition garde son statut.
create or replace function public.evenement_agenda(p_evenement jsonb, p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e jsonb := case when jsonb_typeof(p_evenement) = 'object' then p_evenement else '{}'::jsonb end;
  v_fournisseur text := e ->> 'fournisseur';
  v_type text := e ->> 'type';
  v_externe text := e ->> 'externeId';
  v_rdv_externe text := e ->> 'rdvExterneId';
  v_debut timestamptz := public.horodatage_ou_null(e ->> 'debut');
  v_fin timestamptz := public.horodatage_ou_null(e ->> 'fin');
  v_issue text := e ->> 'issue';
  v_lead_demande uuid := public.uuid_ou_null(e ->> 'leadId');
  v_email text := case when char_length(btrim(coalesce(e ->> 'email', ''))) <= 254
                       and btrim(e ->> 'email') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                      then lower(btrim(e ->> 'email')) end;
  v_tel9 text := public.tel9(e ->> 'telephone');
  v_nom text := nullif(left(btrim(coalesce(e ->> 'nom', '')), 160), '');
  v_canal text := case when e ->> 'canal' in ('visio', 'telephone', 'sur_place') then e ->> 'canal' end;
  v_lien text := case when (e ->> 'lienVisio') ~* '^https://[^[:space:]]+$' and char_length(e ->> 'lienVisio') <= 300 then e ->> 'lienVisio' end;
  v_email_closer text := nullif(lower(btrim(coalesce(e ->> 'emailCloser', ''))), '');
  v_evenement uuid;
  v_ws uuid;
  v_rdv public.rendez_vous%rowtype;
  v_rdv_id uuid;
  v_lead uuid;
  v_closer uuid;
  v_resultat text;
  v_inchange boolean := false;
begin
  if v_fournisseur is null or v_fournisseur not in ('calendly', 'iclosed', 'google') then
    raise exception 'evenement_agenda : fournisseur inconnu.' using errcode = '22023';
  end if;
  if v_type is null or v_type not in ('reserve', 'deplace', 'annule', 'issue') then
    raise exception 'evenement_agenda : type inconnu.' using errcode = '22023';
  end if;
  if v_externe is null or v_externe !~ '^[A-Za-z0-9_.:-]{1,120}$' or v_rdv_externe is null or v_rdv_externe !~ '^[A-Za-z0-9_.:-]{1,120}$' then
    raise exception 'evenement_agenda : identifiant illisible.' using errcode = '22023';
  end if;
  if v_type = 'issue' and (v_issue is null or v_issue not in ('tenu', 'no_show')) then
    raise exception 'evenement_agenda : issue attendue (tenu ou no_show).' using errcode = '22023';
  end if;

  -- 1. Idempotence.
  insert into public.integrations_evenements (fournisseur, externe_id, type)
  values (v_fournisseur, v_externe, v_type)
  on conflict on constraint integrations_evenements_unique do nothing
  returning id into v_evenement;
  if v_evenement is null then
    return jsonb_build_object('doublon', true, 'workspaceId', null, 'rendezVousId', null, 'leadId', null, 'aVerifier', false);
  end if;

  -- 2. L'équipe.
  if p_workspace_id is not null then
    v_ws := public.workspace_resolu(p_workspace_id);
  end if;
  if v_ws is null and v_lead_demande is not null then
    select l.workspace_id into v_ws from public.leads l where l.id = v_lead_demande;
  end if;
  if v_ws is null and v_email_closer is not null then
    select p.workspace_id into v_ws from public.profiles p where lower(p.email) = v_email_closer order by p.created_at limit 1;
  end if;
  v_ws := coalesce(v_ws, public.workspace_resolu(null));
  if v_ws is null then
    raise exception 'evenement_agenda : équipe introuvable (plusieurs équipes : passer p_workspace_id).' using errcode = 'P0002';
  end if;

  -- 3. Le rendez-vous déjà connu, la fiche, le closer.
  select r.* into v_rdv from public.rendez_vous r
   where r.workspace_id = v_ws and r.source = v_fournisseur and r.externe_id = v_rdv_externe
   for update;
  v_lead := v_rdv.lead_id;
  if v_lead is null and v_lead_demande is not null then
    select l.id into v_lead from public.leads l where l.id = v_lead_demande and l.workspace_id = v_ws;
  end if;
  if v_lead is null and v_email is not null then
    select l.id into v_lead from public.leads l
     where l.workspace_id = v_ws and lower(l.email) = v_email
     order by l.last_activity_at desc nulls last, l.created_at desc limit 1;
  end if;
  if v_lead is null and v_tel9 is not null then
    v_lead := public.rattacher_fiche(v_tel9, v_ws);
  end if;
  if v_email_closer is not null then
    select p.id into v_closer from public.profiles p where p.workspace_id = v_ws and lower(p.email) = v_email_closer limit 1;
  end if;

  -- 4. L'événement.
  if v_fournisseur = 'google' and v_rdv.id is null and v_lead is null then
    -- Google : la synchro lit tout l'agenda du closer (réunions, rendez-vous personnels, invitations reçues). Un événement qui ne se
    -- rattache à aucune fiche n'est pas gardé : ni rendez-vous « à vérifier », ni nom, e-mail ou numéro d'un tiers en base.
    v_resultat := 'ignore_sans_fiche';
  elsif v_type in ('reserve', 'deplace') then
    if v_debut is null then
      raise exception 'evenement_agenda : date de début manquante.' using errcode = '22023';
    end if;
    if v_fin is null or v_fin <= v_debut or v_fin > v_debut + interval '8 hours' then
      v_fin := v_debut + interval '30 minutes';
    end if;
    if v_rdv.id is null then
      insert into public.rendez_vous (workspace_id, lead_id, closer_id, pris_par, debut, fin, canal, statut, source, externe_id, lien_visio,
                                      a_verifier, invite_nom, invite_email, invite_telephone)
      values (v_ws, v_lead, v_closer, null, v_debut, v_fin, coalesce(v_canal, 'visio'), 'pris', v_fournisseur, v_rdv_externe, v_lien,
              v_lead is null, v_nom, v_email, left(e ->> 'telephone', 30))
      returning id into v_rdv_id;
      v_resultat := 'rdv_cree';
    else
      -- Un renvoi qui ne change rien (même créneau, rendez-vous toujours actif, même fiche, même lien, même closer : une réponse de
      -- l'invité, un titre retouché, la même version relue) : « rdv_inchange », ni activité ni statut de fiche touchés.
      v_inchange := v_rdv.debut = v_debut and v_rdv.fin = v_fin and v_rdv.statut in ('pris', 'confirme')
                    and v_rdv.lead_id is not distinct from v_lead and (v_canal is null or v_canal = v_rdv.canal)
                    and (v_lien is null or v_lien = v_rdv.lien_visio) and (v_closer is null or v_closer = v_rdv.closer_id);
      update public.rendez_vous r
         set debut = v_debut, fin = v_fin, canal = coalesce(v_canal, r.canal), lien_visio = coalesce(v_lien, r.lien_visio),
             statut = case when r.statut in ('annule', 'reporte', 'no_show') then 'pris' else r.statut end,
             lead_id = v_lead, a_verifier = v_lead is null, closer_id = coalesce(v_closer, r.closer_id)
       where r.id = v_rdv.id
      returning r.id into v_rdv_id;
      v_resultat := case when v_inchange then 'rdv_inchange' when v_type = 'deplace' then 'rdv_deplace' else 'rdv_mis_a_jour' end;
    end if;
    if v_lead is not null and not v_inchange then
      update public.leads set statut = 'rdv_fixe', rappel_le = null where id = v_lead and statut <> 'ne_plus_contacter';
    end if;
  elsif v_type = 'annule' then
    if v_rdv.id is null then
      v_resultat := 'rdv_inconnu';
    elsif v_rdv.statut = 'annule' then
      -- Déjà annulé (un renvoi) : rien de neuf.
      v_rdv_id := v_rdv.id;
      v_inchange := true;
      v_resultat := 'rdv_inchange';
    else
      update public.rendez_vous set statut = 'annule' where id = v_rdv.id returning id into v_rdv_id;
      v_resultat := 'rdv_annule';
      if v_lead is not null and not exists (
        select 1 from public.rendez_vous r where r.lead_id = v_lead and r.statut in ('pris', 'confirme') and r.id <> v_rdv.id
      ) then
        update public.leads set statut = 'a_rappeler', rappel_le = now() where id = v_lead and statut = 'rdv_fixe';
      end if;
    end if;
  else
    if v_rdv.id is null then
      v_resultat := 'rdv_inconnu';
    elsif v_rdv.statut = v_issue then
      -- Issue déjà notée (un renvoi) : rien de neuf, la fiche n'est pas rouverte.
      v_rdv_id := v_rdv.id;
      v_inchange := true;
      v_resultat := 'rdv_inchange';
    else
      update public.rendez_vous set statut = v_issue where id = v_rdv.id returning id into v_rdv_id;
      v_resultat := 'rdv_' || v_issue;
      -- Un no-show ne remet la fiche « à rappeler » que si elle n'a plus d'autre rendez-vous actif (comme l'annulation).
      if v_issue = 'no_show' and v_lead is not null and not exists (
        select 1 from public.rendez_vous r where r.lead_id = v_lead and r.statut in ('pris', 'confirme') and r.id <> v_rdv.id
      ) then
        update public.leads set statut = 'a_rappeler', rappel_le = now() where id = v_lead and statut <> 'ne_plus_contacter';
      end if;
    end if;
  end if;

  if v_lead is not null and v_rdv_id is not null and not v_inchange then
    insert into public.lead_activities (workspace_id, lead_id, appelant_id, type, note)
    values (v_ws, v_lead, null, 'rdv', v_fournisseur || ' : ' || replace(v_resultat, '_', ' '));
  end if;

  update public.integrations_evenements
     set workspace_id = v_ws, lead_id = v_lead, rendez_vous_id = v_rdv_id, resultat = v_resultat
   where id = v_evenement;

  return jsonb_build_object(
    'doublon', false,
    'workspaceId', v_ws,
    'rendezVousId', v_rdv_id,
    'leadId', v_lead,
    'aVerifier', v_rdv_id is not null and v_lead is null
  );
end;
$$;

-- Les créneaux occupés d'un closer de MON équipe (par défaut le propriétaire le plus ancien) : les rendez-vous pris ou confirmés qui
-- touchent [p_debut, p_fin], pour proposer au Poste deux créneaux libres. Le début et la fin seulement, jamais la fiche ni l'invité ; y
-- compris ceux qu'un appelant ne voit pas (pris par un collègue, venus de Calendly, d'iClosed ou de Google). 62 jours et 500 créneaux
-- au plus.
create or replace function public.creneaux_occupes(p_debut timestamptz, p_fin timestamptz, p_closer uuid default null)
returns table (debut timestamptz, fin timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.debut, r.fin
    from public.rendez_vous r
   where r.workspace_id = public.current_workspace_id()
     and r.closer_id = coalesce(p_closer, public.closer_par_defaut(public.current_workspace_id()))
     and r.statut in ('pris', 'confirme')
     and p_debut is not null and p_fin is not null and p_fin > p_debut and p_fin <= p_debut + interval '62 days'
     and r.fin > p_debut and r.debut < p_fin
   order by r.debut
   limit 500
$$;

-- Le jeton du flux ICS (/api/agenda/ics/<jeton>) de la personne connectée : tiré par la base, montré UNE fois (seule son empreinte
-- SHA-256 est gardée). Le recréer invalide l'ancien.
create or replace function public.agenda_jeton_creer()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jeton text := public.jeton_aleatoire();
begin
  if auth.uid() is null or public.current_workspace_id() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  update public.profiles
     set agenda_jeton_empreinte = encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex')
   where id = auth.uid();
  return v_jeton;
end;
$$;

create or replace function public.agenda_jeton_revoquer()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  update public.profiles set agenda_jeton_empreinte = null where id = auth.uid() and agenda_jeton_empreinte is not null;
  return found;
end;
$$;

-- Le flux d'un closer par son jeton (clé service seule) : null si le jeton est inconnu. Rendez-vous de 30 jours avant à 90 jours après,
-- 500 au plus : créneau, statut, canal, lien de visio, entreprise. Jamais un numéro ni un e-mail.
create or replace function public.agenda_flux(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p.id is null then null else jsonb_build_object(
    'closer', jsonb_build_object('id', p.id, 'nom', p.nom),
    'genereLe', now(),
    'rendezVous', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'leadId', r.lead_id, 'entreprise', l.entreprise, 'debut', r.debut, 'fin', r.fin, 'statut', r.statut,
               'canal', r.canal, 'lienVisio', r.lien_visio, 'creeLe', r.created_at, 'majLe', r.updated_at)
             order by r.debut)
        from (select x.* from public.rendez_vous x
               where x.closer_id = p.id and x.debut >= now() - interval '30 days' and x.debut <= now() + interval '90 days'
               order by x.debut limit 500) r
        left join public.leads l on l.id = r.lead_id
    ), '[]'::jsonb)
  ) end
    from (select 1) u
    left join public.profiles p
      on p_jeton ~ '^[0-9a-f]{64}$' and p.agenda_jeton_empreinte = encode(sha256(convert_to(p_jeton, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10) Retours du marché : les agrégats (page /retours, skill ajuster-script)
-- ---------------------------------------------------------------------------------------------------------------------------------

-- SECURITY INVOKER : la RLS de retours_marche s'applique (un appelant n'agrège que les siens). Un script (clé service, URL de la base)
-- passe p_workspace_id, sinon la seule équipe de l'instance.
create or replace function public.retours_marche_agreger(p_debut timestamptz, p_fin timestamptz, p_workspace_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
  v_resultat jsonb;
begin
  if auth.uid() is not null then
    v_ws := public.current_workspace_id();
  else
    v_ws := public.workspace_resolu(p_workspace_id);
  end if;

  with r as (
    select rm.* from public.retours_marche rm
     where rm.workspace_id = v_ws and rm.appel_le >= p_debut and rm.appel_le < p_fin
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'decideurs', (select count(*) from r where r.decideur_joint),
    'rdv', (select count(*) from r where r.issue = 'rdv_fixe'),
    'interetMoyen', (select round(avg(r.interet)::numeric, 2) from r where r.interet is not null),
    'objections', coalesce((
      select jsonb_agg(jsonb_build_object('code', o.code, 'n', o.n) order by o.n desc, o.code)
        from (select r.objection_code as code, count(*) as n from r where r.objection_code is not null group by r.objection_code) o
    ), '[]'::jsonb),
    'verdicts', jsonb_build_object(
      'accroche', (select count(*) from r where r.accroche_verdict = 'accroche'),
      'neutre', (select count(*) from r where r.accroche_verdict = 'neutre'),
      'rejet', (select count(*) from r where r.accroche_verdict = 'rejet')
    ),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc, t.tag)
        from (select x.tag, count(*) as n from r, unnest(r.tags) as x(tag) group by x.tag) t
    ), '[]'::jsonb),
    'citations', coalesce((
      select jsonb_agg(jsonb_build_object('texte', c.citation, 'le', c.appel_le) order by c.appel_le desc)
        from (select r.citation, r.appel_le from r where coalesce(btrim(r.citation), '') <> '' order by r.appel_le desc limit 20) c
    ), '[]'::jsonb),
    'douleurs', coalesce((
      select jsonb_agg(jsonb_build_object('texte', d.douleur, 'le', d.appel_le) order by d.appel_le desc)
        from (select r.douleur, r.appel_le from r where coalesce(btrim(r.douleur), '') <> '' order by r.appel_le desc limit 20) d
    ), '[]'::jsonb)
  ) into v_resultat;
  return v_resultat;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 11) L'équipe : amorçage, aperçu d'une invitation, rôles
-- ---------------------------------------------------------------------------------------------------------------------------------

-- La première équipe de l'instance et l'invitation de son propriétaire (clé service ou URL de la base : le skill d'installation).
-- Une équipe par instance : refus s'il y en a déjà une avec un propriétaire, ou plusieurs. Rejouable tant que personne n'a accepté :
-- chaque nouvel amorçage retire les liens d'amorçage précédents (un seul lien valable à la fois), et aucun ne sert plus une fois
-- l'équipe dotée d'un propriétaire (gerer_nouvel_utilisateur).
create or replace function public.amorcer_workspace(
  p_nom text,
  p_email text default null,
  p_nom_invite text default null,
  p_fuseau text default 'Europe/Paris',
  p_pays text default 'FR'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nom text := btrim(coalesce(p_nom, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_nom_invite text := nullif(btrim(coalesce(p_nom_invite, '')), '');
  v_nombre integer;
  v_ws uuid;
  v_jeton text;
begin
  if char_length(v_nom) not between 1 and 120 then
    raise exception 'Nom d''équipe invalide (1 à 120 caractères).' using errcode = '22023';
  end if;
  if v_email is null and v_nom_invite is null then
    raise exception 'Il faut l''e-mail ou le nom du propriétaire.' using errcode = '22023';
  end if;
  if p_pays is null or p_pays !~ '^[A-Z]{2}$' or not exists (select 1 from pg_timezone_names where name = p_fuseau) then
    raise exception 'Pays ou fuseau invalide.' using errcode = '22023';
  end if;

  select count(*), (array_agg(w.id))[1] into v_nombre, v_ws from public.workspaces w;
  if v_nombre = 0 then
    insert into public.workspaces (nom, fuseau, pays) values (v_nom, p_fuseau, p_pays) returning id into v_ws;
  elsif v_nombre > 1 then
    raise exception 'Plusieurs équipes sur cette instance : amorçage impossible.' using errcode = '23505';
  else
    -- L'équipe verrouillée le temps de l'amorçage (une inscription d'amorçage en cours attend, ou fait attendre).
    perform 1 from public.workspaces w where w.id = v_ws for update;
    if exists (select 1 from public.profiles p where p.workspace_id = v_ws and p.role = 'proprietaire') then
      raise exception 'L''équipe a déjà un propriétaire : c''est lui qui invite les autres.' using errcode = '23505';
    end if;
  end if;

  -- Les liens d'amorçage précédents, jamais acceptés, ne servent plus : seul le nouveau est valable.
  delete from public.invitations i
   where i.workspace_id = v_ws and i.role = 'proprietaire' and i.cree_par is null and i.acceptee_le is null;

  insert into public.invitations (workspace_id, role, email, nom_invite, cree_par)
  values (v_ws, 'proprietaire', v_email, v_nom_invite, null)
  returning jeton into v_jeton;
  return jsonb_build_object('workspaceId', v_ws, 'jeton', v_jeton);
end;
$$;

-- L'aperçu d'une invitation valide pour la page d'inscription (clé service seule : la base n'ouvre rien au visiteur anonyme). null sinon.
create or replace function public.invitation_publique(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('equipe', w.nom, 'role', i.role, 'email', i.email, 'nom', i.nom_invite)
    from public.invitations i
    join public.workspaces w on w.id = i.workspace_id
   where p_jeton ~ '^[0-9a-f]{64}$' and i.jeton = p_jeton and i.acceptee_le is null and i.expire_le > now()
$$;

-- Un gestionnaire pose l'e-mail d'un membre chez le fournisseur de téléphonie (null pour l'effacer). Refusé s'il désigne déjà un autre
-- compte (son e-mail de connexion ou son e-mail de téléphonie) : sinon les appels d'un collègue seraient attribués au mauvais compte.
create or replace function public.definir_email_telephonie(p_membre uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if not public.est_gestionnaire() then
    raise exception 'Réservé aux gestionnaires.' using errcode = '42501';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'E-mail invalide.' using errcode = '22023';
  end if;
  if v_email is not null and exists (
    select 1 from public.profiles p
     where p.id <> p_membre and (lower(p.email) = v_email or lower(p.email_telephonie) = v_email)
  ) then
    raise exception 'Cet e-mail désigne déjà un autre compte.' using errcode = '23505';
  end if;
  update public.profiles set email_telephonie = v_email where id = p_membre and workspace_id = public.current_workspace_id();
  if not found then
    raise exception 'Membre introuvable.' using errcode = 'P0002';
  end if;
end;
$$;

-- Le propriétaire change le rôle d'un membre de son équipe (jamais le sien : l'équipe garde toujours un propriétaire).
create or replace function public.changer_role(p_membre uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.est_proprietaire() then
    raise exception 'Réservé au propriétaire.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('proprietaire', 'membre', 'appelant') then
    raise exception 'Rôle inconnu.' using errcode = '22023';
  end if;
  if p_membre = auth.uid() then
    raise exception 'On ne change pas son propre rôle.' using errcode = '42501';
  end if;
  update public.profiles set role = p_role where id = p_membre and workspace_id = public.current_workspace_id();
  if not found then
    raise exception 'Membre introuvable.' using errcode = 'P0002';
  end if;
end;
$$;

-- Le propriétaire retire quelqu'un de l'équipe (jamais lui-même). Le compte de connexion reste, sans plus aucun accès (supprimable dans
-- le tableau de bord de Supabase) ; ses fiches redeviennent non attribuées.
create or replace function public.retirer_membre(p_membre uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.est_proprietaire() then
    raise exception 'Réservé au propriétaire.' using errcode = '42501';
  end if;
  if p_membre = auth.uid() then
    raise exception 'On ne se retire pas soi-même.' using errcode = '42501';
  end if;
  delete from public.profiles where id = p_membre and workspace_id = public.current_workspace_id();
  if not found then
    raise exception 'Membre introuvable.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 12) Entretien (clé service seule, par une tâche planifiée) et version du schéma
-- ---------------------------------------------------------------------------------------------------------------------------------

-- Le journal des intégrations ne garde rien au-delà de 90 jours.
create or replace function public.purger_integrations_evenements()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre integer;
begin
  delete from public.integrations_evenements where recu_le < now() - interval '90 days';
  get diagnostics v_nombre = row_count;
  return v_nombre;
end;
$$;

-- RGPD : au-delà de p_mois (config legal.conservationMois, 36 au plus), sont supprimés les fiches sans contact (avec leur journal), les
-- appels (numéro, transcription, résumé), les rendez-vous, les débriefs et les retours du marché. Renvoie des compteurs et les chemins
-- des enregistrements à effacer du bucket « enregistrements » (par l'API Storage, côté serveur). La liste d'opposition, elle, reste :
-- elle sert à ne plus jamais rappeler.
create or replace function public.purger_fiches_inactives(p_mois integer default 36)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limite timestamptz;
  v_fiches uuid[];
  v_chemins text[];
  v_appels integer;
  v_rdv integer;
  v_debriefs integer;
  v_retours integer;
  v_nombre_fiches integer;
begin
  if p_mois is null or p_mois not between 1 and 36 then
    raise exception 'Durée de conservation invalide (1 à 36 mois).' using errcode = '22023';
  end if;
  v_limite := now() - make_interval(months => p_mois);

  select coalesce(array_agg(l.id), '{}') into v_fiches
    from public.leads l
   where coalesce(l.last_activity_at, l.created_at) < v_limite
     and not exists (select 1 from public.rendez_vous r where r.lead_id = l.id and r.debut > now() and r.statut in ('pris', 'confirme'));

  with partis as (
    delete from public.appels a
     where a.created_at < v_limite or a.lead_id = any (v_fiches)
    returning a.enregistrement_chemin
  )
  select count(*), coalesce(array_agg(enregistrement_chemin) filter (where enregistrement_chemin is not null), '{}')
    into v_appels, v_chemins
    from partis;
  delete from public.rendez_vous r where r.debut < v_limite or (r.lead_id = any (v_fiches) and r.debut < now());
  get diagnostics v_rdv = row_count;
  delete from public.debriefs d where d.created_at < v_limite;
  get diagnostics v_debriefs = row_count;
  delete from public.retours_marche m where m.appel_le < v_limite;
  get diagnostics v_retours = row_count;
  delete from public.leads l where l.id = any (v_fiches);
  get diagnostics v_nombre_fiches = row_count;

  return jsonb_build_object(
    'fiches', v_nombre_fiches,
    'appels', v_appels,
    'rendezVous', v_rdv,
    'debriefs', v_debriefs,
    'retours', v_retours,
    'enregistrementsAEffacer', to_jsonb(v_chemins)
  );
end;
$$;

-- La version du schéma (lue par /api/sante, comparée à lib/sante.ts).
create or replace function public.version_schema()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 1
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 13) RLS : chaque table, chaque opération, « to authenticated » seulement
-- ---------------------------------------------------------------------------------------------------------------------------------
-- (select f()) : la fonction est évaluée une fois par requête, pas une fois par ligne.

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.reglages enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.rendez_vous enable row level security;
alter table public.opposition enable row level security;
alter table public.imports enable row level security;
alter table public.appels enable row level security;
alter table public.debriefs enable row level security;
alter table public.retours_marche enable row level security;
alter table public.integrations_evenements enable row level security;

-- workspaces : lire la sienne ; le propriétaire la renomme.
create policy workspaces_lecture on public.workspaces for select to authenticated
  using (id = (select public.current_workspace_id()));
create policy workspaces_modification on public.workspaces for update to authenticated
  using (id = (select public.current_workspace_id()) and (select public.est_proprietaire()))
  with check (id = (select public.current_workspace_id()));

-- profiles : voir son équipe ; modifier son propre nom (l'e-mail chez le fournisseur : definir_email_telephonie, par un gestionnaire).
create policy profiles_lecture on public.profiles for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));
create policy profiles_modification on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- invitations : les gestionnaires ; seul le propriétaire invite un propriétaire, et lui seul voit ces invitations (sinon un membre
-- pourrait lire le jeton d'une invitation « propriétaire » en attente et s'en servir).
create policy invitations_lecture on public.invitations for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and (select public.est_gestionnaire())
    and (role <> 'proprietaire' or (select public.est_proprietaire()))
  );
create policy invitations_creation on public.invitations for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and (select public.est_gestionnaire())
    and (role <> 'proprietaire' or (select public.est_proprietaire()))
    and cree_par = (select auth.uid())
    and expire_le <= now() + interval '30 days'
  );
create policy invitations_suppression on public.invitations for delete to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and (select public.est_gestionnaire())
    and (role <> 'proprietaire' or (select public.est_proprietaire()))
  );

-- reglages : toute l'équipe lit (le Poste en a besoin) ; les gestionnaires modifient.
create policy reglages_lecture on public.reglages for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));
create policy reglages_modification on public.reglages for update to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()))
  with check (workspace_id = (select public.current_workspace_id()));

-- leads : un gestionnaire voit tout ; un appelant voit ses fiches et les fiches non attribuées ; seul un gestionnaire supprime.
create policy leads_lecture on public.leads for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or assigned_to is null or assigned_to = (select auth.uid()))
  );
create policy leads_creation on public.leads for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or assigned_to is null or assigned_to = (select auth.uid()))
  );
create policy leads_modification on public.leads for update to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or assigned_to is null or assigned_to = (select auth.uid()))
  )
  with check (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or assigned_to is null or assigned_to = (select auth.uid()))
  );
create policy leads_suppression on public.leads for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()));

-- lead_activities : visibles avec la fiche ; écrites à son nom (notes et annonces : les appels passent par enregistrer_issue).
create policy lead_activities_lecture on public.lead_activities for select to authenticated
  using (workspace_id = (select public.current_workspace_id()) and public.lead_visible(lead_id));
create policy lead_activities_creation on public.lead_activities for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and appelant_id = (select auth.uid())
    and type in ('note', 'annonce')
    and public.lead_visible(lead_id)
  );
create policy lead_activities_suppression on public.lead_activities for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()));

-- rendez_vous : un gestionnaire voit tout ; un appelant, ceux qu'il a pris ou qu'il tient.
create policy rendez_vous_lecture on public.rendez_vous for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or pris_par = (select auth.uid()) or closer_id = (select auth.uid()))
  );
create policy rendez_vous_creation on public.rendez_vous for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and pris_par = (select auth.uid())
    and source in ('poste', 'manuel')
    and (lead_id is null or public.lead_visible(lead_id))
  );
create policy rendez_vous_modification on public.rendez_vous for update to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or pris_par = (select auth.uid()) or closer_id = (select auth.uid()))
  )
  with check (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or pris_par = (select auth.uid()) or closer_id = (select auth.uid()))
    and (lead_id is null or public.lead_visible(lead_id))
  );
create policy rendez_vous_suppression on public.rendez_vous for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()));

-- opposition : toute l'équipe lit et ajoute ; jamais de suppression par un appelant.
create policy opposition_lecture on public.opposition for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));
create policy opposition_creation on public.opposition for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id()) and cree_par = (select auth.uid()));
create policy opposition_suppression on public.opposition for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()));

-- imports : les gestionnaires.
create policy imports_lecture on public.imports for select to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()));
create policy imports_creation on public.imports for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()) and cree_par = (select auth.uid()));

-- appels : lecture seule (les gestionnaires, ou l'appelant de l'appel) ; l'écriture passe par les fonctions de la clé service.
create policy appels_lecture on public.appels for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or appelant_id = (select auth.uid()))
  );

-- debriefs : les gestionnaires, ou l'auteur.
create policy debriefs_lecture on public.debriefs for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or appelant_id = (select auth.uid()))
  );
create policy debriefs_creation on public.debriefs for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and appelant_id = (select auth.uid())
    and (lead_id is null or public.lead_visible(lead_id))
  );
create policy debriefs_modification on public.debriefs for update to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or appelant_id = (select auth.uid()))
  )
  with check (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or appelant_id = (select auth.uid()))
    and (lead_id is null or public.lead_visible(lead_id))
  );
create policy debriefs_suppression on public.debriefs for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()));

-- retours_marche : un journal écrit par l'appelant ; les gestionnaires lisent tout et peuvent retirer une ligne.
create policy retours_marche_lecture on public.retours_marche for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and ((select public.est_gestionnaire()) or appelant_id = (select auth.uid()))
  );
create policy retours_marche_creation on public.retours_marche for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and appelant_id = (select auth.uid())
    and (lead_id is null or public.lead_visible(lead_id))
  );
create policy retours_marche_suppression on public.retours_marche for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.est_gestionnaire()));

-- integrations_evenements : aucune politique (clé service seule).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 14) Le bucket privé des enregistrements (seulement si Supabase Storage est là : une base PostgreSQL nue saute ce bloc)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('enregistrements', 'enregistrements', false) on conflict (id) do nothing;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists enregistrements_lecture on storage.objects';
    execute 'create policy enregistrements_lecture on storage.objects for select to authenticated '
         || 'using (bucket_id = ''enregistrements'' and public.enregistrement_lisible(name))';
    -- Aucune politique d'écriture : la clé service dépose, personne n'efface depuis l'application.
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 15) Droits : rien pour anon ; le strict nécessaire pour authenticated ; tout pour service_role
-- ---------------------------------------------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema public revoke all on sequences from authenticated;

grant usage on schema public to authenticated, service_role;

grant select on public.workspaces to authenticated;
grant update (nom, fuseau, pays) on public.workspaces to authenticated;
grant select on public.profiles to authenticated;
grant update (nom) on public.profiles to authenticated;
grant select, insert, delete on public.invitations to authenticated;
grant select on public.reglages to authenticated;
grant update (enregistrement_complet, annonce_lue_le, tentatives_max, objectif_appels_jour) on public.reglages to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, delete on public.lead_activities to authenticated;
grant select, insert, update, delete on public.rendez_vous to authenticated;
grant select, insert, delete on public.opposition to authenticated;
grant select, insert on public.imports to authenticated;
grant select on public.appels to authenticated;
grant select, insert, update, delete on public.debriefs to authenticated;
grant select, insert, delete on public.retours_marche to authenticated;
-- integrations_evenements : rien pour authenticated.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Fonctions ouvertes aux comptes connectés (chacune revérifie l'équipe et le rôle). Les outils purs (tel9, cle_entreprise,
-- normaliser_e164, jeton_aleatoire) servent aussi aux valeurs par défaut, aux colonnes calculées et aux index, évalués sous le rôle de
-- la requête.
grant execute on function
  public.tel9(text),
  public.cle_entreprise(text, text),
  public.normaliser_e164(text, text),
  public.jeton_aleatoire(),
  public.uuid_ou_null(text),
  public.current_workspace_id(),
  public.role_courant(),
  public.est_gestionnaire(),
  public.est_proprietaire(),
  public.lead_visible(uuid),
  public.contexte(),
  public.lead_en_opposition(text, text, uuid, text, text),
  public.enregistrer_issue(uuid, text, text, timestamptz, jsonb),
  public.enregistrement_lisible(text),
  public.agenda_jeton_creer(),
  public.agenda_jeton_revoquer(),
  public.creneaux_occupes(timestamptz, timestamptz, uuid),
  public.retours_marche_agreger(timestamptz, timestamptz, uuid),
  public.changer_role(uuid, text),
  public.definir_email_telephonie(uuid, text),
  public.retirer_membre(uuid),
  public.version_schema()
to authenticated;

grant execute on all functions in schema public to service_role;

-- L'API relit le schéma tout de suite.
notify pgrst, 'reload schema';
