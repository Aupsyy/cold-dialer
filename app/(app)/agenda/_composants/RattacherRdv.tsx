"use client";

// Rattacher un rendez-vous « à vérifier » (aucune fiche retrouvée par l'outil d'agenda) à la bonne fiche.

import { useState, useTransition } from "react";
import { rattacherRdv, retirerRdvAVerifier } from "../actions";
import { ChercheurFiche } from "./ChercheurFiche";

export function RattacherRdv({ rdvId, indice, peutRetirer }: { rdvId: string; indice: string | null; peutRetirer: boolean }) {
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="mt-3 space-y-2 border-t border-stone-200 pt-3 dark:border-stone-800">
      <ChercheurFiche
        id={`rattacher-${rdvId}`}
        initial={indice ?? ""}
        libelleChoix="Rattacher"
        desactive={enCours}
        onChoisir={(fiche) =>
          demarrer(async () => {
            const r = await rattacherRdv(rdvId, fiche.id);
            setMessage(r.ok ? { ok: true, texte: `Rattaché à ${fiche.entreprise}.` } : { ok: false, texte: r.error });
          })
        }
      />
      {peutRetirer ? (
        <button
          type="button"
          disabled={enCours}
          onClick={() => {
            if (!window.confirm("Ce n'est pas un rendez-vous de prospection : le retirer de l'agenda ?")) return;
            demarrer(async () => {
              const r = await retirerRdvAVerifier(rdvId);
              if (!r.ok) setMessage({ ok: false, texte: r.error });
            });
          }}
          className="text-xs text-stone-600 underline underline-offset-4 disabled:opacity-60 dark:text-stone-400"
        >
          Ce n&apos;est pas un prospect : retirer
        </button>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
          {message.texte}
        </p>
      ) : null}
    </div>
  );
}
