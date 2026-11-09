// L'équipe de l'instance en ligne de commande (l'écran Réglages fait de même dans l'application) : le compte propriétaire, les invitations, les réglages de la base.
//
//   --proprietaire <e-mail> : la fonction SQL amorcer_workspace crée l'équipe (nom marque.nomEquipe, pays pays.code, fuseau pays.fuseau
//     de config/niche.json) et l'invitation de son propriétaire (valable 14 jours ; rejouable tant que personne ne l'a acceptée ; refusée
//     si l'équipe a déjà un propriétaire). Les réglages de l'équipe suivent la config : reglages.tentatives_max = config.tentativesMax
//     (la base a son propre plafond, « injoignable » ; sinon il resterait à 4), et --objectif N : reglages.objectif_appels_jour.
//   --inviter <e-mail> --role membre|appelant : une invitation de plus, une fois le propriétaire inscrit.
//   --reglages : seulement les réglages (après un changement de tentativesMax dans la config, ou pour --objectif).
// SIMULATION PAR DÉFAUT (transaction annulée : rien n'est gardé ni copié). --appliquer : écrit, et copie le lien d'inscription
// (https://<ton-domaine>/signup?invitation=…) dans le presse-papiers AVANT de valider : si la copie échoue, rien n'est écrit. Le lien
// et le jeton ne sont jamais affichés ; l'e-mail non plus.
// Connexion : SUPABASE_DB_URL (environnement, sinon .env.local) ; jamais affichée. Une erreur de la base : son code seulement.
//
// Usage : node scripts/install/equipe.mjs --proprietaire <e-mail> --domaine <https://ton-domaine> [--nom "<Prénom Nom>"] [--objectif N] [--appliquer]
//         node scripts/install/equipe.mjs --inviter <e-mail> --role membre|appelant --domaine <https://ton-domaine> [--nom "<Prénom Nom>"] [--appliquer]
//         node scripts/install/equipe.mjs --reglages [--objectif N] [--appliquer]

import { resolve } from "node:path";
import {
  afficher,
  chargerNiche,
  codeErreur,
  connecter,
  copierPressePapiers,
  ErreurInstall,
  estLance,
  lireArguments,
  messageSur,
  ordresTransaction,
  origineValide,
  urlBase,
} from "./lib.mjs";

export const ROLES_INVITES = ["membre", "appelant"];
const RE_EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const RE_JETON = /^[0-9a-f]{64}$/;

const USAGE = [
  "Usage : node scripts/install/equipe.mjs --proprietaire <e-mail> --domaine <https://ton-domaine> [--nom \"<Prénom Nom>\"] [--objectif N] [--appliquer]",
  "        node scripts/install/equipe.mjs --inviter <e-mail> --role membre|appelant --domaine <https://ton-domaine> [--nom \"<Prénom Nom>\"] [--appliquer]",
  "        node scripts/install/equipe.mjs --reglages [--objectif N] [--appliquer]",
  "  --proprietaire <e-mail>  crée l'équipe (nom, pays et fuseau de config/niche.json) et l'invitation de son propriétaire ;",
  "                           pose aussi les réglages (tentatives_max = tentativesMax de la config)",
  "  --inviter <e-mail>       une invitation de plus, une fois le propriétaire inscrit ; --role membre (gère l'équipe) ou appelant",
  "  --reglages               seulement les réglages de l'équipe (tentatives_max d'après la config, --objectif)",
  "  --domaine <https://…>    l'adresse de l'application, pour le lien d'inscription",
  "  --nom \"<Prénom Nom>\"     le nom affiché dans l'invitation (facultatif)",
  "  --objectif N             l'objectif d'appels par jour et par appelant (0 à 1000 ; 0 : pas d'objectif affiché)",
  "  (sans --appliquer)       SIMULATION : tout est joué puis annulé, rien n'est copié",
  "  --appliquer              écrit, puis copie le lien d'inscription (valable 14 jours) dans le presse-papiers : jamais affiché",
  "  --config <f>             une autre config que config/niche.json",
].join("\n");

