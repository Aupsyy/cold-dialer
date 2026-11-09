"use client";

// Le plafond de tentatives et l'objectif du jour (gestionnaires). Deux plafonds existent : la file du Poste suit la configuration
// (tentativesMax) ; la base passe une fiche « injoignable » selon le réglage de l'équipe (tentatives_max). L'écran montre l'écart et
// les aligne d'un clic, sur la valeur de la configuration (choisie par le serveur, jamais par le navigateur).

import { CLASSES_CHAMP, Pastille, classesBouton } from "@/app/_ui/elements";
import { alignerTentatives, modifierObjectif } from "../actions";
import { MessageGeste, soumettre, useGeste } from "./geste";

export function PlafondObjectif({
  base,
  config,
  ecart,
  objectif,
}: {
  base: number | null;
  config: number;
  /** L'explication de l'écart, ou null si les deux plafonds sont égaux. */
  ecart: string | null;
  objectif: number | null;
}) {
  const plafond = useGeste();
  const obj = useGeste();

  function aligner() {
    plafond.lancer(() => alignerTentatives(), (d) => `Plafond de la base aligné : ${d.tentativesMax} tentatives.`);
  }

  function enregistrerObjectif(formData: FormData) {
    const brut = String(formData.get("objectif") ?? "").trim();
    obj.lancer(() => modifierObjectif({ objectif: brut }), () => "Objectif enregistré : le Poste l'affiche dès le prochain chargement.");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Tentatives sans réponse avant « injoignable »</h3>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm sm:max-w-md">
          <dt className="text-stone-600 dark:text-stone-400">Configuration (la file du Poste)</dt>
          <dd className="text-right font-medium tabular-nums">{config}</dd>
          <dt className="text-stone-600 dark:text-stone-400">Base (le statut « injoignable »)</dt>
          <dd className="text-right font-medium tabular-nums">{base ?? "?"}</dd>
        </dl>
        {ecart ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <p>
              <Pastille ton="attention">Deux plafonds différents</Pastille> {ecart}
            </p>
            <button type="button" disabled={plafond.enCours} onClick={aligner} className={classesBouton("principal", "sm")}>
              Aligner sur la configuration ({config})
            </button>
          </div>
        ) : base !== null ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Les deux plafonds sont alignés. Après un changement de tentativesMax dans la configuration, reviens ici pour les réaligner.
          </p>
        ) : null}
        <MessageGeste message={plafond.message} />
      </div>

      <form onSubmit={soumettre(enregistrerObjectif)} className="space-y-2">
        <label htmlFor="objectif-jour" className="block text-sm font-semibold">
          Objectif d&apos;appels par jour et par appelant
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="objectif-jour"
            name="objectif"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            step={1}
            required
            defaultValue={objectif ?? 0}
            className={`${CLASSES_CHAMP} w-32 tabular-nums`}
          />
          <button type="submit" disabled={obj.enCours} className={classesBouton("secondaire")}>
            Enregistrer
          </button>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400">De 0 à 1000 ; 0 : pas d&apos;objectif affiché en tête du Poste.</p>
        <MessageGeste message={obj.message} />
      </form>
    </div>
  );
}
