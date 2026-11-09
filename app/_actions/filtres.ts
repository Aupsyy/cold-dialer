"use server";

// La liste des prospects, filtrée et paginée (50 par page) : statut, tier, ville, département, recherche sur le nom, a un e-mail, a une
// accroche, mes leads, rappels. Les filtres arrivent déjà vérifiés par lib/poste/filtres.ts (lus depuis l'adresse) et sont revérifiés ici.
// Aucun export de fichier : la liste se consulte à l'écran. Journaux : des codes seulement.

import { COLONNES_LISTE, lireLigneListe, lireListe, lireMembre, type LigneListe, type Membre } from "@/lib/poste/fiche";
import { bornesPage, lireFiltresProspects, motifContient, type FiltresProspects, type Parametres } from "@/lib/poste/filtres";
import { echecBase, run, type Resultat } from "@/lib/server/action-kit";

export interface PageProspects {
  filtres: FiltresProspects;
  lignes: LigneListe[];
  total: number;
  membres: Membre[];
  maintenant: number;
}

/** Une page de la liste : les paramètres de l'adresse (?statut=…&page=…). */
export async function listerProspects(parametres: unknown): Promise<Resultat<PageProspects>> {
  return run("listerProspects", "equipe", async (ctx) => {
    const p: Parametres = parametres !== null && typeof parametres === "object" && !Array.isArray(parametres) ? (parametres as Parametres) : {};
    const f = lireFiltresProspects(p);
    const maintenant = Date.now();
    const iso = new Date(maintenant).toISOString();
    const { de, a } = bornesPage(f.page);

    let q = ctx.supabase.from("leads").select(COLONNES_LISTE, { count: "exact" });
    if (f.recherche) q = q.ilike("entreprise", motifContient(f.recherche));
    if (f.statut) q = q.eq("statut", f.statut);
    if (f.tier === "aucun") q = q.is("tier", null);
    else if (f.tier) q = q.eq("tier", f.tier);
    if (f.ville) q = q.ilike("ville", motifContient(f.ville));
    if (f.departement) q = q.eq("departement", f.departement);
    if (f.avecEmail) q = q.not("email", "is", null);
    if (f.avecAccroche) q = q.not("accroche", "is", null).neq("accroche", "");
    if (f.mesLeads) q = q.eq("assigned_to", ctx.userId);
    if (f.rappels === "dus") q = q.lte("rappel_le", iso);
    else if (f.rappels === "a_venir") q = q.gt("rappel_le", iso);
    else if (f.rappels === "tous") q = q.not("rappel_le", "is", null);
    switch (f.tri) {
      case "nom":
        q = q.order("entreprise", { ascending: true });
        break;
      case "score":
        q = q.order("score", { ascending: false, nullsFirst: false });
        break;
      case "rappel":
        q = q.order("rappel_le", { ascending: true, nullsFirst: false });
        break;
      case "activite":
        q = q.order("last_activity_at", { ascending: false, nullsFirst: false });
        break;
    }
    q = q.order("created_at", { ascending: false }).order("id", { ascending: true });

    const [liste, profils] = await Promise.all([
      q.range(de, a),
      ctx.supabase.from("profiles").select("id, nom, role, created_at").order("created_at", { ascending: true }),
    ]);
    if (liste.error) {
      echecBase("listerProspects", liste.error);
      // Une page au-delà de la fin (PGRST103) : la liste est simplement vide.
      if (liste.error.code !== "PGRST103") return { ok: false, error: "La liste n'a pas pu être lue. Réessaie dans un instant." };
    }
    if (profils.error) echecBase("listerProspects.membres", profils.error);
    return {
      ok: true,
      data: {
        filtres: f,
        lignes: lireListe(liste.data, lireLigneListe),
        total: typeof liste.count === "number" ? liste.count : 0,
        membres: lireListe(profils.data, lireMembre),
        maintenant,
      },
    };
  });
}
