"use server";

// Les actions serveur de l'écran Réglages. Chacune passe par run() (connexion, rôle, erreurs attrapées) ; la saisie est revérifiée ici
// (lib/reglages) et la base revérifie tout (RLS, fonctions changer_role, retirer_membre, definir_email_telephonie, contraintes).
//   - tout le monde : lire ses réglages, changer son nom ;
//   - gestionnaires (propriétaire, membre) : e-mail de téléphonie, invitations, plafond de tentatives, objectif, enregistrement des
//     appels, comptage et purge RGPD ;
//   - propriétaire : rôles, retrait d'un compte, effacement d'une fiche.
// La clé service (lib/supabase/service.ts) ne sert qu'à ce que la RLS ne permet pas à un compte connecté, APRÈS le contrôle du rôle :
// la purge (purger_fiches_inactives et purger_integrations_evenements sont réservées à la clé service), l'effacement des appels d'une
// fiche (la table appels n'est écrite que par la clé service) et les audios du bucket privé (lib/telephonie/stockage.ts).
// Journaux : des codes seulement ; jamais un nom, un e-mail, un numéro, un chemin d'audio ni le jeton d'une invitation.

import { revalidatePath } from "next/cache";
import { niche } from "@/config/niche";
import { ERR_FICHE_INTROUVABLE } from "@/lib/poste/erreurs";
import { balayerAudiosOrphelins, listerParStockage } from "@/lib/reglages/audios";
import {
  COLONNES_INVITATION,
  COLONNES_MEMBRE,
  RE_JETON_INVITATION,
  lireInvitation,
  lireListe,
  lireMembreEquipe,
  messageEquipe,
  trierEquipe,
  validerChangementRole,
  validerEmailTelephonie,
  validerInvitation,
  validerNom,
  validerRetrait,
  validerRevocation,
  type InvitationEnAttente,
  type MembreEquipe,
  type OperationEquipe,
} from "@/lib/reglages/equipe";
import {
  COLONNES_REGLAGES,
  blocageEnregistrement,
  ligneActivation,
  lireReglages,
  validerAcceptation,
  validerObjectif,
  type ReglagesEquipe,
} from "@/lib/reglages/reglages";
import {
  executerPurge,
  filtreFichesInactives,
  ligneOpposition,
  limiteConservation,
  lireFicheAEffacer,
  seuilAudiosOrphelins,
  neufChiffresDe,
  validerConfirmation,
  validerEffacement,
  type ComptagePurge,
  type CompteRenduEffacement,
  type CompteRenduPurge,
  type EtatOpposition,
} from "@/lib/reglages/rgpd";
import { estGestionnaire, type Role } from "@/lib/roles";
import { echecBase, run, type Ctx, type Resultat } from "@/lib/server/action-kit";
import { ERR_GENERIQUE, ERR_REFUS, messageDepuisCode } from "@/lib/server/contexte";
import { ErreurSaisie } from "@/lib/server/validation";
import { clientService } from "@/lib/supabase/service";
import { effacerDuStockage } from "@/lib/telephonie/stockage";

/**
 * Le temps de la purge depuis l'écran (la page a maxDuration = 60 s) : après 20 s, plus aucun audio ni balayage n'est tenté ; un appel au
 * stockage déjà parti peut encore durer jusqu'à 30 s (lib/telephonie/stockage.ts). Le reste attend la purge suivante.
 */
const BUDGET_AUDIOS_MS = 20_000;
const TAILLE_LOT_IDS = 100;
/** Une page de lecture : 1000 lignes, le plafond de PostgREST chez Supabase (max_rows). */
const TAILLE_PAGE = 1000;

const ERR_SANS_CLE_SERVICE =
  "La purge demande la clé service sur le serveur (SUPABASE_SERVICE_ROLE_KEY, dans Vercel) : ajoute-la et redéploie, ou lance node scripts/maintenance/purger.mjs depuis ton ordinateur.";
const ERR_EFFACEMENT_SANS_CLE =
  "Cette fiche a des appels : leur effacement demande la clé service sur le serveur (SUPABASE_SERVICE_ROLE_KEY, dans Vercel). Ajoute-la et redéploie, ou suis docs/legal.md. Rien n'a été effacé.";

