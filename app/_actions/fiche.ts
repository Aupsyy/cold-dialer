"use server";

// Les actions serveur d'une fiche prospect : la lire en entier (coordonnées, sources, journal, rendez-vous, équipe), la saisir à la main
// (source RGPD datée obligatoire), modifier ses coordonnées (trace datée « saisie manuelle »), y ajouter une note, la marquer urgente, la
// donner à quelqu'un (gestionnaires), la réserver au Poste (un appelant qui lance l'appel la prend pour lui : un collègue ne l'appelle pas
// en même temps). Toute entrée est revérifiée (lib/poste) ; la RLS fait le reste. Journaux : des codes seulement.

import { niche } from "@/config/niche";
import { lieuDe } from "@/lib/poste/config-poste";
import { ERR_FICHE_INTROUVABLE, messageFiche } from "@/lib/poste/erreurs";
import {
  COLONNES_ACTIVITE,
  COLONNES_FICHE,
  COLONNES_RDV,
  lireActivite,
  lireFiche,
  lireListe,
  lireMembre,
  lireRdv,
  type Activite,
  type Fiche,
  type Membre,
  type RdvFiche,
} from "@/lib/poste/fiche";
import { validerSaisieProspect } from "@/lib/poste/prospect";
import { qualificationAvecUrgence, validerAttribution, validerLeadId, validerModification, validerNote, validerUrgent } from "@/lib/poste/saisie-fiche";
import { marquerSaisiesManuelles } from "@/lib/poste/sources";
import { jourDans } from "@/lib/poste/temps";
import { echecBase, run, type Ctx, type Resultat } from "@/lib/server/action-kit";

function echecFiche<T>(nom: string, erreur: { code?: string } | null): Resultat<T> {
  echecBase(nom, erreur);
  return { ok: false, error: messageFiche(erreur?.code) };
}

async function membresDe(ctx: Ctx): Promise<Membre[]> {
  const { data, error } = await ctx.supabase.from("profiles").select("id, nom, role, created_at").order("created_at", { ascending: true });
  if (error) {
    echecBase("membres", error);
    return [];
  }
  return lireListe(data, lireMembre);
}

export interface FicheComplete {
  fiche: Fiche;
  activites: Activite[];
  rdvs: RdvFiche[];
  membres: Membre[];
}

/** La fiche complète : { leadId }. */
export async function chargerFiche(entree: unknown): Promise<Resultat<FicheComplete>> {
  return run("chargerFiche", "equipe", async (ctx) => {
    const leadId = validerLeadId(entree);
    const [lead, activites, rdvs, membres] = await Promise.all([
      ctx.supabase.from("leads").select(COLONNES_FICHE).eq("id", leadId).maybeSingle(),
      ctx.supabase.from("lead_activities").select(COLONNES_ACTIVITE).eq("lead_id", leadId).order("cree_le", { ascending: false }).limit(100),
      ctx.supabase.from("rendez_vous").select(COLONNES_RDV).eq("lead_id", leadId).order("debut", { ascending: false }).limit(50),
      membresDe(ctx),
    ]);
    if (lead.error) return echecFiche("chargerFiche", lead.error);
    const fiche = lireFiche(lead.data);
    if (!fiche) return { ok: false, error: ERR_FICHE_INTROUVABLE };
    if (activites.error) echecBase("chargerFiche.activites", activites.error);
    if (rdvs.error) echecBase("chargerFiche.rdv", rdvs.error);
    return {
      ok: true,
      data: { fiche, activites: lireListe(activites.data, lireActivite), rdvs: lireListe(rdvs.data, lireRdv), membres },
    };
  });
}

/** Un prospect saisi à la main : coordonnées, au moins un numéro, la source (type, lien ou précision). Renvoie son identifiant. */
export async function creerProspect(entree: unknown): Promise<Resultat<{ id: string }>> {
  return run("creerProspect", "equipe", async (ctx) => {
    const lieu = lieuDe(niche);
    const ligne = validerSaisieProspect(entree, { pays: lieu.pays, aujourdhui: jourDans(Date.now(), lieu.fuseau), userId: ctx.userId });
    const { data, error } = await ctx.supabase.from("leads").insert(ligne).select("id").single();
    if (error) return echecFiche("creerProspect", error);
    const id = (data as Record<string, unknown> | null)?.id;
    return typeof id === "string" ? { ok: true, data: { id } } : { ok: false, error: ERR_FICHE_INTROUVABLE };
  });
}

