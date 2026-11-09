// Les réglages de l'équipe (table reglages, une ligne par équipe) vus par l'écran Réglages : le plafond de tentatives et son écart avec
// la configuration, l'objectif d'appels du jour, l'enregistrement des appels (son cadre légal, ce qui l'empêche, la ligne écrite à
// l'activation). Module PUR : testé par tests/reglages-logique.test.mjs.
//
// Ce que la base garantit déjà : tentatives_max de 1 à 10, objectif de 0 à 1000, enregistrement_complet impossible sans annonce_lue_le
// (contrainte reglages_annonce_avant_enregistrement), annonce_lue_le horodaté par la base (jamais une date du navigateur), seuls les
// gestionnaires modifient (RLS reglages_modification).

import { ErreurSaisie } from "@/lib/server/validation";
import { FOURNISSEURS_AVEC_ENREGISTREMENT, type FournisseurTelephonie } from "@/lib/telephonie/types";

export const COLONNES_REGLAGES = "enregistrement_complet, annonce_lue_le, tentatives_max, objectif_appels_jour";
export const OBJECTIF_MAX = 1000;

export interface ReglagesEquipe {
  enregistrementComplet: boolean;
  /** Quand un gestionnaire a lu et accepté le cadre légal (la dernière fois), ou null. */
  annonceLueLe: string | null;
  tentativesMax: number;
  objectifAppelsJour: number;
}

