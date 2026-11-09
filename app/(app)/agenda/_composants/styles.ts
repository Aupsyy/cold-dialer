// Les couleurs des étiquettes de l'agenda (classes Tailwind, mode clair et sombre). Module PUR, sans logique.

import type { StatutRdv } from "@/lib/agenda/types";

export const TON_STATUT: Readonly<Record<StatutRdv, string>> = {
  pris: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
  confirme: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  tenu: "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-700",
  no_show: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  annule: "border-stone-300 bg-stone-100 text-stone-600 line-through dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300",
  reporte: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
};

export const ETIQUETTE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";
export const CHAMP =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent dark:border-stone-700 dark:bg-stone-950";
export const BOUTON =
  "inline-flex items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60";
export const BOUTON_SECONDAIRE =
  "inline-flex items-center justify-center rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium transition hover:bg-stone-100 disabled:cursor-wait disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-800";
export const CARTE = "rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900";
