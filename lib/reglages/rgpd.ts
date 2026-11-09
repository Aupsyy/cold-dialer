// Le RGPD dans l'écran Réglages : la date limite de conservation, le comptage de ce que la purge effacerait, la purge COMPLÈTE (la base,
// les audios du bucket privé, le journal des webhooks, les audios restés sans appel) et l'effacement d'une fiche à la demande d'une
// personne. Module PUR : la base, le stockage et le journal sont injectés ; testé par tests/reglages-logique.test.mjs.
//
// Ce que la base fait (supabase/migrations/0001_schema.sql) :
//   - purger_fiches_inactives(p_mois) (clé service seule) : efface les fiches sans activité depuis p_mois mois (sauf un rendez-vous à
//     venir), leurs appels et leurs rendez-vous passés, et, pour toute l'instance, les appels, rendez-vous, débriefs et retours plus
//     anciens ; le journal d'une fiche (lead_activities) et ses débriefs partent avec elle. Elle rend des compteurs et les chemins des
//     audios à effacer du bucket, qu'elle ne peut pas effacer elle-même. La liste d'opposition n'est jamais purgée ;
//   - purger_integrations_evenements() (clé service seule) : le journal des webhooks au-delà de 90 jours (des codes seulement).
// Le journal de ce module ne porte que des codes : jamais un chemin, un identifiant ni un nom.

import type { ResultatBase } from "@/lib/integrations/base";
import { ErreurSaisie, uuidObligatoire } from "@/lib/server/validation";
import { RE_CHEMIN_ENREGISTREMENT, type ResultatStockage } from "@/lib/telephonie/stockage";
import type { ResultatBalayage } from "./audios";
import type { EtatOpposition } from "./libelles";

export type { EtatOpposition } from "./libelles";

export type Resultat<T> = { ok: true; data: T } | { ok: false; error: string };
export type Journal = (code: string) => void;

/** Le journal des webhooks se purge au-delà de 90 jours (purger_integrations_evenements). */
export const JOURS_JOURNAL_WEBHOOKS = 90;

// ---------------------------------------------------------------------------------------------------------------------------------
// La date limite et le comptage (sous la RLS de la personne connectée)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * maintenant moins `mois` mois, comme PostgreSQL (now() - make_interval(months => p), en UTC, la session de Supabase) : le jour du mois
 * est ramené au dernier jour du mois visé s'il n'existe pas (31 mai moins 3 mois : 28 ou 29 février). En ISO UTC.
 */
export function limiteConservation(maintenant: number, mois: number): string {
  const d = new Date(maintenant);
  const debutMois = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - mois, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const dernierJour = new Date(Date.UTC(debutMois.getUTCFullYear(), debutMois.getUTCMonth() + 1, 0)).getUTCDate();
  debutMois.setUTCDate(Math.min(d.getUTCDate(), dernierJour));
  return debutMois.toISOString();
}

/** La marge entre un appel et le dépôt de son audio (l'audio arrive jusqu'à 48 heures après, par la reprise différée), arrondie. */
export const MARGE_DEPOT_AUDIO_MS = 3 * 86_400_000;

/**
 * Le seuil des audios restés sans appel après une purge (lib/reglages/audios.ts) : la date limite de conservation plus la marge de
 * dépôt. Un audio déposé après ce seuil n'appartient à aucun appel purgé.
 */
export function seuilAudiosOrphelins(maintenant: number, mois: number): number {
  return Date.parse(limiteConservation(maintenant, mois)) + MARGE_DEPOT_AUDIO_MS;
}

/** Le filtre PostgREST (.or) des fiches sans activité avant la limite : coalesce(last_activity_at, created_at) < limite. */
export function filtreFichesInactives(limiteIso: string): string {
  return `last_activity_at.lt.${limiteIso},and(last_activity_at.is.null,created_at.lt.${limiteIso})`;
}

