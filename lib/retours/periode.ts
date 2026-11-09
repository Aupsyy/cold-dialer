// La période de la page /retours : les 7 ou les 30 derniers jours (fenêtre glissante jusqu'à maintenant). Module PUR : l'heure est passée
// en paramètre.

export const PERIODES = [7, 30] as const;
export type Periode = (typeof PERIODES)[number];

export const PERIODE_DEFAUT: Periode = 7;

/** La période demandée dans l'adresse (?periode=30) ; 7 jours pour toute autre valeur. */
export function lirePeriode(v: unknown): Periode {
  const brut = Array.isArray(v) ? v[0] : v;
  const n = typeof brut === "string" && /^\d{1,3}$/.test(brut) ? Number(brut) : NaN;
  return (PERIODES as readonly number[]).includes(n) ? (n as Periode) : PERIODE_DEFAUT;
}

/** Les bornes passées à retours_marche_agreger (début inclus, fin exclue). La fin a une minute d'avance : un retour noté à l'instant
 * compte. */
export function bornesPeriode(jours: Periode, maintenantMs: number): { debut: string; fin: string } {
  return {
    debut: new Date(maintenantMs - jours * 86_400_000).toISOString(),
    fin: new Date(maintenantMs + 60_000).toISOString(),
  };
}

export function libellePeriode(jours: Periode): string {
  return `${jours} derniers jours`;
}
