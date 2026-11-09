// Les audios restés dans le bucket privé « enregistrements » sans appel qui les désigne : l'audio d'un appel purgé que la purge n'a pas pu
// effacer (stockage injoignable, temps écoulé, purge lancée sans la clé service, par pg_cron ou à la main dans le SQL Editor). Le bouton
// « Purger les fiches inactives » de l'écran Réglages (et scripts/maintenance/purger.mjs avec la clé service) les retrouve et les efface.
//
// Pourquoi par la date : un appel purgé est plus ancien que la date limite de conservation, et son audio a été déposé au plus 48 heures
// après lui (reprise différée). La liste de chaque dossier est donc lue par date de dépôt croissante, et s'arrête au premier fichier
// déposé après le seuil (la date limite plus une marge) : on ne parcourt jamais tout le bucket, et une relance reprend là où la
// précédente s'est arrêtée, puisque les fichiers effacés ont quitté la liste. (L'effacement d'une fiche, lui, ne laisse aucun audio
// derrière lui : il efface les fichiers avant les appels.)
//
// Prudence : un fichier n'est effacé que s'il a la forme d'un audio de l'application (<équipe>/<fournisseur>/<appel>.<ext>, dans le
// dossier d'une équipe connue), s'il a été déposé ET réécrit avant le seuil, et si AUCUN appel ne le désigne ; la moindre erreur de
// lecture arrête le balayage sans rien effacer de plus. Côté SERVEUR seulement (la clé service est lue dans `env`) ; le journal ne reçoit
// que des codes, jamais un chemin.

import { valeurEnv, type Env } from "@/lib/integrations/base";
import { RE_CHEMIN_ENREGISTREMENT, type ResultatStockage } from "@/lib/telephonie/stockage";
import { BUCKET_ENREGISTREMENTS, FOURNISSEURS_AVEC_ENREGISTREMENT } from "@/lib/telephonie/types";

export const TAILLE_PAGE_LISTE = 100;
/** Au plus tant de fichiers examinés par passage depuis l'écran (le script, lui, va au bout) : le reste attend le passage suivant. */
export const MAX_EXAMINES = 5000;
export const TAILLE_LOT_REFERENCES = 50;
const DELAI_LISTE_MS = 15_000;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ObjetStockage {
  nom: string;
  /** La date de dépôt (ms), ou null si l'API ne la donne pas (le fichier n'est alors jamais effacé). */
  creeLe: number | null;
  /** La dernière écriture (ms) : un dépôt qui remplace le fichier la change ; null si absente. */
  majLe: number | null;
  dossier: boolean;
}

export type ResultatListe = { ok: true; objets: ObjetStockage[] } | { ok: false; code: string };
export type Lister = (prefixe: string, offset: number, limite: number) => Promise<ResultatListe>;
export type ResultatReferences = { ok: true; chemins: ReadonlySet<string> } | { ok: false; code: string };

const date = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

