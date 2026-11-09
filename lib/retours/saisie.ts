// La saisie rapide d'un retour du marché depuis la page /retours : une objection (code de la config), le verdict d'une accroche, une
// citation. Revérifiée ici (on ne fait jamais confiance au navigateur), puis écrite sous la RLS (retours_marche_creation : à son nom).
// Module PUR (tests/retours-formatage.test.mjs).

import { ErreurSaisie, parmi, texte } from "../server/validation";
import { VERDICTS_BASE, type VerdictBase } from "./libelles";

/** Les bornes de la base (0001 : retours_marche). */
export const MAX_SAISIE = { citation: 300, objectionTexte: 400 } as const;

export interface SaisieRetour {
  objection_code: string | null;
  objection_texte: string | null;
  accroche_verdict: VerdictBase | null;
  citation: string | null;
}

export interface SaisieBrute {
  objection?: unknown;
  objectionTexte?: unknown;
  verdict?: unknown;
  citation?: unknown;
}

/** Retire les guillemets ajoutés autour d'une citation (la base garde les mots, pas la ponctuation de citation). */
export function sansGuillemets(t: string): string {
  return t.replace(/^[\s«»"“”„]+|[\s«»"“”„]+$/gu, "").trim();
}

/**
 * La saisie validée. Il faut au moins l'objection, le verdict ou la citation. Une objection hors config est refusée (« libre » permet
 * de noter les mots du prospect). Les textes trop longs sont refusés, jamais coupés (une citation coupée ne serait plus mot pour mot).
 */
export function validerSaisieRetour(brut: SaisieBrute, codesObjection: readonly string[]): SaisieRetour {
  const objection = parmi(brut.objection, codesObjection, "Objection");
  const verdict = parmi(brut.verdict, VERDICTS_BASE, "Verdict de l'accroche");
  const objectionTexte = texte(brut.objectionTexte, "Mots de l'objection", MAX_SAISIE.objectionTexte);
  const citationBrute = texte(brut.citation, "Citation", MAX_SAISIE.citation + 10);
  const citation = citationBrute === null ? null : sansGuillemets(citationBrute) || null;
  if (citation !== null && citation.length > MAX_SAISIE.citation) {
    throw new ErreurSaisie(`Citation : ${MAX_SAISIE.citation} caractères au plus.`);
  }
  if (objectionTexte !== null && objection === null) {
    throw new ErreurSaisie("Choisis l'objection (ou « libre ») avant d'écrire ses mots.");
  }
  if (objection === null && verdict === null && citation === null) {
    throw new ErreurSaisie("Note au moins une objection, un verdict d'accroche ou une citation.");
  }
  return { objection_code: objection, objection_texte: objectionTexte, accroche_verdict: verdict, citation };
}
