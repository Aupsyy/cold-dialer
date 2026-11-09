// La logique de l'écran Agenda (app/(app)/agenda) : état de la vue lu dans l'adresse, plage de dates dans le fuseau de l'équipe,
// lecture des lignes de rendez_vous, regroupement par jour, libellés, recherche d'une fiche, effet d'un rendez-vous sur sa fiche.
// Module PUR, testé par tests/agenda-vues.test.mjs : les composants ne font qu'afficher.

import { uuidOuNull } from "./lecture";
import {
  cleJour,
  debutJourMs,
  decalerJour,
  estCleJour,
  heureLocale,
  libelleDate,
  libelleJour,
  libelleSemaine,
  lundiDe,
} from "./fuseau";
import { CANAUX_RDV, SOURCES_RDV, STATUTS_RDV, type CanalRdv, type SourceRdv, type StatutRdv } from "./types";

export const VUES_AGENDA = ["jour", "semaine"] as const;
export type VueAgenda = (typeof VUES_AGENDA)[number];

/** Le filtre de statut : un statut, « actifs » (pris ou confirmé) ou tous (null). */
export type FiltreStatut = StatutRdv | "actifs" | null;

export interface EtatVue {
  vue: VueAgenda;
  /** Le jour affiché (ou un jour de la semaine affichée), « AAAA-MM-JJ » dans le fuseau de l'équipe. */
  jour: string;
  /** Un closer (uuid), « moi », ou tous (null). */
  closer: string | null;
  statut: FiltreStatut;
}

export const LIBELLES_STATUT_RDV: Readonly<Record<StatutRdv, string>> = {
  pris: "Pris",
  confirme: "Confirmé",
  tenu: "Tenu",
  no_show: "No-show",
  annule: "Annulé",
  reporte: "Reporté",
};

export const LIBELLES_CANAL_RDV: Readonly<Record<CanalRdv, string>> = { visio: "Visio", telephone: "Téléphone", sur_place: "Sur place" };

export const LIBELLES_SOURCE_RDV: Readonly<Record<SourceRdv, string>> = {
  poste: "Poste",
  manuel: "Agenda",
  calendly: "Calendly",
  iclosed: "iClosed",
  google: "Google Agenda",
};

/** Les statuts qui occupent le créneau du closer. */
export const STATUTS_ACTIFS: readonly StatutRdv[] = ["pris", "confirme"];

