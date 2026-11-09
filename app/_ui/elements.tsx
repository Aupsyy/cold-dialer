// Briques d'interface du Poste et des prospects : boutons, pastilles, carte de section. Sobres, lisibles au téléphone, en mode
// clair et sombre. Sans état : utilisables par un composant serveur comme par un composant client.

import type { ReactNode } from "react";

export type VarianteBouton = "principal" | "secondaire" | "discret" | "danger";

export function classesBouton(variante: VarianteBouton = "secondaire", taille: "sm" | "md" | "lg" = "md"): string {
  const tailles = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-3 text-base" }[taille];
  const variantes = {
    principal: "bg-accent text-white hover:opacity-90",
    secondaire:
      "border border-stone-300 bg-white text-stone-900 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800",
    discret: "text-stone-700 underline-offset-4 hover:underline dark:text-stone-300",
    danger: "border border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  }[variante];
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tailles} ${variantes}`;
}

export type TonPastille = "neutre" | "accent" | "ok" | "attention" | "alerte";

export function Pastille({ ton = "neutre", children, titre }: { ton?: TonPastille; children: ReactNode; titre?: string }) {
  const couleurs = {
    neutre: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    accent: "bg-accent/15 text-accent",
    ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    attention: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    alerte: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  }[ton];
  return (
    <span title={titre} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${couleurs}`}>
      {children}
    </span>
  );
}

export function PastilleTier({ tier }: { tier: "A" | "B" | "C" | null }) {
  if (!tier) return null;
  return (
    <Pastille ton={tier === "A" ? "ok" : tier === "B" ? "accent" : "neutre"} titre={`Tier ${tier}`}>
      Tier {tier}
    </Pastille>
  );
}

export function Section({ titre, action, children, id }: { titre: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-titre` : undefined} className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id ? `${id}-titre` : undefined} className="text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {titre}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export const CLASSES_CHAMP =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-accent dark:border-stone-700 dark:bg-stone-950";
