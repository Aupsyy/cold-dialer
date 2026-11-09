"use server";

// Les actions serveur de l'écran Agenda : changer le statut d'un rendez-vous, rattacher un rendez-vous « à vérifier » à une fiche,
// chercher une fiche, créer un rendez-vous à la main, créer ou révoquer son lien d'abonnement ICS. Chaque action passe par run()
// (connexion, rôle, erreurs) ; la saisie est revalidée ici (lib/agenda/saisie.ts) et la base revérifie tout (RLS, déclencheurs).
// Le journal ne porte que des codes : jamais un nom, un e-mail, un numéro, ni le jeton du flux ICS.

import { revalidatePath } from "next/cache";
import { niche } from "@/config/niche";
import { RE_JETON_AGENDA } from "@/lib/agenda/ics";
import { validerChangementStatut, validerRattachement, validerRdvManuel, type EntreeRdvManuel } from "@/lib/agenda/saisie";
import type { StatutRdv } from "@/lib/agenda/types";
import { STATUTS_ACTIFS, classerRecherche, effetSurFiche, fichesDepuisLignes, type FicheTrouvee } from "@/lib/agenda/vues";
import { echecBase, run, type Ctx, type Resultat } from "@/lib/server/action-kit";
import { ERR_GENERIQUE, ERR_INTROUVABLE } from "@/lib/server/contexte";
import { uuidObligatoire } from "@/lib/server/validation";

const COLONNES_EFFET = "id, lead_id, fin, statut";

interface RdvPourEffet {
  id: string;
  leadId: string | null;
  fin: string;
  statut: StatutRdv;
}

function rdvPourEffet(ligne: unknown): RdvPourEffet | null {
  if (ligne === null || typeof ligne !== "object") return null;
  const r = ligne as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.fin !== "string" || typeof r.statut !== "string") return null;
  return { id: r.id, leadId: typeof r.lead_id === "string" ? r.lead_id : null, fin: r.fin, statut: r.statut as StatutRdv };
}

/** La fiche suit son rendez-vous (les mêmes règles que evenement_agenda : lib/agenda/vues.ts, effetSurFiche). Un échec n'annule rien. */
async function appliquerEffetFiche(ctx: Ctx, rdv: RdvPourEffet): Promise<void> {
  if (!rdv.leadId) return;
  const [fiche, autres] = await Promise.all([
    ctx.supabase.from("leads").select("statut").eq("id", rdv.leadId).maybeSingle(),
    ctx.supabase
      .from("rendez_vous")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", rdv.leadId)
      .neq("id", rdv.id)
      .in("statut", [...STATUTS_ACTIFS]),
  ]);
  if (fiche.error || autres.error) {
    console.error("[action] agenda.fiche lecture", fiche.error?.code ?? autres.error?.code ?? "sans-code");
    return;
  }
  const statutFiche = fiche.data !== null && typeof fiche.data === "object" ? (fiche.data as { statut?: unknown }).statut : null;
  const effet = effetSurFiche({
    statutRdv: rdv.statut,
    finRdv: rdv.fin,
    statutFiche: typeof statutFiche === "string" ? statutFiche : null,
    autreRdvActif: (autres.count ?? 0) > 0,
    maintenant: Date.now(),
  });
  if (!effet) return;
  const { error } = await ctx.supabase
    .from("leads")
    .update(effet.statut === "rdv_fixe" ? { statut: "rdv_fixe", rappel_le: null } : { statut: "a_rappeler", rappel_le: new Date().toISOString() })
    .eq("id", rdv.leadId);
  if (error) console.error("[action] agenda.fiche", error.code ?? "sans-code");
}

/** Change le statut d'un rendez-vous (pris, confirmé, tenu, no-show, annulé, reporté) ; la fiche suit. */
export async function changerStatutRdv(rdvId: string, statut: string): Promise<Resultat<null>> {
  return run("agenda.statut", "equipe", async (ctx) => {
    const v = validerChangementStatut(rdvId, statut);
    const { data, error } = await ctx.supabase.from("rendez_vous").update({ statut: v.statut }).eq("id", v.rdvId).select(COLONNES_EFFET).maybeSingle();
    if (error) return echecBase("agenda.statut", error);
    const rdv = rdvPourEffet(data);
    if (!rdv) return { ok: false, error: ERR_INTROUVABLE };
    await appliquerEffetFiche(ctx, rdv);
    revalidatePath("/agenda");
    return { ok: true, data: null };
  });
}

