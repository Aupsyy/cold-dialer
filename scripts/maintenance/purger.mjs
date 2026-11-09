// La purge RGPD en ligne de commande : la même que le bouton « Purger les fiches inactives » de l'écran Réglages, pour qui préfère son
// terminal ou une tâche planifiée hors de Vercel (aucune tâche planifiée de l'application ne lance la purge).
//
//   SIMULATION PAR DÉFAUT : la purge est jouée dans une transaction ANNULÉE, ce qui donne les compteurs exacts de ce qu'elle effacerait ;
//   rien n'est effacé, aucun audio n'est touché.
//   --appliquer : purger_fiches_inactives (durée legal.conservationMois de config/niche.json) et purger_integrations_evenements (90 jours)
//   sont validées ; puis les audios qu'elles désignent sont effacés du bucket privé « enregistrements » avec la clé service, puis les
//   audios restés sans appel (purges précédentes). La clé service : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY, de
//   l'environnement, sinon de .env.local (le reste du fichier n'est pas lu), jamais affichées. Sans elles, la base est purgée et le
//   script dit combien d'audios restent à effacer : le bouton « Purger les fiches inactives » de l'écran Réglages les retrouve et les
//   efface.
// Connexion : SUPABASE_DB_URL (environnement, sinon .env.local), jamais affichée. Sortie : des compteurs et des codes ; jamais un
// identifiant, un chemin d'audio ni une valeur.
// Code de sortie : 0 tout est fait (ou simulé) ; 1 erreur, rien n'est effacé ; 2 la base est purgée mais des audios restent à effacer.
//
// Usage : node scripts/maintenance/purger.mjs [--appliquer] [--config <fichier>]

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  afficher,
  chargerNiche,
  codeErreur,
  connecter,
  estLance,
  lireArguments,
  messageSur,
  ordresTransaction,
  RACINE,
  urlBase,
} from "../install/lib.mjs";

export const VARIABLES_STOCKAGE = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

const USAGE = [
  "Usage : node scripts/maintenance/purger.mjs [--appliquer] [--config <fichier>]",
  "  (sans --appliquer)  SIMULATION : la purge est jouée puis annulée ; les compteurs exacts, rien n'est effacé",
  "  --appliquer         purge pour de bon : la base (legal.conservationMois de la config), le journal des webhooks (90 jours),",
  "                      puis les audios du bucket « enregistrements » (avec NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY)",
  "  --config <fichier>  une autre config que config/niche.json",
  "Code de sortie : 0 fait (ou simulé) ; 1 erreur, rien n'est effacé ; 2 base purgée, des audios restent à effacer (écran Réglages).",
].join("\n");