function equipe(ctx: Ctx): string {
  if (!ctx.workspaceId) throw new ErreurSaisie(ERR_REFUS);
  return ctx.workspaceId;
}

function echecEquipe<T>(nom: string, operation: OperationEquipe, erreur: { code?: string } | null): Resultat<T> {
  echecBase(nom, erreur);
  return { ok: false, error: messageEquipe(operation, erreur?.code) };
}

function codeDe(erreur: { code?: unknown } | null | undefined): string {
  const c = erreur?.code;
  return typeof c === "string" && /^[A-Za-z0-9_]{1,24}$/.test(c) ? c : "sans-code";
}

/** Le journal des actions de ce fichier : un code, jamais une donnée. */
function journal(code: string): void {
  console.error(`[reglages] ${code}`);
}

function lignes(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object") : [];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DonneesReglages {
  role: Role;
  moi: MembreEquipe | null;
  /** Toute l'équipe pour un gestionnaire ; son seul profil pour un appelant. */
  equipe: MembreEquipe[];
  /** Les invitations en attente que la RLS laisse voir, SANS leur jeton (vide pour un appelant). */
  invitations: InvitationEnAttente[];
  reglages: ReglagesEquipe | null;
  /** Une lecture a échoué : l'écran le dit. */
  partiel: boolean;
}

