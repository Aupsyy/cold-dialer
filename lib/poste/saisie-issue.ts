// L'enregistrement de l'issue d'un appel, côté serveur : la saisie revérifiée (on ne fait jamais confiance au navigateur), les arguments
// exacts de la fonction SQL enregistrer_issue(p_lead_id, p_issue, p_note, p_rappel_le, p_details), sa réponse lue, et l'opposition
// vérifiée après « ne_plus_contacter ». Module PUR : la base est injectée (Rpc), testé sans réseau par tests/poste-issues.test.mjs.
//
// Règles :
//   - l'issue est une issue de config.issues ; « final » vient de la config, jamais du navigateur ;
//   - exigeRappel (a_rappeler) : une date de rappel future est obligatoire, sinon refus ;
//   - rappelAuto « creneau_alterne » : le rappel est calculé ICI (fuseau et pays de la config), quoi qu'envoie le navigateur ;
//   - une issue finale n'envoie aucun rappel ; une autre issue peut en porter un (la base la passe alors « a_rappeler ») ;
//   - durée : de 0 à 86 400 secondes ; objection : un code de config.objections (ou « libre ») ;
//   - aucune écriture directe dans leads : tout passe par enregistrer_issue (une transaction, en base).

import type { Rpc } from "@/lib/integrations/base";
import { messageDepuisCode } from "@/lib/server/contexte";
import { ErreurSaisie, MAX_NOTE, dateHeure, texte, uuidObligatoire } from "@/lib/server/validation";
import { issueParCode, nettoyerNote, type IssuePoste } from "./issues";
import { rappelAutomatique } from "./rappels";
import { codeErreur, journalConsole, type JournalCodes, type Resultat } from "./resultat";
import type { Lieu } from "./temps";

/** Les bornes de la base pour un rappel (enregistrer_issue) : pas plus d'un jour dans le passé, pas plus de 400 jours devant. */
export const RAPPEL_PASSE_MAX_MS = 86_400_000;
export const RAPPEL_FUTUR_MAX_MS = 400 * 86_400_000;
/** Un rappel « à rappeler » se pose dans le futur (5 minutes de tolérance pour l'horloge du navigateur). */
export const TOLERANCE_RAPPEL_MS = 5 * 60_000;

export interface SaisieIssue {
  leadId: string;
  issue: IssuePoste;
  note: string | null;
  /** ISO 8601 (UTC), ou null. */
  rappelLe: string | null;
  dureeS: number | null;
  objection: string | null;
  /** Le plafond de tentatives de la file du Poste (config.tentativesMax), passé à la base : elle applique le plus bas des deux. */
  tentativesMax: number | null;
}

export interface ContexteIssue {
  issues: readonly IssuePoste[];
  objections: readonly string[];
  lieu: Lieu;
  maintenant: number;
  /** config.tentativesMax : le plafond qu'applique la file (estDansFile). */
  tentativesMax?: number;
}

function objetSaisi(brut: unknown): Record<string, unknown> {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) throw new ErreurSaisie("Saisie illisible.");
  return brut as Record<string, unknown>;
}

/** La saisie de l'issue, revérifiée ; lève ErreurSaisie (message lisible) sinon. */
export function validerSaisieIssue(brut: unknown, c: ContexteIssue): SaisieIssue {
  const o = objetSaisi(brut);
  const leadId = uuidObligatoire(o.leadId, "La fiche");
  const code = texte(o.issue, "L'issue", 40);
  const issue = issueParCode(c.issues, code);
  if (!issue) throw new ErreurSaisie("Choisis l'issue de l'appel.");

  const note = nettoyerNote(texte(o.note, "La note", MAX_NOTE), issue.gabaritNote);

  let dureeS: number | null = null;
  if (o.dureeS !== null && o.dureeS !== undefined && o.dureeS !== "") {
    if (typeof o.dureeS !== "number" || !Number.isFinite(o.dureeS) || o.dureeS < 0 || o.dureeS > 86_400) {
      throw new ErreurSaisie("La durée de l'appel : de 0 à 86 400 secondes.");
    }
    dureeS = Math.round(o.dureeS);
  }

  const objection = texte(o.objection, "L'objection", 40);
  if (objection !== null && !c.objections.includes(objection)) throw new ErreurSaisie("L'objection : choisis-la dans la liste.");

  let rappelLe: string | null = null;
  const auto = rappelAutomatique(issue, c.maintenant, c.lieu);
  if (issue.final) {
    rappelLe = null;
  } else if (auto) {
    rappelLe = new Date(auto.t).toISOString();
  } else {
    const saisi = dateHeure(o.rappelLe, "La date de rappel");
    if (saisi) {
      const t = Date.parse(saisi);
      if (t < c.maintenant - TOLERANCE_RAPPEL_MS) throw new ErreurSaisie("La date de rappel est passée : choisis une date à venir.");
      if (t > c.maintenant + RAPPEL_FUTUR_MAX_MS) throw new ErreurSaisie("La date de rappel est trop loin (400 jours au plus).");
      rappelLe = saisi;
    }
    if (issue.exigeRappel && !rappelLe) throw new ErreurSaisie("Choisis la date et l'heure du rappel.");
  }

  const plafond = c.tentativesMax;
  const tentativesMax = typeof plafond === "number" && Number.isInteger(plafond) && plafond >= 1 && plafond <= 10 ? plafond : null;
  return { leadId, issue, note, rappelLe, dureeS, objection, tentativesMax };
}

