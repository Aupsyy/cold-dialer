// Étape 8 des accroches : écrire en base les accroches retenues (donnees/accroches/validees.json).
//
//   node scripts/accroches/ecrire.mjs                 ESSAI (par défaut) : des compteurs, rien n'est écrit
//   node scripts/accroches/ecrire.mjs --appliquer     écrit, dans UNE transaction
//   options : --dossier D, --config C, --workspace <uuid> (obligatoire si la base a plusieurs équipes)
//
// Juste avant d'écrire, le contrôle anti-invention de valide.mjs est REJOUÉ sur chaque entrée, contre crawl.jsonl et compact.jsonl
// (lib/validation.mjs, verifierAccroche) : une entrée de validees.json modifiée après valide.mjs (à la main, ou par un agent trompé par
// le texte d'un site) n'est écrite que si le site prouve encore ce qu'elle dit. La page source, le site et l'origine viennent du crawl,
// jamais de validees.json ; la date est celle de la lecture de la page. Une accroche n'est écrite que si la fiche est de l'équipe, n'en
// a pas encore (jamais d'écrasement : rejouer ne change rien), n'est pas « ne plus contacter », et que la source est sur le site de la
// fiche. Écrit : leads.accroche, leads.accroche_source (l'adresse de la page) et une entrée datée dans leads.sources : { type:
// "accroche", url, extrait, le } (RGPD : d'où vient l'information, et quand). Compteurs : à écrire, déjà remplies, inconnues,
// écartées, refusées (mal formées, contrôle rejoué en échec, ou source hors du site). SUPABASE_DB_URL (environnement ou .env.local)
// n'est jamais affichée.

import { ErreurOptions, lireOptions } from "./lib/args.mjs";
import { connecter, resoudreEquipe } from "./lib/base.mjs";
import { CONFIG_PAR_DEFAUT, dossierDeTravail, fichiers } from "./lib/chemins.mjs";
import { chargerConfig } from "./lib/config.mjs";
import { dernieresParId, lireJson, lireJsonl } from "./lib/fichiers.mjs";
import { lancerSiPrincipal } from "./lib/lancer.mjs";
import { contexteFiche, dateDansFuseau, preparerRegles, verifierAccroche } from "./lib/validation.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Les bornes de la base (supabase/migrations/0001_schema.sql) : accroche 300 caractères, accroche_source 500 et http(s). */
const ACCROCHE_MAX = 300;
const URL_MAX = 500;
const EXTRAIT_MAX = 300;

const ENTREE_SOURCES = `jsonb_build_object('type', 'accroche', 'url', v.url, 'extrait', v.extrait, 'le', v.le)`;
const SQL_ECRIRE = `
update public.leads l
   set accroche = v.accroche,
       accroche_source = v.url,
       sources = l.sources || jsonb_build_array(${ENTREE_SOURCES})
  from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[]) as v(id, accroche, url, extrait, le)
 where l.id = v.id
   and l.workspace_id = $6::uuid
   and (l.accroche is null or btrim(l.accroche) = '')
   and l.statut <> 'ne_plus_contacter'
   and pg_column_size(l.sources || jsonb_build_array(${ENTREE_SOURCES})) <= 8000`;

function sansWww(hote) {
  return hote.toLowerCase().replace(/^www\./, "");
}

function memeHote(a, b) {
  try {
    return sansWww(new URL(a).hostname) === sansWww(new URL(b).hostname);
  } catch {
    return false;
  }
}

/** La source est-elle sur le site de la fiche ? (Ou sur l'origine atteinte au crawl, si le site redirigeait vers un autre domaine.) */
export function sourceSurLeSite(entree, site) {
  if (!site) return false;
  if (memeHote(entree.url, site)) return true;
  return Boolean(entree.site && entree.origine && memeHote(entree.site, site) && memeHote(entree.url, entree.origine));
}

/** Le contrôle rejoué avant l'écriture : les dernières lignes de crawl.jsonl et de compact.jsonl par fiche, les règles, le fuseau. */
export function preparerControle({ lignesCrawl, lignesCompact, niche, promesses }) {
  return {
    crawls: dernieresParId(lignesCrawl),
    compacts: dernieresParId(lignesCompact),
    regles: preparerRegles(niche, promesses),
    fuseau: niche.pays.fuseau,
  };
}

