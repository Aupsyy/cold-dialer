// Les filtres de la liste des prospects, lus depuis l'adresse (?statut=a_appeler&tier=A&page=2) : chaque valeur est vérifiée, une valeur
// inconnue est ignorée (jamais d'erreur pour une adresse bricolée). Module PUR ; la requête est construite par app/_actions/filtres.ts.

import { STATUTS_LEAD, type StatutLead } from "./libelles";

export const TAILLE_PAGE = 50;
export const PAGE_MAX = 2000;

export const TRIS = ["activite", "nom", "score", "rappel"] as const;
export type Tri = (typeof TRIS)[number];
export const LIBELLES_TRI: Readonly<Record<Tri, string>> = {
  activite: "Dernière activité",
  nom: "Nom",
  score: "Score",
  rappel: "Prochain rappel",
};

export type FiltreTier = "A" | "B" | "C" | "aucun";
export type FiltreRappels = "dus" | "a_venir" | "tous";

export interface FiltresProspects {
  recherche: string | null;
  statut: StatutLead | null;
  tier: FiltreTier | null;
  ville: string | null;
  departement: string | null;
  avecEmail: boolean;
  avecAccroche: boolean;
  mesLeads: boolean;
  rappels: FiltreRappels | null;
  tri: Tri;
  page: number;
}

export const FILTRES_VIDES: FiltresProspects = {
  recherche: null,
  statut: null,
  tier: null,
  ville: null,
  departement: null,
  avecEmail: false,
  avecAccroche: false,
  mesLeads: false,
  rappels: null,
  tri: "activite",
  page: 1,
};

export type Parametres = Readonly<Record<string, string | string[] | undefined>>;

function premier(p: Parametres, cle: string): string | null {
  const v = p[cle];
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

const oui = (v: string | null) => v === "1" || v === "oui" || v === "true";

export function lireFiltresProspects(p: Parametres): FiltresProspects {
  const statut = premier(p, "statut");
  const tier = premier(p, "tier");
  const rappels = premier(p, "rappels");
  const tri = premier(p, "tri");
  const departement = (premier(p, "departement") ?? "").toUpperCase();
  const page = Number(premier(p, "page") ?? "1");
  const rappelsLus: FiltreRappels | null = rappels === "dus" || rappels === "a_venir" || rappels === "tous" ? rappels : null;
  return {
    recherche: (premier(p, "q") ?? "").slice(0, 80) || null,
    statut: statut && (STATUTS_LEAD as readonly string[]).includes(statut) ? (statut as StatutLead) : null,
    tier: tier === "A" || tier === "B" || tier === "C" || tier === "aucun" ? tier : null,
    ville: (premier(p, "ville") ?? "").slice(0, 80) || null,
    departement: /^(\d{2,3}|2[AB])$/.test(departement) ? departement : null,
    avecEmail: oui(premier(p, "email")),
    avecAccroche: oui(premier(p, "accroche")),
    mesLeads: oui(premier(p, "mes")),
    rappels: rappelsLus,
    tri: tri && (TRIS as readonly string[]).includes(tri) ? (tri as Tri) : rappelsLus ? "rappel" : "activite",
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, PAGE_MAX) : 1,
  };
}

/** L'adresse d'une page de la liste avec ces filtres (seulement ce qui diffère des valeurs par défaut). */
export function adresseListe(f: FiltresProspects, changements: Partial<FiltresProspects> = {}): string {
  const g = { ...f, ...changements };
  const q = new URLSearchParams();
  if (g.recherche) q.set("q", g.recherche);
  if (g.statut) q.set("statut", g.statut);
  if (g.tier) q.set("tier", g.tier);
  if (g.ville) q.set("ville", g.ville);
  if (g.departement) q.set("departement", g.departement);
  if (g.avecEmail) q.set("email", "1");
  if (g.avecAccroche) q.set("accroche", "1");
  if (g.mesLeads) q.set("mes", "1");
  if (g.rappels) q.set("rappels", g.rappels);
  if (g.tri !== (g.rappels ? "rappel" : "activite")) q.set("tri", g.tri);
  if (g.page > 1) q.set("page", String(g.page));
  const s = q.toString();
  return s ? `/prospects?${s}` : "/prospects";
}

/**
 * Un motif ILIKE « contient » : % et _ (jokers de SQL) et la barre oblique inverse sont échappés ; l'étoile est retirée (PostgREST la lit
 * comme un %).
 */
export function motifContient(texte: string): string {
  return `%${texte.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Les bornes (incluses) de la page, pour .range(de, a). */
export function bornesPage(page: number, taille = TAILLE_PAGE): { de: number; a: number } {
  const p = Number.isInteger(page) && page >= 1 ? page : 1;
  return { de: (p - 1) * taille, a: p * taille - 1 };
}

export function nombrePages(total: number, taille = TAILLE_PAGE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / taille));
}

export function filtresActifs(f: FiltresProspects): number {
  return [f.recherche, f.statut, f.tier, f.ville, f.departement, f.avecEmail, f.avecAccroche, f.mesLeads, f.rappels].filter(Boolean).length;
}
