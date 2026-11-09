"use client";

// Le bouton d'envoi d'un formulaire : désactivé pendant l'envoi (pas de double clic), avec un libellé d'attente.

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function BoutonEnvoi({ children, libelleAttente }: { children: ReactNode; libelleAttente: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? libelleAttente : children}
    </button>
  );
}