/** La réponse de l'API Storage (POST /object/list/<bucket>) : [{ name, id, created_at, updated_at, … }] ; un dossier a un id nul. */
export function lireObjetsStockage(v: unknown): ObjetStockage[] | null {
  if (!Array.isArray(v)) return null;
  const sortie: ObjetStockage[] = [];
  for (const x of v) {
    if (x === null || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (typeof o.name !== "string" || o.name === "" || o.name.includes("/")) continue;
    sortie.push({ nom: o.name, creeLe: date(o.created_at), majLe: date(o.updated_at), dossier: o.id === null || o.id === undefined });
  }
  return sortie;
}

function acces(env: Env): { url: string; cle: string } | null {
  if (typeof window !== "undefined") return null;
  const url = valeurEnv(env, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const cle = valeurEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  return url !== "" && cle !== "" && /^https?:\/\/[^\s/]+$/i.test(url) ? { url, cle } : null;
}

/**
 * La liste d'un dossier du bucket, par date de dépôt croissante, avec l'API Storage et la clé service (les mêmes en-têtes que
 * lib/telephonie/stockage.ts).
 */
export function listerParStockage(env: Env, f: typeof fetch): Lister {
  return async (prefixe, offset, limite) => {
    const a = acces(env);
    if (!a) return { ok: false, code: "configuration" };
    try {
      const r = await f(`${a.url}/storage/v1/object/list/${BUCKET_ENREGISTREMENTS}`, {
        method: "POST",
        headers: { apikey: a.cle, Authorization: `Bearer ${a.cle}`, "content-type": "application/json" },
        body: JSON.stringify({ prefix: prefixe, limit: limite, offset, sortBy: { column: "created_at", order: "asc" } }),
        signal: AbortSignal.timeout(DELAI_LISTE_MS),
      });
      if (!r.ok) return { ok: false, code: `liste_${r.status}` };
      const objets = lireObjetsStockage(await r.json());
      return objets ? { ok: true, objets } : { ok: false, code: "liste_illisible" };
    } catch {
      return { ok: false, code: "liste_reseau" };
    }
  };
}

export interface DependancesBalayage {
  /** Les équipes dont on balaie le dossier (une par instance). */
  workspaceIds: readonly string[];
  lister: Lister;
  /** Parmi ces chemins, ceux qu'un appel désigne encore (appels.enregistrement_chemin). */
  references(chemins: string[]): Promise<ResultatReferences>;
  effacer(chemin: string): Promise<ResultatStockage>;
  /** Le seuil (ms) : seuls les fichiers déposés et réécrits avant lui sont examinés (lib/reglages/rgpd.ts, seuilAudiosOrphelins). */
  avant: number;
  /** Au plus tant de fichiers examinés (MAX_EXAMINES par défaut ; Infinity pour aller au bout). */
  maxExamines?: number;
  /** L'heure (ms) au-delà de laquelle on s'arrête : le reste attend le passage suivant. */
  echeance?: number;
  horloge?: () => number;
}

export interface ResultatBalayage {
  examines: number;
  orphelins: number;
  effaces: number;
  enEchec: number;
  /** Faux si le balayage s'est arrêté avant la fin (temps, volume ou erreur) : relancer reprend. */
  complet: boolean;
  /** Le code de la dernière erreur, ou null. */
  code: string | null;
}

/** Retrouve et efface les audios sans appel (voir l'en-tête). Ne lève jamais : une erreur arrête le balayage et donne son code. */
export async function balayerAudiosOrphelins(d: DependancesBalayage): Promise<ResultatBalayage> {
  const res: ResultatBalayage = { examines: 0, orphelins: 0, effaces: 0, enEchec: 0, complet: true, code: null };
  const horloge = d.horloge ?? Date.now;
  const max = d.maxExamines ?? MAX_EXAMINES;
  const tropTard = () => d.echeance !== undefined && horloge() > d.echeance;
  const arreter = (code: string | null): ResultatBalayage => ({ ...res, complet: false, code: code ?? res.code });

  for (const ws of d.workspaceIds) {
    if (!RE_UUID.test(ws)) continue;
    for (const fournisseur of FOURNISSEURS_AVEC_ENREGISTREMENT) {
      const prefixe = `${ws}/${fournisseur}`;
      let offset = 0;
      let fini = false;
      while (!fini) {
        if (tropTard() || res.examines >= max) return arreter(null);
        const page = await d.lister(prefixe, offset, TAILLE_PAGE_LISTE);
        if (!page.ok) return arreter(page.code);
        const candidats: string[] = [];
        for (const o of page.objets) {
          if (o.dossier || o.creeLe === null) continue;
          // La liste est triée par date de dépôt : le premier fichier déposé après le seuil clôt ce dossier.
          if (o.creeLe > d.avant) {
            fini = true;
            break;
          }
          res.examines++;
          const chemin = `${prefixe}/${o.nom}`;
          if (RE_CHEMIN_ENREGISTREMENT.test(chemin) && (o.majLe === null || o.majLe <= d.avant)) candidats.push(chemin);
        }
        let effacesIci = 0;
        for (let i = 0; i < candidats.length; i += TAILLE_LOT_REFERENCES) {
          const lot = candidats.slice(i, i + TAILLE_LOT_REFERENCES);
          const refs = await d.references(lot);
          if (!refs.ok) return arreter(refs.code);
          for (const chemin of lot) {
            if (refs.chemins.has(chemin)) continue;
            res.orphelins++;
            if (tropTard()) return arreter(null);
            const e = await d.effacer(chemin);
            if (e.ok) {
              res.effaces++;
              effacesIci++;
            } else {
              res.enEchec++;
              res.code = e.code ?? "stockage";
            }
          }
        }
        if (page.objets.length < TAILLE_PAGE_LISTE) fini = true;
        // Les fichiers effacés ne sont plus dans la liste : la page suivante commence d'autant plus tôt.
        offset += page.objets.length - effacesIci;
      }
    }
  }
  return res;
}
