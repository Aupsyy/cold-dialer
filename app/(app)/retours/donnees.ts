// Les données de la page /retours, lues avec la session (RLS : un appelant ne voit que ses retours, un gestionnaire toute l'équipe).
//   - sans filtre : les agrégats de retours_marche_agreger (la fonction SQL, sur toute la période) ;
//   - filtre par appelant (gestionnaire seulement) : les lignes de cet appelant, agrégées par lib/retours/agregats.ts (même calcul) ;
//   - toujours : la répartition des issues et les citations récentes avec l'entreprise (lignes de la période).
// Journal : des codes d'erreur seulement.

import "server-only";
import { agregatsVides, agregerLignes, lireAgregats, lireLigneRetour, repartitionIssues, type Agregats, type CompteIssue, type LigneRetour } from "@/lib/retours/agregats";
import { bornesPeriode, type Periode } from "@/lib/retours/periode";
import { lirePages } from "@/lib/poste/pages";
import { estGestionnaire } from "@/lib/roles";
import type { Ctx } from "@/lib/server/action-kit";

/** Au-delà, les comptes par issue (et les agrégats filtrés) portent sur les lignes les plus récentes : la page le dit. */
export const MAX_LIGNES = 5000;
const MAX_CITATIONS = 20;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Membre {
  id: string;
  nom: string;
}

export interface CitationVue {
  texte: string;
  le: string;
  entreprise: string | null;
}

export interface VueRetours {
  jours: Periode;
  gestionnaire: boolean;
  membres: Membre[];
  /** L'appelant filtré (un gestionnaire seulement), sinon null. */
  appelant: string | null;
  agregats: Agregats;
  issues: CompteIssue[];
  citations: CitationVue[];
  /** Vrai si les lignes lues ont atteint MAX_LIGNES. */
  tronque: boolean;
  erreur: string | null;
}

const COLONNES = "appel_le, issue, objection_code, accroche_verdict, interet, decideur_joint, citation, douleur, tags";

function citation(brut: unknown): CitationVue | null {
  const o = (brut ?? {}) as { citation?: unknown; appel_le?: unknown; leads?: unknown };
  if (typeof o.citation !== "string" || o.citation.trim() === "" || typeof o.appel_le !== "string") return null;
  const fiche = Array.isArray(o.leads) ? o.leads[0] : o.leads;
  const entreprise = fiche && typeof (fiche as { entreprise?: unknown }).entreprise === "string" ? (fiche as { entreprise: string }).entreprise : null;
  return { texte: o.citation, le: o.appel_le, entreprise };
}

export async function chargerRetours(ctx: Ctx, demande: { jours: Periode; appelant: unknown; maintenant: number }): Promise<VueRetours> {
  const gestionnaire = estGestionnaire(ctx.role);
  const { debut, fin } = bornesPeriode(demande.jours, demande.maintenant);
  const vue: VueRetours = {
    jours: demande.jours,
    gestionnaire,
    membres: [],
    appelant: null,
    agregats: agregatsVides(),
    issues: [],
    citations: [],
    tronque: false,
    erreur: null,
  };
  const echec = (code: string | undefined): VueRetours => {
    console.error("[retours] lecture", code ?? "sans-code");
    return { ...vue, erreur: "Les retours n'ont pas pu être lus. Réessaie dans un instant." };
  };

  if (gestionnaire) {
    const { data, error } = await ctx.supabase.from("profiles").select("id, nom").order("nom", { ascending: true }).limit(200);
    if (error) return echec(error.code);
    vue.membres = ((data ?? []) as unknown[])
      .map((m) => m as { id?: unknown; nom?: unknown })
      .filter((m): m is { id: string; nom: unknown } => typeof m.id === "string")
      .map((m) => ({ id: m.id, nom: typeof m.nom === "string" && m.nom.trim() !== "" ? m.nom : "Sans nom" }));
    const choisi = Array.isArray(demande.appelant) ? demande.appelant[0] : demande.appelant;
    if (typeof choisi === "string" && RE_UUID.test(choisi) && vue.membres.some((m) => m.id === choisi)) vue.appelant = choisi;
  }

  const periode = () => ctx.supabase.from("retours_marche").select(COLONNES).gte("appel_le", debut).lt("appel_le", fin);
  const lignesQuery = () => (vue.appelant ? periode().eq("appelant_id", vue.appelant) : periode());
  const citationsBase = ctx.supabase
    .from("retours_marche")
    .select("citation, appel_le, leads(entreprise)")
    .gte("appel_le", debut)
    .lt("appel_le", fin)
    .not("citation", "is", null);
  const citationsQuery = (vue.appelant ? citationsBase.eq("appelant_id", vue.appelant) : citationsBase).order("appel_le", { ascending: false }).limit(MAX_CITATIONS);

  const [lignes, citations, agregatsSql] = await Promise.all([
    // Par pages : Supabase coupe toute réponse à 1 000 lignes ; « tronqué » dit vrai au-delà de MAX_LIGNES.
    lirePages((de, a) => lignesQuery().order("appel_le", { ascending: false }).order("id", { ascending: false }).range(de, a), { max: MAX_LIGNES }),
    citationsQuery,
    vue.appelant ? Promise.resolve(null) : ctx.supabase.rpc("retours_marche_agreger", { p_debut: debut, p_fin: fin }),
  ]);
  if (lignes.error) return echec(lignes.error.code);
  if (citations.error) return echec(citations.error.code);
  if (agregatsSql?.error) return echec(agregatsSql.error.code);

  const lues = lignes.lignes.map(lireLigneRetour).filter((l): l is LigneRetour => l !== null);
  vue.tronque = lignes.tronque;
  vue.agregats = agregatsSql ? lireAgregats(agregatsSql.data) : agregerLignes(lues);
  vue.issues = repartitionIssues(lues.map((l) => l.issue));
  vue.citations = ((citations.data ?? []) as unknown[]).map(citation).filter((c): c is CitationVue => c !== null);
  return vue;
}
