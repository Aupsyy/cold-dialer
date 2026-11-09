"use client";

// La purge RGPD (gestionnaires) : d'abord le comptage de ce qu'elle effacerait (sous tes droits, rien n'est écrit), puis, après
// confirmation explicite, la purge complète (la base, les audios du bucket privé, le journal des webhooks, les audios restés sans
// appel). Le résultat en compteurs seulement.

import { useState } from "react";
import { classesBouton } from "@/app/_ui/elements";
import type { ComptagePurge, CompteRenduPurge } from "@/lib/reglages/rgpd";
import { compterPurge, purgerMaintenant } from "../actions";
import { MessageGeste, useGeste } from "./geste";

function Ligne({ libelle, valeur }: { libelle: string; valeur: number | string }) {
  return (
    <>
      <dt className="text-stone-600 dark:text-stone-400">{libelle}</dt>
      <dd className="text-right font-medium tabular-nums">{valeur}</dd>
    </>
  );
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export function Purge({ mois }: { mois: number }) {
  const comptage = useGeste();
  const purge = useGeste();
  const [compte, setCompte] = useState<ComptagePurge | null>(null);
  const [rendu, setRendu] = useState<CompteRenduPurge | null>(null);

  function compter() {
    setRendu(null);
    comptage.lancer(
      () => compterPurge(),
      (d) => {
        setCompte(d);
        return null;
      },
      { relire: false },
    );
  }

  function purger() {
    if (!compte) return;
    const question =
      `Effacer définitivement ${pluriel(compte.fiches, "fiche")} sans activité depuis ${compte.mois} mois, avec leurs appels et leurs audios, ` +
      `ainsi que les appels, rendez-vous, débriefs et retours plus anciens ? Rien ne pourra être récupéré. La liste d'opposition, elle, reste.`;
    if (!window.confirm(question)) return;
    purge.lancer(
      () => purgerMaintenant({ confirme: true }),
      (d) => {
        setRendu(d);
        setCompte(null);
        return null;
      },
    );
  }

  return (
    <div className="space-y-4">
      <button type="button" disabled={comptage.enCours || purge.enCours} onClick={compter} className={classesBouton("secondaire")}>
        {comptage.enCours ? "Comptage…" : "Compter ce que la purge effacerait"}
      </button>
      <MessageGeste message={comptage.message} />

      {compte ? (
        <div className="space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
          <p className="text-sm">Aujourd&apos;hui, avec une conservation de {compte.mois} mois, la purge effacerait :</p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm sm:max-w-md">
            <Ligne libelle="Fiches sans activité (hors rendez-vous à venir)" valeur={compte.fiches} />
            <Ligne libelle={`Appels de plus de ${compte.mois} mois`} valeur={compte.appels} />
            <Ligne libelle={`Rendez-vous de plus de ${compte.mois} mois`} valeur={compte.rendezVous} />
            <Ligne libelle={`Débriefs de plus de ${compte.mois} mois`} valeur={compte.debriefs} />
            <Ligne libelle={`Retours du marché de plus de ${compte.mois} mois`} valeur={compte.retours} />
          </dl>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Le journal de chaque fiche et ses débriefs partent avec elle, ainsi que ses appels et ses rendez-vous passés ; les audios des appels
            effacés sont retirés du stockage ; le journal des webhooks de plus de 90 jours aussi.
          </p>
          {compte.cleService ? (
            <button type="button" disabled={purge.enCours} onClick={purger} className={classesBouton("danger")}>
              {purge.enCours ? "Purge en cours…" : "Purger les fiches inactives"}
            </button>
          ) : (
            <p className="text-sm text-amber-900 dark:text-amber-100">
              La purge demande la clé service sur le serveur (SUPABASE_SERVICE_ROLE_KEY, dans Vercel), absente ici : ajoute-la et redéploie, ou
              lance node scripts/maintenance/purger.mjs depuis ton ordinateur.
            </p>
          )}
        </div>
      ) : null}
      <MessageGeste message={purge.message} />

      {rendu ? (
        <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <p className="text-sm font-medium" role="status">
            Purge faite (conservation : {rendu.mois} mois).
          </p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm sm:max-w-md">
            <Ligne libelle="Fiches effacées" valeur={rendu.fiches} />
            <Ligne libelle="Appels effacés" valeur={rendu.appels} />
            <Ligne libelle="Rendez-vous effacés" valeur={rendu.rendezVous} />
            <Ligne libelle="Débriefs effacés" valeur={rendu.debriefs} />
            <Ligne libelle="Retours du marché effacés" valeur={rendu.retours} />
            <Ligne libelle="Événements de webhooks effacés" valeur={rendu.evenements ?? "échec"} />
            <Ligne libelle="Audios effacés" valeur={rendu.audiosEffaces} />
            {rendu.orphelins ? <Ligne libelle="Audios restés sans appel, effacés" valeur={rendu.orphelins.effaces} /> : null}
          </dl>
          {rendu.audiosEnEchec + rendu.audiosEnAttente + (rendu.orphelins?.enEchec ?? 0) > 0 ? (
            <p className="text-sm">
              {pluriel(rendu.audiosEnEchec + rendu.audiosEnAttente + (rendu.orphelins?.enEchec ?? 0), "audio")} n&apos;ont pas encore été
              effacés du stockage (échec ou temps écoulé) : relance la purge plus tard, elle les retrouvera.
            </p>
          ) : null}
          {rendu.orphelins && !rendu.orphelins.complet ? (
            <p className="text-sm">
              La recherche des audios restés sans appel s&apos;est arrêtée avant la fin
              {rendu.orphelins.code ? ` (code ${rendu.orphelins.code})` : " (temps écoulé)"} : relance la purge pour la poursuivre.
            </p>
          ) : null}
          {rendu.balayageSaute ? (
            <p className="text-sm">
              La recherche des audios restés sans appel n&apos;a pas eu le temps de tourner : relance la purge pour la faire.
            </p>
          ) : null}
          {rendu.evenements === null ? <p className="text-sm">Le journal des webhooks n&apos;a pas pu être purgé : relance la purge plus tard.</p> : null}
        </div>
      ) : null}
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Conservation de la configuration : {mois} mois (legal.conservationMois). Rien n&apos;est planifié d&apos;office : lance la purge une fois par
        mois, ici ou avec node scripts/maintenance/purger.mjs.
      </p>
    </div>
  );
}
