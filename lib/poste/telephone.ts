// Les numéros d'une fiche, vus par le Poste : au format international E.164 (« +33199000101 », celui qu'attend l'adaptateur de téléphonie),
// portable ou fixe (l'ouverture du script en dépend), lisibles à l'écran, et le lien d'appel de repli (tel:, callto: ou sip:). Module PUR.
// versE164 suit exactement la fonction SQL normaliser_e164 de la migration 0001 (tests/poste-telephone.test.mjs compare les deux règles).

export type TypeNumero = "portable" | "fixe" | "inconnu";
export type SchemaLien = "tel" | "callto" | "sip";

const INDICATIFS: Readonly<Record<string, string>> = { FR: "33", BE: "32", CH: "41", LU: "352", MC: "377", CA: "1" };
const RE_E164 = /^\+[1-9]\d{5,14}$/;

/** Le numéro au format E.164, ou null s'il est illisible (même règle que normaliser_e164 en base). */
export function versE164(numero: string | null | undefined, pays: string): string | null {
  let v = (numero ?? "").trim().replace(/[\s.()/-]/g, "");
  if (v === "") return null;
  const indicatif = INDICATIFS[(pays ?? "").toUpperCase()] ?? null;
  if (/^00[1-9]/.test(v)) {
    v = `+${v.slice(2)}`;
  } else if (!v.startsWith("+")) {
    if (indicatif === "1" && /^1?[2-9]\d{9}$/.test(v)) {
      v = `+1${v.slice(-10)}`;
    } else if (indicatif !== null && indicatif !== "1" && /^0[1-9]\d{4,13}$/.test(v)) {
      v = `+${indicatif}${v.slice(1)}`;
    } else if (indicatif !== null && new RegExp(`^${indicatif}[1-9]\\d{4,13}$`).test(v)) {
      v = `+${v}`;
    } else {
      return null;
    }
  }
  // « +33 0 1 99… » : le 0 national en trop.
  v = v.replace(/^\+(33|32|41|352|377)0([1-9])/, "+$1$2");
  if (v.startsWith("+33") && !/^\+33[1-9]\d{8}$/.test(v)) return null;
  return RE_E164.test(v) ? v : null;
}

export function estE164(v: string | null | undefined): v is string {
  return typeof v === "string" && RE_E164.test(v);
}

/** Portable ou fixe, d'après l'indicatif et le début du numéro ; « inconnu » quand on ne peut pas le savoir (Canada, autres pays). */
export function typeNumero(e164: string): TypeNumero {
  if (!estE164(e164)) return "inconnu";
  if (e164.startsWith("+33")) return /^\+33[67]/.test(e164) ? "portable" : /^\+33[1-59]/.test(e164) ? "fixe" : "inconnu";
  if (e164.startsWith("+32")) return /^\+324[5-9]/.test(e164) ? "portable" : "fixe";
  if (e164.startsWith("+41")) return /^\+417[5-9]/.test(e164) ? "portable" : "fixe";
  if (e164.startsWith("+352")) return /^\+3526/.test(e164) ? "portable" : "fixe";
  if (e164.startsWith("+377")) return /^\+377[46]/.test(e164) ? "portable" : "fixe";
  return "inconnu";
}

/** L'ouverture du script pour ce numéro : un portable joint directement le dirigeant ; sinon, on passe par un standard. */
export function ouverturePour(type: TypeNumero): "portable" | "standard" {
  return type === "portable" ? "portable" : "standard";
}

export interface NumeroAppel {
  /** null : numéro illisible, montré tel quel pour le composer à la main. */
  e164: string | null;
  brut: string;
  type: TypeNumero;
  colonne: "telephone" | "mobile";
}

/** Les numéros d'une fiche (téléphone puis mobile), sans doublon. Le numéro de la colonne « mobile » compte comme un portable. */
export function numerosDeFiche(fiche: { telephone: string | null; mobile: string | null }, pays: string): NumeroAppel[] {
  const sortie: NumeroAppel[] = [];
  for (const colonne of ["telephone", "mobile"] as const) {
    const brut = (fiche[colonne] ?? "").trim();
    if (!brut) continue;
    const e164 = versE164(brut, pays);
    if (e164 && sortie.some((n) => n.e164 === e164)) continue;
    const type = e164 ? typeNumero(e164) : "inconnu";
    sortie.push({ e164, brut, type: colonne === "mobile" && type === "inconnu" ? "portable" : type, colonne });
  }
  return sortie;
}

/** Un numéro lisible à l'écran : « 01 99 00 01 01 » pour la France, sinon le format international. */
export function affichageNumero(e164: string, pays: string): string {
  if (pays.toUpperCase() === "FR" && /^\+33[1-9]\d{8}$/.test(e164)) {
    return `0${e164.slice(3)}`.replace(/(\d{2})(?=\d)/g, "$1 ");
  }
  return e164;
}

/** Le lien d'appel de repli d'un numéro E.164 (« tel:+33199000101 »), ou null s'il est illisible. */
export function lienAppel(e164: string | null | undefined, schema: SchemaLien = "tel"): string | null {
  return estE164(e164) ? `${schema}:${e164}` : null;
}
