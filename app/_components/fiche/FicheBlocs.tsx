// Le slot <FicheBlocs> : la fiche prospect le place sous ses propres informations ; il affiche les blocs du registre, dans
// l'ordre, chacun dans sa section et son Suspense (un bloc lent ne bloque pas la fiche).

import { Suspense } from "react";
import { BLOCS_FICHE } from "./registre";
import type { BlocFiche } from "./types";

export function blocsOrdonnes(blocs: readonly BlocFiche[]): BlocFiche[] {
  return [...blocs].sort((a, b) => a.ordre - b.ordre || a.id.localeCompare(b.id));
}

export function FicheBlocs({ leadId, blocs = BLOCS_FICHE }: { leadId: string; blocs?: readonly BlocFiche[] }) {
  const liste = blocsOrdonnes(blocs);
  if (liste.length === 0) return null;
  return (
    <div className="space-y-4">
      {liste.map(({ id, titre, Composant }) => (
        <section key={id} id={`bloc-${id}`} aria-labelledby={`bloc-${id}-titre`} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
          <h2 id={`bloc-${id}-titre`} className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            {titre}
          </h2>
          <div className="mt-3">
            <Suspense fallback={<p className="text-sm text-stone-500">Chargement…</p>}>
              <Composant leadId={leadId} />
            </Suspense>
          </div>
        </section>
      ))}
    </div>
  );
}
