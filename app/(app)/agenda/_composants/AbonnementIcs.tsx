"use client";

// Le lien d'abonnement ICS de la personne connectée : créé par la base (agenda_jeton_creer), montré UNE fois, à copier dans Google
// Agenda, Apple Calendrier ou Outlook ; recréer un lien ou le révoquer coupe l'ancien tout de suite. Le lien n'est jamais journalisé.

import { useState, useTransition } from "react";
import { creerJetonAgenda, revoquerJetonAgenda } from "../actions";
import { BOUTON, BOUTON_SECONDAIRE, CARTE, CHAMP } from "./styles";

export function AbonnementIcs({ actifAuDepart, outilExterne }: { actifAuDepart: boolean; outilExterne: string | null }) {
  const [actif, setActif] = useState(actifAuDepart);
  const [adresse, setAdresse] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  function creer() {
    if (actif && !window.confirm("Un nouveau lien remplace l'ancien : l'ancien cessera de fonctionner. Continuer ?")) return;
    setMessage(null);
    demarrer(async () => {
      const r = await creerJetonAgenda();
      if (!r.ok) {
        setMessage({ ok: false, texte: r.error });
        return;
      }
      setActif(true);
      setAdresse(`${window.location.origin}/api/agenda/ics/${r.data.jeton}.ics`);
    });
  }

  function revoquer() {
    if (!window.confirm("Révoquer le lien ? Les agendas abonnés ne recevront plus tes rendez-vous.")) return;
    setMessage(null);
    demarrer(async () => {
      const r = await revoquerJetonAgenda();
      if (!r.ok) {
        setMessage({ ok: false, texte: r.error });
        return;
      }
      setActif(false);
      setAdresse(null);
      setMessage({ ok: true, texte: "Lien révoqué." });
    });
  }

  async function copier() {
    if (!adresse) return;
    try {
      await navigator.clipboard.writeText(adresse);
      setMessage({ ok: true, texte: "Lien copié." });
    } catch {
      setMessage({ ok: false, texte: "Copie impossible : sélectionne le lien et copie-le à la main." });
    }
  }

  return (
    <section className={CARTE}>
      <h2 className="text-base font-semibold">Mes rendez-vous dans mon agenda</h2>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
        Un lien secret, à ajouter dans Google Agenda (« Autres agendas », « + », « À partir de l&apos;URL »), Apple Calendrier
        (« Nouvel abonnement ») ou Outlook. Google relit un flux abonné toutes les quelques heures : ce n&apos;est pas du temps réel.
      </p>
      {outilExterne ? (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          {outilExterne} écrit déjà dans ton agenda : ne t&apos;abonne pas dans ce même agenda, sinon chaque rendez-vous apparaîtrait deux fois.
        </p>
      ) : null}
      {adresse ? (
        <div className="mt-3 space-y-2">
          <label htmlFor="ics-adresse" className="block text-sm font-medium">
            Ton lien (montré une seule fois)
          </label>
          <div className="flex gap-2">
            <input id="ics-adresse" readOnly value={adresse} onFocus={(e) => e.currentTarget.select()} className={CHAMP} />
            <button type="button" onClick={copier} className={BOUTON_SECONDAIRE}>
              Copier
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">Garde-le pour toi : qui a ce lien voit tes rendez-vous (entreprise, heure, lien de visio).</p>
        </div>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`mt-3 text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
          {message.texte}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={creer} disabled={enCours} className={BOUTON}>
          {actif ? "Créer un nouveau lien" : "Créer mon lien"}
        </button>
        {actif ? (
          <button type="button" onClick={revoquer} disabled={enCours} className={BOUTON_SECONDAIRE}>
            Révoquer
          </button>
        ) : null}
      </div>
      {actif && !adresse ? <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">Un lien est actif (il n&apos;est plus affichable : crée-en un nouveau si tu l&apos;as perdu).</p> : null}
    </section>
  );
}
