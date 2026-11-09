// Lire une requête PostgREST par pages. Supabase coupe en silence toute réponse à 1 000 lignes (max_rows, supabase/config.toml), quelle
// que soit la limite demandée : au-delà, des appels du jour ou des retours manqueraient sans que rien ne le dise. lirePages demande des
// pages de 1 000 lignes (range) jusqu'à `max` lignes ou à une page incomplète, et dit si la lecture s'est arrêtée au plafond. La requête
// d'une page est injectée (elle doit trier sur une clé stable, pour que les pages ne se chevauchent pas). Module PUR.

export const TAILLE_PAGE_POSTGREST = 1000;

export interface ErreurPage {
  code?: string;
}

export interface Pages {
  lignes: unknown[];
  error: ErreurPage | null;
  /** Vrai si la lecture s'est arrêtée à `max` lignes : il en reste peut-être. */
  tronque: boolean;
}

export async function lirePages(
  page: (de: number, a: number) => PromiseLike<{ data: unknown; error: ErreurPage | null }>,
  { max, taille = TAILLE_PAGE_POSTGREST }: { max: number; taille?: number },
): Promise<Pages> {
  const lignes: unknown[] = [];
  for (let de = 0; de < max; de += taille) {
    const demandees = Math.min(taille, max - de);
    const r = await page(de, de + demandees - 1);
    if (r.error) return { lignes, error: r.error, tronque: false };
    const lues = Array.isArray(r.data) ? r.data : [];
    lignes.push(...lues);
    if (lues.length < demandees) return { lignes, error: null, tronque: false };
  }
  return { lignes, error: null, tronque: lignes.length >= max };
}
