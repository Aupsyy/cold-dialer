"use client";

// L'enregistrement des appels (gestionnaires) : son état, le cadre légal, la case « j'ai lu et j'accepte » sans laquelle rien ne
// s'active (l'action la revérifie, la base exige la date d'acceptation), la désactivation libre. Si la configuration ne permet pas
// d'enregistrer, l'activation est fermée et l'écran dit pourquoi.

import { useState } from "react";
import { Pastille, classesBouton } from "@/app/_ui/elements";
import { activerEnregistrement, desactiverEnregistrement } from "../actions";
import { MessageGeste, useGeste } from "./geste";

export function Enregistrement({
  actif,
  accepteLe,
  blocage,
  cadre,
  caseLibelle,
}: {
  actif: boolean;
  /** La date de la dernière acceptation du cadre légal, lisible, ou null. */
  accepteLe: string | null;
  blocage: string | null;
  cadre: readonly string[];
  caseLibelle: string;
}) {
  const { enCours, message, lancer } = useGeste();
  const [accepte, setAccepte] = useState(false);

  function activer() {
    lancer(() => activerEnregistrement({ accepte }), () => "Enregistrement activé : le Poste affiche l'annonce en tête de chaque appel.");
    setAccepte(false);
  }

  function desactiver() {
    lancer(() => desactiverEnregistrement(), () => "Enregistrement désactivé : rien ne sera gardé des appels suivants.");
  }

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {actif ? <Pastille ton="ok">Activé</Pastille> : <Pastille>Désactivé</Pastille>}
        {accepteLe ? <span className="text-stone-600 dark:text-stone-400">Cadre légal accepté le {accepteLe}.</span> : null}
      </p>
      <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-950">
        <h3 className="font-semibold">Le cadre légal</h3>
        {cadre.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {blocage ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {blocage}
        </p>
      ) : null}
      {!actif && !blocage ? (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
            <span>{caseLibelle}</span>
          </label>
          <button type="button" disabled={!accepte || enCours} onClick={activer} className={classesBouton("principal")}>
            Activer l&apos;enregistrement
          </button>
        </div>
      ) : null}
      {actif ? (
        <button type="button" disabled={enCours} onClick={desactiver} className={classesBouton("secondaire")}>
          Désactiver l&apos;enregistrement
        </button>
      ) : null}
      <MessageGeste message={message} />
    </div>
  );
}
