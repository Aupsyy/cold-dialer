"use client";

// La saisie rapide d'un retour du marché (page /retours) : l'objection entendue, le verdict d'une accroche, une citation. Tout est
// facultatif sauf une des trois. L'action serveur revérifie tout ; rien n'est envoyé au prospect.

import { useActionState } from "react";
import { Avis } from "@/app/_ui/primitives";
import { BoutonEnvoi } from "@/app/_ui/BoutonEnvoi";
import { enregistrerRetour } from "./actions";
import { ETAT_INITIAL } from "./etat";

export interface Option {
  code: string;
  libelle: string;
}

const CHAMP =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-accent dark:border-stone-700 dark:bg-stone-950";

export function SaisieRetour({ objections, verdicts }: { objections: readonly Option[]; verdicts: readonly Option[] }) {
  const [etat, action] = useActionState(enregistrerRetour, ETAT_INITIAL);
  const v = etat.valeurs;
  return (
    <form action={action} className="space-y-4">
      {etat.statut !== "repos" ? <Avis ton={etat.statut === "ok" ? "ok" : "erreur"}>{etat.message}</Avis> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="saisie-objection" className="block text-sm font-medium">
            Objection entendue
          </label>
          <select id="saisie-objection" name="objection" defaultValue={v.objection} className={CHAMP}>
            <option value="">Aucune</option>
            {objections.map((o) => (
              <option key={o.code} value={o.code}>
                {o.libelle}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="saisie-objection-texte" className="block text-sm font-medium">
            Ses mots (facultatif)
          </label>
          <input
            id="saisie-objection-texte"
            name="objectionTexte"
            defaultValue={v.objectionTexte}
            maxLength={400}
            aria-describedby="saisie-objection-texte-aide"
            className={CHAMP}
          />
          <p id="saisie-objection-texte-aide" className="text-xs text-stone-500 dark:text-stone-400">
            Utile avec « Autre objection » : la phrase telle qu&apos;il l&apos;a dite.
          </p>
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Verdict de l&apos;accroche</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[{ code: "", libelle: "Pas d'accroche" }, ...verdicts].map((o) => (
            <label
              key={o.code || "aucun"}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm has-[:checked]:border-accent has-[:checked]:font-semibold dark:border-stone-700"
            >
              <input type="radio" name="verdict" value={o.code} defaultChecked={v.verdict === o.code} className="accent-[var(--accent)]" />
              {o.libelle}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor="saisie-citation" className="block text-sm font-medium">
          Citation
        </label>
        <textarea
          id="saisie-citation"
          name="citation"
          defaultValue={v.citation}
          maxLength={300}
          rows={2}
          aria-describedby="saisie-citation-aide"
          className={`${CHAMP} resize-y`}
        />
        <p id="saisie-citation-aide" className="text-xs text-stone-500 dark:text-stone-400">
          Ses mots exacts, 300 caractères au plus. Jamais de nom, de numéro ni d&apos;adresse.
        </p>
      </div>
      <div className="sm:max-w-xs">
        <BoutonEnvoi libelleAttente="Enregistrement…">Noter ce retour</BoutonEnvoi>
      </div>
    </form>
  );
}