/** La modification des coordonnées : { leadId, champs: { dirigeant?, telephone?, mobile?, email?, site?, ville?, cp?, metier? } }. */
export async function modifierContact(entree: unknown): Promise<Resultat<null>> {
  return run("modifierContact", "equipe", async (ctx) => {
    const lieu = lieuDe(niche);
    const { leadId, maj } = validerModification(entree, lieu.pays);
    const { data: avant, error } = await ctx.supabase.from("leads").select("dirigeant, telephone, mobile, email, sources").eq("id", leadId).maybeSingle();
    if (error) return echecFiche("modifierContact.lecture", error);
    if (!avant) return { ok: false, error: ERR_FICHE_INTROUVABLE };
    const a = avant as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : null);
    const sources = marquerSaisiesManuelles(
      { dirigeant: s(a.dirigeant), telephone: s(a.telephone), mobile: s(a.mobile), email: s(a.email) },
      maj,
      a.sources,
      jourDans(Date.now(), lieu.fuseau),
    );
    const { data, error: e2 } = await ctx.supabase
      .from("leads")
      .update(sources ? { ...maj, sources } : maj)
      .eq("id", leadId)
      .select("id");
    if (e2) return echecFiche("modifierContact", e2);
    return Array.isArray(data) && data.length > 0 ? { ok: true, data: null } : { ok: false, error: ERR_FICHE_INTROUVABLE };
  });
}

/** Une note sur la fiche : { leadId, note } (une activité « note », horodatée par la base, à ton nom). */
export async function ajouterNote(entree: unknown): Promise<Resultat<null>> {
  return run("ajouterNote", "equipe", async (ctx) => {
    const { leadId, note } = validerNote(entree);
    const { error } = await ctx.supabase.from("lead_activities").insert({ lead_id: leadId, type: "note", note });
    if (error) return echecFiche("ajouterNote", error);
    return { ok: true, data: null };
  });
}

/** Urgent : la fiche passe en tête de la file, juste après les rappels dus. { leadId, urgent }. */
export async function basculerUrgent(entree: unknown): Promise<Resultat<{ urgent: boolean }>> {
  return run("basculerUrgent", "equipe", async (ctx) => {
    const { leadId, urgent } = validerUrgent(entree);
    const { data: lu, error } = await ctx.supabase.from("leads").select("qualification").eq("id", leadId).maybeSingle();
    if (error) return echecFiche("basculerUrgent.lecture", error);
    if (!lu) return { ok: false, error: ERR_FICHE_INTROUVABLE };
    const qualification = qualificationAvecUrgence((lu as Record<string, unknown>).qualification, urgent);
    const { data, error: e2 } = await ctx.supabase.from("leads").update({ qualification }).eq("id", leadId).select("id");
    if (e2) return echecFiche("basculerUrgent", e2);
    return Array.isArray(data) && data.length > 0 ? { ok: true, data: { urgent } } : { ok: false, error: ERR_FICHE_INTROUVABLE };
  });
}

/** Un gestionnaire donne la fiche à quelqu'un de l'équipe (ou la remet dans la file commune) : { leadId, membreId | null }. */
export async function attribuerFiche(entree: unknown): Promise<Resultat<null>> {
  return run("attribuerFiche", "gestionnaire", async (ctx) => {
    const { leadId, membreId } = validerAttribution(entree);
    const { data, error } = await ctx.supabase.from("leads").update({ assigned_to: membreId }).eq("id", leadId).select("id");
    if (error) return echecFiche("attribuerFiche", error);
    return Array.isArray(data) && data.length > 0 ? { ok: true, data: null } : { ok: false, error: ERR_FICHE_INTROUVABLE };
  });
}

/**
 * Au clic sur « Appeler » : un appelant prend la fiche si elle est libre (un collègue ne l'appelle pas en même temps). Les gestionnaires ne
 * réservent rien (même règle que enregistrer_issue, qui n'attribue une fiche libre qu'à un appelant). { leadId }.
 */
export async function reserverFiche(entree: unknown): Promise<Resultat<{ reservee: boolean; dejaPrise: boolean }>> {
  return run("reserverFiche", "equipe", async (ctx) => {
    const leadId = validerLeadId(entree);
    if (ctx.role !== "appelant") return { ok: true, data: { reservee: false, dejaPrise: false } };
    const { data, error } = await ctx.supabase.from("leads").update({ assigned_to: ctx.userId }).eq("id", leadId).is("assigned_to", null).select("id");
    if (error) return echecFiche("reserverFiche", error);
    if (Array.isArray(data) && data.length > 0) return { ok: true, data: { reservee: true, dejaPrise: false } };
    // Rien de mis à jour : déjà à moi (visible et à mon nom), ou prise par un collègue (la RLS me la cache désormais).
    const { data: lu, error: e2 } = await ctx.supabase.from("leads").select("assigned_to").eq("id", leadId).maybeSingle();
    if (e2) return echecFiche("reserverFiche.lecture", e2);
    const aMoi = (lu as Record<string, unknown> | null)?.assigned_to === ctx.userId;
    return { ok: true, data: { reservee: aMoi, dejaPrise: !aMoi } };
  });
}
