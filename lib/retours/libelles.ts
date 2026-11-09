// Les libellés et les formats des retours du marché (page /retours, bloc « Appels transcrits » de la fiche) : objections, issues et
// champs de découverte lus dans la config, verdicts de l'accroche, pourcentages, intérêt, dates et durées.
// Module PUR (tests/retours-formatage.test.mjs) : la config est passée en paramètre, l'heure aussi.

import type { Niche } from "../../config/schema";

/** Les verdicts de l'accroche tels que la base les garde (retours_marche.accroche_verdict). */
export const VERDICTS_BASE = ["accroche", "neutre", "rejet"] as const;
export type VerdictBase = (typeof VERDICTS_BASE)[number];

/** Les verdicts tels que le débrief les écrit (docs/debrief.md), et leur traduction en base. scripts/debrief/lib.mjs garde la même table. */
export const VERDICTS_DEBRIEF = ["utile", "neutre", "contre-productive"] as const;
export type VerdictDebrief = (typeof VERDICTS_DEBRIEF)[number];
export const VERDICT_EN_BASE: Readonly<Record<VerdictDebrief, VerdictBase>> = {
  utile: "accroche",
  neutre: "neutre",
  "contre-productive": "rejet",
};

export const LIBELLES_VERDICT: Readonly<Record<VerdictBase, string>> = {
  accroche: "Utile",
  neutre: "Neutre",
  rejet: "Contre-productive",
};

export function estVerdictBase(v: unknown): v is VerdictBase {
  return typeof v === "string" && (VERDICTS_BASE as readonly string[]).includes(v);
}

/** Un verdict lu en base (accroche, neutre, rejet) ou dans un débrief (utile, neutre, contre-productive) ; null sinon. */
export function verdictLu(v: unknown): VerdictBase | null {
  if (estVerdictBase(v)) return v;
  if (typeof v === "string" && (VERDICTS_DEBRIEF as readonly string[]).includes(v)) return VERDICT_EN_BASE[v as VerdictDebrief];
  return null;
}

/** Le libellé d'une objection d'après son code (config.objections, « libre » compris) ; un code retiré de la config reste lisible. */
export function libelleObjection(code: string | null, niche: Pick<Niche, "objections">): string {
  if (!code) return "Aucune";
  return niche.objections.find((o) => o.code === code)?.libelle ?? code;
}

/** Le libellé d'une issue d'après son code (config.issues). */
export function libelleIssue(code: string | null, niche: Pick<Niche, "issues">): string {
  if (!code) return "Sans issue";
  return niche.issues.find((i) => i.code === code)?.libelle ?? code;
}

export interface ChampDecouverte {
  id: string;
  /** La question posée (config.debrief.champs, sinon config.script.questions). */
  question: string;
}

/** Les champs de découverte d'un débrief : config.debrief.champs, puis les questions du script qui n'y sont pas déjà (même id). */
export function champsDecouverte(niche: Pick<Niche, "debrief" | "script">): ChampDecouverte[] {
  const champs: ChampDecouverte[] = niche.debrief.champs.map((c) => ({ id: c.id, question: c.question }));
  for (const q of niche.script.questions) {
    if (!champs.some((c) => c.id === q.id)) champs.push({ id: q.id, question: q.texte });
  }
  return champs;
}

/** La question d'un champ de découverte, sans le point d'interrogation final ; l'identifiant si le champ n'est plus dans la config. */
export function libelleChamp(id: string, niche: Pick<Niche, "debrief" | "script">): string {
  const c = champsDecouverte(niche).find((x) => x.id === id);
  return c ? c.question.replace(/\s*\?\s*$/u, "") : id.replace(/_/g, " ");
}

/** Un pourcentage entier (arrondi), ou null sans dénominateur. */
export function pourcentage(n: number, total: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((n / total) * 100);
}

export function libellePourcentage(p: number | null): string {
  return p === null ? "n.d." : `${p} %`;
}

/** L'intérêt moyen sur 3, à la française (« 1,5 / 3 ») ; « n.d. » sans valeur. */
export function libelleInteret(moyen: number | null): string {
  if (moyen === null || !Number.isFinite(moyen)) return "n.d.";
  return `${moyen.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} / 3`;
}

const formateurs = new Map<string, Intl.DateTimeFormat>();
function formateur(fuseau: string, avecHeure: boolean): Intl.DateTimeFormat {
  const cle = `${fuseau}|${avecHeure}`;
  let f = formateurs.get(cle);
  if (!f) {
    f = new Intl.DateTimeFormat("fr-FR", {
      timeZone: fuseau,
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(avecHeure ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
    formateurs.set(cle, f);
  }
  return f;
}

/** Une date lisible dans le fuseau de l'équipe : « 9 nov. 2026 » ou « 9 nov. 2026 à 15 h 20 » ; « date inconnue » si illisible. */
export function dateLisible(iso: string | null, fuseau: string, avecHeure = false): string {
  if (!iso) return "date inconnue";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date inconnue";
  if (!avecHeure) return formateur(fuseau, false).format(d);
  const parties = formateur(fuseau, true).formatToParts(d);
  const val = (type: Intl.DateTimeFormatPartTypes) => parties.find((p) => p.type === type)?.value ?? "";
  return `${val("day")} ${val("month")} ${val("year")} à ${val("hour")} h ${val("minute")}`;
}

/** Une durée lisible : « 45 s », « 4 min 20 s », « 1 h 02 min » ; « durée inconnue » sans valeur. */
export function dureeLisible(secondes: number | null): string {
  if (secondes === null || !Number.isFinite(secondes) || secondes < 0) return "durée inconnue";
  const s = Math.round(secondes);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const reste = s % 60;
    return reste === 0 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 60)} min ${String(reste).padStart(2, "0")} s`;
  }
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}
