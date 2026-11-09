"use client";

// Les gestes rapides sur une fiche : la marquer urgente (elle passe en tête de la file, après les rappels dus) et, pour un gestionnaire,
// la donner à quelqu'un de l'équipe ou la remettre dans la file commune.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { attribuerFiche, basculerUrgent } from "@/app/_actions/fiche";
import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";

export function ActionsFiche({
  leadId,
  urgent,
  gestionnaire,
  assigneA,
  membres,
}: {
  leadId: string;
  urgent: boolean;
  gestionnaire: boolean;
  assigneA: string | null;
  membres: readonly { id: string; nom: string }[];
}) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function faire(action: () => Promise<{ ok: boolean; error?: string }>) {
    setEnCours(true);
    setErreur(null);
    try {
      const r = await action();
      if (!r.ok) setErreur(r.error ?? "Une erreur est survenue.");
      else router.refresh();
    } catch {
      setErreur("Connexion impossible : réessaie dans un instant.");
    }
    setEnCours(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={enCours}
        aria-pressed={urgent}
        onClick={() => void faire(() => basculerUrgent({ leadId, urgent: !urgent }))}
        className={classesBouton(urgent ? "danger" : "secondaire", "sm")}
      >
        {urgent ? "Urgente : retirer" : "Marquer urgente"}
      </button>
      {gestionnaire ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Attribuée à</span>
          <select
            disabled={enCours}
            value={assigneA ?? ""}
            onChange={(e) => void faire(() => attribuerFiche({ leadId, membreId: e.target.value || null }))}
            className={`${CLASSES_CHAMP} py-1.5 text-sm`}
          >
            <option value="">File commune (personne)</option>
            {membres.map((m) => (
              <option key={m.id} value={m.id}>
                Attribuée à {m.nom}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {erreur ? (
        <p role="alert" className="w-full text-sm text-red-800 dark:text-red-200">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
