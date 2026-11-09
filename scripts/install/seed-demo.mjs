// La démonstration : 40 fiches 100 % FICTIVES (supabase/seed-demo.sql) pour essayer le Poste sans aucune donnée réelle :
// « Atelier Démo 01 » à « 40 » (niche d'exemple : paysage et jardins), numéros des plages réservées à la fiction (01 99 00 xx xx,
// 06 39 98 xx xx), e-mails @example.com, sites example.org, SIREN invalides ; une fiche en « ne plus contacter » avec son opposition.
//
// SIMULATION PAR DÉFAUT : tout est joué dans une transaction annulée ; des compteurs seulement. --appliquer : la même transaction, validée.
// Refus (sauf --forcer) : une base dont l'équipe a déjà des fiches réelles (la démo s'y mélangerait), ou une base sans équipe (crée
// d'abord le compte propriétaire : node scripts/install/equipe.mjs ; avec --forcer, la graine crée une « Équipe démo »).
// --effacer : retire la démonstration (les fiches reconnues à la fois par leur source « demo », leur nom « Atelier Démo NN » et leur
// SIREN fictif ; les lignes d'opposition qui portent leurs identifiants ; la ligne d'import « demo ») ; simulation d'abord, puis
// --effacer --appliquer.
// Connexion : SUPABASE_DB_URL (environnement, sinon .env.local) ; jamais affichée. Une erreur de la base : son code seulement.
//
// Usage : node scripts/install/seed-demo.mjs [--appliquer] [--forcer] [--effacer]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  afficher,
  codeErreur,
  connecter,
  estLance,
  lireArguments,
  messageSur,
  ordresTransaction,
  RACINE,
  urlBase,
} from "./lib.mjs";

export const CHEMIN_GRAINE = join(RACINE, "supabase", "seed-demo.sql");

const USAGE = [
  "Usage : node scripts/install/seed-demo.mjs [--appliquer] [--forcer] [--effacer]",
  "  Ajoute 40 fiches 100 % fictives (supabase/seed-demo.sql) dans l'équipe de la base SUPABASE_DB_URL (.env.local).",
  "  (sans option)  SIMULATION : tout est joué puis annulé, des compteurs seulement",
  "  --appliquer    écrit pour de bon (une seule transaction)",
  "  --forcer       accepte une base qui a déjà des fiches réelles, ou sans équipe (une « Équipe démo » est alors créée)",
  "  --effacer      retire la démonstration (fiches fictives, leur opposition, leur ligne d'import) ; avec --appliquer pour de bon",
].join("\n");

/** Une fiche de la démonstration : source « demo », nom « Atelier Démo NN » et SIREN fictif (000000xxx), les trois à la fois. */
const FICHE_DEMO = "l.sources @> '[{\"type\": \"demo\"}]'::jsonb and l.entreprise ~ '^Atelier Démo [0-9]{2}$' and l.siren ~ '^0{6}[0-9]{3}$'";
/** Les lignes d'opposition qui portent un identifiant (SIREN, numéro) d'une fiche de la démonstration : tous fictifs. */
const OPPOSITION_DEMO = `(o.siren in (select l.siren from public.leads l where l.workspace_id = o.workspace_id and ${FICHE_DEMO})
   or o.tel9 in (select public.tel9(x.numero) from public.leads l cross join lateral (values (l.telephone), (l.mobile)) as x(numero)
                  where l.workspace_id = o.workspace_id and ${FICHE_DEMO} and x.numero is not null))`;

async function nombre(client, sql, params = []) {
  return Number((await client.query(sql, params)).rows[0]?.n ?? 0);
}

async function etatBase(client) {
  const equipes = await nombre(client, "select count(*)::int as n from public.workspaces");
  const ws = (await client.query("select public.workspace_resolu(null) as id")).rows[0]?.id ?? null;
  if (!ws) return { equipes, ws: null, reelles: 0, demo: 0 };
  const demo = await nombre(client, `select count(*)::int as n from public.leads l where l.workspace_id = $1 and ${FICHE_DEMO}`, [ws]);
  const toutes = await nombre(client, "select count(*)::int as n from public.leads l where l.workspace_id = $1", [ws]);
  return { equipes, ws, reelles: toutes - demo, demo };
}

/**
 * Le travail, testable sur une base locale : `client` est une connexion pg ouverte. options : { appliquer, forcer, effacer, sql,
 * transactionExterne } (transactionExterne : un point de sauvegarde dans la transaction de l'appelant, pour les tests). Renvoie
 * { code, lignes, erreur } ; des compteurs seulement.
 */
