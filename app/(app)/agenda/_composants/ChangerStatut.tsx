"use client";

// Le statut d'un rendez-vous, modifiable en un choix (pris, confirmé, tenu, no-show, annulé, reporté). La base revérifie le droit (RLS).

import { useState, useTransition } from "react";
import { STATUTS_RDV, type StatutRdv } from "@/lib/agenda/types";
import { LIBELLES_STATUT_RDV } from "@/lib/agenda/vues";
import { changerStatutRdv } from "../actions";
import { TON_STATUT } from "./styles";

export function ChangerStatut({ rdvId, statut }: { rdvId: string; statut: StatutRdv }) {
  const [valeur, setValeur] = useState<StatutRdv>(statut);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function changer(nouveau: StatutRdv) {
    const avant = valeur;
    setValeur(nouveau);
    setErreur(null);
    demarrer(async () => {
      const r = await changerStatutRdv(rdvId, nouveau);
      if (!r.ok) {
        setValeur(avant);
        setErreur(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor={`statut-${rdvId}`}>
        Statut du rendez-vous
      </label>
      <select
        id={`statut-${rdvId}`}
        value={valeur}
        disabled={enCours}
        aria-busy={enCours}
        onChange={(e) => changer(e.target.value as StatutRdv)}
        className={`rounded-full border px-2 py-1 text-xs font-medium disabled:cursor-wait ${TON_STATUT[valeur]}`}
      >
        {STATUTS_RDV.map((s) => (
          <option key={s} value={s}>
            {LIBELLES_STATUT_RDV[s]}
          </option>
        ))}
      </select>
      {erreur ? (
        <p role="alert" className="max-w-56 text-right text-xs text-red-700 dark:text-red-300">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
