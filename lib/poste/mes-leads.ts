// « Mes leads » : une personne prend d'un coup des fiches LIBRES (non attribuées, à appeler, jamais appelées) qui passent un filtre, et
// peut rendre celles qu'elle n'a jamais appelées. L'attribution est sûre à plusieurs : la base ne donne une fiche qu'à une seule personne
// (mise à jour « où assigned_to est vide »). Module PUR : la saisie revérifiée.

import { ErreurSaisie, texte } from "@/lib/server/validation";
import type { Tier } from "./file";

export const NOMBRES_PRISE = [10, 25, 50, 100] as const;
export const PRISE_MAX = 100;
/** Les fiches sont attribuées par lots (une adresse PostgREST reste courte). */
export const LOT_PRISE = 50;

export interface FiltresPrise {
  tiers: Tier[];
  departements: string[];
  ville: string | null;
}

/** « 69, 38 ; 2a » -> ["69", "38", "2A"] ; « 1 » -> « 01 ». Les codes illisibles sont ignorés. */
export function lireDepartements(saisie: string | null | undefined): string[] {
  const codes = (saisie ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
    .map((x) => (/^\d$/.test(x) ? `0${x}` : x))
    .filter((x) => /^(\d{2,3}|2A|2B)$/.test(x));
  return [...new Set(codes)].slice(0, 30);
}

export function validerPrise(brut: unknown): { nombre: number; filtres: FiltresPrise } {
  const o = brut !== null && typeof brut === "object" && !Array.isArray(brut) ? (brut as Record<string, unknown>) : null;
  if (!o) throw new ErreurSaisie("Saisie illisible.");
  const n = typeof o.nombre === "number" ? o.nombre : Number(o.nombre);
  if (!Number.isInteger(n) || n < 1 || n > PRISE_MAX) throw new ErreurSaisie(`Le nombre de fiches : de 1 à ${PRISE_MAX}.`);
  const tiers = Array.isArray(o.tiers) ? o.tiers.filter((t): t is Tier => t === "A" || t === "B" || t === "C") : [];
  const departements = lireDepartements(typeof o.departements === "string" ? o.departements : "");
  return { nombre: n, filtres: { tiers: [...new Set(tiers)], departements, ville: texte(o.ville, "La ville", 80) } };
}

/** Découpe une liste en lots. */
export function enLots<T>(liste: readonly T[], taille = LOT_PRISE): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) lots.push(liste.slice(i, i + taille));
  return lots;
}
