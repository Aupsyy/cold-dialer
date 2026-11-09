"use server";

// La file d'appels et tout ce que l'écran du Poste lit en une fois : les réglages de l'équipe (objectif du jour, enregistrement), la file
// (rappels, urgents, à appeler ; les fiches à moi et les fiches libres, ou seulement les miennes), les appels du jour (compteurs, fiches
// déjà appelées), la fiche ouverte avec son journal et ses rendez-vous, l'équipe, et les rendez-vous connus du closer (pour proposer deux
// créneaux libres). L'ordre et les exclusions sont dans lib/poste/file.ts. Journaux : des codes seulement.

import { niche } from "@/config/niche";
import { lieuDe } from "@/lib/poste/config-poste";
import {
  COLONNES_ACTIVITE,
  COLONNES_FICHE,
  COLONNES_FILE,
  COLONNES_RDV,
  lireActivite,
  lireFiche,
  lireFicheFile,
  lireListe,
  lireMembre,
  lireRdv,
  type Activite,
  type Fiche,
  type Membre,
  type RdvFiche,
} from "@/lib/poste/fiche";
import type { Plage } from "@/lib/poste/creneaux";
import { STATUTS_FILE, construireFile, type FicheFile, type FileAppels } from "@/lib/poste/file";
import { compteursDuJour, fichesAppeleesAujourdhui, type AppelDuJour, type Compteurs } from "@/lib/poste/objectif";
import { lirePages } from "@/lib/poste/pages";
import { lireDemandePoste } from "@/lib/poste/saisie-poste";
import { debutDuJour } from "@/lib/poste/temps";
import { echecBase, run, type Ctx, type Resultat } from "@/lib/server/action-kit";

const LIMITE_RAPPELS = 500;
const LIMITE_URGENTS = 200;
const LIMITE_FILE = 300;
const LIMITE_APPELS_JOUR = 5000;

export interface FichePoste {
  fiche: Fiche;
  activites: Activite[];
  rdvs: RdvFiche[];
}

export interface DonneesPoste {
  maintenant: number;
  file: FileAppels;
  fiche: FichePoste | null;
  /** Une fiche demandée (?fiche=…) que la personne ne voit pas, ou qui n'existe plus. */
  ficheIntrouvable: boolean;
  compteurs: Compteurs;
  objectifAppels: number;
  enregistrementComplet: boolean;
  membres: Membre[];
  /**
   * Les créneaux occupés du closer par défaut (le propriétaire le plus ancien), pour les deux créneaux : tous ses rendez-vous actifs, même
   * ceux qu'un appelant ne voit pas (fonction SQL creneaux_occupes : le début et la fin seulement).
   */
  occupes: Plage[];
  mesLeads: boolean;
  role: Ctx["role"];
  userId: string;
  nom: string | null;
}

function texteOuNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function lireAppelDuJour(v: unknown): AppelDuJour | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const leadId = texteOuNull(r.lead_id);
  return leadId ? { leadId, appelantId: texteOuNull(r.appelant_id), issue: texteOuNull(r.issue), statutApres: texteOuNull(r.statut_apres) } : null;
}

async function lireFichePoste(ctx: Ctx, leadId: string): Promise<FichePoste | null> {
  const [lead, activites, rdvs] = await Promise.all([
    ctx.supabase.from("leads").select(COLONNES_FICHE).eq("id", leadId).maybeSingle(),
    ctx.supabase.from("lead_activities").select(COLONNES_ACTIVITE).eq("lead_id", leadId).order("cree_le", { ascending: false }).limit(30),
    ctx.supabase.from("rendez_vous").select(COLONNES_RDV).eq("lead_id", leadId).order("debut", { ascending: false }).limit(10),
  ]);
  if (lead.error) echecBase("chargerPoste.fiche", lead.error);
  const fiche = lireFiche(lead.data);
  if (!fiche) return null;
  if (activites.error) echecBase("chargerPoste.activites", activites.error);
  if (rdvs.error) echecBase("chargerPoste.rdv", rdvs.error);
  return { fiche, activites: lireListe(activites.data, lireActivite), rdvs: lireListe(rdvs.data, lireRdv) };
}

