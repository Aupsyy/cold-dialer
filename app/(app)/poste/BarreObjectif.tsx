// L'objectif du jour en tête du Poste : les appels de la personne connectée (sur l'objectif de l'équipe, reglages.objectif_appels_jour),
// les prospects joints et les rendez-vous pris aujourd'hui. Des chiffres du journal, rien d'inventé.

import { jauge, resteAFaire, type Compteurs } from "@/lib/poste/objectif";

function Chiffre({ libelle, valeur }: { libelle: string; valeur: number }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{libelle}</p>
      <p className="text-2xl font-semibold tabular-nums">{valeur}</p>
    </div>
  );
}

export function BarreObjectif({ compteurs, objectif }: { compteurs: Compteurs; objectif: number }) {
  const j = jauge(compteurs.appels, objectif);
  return (
    <section
      aria-label="Objectif du jour"
      className="flex flex-wrap items-end gap-x-8 gap-y-3 rounded-xl border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="min-w-40">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">Mes appels du jour</p>
        <p className="text-2xl font-semibold tabular-nums">
          {compteurs.appels}
          {j ? <span className="text-base font-normal text-stone-500"> / {j.cible}</span> : null}
        </p>
        {j ? (
          <div
            role="progressbar"
            aria-label="Appels sur l'objectif du jour"
            aria-valuemin={0}
            aria-valuemax={j.cible}
            aria-valuenow={j.fait}
            className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
          >
            <div className={`h-full rounded-full ${j.atteint ? "bg-emerald-600" : "bg-accent"}`} style={{ width: `${Math.round(j.part * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <Chiffre libelle="Joints" valeur={compteurs.joints} />
      <Chiffre libelle="RDV pris" valeur={compteurs.rdv} />
      {j ? <p className="text-sm text-stone-600 dark:text-stone-400">{resteAFaire(j)}</p> : null}
    </section>
  );
}
