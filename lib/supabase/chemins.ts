// Qui passe sans session, et où l'on renvoie un visiteur. Module PUR, testé par tests/middleware.test.mjs.
//
//   - Les routes d'intégration : /api/telephonie/… et /api/agenda/… (webhooks, flux ICS) vérifient elles-mêmes leur secret ou leur
//     signature ; /api/sante ne renvoie que des booléens. Le middleware les laisse passer sans toucher à la session.
//   - Les pages d'accès : connexion, inscription sur invitation, mot de passe oublié, retour des liens envoyés par e-mail (/auth/…).
//   - Tout le reste demande une session : une page renvoie vers /login, une route /api/ répond 401.

export const PREFIXES_API_PUBLIQUES = ["/api/telephonie/", "/api/agenda/"] as const;
export const ROUTES_API_PUBLIQUES = ["/api/sante"] as const;
export const PAGES_PUBLIQUES = ["/login", "/signup", "/mot-de-passe-oublie", "/auth"] as const;

/** Les pages où un compte déjà connecté n'a rien à faire : il est renvoyé vers l'accueil. */
export const PAGES_SANS_SESSION = ["/login", "/signup"] as const;

export const ACCUEIL = "/poste";

export type Decision = "suivant" | "refus_api" | "vers_connexion" | "vers_accueil";

export function estApiPublique(chemin: string): boolean {
  return (
    PREFIXES_API_PUBLIQUES.some((p) => chemin.startsWith(p)) ||
    ROUTES_API_PUBLIQUES.some((r) => chemin === r || chemin.startsWith(`${r}/`))
  );
}

export function estPagePublique(chemin: string): boolean {
  return PAGES_PUBLIQUES.some((p) => chemin === p || chemin.startsWith(`${p}/`));
}

export function decider(chemin: string, connecte: boolean): Decision {
  if (estApiPublique(chemin)) return "suivant";
  if (!connecte) {
    if (estPagePublique(chemin)) return "suivant";
    return chemin.startsWith("/api/") ? "refus_api" : "vers_connexion";
  }
  if ((PAGES_SANS_SESSION as readonly string[]).includes(chemin)) return "vers_accueil";
  return "suivant";
}

/** L'écran demandé avant la connexion, gardé seulement s'il s'agit d'un écran de l'application (jamais une adresse extérieure). */
export function cheminDeRetour(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 200) return null;
  return /^\/(poste|prospects|agenda|retours|reglages)(\/[A-Za-z0-9_-]+){0,3}\/?$/.test(v) ? v : null;
}

/** Un chemin interne (« /poste »), jamais une adresse extérieure (« //site », « \site », autre origine) ; sinon le repli. */
export function cheminInterne(brut: string | null, origine: string, repli: string): string {
  if (!brut || brut.length > 512 || !brut.startsWith("/") || brut.startsWith("//") || brut.includes("\\")) return repli;
  try {
    const url = new URL(brut, origine);
    if (url.origin !== origine || url.pathname.startsWith("//")) return repli;
    return `${url.pathname}${url.search}`;
  } catch {
    return repli;
  }
}
