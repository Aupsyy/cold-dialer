// Les outils NAVIGATEUR partagés par les adaptateurs (le Poste) : la fenêtre d'un élément, la copie du numéro, le téléphone mobile,
// les options que le Poste pose sur l'élément préparé (attributs data-*), les événements DOM que le Poste peut écouter, et le montage
// d'une iframe de fournisseur (Aircall, Ringover) avec un filtre strict des messages reçus.
//
// Aucun accès au DOM au chargement du module : tout passe par l'élément reçu (el.ownerDocument.defaultView), sinon par window au moment
// de l'appel. C'est aussi ce qui rend ces fonctions testables sans navigateur (de faux objets suffisent).
//
// Ce que le Poste peut poser sur l'élément passé à preparer(el) :
//   data-numero="+33199000101 +33639980101"  les numéros de la fiche ouverte, en E.164 (Onoff les affiche pour que l'extension les surligne) ;
//   data-schema-lien="tel|callto|sip"         le lien du softphone (config.telephonie.schemaLien, « tel » par défaut) ;
//   data-copier-numero="0"                     ne pas copier le numéro au clic (config.telephonie.copierNumero à false).
// Et ce qu'il peut écouter sur ce même élément :
//   « telephonie:etat »  detail : "pret" | "attente" | "indisponible" (à chaque changement) ;
//   « telephonie:appel » detail : SignalAppel (sonne, décroché, terminé avec la durée), pour les téléphones en iframe.

import { estE164 } from "./e164";
import type { DirectionAppel, EtatTelephone, SchemaLien } from "./types";

export const EVENEMENT_ETAT = "telephonie:etat";
export const EVENEMENT_APPEL = "telephonie:appel";

/** Ce que le téléphone en iframe dit d'un appel en cours (jamais enregistré tel quel : le webhook fait foi). */
export interface SignalAppel {
  etat: "sonne" | "decroche" | "termine";
  direction: DirectionAppel | null;
  /** À « termine » : la durée donnée par le fournisseur, en secondes. */
  dureeS: number | null;
  /** L'identifiant de l'appel chez le fournisseur (le même que celui du webhook), s'il est connu. */
  externeId: string | null;
  /** La fiche ouverte quand l'appel a été lancé par appeler() ; null pour un appel entrant. */
  leadId: string | null;
}

export interface OptionsPoste {
  numeros: string[];
  schemaLien: SchemaLien;
  copierNumero: boolean;
}

type Fenetre = Window & typeof globalThis;

/** La fenêtre d'un élément (celle de son document), sinon la fenêtre globale, sinon null (serveur, build, tests sans navigateur). */
export function fenetreDe(el: Element | null | undefined): Fenetre | null {
  const vue = el?.ownerDocument?.defaultView;
  if (vue) return vue;
  return typeof window !== "undefined" ? window : null;
}

/** Les options posées par le Poste sur l'élément (voir l'en-tête) ; des valeurs par défaut sans élément. */
export function optionsDe(el: HTMLElement | null | undefined): OptionsPoste {
  const lire = (nom: string): string | null => {
    try {
      return el?.getAttribute?.(nom) ?? null;
    } catch {
      return null;
    }
  };
  const numeros = (lire("data-numero") ?? "")
    .split(/[\s,;]+/)
    .filter((n) => estE164(n))
    .slice(0, 3);
  const schema = lire("data-schema-lien");
  return {
    numeros,
    schemaLien: schema === "callto" || schema === "sip" ? schema : "tel",
    copierNumero: lire("data-copier-numero") !== "0",
  };
}

/** Vrai pour un téléphone ou une tablette (ni extension Chrome, ni softphone de bureau). */
export function estMobile(f: Fenetre | null): boolean {
  const agent = f?.navigator?.userAgent ?? "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(agent);
}

