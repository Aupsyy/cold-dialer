// Le socle commun des intégrations (téléphonie, agenda) : des types et de petits outils PURS, sans réseau ni base cachée.
//
// Règle pour tout ce qui est importé par un adaptateur : AUCUN module Node (« node:* ») et aucun accès au DOM au chargement du module.
// Le registre des adaptateurs est lu par le navigateur (le Poste), par next.config.ts (la Permissions-Policy, au build) et par les
// routes de webhook (serveur). La cryptographie passe donc par Web Crypto (globalThis.crypto.subtle), présent partout.
//
// Le journal ne porte que des CODES : jamais un numéro, un e-mail, un nom, une URL, un identifiant de fiche ni un secret.

export type Env = Readonly<Record<string, string | undefined>>;

/** Journal de serveur : un code court (« onoff:signature_refusee »), jamais une donnée personnelle. */
export type Journal = (code: string, grave?: boolean) => void;

export interface ErreurBase {
  code?: string;
  message?: string;
}

export interface ResultatBase {
  data: unknown;
  error: ErreurBase | null;
}

/** Un appel de fonction SQL (supabase.rpc) : injecté, pour tester sans réseau. */
export type Rpc = (fonction: string, args: Record<string, unknown>) => PromiseLike<ResultatBase>;

/** Un événement de webhook fait quelques Ko : au-delà de 256 Ko, on refuse sans lire (413). */
export const TAILLE_MAX_CORPS = 262_144;

/** Les variables de la base pour les routes serveur (la clé service n'a JAMAIS le préfixe NEXT_PUBLIC_). */
export const VARIABLES_BASE_SERVICE = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

export function objet(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Une chaîne non vide et bornée, sinon null. */
export function texte(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" || t.length > max ? null : t;
}

export function valeurEnv(env: Env, nom: string): string {
  const v = env[nom];
  return typeof v === "string" ? v.trim() : "";
}

/** Les NOMS des variables absentes ou vides (jamais une valeur). */
export function variablesManquantes(env: Env, noms: readonly string[]): string[] {
  return noms.filter((n) => valeurEnv(env, n) === "");
}

const encodeur = new TextEncoder();

function octets(v: Uint8Array | string): Uint8Array<ArrayBuffer> {
  return typeof v === "string" ? encodeur.encode(v) : new Uint8Array(v);
}

/** Égalité de deux secrets en temps constant (la durée ne dépend que de la longueur de la plus longue chaîne). */
export function egalTempsConstant(a: string, b: string): boolean {
  const ea = encodeur.encode(a);
  const eb = encodeur.encode(b);
  const n = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function hex(tampon: ArrayBuffer): string {
  return Array.from(new Uint8Array(tampon), (o) => o.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 en hexadécimal (signatures Calendly et autres), par Web Crypto. */
export async function hmacSha256Hex(secret: string, donnees: Uint8Array | string): Promise<string> {
  const cle = await crypto.subtle.importKey("raw", octets(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", cle, octets(donnees)));
}

/** SHA-256 en hexadécimal. */
export async function sha256Hex(donnees: Uint8Array | string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", octets(donnees)));
}
