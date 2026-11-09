// Les numéros au format international E.164 (« +33199000101 ») : normalisation d'un numéro saisi ou reçu d'un fournisseur, validation,
// affichage. Module PUR (navigateur, serveur, build). Mêmes règles que la fonction SQL normaliser_e164 de la migration 0001, avec en plus
// l'indicatif de n'importe quel pays (config.pays.indicatif) pour lire un numéro national.
//
//   normaliserE164("01 99 00 01 01", "+33")    -> "+33199000101"
//   normaliserE164("+33 (0)6 39 98 01 02")      -> "+33639980102"   (international : l'indicatif n'est pas nécessaire)
//   normaliserE164("613-555-0123", "+1")        -> "+16135550123"
//   normaliserE164("02 000 00 01")              -> null            (national, sans indicatif : illisible)

export const RE_E164 = /^\+[1-9]\d{5,14}$/;

/** Les pays où le 0 du numéro national disparaît à l'international (« +33 0 1… » devient « +33 1… »). */
const INDICATIFS_ZERO_NATIONAL = ["33", "32", "41", "352", "377", "31", "43", "44", "49"] as const;

/** Les règles de longueur des pays les plus courants ; les autres pays : 6 à 15 chiffres (la règle générale de l'E.164). */
const REGLES_PAYS: readonly (readonly [string, RegExp])[] = [
  ["1", /^\+1[2-9]\d{2}[2-9]\d{6}$/], // Canada, États-Unis : indicatif régional et central sans 0 ni 1 en tête
  ["33", /^\+33[1-9]\d{8}$/], // France : 9 chiffres après l'indicatif
  ["32", /^\+32[1-9]\d{7,8}$/], // Belgique : 8 (fixe) ou 9 (mobile) chiffres
  ["41", /^\+41[1-9]\d{8}$/], // Suisse : 9 chiffres
];

/** L'indicatif en chiffres (« +33 » ou « 33 » -> « 33 »), ou null. */
export function chiffresIndicatif(indicatif: string | null | undefined): string | null {
  const m = typeof indicatif === "string" ? /^\+?([1-9]\d{0,3})$/.exec(indicatif.trim()) : null;
  return m ? m[1] : null;
}

/** Vrai pour un numéro E.164 plausible (et conforme à la règle de son pays quand on la connaît). */
export function estE164(v: unknown): v is string {
  if (typeof v !== "string" || !RE_E164.test(v)) return false;
  for (const [indicatif, regle] of REGLES_PAYS) {
    if (v.startsWith(`+${indicatif}`)) return regle.test(v);
  }
  return true;
}

/**
 * Un numéro saisi ou reçu (espaces, points, tirets, parenthèses, « (0) », préfixe 00, 0 national) -> E.164, ou null s'il est illisible.
 * `indicatif` (« +33 ») sert seulement à lire un numéro NATIONAL ; un numéro déjà international garde son pays.
 */
export function normaliserE164(saisie: unknown, indicatif?: string | null): string | null {
  if (typeof saisie !== "string" && typeof saisie !== "number") return null;
  let v = String(saisie).trim();
  if (v === "" || v.length > 40) return null;
  v = v.replace(/^(\+\d{1,4})\s*\(0\)/, "$1");
  v = v.replace(/[\s.()/-]/g, "");
  if (!/^\+?\d{4,20}$/.test(v)) return null;
  const pays = chiffresIndicatif(indicatif);
  if (/^00[1-9]/.test(v)) {
    v = `+${v.slice(2)}`;
  } else if (!v.startsWith("+")) {
    if (pays === "1" && /^1?[2-9]\d{9}$/.test(v)) v = `+1${v.slice(-10)}`;
    else if (pays !== null && pays !== "1" && /^0[1-9]\d{4,13}$/.test(v)) v = `+${pays}${v.slice(1)}`;
    else if (pays !== null && v.startsWith(pays) && /^[1-9]\d{4,13}$/.test(v.slice(pays.length))) v = `+${v}`;
    else return null;
  }
  for (const p of INDICATIFS_ZERO_NATIONAL) {
    if (v.startsWith(`+${p}0`)) {
      v = `+${p}${v.slice(p.length + 2)}`;
      break;
    }
  }
  return estE164(v) ? v : null;
}

/**
 * Un numéro reçu d'un fournisseur (webhook) : en E.164 s'il est international ; un numéro national (« 0199000101 ») ou en chiffres seuls
 * (« 33199000101 ») est gardé en chiffres, pour être lu avec l'indicatif de l'instance par la route (reception.ts) ; sinon null.
 */
export function numeroRecu(v: unknown): string | null {
  const international = normaliserE164(v);
  if (international) return international;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const c = String(v).trim().replace(/[\s.()/-]/g, "");
  return /^\d{5,15}$/.test(c) ? c : null;
}

/** Les 9 derniers chiffres d'un numéro (le rapprochement d'une fiche par la base : tel9), ou null s'il y en a moins de 9. */
export function neufDerniersChiffres(v: unknown): string | null {
  const c = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return c.length >= 9 ? c.slice(-9) : null;
}

/** Un numéro E.164 lisible à l'écran : « +33 1 99 00 01 01 », « +1 613 555 0123 » ; les autres pays tels quels. */
export function formaterNumero(e164: string): string {
  if (/^\+33[1-9]\d{8}$/.test(e164)) return `+33 ${e164[3]} ${e164.slice(4).replace(/(\d{2})(?=\d)/g, "$1 ")}`;
  if (/^\+1\d{10}$/.test(e164)) return `+1 ${e164.slice(2, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
  return e164;
}
