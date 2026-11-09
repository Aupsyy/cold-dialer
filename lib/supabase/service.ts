// Le client Supabase avec la clé SERVICE : réservé au serveur : les routes (webhooks, /api/sante, aperçu d'une invitation) et, APRÈS le
// contrôle du rôle par run(), la purge RGPD et l'effacement des appels d'une fiche (app/(app)/reglages/actions.ts). Elle passe outre la RLS :
// partout ailleurs, les écritures passent par les fonctions SQL SECURITY DEFINER prévues pour elle (evenement_appel…).
// « server-only » fait échouer le build si un composant client importe ce fichier. La clé n'a JAMAIS le préfixe NEXT_PUBLIC_.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { valeurEnv, type Env, type Rpc } from "../integrations/base";

/** Le client service, ou null si l'URL ou la clé service manque (rien n'est lu ni affiché d'autre que leur présence). */
export function clientService(env: Env = process.env): SupabaseClient | null {
  const url = valeurEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const cle = valeurEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !cle) return null;
  return createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** Un appel de fonction SQL avec la clé service ; lève une erreur (sans détail) si la configuration manque. */
export function rpcService(env: Env = process.env): Rpc {
  const client = clientService(env);
  if (!client) throw new Error("Client service non configuré.");
  return (fonction, args) => client.rpc(fonction, args);
}