const pluriel = (n, mot, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`;

/**
 * Les deux variables du stockage (URL du projet et clé service) : de l'environnement, sinon de .env.local à la racine (seulement ces deux
 * noms). Jamais affichées. Un objet { NOM: valeur } sans les absentes.
 */
export function envStockage(env = process.env, racine = RACINE) {
  const sortie = {};
  let fichier = null;
  for (const nom of VARIABLES_STOCKAGE) {
    let v = typeof env[nom] === "string" ? env[nom].trim() : "";
    if (!v) {
      if (fichier === null) {
        const chemin = join(racine, ".env.local");
        try {
          fichier = existsSync(chemin) ? parseEnv(readFileSync(chemin, "utf8")) : {};
        } catch {
          fichier = {};
        }
      }
      v = typeof fichier[nom] === "string" ? fichier[nom].trim() : "";
    }
    if (v) sortie[nom] = v;
  }
  return sortie;
}

export function stockageDisponible(envS) {
  return VARIABLES_STOCKAGE.every((n) => typeof envS[n] === "string" && envS[n] !== "");
}

/** Les modules TypeScript partagés avec l'écran (lib/reglages, lib/telephonie/stockage.ts), lus par le chargeur du dépôt. */
async function modules() {
  await import("../charger-ts.mjs");
  const [rgpd, audios, stockage] = await Promise.all([
    import("../../lib/reglages/rgpd.ts"),
    import("../../lib/reglages/audios.ts"),
    import("../../lib/telephonie/stockage.ts"),
  ]);
  return {
    lirePurge: rgpd.lirePurge,
    seuilAudiosOrphelins: rgpd.seuilAudiosOrphelins,
    balayerAudiosOrphelins: audios.balayerAudiosOrphelins,
    listerParStockage: audios.listerParStockage,
    effacerDuStockage: stockage.effacerDuStockage,
  };
}

/**
 * Les outils du stockage pour executerPurge, d'après les variables (null si elles manquent) : effacer un audio, et balayer les audios
 * restés sans appel, déposés avant la date limite de conservation (plus la marge de dépôt), jusqu'au bout (pas de limite de temps ici) ;
 * les appels encore là sont lus par la connexion à la base.
 */
export async function outilsStockage(client, envS, mois, f = fetch) {
  if (!stockageDisponible(envS)) return null;
  const m = await modules();
  return {
    effacer: (chemin) => m.effacerDuStockage(chemin, envS, f),
    balayer: async () => {
      const ws = (await client.query("select id::text as id from public.workspaces")).rows.map((r) => r.id);
      return m.balayerAudiosOrphelins({
        workspaceIds: ws,
        lister: m.listerParStockage(envS, f),
        references: async (chemins) => {
          try {
            const r = await client.query("select enregistrement_chemin as c from public.appels where enregistrement_chemin = any($1::text[])", [chemins]);
            return { ok: true, chemins: new Set(r.rows.map((x) => x.c)) };
          } catch (e) {
            return { ok: false, code: `references_${codeErreur(e)}` };
          }
        },
        effacer: (chemin) => m.effacerDuStockage(chemin, envS, f),
        avant: m.seuilAudiosOrphelins(Date.now(), mois),
        maxExamines: Number.POSITIVE_INFINITY,
      });
    },
  };
}

/**
 * Le travail, testable sur une base locale. client : connexion pg ouverte ; demande : { appliquer } ; d : { mois, stockage (outilsStockage
 * ou null), transactionExterne, lirePurge (facultatif : lib/reglages/rgpd.ts) }. Renvoie { code, lignes, erreur } : des compteurs, jamais
 * un identifiant ni un chemin.
 */
export async function executerPurgeScript(client, demande, d) {
  const lirePurge = d.lirePurge ?? (await modules()).lirePurge;
  const ordres = ordresTransaction(Boolean(d.transactionExterne), "purge_rgpd");
  const lignes = [];
  const annuler = () => client.query(ordres.annuler).catch(() => {});
  let base = null;
  let evenements = 0;
  await client.query(ordres.debut);
  try {
    base = lirePurge((await client.query("select public.purger_fiches_inactives($1) as r", [d.mois])).rows[0]?.r);
    if (base) evenements = Number((await client.query("select public.purger_integrations_evenements() as n")).rows[0]?.n ?? 0);
  } catch (e) {
    await annuler();
    return { code: 1, lignes, erreur: `la base a refusé la purge (code ${codeErreur(e)}) ; rien n'a été effacé.` };
  }
  if (!base) {
    await annuler();
    return { code: 1, lignes, erreur: "La base a répondu sans compteurs lisibles (la migration est-elle passée ?) ; rien n'a été effacé." };
  }
  if (demande.appliquer !== true) {
    await annuler();
  } else {
    // La validation peut échouer : alors rien n'est effacé, et surtout aucun audio d'un appel resté en base.
    try {
      await client.query(ordres.valider);
    } catch (e) {
      await annuler();
      return { code: 1, lignes, erreur: `la validation de la purge a échoué (code ${codeErreur(e)}) ; rien n'a été effacé.` };
    }
  }

  const audios = base.chemins.length;
  lignes.push(
    demande.appliquer
      ? `Fait (conservation : ${d.mois} mois, legal.conservationMois) :`
      : `Simulation, la purge est jouée puis annulée : rien n'est effacé (conservation : ${d.mois} mois, legal.conservationMois) :`,
  );
  const quoi = demande.appliquer ? "effacés" : "à effacer";
  lignes.push(`  - fiches sans activité ${demande.appliquer ? "effacées" : "à effacer"} : ${base.fiches} (avec leur journal et leurs débriefs)`);
  lignes.push(`  - ${quoi} aussi : appels ${base.appels}, rendez-vous ${base.rendezVous}, débriefs ${base.debriefs}, retours du marché ${base.retours}`);
  lignes.push(`  - événements de webhooks de plus de 90 jours ${quoi} : ${evenements}`);

  if (!demande.appliquer) {
    lignes.push(
      `  - audios à effacer du stockage : ${audios}${
        audios > 0 && !d.stockage ? " (NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY absentes ici : ils resteraient à effacer depuis l'écran Réglages)" : ""
      }`,
    );
    lignes.push("Pour purger pour de bon : la même commande avec --appliquer.");
    return { code: 0, lignes, erreur: null };
  }

  let code = 0;
  if (audios > 0 && !d.stockage) {
    lignes.push(
      `  - À FAIRE : ${pluriel(audios, "audio reste", "audios restent")} dans le bucket « enregistrements » : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquent ici.`,
    );
    lignes.push("    Lance « Purger les fiches inactives » dans l'écran Réglages (RGPD) : il retrouve et efface les audios restés sans appel.");
    code = 2;
  } else if (audios > 0) {
    let effaces = 0;
    const codes = new Set();
    for (const chemin of base.chemins) {
      const r = await d.stockage.effacer(chemin);
      if (r.ok) effaces++;
      else codes.add(r.code ?? "stockage");
    }
    lignes.push(`  - audios effacés du stockage : ${effaces}${effaces < audios ? ` ; en échec : ${audios - effaces} (code ${[...codes].join(", ")})` : ""}`);
    if (effaces < audios) code = 2;
  } else {
    lignes.push("  - audios à effacer du stockage : 0");
  }
  if (d.stockage) {
    const b = await d.stockage.balayer();
    lignes.push(
      `  - audios restés sans appel : ${b.effaces} ${b.effaces > 1 ? "effacés" : "effacé"} sur ${b.orphelins} trouvés (${b.examines} fichiers examinés)${
        b.complet ? "" : ` ; recherche arrêtée avant la fin${b.code ? ` (code ${b.code})` : ""} : relance la purge`
      }`,
    );
    if (b.enEchec > 0 || !b.complet) code = 2;
  }
  if (code === 2) lignes.push("Des audios restent à effacer : relance la purge (ici avec la clé service, ou depuis l'écran Réglages).");
  return { code, lignes, erreur: null };
}

async function main() {
  let client = null;
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), { "--appliquer": "booleen", "--config": "texte" });
    if (options.aide || positionnels.length > 0) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    client = await connecter(urlBase(), "cold-dialer-purge");
    const demande = { appliquer: Boolean(options.appliquer) };
    // En simulation, les outils ne servent qu'à dire si la clé service est là : rien n'est appelé.
    const stockage = await outilsStockage(client, envStockage(), niche.legal.conservationMois);
    const r = await executerPurgeScript(client, demande, { mois: niche.legal.conservationMois, stockage });
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