/** L'écran du Poste : { fiche?, apres?, mes? } (les paramètres de l'adresse). */
export async function chargerPoste(entree: unknown): Promise<Resultat<DonneesPoste>> {
  return run("chargerPoste", "equipe", async (ctx) => {
    const demande = lireDemandePoste(entree !== null && typeof entree === "object" ? (entree as Record<string, unknown>) : {});
    const maintenant = Date.now();
    const lieu = lieuDe(niche);
    const tentativesMax = niche.tentativesMax;
    const pourMoi = demande.mesLeads ? `assigned_to.eq.${ctx.userId}` : `assigned_to.eq.${ctx.userId},assigned_to.is.null`;
    const base = () => ctx.supabase.from("leads").select(COLONNES_FILE).in("statut", [...STATUTS_FILE]).or(pourMoi);

    const [reglages, rappels, urgents, file, appels, profils, rdvActifs] = await Promise.all([
      ctx.supabase.from("reglages").select("enregistrement_complet, objectif_appels_jour").maybeSingle(),
      base().not("rappel_le", "is", null).order("rappel_le", { ascending: true }).limit(LIMITE_RAPPELS),
      base().is("rappel_le", null).eq("qualification->>urgent", "true").lt("tentatives", tentativesMax).limit(LIMITE_URGENTS),
      base()
        .is("rappel_le", null)
        .lt("tentatives", tentativesMax)
        .order("tier", { ascending: true, nullsFirst: false })
        .order("score", { ascending: false, nullsFirst: false })
        .order("tentatives", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(LIMITE_FILE),
      // Par pages : Supabase coupe toute réponse à 1 000 lignes, et une équipe peut passer plus de 1 000 appels par jour.
      lirePages(
        (de, a) =>
          ctx.supabase
            .from("lead_activities")
            .select("lead_id, appelant_id, issue, statut_apres")
            .eq("type", "appel")
            .gte("cree_le", new Date(debutDuJour(maintenant, lieu.fuseau)).toISOString())
            .order("cree_le", { ascending: true })
            .order("id", { ascending: true })
            .range(de, a),
        { max: LIMITE_APPELS_JOUR },
      ),
      ctx.supabase.from("profiles").select("id, nom, role, created_at").order("created_at", { ascending: true }),
      // En lecture (GET) : la fonction est STABLE, le chargement n'écrit rien.
      ctx.supabase.rpc(
        "creneaux_occupes",
        { p_debut: new Date(maintenant).toISOString(), p_fin: new Date(maintenant + 21 * 86_400_000).toISOString() },
        { get: true },
      ),
    ]);
    for (const [nom, r] of [
      ["reglages", reglages],
      ["rappels", rappels],
      ["urgents", urgents],
      ["file", file],
      ["appels", appels],
      ["profils", profils],
      ["rdv", rdvActifs],
    ] as const) {
      if (r.error) echecBase(`chargerPoste.${nom}`, r.error);
    }
    if (file.error) return { ok: false, error: "La file n'a pas pu être lue. Réessaie dans un instant." };

    const fiches: FicheFile[] = [
      ...lireListe(rappels.data, lireFicheFile),
      ...lireListe(urgents.data, lireFicheFile),
      ...lireListe(file.data, lireFicheFile),
    ];
    const appelsDuJour = lireListe(appels.lignes, lireAppelDuJour);
    const fileAppels = construireFile(fiches, { maintenant, tentativesMax, appeleesAujourdhui: fichesAppeleesAujourdhui(appelsDuJour) });

    const choisie = demande.fiche ?? fileAppels.ordre.find((id) => id !== demande.apres) ?? null;
    const fiche = choisie ? await lireFichePoste(ctx, choisie) : null;
    const repli = !fiche && demande.fiche ? (fileAppels.ordre.find((id) => id !== demande.fiche && id !== demande.apres) ?? null) : null;
    const ficheFinale = fiche ?? (repli ? await lireFichePoste(ctx, repli) : null);

    const membres = lireListe(profils.data, lireMembre);
    const occupes: Plage[] = [];
    for (const v of Array.isArray(rdvActifs.data) ? rdvActifs.data : []) {
      const r = (v ?? {}) as Record<string, unknown>;
      const debut = Date.parse(String(r.debut ?? ""));
      const fin = Date.parse(String(r.fin ?? ""));
      if (Number.isFinite(debut) && Number.isFinite(fin)) occupes.push({ debut, fin });
    }

    const reg = (reglages.data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: {
        maintenant,
        file: fileAppels,
        fiche: ficheFinale,
        ficheIntrouvable: demande.fiche !== null && !fiche,
        compteurs: compteursDuJour(appelsDuJour, ctx.userId),
        objectifAppels: typeof reg.objectif_appels_jour === "number" ? reg.objectif_appels_jour : 0,
        enregistrementComplet: reg.enregistrement_complet === true,
        membres,
        occupes,
        mesLeads: demande.mesLeads,
        role: ctx.role,
        userId: ctx.userId,
        nom: ctx.nom,
      },
    };
  });
}

/** L'objectif du jour et les compteurs de la personne connectée seulement (l'en-tête de la liste des prospects). */
export async function lireObjectifDuJour(): Promise<Resultat<{ compteurs: Compteurs; objectifAppels: number }>> {
  return run("lireObjectifDuJour", "equipe", async (ctx) => {
    const debut = new Date(debutDuJour(Date.now(), lieuDe(niche).fuseau)).toISOString();
    const [reglages, appels] = await Promise.all([
      ctx.supabase.from("reglages").select("objectif_appels_jour").maybeSingle(),
      lirePages(
        (de, a) =>
          ctx.supabase
            .from("lead_activities")
            .select("lead_id, appelant_id, issue, statut_apres")
            .eq("type", "appel")
            .eq("appelant_id", ctx.userId)
            .gte("cree_le", debut)
            .order("cree_le", { ascending: true })
            .order("id", { ascending: true })
            .range(de, a),
        { max: LIMITE_APPELS_JOUR },
      ),
    ]);
    if (reglages.error) echecBase("lireObjectifDuJour.reglages", reglages.error);
    if (appels.error) return echecBase("lireObjectifDuJour", appels.error);
    const objectif = (reglages.data as Record<string, unknown> | null)?.objectif_appels_jour;
    return {
      ok: true,
      data: {
        compteurs: compteursDuJour(lireListe(appels.lignes, lireAppelDuJour), ctx.userId),
        objectifAppels: typeof objectif === "number" ? objectif : 0,
      },
    };
  });
}
