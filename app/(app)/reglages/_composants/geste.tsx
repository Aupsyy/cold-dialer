"use client";

// Un geste de l'écran Réglages : lancer une action serveur, attendre (bouton désactivé, pas de double clic), afficher son message, puis
// relire l'écran. Le message est celui de l'action (lisible, jamais le détail de la base) ; rien n'est journalisé ici.

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

export type Retour<T> = { ok: true; data: T } | { ok: false; error: string };
export type Message = { ok: boolean; texte: string } | null;

export const ERR_CONNEXION = "Connexion impossible : réessaie dans un instant.";

export function useGeste() {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [message, setMessage] = useState<Message>(null);

  /**
   * Lance l'action ; en cas de succès, `succes` donne le message (ou null) et l'écran est relu (sauf `relire: false`) ; en cas d'échec,
   * le message de l'action, et `siEchec` (remettre un choix à sa valeur d'avant, par exemple).
   */
  function lancer<T>(
    action: () => Promise<Retour<T>>,
    succes: (data: T) => string | null,
    options: { relire?: boolean; siEchec?: () => void } = {},
  ) {
    setMessage(null);
    demarrer(async () => {
      try {
        const r = await action();
        if (!r.ok) {
          setMessage({ ok: false, texte: r.error });
          options.siEchec?.();
          return;
        }
        const texte = succes(r.data);
        if (texte) setMessage({ ok: true, texte });
        if (options.relire !== false) router.refresh();
      } catch {
        setMessage({ ok: false, texte: ERR_CONNEXION });
        options.siEchec?.();
      }
    });
  }

  return { enCours, message, setMessage, lancer };
}

/**
 * Le gestionnaire d'envoi d'un formulaire : il passe ses champs au geste sans laisser React vider le formulaire (avec <form action>,
 * React le vide dès que la fonction rend la main, avant la réponse : une saisie refusée serait perdue).
 */
export function soumettre(geste: (donnees: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    geste(new FormData(e.currentTarget));
  };
}

export function MessageGeste({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200"}`}>
      {message.texte}
    </p>
  );
}
