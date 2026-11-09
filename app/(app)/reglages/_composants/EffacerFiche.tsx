"use client";

// « Effacer cette fiche » (propriétaire seulement), en bas de la fiche d'un prospect : le droit d'effacement d'une personne. Après
// confirmation, l'action efface les audios de ses appels puis ses appels, ses rendez-vous, ses retours du marché et la fiche (son journal
// et ses débriefs partent avec elle). La liste d'opposition reste : cochée, la case y inscrit d'abord ses identifiants, pour qu'elle ne
// soit plus jamais rappelée ni réimportée. Le compte rendu reste affiché : la page de la fiche n'existe plus.

import Link from "next/link";
import { useState } from "react";
import { classesBouton } from "@/app/_ui/elements";
import { PHRASE_OPPOSITION } from "@/lib/reglages/libelles";
import type { CompteRenduEffacement } from "@/lib/reglages/rgpd";
import { effacerFiche } from "../actions";
import { MessageGeste, useGeste } from "./geste";

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export function EffacerFiche({ leadId, entreprise, opposee }: { leadId: string; entreprise: string; opposee: boolean }) {
  const { enCours, message, lancer } = useGeste();
  const [ouvert, setOuvert] = useState(false);
  const [opposition, setOpposition] = useState(true);
  const [rendu, setRendu] = useState<CompteRenduEffacement | null>(null);

  function effacer() {
    const question = `Effacer définitivement la fiche « ${entreprise} », ses appels et leurs audios, ses rendez-vous et ses retours du marché ? Rien ne pourra être récupéré.`;
    if (!window.confirm(question)) return;
    lancer(
      () => effacerFiche({ leadId, opposition: opposee || opposition, confirme: true }),
      (d) => {
        setRendu(d);
        return null;
      },
      { relire: false },
    );
  }

  if (rendu) {
    return (
      <section className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        <p className="font-medium" role="status">
          Fiche effacée.
        </p>
        <p>
          {pluriel(rendu.appels, "appel")}, {pluriel(rendu.audios, "audio")}, {pluriel(rendu.rendezVous, "rendez-vous")} et{" "}
          {pluriel(rendu.retours, "retour")} du marché effacés, avec son journal et ses débriefs.
        </p>
        <p>{PHRASE_OPPOSITION[rendu.opposition]}</p>
        <Link href="/prospects" className={classesBouton("secondaire", "sm")}>
          Retour aux prospects
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="effacement-titre" className="rounded-xl border border-red-200 p-4 dark:border-red-900">
      <h2 id="effacement-titre" className="text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        Droit d&apos;effacement
      </h2>
      {!ouvert ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-stone-600 dark:text-stone-400">La personne demande que ses données soient supprimées ?</p>
          <button type="button" onClick={() => setOuvert(true)} className={classesBouton("danger", "sm")}>
            Effacer cette fiche
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <p>
            Seront effacés : la fiche, son journal (appels notés, notes, rappels), ses débriefs, ses rendez-vous, ses retours du marché, les appels
            reçus de l&apos;outil de téléphonie (les siens, et ceux arrivés sans fiche à l&apos;un de ses numéros) et leurs audios. Les rendez-vous
            « à vérifier » sans fiche se retirent dans l&apos;écran Agenda.
          </p>
          {opposee ? (
            <p>
              Elle a demandé à ne plus être contactée : ses identifiants sont inscrits (ou confirmés) sur la liste d&apos;opposition avant
              l&apos;effacement, et y restent ; le compte rendu le dira.
            </p>
          ) : (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={opposition} onChange={(e) => setOpposition(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
              <span>
                Inscrire d&apos;abord son SIREN et ses numéros sur la liste d&apos;opposition (conseillé : sans eux, un futur import pourrait la faire
                revenir). La liste d&apos;opposition n&apos;est jamais purgée.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={enCours} onClick={effacer} className={classesBouton("danger")}>
              {enCours ? "Effacement…" : "Effacer définitivement"}
            </button>
            <button type="button" disabled={enCours} onClick={() => setOuvert(false)} className={classesBouton("secondaire")}>
              Annuler
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Réponds ensuite à la personne et note la date de sa demande (docs/legal.md).
          </p>
        </div>
      )}
      <MessageGeste message={message} />
    </section>
  );
}