export interface ComptagePurge {
  mois: number;
  limite: string;
  /** Les fiches sans activité depuis la limite, hors celles qui ont un rendez-vous à venir. */
  fiches: number;
  /** Plus anciens que la limite : ce que la purge efface pour toute l'équipe. */
  appels: number;
  rendezVous: number;
  debriefs: number;
  retours: number;
  /** La purge demande la clé service sur le serveur. */
  cleService: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La purge complète
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PurgeBase {
  fiches: number;
  appels: number;
  rendezVous: number;
  debriefs: number;
  retours: number;
  chemins: string[];
}

function nombre(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** La réponse de purger_fiches_inactives, ou null si elle est illisible. Un chemin qui n'a pas la forme d'un audio est écarté. */
export function lirePurge(data: unknown): PurgeBase | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const [fiches, appels, rendezVous, debriefs, retours] = [o.fiches, o.appels, o.rendezVous, o.debriefs, o.retours].map(nombre);
  if (fiches === null || appels === null || rendezVous === null || debriefs === null || retours === null) return null;
  const brut = Array.isArray(o.enregistrementsAEffacer) ? o.enregistrementsAEffacer : [];
  const chemins = [...new Set(brut.filter((c): c is string => typeof c === "string" && RE_CHEMIN_ENREGISTREMENT.test(c)))];
  return { fiches, appels, rendezVous, debriefs, retours, chemins };
}

export interface CompteRenduPurge {
  mois: number;
  fiches: number;
  appels: number;
  rendezVous: number;
  debriefs: number;
  retours: number;
  /** Les événements de webhooks de plus de 90 jours effacés ; null si cette purge a échoué. */
  evenements: number | null;
  audiosEffaces: number;
  audiosEnEchec: number;
  /** Les audios pas encore tentés, faute de temps : la prochaine purge les retrouve (balayage des audios restés sans appel). */
  audiosEnAttente: number;
  /** Les audios restés sans appel (purges précédentes) : null si le balayage n'a pas été fait. */
  orphelins: ResultatBalayage | null;
  /** Le balayage était prévu mais le temps a manqué : une relance le fera. */
  balayageSaute: boolean;
}

export interface DependancesPurge {
  mois: number;
  purgerBase: (mois: number) => PromiseLike<ResultatBase>;
  purgerEvenements: () => PromiseLike<ResultatBase>;
  effacerAudio: (chemin: string) => Promise<ResultatStockage>;
  /** Le balayage des audios sans appel (lib/reglages/audios.ts), lancé après le reste ; absent : pas de balayage. */
  balayer?: () => Promise<ResultatBalayage>;
  /** L'heure (ms) au-delà de laquelle on n'efface plus d'audio : le reste attend la purge suivante. */
  echeance?: number;
  horloge?: () => number;
  journal: Journal;
}

function codeDe(e: { code?: unknown } | null | undefined): string {
  const c = e?.code;
  return typeof c === "string" && /^[A-Za-z0-9_]{1,24}$/.test(c) ? c : "sans-code";
}

export const ERR_PURGE = "La purge n'a pas abouti : rien n'a été effacé. Réessaie dans un instant.";

/**
 * La purge complète, dans cet ordre : la base (purger_fiches_inactives), les audios qu'elle désigne, le journal des webhooks, puis les
 * audios restés sans appel. Si la base refuse, rien d'autre n'est tenté. Un audio qui ne s'efface pas, ou qui n'a pas pu être tenté
 * avant l'échéance, est compté (le balayage d'une purge suivante le retrouve : plus aucun appel ne le désigne) ; jamais un chemin dans
 * le journal.
 */
export async function executerPurge(d: DependancesPurge): Promise<Resultat<CompteRenduPurge>> {
  const base = await d.purgerBase(d.mois);
  if (base.error) {
    d.journal(`purge:base:${codeDe(base.error)}`);
    return { ok: false, error: ERR_PURGE };
  }
  const lu = lirePurge(base.data);
  if (!lu) {
    d.journal("purge:base:reponse_illisible");
    return { ok: false, error: "La base a répondu sans compteurs lisibles : vérifie la migration (supabase/migrations/0001_schema.sql)." };
  }
  const horloge = d.horloge ?? Date.now;
  const tropTard = () => d.echeance !== undefined && horloge() > d.echeance;
  let audiosEffaces = 0;
  let audiosEnEchec = 0;
  let audiosEnAttente = 0;
  for (const [i, chemin] of lu.chemins.entries()) {
    if (tropTard()) {
      audiosEnAttente = lu.chemins.length - i;
      d.journal("purge:audio:temps_ecoule");
      break;
    }
    const r = await d.effacerAudio(chemin);
    if (r.ok) audiosEffaces++;
    else {
      audiosEnEchec++;
      d.journal(`purge:audio:${r.code ?? "stockage"}`);
    }
  }
  const ev = await d.purgerEvenements();
  let evenements: number | null = null;
  if (ev.error) d.journal(`purge:evenements:${codeDe(ev.error)}`);
  else evenements = nombre(ev.data) ?? 0;
  const balayageSaute = Boolean(d.balayer) && tropTard();
  const orphelins = d.balayer && !balayageSaute ? await d.balayer() : null;
  if (orphelins && orphelins.code) d.journal(`purge:orphelins:${orphelins.code}`);
  return {
    ok: true,
    data: {
      mois: d.mois,
      fiches: lu.fiches,
      appels: lu.appels,
      rendezVous: lu.rendezVous,
      debriefs: lu.debriefs,
      retours: lu.retours,
      evenements,
      audiosEffaces,
      audiosEnEchec,
      audiosEnAttente,
      orphelins,
      balayageSaute,
    },
  };
}

/** { confirme: true } : la confirmation explicite d'un geste qui efface. */
export function validerConfirmation(brut: unknown): void {
  const o = brut !== null && typeof brut === "object" && !Array.isArray(brut) ? (brut as Record<string, unknown>) : null;
  if (o?.confirme !== true) throw new ErreurSaisie("Confirme d'abord : rien n'a été effacé.");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// L'effacement d'une fiche (droit d'effacement d'une personne)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DemandeEffacement {
  leadId: string;
  /** Inscrire d'abord ses identifiants sur la liste d'opposition (elle ne sera plus jamais rappelée ni réimportée). */
  opposition: boolean;
}

/** { leadId, opposition, confirme: true }. */
export function validerEffacement(brut: unknown): DemandeEffacement {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) throw new ErreurSaisie("Saisie illisible.");
  const o = brut as Record<string, unknown>;
  validerConfirmation(o);
  return { leadId: uuidObligatoire(o.leadId, "La fiche"), opposition: o.opposition === true };
}

