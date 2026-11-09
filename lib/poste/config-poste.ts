// Ce que le Poste lit de config/niche.json, en un seul endroit : le lieu (fuseau, pays), les issues, les codes d'objection, la partie
// « script » et ce que le navigateur reçoit (jamais toute la config). Module PUR : la niche est passée en argument.

import type { Niche } from "@/config/schema";
import type { CanalRdv, ConfigAgenda } from "@/lib/agenda/types";
import type { FournisseurTelephonie, ModeTelephonie, SchemaLien } from "@/lib/telephonie/types";
import { issuesDuPoste, type IssuePoste } from "./issues";
import type { ContexteIssue } from "./saisie-issue";
import type { ConfigScript } from "./script";
import type { Lieu } from "./temps";

export function lieuDe(n: Pick<Niche, "pays">): Lieu {
  return { fuseau: n.pays.fuseau, pays: n.pays.code };
}

export function contexteIssueDe(n: Pick<Niche, "issues" | "objections" | "pays" | "tentativesMax">, maintenant: number): ContexteIssue {
  return { issues: issuesDuPoste(n.issues), objections: n.objections.map((o) => o.code), lieu: lieuDe(n), maintenant, tentativesMax: n.tentativesMax };
}

export function configScriptDe(n: Pick<Niche, "script" | "objections" | "offre" | "legal">): ConfigScript {
  return { script: n.script, objections: n.objections, offre: n.offre, legal: n.legal };
}

export function configAgendaDe(n: Pick<Niche, "agenda">): ConfigAgenda {
  return {
    fournisseur: n.agenda.fournisseur,
    prefill: n.agenda.prefill,
    champLead: n.agenda.champLead,
    ...(n.agenda.lienReservation ? { lienReservation: n.agenda.lienReservation } : {}),
  };
}

/** Ce que le Poste (navigateur) reçoit de la config : rien de plus que ce qu'il affiche ou utilise. */
export interface ConfigPosteClient {
  lieu: Lieu;
  issues: IssuePoste[];
  objections: { code: string; libelle: string }[];
  telephonie: { fournisseur: FournisseurTelephonie; mode: ModeTelephonie; schemaLien: SchemaLien; copierNumero: boolean };
  rdv: { nom: string; dureeMin: number; canal: CanalRdv };
  tentativesMax: number;
}

export function configPosteClient(n: Niche): ConfigPosteClient {
  return {
    lieu: lieuDe(n),
    issues: issuesDuPoste(n.issues),
    objections: n.objections.map((o) => ({ code: o.code, libelle: o.libelle })),
    telephonie: {
      fournisseur: n.telephonie.fournisseur,
      mode: n.telephonie.mode,
      schemaLien: n.telephonie.schemaLien ?? "tel",
      copierNumero: n.telephonie.copierNumero,
    },
    rdv: { nom: n.offre.rdv.nom, dureeMin: n.offre.rdv.dureeMin, canal: n.offre.rdv.canal },
    tentativesMax: n.tentativesMax,
  };
}
