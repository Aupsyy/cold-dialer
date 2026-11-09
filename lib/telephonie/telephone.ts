// L'adaptateur minimal « telephone » : pas de fournisseur, pas de webhook. Sur un téléphone, le lien tel: ouvre le composeur ; sur un
// ordinateur, le numéro est copié (le Poste l'affiche en grand). La durée se saisit à la main ou au chronomètre du Poste.

import type { AdaptateurTelephonie, SchemaLien } from "./types";

const RE_E164 = /^\+[1-9]\d{5,14}$/;

/** Le lien d'appel (« tel:+33199000101 ») d'un numéro E.164 valide, sinon null. */
export function lienAppel(e164: string, schema: SchemaLien = "tel"): string | null {
  const numero = e164.trim();
  return RE_E164.test(numero) ? `${schema}:${numero}` : null;
}

/** Vrai pour un téléphone ou une tablette (le lien tel: y ouvre le composeur). */
export function estAppareilMobile(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

/** Copie un texte dans le presse-papiers ; faux si le navigateur refuse. */
export async function copierTexte(valeur: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(valeur);
    return true;
  } catch {
    return false;
  }
}

export const telephone: AdaptateurTelephonie = {
  id: "telephone",
  libelle: "Téléphone (lien tel: et copie du numéro)",
  originesMicro: [],
  client: {
    preparer() {
      return () => {};
    },
    etat() {
      return "pret";
    },
    async appeler(e164) {
      const lien = lienAppel(e164);
      if (!lien) throw new Error("Numéro illisible : il faut un numéro au format international (+33…).");
      const copie = await copierTexte(e164);
      if (typeof window !== "undefined" && estAppareilMobile(window.navigator.userAgent)) {
        window.location.href = lien;
        return "repli_tel";
      }
      return copie ? "copie" : "repli_tel";
    },
  },
};
