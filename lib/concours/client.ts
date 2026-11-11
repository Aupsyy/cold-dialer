// Le client du service de session commune. Module PUR : le réseau (fetch) et l'attente sont injectés, donc testable sans réseau.
// Règles :
//   - seuls des COMPTEURS partent : la requête d'un événement ne porte que { jeton, issue } (et « annuler »), ou { jeton, debut } pour le
//     début d'un appel, jamais une donnée de fiche ;
//   - un envoi ne bloque ni ne fait échouer l'enregistrement d'un appel : il ne lève jamais, il rend un état ; délai de 3 secondes ;
//   - les erreurs sont avalées et COMPTÉES par code (jamais de message, d'adresse ni de jeton) ;
//   - un « 429 trop_vite » est retenté une fois après 2 secondes.
// Contrat du service : docs/concours.md.

import { baseApi, type ConfigConcours } from "./configuration";
import type { IssueConcours } from "./traduction";

export const DELAI_MS = 3000;
export const ATTENTE_TROP_VITE_MS = 2000;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface OptionsReseau {
  fetch?: Fetch;
  /** Le délai maximal d'une requête (3 s par défaut). */
  delaiMs?: number;
  /** L'attente avant la nouvelle tentative d'un « trop_vite » (2 s par défaut). */
  attendre?: (ms: number) => Promise<void>;
}

export type EtatEnvoi = "envoye" | "echec";

/** Les compteurs du processus : des nombres et des codes, rien d'autre. */
export const compteursConcours: { envoyes: number; echecs: number; parCode: Record<string, number> } = { envoyes: 0, echecs: 0, parCode: {} };

export function remettreCompteurs(): void {
  compteursConcours.envoyes = 0;
  compteursConcours.echecs = 0;
  compteursConcours.parCode = {};
}

function compterEchec(code: string): void {
  compteursConcours.echecs += 1;
  compteursConcours.parCode[code] = (compteursConcours.parCode[code] ?? 0) + 1;
}

const attenteReelle = (ms: number) => new Promise<void>((fin) => setTimeout(fin, ms));