/** Les options, vérifiées : { mode, email, nom, role, domaine, objectif, appliquer }. Lève ErreurInstall si elles ne vont pas. */
export function lireDemande(options) {
  const modes = ["proprietaire", "inviter", "reglages"].filter((m) => options[m] !== undefined);
  if (modes.length !== 1) throw new ErreurInstall("Choisis une action : --proprietaire <e-mail>, --inviter <e-mail> ou --reglages.");
  const mode = modes[0];
  const demande = { mode, appliquer: Boolean(options.appliquer), email: null, nom: null, role: null, domaine: null, objectif: null };
  if (options.objectif !== undefined) {
    if (!Number.isInteger(options.objectif) || options.objectif < 0 || options.objectif > 1000) throw new ErreurInstall("--objectif attend un entier de 0 à 1000.");
    if (mode === "inviter") throw new ErreurInstall("--objectif va avec --proprietaire ou --reglages.");
    demande.objectif = options.objectif;
  }
  if (mode === "reglages") {
    if (options.domaine !== undefined || options.nom !== undefined || options.role !== undefined) {
      throw new ErreurInstall("--reglages ne prend que --objectif et --appliquer.");
    }
    return demande;
  }
  const email = String(options[mode]).trim().toLowerCase();
  if (email.length > 254 || !RE_EMAIL.test(email)) throw new ErreurInstall("L'e-mail donné n'est pas valide.");
  demande.email = email;
  if (options.nom !== undefined) {
    const nom = String(options.nom).trim();
    if (nom.length < 1 || nom.length > 120) throw new ErreurInstall("--nom : 1 à 120 caractères.");
    demande.nom = nom;
  }
  const domaine = origineValide(options.domaine ?? "");
  if (!domaine) throw new ErreurInstall("--domaine attend l'adresse de l'application : https://ton-domaine.");
  demande.domaine = domaine;
  if (mode === "inviter") {
    if (!ROLES_INVITES.includes(options.role)) throw new ErreurInstall("--inviter demande --role membre ou --role appelant.");
    demande.role = options.role;
  } else if (options.role !== undefined) {
    throw new ErreurInstall("--role va avec --inviter (le propriétaire a son propre rôle).");
  }
  return demande;
}

async function nombre(client, sql, params = []) {
  return Number((await client.query(sql, params)).rows[0]?.n ?? 0);
}

async function poserReglages(client, ws, niche, objectif) {
  const r = await client.query(
    "update public.reglages set tentatives_max = $2, objectif_appels_jour = coalesce($3::int, objectif_appels_jour) where workspace_id = $1",
    [ws, niche.tentativesMax, objectif],
  );
  return r.rowCount ?? 0;
}

function ligneReglages(niche, objectif, appliquer) {
  const verbe = appliquer ? "posés" : "qui seraient posés";
  const obj = objectif === null ? "objectif d'appels par jour inchangé" : `objectif d'appels par jour : ${objectif}`;
  return `  - réglages ${verbe} : tentatives_max = ${niche.tentativesMax} (tentativesMax de la config), ${obj}`;
}

/**
 * Le travail, testable sur une base locale. client : connexion pg ouverte ; demande : lireDemande(…) ; d : { niche, copier(valeur) →
 * { ok } (le presse-papiers ; injecté par les tests), transactionExterne }. Renvoie { code, lignes, erreur } : jamais l'e-mail, le jeton
 * ni le lien.
 */
