// Le client Supabase côté SERVEUR (server components, actions serveur, routes). Il lit la session dans les cookies : chaque requête passe
// par la RLS avec l'identité de la personne connectée. À créer à CHAQUE requête.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, exigerConfigSupabase } from "./config";

export async function createClient() {
  exigerConfigSupabase();
  const magasin = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return magasin.getAll();
      },
      setAll(aPoser) {
        try {
          for (const { name, value, options } of aPoser) magasin.set(name, value, options);
        } catch {
          // Appelé depuis un server component (cookies en lecture seule) : le middleware rafraîchit la session à chaque requête.
        }
      },
    },
  });
}
