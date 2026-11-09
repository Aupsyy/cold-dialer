// POST /api/telephonie/<fournisseur>/webhook : les événements d'appel du fournisseur choisi dans config/niche.json (docs/telephonie.md).
// Route des machines : sans session (middleware.ts laisse passer /api/telephonie/), elle vérifie elle-même le secret du fournisseur.
// Toute la logique est dans lib/telephonie/reception.ts (testée sans réseau) ; ici, seulement les vraies dépendances : les variables,
// la base avec la clé service (evenement_appel, enregistrement_appel, transcription_appel), le bucket « enregistrements », et after()
// pour l'audio et la transcription : le fournisseur a sa réponse 200 tout de suite (Onoff coupe à 10 s).

import { after } from "next/server";
import { niche } from "@/config/niche";
import { rpcService } from "@/lib/supabase/service";
import { journalServeur, recevoirWebhookTelephonie } from "@/lib/telephonie/reception";
import { deposerParStockage } from "@/lib/telephonie/stockage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENTETES = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

/** Les fournisseurs n'appellent qu'en POST. */
export function GET(): Response {
  return Response.json({ ok: false, code: "methode" }, { status: 405, headers: { ...ENTETES, Allow: "POST" } });
}

export async function POST(requete: Request, contexte: { params: Promise<{ fournisseur: string }> }): Promise<Response> {
  const { fournisseur } = await contexte.params;
  const env = process.env;
  const r = await recevoirWebhookTelephonie(fournisseur, requete, {
    env,
    fournisseurActif: niche.telephonie.fournisseur,
    indicatif: niche.pays.indicatif,
    base: () => rpcService(env),
    journal: journalServeur,
    planifier: (suite) => {
      try {
        after(suite);
      } catch {
        void suite();
      }
    },
    dependances: () => ({
      env,
      base: () => rpcService(env),
      journal: journalServeur,
      fetch,
      deposer: deposerParStockage(env, fetch),
      maintenant: () => Date.now(),
      attendre: (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)),
    }),
  });
  return Response.json(r.corps, { status: r.statut, headers: ENTETES });
}
