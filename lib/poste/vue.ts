// Ce que l'écran du Poste reçoit : la fiche et la file mises en forme côté serveur (libellés dans le fuseau de la config, numéros prêts à
// composer, raison pour laquelle une fiche ouverte n'est pas dans la file). Le navigateur ne reçoit que ce qu'il affiche. Module PUR.

import { accrocheDeFiche, type AccrocheFiche } from "./accroche";
import { reponsesDecouverte, type ChampDecouverte } from "./decouverte";
import type { Fiche } from "./fiche";
import { STATUTS_FILE, type FicheFile, type FileAppels, type Tier } from "./file";
import { libelleStatut } from "./libelles";
import { nomDirigeant, prenomDirigeant, type ContexteScript } from "./script";
import { affichageNumero, lienAppel, numerosDeFiche, type NumeroAppel, type SchemaLien } from "./telephone";
import { libelleJourHeure } from "./temps";

export interface LigneFileVue {
  id: string;
  entreprise: string;
  ville: string | null;
  tier: Tier | null;
  urgent: boolean;
  tentatives: number;
  /** « demain 9 h 30 », ou null sans rappel. */
  rappel: string | null;
  enRetard: boolean;
}

export interface FileVue {
  dus: LigneFileVue[];
  aAppeler: LigneFileVue[];
  dejaAppelees: LigneFileVue[];
  aVenir: LigneFileVue[];
  totaux: { dus: number; aAppeler: number; dejaAppelees: number; aVenir: number };
  ordre: string[];
}

function ligneFile(f: FicheFile, maintenant: number, fuseau: string): LigneFileVue {
  const t = f.rappelLe ? Date.parse(f.rappelLe) : Number.NaN;
  return {
    id: f.id,
    entreprise: f.entreprise,
    ville: f.ville,
    tier: f.tier,
    urgent: f.urgent,
    tentatives: f.tentatives,
    rappel: Number.isFinite(t) ? libelleJourHeure(t, maintenant, fuseau) : null,
    enRetard: Number.isFinite(t) && t <= maintenant,
  };
}

/** La file à afficher (chaque groupe coupé à `limite` lignes ; les totaux restent exacts). */
export function fileVue(file: FileAppels, maintenant: number, fuseau: string, limite = 50): FileVue {
  const l = (liste: readonly FicheFile[]) => liste.slice(0, limite).map((f) => ligneFile(f, maintenant, fuseau));
  return {
    dus: l(file.dus),
    aAppeler: l(file.aAppeler),
    dejaAppelees: l(file.dejaAppelees),
    aVenir: l(file.aVenir),
    totaux: { dus: file.dus.length, aAppeler: file.aAppeler.length, dejaAppelees: file.dejaAppelees.length, aVenir: file.aVenir.length },
    ordre: file.ordre,
  };
}

export interface NumeroVue extends NumeroAppel {
  affichage: string;
  /** Le lien d'appel de repli (tel:, callto:, sip:), ou null si le numéro est illisible. */
  lien: string | null;
}

export interface FicheVue {
  id: string;
  entreprise: string;
  dirigeant: string | null;
  ville: string | null;
  cp: string | null;
  metier: string | null;
  tier: Tier | null;
  score: number | null;
  statut: string;
  statutLibelle: string;
  tentatives: number;
  rappel: string | null;
  urgent: boolean;
  numeros: NumeroVue[];
  email: string | null;
  site: string | null;
  siren: string | null;
  accroche: AccrocheFiche | null;
  /** Pourquoi cette fiche ouverte n'est pas dans la file (statut final, plafond, rappel à venir), ou null. */
  horsFile: string | null;
  /** Sur la liste d'opposition (statut ne_plus_contacter) : plus aucun appel. */
  opposition: boolean;
  notes: string | null;
  /** Les réponses de découverte déjà notées (leads.qualification[<id>], écrites par le débrief), par id de champ ou de question. */
  reponses: Record<string, string>;
}

export interface OptionsVue {
  pays: string;
  fuseau: string;
  maintenant: number;
  tentativesMax: number;
  schemaLien: SchemaLien;
  /** Les champs de découverte de la config (lib/poste/decouverte.ts). */
  champsDecouverte?: readonly ChampDecouverte[];
}

export function raisonHorsFile(f: Pick<Fiche, "statut" | "tentatives" | "rappelLe">, o: Pick<OptionsVue, "maintenant" | "tentativesMax" | "fuseau">): string | null {
  if (!(STATUTS_FILE as readonly string[]).includes(f.statut)) return `Hors de la file : ${libelleStatut(f.statut).toLowerCase()}.`;
  if (f.statut === "a_appeler" && f.tentatives >= o.tentativesMax) return `Hors de la file : ${f.tentatives} tentatives, le plafond est de ${o.tentativesMax}.`;
  const t = f.rappelLe ? Date.parse(f.rappelLe) : Number.NaN;
  if (Number.isFinite(t) && t > o.maintenant) return `Rappel prévu ${libelleJourHeure(t, o.maintenant, o.fuseau)} : la fiche attend son heure.`;
  return null;
}

export function ficheVue(f: Fiche, o: OptionsVue): FicheVue {
  const t = f.rappelLe ? Date.parse(f.rappelLe) : Number.NaN;
  return {
    id: f.id,
    entreprise: f.entreprise,
    dirigeant: f.dirigeant,
    ville: f.ville,
    cp: f.cp,
    metier: f.metier,
    tier: f.tier,
    score: f.score,
    statut: f.statut,
    statutLibelle: libelleStatut(f.statut),
    tentatives: f.tentatives,
    rappel: Number.isFinite(t) ? libelleJourHeure(t, o.maintenant, o.fuseau) : null,
    urgent: f.urgent,
    numeros: numerosDeFiche(f, o.pays).map((n) => ({
      ...n,
      affichage: n.e164 ? affichageNumero(n.e164, o.pays) : n.brut,
      lien: lienAppel(n.e164, o.schemaLien),
    })),
    email: f.email,
    site: f.site && /^https?:\/\//i.test(f.site) ? f.site : null,
    siren: f.siren,
    accroche: accrocheDeFiche(f),
    horsFile: raisonHorsFile(f, o),
    opposition: f.statut === "ne_plus_contacter",
    notes: f.notes,
    reponses: Object.fromEntries(
      reponsesDecouverte(f.qualification, o.champsDecouverte ?? [])
        .filter((r) => r.valeur !== null)
        .map((r) => [r.id, r.valeur as string]),
    ),
  };
}

/** Les valeurs des crochets du script pour cette fiche et cette personne. */
export function contexteScriptDe(
  f: Pick<Fiche, "dirigeant" | "entreprise" | "ville" | "metier">,
  o: { equipe: string; metierParDefaut: string | null; vouvoiement: boolean; tonPrenom: string | null; deuxCreneaux: string | null },
): ContexteScript {
  return {
    prenom: prenomDirigeant(f.dirigeant),
    nom: nomDirigeant(f.dirigeant),
    entreprise: f.entreprise,
    ville: f.ville,
    metier: f.metier ?? o.metierParDefaut,
    tonPrenom: o.tonPrenom,
    equipe: o.equipe,
    deuxCreneaux: o.deuxCreneaux,
    vouvoiement: o.vouvoiement,
  };
}
