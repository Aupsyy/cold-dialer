// La vérification d'une instance déployée, de l'extérieur, comme le ferait un fournisseur : des lignes « OK » et « À FAIRE », jamais
// une valeur (ni secret, ni domaine, ni réponse brute).
//
//   1. /api/sante : des booléens (base joignable, schéma à jour, config valide, variables présentes) ; chaque faux est expliqué.
//   2. Le webhook de téléphonie (Onoff, Aircall, Ringover) et celui de l'agenda (Calendly, iClosed) de config/niche.json :
//      - un envoi avec un MAUVAIS secret doit être refusé (401 ; 503 veut dire variable absente dans Vercel) ;
//      - si le secret est connu ici (--env-file, ou l'environnement), un événement de TEST signé comme le fait le fournisseur doit être
//        accepté (200). L'événement est d'un type que l'application ignore : rien n'est écrit en base.
//      Onoff : en-tête X-API-KEY ; Aircall : champ token du corps ; Ringover et iClosed : ?secret= dans l'adresse ; Calendly : en-tête
//      Calendly-Webhook-Signature « t=<horodatage>,v1=<HMAC-SHA256 de « t.corps »> ».
//   3. Les deux tâches planifiées de vercel.json : avec un mauvais secret, 401 attendu (503 : CRON_SECRET absent). Elles ne sont pas
//      lancées pour de bon.
//   4. Les en-têtes de sécurité (sur /login) : Permissions-Policy (le micro à l'application et aux origines du fournisseur choisi),
//      X-Frame-Options, X-Content-Type-Options, Content-Security-Policy si elle est présente.
// Code de sortie : 0 si tout est OK, 1 s'il reste au moins une chose à faire.
//
// Usage : node scripts/install/verifier.mjs <https://ton-domaine> [--env-file <fichier>] [--config <niche.json>]

import { createHmac, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afficher, chargerNiche, ErreurInstall, estLance, lireArguments, lireFichierEnv, messageSur, origineValide } from "./lib.mjs";

export { origineValide };

const USAGE = [
  "Usage : node scripts/install/verifier.mjs <https://ton-domaine> [--env-file <fichier>] [--config <niche.json>]",
  "  Lit /api/sante, essaie le webhook de téléphonie et celui de l'agenda de la config (un mauvais secret doit être refusé ; avec",
  "  le bon secret, un événement de test doit être accepté, sans rien écrire en base), les tâches planifiées et les en-têtes.",
  "  --env-file <f>   les secrets des webhooks (lignes NOM=valeur) pour tester l'acceptation ; sans lui, le refus seulement",
  "  --config <f>     une autre config que config/niche.json (celle qui est déployée)",
  "  Sortie : des lignes « OK » et « À FAIRE », jamais une valeur. Code 0 : tout est OK ; 1 : au moins une chose à faire.",
].join("\n");

export const DELAI_MS = 15_000;

/** Les webhooks que l'application sait recevoir : le chemin, la variable du secret et la façon de signer un envoi. */
export const WEBHOOKS = {
  onoff: { libelle: "webhook Onoff", chemin: "/api/telephonie/onoff/webhook", variable: "ONOFF_WEBHOOK_TOKEN" },
  aircall: { libelle: "webhook Aircall", chemin: "/api/telephonie/aircall/webhook", variable: "AIRCALL_WEBHOOK_TOKEN" },
  ringover: { libelle: "webhook Ringover", chemin: "/api/telephonie/ringover/webhook", variable: "RINGOVER_WEBHOOK_SECRET" },
  calendly: { libelle: "webhook Calendly", chemin: "/api/agenda/calendly/webhook", variable: "CALENDLY_WEBHOOK_SIGNING_KEY" },
  iclosed: { libelle: "webhook iClosed", chemin: "/api/agenda/iclosed/webhook", variable: "ICLOSED_WEBHOOK_SECRET" },
};

export const TACHES_PLANIFIEES = ["/api/telephonie/recuperation", "/api/agenda/google/sync"];

