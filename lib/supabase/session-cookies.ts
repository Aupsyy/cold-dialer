// Les cookies de session posés par @supabase/ssr : « sb-<projet>-auth-token », ses morceaux « .0 », « .1 »… et le vérificateur de code
// « …-code-verifier ». La déconnexion les efface tous, même si le serveur de Supabase ne répond pas. Module PUR.

export function estCookieDeSession(nom: string): boolean {
  return /^sb-[A-Za-z0-9_-]+-auth-token(\.\d+)?(-code-verifier)?$/.test(nom);
}

export function nomsCookiesDeSession(noms: readonly string[]): string[] {
  return noms.filter(estCookieDeSession);
}
