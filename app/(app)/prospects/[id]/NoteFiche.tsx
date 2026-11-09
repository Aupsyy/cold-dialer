"use client";

// Ajouter une note à la fiche : une activité « note » du journal, horodatée par la base, à ton nom.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ajouterNote } from "@/app/_actions/fiche";
import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";

export function NoteFiche({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ajouter() {
    if (!note.trim() || enCours) return;
    setEnCours(true);
    setErreur(null);
    try {
      const r = await ajouterNote({ leadId, note });
      if (r.ok) {
        setNote("");
        router.refresh();
      } else {
        setErreur(r.error);
      }
    } catch {
      setErreur("Connexion impossible : ta note est gardée, réessaie dans un instant.");
    }
    setEnCours(false);
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">Nouvelle note</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={5000} placeholder="Une note sur cette entreprise" className={CLASSES_CHAMP} />
      </label>
      {erreur ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-200">
          {erreur}
        </p>
      ) : null}
      <button type="button" onClick={() => void ajouter()} disabled={enCours || !note.trim()} className={classesBouton("secondaire", "sm")}>
        {enCours ? "Ajout…" : "Ajouter la note"}
      </button>
    </div>
  );
}
