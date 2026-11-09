// GET /api/telephonie/recuperation : la reprise différée de l'audio et de la transcription (lib/telephonie/recuperation.ts), appelée par
// une tâche planifiée avec « Authorization: Bearer <CRON_SECRET> » (Vercel Cron l'ajoute tout seul quand CRON_SECRET est posée).
// Public pour le middleware (préfixe /api/telephonie/) : elle vérifie elle-même le secret, en temps constant. Elle ne renvoie que des
// compteurs. Rien à faire pour un fournisseur sans reprise (softphone, téléphone, Ringover) ou sans clé d'API : 200, « rien ».

import { niche } from "@/config/niche";
import { valeurEnv } from "@/lib/integrations/base";
import { clientService, rpcService } from "@/lib/supabase/service";
import { journalServeur } from "@/lib/telephonie/reception";
import {
  FENETRE_RECUPERATION_MS,
  LOT_LECTURE,
  MAX_TENTATIVES,
  RECUPERATEURS,
  autoriseCron,
  recupererEnAttente,
  variablesRepriseManquantes,
} from "@/lib/telephonie/recuperation";
import { LONGUEURS_MIN_SECRETS } from "@/lib/telephonie/outils";
import { deposerParStockage } from "@/lib/telephonie/stockage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENTETES = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

function repondre(statut: number, corps: Record<string, unknown>): Response {
  return Response.json(corps, { status: statut, headers: ENTETES });
}

export async function GET(requete: Request): Promise<Response> {
  const env = process.env;
  if (valeurEnv(env, "CRON_SECRET").length < (LONGUEURS_MIN_SECRETS.CRON_SECRET ?? 16)) {
    journalServeur("reprise:non_configure:CRON_SECRET (503)", true);
    return repondre(503, { ok: false, code: "non_configure" });
  }
  if (!autoriseCron(requete.headers.get("authorization"), env)) {
    journalServeur("reprise:refuse (401)", true);
    return repondre(401, { ok: false, code: "refuse" });
  }
  const fournisseur = niche.telephonie.fournisseur;
  const rec = RECUPERATEURS[fournisseur];
  if (!rec) return repondre(200, { ok: true, rien: "fournisseur_sans_reprise" });
  if (variablesRepriseManquantes(rec, env).length > 0) return repondre(200, { ok: true, rien: "api_non_configuree" });
  const client = clientService(env);
  if (!client) return repondre(503, { ok: false, code: "base_non_configuree" });

  const { data, error } = await client
    .from("appels")
    .select("externe_id, workspace_id, tentatives, derniere_tentative")
    .eq("fournisseur", fournisseur)
    .eq("annonce_lue", true)
    .is("enregistrement_chemin", null)
    .in("statut", ["repondu", "inconnu"])
    .lt("tentatives", MAX_TENTATIVES)
    .gte("created_at", new Date(Date.now() - FENETRE_RECUPERATION_MS).toISOString())
    .order("derniere_tentative", { ascending: true, nullsFirst: true })
    .limit(LOT_LECTURE);
  if (error) {
    journalServeur("reprise:base (500)", true);
    return repondre(500, { ok: false, code: "base" });
  }

  const bilan = await recupererEnAttente(fournisseur, rec, Array.isArray(data) ? data : [], {
    env,
    base: () => rpcService(env),
    journal: journalServeur,
    fetch,
    deposer: deposerParStockage(env, fetch),
    maintenant: () => Date.now(),
    attendre: (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)),
  });
  return repondre(200, { ok: true, examines: bilan.examines, audios: bilan.audios, transcriptions: bilan.transcriptions });
}
