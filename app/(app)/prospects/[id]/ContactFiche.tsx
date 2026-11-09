"use client";

// Modifier les coordonnées d'une fiche à la main. Chaque changement du dirigeant, d'un numéro ou de l'e-mail laisse une trace datée
// « saisie manuelle » dans ses sources. Une fiche de la liste d'opposition garde ses identifiants (la base refuse de les changer).

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { modifierContact } from "@/app/_actions/fiche";
import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";

export interface ValeursContact {
  dirigeant: string;
  telephone: string;
  mobile: string;
  email: string;
  site: string;
  ville: string;
  cp: string;
  metier: string;
}

const CHAMPS: { cle: keyof ValeursContact; libelle: string; type?: string }[] = [
  { cle: "dirigeant", libelle: "Dirigeant" },
  { cle: "telephone", libelle: "Téléphone", type: "tel" },
  { cle: "mobile", libelle: "Mobile", type: "tel" },
  { cle: "email", libelle: "E-mail", type: "email" },
  { cle: "site", libelle: "Site" },
  { cle: "ville", libelle: "Ville" },
  { cle: "cp", libelle: "Code postal" },
  { cle: "metier", libelle: "Métier" },
];

export function ContactFiche({ leadId, valeurs }: { leadId: string; valeurs: ValeursContact }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const champs: Partial<Record<keyof ValeursContact, string>> = {};
    for (const { cle } of CHAMPS) {
      const v = String(fd.get(cle) ?? "").trim();
      if (v !== valeurs[cle]) champs[cle] = v;
    }
    if (Object.keys(champs).length === 0) {
      setOuvert(false);
      return;
    }
    setEnCours(true);
    setErreur(null);
    try {
      const r = await modifierContact({ leadId, champs });
      if (r.ok) {
        setOuvert(false);
        router.refresh();
      } else {
        setErreur(r.error);
      }
    } catch {
      setErreur("Connexion impossible : réessaie dans un instant.");
    }
    setEnCours(false);
  }

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)} className={classesBouton("secondaire", "sm")}>
        Modifier les coordonnées
      </button>
    );
  }
  return (
    <form onSubmit={(e) => void envoyer(e)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {CHAMPS.map((c) => (
          <label key={c.cle} className="block space-y-1">
            <span className="block text-sm font-medium">{c.libelle}</span>
            <input name={c.cle} type={c.type ?? "text"} defaultValue={valeurs[c.cle]} className={CLASSES_CHAMP} autoComplete="off" />
          </label>
        ))}
      </div>
      {erreur ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-200">
          {erreur}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={enCours} className={classesBouton("principal", "sm")}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={() => setOuvert(false)} disabled={enCours} className={classesBouton("discret", "sm")}>
          Annuler
        </button>
      </div>
    </form>
  );
}
