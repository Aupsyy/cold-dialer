// Les messages des pages d'accès, par code (les codes voyagent dans l'adresse : ?erreur=identifiants). Jamais de donnée personnelle.

export const ERREURS_CONNEXION: Readonly<Record<string, string>> = {
  champs: "Saisis ton e-mail et ton mot de passe.",
  identifiants: "E-mail ou mot de passe incorrect.",
  "non-confirme": "Confirme d'abord ton e-mail : clique sur le lien reçu.",
  lien: "Ce lien n'est plus valable. Connecte-toi, ou demande un nouveau lien.",
};

export const ERREURS_INSCRIPTION: Readonly<Record<string, string>> = {
  champs: "Remplis tous les champs (nom : 120 caractères au plus).",
  email: "Cette adresse e-mail n'est pas valide.",
  "email-refuse": "Cette adresse e-mail est refusée. Essaie avec une autre.",
  "mdp-court": "Le mot de passe doit faire au moins 8 caractères.",
  "mdp-long": "Le mot de passe doit faire au plus 72 caractères.",
  "mdp-faible": "Ce mot de passe est trop faible : choisis-en un plus long ou moins courant.",
  "quota-email": "Trop d'envois d'e-mails pour l'instant. Réessaie dans quelques minutes.",
  invitation: "Invitation refusée : lien invalide, expiré, déjà utilisé ou prévu pour un autre e-mail.",
  inscription: "L'inscription n'a pas abouti. Réessaie dans un instant.",
};

export const ERREURS_OUBLI: Readonly<Record<string, string>> = {
  email: "Saisis une adresse e-mail valide.",
  lien: "Ce lien de réinitialisation n'est plus valable : demandes-en un nouveau.",
};

export const ERREURS_NOUVEAU_MOT_DE_PASSE: Readonly<Record<string, string>> = {
  champs: "Remplis les deux champs.",
  "mdp-court": "Le mot de passe doit faire au moins 8 caractères.",
  "mdp-long": "Le mot de passe doit faire au plus 72 caractères.",
  confirmation: "Les deux mots de passe ne sont pas identiques.",
  identique: "Choisis un mot de passe différent de l'actuel.",
  "mdp-faible": "Ce mot de passe est trop faible.",
  session: "Ta session a expiré : redemande un lien de réinitialisation.",
  echec: "Le changement n'a pas abouti. Réessaie dans un instant.",
};

export function message(table: Readonly<Record<string, string>>, code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(table, code) ? (table[code] ?? null) : null;
}
