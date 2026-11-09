// L'accroche d'une fiche (leads.accroche, écrite par le skill « accroches ») et sa page source (leads.accroche_source) : le bandeau affiché
// au-dessus du script. Seule une URL http(s) valide devient un lien (jamais javascript:, data: ni un texte quelconque). Module PUR.

export interface AccrocheFiche {
  texte: string;
  source: string | null;
}

export function lienSourceSur(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 500 || !/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** L'accroche à afficher, ou null si la fiche n'en a pas (vide ou faite d'espaces). */
export function accrocheDeFiche(f: { accroche: string | null; accrocheSource: string | null }): AccrocheFiche | null {
  const texte = typeof f.accroche === "string" ? f.accroche.replace(/\s+/g, " ").trim() : "";
  if (!texte) return null;
  return { texte, source: lienSourceSur(f.accrocheSource) };
}