/** Une requête JSON avec un délai ; { statut, corps } (corps null s'il n'est pas du JSON), ou lève (délai, réseau). Rien n'est suivi en redirection. */
async function requete(
  url: string,
  methode: "GET" | "POST",
  corps: unknown,
  o: OptionsReseau,
): Promise<{ statut: number; corps: Record<string, unknown> | null }> {
  const appeler: Fetch = o.fetch ?? ((u, init) => fetch(u, init));
  const init: RequestInit = {
    method: methode,
    headers: methode === "POST" ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
    body: methode === "POST" ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(o.delaiMs ?? DELAI_MS),
    redirect: "error",
    cache: "no-store",
  };
  const r = await appeler(url, init);
  let json: Record<string, unknown> | null = null;
  try {
    const lu: unknown = await r.json();
    json = lu !== null && typeof lu === "object" && !Array.isArray(lu) ? (lu as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { statut: r.status, corps: json };
}

const codeDe = (corps: Record<string, unknown> | null): string => (typeof corps?.erreur === "string" && /^[a-z_]{2,30}$/.test(corps.erreur) ? corps.erreur : "");

function codeEchec(e: unknown): string {
  const nom = e instanceof Error ? e.name : "";
  return nom === "TimeoutError" || nom === "AbortError" ? "delai" : "reseau";
}

/**
 * Envoie un événement (une issue, ou son annulation) à la session. NE LÈVE JAMAIS. Le corps ne porte que le jeton et l'issue du concours.
 */
export async function envoyerEvenement(
  config: ConfigConcours,
  issue: IssueConcours,
  options: OptionsReseau & { annuler?: boolean } = {},
): Promise<EtatEnvoi> {
  try {
    const corps: Record<string, unknown> = { jeton: config.jeton, issue };
    if (options.annuler) corps.annuler = true;
    const url = `${baseApi(config)}/evenement`;
    let r = await requete(url, "POST", corps, options);
    if (r.statut === 429 && codeDe(r.corps) === "trop_vite") {
      await (options.attendre ?? attenteReelle)(ATTENTE_TROP_VITE_MS);
      r = await requete(url, "POST", corps, options);
    }
    if (r.statut === 200) {
      compteursConcours.envoyes += 1;
      return "envoye";
    }
    compterEchec(codeDe(r.corps) || `http_${r.statut}`);
    return "echec";
  } catch (e) {
    compterEchec(codeEchec(e));
    return "echec";
  }
}

export type EtatDebut = "envoye" | "ignore" | "echec";

/**
 * Prévient la session qu'un appel vient d'être lancé, pour qu'elle le chronomètre (POST …/evenement, corps { jeton, debut: true }).
 * NE LÈVE JAMAIS, même délai de 3 secondes que l'envoi d'une issue. Le corps ne porte que le jeton et l'indicateur : aucune donnée de fiche.
 * Un service qui ne connaît pas encore « debut » répond 400 : c'est rendu « ignore », sans rien casser ni compter comme un échec. C'est un
 * signal de confort : il n'est pas retenté et ne touche pas aux compteurs d'envois.
 */
export async function envoyerDebut(config: ConfigConcours, options: OptionsReseau = {}): Promise<EtatDebut> {
  try {
    const r = await requete(`${baseApi(config)}/evenement`, "POST", { jeton: config.jeton, debut: true }, options);
    if (r.statut === 200) return "envoye";
    return r.statut === 400 ? "ignore" : "echec";
  } catch {
    return "echec";
  }
}

export interface ParticipantClassement {
  pseudo: string;
  appels: number;
  conversations: number;
  rdv: number;
  source: string | null;
}

export interface ClassementSession {
  titre: string;
  ouverte: boolean | null;
  debut: string | null;
  fin: string | null;
  participants: ParticipantClassement[];
}

const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const chaine = (v: unknown) => (typeof v === "string" ? v : null);

/** Le classement lu avec tolérance (un champ en trop ou en moins ne casse rien), ou null si la réponse n'a pas la forme attendue. */
export function lireClassement(corps: unknown): ClassementSession | null {
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) return null;
  const c = corps as Record<string, unknown>;
  if (!Array.isArray(c.participants)) return null;
  const s = c.session !== null && typeof c.session === "object" ? (c.session as Record<string, unknown>) : {};
  const participants: ParticipantClassement[] = [];
  for (const p of c.participants) {
    if (p === null || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.pseudo !== "string") continue;
    participants.push({ pseudo: o.pseudo, appels: nombre(o.appels), conversations: nombre(o.conversations), rdv: nombre(o.rdv), source: chaine(o.source) });
  }
  return { titre: chaine(s.titre) ?? "", ouverte: typeof s.ouverte === "boolean" ? s.ouverte : null, debut: chaine(s.debut), fin: chaine(s.fin), participants };
}

/** Le classement de la session (GET), ou null au moindre souci. Ne lève jamais. Sert à l'encart de Réglages et à classement.mjs. */
export async function lireSession(config: Pick<ConfigConcours, "url" | "code">, options: OptionsReseau = {}): Promise<ClassementSession | null> {
  try {
    const r = await requete(`${baseApi(config)}/classement`, "GET", undefined, options);
    return r.statut === 200 ? lireClassement(r.corps) : null;
  } catch {
    return null;
  }
}

export type ResultatRejoindre =
  | { ok: true; jeton: string; pseudo: string }
  | { ok: false; erreur: string };

const MESSAGES_REJOINDRE: Readonly<Record<string, string>> = {
  session_inconnue: "Cette session n'existe pas : vérifie le code.",
  session_fermee: "Cette session est fermée.",
  session_pleine: "Cette session est pleine.",
  pseudo_pris: "Ce pseudo est déjà pris : choisis-en un autre.",
  pseudo_invalide: "Ce pseudo n'est pas accepté : choisis-en un autre.",
};

/** Rejoint la session (POST …/rejoindre). Ne lève jamais ; le message d'erreur ne cite ni adresse ni jeton. */
export async function rejoindre(
  config: Pick<ConfigConcours, "url" | "code">,
  pseudo: string,
  options: OptionsReseau = {},
): Promise<ResultatRejoindre> {
  try {
    const r = await requete(`${baseApi(config)}/rejoindre`, "POST", { pseudo, source: "dialer" }, options);
    if (r.statut === 200) {
      const jeton = r.corps?.jeton;
      if (typeof jeton !== "string" || jeton === "") return { ok: false, erreur: "Réponse du service illisible." };
      return { ok: true, jeton, pseudo: typeof r.corps?.pseudo === "string" ? r.corps.pseudo : pseudo };
    }
    const code = codeDe(r.corps);
    return { ok: false, erreur: MESSAGES_REJOINDRE[code] ?? `Le service a refusé (code ${code || r.statut}).` };
  } catch (e) {
    return { ok: false, erreur: codeEchec(e) === "delai" ? "Le service n'a pas répondu à temps." : "Le service est injoignable." };
  }
}