export async function executerGraine(client, options = {}) {
  const lignes = [];
  const appliquer = Boolean(options.appliquer);
  const ordres = ordresTransaction(Boolean(options.transactionExterne), "graine_demo");
  const refus = (message) => ({ code: 1, lignes, erreur: message });

  await client.query(ordres.debut);
  let valide = false;
  try {
    const avant = await etatBase(client);
    if (avant.equipes > 1) return refus("Cette base a plusieurs équipes : la démonstration ne sait pas laquelle choisir (une instance, une équipe).");

    if (options.effacer) {
      if (!avant.ws) return refus("Aucune équipe dans cette base : il n'y a pas de démonstration à effacer.");
      // L'opposition d'abord : elle se reconnaît aux identifiants des fiches fictives, qui partent ensuite.
      const oppositions = (await client.query(`delete from public.opposition o where o.workspace_id = $1 and ${OPPOSITION_DEMO}`, [avant.ws])).rowCount ?? 0;
      const fiches = (await client.query(`delete from public.leads l where l.workspace_id = $1 and ${FICHE_DEMO}`, [avant.ws])).rowCount ?? 0;
      const imports = (await client.query("delete from public.imports i where i.workspace_id = $1 and i.source = 'demo'", [avant.ws])).rowCount ?? 0;
      lignes.push(appliquer ? "Démonstration effacée :" : "Simulation (rien n'est effacé) :");
      lignes.push(`  - fiches fictives ${appliquer ? "retirées" : "qui seraient retirées"} : ${fiches} (avec leur journal, leurs appels et leurs rendez-vous)`);
      lignes.push(`  - leurs lignes d'opposition : ${oppositions} ; ligne d'import « demo » : ${imports}`);
      lignes.push(`  - fiches réelles : ${avant.reelles}, jamais touchées`);
      if (!appliquer) lignes.push("Pour effacer pour de bon : node scripts/install/seed-demo.mjs --effacer --appliquer");
      valide = appliquer;
      return { code: 0, lignes, erreur: null };
    }

    if (!avant.ws && !options.forcer) {
      return refus("Aucune équipe dans cette base : crée d'abord le compte propriétaire (node scripts/install/equipe.mjs), puis relance ; --forcer crée une « Équipe démo ».");
    }
    if (avant.reelles > 0 && !options.forcer) {
      return refus(`L'équipe a déjà ${avant.reelles} fiche(s) réelle(s) : la démonstration s'y mélangerait. --forcer pour l'ajouter quand même (--effacer la retire ensuite).`);
    }
    await client.query(options.sql ?? readFileSync(CHEMIN_GRAINE, "utf8"));

    const apres = await etatBase(client);
    const ajoutees = apres.demo - avant.demo;
    const enOpposition = await nombre(
      client,
      `select count(*)::int as n from public.leads l where l.workspace_id = $1 and ${FICHE_DEMO} and l.statut = 'ne_plus_contacter'`,
      [apres.ws],
    );
    lignes.push(appliquer ? "Démonstration ajoutée :" : "Simulation (rien n'est gardé) :");
    lignes.push(`  - équipe : ${avant.ws ? "celle de la base" : appliquer ? "« Équipe démo », créée" : "« Équipe démo », qui serait créée"}`);
    lignes.push(`  - fiches fictives ${appliquer ? "ajoutées" : "qui seraient ajoutées"} : ${ajoutees} (déjà là : ${avant.demo})`);
    lignes.push(`  - dont en « ne plus contacter », sur la liste d'opposition : ${enOpposition}`);
    if (!appliquer) lignes.push(`Pour écrire pour de bon : node scripts/install/seed-demo.mjs --appliquer${options.forcer ? " --forcer" : ""}`);
    else lignes.push("Pour la retirer plus tard : node scripts/install/seed-demo.mjs --effacer (simulation), puis --effacer --appliquer");
    valide = appliquer;
    return { code: 0, lignes, erreur: null };
  } catch (e) {
    return refus(`la base a refusé (code ${codeErreur(e)}) ; rien n'a été écrit.`);
  } finally {
    await client.query(valide ? ordres.valider : ordres.annuler).catch(() => {});
  }
}

async function main() {
  let client = null;
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--appliquer": "booleen",
      "--forcer": "booleen",
      "--effacer": "booleen",
    });
    if (options.aide || positionnels.length > 0) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    client = await connecter(urlBase(), "cold-dialer-demo");
    const r = await executerGraine(client, options);
    afficher(r.lignes);
    if (r.erreur) console.error(`ERREUR : ${r.erreur}`);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}

if (estLance(import.meta.url)) await main();