/** Ce que l'écran Réglages affiche, sous la RLS de la personne connectée. */
export async function chargerReglages(): Promise<Resultat<DonneesReglages>> {
  return run("reglages.charger", "equipe", async (ctx) => {
    const role = ctx.role;
    if (!role) return { ok: false, error: ERR_REFUS };
    const gestionnaire = estGestionnaire(role);
    const profils = ctx.supabase.from("profiles").select(COLONNES_MEMBRE);
    const [p, r, i] = await Promise.all([
      gestionnaire ? profils.order("created_at", { ascending: true }) : profils.eq("id", ctx.userId),
      ctx.supabase.from("reglages").select(COLONNES_REGLAGES).maybeSingle(),
      gestionnaire
        ? ctx.supabase.from("invitations").select(COLONNES_INVITATION).is("acceptee_le", null).order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const [nom, e] of [["profils", p.error], ["reglages", r.error], ["invitations", i.error]] as const) {
      if (e) echecBase(`reglages.charger.${nom}`, e);
    }
    const membres = trierEquipe(lireListe(p.data, lireMembreEquipe));
    return {
      ok: true,
      data: {
        role,
        moi: membres.find((m) => m.id === ctx.userId) ?? null,
        equipe: membres,
        invitations: lireListe(i.data, lireInvitation),
        reglages: lireReglages(r.data),
        partiel: Boolean(p.error || r.error || i.error),
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Profil et équipe
// ---------------------------------------------------------------------------------------------------------------------------------

/** Son propre nom : { nom } (la RLS ne laisse changer que le sien). */
export async function modifierMonNom(entree: unknown): Promise<Resultat<null>> {
  return run("reglages.nom", "equipe", async (ctx) => {
    const { nom } = validerNom(entree);
    const { data, error } = await ctx.supabase.from("profiles").update({ nom }).eq("id", ctx.userId).select("id");
    if (error) return echecEquipe("reglages.nom", "nom", error);
    if (lignes(data).length === 0) return { ok: false, error: messageEquipe("nom", "P0002") };
    revalidatePath("/reglages");
    return { ok: true, data: null };
  });
}

/** Le propriétaire change le rôle d'un membre : { membreId, role } (fonction changer_role ; jamais son propre rôle). */
export async function changerRole(entree: unknown): Promise<Resultat<null>> {
  return run("reglages.role", "proprietaire", async (ctx) => {
    const v = validerChangementRole(entree, ctx.userId);
    const { error } = await ctx.supabase.rpc("changer_role", { p_membre: v.membreId, p_role: v.role });
    if (error) return echecEquipe("reglages.role", "role", error);
    revalidatePath("/reglages");
    return { ok: true, data: null };
  });
}

/** Le propriétaire retire quelqu'un de l'équipe : { membreId } (fonction retirer_membre ; jamais soi-même). */
export async function retirerMembre(entree: unknown): Promise<Resultat<null>> {
  return run("reglages.retrait", "proprietaire", async (ctx) => {
    const { membreId } = validerRetrait(entree, ctx.userId);
    const { error } = await ctx.supabase.rpc("retirer_membre", { p_membre: membreId });
    if (error) return echecEquipe("reglages.retrait", "retrait", error);
    revalidatePath("/reglages");
    return { ok: true, data: null };
  });
}

/** Un gestionnaire pose (ou efface) l'e-mail d'un compte chez le fournisseur de téléphonie : { membreId, email | "" }. */
export async function definirEmailTelephonie(entree: unknown): Promise<Resultat<null>> {
  return run("reglages.email_telephonie", "gestionnaire", async (ctx) => {
    const v = validerEmailTelephonie(entree);
    const { error } = await ctx.supabase.rpc("definir_email_telephonie", { p_membre: v.membreId, p_email: v.email });
    if (error) return echecEquipe("reglages.email_telephonie", "email_telephonie", error);
    revalidatePath("/reglages");
    return { ok: true, data: null };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Une invitation : { role, email?, nom? }. Le jeton est tiré par la base ; il est rendu UNE fois, pour le lien à copier, et n'est jamais
 * journalisé. Rien n'est envoyé à la personne : le lien se transmet à la main.
 */
export async function creerInvitation(entree: unknown): Promise<Resultat<{ jeton: string; expireLe: string | null }>> {
  return run("reglages.invitation", "gestionnaire", async (ctx) => {
    const v = validerInvitation(entree, ctx.role);
    const { data, error } = await ctx.supabase.from("invitations").insert(v).select("jeton, expire_le").single();
    if (error) return echecEquipe("reglages.invitation", "invitation", error);
    const d = (data ?? {}) as Record<string, unknown>;
    if (typeof d.jeton !== "string" || !RE_JETON_INVITATION.test(d.jeton)) {
      journal("invitation:reponse_illisible");
      return { ok: false, error: "L'invitation a été créée mais son lien n'a pas pu être lu : révoque-la et recommence." };
    }
    revalidatePath("/reglages");
    return { ok: true, data: { jeton: d.jeton, expireLe: typeof d.expire_le === "string" ? d.expire_le : null } };
  });
}

/** Révoque une invitation pas encore utilisée : { invitationId } (le lien cesse de marcher tout de suite). */
export async function revoquerInvitation(entree: unknown): Promise<Resultat<null>> {
  return run("reglages.revocation", "gestionnaire", async (ctx) => {
    const { invitationId } = validerRevocation(entree);
    const { data, error } = await ctx.supabase.from("invitations").delete().eq("id", invitationId).is("acceptee_le", null).select("id");
    if (error) return echecEquipe("reglages.revocation", "revocation", error);
    if (lignes(data).length === 0) return { ok: false, error: messageEquipe("revocation", "P0002") };
    revalidatePath("/reglages");
    return { ok: true, data: null };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Réglages : plafond, objectif, enregistrement
// ---------------------------------------------------------------------------------------------------------------------------------

async function ecrireReglages(ctx: Ctx, nom: string, maj: Record<string, unknown>, refus: string): Promise<Resultat<null>> {
  const { data, error } = await ctx.supabase.from("reglages").update(maj).eq("workspace_id", equipe(ctx)).select("workspace_id");
  if (error) {
    echecBase(nom, error);
    return { ok: false, error: error.code === "23514" ? refus : messageDepuisCode(error.code) };
  }
  if (lignes(data).length === 0) return { ok: false, error: ERR_REFUS };
  revalidatePath("/reglages");
  revalidatePath("/poste");
  return { ok: true, data: null };
}

/** Aligne le plafond de la base (tentatives_max, « injoignable ») sur celui de la configuration (tentativesMax, la file du Poste). */
export async function alignerTentatives(): Promise<Resultat<{ tentativesMax: number }>> {
  return run("reglages.tentatives", "gestionnaire", async (ctx) => {
    const r = await ecrireReglages(ctx, "reglages.tentatives", { tentatives_max: niche.tentativesMax }, "Plafond refusé par la base (1 à 10).");
    return r.ok ? { ok: true, data: { tentativesMax: niche.tentativesMax } } : r;
  });
}

/** L'objectif d'appels par jour et par appelant : { objectif } (0 à 1000 ; 0 : pas d'objectif affiché). */
export async function modifierObjectif(entree: unknown): Promise<Resultat<null>> {
  return run("reglages.objectif", "gestionnaire", async (ctx) => {
    const objectif = validerObjectif(entree);
    return ecrireReglages(ctx, "reglages.objectif", { objectif_appels_jour: objectif }, "Objectif refusé par la base (0 à 1000).");
  });
}

/**
 * Active l'enregistrement complet : { accepte: true } (la case « j'ai lu et j'accepte »). Une seule écriture pose la date d'acceptation
 * du cadre légal (horodatée par la base) et l'enregistrement. Refusé si la configuration ne déclare pas d'enregistrement.
 */
export async function activerEnregistrement(entree: unknown): Promise<Resultat<null>> {
  return run("reglages.enregistrement", "gestionnaire", async (ctx) => {
    validerAcceptation(entree);
    const blocage = blocageEnregistrement(niche.telephonie);
    if (blocage) return { ok: false, error: blocage };
    return ecrireReglages(ctx, "reglages.enregistrement", ligneActivation(Date.now()), "La base exige l'acceptation du cadre légal avant l'activation.");
  });
}

/** Désactive l'enregistrement complet : plus rien n'est gardé des appels suivants. */
export async function desactiverEnregistrement(): Promise<Resultat<null>> {
  return run("reglages.enregistrement_arret", "gestionnaire", async (ctx) =>
    ecrireReglages(ctx, "reglages.enregistrement_arret", { enregistrement_complet: false }, ERR_GENERIQUE),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// RGPD : la purge
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Ce que la purge effacerait aujourd'hui, compté sous la RLS (un gestionnaire voit toutes les lignes de l'équipe) : les fiches sans
 * activité depuis config.legal.conservationMois mois (hors rendez-vous à venir), et les appels, rendez-vous, débriefs et retours plus
 * anciens. Rien n'est écrit.
 */
export async function compterPurge(): Promise<Resultat<ComptagePurge>> {
  return run("reglages.compter", "gestionnaire", async (ctx) => {
    const mois = niche.legal.conservationMois;
    const maintenant = Date.now();
    const limite = limiteConservation(maintenant, mois);
    const compter = { count: "exact", head: true } as const;
    const [inactives, appels, rdv, debriefs, retours] = await Promise.all([
      ctx.supabase.from("leads").select("id", compter).or(filtreFichesInactives(limite)),
      ctx.supabase.from("appels").select("id", compter).lt("created_at", limite),
      ctx.supabase.from("rendez_vous").select("id", compter).lt("debut", limite),
      ctx.supabase.from("debriefs").select("id", compter).lt("created_at", limite),
      ctx.supabase.from("retours_marche").select("id", compter).lt("appel_le", limite),
    ]);
    const erreur = inactives.error ?? appels.error ?? rdv.error ?? debriefs.error ?? retours.error;
    if (erreur) return echecBase("reglages.compter", erreur);

    // Les fiches qui ont un rendez-vous à venir sont gardées par la purge : on les retire du compte (les rendez-vous lus page par page).
    const ids = new Set<string>();
    for (let depuis = 0; ; depuis += TAILLE_PAGE) {
      const page = await ctx.supabase
        .from("rendez_vous")
        .select("lead_id")
        .not("lead_id", "is", null)
        .gt("debut", new Date(maintenant).toISOString())
        .in("statut", ["pris", "confirme"])
        .order("id")
        .range(depuis, depuis + TAILLE_PAGE - 1);
      if (page.error) return echecBase("reglages.compter.avenir", page.error);
      const l = lignes(page.data);
      for (const x of l) if (typeof x.lead_id === "string") ids.add(x.lead_id);
      if (l.length < TAILLE_PAGE) break;
    }
    const liste = [...ids];
    let gardees = 0;
    for (let i = 0; i < liste.length; i += TAILLE_LOT_IDS) {
      const r = await ctx.supabase.from("leads").select("id", compter).in("id", liste.slice(i, i + TAILLE_LOT_IDS)).or(filtreFichesInactives(limite));
      if (r.error) return echecBase("reglages.compter.gardees", r.error);
      gardees += r.count ?? 0;
    }
    return {
      ok: true,
      data: {
        mois,
        limite,
        fiches: Math.max(0, (inactives.count ?? 0) - gardees),
        appels: appels.count ?? 0,
        rendezVous: rdv.count ?? 0,
        debriefs: debriefs.count ?? 0,
        retours: retours.count ?? 0,
        cleService: clientService() !== null,
      },
    };
  });
}

/**
 * La purge complète, après confirmation : { confirme: true }. Avec la clé service, après le contrôle du rôle : purger_fiches_inactives
 * (durée de la configuration), l'effacement des audios qu'elle désigne, purger_integrations_evenements, puis les audios restés sans appel.
 */
export async function purgerMaintenant(entree: unknown): Promise<Resultat<CompteRenduPurge>> {
  return run("reglages.purge", "gestionnaire", async (ctx) => {
    validerConfirmation(entree);
    const ws = equipe(ctx);
    const service = clientService();
    if (!service) return { ok: false, error: ERR_SANS_CLE_SERVICE };
    const debut = Date.now();
    const effacer = (chemin: string) => effacerDuStockage(chemin, process.env, fetch);
    const r = await executerPurge({
      mois: niche.legal.conservationMois,
      purgerBase: (mois) => service.rpc("purger_fiches_inactives", { p_mois: mois }),
      purgerEvenements: () => service.rpc("purger_integrations_evenements"),
      effacerAudio: effacer,
      balayer: () =>
        balayerAudiosOrphelins({
          workspaceIds: [ws],
          lister: listerParStockage(process.env, fetch),
          references: async (chemins) => {
            const { data, error } = await service.from("appels").select("enregistrement_chemin").in("enregistrement_chemin", chemins);
            if (error) return { ok: false, code: `references_${codeDe(error)}` };
            return { ok: true, chemins: new Set(lignes(data).map((l) => String(l.enregistrement_chemin))) };
          },
          effacer,
          avant: seuilAudiosOrphelins(debut, niche.legal.conservationMois),
          echeance: debut + BUDGET_AUDIOS_MS,
        }),
      echeance: debut + BUDGET_AUDIOS_MS,
      journal,
    });
    if (r.ok) {
      revalidatePath("/reglages");
      revalidatePath("/prospects");
    }
    return r;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// RGPD : l'effacement d'une fiche (droit d'effacement d'une personne)
// ---------------------------------------------------------------------------------------------------------------------------------

function arret<T>(nom: string, erreur: { code?: string } | null, etape: string): Resultat<T> {
  echecBase(nom, erreur);
  return { ok: false, error: `L'effacement s'est arrêté (${etape}) : relance-le, ce qui est fait reste fait.` };
}

/**
 * Efface une fiche à la demande de la personne : { leadId, opposition, confirme: true } (propriétaire seulement). Dans l'ordre : ses
 * identifiants sur la liste d'opposition (si demandé, ou si elle est déjà « ne plus contacter » : on le vérifie en les inscrivant) ; les
 * audios de ses appels (et des appels reçus sans fiche à l'un de ses numéros), PUIS ces appels : si un audio ne s'efface pas, rien d'autre
 * n'est effacé et une relance reprend tout ; ses rendez-vous ; ses retours du marché ; la fiche (son journal et ses débriefs partent avec
 * elle). La liste d'opposition reste. Pas de revalidatePath : Next.js relirait la page de la fiche effacée (une 404) au lieu du compte
 * rendu ; les pages de l'application sont dynamiques, la liste se relit en y revenant.
 */
export async function effacerFiche(entree: unknown): Promise<Resultat<CompteRenduEffacement>> {
  return run("reglages.effacer", "proprietaire", async (ctx) => {
    const v = validerEffacement(entree);
    const ws = equipe(ctx);
    const lu = await ctx.supabase.from("leads").select("id, siren, telephone, mobile, entreprise, cp, statut").eq("id", v.leadId).maybeSingle();
    if (lu.error) return echecBase("reglages.effacer.lecture", lu.error);
    const fiche = lireFicheAEffacer(lu.data);
    if (!fiche) return { ok: false, error: ERR_FICHE_INTROUVABLE };
    const neuf = neufChiffresDe(fiche);
    const service = clientService();

    if (!service) {
      // Sans clé service, les appels ne s'effacent pas : on refuse avant toute écriture s'il y en a.
      const filtres = [`lead_id.eq.${fiche.id}`, ...neuf.map((n) => `and(lead_id.is.null,numero_externe.like.*${n})`)];
      const c = await ctx.supabase.from("appels").select("id", { count: "exact", head: true }).or(filtres.join(","));
      if (c.error) return echecBase("reglages.effacer.appels", c.error);
      if ((c.count ?? 0) > 0) return { ok: false, error: ERR_EFFACEMENT_SANS_CLE };
    }

    // 1. La liste d'opposition d'abord : elle ne sera plus jamais rappelée ni réimportée. Une fiche « ne plus contacter » y est inscrite
    //    elle aussi : l'insertion dit si ses identifiants y étaient déjà (23505), plutôt que de le déduire de son statut.
    let opposition: EtatOpposition = "non_demandee";
    if (v.opposition || fiche.opposee) {
      let ligneOpp = ligneOpposition(fiche);
      if (!ligneOpp && fiche.entreprise) {
        // Ni SIREN ni numéro : la clé nom + code postal, calculée par la base (la même que l'import et le Poste comparent).
        const cle = await ctx.supabase.rpc("cle_entreprise", { p_entreprise: fiche.entreprise, p_cp: fiche.cp ?? "" });
        if (cle.error) return arret("reglages.effacer.cle", cle.error, "liste d'opposition");
        ligneOpp = ligneOpposition(fiche, typeof cle.data === "string" ? cle.data : null);
      }
      if (!ligneOpp) opposition = "sans_identifiant";
      else {
        const { error } = await ctx.supabase.from("opposition").insert(ligneOpp);
        if (error && error.code !== "23505") return arret("reglages.effacer.opposition", error, "liste d'opposition");
        opposition = error ? "deja" : "inscrite";
      }
    }

    // 2. Ses appels (la table appels ne s'écrit qu'avec la clé service) : d'abord leurs audios, puis les lignes.
    let appels = 0;
    let audios = 0;
    if (service) {
      const cibles: (string | null)[] = [null, ...neuf];
      const chemins: string[] = [];
      for (const numero of cibles) {
        const base = service.from("appels").select("enregistrement_chemin").eq("workspace_id", ws).not("enregistrement_chemin", "is", null);
        const { data, error } = await (numero === null ? base.eq("lead_id", fiche.id) : base.is("lead_id", null).like("numero_externe", `%${numero}`));
        if (error) return arret("reglages.effacer.audios", error, "audios");
        for (const l of lignes(data)) if (typeof l.enregistrement_chemin === "string") chemins.push(l.enregistrement_chemin);
      }
      for (const chemin of chemins) {
        const r = await effacerDuStockage(chemin, process.env, fetch);
        if (!r.ok) {
          journal(`effacement:audio:${r.code ?? "stockage"}`);
          return {
            ok: false,
            error: `L'effacement s'est arrêté : un audio n'a pas pu être retiré du stockage (code ${r.code ?? "stockage"}). Ses appels et la fiche n'ont pas été effacés : relance l'effacement.`,
          };
        }
        audios++;
      }
      for (const numero of cibles) {
        const base = service.from("appels").delete().eq("workspace_id", ws);
        const { data, error } = await (numero === null
          ? base.eq("lead_id", fiche.id).select("id")
          : base.is("lead_id", null).like("numero_externe", `%${numero}`).select("id"));
        if (error) return arret("reglages.effacer.appels", error, "appels");
        appels += lignes(data).length;
      }
    }

    // 3. Ses rendez-vous et ses retours du marché (un gestionnaire les retire, RLS).
    const rdv = await ctx.supabase.from("rendez_vous").delete().eq("lead_id", fiche.id).select("id");
    if (rdv.error) return arret("reglages.effacer.rdv", rdv.error, "rendez-vous");
    const retours = await ctx.supabase.from("retours_marche").delete().eq("lead_id", fiche.id).select("id");
    if (retours.error) return arret("reglages.effacer.retours", retours.error, "retours du marché");

    // 4. La fiche : son journal (lead_activities) et ses débriefs partent avec elle ; la liste d'opposition reste.
    const fin = await ctx.supabase.from("leads").delete().eq("id", fiche.id).select("id");
    if (fin.error) return arret("reglages.effacer.fiche", fin.error, "fiche");
    if (lignes(fin.data).length === 0) return { ok: false, error: "Cette fiche a déjà été effacée." };

    return {
      ok: true,
      data: { appels, audios, rendezVous: lignes(rdv.data).length, retours: lignes(retours.data).length, opposition },
    };
  });
}
