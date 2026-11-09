"use server";

// « Mes leads » : prendre d'un coup des fiches LIBRES qui passent un filtre (tier, départements, ville), et rendre celles qu'on n'a jamais
// appelées. Une fiche n'est donnée qu'à une seule personne : la mise à jour ne touche que les fiches encore libres (assigned_to vide), même
// si deux personnes prennent en même temps. Seules les fiches « à appeler » qui ont un numéro et n'ont pas atteint le plafond de tentatives
// sont prises. Journaux : des codes seulement.

import { niche } from "@/config/niche";
import { motifContient } from "@/lib/poste/filtres";
import { enLots, validerPrise } from "@/lib/poste/mes-leads";
import { echecBase, run, type Resultat } from "@/lib/server/action-kit";

export interface EtatMesLeads {
  /** Mes fiches encore dans la file (à appeler ou à rappeler). */
  mesFiches: number;
  /** Dont jamais appelées (ce que « Rendre » remettrait dans la file commune). */
  jamaisAppelees: number;
  /** Les fiches libres à appeler. */
  libres: number;
}

export async function etatMesLeads(): Promise<Resultat<EtatMesLeads>> {
  return run("etatMesLeads", "equipe", async (ctx) => {
    const compte = () => ctx.supabase.from("leads").select("id", { count: "exact", head: true });
    const [miennes, jamais, libres] = await Promise.all([
      compte().eq("assigned_to", ctx.userId).in("statut", ["a_appeler", "a_rappeler"]),
      compte().eq("assigned_to", ctx.userId).eq("statut", "a_appeler").eq("tentatives", 0).is("derniere_issue", null),
      compte().is("assigned_to", null).eq("statut", "a_appeler").lt("tentatives", niche.tentativesMax),
    ]);
    for (const [nom, r] of [
      ["miennes", miennes],
      ["jamais", jamais],
      ["libres", libres],
    ] as const) {
      if (r.error) return echecBase(`etatMesLeads.${nom}`, r.error);
    }
    return { ok: true, data: { mesFiches: miennes.count ?? 0, jamaisAppelees: jamais.count ?? 0, libres: libres.count ?? 0 } };
  });
}

/** Prendre des fiches libres : { nombre (1 à 100), tiers?: ["A","B","C"], departements?: "69, 38", ville? }. */
export async function prendreMesLeads(entree: unknown): Promise<Resultat<{ demandees: number; attribuees: number }>> {
  return run("prendreMesLeads", "equipe", async (ctx) => {
    const { nombre, filtres } = validerPrise(entree);
    let q = ctx.supabase
      .from("leads")
      .select("id")
      .is("assigned_to", null)
      .eq("statut", "a_appeler")
      .lt("tentatives", niche.tentativesMax)
      .or("telephone.not.is.null,mobile.not.is.null");
    if (filtres.tiers.length > 0) q = q.in("tier", filtres.tiers);
    if (filtres.departements.length > 0) q = q.in("departement", filtres.departements);
    if (filtres.ville) q = q.ilike("ville", motifContient(filtres.ville));
    const { data, error } = await q
      .order("tier", { ascending: true, nullsFirst: false })
      .order("score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(nombre);
    if (error) return echecBase("prendreMesLeads.lecture", error);
    const ids = (Array.isArray(data) ? data : [])
      .map((r) => (r as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === "string");
    let attribuees = 0;
    for (const lot of enLots(ids)) {
      const r = await ctx.supabase.from("leads").update({ assigned_to: ctx.userId }).in("id", lot).is("assigned_to", null).select("id");
      if (r.error) return echecBase("prendreMesLeads", r.error);
      attribuees += Array.isArray(r.data) ? r.data.length : 0;
    }
    return { ok: true, data: { demandees: nombre, attribuees } };
  });
}

/** Rendre à la file commune mes fiches jamais appelées (à appeler, aucune tentative, aucune issue). */
export async function rendreMesLeads(): Promise<Resultat<{ rendues: number }>> {
  return run("rendreMesLeads", "equipe", async (ctx) => {
    const { data, error } = await ctx.supabase
      .from("leads")
      .update({ assigned_to: null })
      .eq("assigned_to", ctx.userId)
      .eq("statut", "a_appeler")
      .eq("tentatives", 0)
      .is("derniere_issue", null)
      .select("id");
    if (error) return echecBase("rendreMesLeads", error);
    return { ok: true, data: { rendues: Array.isArray(data) ? data.length : 0 } };
  });
}