export interface FicheAEffacer {
  id: string;
  siren: string | null;
  telephone: string | null;
  mobile: string | null;
  /** Le nom et le code postal : la clé de repli de la liste d'opposition pour une fiche sans SIREN ni numéro (cle_entreprise, en base). */
  entreprise: string | null;
  cp: string | null;
  opposee: boolean;
}

export function lireFicheAEffacer(v: unknown): FicheAEffacer | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);
  const id = s(r.id);
  if (!id) return null;
  return {
    id,
    siren: s(r.siren),
    telephone: s(r.telephone),
    mobile: s(r.mobile),
    entreprise: s(r.entreprise),
    cp: s(r.cp),
    opposee: r.statut === "ne_plus_contacter",
  };
}

/** Les 9 derniers chiffres de ses numéros (le rapprochement de la base), sans doublon. */
export function neufChiffresDe(f: Pick<FicheAEffacer, "telephone" | "mobile">): string[] {
  const sortie = new Set<string>();
  for (const n of [f.telephone, f.mobile]) {
    const c = (n ?? "").replace(/\D/g, "");
    if (c.length >= 9) sortie.add(c.slice(-9));
  }
  return [...sortie];
}

/**
 * La ligne d'opposition à inscrire avant l'effacement : son SIREN, sinon son premier numéro lisible (la base ajoute elle-même les autres
 * identifiants de la fiche, déclencheur opposition_appliquer). null si la fiche n'a aucun identifiant.
 */
export function ligneOpposition(
  f: FicheAEffacer,
  cle: string | null = null,
): { siren?: string; telephone?: string; cle?: string; motif: string; source: "manuel" } | null {
  const motif = "Demande d'effacement";
  if (f.siren && /^\d{9}$/.test(f.siren)) return { siren: f.siren, motif, source: "manuel" };
  for (const n of [f.telephone, f.mobile]) {
    const c = (n ?? "").replace(/\D/g, "");
    if (c.length >= 9 && c.length <= 30) return { telephone: c, motif, source: "manuel" };
  }
  // Sans SIREN ni numéro : la clé nom + code postal calculée par la base (cle_entreprise), si la fiche a un nom.
  if (cle && /^[a-z0-9][a-z0-9 ]*\|[0-9A-Z]*$/.test(cle)) return { cle, motif, source: "manuel" };
  return null;
}

export interface CompteRenduEffacement {
  appels: number;
  /** Les audios de ces appels, retirés du bucket AVANT les appels (sinon rien n'est effacé et l'effacement se relance). */
  audios: number;
  rendezVous: number;
  retours: number;
  opposition: EtatOpposition;
}
