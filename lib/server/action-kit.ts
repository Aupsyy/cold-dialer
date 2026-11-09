// Le socle des actions serveur (« use server ») : connexion, contrôle du rôle, erreurs. Jamais importé côté navigateur.
// Deux barrières : ici, on refuse tôt si le rôle ne suffit pas ; en base, la RLS refuse de toute façon ce qui sort du périmètre.

import { createClient } from "../supabase/server";
import { ERR_GENERIQUE, ERR_REFUS, autorise, lireContexte, messageDepuisCode, type Besoin, type Contexte } from "./contexte";
import { ErreurSaisie } from "./validation";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Ce qu'une action renvoie au navigateur : des données, ou un message lisible. */
export type Resultat<T> = { ok: true; data: T } | { ok: false; error: string };

export interface Ctx extends Contexte {
  supabase: Supabase;
}

/** Le contexte de la personne connectée, ou null. */
export async function getContext(): Promise<Ctx | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contexte");
  if (error) return null;
  const ctx = lireContexte(data);
  return ctx ? { ...ctx, supabase } : null;
}

/** Journalise une erreur de base SANS donnée personnelle (le code seulement) et renvoie un résultat d'échec lisible. */
export function echecBase<T>(nom: string, erreur: { code?: string } | null): Resultat<T> {
  console.error(`[action] ${nom}`, erreur?.code ?? "sans-code");
  return { ok: false, error: messageDepuisCode(erreur?.code) };
}

/** Enveloppe une action : connexion, niveau d'accès, toutes les erreurs attrapées (seul le NOM de l'erreur est journalisé). */
export async function run<T>(nom: string, besoin: Besoin, action: (ctx: Ctx) => Promise<Resultat<T>>): Promise<Resultat<T>> {
  try {
    const ctx = await getContext();
    if (!ctx) return { ok: false, error: "Tu dois être connecté." };
    if (!autorise(ctx, besoin)) return { ok: false, error: ERR_REFUS };
    return await action(ctx);
  } catch (e) {
    if (e instanceof ErreurSaisie) return { ok: false, error: e.message };
    console.error(`[action] ${nom} inattendu`, e instanceof Error ? e.name : "inconnu");
    return { ok: false, error: ERR_GENERIQUE };
  }
}
