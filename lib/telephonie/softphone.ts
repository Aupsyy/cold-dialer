// L'adaptateur « softphone » (mode « lien ») : un logiciel de téléphonie installé sur l'ordinateur (Zoiper, 3CX, Microsoft Teams,
// MicroSIP…). « Appeler » ouvre un lien tel:, callto: ou sip: (config.telephonie.schemaLien, posé par le Poste en data-schema-lien) et
// copie le numéro (sauf data-copier-numero="0"). Le système d'exploitation envoie le lien à l'application choisie par l'utilisateur
// (docs/telephonie.md : macOS et Windows). Aucun webhook : la durée se saisit au Poste, ou au chronomètre du Poste.

import { estE164 } from "./e164";
import { EVENEMENT_ETAT, copierTexte, fenetreDe, optionsDe, ouvrirLien, signaler } from "./navigateur";
import { lienAppel } from "./telephone";
import type { AdaptateurTelephonie, ClientTelephonie } from "./types";

export function creerClientSoftphone(): ClientTelephonie {
  let el: HTMLElement | null = null;
  let generation = 0;
  return {
    preparer(nouvel) {
      const moi = ++generation;
      el = nouvel;
      signaler(el, EVENEMENT_ETAT, "pret");
      return () => {
        if (moi === generation) el = null;
      };
    },
    etat() {
      return "pret";
    },
    async appeler(e164) {
      const options = optionsDe(el);
      const lien = estE164(e164) ? lienAppel(e164, options.schemaLien) : null;
      if (!lien) throw new Error("Numéro illisible : il faut un numéro au format international (+33…).");
      const f = fenetreDe(el);
      const copie = options.copierNumero ? await copierTexte(e164, f) : false;
      if (ouvrirLien(lien, el)) return "repli_tel";
      if (copie) return "copie";
      throw new Error("Le lien d'appel n'a pas pu s'ouvrir : compose le numéro dans ton softphone.");
    },
  };
}

export const softphone: AdaptateurTelephonie = {
  id: "softphone",
  libelle: "Softphone (lien tel:, callto: ou sip:)",
  originesMicro: [],
  client: creerClientSoftphone(),
};
