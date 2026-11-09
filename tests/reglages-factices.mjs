// Les doublures des tests des actions de l'écran Réglages (tests/reglages-actions.test.mjs), posées par un crochet de chargement :
//   - le client « clé service » (remplace lib/supabase/service.ts pour app/(app)/reglages/actions.ts) : le vrai client
//     @supabase/supabase-js dont seul le réseau est simulé ; chaque requête est notée ; `sansCle` simule une clé service absente ;
//   - revalidatePath (remplace next/cache) : les chemins relus sont notés.
// Aucun réseau, aucune base, aucune vraie clé.
import { createClient as creerClient } from "@supabase/supabase-js";

export const requetesService = [];
export const revalidations = [];
let repondeur = () => ({ status: 200, corps: [] });
let absente = false;

/** Choisit les réponses du client service (ou son absence) et vide les journaux. */
export function repondreService(f, { sansCle = false } = {}) {
  repondeur = f;
  absente = sansCle;
  requetesService.length = 0;
  revalidations.length = 0;
}

export function clientService() {
  if (absente) return null;
  return creerClient("http://service.test", "cle-service-factice", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (entree, init = {}) => {
        const url = new URL(typeof entree === "string" ? entree : entree.url);
        const brut = typeof init.body === "string" ? init.body : null;
        const requete = {
          methode: (init.method ?? "GET").toUpperCase(),
          chemin: url.pathname.replace(/^\/rest\/v1\//, ""),
          params: url.searchParams,
          corps: brut ? JSON.parse(brut) : null,
        };
        requetesService.push(requete);
        const r = repondeur(requete) ?? { status: 200, corps: [] };
        const status = r.status ?? 200;
        return new Response(status === 204 ? null : JSON.stringify(r.corps ?? null), { status, headers: { "content-type": "application/json" } });
      },
    },
  });
}

export function rpcService() {
  const client = clientService();
  if (!client) throw new Error("Client service non configuré.");
  return (fonction, args) => client.rpc(fonction, args);
}

export function revalidatePath(chemin) {
  revalidations.push(chemin);
}