/**
 * La requête de test d'un webhook, signée avec `secret` comme le fait le fournisseur. Le corps est un événement que l'application
 * IGNORE (type non suivi, ou tableau vide) : authentifié, il reçoit 200 sans rien écrire en base.
 */
export function requeteWebhook(fournisseur, origine, secret, maintenantS) {
  const w = WEBHOOKS[fournisseur];
  const url = new URL(w.chemin, origine);
  const entetes = { "content-type": "application/json", "user-agent": "cold-dialer-verifier/1.0" };
  let corps;
  switch (fournisseur) {
    case "onoff":
      corps = JSON.stringify({ eventName: "VERIFICATION", id: "verification-installation" });
      entetes["x-api-key"] = secret;
      break;
    case "aircall":
      corps = JSON.stringify({ event: "verification.installation", token: secret, data: {} });
      break;
    case "ringover":
      corps = JSON.stringify({ resource: "verification", event: "installation", data: {} });
      url.searchParams.set("secret", secret);
      break;
    case "calendly": {
      corps = JSON.stringify({ event: "verification.installation", created_at: new Date(maintenantS * 1000).toISOString(), payload: {} });
      const v1 = createHmac("sha256", secret).update(`${maintenantS}.${corps}`).digest("hex");
      entetes["calendly-webhook-signature"] = `t=${maintenantS},v1=${v1}`;
      break;
    }
    case "iclosed":
      corps = "[]";
      url.searchParams.set("secret", secret);
      break;
    default:
      throw new ErreurInstall("Fournisseur sans webhook.");
  }
  return { url: url.href, init: { method: "POST", headers: entetes, body: corps, redirect: "manual" } };
}

async function appeler(fetchFn, url, init) {
  try {
    const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(DELAI_MS) });
    return { statut: r.status, reponse: r };
  } catch {
    return { statut: 0, reponse: null };
  }
}

const listeNoms = (noms) => (noms.length > 0 ? noms.join(", ") : "aucune");

/** Les phrases de /api/sante, une par booléen. */
function lireSante(sante, besoins, ok, aFaire) {
  const v = sante.variables && typeof sante.variables === "object" ? sante.variables : {};
  const regles = [
    [sante.base_joignable, "/api/sante : la base répond",
      "/api/sante : la base ne répond pas : vérifie NEXT_PUBLIC_SUPABASE_URL et les clés dans Vercel, puis que le projet Supabase n'est pas en pause (offre gratuite : pause après 7 jours sans activité)."],
    [sante.schema_a_jour, "/api/sante : le schéma est à jour",
      "/api/sante : le schéma n'est pas à jour (ou illisible) : « supabase db push » (migrations 0001 et 0002), et SUPABASE_SERVICE_ROLE_KEY dans Vercel (seule elle lit la version), puis redéploie."],
    [sante.config_valide, "/api/sante : la config déployée est valide",
      "/api/sante : la config déployée est refusée : « npm test » ici, corrige config/niche.json, commit, puis redéploie."],
    [v.supabase_url, "/api/sante : NEXT_PUBLIC_SUPABASE_URL est posée",
      "/api/sante : NEXT_PUBLIC_SUPABASE_URL manque dans Vercel : colle-la (Supabase, Project Settings, API), puis redéploie."],
    [v.supabase_cle_anon, "/api/sante : NEXT_PUBLIC_SUPABASE_ANON_KEY est posée",
      "/api/sante : NEXT_PUBLIC_SUPABASE_ANON_KEY manque dans Vercel : colle la clé publique (anon ou publishable), puis redéploie."],
    [v.supabase_cle_service, "/api/sante : SUPABASE_SERVICE_ROLE_KEY est posée",
      "/api/sante : SUPABASE_SERVICE_ROLE_KEY manque dans Vercel : colle la clé secrète (service_role ou secret), jamais avec le préfixe NEXT_PUBLIC_, puis redéploie."],
    [v.telephonie, `/api/sante : les variables du webhook de téléphonie sont posées (${listeNoms(besoins.telephonie)})`,
      `/api/sante : il manque une variable de la téléphonie dans Vercel (${listeNoms(besoins.telephonie)}) : node scripts/install/secrets.mjs, ou colle-la toi-même, puis redéploie.`],
    [v.agenda, `/api/sante : les variables de l'agenda sont posées (${listeNoms(besoins.agenda)})`,
      `/api/sante : il manque une variable de l'agenda dans Vercel (${listeNoms(besoins.agenda)}) : node scripts/install/secrets.mjs, ou colle-la toi-même, puis redéploie.`],
  ];
  for (const [valeur, siVrai, siFaux] of regles) {
    if (valeur === true) ok(siVrai);
    else aFaire(siFaux);
  }
}

