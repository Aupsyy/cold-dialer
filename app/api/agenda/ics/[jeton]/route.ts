// Le flux iCalendar d'un closer : https://<ton-domaine>/api/agenda/ics/<jeton>.ics (le jeton se crée dans l'écran Agenda ; docs/agenda.md).
// Route des machines : sans session (le middleware la laisse passer) ; le jeton secret fait foi. La base est lue avec la clé service par
// agenda_flux (les rendez-vous de CE closer : créneau, statut, canal, lien de visio, entreprise ; jamais un numéro ni un e-mail).
// Toute la logique est dans lib/agenda/flux.ts ; le jeton n'est jamais journalisé.

import { niche } from "@/config/niche";
import { repondreFlux } from "@/lib/agenda/flux";
import type { Journal } from "@/lib/integrations/base";
import { rpcService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const journal: Journal = (code, grave = false) => {
  if (grave) console.error(`[agenda] ${code}`);
  else console.log(`[agenda] ${code}`);
};

export async function GET(requete: Request, contexte: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await contexte.params;
  const r = await repondreFlux(jeton, {
    env: process.env,
    base: () => rpcService(process.env),
    journal,
    origine: new URL(requete.url).origin,
    fuseau: niche.pays.fuseau,
    nomRdv: niche.offre.rdv.nom,
    nomProduit: niche.marque.nomProduit,
    maintenant: () => Date.now(),
  });
  return new Response(r.corps, { status: r.statut, headers: r.entetes });
}