export async function executerEquipe(client, demande, d) {
  const lignes = [];
  const { niche } = d;
  const copier = d.copier ?? ((valeur) => copierPressePapiers(valeur));
  const ordres = ordresTransaction(Boolean(d.transactionExterne), "equipe_installation");
  const refus = (message) => ({ code: 1, lignes, erreur: message });
  const appliquer = demande.appliquer;

  await client.query(ordres.debut);
  let valide = false;
  try {
    const equipes = await nombre(client, "select count(*)::int as n from public.workspaces");
    if (equipes > 1) return refus("Cette base a plusieurs équipes : une instance, une équipe. Rien n'a été fait.");
    const ws = equipes === 1 ? (await client.query("select id from public.workspaces limit 1")).rows[0].id : null;
    const proprietaires = ws
      ? await nombre(client, "select count(*)::int as n from public.profiles where workspace_id = $1 and role = 'proprietaire'", [ws])
      : 0;

    let jeton = null;
    if (demande.mode === "proprietaire") {
      if (proprietaires > 0) return refus("L'équipe a déjà un propriétaire : c'est lui qui invite les autres (--inviter).");
      const r = await client.query("select public.amorcer_workspace($1, $2, $3, $4, $5) as r", [
        niche.marque.nomEquipe,
        demande.email,
        demande.nom,
        niche.pays.fuseau,
        niche.pays.code,
      ]);
      const res = r.rows[0]?.r ?? {};
      jeton = typeof res.jeton === "string" ? res.jeton : null;
      const nouvelle = typeof res.workspaceId === "string" ? res.workspaceId : ws;
      if (ws) {
        // Une équipe sans propriétaire (une « Équipe démo » de la graine, un essai) prend le nom, le pays et le fuseau de la config.
        await client.query("update public.workspaces set nom = $2, fuseau = $3, pays = $4 where id = $1", [ws, niche.marque.nomEquipe, niche.pays.fuseau, niche.pays.code]);
      }
      lignes.push(`  - équipe « ${niche.marque.nomEquipe} » : ${ws ? "déjà là, sans propriétaire (nom, pays et fuseau repris de la config)" : appliquer ? "créée" : "qui serait créée"}`);
      lignes.push(`  - invitation du propriétaire ${appliquer ? "créée" : "qui serait créée"} (pour l'e-mail donné, valable 14 jours)`);
      await poserReglages(client, nouvelle, niche, demande.objectif);
      lignes.push(ligneReglages(niche, demande.objectif, appliquer));
    } else if (demande.mode === "inviter") {
      if (!ws) return refus("Aucune équipe : crée d'abord le propriétaire (--proprietaire), puis relance.");
      if (proprietaires === 0) return refus("Le propriétaire n'est pas encore inscrit : il ouvre d'abord son lien d'invitation, puis il invite les autres.");
      const r = await client.query(
        "insert into public.invitations (workspace_id, role, email, nom_invite) values ($1, $2, $3, $4) returning jeton",
        [ws, demande.role, demande.email, demande.nom],
      );
      jeton = r.rows[0]?.jeton ?? null;
      lignes.push(`  - invitation « ${demande.role} » ${appliquer ? "créée" : "qui serait créée"} (pour l'e-mail donné, valable 14 jours)`);
    } else {
      if (!ws) return refus("Aucune équipe : crée d'abord le propriétaire (--proprietaire), puis relance.");
      await poserReglages(client, ws, niche, demande.objectif);
      lignes.push(ligneReglages(niche, demande.objectif, appliquer));
    }

    if (demande.mode !== "reglages") {
      if (!jeton || !RE_JETON.test(jeton)) return refus("La base n'a pas rendu d'invitation lisible ; rien n'a été écrit.");
      if (appliquer) {
        const lien = `${demande.domaine}/signup?invitation=${jeton}`;
        const copie = copier(lien);
        if (!copie?.ok) return refus("Copie impossible (aucun outil : pbcopy, clip, wl-copy ou xclip) : rien n'a été écrit.");
        lignes.push("  - le lien d'inscription est dans ton presse-papiers (jamais affiché) : ouvre-le dans ton navigateur ;");
        lignes.push("    crée le compte avec l'e-mail de l'invitation ; si Supabase envoie un e-mail de confirmation, ouvre son lien dans le même navigateur.");
      } else {
        lignes.push(`Pour écrire pour de bon : la même commande avec --appliquer.`);
      }
    } else if (!appliquer) {
      lignes.push("Pour écrire pour de bon : la même commande avec --appliquer.");
    }
    lignes.unshift(appliquer ? "Fait :" : "Simulation (rien n'est gardé, rien n'est copié) :");
    valide = appliquer;
    return { code: 0, lignes, erreur: null };
  } catch (e) {
    const code = codeErreur(e);
    const motif =
      code === "23505" ? "l'équipe a déjà un propriétaire, ou la base a plusieurs équipes" :
      code === "22023" ? "le nom d'équipe, le pays ou le fuseau de la config sont refusés par la base" :
      code === "23514" ? "une valeur est refusée par la base" :
      "la base a refusé";
    return refus(`${motif} (code ${code}) ; rien n'a été écrit.`);
  } finally {
    await client.query(valide ? ordres.valider : ordres.annuler).catch(() => {});
  }
}

async function main() {
  let client = null;
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), {
      "--proprietaire": "texte",
      "--inviter": "texte",
      "--reglages": "booleen",
      "--role": ROLES_INVITES,
      "--domaine": "texte",
      "--nom": "texte",
      "--objectif": "entier",
      "--appliquer": "booleen",
      "--config": "texte",
    });
    if (options.aide || positionnels.length > 0) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const demande = lireDemande(options);
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    client = await connecter(urlBase(), "cold-dialer-equipe");
    const r = await executerEquipe(client, demande, { niche });
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
