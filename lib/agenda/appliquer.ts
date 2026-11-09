// L'envoi des événements de rendez-vous à la base : un appel à evenement_agenda(p_evenement) par événement (clé service), dans l'ordre.
// Commun au webhook (Calendly, iClosed) et à la synchronisation Google. Le journal ne porte que des codes et des compteurs.
//
// Une erreur DÉFINITIVE (événement illisible pour la base, équipe introuvable) écarte l'événement et l'on continue : le fournisseur ne
// doit pas le renvoyer sans fin. Une erreur PASSAGÈRE (réseau, base occupée, conflit) arrête l'envoi : la réponse 500 fait renvoyer
// l'envoi entier, et les événements déjà passés reviennent en « doublon » (idempotence de la base).

import { objet, type Journal, type ResultatBase, type Rpc } from "../integrations/base";
import { FONCTIONS_SQL_AGENDA, type EvenementRdv, type ResultatEvenementRdv } from "./types";

/** Les codes SQL qu'un renvoi ne corrigera pas : donnée invalide, contrainte, équipe introuvable. */
export const CODES_DEFINITIFS: ReadonlySet<string> = new Set(["22023", "22P02", "22007", "22008", "23514", "P0002"]);

export interface BilanApplication {
  ok: boolean;
  /** Le code de l'arrêt (passager), si ok est faux. */
  code?: string;
  traites: number;
  doublons: number;
  aVerifier: number;
  rejetes: number;
}

/** La réponse de evenement_agenda, lue sans confiance ; null si sa forme est inattendue. */
export function lireResultatEvenement(data: unknown): ResultatEvenementRdv | null {
  const o = objet(data);
  if (typeof o.doublon !== "boolean") return null;
  const id = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    doublon: o.doublon,
    workspaceId: id(o.workspaceId),
    rendezVousId: id(o.rendezVousId),
    leadId: id(o.leadId),
    aVerifier: o.aVerifier === true,
  };
}

function codeSur(code: unknown): string {
  return typeof code === "string" && /^[A-Za-z0-9_]{1,12}$/.test(code) ? code : "sans_code";
}

export async function appliquerEvenements(
  evenements: readonly EvenementRdv[],
  rpc: Rpc,
  journal: Journal,
  prefixe: string,
): Promise<BilanApplication> {
  const bilan: BilanApplication = { ok: true, traites: 0, doublons: 0, aVerifier: 0, rejetes: 0 };
  for (const e of evenements) {
    let reponse: ResultatBase;
    try {
      reponse = await rpc(FONCTIONS_SQL_AGENDA.evenement, { p_evenement: e });
    } catch {
      journal(`${prefixe}:base_injoignable`, true);
      return { ...bilan, ok: false, code: "base_injoignable" };
    }
    if (reponse.error) {
      const code = codeSur(reponse.error.code);
      if (CODES_DEFINITIFS.has(code)) {
        journal(`${prefixe}:${e.type}:rejete:${code}`, true);
        bilan.rejetes++;
        continue;
      }
      journal(`${prefixe}:${e.type}:erreur_base:${code}`, true);
      return { ...bilan, ok: false, code: "base" };
    }
    const r = lireResultatEvenement(reponse.data);
    if (!r) {
      journal(`${prefixe}:${e.type}:reponse_illisible`, true);
      return { ...bilan, ok: false, code: "reponse_illisible" };
    }
    if (r.doublon) {
      bilan.doublons++;
      continue;
    }
    bilan.traites++;
    if (r.aVerifier) bilan.aVerifier++;
  }
  return bilan;
}
