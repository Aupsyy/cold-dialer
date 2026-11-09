// Le résultat d'une action serveur du Poste (même forme que Resultat de lib/server/action-kit.ts, redit ici pour que lib/poste reste PUR)
// et le journal en codes seulement. Jamais un numéro, un e-mail, un nom, une note ni un identifiant de fiche dans un journal.

export type Resultat<T> = { ok: true; data: T } | { ok: false; error: string };

/** Un journal de serveur : un code court (« poste:issue 23514 »), jamais une donnée. */
export type JournalCodes = (code: string) => void;

/** Le journal par défaut : la console du serveur, avec un code seulement. */
export const journalConsole: JournalCodes = (code) => {
  console.error(`[poste] ${code}`);
};

/** Le code d'une erreur de base, réduit à des caractères sûrs (jamais le message, qui peut citer une valeur). */
export function codeErreur(erreur: { code?: unknown } | null | undefined): string {
  const c = erreur?.code;
  return typeof c === "string" && /^[A-Za-z0-9_]{1,12}$/.test(c) ? c : "sans-code";
}
