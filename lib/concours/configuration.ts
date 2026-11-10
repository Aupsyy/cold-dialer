// La session commune (concours d'appels entre équipes), module FACULTATIF : la configuration vient de trois variables d'environnement
// du serveur. Si l'une manque ou est invalide, le module est inactif et ne fait rien. Module PUR (aucun accès réseau ni disque).
//   CONCOURS_URL    l'adresse du service qui héberge la session (https obligatoire, sauf http://localhost pour les essais)
//   CONCOURS_CODE   le code de la session : 4 à 12 caractères, A-Z et 0-9
//   CONCOURS_JETON  le jeton rendu par « rejoindre » : il ne s'affiche jamais, ni dans l'écran ni dans les journaux

export const VARIABLES_CONCOURS = ["CONCOURS_URL", "CONCOURS_CODE", "CONCOURS_JETON"] as const;

export type EnvConcours = Readonly<Record<string, string | undefined>>;

export interface ConfigConcours {
  /** L'adresse du service, sans « / » final. */
  url: string;
  code: string;
  jeton: string;
}

const RE_CODE = /^[A-Z0-9]{4,12}$/;
const RE_JETON = /^[\x21-\x7e]{8,512}$/;

/** L'adresse du service, nettoyée : https, ou http sur cette machine (localhost, 127.0.0.1) ; sans identifiants ni paramètres. Sinon null. */
export function urlServiceValide(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  let u: URL;
  try {
    u = new URL(brut.trim());
  } catch {
    return null;
  }
  const locale = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && locale)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** Le code de la session en majuscules, ou null s'il n'a pas la bonne forme. */
export function codeSessionValide(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  const code = brut.trim().toUpperCase();
  return RE_CODE.test(code) ? code : null;
}

/** La configuration de la session commune, ou null (module inactif) si l'une des trois variables manque ou est invalide. */
export function lireConfigConcours(env: EnvConcours): ConfigConcours | null {
  const url = urlServiceValide(env.CONCOURS_URL);
  const code = codeSessionValide(env.CONCOURS_CODE);
  const jeton = typeof env.CONCOURS_JETON === "string" ? env.CONCOURS_JETON.trim() : "";
  if (!url || !code || !RE_JETON.test(jeton)) return null;
  return { url, code, jeton };
}

/** La base de l'API d'une session : {URL}/api/concours/{code}. */
export function baseApi(c: Pick<ConfigConcours, "url" | "code">): string {
  return `${c.url}/api/concours/${c.code}`;
}

/** La page publique de la session : {URL}/concours/{code}. */
export function pagePublique(c: Pick<ConfigConcours, "url" | "code">): string {
  return `${c.url}/concours/${c.code}`;
}
