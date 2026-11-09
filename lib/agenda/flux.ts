// La réponse du flux ICS (/api/agenda/ics/<jeton>), testable sans réseau : la route branche la clé service et le journal.
//   - jeton mal formé ou inconnu (agenda_flux renvoie null) → 404, le même message dans les deux cas ;
//   - clé service absente → 503 ; base en erreur → 502 ;
//   - sinon 200 text/calendar, cache court et privé.
// Le jeton n'apparaît jamais dans le journal.

import { VARIABLES_BASE_SERVICE, variablesManquantes, type Env, type Journal, type Rpc } from "../integrations/base";
import { evenementsDepuisFlux, genererIcs, jetonDepuisSegment, nomCalendrier } from "./ics";
import { FONCTIONS_SQL_AGENDA } from "./types";

export const ENTETES_FLUX = {
  "Cache-Control": "private, max-age=300",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export interface DependancesFlux {
  env: Env;
  base: () => Rpc;
  journal: Journal;
  /** L'adresse de l'application (origine de la requête), pour les liens vers les fiches. */
  origine: string;
  fuseau: string;
  nomRdv: string;
  nomProduit: string;
  maintenant: () => number;
}

export interface ReponseFlux {
  statut: number;
  corps: string;
  entetes: Record<string, string>;
}

function texteBrut(statut: number, corps: string): ReponseFlux {
  return { statut, corps, entetes: { ...ENTETES_FLUX, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } };
}

export async function repondreFlux(segment: unknown, d: DependancesFlux): Promise<ReponseFlux> {
  const jeton = jetonDepuisSegment(segment);
  if (!jeton) return texteBrut(404, "Agenda introuvable.");
  if (variablesManquantes(d.env, VARIABLES_BASE_SERVICE).length > 0) {
    d.journal("agenda:ics:non_configure (503)", true);
    return texteBrut(503, "Agenda pas encore configuré.");
  }
  let flux: unknown;
  try {
    const r = await d.base()(FONCTIONS_SQL_AGENDA.flux, { p_jeton: jeton });
    if (r.error) {
      d.journal(`agenda:ics:base:${typeof r.error.code === "string" && /^[A-Za-z0-9_]{1,12}$/.test(r.error.code) ? r.error.code : "sans_code"} (502)`, true);
      return texteBrut(502, "Agenda indisponible pour le moment.");
    }
    flux = r.data;
  } catch {
    d.journal("agenda:ics:base_injoignable (502)", true);
    return texteBrut(502, "Agenda indisponible pour le moment.");
  }
  if (flux === null || flux === undefined || typeof flux !== "object") return texteBrut(404, "Agenda introuvable.");

  const evenements = evenementsDepuisFlux(flux, { base: d.origine, nomRdv: d.nomRdv });
  const ics = genererIcs(evenements, { nom: nomCalendrier(flux, d.nomProduit), fuseau: d.fuseau, genereLe: d.maintenant() });
  return {
    statut: 200,
    corps: ics,
    entetes: { ...ENTETES_FLUX, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="agenda.ics"' },
  };
}