/** Ce que dit un refus attendu (mauvais secret). */
function lireRefus(w, statut, ok, aFaire) {
  if (statut === 401) ok(`${w.libelle} : un mauvais secret est refusé (401)`);
  else if (statut === 503) aFaire(`${w.libelle} : 503, ${w.variable} manque dans Vercel (ou est trop courte), ou la clé service manque : node scripts/install/secrets.mjs (ou colle-la toi-même), puis redéploie.`);
  else if (statut === 404) aFaire(`${w.libelle} : 404, l'application déployée n'attend pas ce fournisseur : vérifie config/niche.json, commit, puis redéploie.`);
  else if (statut >= 200 && statut < 300) aFaire(`${w.libelle} : un mauvais secret est ACCEPTÉ (${statut}) : ce n'est pas la version attendue de l'application, redéploie.`);
  else if (statut === 0) aFaire(`${w.libelle} : pas de réponse (réseau ou délai dépassé) : vérifie l'adresse et le déploiement.`);
  else aFaire(`${w.libelle} : réponse inattendue (${statut}) à un mauvais secret : regarde les journaux de Vercel (des codes seulement).`);
}

/** Ce que dit l'envoi signé avec le bon secret. */
function lireAcceptation(w, statut, ok, aFaire) {
  if (statut >= 200 && statut < 300) ok(`${w.libelle} : un événement de test signé avec le bon secret est accepté (${statut}), rien n'est écrit en base`);
  else if (statut === 401) {
    aFaire(`${w.libelle} : le bon secret est refusé (401) : la valeur locale n'est pas celle de Vercel (ou l'horloge de cette machine a plus de 3 minutes d'écart pour Calendly). Repose-la (node scripts/install/secrets.mjs --remplacer --copier ${w.variable}), recolle-la chez le fournisseur, redéploie.`);
  } else if (statut === 503) aFaire(`${w.libelle} : 503 avec le bon secret : ${w.variable} ou la clé service manque dans Vercel ; pose-la, puis redéploie.`);
  else if (statut === 0) aFaire(`${w.libelle} : pas de réponse à l'envoi signé (réseau ou délai dépassé).`);
  else aFaire(`${w.libelle} : réponse inattendue (${statut}) à un envoi signé : regarde les journaux de Vercel (des codes seulement).`);
}

/**
 * La vérification, testable : `fetch` est injecté. registres : { originesMicro(f), variablesTelephonie(f), variablesAgenda(f) } (lus dans
 * lib/telephonie/registre.ts et lib/agenda/registre.ts). secrets : NOM → valeur, seulement ceux connus ici. Renvoie { code, lignes }.
 */