/**
 * Les entrées de validees.json qui peuvent être confrontées à la base : bien formées, puis REVÉRIFIÉES (verifierAccroche, contre le
 * crawl et le texte compacté de la fiche). L'adresse de la page, le site et l'origine sont pris dans crawl.jsonl, la date dans la
 * lecture de la page : rien de ce que dit validees.json sur la source n'est cru.
 * @param {unknown[]} validees
 * @param {ReturnType<typeof preparerControle>} controle
 */
export function entreesAEcrire(validees, controle) {
  if (!controle?.crawls || !controle?.compacts || !controle?.regles) {
    throw new Error("contrôle anti-invention impossible : crawl.jsonl, compact.jsonl et la configuration sont nécessaires");
  }
  const aExaminer = [];
  const compteurs = { lues: 0, sansAccroche: 0, refusees: 0 };
  const vus = new Set();
  for (const v of validees) {
    compteurs.lues++;
    if (v && typeof v === "object" && (!v.accroche || (Array.isArray(v.motifs) && v.motifs.length > 0))) {
      compteurs.sansAccroche++;
      continue;
    }
    const accroche = typeof v?.accroche === "string" ? v.accroche.trim() : "";
    const url = typeof v?.source?.url === "string" ? v.source.url.trim() : "";
    const extrait = typeof v?.source?.extrait === "string" ? v.source.extrait.trim() : "";
    const id = typeof v?.id === "string" ? v.id.trim().toLowerCase() : "";
    // Seule une entrée passée par le contrôle (valide.mjs écrit « motifs: [] ») peut être écrite.
    const bienFormee =
      Array.isArray(v?.motifs) &&
      UUID.test(id) &&
      !vus.has(id) &&
      accroche.length > 0 &&
      accroche.length <= ACCROCHE_MAX &&
      /^https?:\/\/\S+$/i.test(url) &&
      extrait.length > 0 &&
      extrait.length <= EXTRAIT_MAX;
    if (!bienFormee) {
      compteurs.refusees++;
      continue;
    }
    vus.add(id);
    // Le contrôle anti-invention, rejoué : la fiche doit avoir été lue, et le site doit encore prouver l'accroche.
    const crawl = controle.crawls.get(id) ?? controle.crawls.get(v.id.trim());
    const compact = controle.compacts.get(id) ?? controle.compacts.get(v.id.trim());
    if (!crawl || crawl.erreur || !Array.isArray(crawl.pages) || !compact) {
      compteurs.refusees++;
      continue;
    }
    const { motifs, page } = verifierAccroche({ accroche, source: { url, extrait } }, contexteFiche(compact, crawl), controle.regles);
    if (motifs.length > 0 || !page || !/^https?:\/\/\S+$/i.test(page.url) || page.url.length > URL_MAX) {
      compteurs.refusees++;
      continue;
    }
    aExaminer.push({
      id,
      accroche,
      url: page.url,
      extrait,
      le: dateDansFuseau(page.lu_le, controle.fuseau),
      site: typeof crawl.site === "string" ? crawl.site : null,
      origine: typeof crawl.origine === "string" ? crawl.origine : null,
    });
  }
  return { aExaminer, compteurs };
}

/**
 * Confronte les accroches à la base et, avec appliquer, les écrit, pour les fiches de l'équipe `workspace` seulement. controle : voir
 * preparerControle (obligatoire). transaction « propre » : begin/commit (le script) ; « externe » : un point de sauvegarde dans la
 * transaction de l'appelant (les tests, qui annulent tout à la fin).
 */
