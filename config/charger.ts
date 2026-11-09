// Le chargeur typé de la configuration : schéma (config/schema.ts) puis garde-fous (config/garde-fous.ts). Ajoute d'office l'objection
// « libre » (une objection hors liste, notée telle quelle). Les messages d'erreur sont en français, un par problème, avec le chemin.
// Imports RELATIFS seulement (lu par next.config.ts au build).

import { z } from "zod";
import { formaterViolation, verifierGardeFous } from "./garde-fous";
import { schemaNiche, type Niche, type Objection } from "./schema";

export const OBJECTION_LIBRE: Objection = {
  code: "libre",
  libelle: "Autre objection (texte libre)",
  reponse: "Écoute jusqu'au bout, reformule, puis note la phrase exacte du prospect.",
};

export type ResultatAnalyse = { ok: true; niche: Niche } | { ok: false; problemes: string[] };

export class ErreurConfig extends Error {
  readonly problemes: string[];

  constructor(problemes: string[]) {
    super(`config/niche.json invalide (${problemes.length} problème${problemes.length > 1 ? "s" : ""}) :\n- ${problemes.join("\n- ")}`);
    this.name = "ErreurConfig";
    this.problemes = problemes;
  }
}

function formaterIssue(issue: z.core.$ZodIssue): string {
  const chemin = issue.path.map(String).join(".");
  return chemin ? `${chemin} : ${issue.message}` : issue.message;
}

export function avecObjectionLibre(n: Niche): Niche {
  return n.objections.some((o) => o.code === OBJECTION_LIBRE.code) ? n : { ...n, objections: [...n.objections, OBJECTION_LIBRE] };
}

/** Valide sans lever d'exception : la liste des problèmes, ou la config prête à l'emploi. */
export function analyserNiche(brut: unknown): ResultatAnalyse {
  const r = schemaNiche.safeParse(brut, { error: z.locales.fr().localeError });
  if (!r.success) return { ok: false, problemes: r.error.issues.map(formaterIssue) };
  const violations = verifierGardeFous(r.data);
  if (violations.length > 0) return { ok: false, problemes: violations.map(formaterViolation) };
  return { ok: true, niche: avecObjectionLibre(r.data) };
}

/** Valide et renvoie la config ; lève ErreurConfig (avec tous les problèmes) sinon. */
export function chargerNiche(brut: unknown): Niche {
  const r = analyserNiche(brut);
  if (!r.ok) throw new ErreurConfig(r.problemes);
  return r.niche;
}
