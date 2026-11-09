// La reprise différée de l'audio et de la transcription : GET /api/telephonie/recuperation, appelée par une tâche planifiée (Vercel Cron,
// avec l'en-tête « Authorization: Bearer <CRON_SECRET> »). Module PUR : la route lit les appels en attente et branche les dépendances.
//
// Pourquoi : chez Onoff, l'audio arrive 5 à 8 minutes après la fin de l'appel. Le webhook répond en moins de 10 s et sa suite (after())
// ne peut pas attendre si longtemps. Ce qui manque est donc repris ici, par l'API du fournisseur (ONOFF_API_KEY ; AIRCALL_API_ID et
// AIRCALL_API_TOKEN), dans des bornes strictes : 20 tentatives au plus par appel (comptées par la base, etat_recuperation_appel),
// une par minute au plus, pendant 48 heures après l'appel, et quelques appels par passage (l'API d'Onoff accepte 2 requêtes par seconde).
// Rien n'est jamais téléchargé pour un appel que la base ne dit pas conservable (enregistrement complet ET annonce faite).

import { egalTempsConstant, valeurEnv, variablesManquantes, type Env } from "../integrations/base";
import { conserverEnregistrement, conserverTranscription, lireEtatRecuperation, type AppelCible, type Recuperateur } from "./audio";
import { recuperateurAircall } from "./aircall";
import { recuperateurOnoff } from "./onoff";
import { idExterne, LONGUEURS_MIN_SECRETS, objet, texte } from "./outils";
import type { Dependances, FournisseurTelephonie } from "./types";

export const MAX_TENTATIVES = 20;
export const INTERVALLE_TENTATIVES_MS = 60_000;
export const FENETRE_RECUPERATION_MS = 48 * 3600_000;
/** Les appels lus en base à chaque passage (triés : jamais tentés d'abord, puis les plus anciennes tentatives). */
export const LOT_LECTURE = 40;
/** Les appels repris à chaque passage. */
export const LOT_TRAITEMENT = 8;
/** La pause entre deux appels repris (le débit des API des fournisseurs). */
export const PAUSE_ENTRE_APPELS_MS = 1000;
/** Le budget d'un passage (la route a 60 s au plus). */
export const BUDGET_PASSAGE_MS = 45_000;

/** Les fournisseurs dont l'audio se reprend par l'API. Ringover : son lien arrive dans le webhook « record_available », pas d'API ici. */
export const RECUPERATEURS: Partial<Record<FournisseurTelephonie, Recuperateur>> = {
  onoff: recuperateurOnoff,
  aircall: recuperateurAircall,
};

/** Vrai si l'en-tête Authorization porte exactement « Bearer <CRON_SECRET> » (temps constant ; secret de 16 caractères au moins). */
export function autoriseCron(entete: string | null, env: Env): boolean {
  const secret = valeurEnv(env, "CRON_SECRET");
  if (secret.length < (LONGUEURS_MIN_SECRETS.CRON_SECRET ?? 16)) return false;
  return typeof entete === "string" && egalTempsConstant(entete, `Bearer ${secret}`);
}

export interface AppelEnAttente {
  externeId: string;
  workspaceId: string;
  tentatives: number;
  derniereTentative: number | null;
}

/** Les lignes lues en base (externe_id, workspace_id, tentatives, derniere_tentative) -> les appels à reprendre maintenant. */
export function selectionnerAppels(lignes: readonly unknown[], maintenant: number): AppelEnAttente[] {
  const choisis: AppelEnAttente[] = [];
  for (const l of lignes) {
    const o = objet(l);
    const externeId = idExterne(o.externe_id);
    const workspaceId = texte(o.workspace_id, 60);
    const tentatives = typeof o.tentatives === "number" ? o.tentatives : 0;
    const derniere = typeof o.derniere_tentative === "string" ? Date.parse(o.derniere_tentative) : Number.NaN;
    if (!externeId || !workspaceId || tentatives >= MAX_TENTATIVES) continue;
    if (Number.isFinite(derniere) && maintenant - derniere < INTERVALLE_TENTATIVES_MS) continue;
    choisis.push({ externeId, workspaceId, tentatives, derniereTentative: Number.isFinite(derniere) ? derniere : null });
    if (choisis.length >= LOT_TRAITEMENT) break;
  }
  return choisis;
}

