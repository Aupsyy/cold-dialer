// La configuration publique de Supabase : l'URL du projet et la clé « anon » (ou « publishable »). Les deux sont PUBLIQUES par
// conception : ce qui protège les données, c'est la RLS en base. La clé service n'est lue que par lib/supabase/service.ts (serveur).
// Lecture littérale de process.env.NEXT_PUBLIC_… : Next.js remplace ces valeurs au build dans le code du navigateur.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function supabaseConfigure(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
}

export function exigerConfigSupabase(): void {
  if (!supabaseConfigure()) {
    throw new Error("Configuration Supabase manquante : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir .env.example).");
  }
}
