// Le webhook d'un outil d'agenda : https://<ton-domaine>/api/agenda/<fournisseur>/webhook (calendly, iclosed ; docs/agenda.md).
// Route des machines : sans session (le middleware la laisse passer) ; elle vérifie elle-même la signature ou le secret. Toute la
// logique est dans lib/agenda/webhook.ts (testée sans réseau) ; ici, seulement process.env, la clé service et le journal de Vercel.

import { niche } from "@/config/niche";
import { creerRegistreAgenda } from "@/lib/agenda/registre";
import { ENTETES_REPONSE_AGENDA, recevoirWebhookAgenda, reponseJson } from "@/lib/agenda/webhook";
import type { Journal } from "@/lib/integrations/base";
import { rpcService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const registre = creerRegistreAgenda({ fuseau: niche.pays.fuseau });

const journal: Journal = (code, grave = false) => {
  if (grave) console.error(`[webhook] ${code}`);
  else console.log(`[webhook] ${code}`);
};

export async function POST(requete: Request, contexte: { params: Promise<{ fournisseur: string }> }) {
  const { fournisseur } = await contexte.params;
  const r = await recevoirWebhookAgenda(fournisseur, requete, {
    env: process.env,
    base: () => rpcService(process.env),
    journal,
    maintenantS: () => Math.floor(Date.now() / 1000),
    registre,
  });
  return reponseJson(r);
}

/** Les outils n'appellent qu'en POST. */
export async function GET() {
  return Response.json({ ok: false }, { status: 405, headers: { ...ENTETES_REPONSE_AGENDA, Allow: "POST" } });
}
