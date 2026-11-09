// Étape 1 des accroches : la liste des sites à lire, tirée de la base.
//
//   node scripts/accroches/export.mjs [--tiers A,B] [--limite N] [--tous-statuts] [--workspace W] [--dossier D] [--config C]
//
// Garde les fiches de l'équipe (--workspace, obligatoire si la base en a plusieurs ; sinon la seule équipe) qui ont un site et pas
// encore d'accroche, à appeler ou à rappeler (--tous-statuts : tous les statuts sauf « ne plus contacter »), hors liste d'opposition,
// les mieux notées d'abord. Écrit donnees/accroches/a-crawler.json : [{ id, entreprise, site }]
// (le nom ne sert qu'à la relecture humaine ; dossier ignoré par git). Lecture seule en base. SUPABASE_DB_URL (environnement ou .env.local) n'est jamais affichée ; la
// console n'affiche que des compteurs.

import { entier, liste, lireOptions, ErreurOptions } from "./lib/args.mjs";
import { connecter, resoudreEquipe } from "./lib/base.mjs";
import { CONFIG_PAR_DEFAUT, dossierDeTravail, fichiers } from "./lib/chemins.mjs";
import { chargerConfig } from "./lib/config.mjs";
import { ecrireJson } from "./lib/fichiers.mjs";
import { lancerSiPrincipal } from "./lib/lancer.mjs";

export const STATUTS_PAR_DEFAUT = ["a_appeler", "a_rappeler"];
export const TOUS_LES_STATUTS = ["a_appeler", "a_rappeler", "rdv_fixe", "pas_interesse", "hors_cible", "injoignable", "clos"];

const SQL_EXPORT = `
select l.id::text as id, l.entreprise, l.site
  from public.leads l
 where l.workspace_id = $4::uuid
   and l.site is not null and btrim(l.site) <> ''
   and (l.accroche is null or btrim(l.accroche) = '')
   and l.statut = any($1::text[])
   and l.statut <> 'ne_plus_contacter'
   and ($2::text[] is null or l.tier = any($2::text[]))
   and not exists (
         select 1 from public.opposition o
          where o.workspace_id = l.workspace_id
            and ((l.siren is not null and o.siren = l.siren)
                 or (o.tel9 is not null and o.tel9 in (l.telephone_9, l.mobile_9))))
 order by l.score desc nulls last, l.created_at, l.id
 limit $3`;

const SQL_COMPTEURS = `
select count(*) filter (where site is not null and btrim(site) <> '')::int as avec_site,
       count(*) filter (where site is not null and btrim(site) <> '' and accroche is not null and btrim(accroche) <> '')::int as deja
  from public.leads
 where workspace_id = $1::uuid`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigerEquipe(workspace) {
  if (!UUID.test(String(workspace ?? ""))) throw new Error("équipe (workspace) manquante : rien n'est lu");
}

/** Les fiches à lire, de l'équipe `workspace` seulement (lecture seule). */
export async function exporterFiches(client, { workspace, statuts = STATUTS_PAR_DEFAUT, tiers = null, limite = null } = {}) {
  exigerEquipe(workspace);
  const { rows } = await client.query(SQL_EXPORT, [statuts, tiers, limite, workspace]);
  return rows.map((r) => ({ id: r.id, entreprise: r.entreprise, site: r.site.trim() }));
}

export async function compterFiches(client, { workspace } = {}) {
  exigerEquipe(workspace);
  const { rows } = await client.query(SQL_COMPTEURS, [workspace]);
  return { avecSite: rows[0].avec_site, dejaUneAccroche: rows[0].deja };
}

const AIDE = `Écrit donnees/accroches/a-crawler.json : les fiches avec un site et sans accroche (lecture seule en base).
  --tiers A,B       seulement ces tiers
  --limite N        les N mieux notées
  --tous-statuts    tous les statuts sauf « ne plus contacter » (défaut : à appeler et à rappeler)
  --workspace W     l'équipe (son identifiant), obligatoire si la base en a plusieurs
  --dossier D       dossier de travail (défaut donnees/accroches)
  --config C        configuration (défaut config/niche.json)`;

export async function principal(argv, { client: clientInjecte, journal = console.log } = {}) {
  const options = lireOptions(argv, { drapeaux: ["tous-statuts", "aide"], valeurs: ["tiers", "limite", "dossier", "config", "workspace"] });
  if (options.aide) {
    journal(AIDE);
    return 0;
  }
  const f = fichiers(dossierDeTravail(options.dossier));
  const { niche } = await chargerConfig(options.config ?? CONFIG_PAR_DEFAUT);
  if (!niche.accroche.actif) throw new Error("Accroches désactivées dans la configuration (accroche.actif : false) : rien n'est exporté.");
  const tiers = liste(options, "tiers");
  if (tiers && tiers.some((t) => !["A", "B", "C"].includes(t))) throw new ErreurOptions("--tiers : A, B ou C (par exemple --tiers A,B)");
  const limite = entier(options, "limite", { defaut: null, min: 1 });
  const statuts = options["tous-statuts"] ? TOUS_LES_STATUTS : STATUTS_PAR_DEFAUT;

  const client = clientInjecte ?? (await connecter());
  try {
    const workspace = await resoudreEquipe(client, options.workspace ?? null);
    const { avecSite, dejaUneAccroche } = await compterFiches(client, { workspace });
    const fichesALire = await exporterFiches(client, { workspace, statuts, tiers, limite });
    ecrireJson(f.aCrawler, fichesALire);
    journal(`Fiches avec un site : ${avecSite} ; dont déjà une accroche : ${dejaUneAccroche}.`);
    journal(`Exportées (${statuts.join(", ")}${tiers ? ` ; tiers ${tiers.join(", ")}` : ""} ; hors opposition) : ${fichesALire.length}.`);
    return 0;
  } finally {
    if (!clientInjecte) await client.end();
  }
}

lancerSiPrincipal(import.meta.url, principal);
