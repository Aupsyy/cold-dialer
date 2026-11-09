// La synchronisation Google Agenda : https://<ton-domaine>/api/agenda/google/sync, appelée par le cron de Vercel (vercel.json) avec
// « Authorization: Bearer <CRON_SECRET> ». Elle lit les rendez-vous à venir de l'agenda Google (jamais elle n'y écrit) et les envoie
// à evenement_agenda. Toute la logique est dans lib/agenda/synchro-google.ts et lib/agenda/google.ts (testées sans réseau).
// Réponse et journal : des compteurs et des codes seulement.

import { niche } from "@/config/niche";
import { reponseJson } from "@/lib/agenda/webhook";
import { recevoirSyncGoogle } from "@/lib/agenda/synchro-google";
import type { Journal } from "@/lib/integrations/base";
import { clientService, rpcService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const journal: Journal = (code, grave = false) => {
  if (grave) console.error(`[cron] ${code}`);
  else console.log(`[cron] ${code}`);
};

/** Les e-mails des comptes de l'équipe (un invité de l'équipe n'est pas un prospect), lus avec la clé service. */
async function emailsEquipe(): Promise<ReadonlySet<string>> {
  const client = clientService(process.env);
  if (!client) return new Set();
  const { data, error } = await client.from("profiles").select("email").limit(1000);
  if (error || !Array.isArray(data)) throw new Error("profils illisibles");
  const emails = new Set<string>();
  for (const ligne of data as unknown[]) {
    const email = ligne !== null && typeof ligne === "object" ? (ligne as { email?: unknown }).email : null;
    if (typeof email === "string" && email.includes("@")) emails.add(email.trim().toLowerCase());
  }
  return emails;
}

/** Les externeId Google déjà traités (journal des intégrations, 90 jours au plus) : un événement inchangé ne retourne pas en base. */
async function dejaTraites(): Promise<ReadonlySet<string>> {
  const client = clientService(process.env);
  if (!client) return new Set();
  const { data, error } = await client
    .from("integrations_evenements")
    .select("externe_id")
    .eq("fournisseur", "google")
    .order("recu_le", { ascending: false })
    .limit(5000);
  if (error || !Array.isArray(data)) throw new Error("journal illisible");
  const ids = new Set<string>();
  for (const ligne of data as unknown[]) {
    const id = ligne !== null && typeof ligne === "object" ? (ligne as { externe_id?: unknown }).externe_id : null;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

export async function GET(requete: Request) {
  const r = await recevoirSyncGoogle(requete, {
    env: process.env,
    fetch: (entree, init) => fetch(entree, init),
    base: () => rpcService(process.env),
    journal,
    maintenant: () => Date.now(),
    emailsEquipe,
    dejaTraites,
    fournisseurActif: niche.agenda.fournisseur,
  });
  return reponseJson(r);
}
