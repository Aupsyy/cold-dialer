"use client";

// Chercher une fiche (entreprise, e-mail ou téléphone) puis la choisir. Pas de <form> : ce bloc vit aussi dans le formulaire du
// nouveau rendez-vous (un formulaire ne s'imbrique pas). La recherche passe par une action serveur et la RLS.

import { useState, useTransition, type KeyboardEvent } from "react";
import type { FicheTrouvee } from "@/lib/agenda/vues";
import { chercherFichesAgenda } from "../actions";
import { BOUTON_SECONDAIRE, CHAMP } from "./styles";

export function ChercheurFiche({
  id,
  initial = "",
  libelleChoix,
  onChoisir,
  desactive = false,
}: {
  id: string;
  initial?: string;
  libelleChoix: string;
  onChoisir: (fiche: FicheTrouvee) => void;
  desactive?: boolean;
}) {
  const [recherche, setRecherche] = useState(initial);
  const [resultats, setResultats] = useState<FicheTrouvee[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function chercher() {
    setErreur(null);
    demarrer(async () => {
      const r = await chercherFichesAgenda(recherche);
      if (r.ok) setResultats(r.data);
      else setErreur(r.error);
    });
  }

  function touche(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      chercher();
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        Chercher une fiche
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onKeyDown={touche}
          maxLength={120}
          placeholder="Entreprise, e-mail ou téléphone"
          className={CHAMP}
        />
        <button type="button" onClick={chercher} disabled={enCours || desactive} className={BOUTON_SECONDAIRE}>
          {enCours ? "…" : "Chercher"}
        </button>
      </div>
      {erreur ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {erreur}
        </p>
      ) : null}
      {resultats !== null ? (
        resultats.length === 0 ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">Aucune fiche trouvée (2 caractères au moins ; un numéro : 9 chiffres au moins).</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {resultats.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{f.entreprise}</span>
                  <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                    {[f.dirigeant, f.ville].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <button type="button" onClick={() => onChoisir(f)} disabled={desactive} className={BOUTON_SECONDAIRE}>
                  {libelleChoix}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
