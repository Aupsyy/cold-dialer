// Le bucket privé « enregistrements » par l'API Storage de Supabase (REST, fetch), avec la clé SERVICE : déposer un audio, l'effacer.
// Côté SERVEUR seulement (route du webhook, reprise différée, purge et effacement de l'écran Réglages) : la clé est lue dans `env`, fourni par la route ; rien ne tourne dans un
// navigateur. Ce module vit dans lib/telephonie parce que apres() n'a que `fetch` et `env` pour effacer un audio que la base refuse.
// Le journal ne reçoit que des codes (« stockage_403 ») : jamais le chemin, l'URL ni la clé.

import { valeurEnv, type Env } from "../integrations/base";
import { BUCKET_ENREGISTREMENTS } from "./types";

/** Le chemin d'un audio, tel que la base l'accepte : <workspace_id>/<fournisseur>/<externeId>.<ext>. */
export const RE_CHEMIN_ENREGISTREMENT = /^[0-9a-f-]{36}\/(onoff|aircall|ringover)\/[A-Za-z0-9_.:-]{1,80}\.(mp3|mp4|m4a|wav|ogg|webm)$/;

export const DELAI_STOCKAGE_MS = 30_000;

export interface ResultatStockage {
  ok: boolean;
  code?: string;
}

function acces(env: Env): { url: string; cle: string } | null {
  if (typeof window !== "undefined") return null;
  const url = valeurEnv(env, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const cle = valeurEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  return url !== "" && cle !== "" && /^https?:\/\/[^\s/]+$/i.test(url) ? { url, cle } : null;
}

/** Les mêmes en-têtes que supabase-js : la clé en apikey et en Bearer (anciennes clés JWT comme nouvelles clés secrètes). */
function entetes(cle: string, autres: Record<string, string>): Record<string, string> {
  return { apikey: cle, Authorization: `Bearer ${cle}`, ...autres };
}

/** Le dépôt d'un audio (remplace un fichier au même chemin : un nouvel essai ne crée pas de doublon). */
export function deposerParStockage(env: Env, f: typeof fetch): (chemin: string, octets: Uint8Array, mime: string) => Promise<ResultatStockage> {
  return async (chemin, octets, mime) => {
    const a = acces(env);
    if (!a) return { ok: false, code: "configuration" };
    if (!RE_CHEMIN_ENREGISTREMENT.test(chemin)) return { ok: false, code: "chemin" };
    if (!/^audio\/[a-z0-9.+-]{1,40}$/.test(mime)) return { ok: false, code: "type" };
    try {
      const r = await f(`${a.url}/storage/v1/object/${BUCKET_ENREGISTREMENTS}/${chemin}`, {
        method: "POST",
        headers: entetes(a.cle, { "content-type": mime, "x-upsert": "true" }),
        body: new Blob([new Uint8Array(octets)], { type: mime }),
        signal: AbortSignal.timeout(DELAI_STOCKAGE_MS),
      });
      return r.ok ? { ok: true } : { ok: false, code: `stockage_${r.status}` };
    } catch {
      return { ok: false, code: "stockage_reseau" };
    }
  };
}

/** L'effacement d'un audio (refusé par la base, ou purge) ; un fichier déjà absent compte pour effacé. */
export async function effacerDuStockage(chemin: string, env: Env, f: typeof fetch): Promise<ResultatStockage> {
  const a = acces(env);
  if (!a) return { ok: false, code: "configuration" };
  if (!RE_CHEMIN_ENREGISTREMENT.test(chemin)) return { ok: false, code: "chemin" };
  try {
    const r = await f(`${a.url}/storage/v1/object/${BUCKET_ENREGISTREMENTS}`, {
      method: "DELETE",
      headers: entetes(a.cle, { "content-type": "application/json" }),
      body: JSON.stringify({ prefixes: [chemin] }),
      signal: AbortSignal.timeout(DELAI_STOCKAGE_MS),
    });
    return r.ok || r.status === 404 ? { ok: true } : { ok: false, code: `stockage_${r.status}` };
  } catch {
    return { ok: false, code: "stockage_reseau" };
  }
}