export function lireReglages(v: unknown): ReglagesEquipe | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const entier = (x: unknown) => (typeof x === "number" && Number.isInteger(x) ? x : null);
  const tentativesMax = entier(r.tentatives_max);
  const objectif = entier(r.objectif_appels_jour);
  if (tentativesMax === null || objectif === null) return null;
  return {
    enregistrementComplet: r.enregistrement_complet === true,
    annonceLueLe: typeof r.annonce_lue_le === "string" && r.annonce_lue_le !== "" ? r.annonce_lue_le : null,
    tentativesMax,
    objectifAppelsJour: objectif,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Deux plafonds de tentatives
// ---------------------------------------------------------------------------------------------------------------------------------

export interface EcartPlafonds {
  base: number;
  config: number;
  explication: string;
}

/**
 * Deux plafonds existent : la file du Poste n'affiche plus une fiche qui a atteint config.tentativesMax tentatives ; la base passe une
 * fiche « injoignable » au bout de reglages.tentatives_max tentatives sans réponse (enregistrer_issue). null s'ils sont égaux.
 */
export function ecartPlafonds(base: number, config: number): EcartPlafonds | null {
  if (base === config) return null;
  const explication =
    base < config
      ? `La base passe une fiche « injoignable » dès ${base} tentative${base > 1 ? "s" : ""} sans réponse, avant la limite de la file (${config}) : les fiches quittent la file plus tôt que ne le dit la configuration.`
      : `La file du Poste écarte une fiche après ${config} tentative${config > 1 ? "s" : ""}, mais la base ne la passe « injoignable » qu'au bout de ${base} : entre les deux, la fiche reste « à appeler » sans jamais revenir dans la file.`;
  return { base, config, explication };
}

/** { objectif } : un entier de 0 à 1000 (0 : pas d'objectif affiché au Poste). Accepte aussi le texte d'un champ de formulaire. */
export function validerObjectif(brut: unknown): number {
  const o = brut !== null && typeof brut === "object" && !Array.isArray(brut) ? (brut as Record<string, unknown>).objectif : undefined;
  const n = typeof o === "string" && /^\s*\d{1,4}\s*$/.test(o) ? Number(o) : o;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > OBJECTIF_MAX) {
    throw new ErreurSaisie(`L'objectif d'appels par jour : un nombre entier de 0 à ${OBJECTIF_MAX}.`);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// L'enregistrement des appels
// ---------------------------------------------------------------------------------------------------------------------------------

const NOM_OUTIL: Readonly<Record<FournisseurTelephonie, string>> = {
  onoff: "Onoff",
  aircall: "Aircall",
  ringover: "Ringover",
  softphone: "Le softphone",
  telephone: "Le téléphone",
};

/** « Onoff, Aircall et Ringover » : les outils qui envoient un enregistrement (lib/telephonie/types.ts). */
export function outilsQuiEnregistrent(): string {
  const noms = FOURNISSEURS_AVEC_ENREGISTREMENT.map((f) => NOM_OUTIL[f]);
  return noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}` : (noms[0] ?? "");
}

/**
 * Ce qui empêche d'activer l'enregistrement avec la configuration de l'instance, ou null. Le schéma de la config refuse déjà
 * telephonie.enregistrement à true avec un outil qui n'envoie pas d'audio ; activer ici sans que la config le déclare ferait afficher
 * l'annonce au Poste alors que l'équipe a dit ne pas enregistrer.
 */
export function blocageEnregistrement(t: { fournisseur: FournisseurTelephonie; enregistrement: boolean }): string | null {
  if (!FOURNISSEURS_AVEC_ENREGISTREMENT.includes(t.fournisseur)) {
    return `${NOM_OUTIL[t.fournisseur]} n'envoie aucun enregistrement : seuls ${outilsQuiEnregistrent()} en envoient un. L'activer ici ne garderait rien.`;
  }
  if (!t.enregistrement) {
    return "La configuration dit que l'équipe n'enregistre pas (telephonie.enregistrement vaut false) : passe-le à true dans config/niche.json, lance npm test, redéploie, puis reviens ici.";
  }
  return null;
}

/** { accepte: true } : la case « j'ai lu et j'accepte » cochée. Sinon, refus (rien n'est écrit). */
export function validerAcceptation(brut: unknown): void {
  const o = brut !== null && typeof brut === "object" && !Array.isArray(brut) ? (brut as Record<string, unknown>) : null;
  if (o?.accepte !== true) throw new ErreurSaisie("Coche d'abord « J'ai lu ce cadre et je l'accepte ».");
}

/**
 * La ligne écrite à l'activation : l'acceptation du cadre légal et l'enregistrement, en UNE écriture (la contrainte de la base exige
 * annonce_lue_le avec enregistrement_complet). La date envoyée sert seulement à marquer le changement : la base la remplace par la sienne.
 */
export function ligneActivation(maintenant: number): { annonce_lue_le: string; enregistrement_complet: true } {
  return { annonce_lue_le: new Date(maintenant).toISOString(), enregistrement_complet: true };
}

/** Le cadre légal, montré avant la case à cocher. Un rappel, pas un avis juridique. */
export function cadreLegalEnregistrement(annonce: string, conservationMois: number): string[] {
  return [
    "Enregistrer une conversation sans prévenir la personne est interdit : c'est une atteinte à sa vie privée (article 226-1 du Code pénal). La CNIL recommande de l'informer dès le début de l'appel (l'enregistrement, son but, son droit de s'y opposer), de ne garder les enregistrements que le temps utile et d'en limiter l'accès.",
    `L'annonce se lit à CHAQUE appel enregistré, avant la conversation : « ${annonce} ». Le Poste l'affiche en tête de l'appel et l'appelant la coche « lue » pendant l'appel ; sans elle, rien n'est gardé pour cet appel, ni audio ni transcription.`,
    "Si la personne refuse, ou demande l'arrêt en cours d'appel, arrête l'enregistrement dans l'outil de téléphonie.",
    `Les audios sont dans un stockage privé : seuls les gestionnaires et l'appelant de l'appel les écoutent. La purge RGPD les efface avec leur appel (conservation de la configuration : ${conservationMois} mois).`,
    `Activer ici ne suffit pas : il faut aussi telephonie.enregistrement à true dans la configuration et l'enregistrement activé chez le fournisseur. Seuls ${outilsQuiEnregistrent()} envoient un enregistrement.`,
    "Ce rappel n'est pas un avis juridique : lis docs/legal.md et, en cas de doute, demande à un juriste.",
  ];
}

export const CASE_ACCEPTATION = "J'ai lu ce cadre et je l'accepte : l'annonce sera lue au prospect au début de chaque appel enregistré.";