/** Reprend UN appel : l'état d'abord (rien si non conservable, complet, ou au plafond), puis une tentative comptée, puis l'API. */
export async function recupererAppel(fournisseur: FournisseurTelephonie, a: AppelEnAttente, rec: Recuperateur, d: Dependances): Promise<string[]> {
  const cible: AppelCible = { fournisseur, externeId: a.externeId, workspaceId: a.workspaceId };
  const etat = await lireEtatRecuperation(cible, false, d);
  if ("code" in etat) return [etat.code];
  if (!etat.existe) return ["appel_inconnu"];
  if (!etat.conserverAudio) return ["audio_ignore"];
  if (etat.aEnregistrement && (etat.aTranscription || !rec.transcription)) return ["deja_complet"];
  if (etat.tentatives >= MAX_TENTATIVES) return ["trop_de_tentatives"];
  const derniere = etat.derniereTentative ? Date.parse(etat.derniereTentative) : Number.NaN;
  if (Number.isFinite(derniere) && d.maintenant() - derniere < INTERVALLE_TENTATIVES_MS) return ["trop_tot"];
  const compte = await lireEtatRecuperation(cible, true, d);
  if ("code" in compte) return [compte.code];
  const codes: string[] = [];
  if (!etat.aEnregistrement) {
    const u = await rec.urlEnregistrement(a.externeId, d);
    codes.push("code" in u ? u.code : await conserverEnregistrement(cible, u.url, d, rec.extension));
  }
  if (!etat.aTranscription && rec.transcription) {
    const t = await rec.transcription(a.externeId, d);
    codes.push("code" in t ? t.code : await conserverTranscription(cible, t.lignes, t.resume, d));
  }
  return codes;
}

export interface BilanReprise {
  examines: number;
  audios: number;
  transcriptions: number;
  /** Les codes comptés (« audio_garde: 2 », « enregistrement_pas_pret: 3 ») : jamais un identifiant. */
  codes: Record<string, number>;
}

/** Un passage : les appels choisis, un par un, avec une pause entre deux, dans le budget du passage. */
export async function recupererEnAttente(
  fournisseur: FournisseurTelephonie,
  rec: Recuperateur,
  lignes: readonly unknown[],
  d: Dependances,
): Promise<BilanReprise> {
  const bilan: BilanReprise = { examines: 0, audios: 0, transcriptions: 0, codes: {} };
  const debut = d.maintenant();
  const appels = selectionnerAppels(lignes, debut);
  for (const [i, a] of appels.entries()) {
    if (d.maintenant() - debut > BUDGET_PASSAGE_MS) break;
    if (i > 0) await d.attendre(PAUSE_ENTRE_APPELS_MS);
    bilan.examines += 1;
    let codes: string[];
    try {
      codes = await recupererAppel(fournisseur, a, rec, d);
    } catch {
      codes = ["erreur"];
    }
    for (const c of codes) {
      bilan.codes[c] = (bilan.codes[c] ?? 0) + 1;
      if (c === "audio_garde") bilan.audios += 1;
      if (c === "transcription_gardee") bilan.transcriptions += 1;
    }
  }
  d.journal(`reprise:${fournisseur}:${bilan.examines} examine(s), ${bilan.audios} audio(s), ${bilan.transcriptions} transcription(s)`);
  return bilan;
}

/** Les variables de l'API du fournisseur qui manquent (sans elles, la reprise ne fait rien). */
export function variablesRepriseManquantes(rec: Recuperateur, env: Env): string[] {
  return variablesManquantes(env, rec.variables);
}
