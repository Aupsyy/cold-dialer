// Ce que l'écran Réglages partage entre le serveur (actions) et le navigateur (composants) : le lien d'une invitation et les phrases de
// l'effacement. Un module PUR, sans aucun import, pour que le navigateur ne charge rien d'autre.

export const RE_JETON_INVITATION = /^[0-9a-f]{64}$/;

/**
 * Le lien d'inscription d'une invitation : <origine>/signup?invitation=<jeton>. L'origine est celle de l'instance (https://…, ou
 * http://localhost en local) ; null si elle ou le jeton sont illisibles. Ce lien donne accès à l'équipe : il n'est jamais journalisé.
 */
export function lienInvitation(origine: string, jeton: string): string | null {
  if (!RE_JETON_INVITATION.test(jeton)) return null;
  let u: URL;
  try {
    u = new URL(origine);
  } catch {
    return null;
  }
  const locale = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if ((u.protocol !== "https:" && !(u.protocol === "http:" && locale)) || u.username || u.password) return null;
  return `${u.origin}/signup?invitation=${jeton}`;
}

/** Ce qu'est devenue la liste d'opposition lors de l'effacement d'une fiche. */
export type EtatOpposition = "deja" | "inscrite" | "non_demandee" | "sans_identifiant";

export const PHRASE_OPPOSITION: Readonly<Record<EtatOpposition, string>> = {
  deja: "Ses identifiants restent sur la liste d'opposition : elle ne sera plus rappelée, et aucun import ne la fera revenir.",
  inscrite: "Ses identifiants ont été inscrits sur la liste d'opposition : elle ne sera plus rappelée, et aucun import ne la fera revenir.",
  non_demandee: "Rien n'a été inscrit sur la liste d'opposition : un futur import pourrait la faire revenir.",
  sans_identifiant: "La fiche n'avait ni SIREN ni numéro lisible : rien n'a pu être inscrit sur la liste d'opposition.",
};
