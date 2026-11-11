// Le branchement à une session commune rangé en base (migration 0002) : lecture du lien collé dans Réglages, pseudo, lecture des réponses
// des fonctions SQL, et choix de la configuration d'envoi (la base d'abord, les variables CONCOURS_* ensuite). Module PUR : aucun accès
// réseau, disque ni base ; le jeton ne passe que par les valeurs rendues, jamais par un message.

import { RE_JETON, codeSessionValide, lireConfigConcours, urlServiceValide, type ConfigConcours, type EnvConcours } from "./configuration";

/** Ce que l'équipe voit de son branchement : jamais le jeton. */
export interface EtatBranchement {
  url: string;
  code: string;
  pseudo: string;
  rejointLe: string | null;
}

export class ErreurLien extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurLien";
  }
}

const RE_PAGE = /^(.*)\/concours\/([A-Za-z0-9]{4,12})\/?$/;

const MESSAGE_HTTPS = "Le lien doit commencer par https:// (une adresse non sécurisée est refusée).";
const MESSAGE_LIEN = "Colle le lien complet de la session (il ressemble à https://example.org/concours/ABCD1234), ou l'adresse du service avec le code de la session.";

/**
 * L'adresse du service et le code de la session, d'après ce que la personne a collé. Accepte le lien public `https://…/concours/CODE`
 * (la fin « ?… » ou « #… » d'un lien copié est ignorée), ou l'adresse du service seule avec le code dans un second champ.
 * Lève une ErreurLien au message lisible.
 */
export function lireLienSession(lienBrut: unknown, codeBrut?: unknown): { url: string; code: string } {
  const lien = typeof lienBrut === "string" ? lienBrut.trim() : "";
  const codeSaisi = typeof codeBrut === "string" ? codeBrut.trim() : "";
  if (lien === "") throw new ErreurLien(MESSAGE_LIEN);
  let u: URL;
  try {
    u = new URL(lien);
  } catch {
    throw new ErreurLien(MESSAGE_LIEN);
  }
  if (u.username || u.password) throw new ErreurLien("Le lien ne doit contenir ni identifiant ni mot de passe.");
  const brut = `${u.origin}${u.pathname}`;
  const page = RE_PAGE.exec(brut);
  const urlSeule = urlServiceValide(page ? page[1] || u.origin : brut);
  if (!urlSeule) {
    if (u.protocol === "http:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") throw new ErreurLien(MESSAGE_HTTPS);
    throw new ErreurLien(MESSAGE_LIEN);
  }
  if (page) {
    const code = codeSessionValide(page[2]);
    if (!code) throw new ErreurLien(MESSAGE_LIEN);
    if (codeSaisi !== "" && codeSessionValide(codeSaisi) !== code) throw new ErreurLien("Le code saisi ne correspond pas à celui du lien.");
    return { url: urlSeule, code };
  }
  if (codeSaisi === "") throw new ErreurLien(MESSAGE_LIEN);
  const code = codeSessionValide(codeSaisi);
  if (!code) throw new ErreurLien("Le code de la session a 4 à 12 caractères : des lettres et des chiffres.");
  return { url: urlSeule, code };
}

/** Le pseudo : de 1 à 40 caractères, sans retour à la ligne ni caractère de contrôle. Lève une ErreurLien. */
export function pseudoSessionValide(brut: unknown): string {
  const p = typeof brut === "string" ? brut.trim() : "";
  if (p === "") throw new ErreurLien("Choisis un pseudo : c'est le nom de ton équipe au classement.");
  if (p.length > 40 || /[\u0000-\u001f\u007f]/.test(p)) throw new ErreurLien("Le pseudo a 40 caractères au plus, sans retour à la ligne.");
  return p;
}

function objet(brut: unknown): Record<string, unknown> | null {
  return brut !== null && typeof brut === "object" && !Array.isArray(brut) ? (brut as Record<string, unknown>) : null;
}

/** La réponse de concours_etat() (sans jeton), ou null si l'équipe n'est pas branchée ou si la réponse est illisible. */
export function lireEtatBranchement(brut: unknown): EtatBranchement | null {
  const o = objet(brut);
  if (!o) return null;
  const url = urlServiceValide(o.url);
  const code = codeSessionValide(o.code);
  if (!url || !code || typeof o.pseudo !== "string" || o.pseudo === "") return null;
  return { url, code, pseudo: o.pseudo, rejointLe: typeof o.rejoint_le === "string" ? o.rejoint_le : null };
}

/** La réponse de concours_jeton_serveur() : la configuration d'envoi complète, ou null. */
export function lireJetonServeur(brut: unknown): ConfigConcours | null {
  const o = objet(brut);
  if (!o) return null;
  const url = urlServiceValide(o.url);
  const code = codeSessionValide(o.code);
  const jeton = typeof o.jeton === "string" ? o.jeton : "";
  return url && code && RE_JETON.test(jeton) ? { url, code, jeton } : null;
}

/** Ce qui sert à l'envoi : le branchement en base d'abord, les variables d'environnement ensuite, sinon rien (module éteint). */
export function configurationEffective(enBase: ConfigConcours | null, env: EnvConcours): ConfigConcours | null {
  return enBase ?? lireConfigConcours(env);
}
