// Une base Supabase SIMULÉE pour tester les actions serveur du Poste (tests/poste-requetes.test.mjs) : le vrai client @supabase/supabase-js,
// dont seul le réseau (fetch) est remplacé. Chaque requête est notée (méthode, table ou fonction, paramètres, corps, en-têtes) et reçoit la
// réponse choisie par le test. Aucun réseau, aucune base, aucune clé. Ce module remplace lib/supabase/server.ts (createClient) pour
// lib/server/action-kit.ts, par un crochet de chargement posé dans le test.
import { createClient as creerClient } from "@supabase/supabase-js";

export const requetes = [];
let repondeur = () => ({ status: 200, corps: [] });

/** Choisit les réponses et vide le journal des requêtes. */
export function repondre(f) {
  repondeur = f;
  requetes.length = 0;
}

export async function createClient() {
  return creerClient("http://base.test", "cle-publique-factice", {
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
          entetes: new Headers(init.headers),
        };
        requetes.push(requete);
        const r = repondeur(requete) ?? { status: 200, corps: [] };
        const status = r.status ?? 200;
        const vide = status === 204 || requete.methode === "HEAD";
        return new Response(vide ? null : JSON.stringify(r.corps ?? null), {
          status,
          headers: { "content-type": "application/json", ...(r.entetes ?? {}) },
        });
      },
    },
  });
}