export async function verifierInstance({ origine, niche, secrets = {}, fetch: fetchFn, maintenantS, registres, aleatoire = randomBytes }) {
  const lignes = [];
  const ok = (t) => lignes.push(`OK : ${t}`);
  const aFaire = (t) => lignes.push(`À FAIRE : ${t}`);
  const fin = () => ({ code: lignes.some((l) => l.startsWith("À FAIRE")) ? 1 : 0, lignes });
  const telephonie = niche.telephonie.fournisseur;
  const agenda = niche.agenda.fournisseur;
  const besoins = { telephonie: [...registres.variablesTelephonie(telephonie)], agenda: [...registres.variablesAgenda(agenda)] };

  // 1. /api/sante
  const s = await appeler(fetchFn, new URL("/api/sante", origine).href, { headers: { accept: "application/json" }, redirect: "manual" });
  if (s.statut === 0) {
    aFaire("l'adresse ne répond pas (réseau, nom de domaine ou déploiement) : vérifie le domaine de production dans Vercel.");
    return fin();
  }
  if (s.statut === 401 || s.statut === 403) {
    aFaire(`/api/sante répond ${s.statut} : la protection des déploiements de Vercel bloque cette adresse (les fournisseurs seraient bloqués aussi) : vérifie avec le domaine de PRODUCTION, ou règle Deployment Protection.`);
    return fin();
  }
  let sante = null;
  try {
    sante = await s.reponse.json();
  } catch {
    sante = null;
  }
  if (!sante || typeof sante !== "object" || typeof sante.ok !== "boolean") {
    aFaire(`/api/sante ne donne pas l'état attendu (${s.statut}) : ce n'est pas cette application, ou le déploiement a échoué (vercel deploy --prod).`);
    return fin();
  }
  lireSante(sante, besoins, ok, aFaire);

  // 2. Les webhooks de la config.
  const nonce = () => Buffer.from(aleatoire(32)).toString("base64url");
  for (const f of [telephonie, agenda]) {
    const w = WEBHOOKS[f];
    if (!w) continue;
    const faux = requeteWebhook(f, origine, nonce(), maintenantS());
    lireRefus(w, (await appeler(fetchFn, faux.url, faux.init)).statut, ok, aFaire);
    const vrai = typeof secrets[w.variable] === "string" ? secrets[w.variable].trim() : "";
    if (!vrai) {
      ok(`${w.libelle} : acceptation non testée (${w.variable} inconnue ici : --env-file) ; l'état de l'intégration se lit chez le fournisseur`);
      continue;
    }
    const bon = requeteWebhook(f, origine, vrai, maintenantS());
    lireAcceptation(w, (await appeler(fetchFn, bon.url, bon.init)).statut, ok, aFaire);
  }
  if (!WEBHOOKS[telephonie]) ok(`téléphonie « ${telephonie} » : pas de webhook à vérifier`);
  if (!WEBHOOKS[agenda]) ok(`agenda « ${agenda} » : pas de webhook à vérifier`);

  // 3. Les tâches planifiées : un mauvais secret doit être refusé (elles ne sont pas lancées).
  for (const chemin of TACHES_PLANIFIEES) {
    const r = await appeler(fetchFn, new URL(chemin, origine).href, { headers: { authorization: `Bearer ${nonce()}` }, redirect: "manual" });
    if (r.statut === 401) ok(`tâche planifiée ${chemin} : protégée, CRON_SECRET est posée (401 avec un mauvais secret)`);
    else if (r.statut === 503) aFaire(`tâche planifiée ${chemin} : CRON_SECRET manque dans Vercel (ou est trop courte) : node scripts/install/secrets.mjs, puis redéploie.`);
    else if (r.statut === 0) aFaire(`tâche planifiée ${chemin} : pas de réponse (réseau ou délai dépassé).`);
    else aFaire(`tâche planifiée ${chemin} : réponse inattendue (${r.statut}) à un mauvais secret : redéploie la dernière version.`);
  }

  // 4. Les en-têtes de sécurité.
  const p = await appeler(fetchFn, new URL("/login", origine).href, { redirect: "manual" });
  if (p.statut === 0 || !p.reponse) {
    aFaire("/login ne répond pas : les en-têtes de sécurité n'ont pas pu être lus.");
    return fin();
  }
  const entete = (nom) => p.reponse.headers.get(nom) ?? "";
  const politique = entete("permissions-policy");
  const micro = /(?:^|,)\s*microphone=\(([^)]*)\)/i.exec(politique)?.[1] ?? null;
  const origines = [...registres.originesMicro(telephonie)];
  const manquantes = micro === null ? origines : origines.filter((o) => !micro.includes(`"${o}"`));
  if (micro === null || !/\bself\b/.test(micro)) {
    aFaire("Permissions-Policy : le micro n'est pas réglé (l'en-tête manque) : redéploie la dernière version.");
  } else if (manquantes.length > 0) {
    aFaire(`Permissions-Policy : le micro n'est pas donné à ${telephonie} (${manquantes.length} origine(s) manquante(s)) : vérifie telephonie.fournisseur dans config/niche.json, puis redéploie (l'en-tête est calculé au build).`);
  } else {
    ok(`Permissions-Policy : le micro est permis à l'application${origines.length > 0 ? ` et à ${telephonie}` : ""}`);
  }
  if (entete("x-frame-options").toUpperCase() === "DENY") ok("X-Frame-Options : DENY (l'application ne s'affiche dans aucun autre site)");
  else aFaire("X-Frame-Options : DENY attendu : redéploie la dernière version.");
  if (entete("x-content-type-options").toLowerCase() === "nosniff") ok("X-Content-Type-Options : nosniff");
  else aFaire("X-Content-Type-Options : nosniff attendu : redéploie la dernière version.");
  const csp = entete("content-security-policy");
  if (!csp) ok("Content-Security-Policy : absente (permis)");
  else if (/frame-ancestors\s+'none'/i.test(csp)) ok("Content-Security-Policy : frame-ancestors 'none'");
  else aFaire("Content-Security-Policy : frame-ancestors 'none' attendu : redéploie la dernière version.");

  return fin();
}

