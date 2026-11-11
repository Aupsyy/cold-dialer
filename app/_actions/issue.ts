"use server";

// Les actions serveur de l'appel en cours au Poste : l'issue (seule porte d'écriture : la fonction SQL enregistrer_issue), l'annonce
// d'enregistrement lue (une activité « annonce » : la base la rattache à l'appel en cours), le rendez-vous de l'agenda interne.
// Chaque entrée est revérifiée ici (lib/poste) ; la RLS refuse de toute façon ce qui sort du périmètre. Journaux : des codes seulement.

import { after } from "next/server";
import { niche } from "@/config/niche";
import { envoyerDebut, envoyerEvenement } from "@/lib/concours/client";
import { configurationEnvoi } from "@/lib/concours/serveur";
import { issueConcours } from "@/lib/concours/traduction";
import { contexteIssueDe, lieuDe } from "@/lib/poste/config-poste";
import { messageFiche } from "@/lib/poste/erreurs";
import { ligneRendezVous, validerSaisieRdv } from "@/lib/poste/rdv";
import { executerIssue, validerSaisieIssue, type IssueEnregistree } from "@/lib/poste/saisie-issue";
import { echecBase, run, type Resultat } from "@/lib/server/action-kit";
import { ErreurSaisie, uuidObligatoire } from "@/lib/server/validation";

/**
 * Session commune (facultative, docs/concours.md) : APRÈS l'enregistrement réussi d'une issue, ses compteurs partent vers la session.
 * Ne part que le type d'issue du concours (jamais une donnée de la fiche). L'envoi est planifié après la réponse (after) : il n'attend
 * pas l'appel, ne le fait jamais échouer et n'avale que ses propres erreurs. La configuration est lue dans ce temps-là : le branchement
 * rangé en base d'abord, les variables CONCOURS_* ensuite.
 */
function signalerAuConcours(codeIssue: string): void {
  try {
    const valeur = issueConcours(niche.issues.find((i) => i.code === codeIssue));
    if (!valeur) return;
    const tache = async () => {
      try {
        const config = await configurationEnvoi();
        if (config) await envoyerEvenement(config, valeur);
      } catch {
        // jamais d'incidence sur l'enregistrement de l'appel
      }
    };
    try {
      after(tache);
    } catch {
      void tache();
    }
  } catch {
    // jamais d'incidence sur l'enregistrement de l'appel
  }
}

/** Même chemin pour le début d'un appel : { jeton, debut } seulement, après la réponse, sans jamais lever. */
function signalerDebutAuConcours(): void {
  try {
    const tache = async () => {
      try {
        const config = await configurationEnvoi();
        if (config) await envoyerDebut(config);
      } catch {
        // un signal de confort : sans lui, l'appel et le classement marchent
      }
    };
    try {
      after(tache);
    } catch {
      void tache();
    }
  } catch {
    // idem
  }
}

/** Le bouton d'appel vient de lancer un appel : la session commune (si elle est branchée) peut le chronométrer. Aucune donnée n'est reçue ni envoyée. */
export async function signalerDebutAppel(): Promise<Resultat<null>> {
  return run("signalerDebutAppel", "equipe", async () => {
    signalerDebutAuConcours();
    return { ok: true, data: null };
  });
}

/** L'issue de l'appel : { leadId, issue, note?, rappelLe?, dureeS?, objection? }. */
export async function enregistrerIssue(entree: unknown): Promise<Resultat<IssueEnregistree>> {
  return run("enregistrerIssue", "equipe", async (ctx) => {
    const saisie = validerSaisieIssue(entree, contexteIssueDe(niche, Date.now()));
    const enregistree = await executerIssue(saisie, {
      rpc: (fonction, args) => ctx.supabase.rpc(fonction, args),
      identifiants: async (leadId) => {
        const { data, error } = await ctx.supabase.from("leads").select("siren, telephone, mobile, entreprise, cp").eq("id", leadId).maybeSingle();
        if (error || !data) return null;
        const d = data as Record<string, unknown>;
        const s = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
        return { siren: s(d.siren), telephone: s(d.telephone), mobile: s(d.mobile), entreprise: s(d.entreprise), cp: s(d.cp) };
      },
    });
    if (enregistree.ok) signalerAuConcours(saisie.issue.code);
    return enregistree;
  });
}

function leadIdDe(entree: unknown): string {
  if (entree === null || typeof entree !== "object" || Array.isArray(entree)) throw new ErreurSaisie("Saisie illisible.");
  return uuidObligatoire((entree as Record<string, unknown>).leadId, "La fiche");
}

/**
 * L'annonce d'enregistrement a été lue au prospect, pendant l'appel en cours : une activité « annonce » (horodatée par la base, à ton nom).
 * La base la rattache à CET appel seulement (lead_activities_annonce, appels_marquer_annonce) ; sans elle, l'audio n'est jamais gardé.
 */
export async function noterAnnonceLue(entree: unknown): Promise<Resultat<{ lueLe: string }>> {
  return run("noterAnnonceLue", "equipe", async (ctx) => {
    const leadId = leadIdDe(entree);
    const { data, error } = await ctx.supabase.from("lead_activities").insert({ lead_id: leadId, type: "annonce" }).select("cree_le").single();
    if (error) return echecBase("noterAnnonceLue", error);
    const lueLe = (data as Record<string, unknown> | null)?.cree_le;
    return { ok: true, data: { lueLe: typeof lueLe === "string" ? lueLe : new Date().toISOString() } };
  });
}

/** Le rendez-vous de l'agenda interne (aucun outil d'agenda branché) : { leadId, date, heure, canal, closerId?, note? }. */
export async function poserRdv(entree: unknown): Promise<Resultat<{ rdvId: string; debut: string }>> {
  return run("poserRdv", "equipe", async (ctx) => {
    const s = validerSaisieRdv(entree, { fuseau: lieuDe(niche).fuseau, dureeMin: niche.offre.rdv.dureeMin, maintenant: Date.now() });
    const { data, error } = await ctx.supabase.from("rendez_vous").insert(ligneRendezVous(s)).select("id, debut").single();
    if (error) {
      echecBase("poserRdv", error);
      return { ok: false, error: error.code === "23P01" ? "Ce créneau chevauche un autre rendez-vous du closer : choisis-en un autre." : messageFiche(error.code) };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    return { ok: true, data: { rdvId: String(d.id ?? ""), debut: typeof d.debut === "string" ? d.debut : s.debut } };
  });
}
