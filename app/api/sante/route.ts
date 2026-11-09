// GET /api/sante : des booléens seulement (base joignable, schéma à jour, config valide, variables présentes). Public (middleware) :
// rien d'autre ne sort, ni valeur, ni message d'erreur. 200 si tout va bien, 503 sinon.

import { createClient } from "@supabase/supabase-js";
import { analyserNiche } from "@/config/charger";
import brut from "@/config/niche.json";
import { variablesAgenda } from "@/lib/agenda/registre";
import { valeurEnv } from "@/lib/integrations/base";
import { etatSante, sonderBase } from "@/lib/sante";
import { adaptateurTelephonie } from "@/lib/telephonie/registre";

export const dynamic = "force-dynamic";

const DELAI_MS = 3000;

function fetchBorne(entree: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(entree, { ...init, signal: AbortSignal.timeout(DELAI_MS) });
}

export async function GET(): Promise<Response> {
  const env = process.env;
  const analyse = analyserNiche(brut);
  const niche = analyse.ok ? analyse.niche : null;
  const variablesTelephonie = niche ? (adaptateurTelephonie(niche.telephonie.fournisseur)?.webhook?.variables ?? []) : [];
  // Google n'a pas de webhook mais a des variables (OAuth, secret du cron) : le registre les connaît.
  const variablesAgendaRequises = niche ? variablesAgenda(niche.agenda.fournisseur) : [];

  // La clé service si elle est là (elle seule peut lire version_schema()), sinon la clé anon : la base répond, sans dire sa version.
  const url = valeurEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const cle = valeurEnv(env, "SUPABASE_SERVICE_ROLE_KEY") || valeurEnv(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const appeler =
    url && cle
      ? () =>
          createClient(url, cle, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { fetch: fetchBorne },
          }).rpc("version_schema")
      : null;

  const sante = etatSante({
    env,
    sondage: await sonderBase(appeler),
    configValide: analyse.ok,
    variablesTelephonie,
    variablesAgenda: variablesAgendaRequises,
  });
  return Response.json(sante, { status: sante.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