/** Les registres de l'application (TypeScript), lus par le chargeur de Node. */
export async function chargerRegistres() {
  await import("../charger-ts.mjs");
  const tel = await import("../../lib/telephonie/registre.ts");
  const ag = await import("../../lib/agenda/registre.ts");
  return {
    originesMicro: (f) => tel.originesMicro(f),
    variablesTelephonie: (f) => tel.adaptateurTelephonie(f)?.webhook?.variables ?? [],
    variablesAgenda: (f) => ag.variablesAgenda(f),
  };
}

/** Les secrets des webhooks connus ici : le fichier --env-file d'abord, sinon l'environnement. Seulement les noms utiles. */
export function secretsLocaux(fichier, env = process.env) {
  const depuisFichier = fichier ? lireFichierEnv(fichier) : {};
  const secrets = {};
  for (const { variable } of Object.values(WEBHOOKS)) {
    const v = depuisFichier[variable] ?? env[variable];
    if (typeof v === "string" && v.trim() !== "") secrets[variable] = v;
  }
  return secrets;
}

async function main() {
  try {
    const { options, positionnels } = lireArguments(process.argv.slice(2), { "--env-file": "texte", "--config": "texte" });
    if (options.aide || positionnels.length !== 1) {
      afficher([USAGE]);
      process.exitCode = options.aide ? 0 : 1;
      return;
    }
    const origine = origineValide(positionnels[0]);
    if (!origine) throw new ErreurInstall("Adresse attendue : https://ton-domaine (ou http://localhost:3000 pour une instance locale).");
    const niche = await chargerNiche(options.config ? resolve(options.config) : undefined);
    const r = await verifierInstance({
      origine,
      niche,
      secrets: secretsLocaux(options.envFile ? resolve(options.envFile) : null),
      fetch: globalThis.fetch,
      maintenantS: () => Math.floor(Date.now() / 1000),
      registres: await chargerRegistres(),
    });
    afficher(r.lignes);
    const aFaire = r.lignes.filter((l) => l.startsWith("À FAIRE")).length;
    afficher([`Bilan : ${r.lignes.length - aFaire} OK, ${aFaire} à faire.`]);
    process.exitCode = r.code;
  } catch (e) {
    console.error(`ERREUR : ${messageSur(e)}`);
    process.exitCode = 1;
  }
}

if (estLance(import.meta.url)) await main();