export async function ecrireAccroches(client, validees, { appliquer = false, transaction = "propre", controle, workspace } = {}) {
  if (!UUID.test(String(workspace ?? ""))) throw new Error("équipe (workspace) manquante : rien n'est lu ni écrit");
  const { aExaminer, compteurs: lus } = entreesAEcrire(validees, controle);
  const compteurs = { ...lus, aEcrire: 0, dejaRemplies: 0, inconnues: 0, ecartees: 0, ecrites: 0, nonEcrites: 0 };
  if (aExaminer.length === 0) return compteurs;

  const [debut, fin, annuler] =
    transaction === "propre"
      ? ["begin", "commit", "rollback"]
      : ["savepoint accroches_ecrire", "release savepoint accroches_ecrire", "rollback to savepoint accroches_ecrire"];
  if (appliquer) await client.query(debut);
  try {
    const { rows } = await client.query(
      `select id::text as id, statut, site, (accroche is not null and btrim(accroche) <> '') as remplie
         from public.leads where id = any($1::uuid[]) and workspace_id = $2::uuid${appliquer ? " for update" : ""}`,
      [aExaminer.map((e) => e.id), workspace],
    );
    const fiches = new Map(rows.map((r) => [r.id, r]));
    const retenues = [];
    for (const e of aExaminer) {
      const fiche = fiches.get(e.id);
      if (!fiche) compteurs.inconnues++;
      else if (fiche.statut === "ne_plus_contacter") compteurs.ecartees++;
      else if (fiche.remplie) compteurs.dejaRemplies++;
      else if (!sourceSurLeSite(e, fiche.site)) compteurs.refusees++;
      else {
        compteurs.aEcrire++;
        retenues.push(e);
      }
    }
    if (appliquer && retenues.length > 0) {
      const r = await client.query(SQL_ECRIRE, [
        retenues.map((e) => e.id),
        retenues.map((e) => e.accroche),
        retenues.map((e) => e.url),
        retenues.map((e) => e.extrait),
        retenues.map((e) => e.le),
        workspace,
      ]);
      compteurs.ecrites = r.rowCount;
      compteurs.nonEcrites = retenues.length - r.rowCount;
    }
    if (appliquer) await client.query(fin);
  } catch (e) {
    const cause = e?.code ? `code ${e.code}` : "erreur inattendue";
    if (!appliquer) throw new Error(`lecture des fiches impossible (${cause})`);
    await client.query(annuler).catch(() => {});
    throw new Error(`écriture annulée, rien n'a changé en base (${cause})`);
  }
  return compteurs;
}

const AIDE = `Écrit en base les accroches de validees.json, après avoir rejoué le contrôle anti-invention sur crawl.jsonl et compact.jsonl.
  --appliquer       écrire (une transaction) ; sans lui : essai, des compteurs seulement (--essai le dit explicitement)
  --workspace W     l'équipe (son identifiant), obligatoire si la base en a plusieurs
  --dossier D       dossier de travail (défaut donnees/accroches)
  --config C        configuration (défaut config/niche.json)`;

export async function principal(argv, { client: clientInjecte, journal = console.log } = {}) {
  const options = lireOptions(argv, { drapeaux: ["appliquer", "essai", "aide"], valeurs: ["dossier", "config", "workspace"] });
  if (options.aide) {
    journal(AIDE);
    return 0;
  }
  if (options.appliquer && options.essai) throw new ErreurOptions("--essai ou --appliquer, pas les deux");
  const appliquer = Boolean(options.appliquer);
  const f = fichiers(dossierDeTravail(options.dossier));
  const validees = lireJson(f.validees);
  if (!Array.isArray(validees)) throw new Error("validees.json illisible : relance valide.mjs.");
  const { niche, promesses } = await chargerConfig(options.config ?? CONFIG_PAR_DEFAUT);
  const lignesCrawl = lireJsonl(f.crawl).lignes;
  const lignesCompact = lireJsonl(f.compact).lignes;
  if (lignesCrawl.length === 0 || lignesCompact.length === 0) {
    throw new Error("crawl.jsonl ou compact.jsonl absent : le contrôle anti-invention est rejoué avant d'écrire, rien n'est écrit sans eux.");
  }
  const controle = preparerControle({ lignesCrawl, lignesCompact, niche, promesses });

  const client = clientInjecte ?? (await connecter());
  try {
    const workspace = await resoudreEquipe(client, options.workspace ?? null);
    const c = await ecrireAccroches(client, validees, { appliquer, transaction: clientInjecte ? "externe" : "propre", controle, workspace });
    journal(appliquer ? "Mode : ÉCRITURE (une transaction)." : "Mode : ESSAI, rien n'est écrit (--appliquer pour écrire).");
    journal(`Entrées lues : ${c.lues} ; sans accroche (vides ou vidées) : ${c.sansAccroche} ; refusées (mal formées, contrôle rejoué en échec ou source hors du site de la fiche) : ${c.refusees}.`);
    journal(`À écrire : ${c.aEcrire} ; déjà remplies (jamais écrasées) : ${c.dejaRemplies} ; inconnues : ${c.inconnues} ; écartées (ne plus contacter) : ${c.ecartees}.`);
    if (appliquer) journal(`Écrites : ${c.ecrites}${c.nonEcrites ? ` ; non écrites (fiche remplie entre-temps ou historique des sources plein) : ${c.nonEcrites}` : ""}.`);
    return 0;
  } finally {
    if (!clientInjecte) await client.end();
  }
}

lancerSiPrincipal(import.meta.url, principal);