/** Copie un texte dans le presse-papiers ; faux si le navigateur refuse ou s'il n'y en a pas. */
export async function copierTexte(valeur: string, f: Fenetre | null): Promise<boolean> {
  try {
    const presse = f?.navigator?.clipboard;
    if (!presse) return false;
    await presse.writeText(valeur);
    return true;
  } catch {
    return false;
  }
}

/** Prévient le Poste (événement DOM sur l'élément préparé) ; silencieux si c'est impossible. */
export function signaler(el: HTMLElement | null, nom: typeof EVENEMENT_ETAT, detail: EtatTelephone): void;
export function signaler(el: HTMLElement | null, nom: typeof EVENEMENT_APPEL, detail: SignalAppel): void;
export function signaler(el: HTMLElement | null, nom: string, detail: EtatTelephone | SignalAppel): void {
  try {
    const f = fenetreDe(el);
    if (!el || !f || typeof f.CustomEvent !== "function") return;
    el.dispatchEvent(new f.CustomEvent(nom, { detail }));
  } catch {
    /* un événement perdu ne casse pas l'appel */
  }
}

/** Ouvre un lien d'appel (tel:, callto:, sip:) comme un clic sur un lien ; faux sans document. */
export function ouvrirLien(lien: string, el: HTMLElement | null): boolean {
  const f = fenetreDe(el);
  const doc = el?.ownerDocument ?? f?.document ?? null;
  const parent = el ?? doc?.body ?? null;
  if (!doc || !parent) return false;
  try {
    const a = doc.createElement("a");
    a.href = lien;
    a.rel = "noopener";
    a.style.display = "none";
    parent.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Iframe d'un fournisseur (Aircall, Ringover)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ConfigIframe {
  src: string;
  /** Les origines dont on accepte les messages, et à qui l'on écrit. */
  origines: readonly string[];
  /** Les permissions déléguées à l'iframe (attribut allow), pour ces origines seulement. */
  permissions: readonly string[];
  titre: string;
}

export interface IframeMontee {
  /** Écrit à l'iframe (postMessage vers son origine connue, jamais « * ») ; faux si elle n'est pas là. */
  envoyer(message: unknown): boolean;
  demonter(): void;
}

/** L'attribut allow : chaque permission pour les origines du fournisseur seulement (« microphone https://a https://b; … »). */
export function attributAllow(permissions: readonly string[], origines: readonly string[]): string {
  return permissions.map((p) => `${p} ${origines.join(" ")}`).join("; ");
}

/**
 * Monte l'iframe du fournisseur dans `el` et écoute ses messages. Un message n'est lu que s'il vient de CETTE iframe (event.source) ET
 * d'une origine du fournisseur (event.origin) : une autre page ou une autre iframe ne peut pas se faire passer pour le téléphone.
 */
export function monterIframe(el: HTMLElement, config: ConfigIframe, surMessage: (data: unknown, origine: string) => void): IframeMontee | null {
  const f = fenetreDe(el);
  const doc = el.ownerDocument;
  if (!f || !doc) return null;
  const iframe = doc.createElement("iframe");
  iframe.src = config.src;
  iframe.title = config.titre;
  iframe.setAttribute("allow", attributAllow(config.permissions, config.origines));
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  el.appendChild(iframe);
  let origineConnue: string | null = null;
  const ecouter = (e: MessageEvent) => {
    if (!config.origines.includes(e.origin)) return;
    if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
    origineConnue = e.origin;
    surMessage(e.data, e.origin);
  };
  f.addEventListener("message", ecouter);
  return {
    envoyer(message) {
      const cible = iframe.contentWindow;
      const origine = origineConnue ?? config.origines[0];
      if (!cible || !origine) return false;
      try {
        cible.postMessage(message, origine);
        return true;
      } catch {
        return false;
      }
    },
    demonter() {
      f.removeEventListener("message", ecouter);
      try {
        iframe.remove();
      } catch {
        /* déjà retirée */
      }
    },
  };
}