/** Les arguments exacts de public.enregistrer_issue(p_lead_id uuid, p_issue text, p_note text, p_rappel_le timestamptz, p_details jsonb). */
export function argumentsEnregistrerIssue(s: SaisieIssue): Record<string, unknown> {
  const details: Record<string, unknown> = { final: s.issue.final };
  if (s.dureeS !== null) details.duree_s = s.dureeS;
  if (s.objection !== null) details.objection = s.objection;
  if (s.tentativesMax !== null) details.tentativesMax = s.tentativesMax;
  return { p_lead_id: s.leadId, p_issue: s.issue.code, p_note: s.note, p_rappel_le: s.rappelLe, p_details: details };
}

export interface IssueEnregistree {
  leadId: string;
  statut: string;
  rappelLe: string | null;
  tentatives: number;
  activiteId: string;
  /** Après « ne_plus_contacter » : vrai si un identifiant de la fiche est bien dans la liste d'opposition (null : non vérifié). */
  opposition: boolean | null;
  /** Un avertissement lisible (par exemple : la fiche n'avait aucun identifiant à inscrire dans la liste d'opposition). */
  avertissement: string | null;
}

/** La réponse jsonb de enregistrer_issue : { leadId, statut, rappelLe, tentatives, activiteId }, ou null si sa forme surprend. */
export function lireIssueEnregistree(data: unknown): Omit<IssueEnregistree, "opposition" | "avertissement"> | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.leadId !== "string" || typeof d.statut !== "string" || typeof d.activiteId !== "string") return null;
  return {
    leadId: d.leadId,
    statut: d.statut,
    rappelLe: typeof d.rappelLe === "string" ? d.rappelLe : null,
    tentatives: typeof d.tentatives === "number" ? d.tentatives : 0,
    activiteId: d.activiteId,
  };
}

export const AVERTISSEMENT_SANS_IDENTIFIANT =
  "La fiche est classée « ne plus contacter », mais aucun de ses identifiants n'est sur la liste d'opposition : vérifie-la.";

/** Les identifiants d'une fiche pour la liste d'opposition : SIREN, numéros et, sans SIREN, nom et code postal (la clé de repli). */
export interface IdentifiantsFiche {
  siren: string | null;
  telephone: string | null;
  mobile: string | null;
  entreprise?: string | null;
  cp?: string | null;
}

export interface DependancesIssue {
  rpc: Rpc;
  /** Les identifiants de la fiche (lus avec la session), pour vérifier l'opposition après « ne_plus_contacter ». */
  identifiants: (leadId: string) => Promise<IdentifiantsFiche | null>;
  journal?: JournalCodes;
}

/** Enregistre l'issue (une saisie DÉJÀ validée) ; renvoie un message lisible en cas d'échec. Le journal ne reçoit que des codes. */
export async function executerIssue(s: SaisieIssue, d: DependancesIssue): Promise<Resultat<IssueEnregistree>> {
  const journal = d.journal ?? journalConsole;
  const { data, error } = await d.rpc("enregistrer_issue", argumentsEnregistrerIssue(s));
  if (error) {
    journal(`issue:${codeErreur(error)}`);
    return { ok: false, error: messageDepuisCode(error.code) };
  }
  const lu = lireIssueEnregistree(data);
  if (!lu) {
    journal("issue:reponse_illisible");
    return { ok: false, error: messageDepuisCode(undefined) };
  }
  if (s.issue.code !== "ne_plus_contacter") return { ok: true, data: { ...lu, opposition: null, avertissement: null } };

  // « Ne plus contacter » : la base a passé la fiche en ne_plus_contacter et inscrit ses identifiants dans « opposition ». On le vérifie.
  if (lu.statut !== "ne_plus_contacter") {
    journal("issue:opposition_statut_inattendu");
    return { ok: true, data: { ...lu, opposition: false, avertissement: AVERTISSEMENT_SANS_IDENTIFIANT } };
  }
  const ids = await d.identifiants(s.leadId);
  const telephone = ids?.telephone ?? ids?.mobile ?? null;
  const entreprise = ids?.entreprise ?? null;
  if (!ids || (!ids.siren && !telephone && !entreprise)) {
    journal("issue:opposition_sans_identifiant");
    return { ok: true, data: { ...lu, opposition: false, avertissement: AVERTISSEMENT_SANS_IDENTIFIANT } };
  }
  // Sans SIREN, la base inscrit aussi le nom et le code postal de la fiche (cle_entreprise) : une fiche sans numéro lisible est retrouvée.
  const verif = await d.rpc("lead_en_opposition", { p_telephone: telephone, p_siren: ids.siren, p_entreprise: entreprise, p_cp: ids.cp ?? null });
  if (verif.error) {
    journal(`issue:opposition_verification_${codeErreur(verif.error)}`);
    return { ok: true, data: { ...lu, opposition: null, avertissement: null } };
  }
  const opposee = verif.data === true;
  if (!opposee) journal("issue:opposition_absente");
  return { ok: true, data: { ...lu, opposition: opposee, avertissement: opposee ? null : AVERTISSEMENT_SANS_IDENTIFIANT } };
}