/** Rattache un rendez-vous (« à vérifier » : aucune fiche retrouvée) à une fiche choisie à la main. */
export async function rattacherRdv(rdvId: string, leadId: string): Promise<Resultat<null>> {
  return run("agenda.rattacher", "equipe", async (ctx) => {
    const v = validerRattachement(rdvId, leadId);
    const { data, error } = await ctx.supabase
      .from("rendez_vous")
      .update({ lead_id: v.leadId, a_verifier: false })
      .eq("id", v.rdvId)
      .select(COLONNES_EFFET)
      .maybeSingle();
    if (error) return echecBase("agenda.rattacher", error);
    const rdv = rdvPourEffet(data);
    if (!rdv) return { ok: false, error: ERR_INTROUVABLE };
    await appliquerEffetFiche(ctx, rdv);
    revalidatePath("/agenda");
    return { ok: true, data: null };
  });
}

/** Retire un rendez-vous « à vérifier » qui n'est pas un rendez-vous de prospection (gestionnaires seulement, comme la RLS). */
export async function retirerRdvAVerifier(rdvId: string): Promise<Resultat<null>> {
  return run("agenda.retirer", "gestionnaire", async (ctx) => {
    const id = uuidObligatoire(rdvId, "Le rendez-vous");
    const { data, error } = await ctx.supabase
      .from("rendez_vous")
      .delete()
      .eq("id", id)
      .eq("a_verifier", true)
      .is("lead_id", null)
      .select("id")
      .maybeSingle();
    if (error) return echecBase("agenda.retirer", error);
    if (!data) return { ok: false, error: ERR_INTROUVABLE };
    revalidatePath("/agenda");
    return { ok: true, data: null };
  });
}

/** Cherche une fiche par entreprise, e-mail ou téléphone (9 derniers chiffres) : 10 résultats au plus, ceux que la RLS laisse voir. */
export async function chercherFichesAgenda(recherche: string): Promise<Resultat<FicheTrouvee[]>> {
  return run("agenda.chercher", "equipe", async (ctx) => {
    const r = classerRecherche(recherche);
    if (!r) return { ok: true, data: [] };
    let requete = ctx.supabase.from("leads").select("id, entreprise, ville, dirigeant");
    if (r.type === "email") requete = requete.ilike("email", r.motif);
    else if (r.type === "telephone") requete = requete.or(`telephone_9.eq.${r.tel9},mobile_9.eq.${r.tel9}`);
    else requete = requete.ilike("entreprise", r.motif);
    const { data, error } = await requete.order("entreprise").limit(10);
    if (error) return echecBase("agenda.chercher", error);
    return { ok: true, data: fichesDepuisLignes(data) };
  });
}

/** Crée un rendez-vous à la main (source « manuel ») : la base refuse un chevauchement pour le même closer. */
export async function creerRdvManuel(entree: EntreeRdvManuel): Promise<Resultat<{ id: string }>> {
  return run("agenda.creer", "equipe", async (ctx) => {
    const v = validerRdvManuel(entree, { fuseau: niche.pays.fuseau, maintenant: Date.now() });
    const { data, error } = await ctx.supabase
      .from("rendez_vous")
      .insert({
        lead_id: v.leadId,
        closer_id: v.closerId,
        debut: v.debut,
        fin: v.fin,
        canal: v.canal,
        lien_visio: v.lienVisio,
        note: v.note,
        source: "manuel",
        statut: "pris",
      })
      .select(COLONNES_EFFET)
      .single();
    if (error) return echecBase("agenda.creer", error);
    const rdv = rdvPourEffet(data);
    if (!rdv) return { ok: false, error: ERR_GENERIQUE };
    await appliquerEffetFiche(ctx, rdv);
    revalidatePath("/agenda");
    return { ok: true, data: { id: rdv.id } };
  });
}

/** Crée (ou recrée : l'ancien cesse de marcher) le jeton du flux ICS de la personne connectée. Il n'est montré qu'une fois. */
export async function creerJetonAgenda(): Promise<Resultat<{ jeton: string }>> {
  return run("agenda.jeton", "equipe", async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("agenda_jeton_creer");
    if (error) return echecBase("agenda.jeton", error);
    if (typeof data !== "string" || !RE_JETON_AGENDA.test(data)) return { ok: false, error: ERR_GENERIQUE };
    return { ok: true, data: { jeton: data } };
  });
}

/** Révoque le jeton du flux ICS : l'adresse cesse de marcher tout de suite. */
export async function revoquerJetonAgenda(): Promise<Resultat<{ revoque: boolean }>> {
  return run("agenda.revoquer", "equipe", async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("agenda_jeton_revoquer");
    if (error) return echecBase("agenda.revoquer", error);
    return { ok: true, data: { revoque: data === true } };
  });
}