function premiereValeur(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** L'état de la vue d'après les paramètres de l'adresse ; toute valeur douteuse retombe sur sa valeur par défaut. */
export function lireEtatVue(params: Readonly<Record<string, string | string[] | undefined>>, aujourdhui: string): EtatVue {
  const vue = premiereValeur(params.vue);
  const jour = premiereValeur(params.jour);
  const closer = premiereValeur(params.closer);
  const statut = premiereValeur(params.statut);
  return {
    vue: vue === "jour" ? "jour" : "semaine",
    jour: estCleJour(jour) && jour >= "2000-01-01" && jour < "2100-01-01" ? jour : aujourdhui,
    closer: closer === "moi" ? "moi" : uuidOuNull(closer),
    statut: statut === "actifs" ? "actifs" : (STATUTS_RDV as readonly string[]).includes(statut ?? "") ? (statut as StatutRdv) : null,
  };
}

/** L'adresse de la vue avec ces changements (les valeurs par défaut ne sont pas écrites). */
export function hrefVue(etat: EtatVue, changements: Partial<EtatVue> = {}): string {
  const e = { ...etat, ...changements };
  const p = new URLSearchParams();
  if (e.vue !== "semaine") p.set("vue", e.vue);
  p.set("jour", e.jour);
  if (e.closer) p.set("closer", e.closer);
  if (e.statut) p.set("statut", e.statut);
  return `/agenda?${p.toString()}`;
}

export interface PlageVue {
  /** Bornes en UTC : [debutIso, finIso). */
  debutIso: string;
  finIso: string;
  /** Les jours affichés, dans l'ordre. */
  jours: string[];
  titre: string;
  precedent: string;
  suivant: string;
}

/** La plage affichée : un jour, ou la semaine du lundi au dimanche (changements d'heure compris). */
export function plageVue(etat: Pick<EtatVue, "vue" | "jour">, fuseau: string): PlageVue {
  if (etat.vue === "jour") {
    return {
      debutIso: new Date(debutJourMs(etat.jour, fuseau)).toISOString(),
      finIso: new Date(debutJourMs(decalerJour(etat.jour, 1), fuseau)).toISOString(),
      jours: [etat.jour],
      titre: `${libelleJour(etat.jour)} ${etat.jour.slice(0, 4)}`,
      precedent: decalerJour(etat.jour, -1),
      suivant: decalerJour(etat.jour, 1),
    };
  }
  const lundi = lundiDe(etat.jour);
  return {
    debutIso: new Date(debutJourMs(lundi, fuseau)).toISOString(),
    finIso: new Date(debutJourMs(decalerJour(lundi, 7), fuseau)).toISOString(),
    jours: Array.from({ length: 7 }, (_, i) => decalerJour(lundi, i)),
    titre: `Semaine ${libelleSemaine(lundi)}`,
    precedent: decalerJour(lundi, -7),
    suivant: decalerJour(lundi, 7),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les rendez-vous
// ---------------------------------------------------------------------------------------------------------------------------------

export interface RdvAgenda {
  id: string;
  leadId: string | null;
  closerId: string | null;
  prisPar: string | null;
  debut: string;
  fin: string;
  canal: CanalRdv;
  statut: StatutRdv;
  source: SourceRdv;
  lienVisio: string | null;
  note: string | null;
  aVerifier: boolean;
  inviteNom: string | null;
  inviteEmail: string | null;
  inviteTelephone: string | null;
  /** La fiche, si la personne connectée la voit (RLS). */
  entreprise: string | null;
  dirigeant: string | null;
}

/** Les colonnes lues par l'écran (la fiche jointe par sa clé étrangère). */
export const COLONNES_RDV =
  "id, lead_id, closer_id, pris_par, debut, fin, canal, statut, source, lien_visio, note, a_verifier, invite_nom, invite_email, invite_telephone, lead:leads(entreprise, dirigeant)";

function chaineOuNull(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
}

/** Une ligne de rendez_vous (avec la fiche jointe) ; null si elle est illisible. */
export function rdvDepuisLigne(ligne: unknown): RdvAgenda | null {
  if (ligne === null || typeof ligne !== "object" || Array.isArray(ligne)) return null;
  const r = ligne as Record<string, unknown>;
  const id = uuidOuNull(r.id);
  const debut = chaineOuNull(r.debut, 40);
  const fin = chaineOuNull(r.fin, 40);
  if (!id || !debut || !fin || !Number.isFinite(Date.parse(debut)) || !Number.isFinite(Date.parse(fin))) return null;
  const leadBrut = Array.isArray(r.lead) ? r.lead[0] : r.lead;
  const lead = leadBrut !== null && typeof leadBrut === "object" ? (leadBrut as Record<string, unknown>) : null;
  return {
    id,
    leadId: uuidOuNull(r.lead_id),
    closerId: uuidOuNull(r.closer_id),
    prisPar: uuidOuNull(r.pris_par),
    debut: new Date(Date.parse(debut)).toISOString(),
    fin: new Date(Date.parse(fin)).toISOString(),
    canal: (CANAUX_RDV as readonly string[]).includes(String(r.canal)) ? (r.canal as CanalRdv) : "visio",
    statut: (STATUTS_RDV as readonly string[]).includes(String(r.statut)) ? (r.statut as StatutRdv) : "pris",
    source: (SOURCES_RDV as readonly string[]).includes(String(r.source)) ? (r.source as SourceRdv) : "poste",
    lienVisio: chaineOuNull(r.lien_visio, 300),
    note: chaineOuNull(r.note, 5000),
    aVerifier: r.a_verifier === true,
    inviteNom: chaineOuNull(r.invite_nom, 160),
    inviteEmail: chaineOuNull(r.invite_email, 254),
    inviteTelephone: chaineOuNull(r.invite_telephone, 30),
    entreprise: lead ? chaineOuNull(lead.entreprise, 200) : null,
    dirigeant: lead ? chaineOuNull(lead.dirigeant, 160) : null,
  };
}

export function rdvDepuisLignes(lignes: unknown): RdvAgenda[] {
  return (Array.isArray(lignes) ? lignes : [])
    .map(rdvDepuisLigne)
    .filter((r): r is RdvAgenda => r !== null)
    .sort((a, b) => a.debut.localeCompare(b.debut));
}

/** Le titre d'un rendez-vous : l'entreprise, sinon le nom de l'invité, sinon « Rendez-vous sans fiche ». */
export function titreRdv(rdv: Pick<RdvAgenda, "entreprise" | "inviteNom" | "leadId">): string {
  if (rdv.entreprise) return rdv.entreprise;
  if (rdv.inviteNom) return rdv.inviteNom;
  return rdv.leadId ? "Fiche non visible" : "Rendez-vous sans fiche";
}

/** « 09:30 – 10:00 » dans le fuseau ; un rendez-vous qui finit un autre jour porte la date de fin. */
export function creneauRdv(rdv: Pick<RdvAgenda, "debut" | "fin">, fuseau: string): string {
  const debut = Date.parse(rdv.debut);
  const fin = Date.parse(rdv.fin);
  const memeJour = cleJour(debut, fuseau) === cleJour(fin, fuseau);
  return `${heureLocale(debut, fuseau)} – ${memeJour ? "" : `${libelleDate(cleJour(fin, fuseau))} `}${heureLocale(fin, fuseau)}`;
}

/** Le filtre de l'écran (aussi appliqué à la lecture en base). `moi` : l'utilisateur connecté. */
export function filtrerRdv(rdvs: readonly RdvAgenda[], etat: Pick<EtatVue, "closer" | "statut">, moi: string): RdvAgenda[] {
  const closer = etat.closer === "moi" ? moi : etat.closer;
  return rdvs.filter((r) => {
    if (closer && r.closerId !== closer) return false;
    if (etat.statut === "actifs") return STATUTS_ACTIFS.includes(r.statut);
    if (etat.statut) return r.statut === etat.statut;
    return true;
  });
}

export interface JourAgenda {
  cle: string;
  libelle: string;
  aujourdhui: boolean;
  rdvs: RdvAgenda[];
}

/** Les rendez-vous rangés par jour du fuseau (un rendez-vous compte pour le jour où il COMMENCE), dans l'ordre des jours affichés. */
export function regrouperParJour(rdvs: readonly RdvAgenda[], jours: readonly string[], fuseau: string, aujourdhui: string): JourAgenda[] {
  const parJour = new Map<string, RdvAgenda[]>(jours.map((j) => [j, []]));
  for (const r of rdvs) {
    const liste = parJour.get(cleJour(Date.parse(r.debut), fuseau));
    if (liste) liste.push(r);
  }
  return jours.map((cle) => ({
    cle,
    libelle: libelleJour(cle),
    aujourdhui: cle === aujourdhui,
    rdvs: (parJour.get(cle) ?? []).sort((a, b) => a.debut.localeCompare(b.debut)),
  }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La fiche : recherche et effet d'un rendez-vous
// ---------------------------------------------------------------------------------------------------------------------------------

/** Une fiche trouvée par la recherche de l'écran Agenda (ce que la personne connectée a le droit de voir). */
export interface FicheTrouvee {
  id: string;
  entreprise: string;
  ville: string | null;
  dirigeant: string | null;
}

/** Les fiches lues par la recherche ; les lignes illisibles sont ignorées. */
export function fichesDepuisLignes(lignes: unknown): FicheTrouvee[] {
  const sortie: FicheTrouvee[] = [];
  for (const l of Array.isArray(lignes) ? lignes : []) {
    if (l === null || typeof l !== "object") continue;
    const r = l as Record<string, unknown>;
    const id = uuidOuNull(r.id);
    const entreprise = chaineOuNull(r.entreprise, 200);
    if (id && entreprise) sortie.push({ id, entreprise, ville: chaineOuNull(r.ville, 120), dirigeant: chaineOuNull(r.dirigeant, 160) });
  }
  return sortie;
}

export type Recherche =
  | { type: "email"; motif: string }
  | { type: "telephone"; tel9: string }
  | { type: "entreprise"; motif: string };

/** Échappe %, _ et \ pour un motif LIKE / ILIKE (le texte cherché est pris littéralement). */
export function echapperMotif(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Ce que cherche la personne : un e-mail, un numéro (9 chiffres au moins : comparé par ses 9 derniers) ou un nom d'entreprise. */
export function classerRecherche(brut: unknown): Recherche | null {
  if (typeof brut !== "string") return null;
  const q = brut.replace(/\s+/g, " ").trim();
  if (q.length < 2 || q.length > 120) return null;
  if (q.includes("@")) return { type: "email", motif: echapperMotif(q.toLowerCase()) };
  const chiffres = q.replace(/\D/g, "");
  if (chiffres.length >= 9 && /^[+\d\s.()/-]+$/.test(q)) return { type: "telephone", tel9: chiffres.slice(-9) };
  return { type: "entreprise", motif: `%${echapperMotif(q)}%` };
}

export type EffetFiche = { statut: "rdv_fixe"; rappelMaintenant: false } | { statut: "a_rappeler"; rappelMaintenant: true } | null;

/**
 * Ce que devient la fiche quand un rendez-vous change dans l'agenda (les mêmes règles que evenement_agenda en base) :
 *   - pris ou confirmé, et pas encore passé : la fiche passe « rdv_fixe » ;
 *   - annulé ou reporté : la fiche « rdv_fixe » revient « à rappeler » (rappel tout de suite) si elle n'a plus d'autre rendez-vous actif ;
 *   - no-show : la fiche revient « à rappeler » si elle n'a plus d'autre rendez-vous actif ;
 *   - tenu : rien. Une fiche « ne_plus_contacter » (liste d'opposition) ne bouge jamais.
 */
export function effetSurFiche(p: {
  statutRdv: StatutRdv;
  finRdv: string;
  statutFiche: string | null;
  autreRdvActif: boolean;
  maintenant: number;
}): EffetFiche {
  if (!p.statutFiche || p.statutFiche === "ne_plus_contacter") return null;
  if (STATUTS_ACTIFS.includes(p.statutRdv)) {
    return Date.parse(p.finRdv) > p.maintenant && p.statutFiche !== "rdv_fixe" ? { statut: "rdv_fixe", rappelMaintenant: false } : null;
  }
  if (p.autreRdvActif) return null;
  if (p.statutRdv === "no_show") return p.statutFiche === "a_rappeler" ? null : { statut: "a_rappeler", rappelMaintenant: true };
  if (p.statutRdv === "annule" || p.statutRdv === "reporte") {
    return p.statutFiche === "rdv_fixe" ? { statut: "a_rappeler", rappelMaintenant: true } : null;
  }
  return null;
}

/** Le jour d'aujourd'hui dans le fuseau (pour l'écran). */
export function aujourdhui(fuseau: string, maintenant: number = Date.now()): string {
  return cleJour(maintenant, fuseau);
}
