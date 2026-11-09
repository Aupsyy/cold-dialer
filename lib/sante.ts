// /api/sante : l'état de l'instance en BOOLÉENS seulement (jamais une valeur, un message d'erreur ni un identifiant). Lu par le skill
// d'installation (scripts/install/verifier.mjs) et par un moniteur de disponibilité. Module PUR, testé par tests/sante.test.mjs.

import { valeurEnv, type Env } from "./integrations/base";

/** La version du schéma posée par la migration 0001 (fonction SQL version_schema()). */
export const VERSION_SCHEMA = 1;

export interface Sondage {
  baseJoignable: boolean;
  versionSchema: number | null;
}

/** La réponse d'un appel supabase.rpc : `status` vaut 0 quand le réseau a échoué. */
export interface ReponseRpc {
  data: unknown;
  error: unknown;
  status: number;
}

/** Interroge version_schema() ; une exception ou un statut 0 veut dire « base injoignable ». */
export async function sonderBase(appeler: (() => PromiseLike<ReponseRpc>) | null): Promise<Sondage> {
  if (!appeler) return { baseJoignable: false, versionSchema: null };
  try {
    const r = await appeler();
    return {
      baseJoignable: typeof r.status === "number" && r.status > 0,
      versionSchema: !r.error && typeof r.data === "number" ? r.data : null,
    };
  } catch {
    return { baseJoignable: false, versionSchema: null };
  }
}

export interface Sante {
  ok: boolean;
  base_joignable: boolean;
  schema_a_jour: boolean;
  config_valide: boolean;
  variables: {
    supabase_url: boolean;
    supabase_cle_anon: boolean;
    supabase_cle_service: boolean;
    /** Les variables du webhook du fournisseur de téléphonie choisi (vrai s'il n'en faut aucune). */
    telephonie: boolean;
    /** Les variables du webhook de l'agenda choisi (vrai s'il n'en faut aucune). */
    agenda: boolean;
  };
}

export interface EntreesSante {
  env: Env;
  sondage: Sondage;
  configValide: boolean;
  variablesTelephonie: readonly string[];
  variablesAgenda: readonly string[];
}

export function etatSante(e: EntreesSante): Sante {
  const presente = (nom: string) => valeurEnv(e.env, nom) !== "";
  const variables = {
    supabase_url: presente("NEXT_PUBLIC_SUPABASE_URL"),
    supabase_cle_anon: presente("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabase_cle_service: presente("SUPABASE_SERVICE_ROLE_KEY"),
    telephonie: e.variablesTelephonie.every(presente),
    agenda: e.variablesAgenda.every(presente),
  };
  const base_joignable = e.sondage.baseJoignable === true;
  const schema_a_jour = e.sondage.versionSchema === VERSION_SCHEMA;
  const config_valide = e.configValide === true;
  const ok = base_joignable && schema_a_jour && config_valide && Object.values(variables).every(Boolean);
  return { ok, base_joignable, schema_a_jour, config_valide, variables };
}
