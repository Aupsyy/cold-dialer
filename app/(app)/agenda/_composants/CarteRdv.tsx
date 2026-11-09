// Un rendez-vous dans la liste : créneau (fuseau de l'équipe), entreprise ou invité, canal, source, closer, lien de visio, lien vers la
// fiche (/prospects/<id>) et statut modifiable. Composant serveur ; seuls le statut et le rattachement sont interactifs.

import Link from "next/link";
import { LIBELLES_CANAL_RDV, LIBELLES_SOURCE_RDV, LIBELLES_STATUT_RDV, creneauRdv, titreRdv, type RdvAgenda } from "@/lib/agenda/vues";
import { libelleJour, cleJour } from "@/lib/agenda/fuseau";
import { ChangerStatut } from "./ChangerStatut";
import { RattacherRdv } from "./RattacherRdv";
import { ETIQUETTE, TON_STATUT } from "./styles";

export function CarteRdv({
  rdv,
  fuseau,
  nomCloser,
  modifiable,
  gestionnaire = false,
  avecDate = false,
}: {
  rdv: RdvAgenda;
  fuseau: string;
  nomCloser: string | null;
  modifiable: boolean;
  gestionnaire?: boolean;
  avecDate?: boolean;
}) {
  const sansFiche = rdv.leadId === null;
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold tabular-nums">
            {avecDate ? <span className="capitalize">{libelleJour(cleJour(Date.parse(rdv.debut), fuseau))}, </span> : null}
            {creneauRdv(rdv, fuseau)}
          </p>
          <p className="truncate text-base font-medium">
            {rdv.leadId && rdv.entreprise ? (
              <Link href={`/prospects/${rdv.leadId}`} className="underline-offset-4 hover:underline">
                {titreRdv(rdv)}
              </Link>
            ) : (
              titreRdv(rdv)
            )}
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
            <span className={`${ETIQUETTE} border-stone-300 dark:border-stone-700`}>{LIBELLES_CANAL_RDV[rdv.canal]}</span>
            <span className={`${ETIQUETTE} border-stone-300 dark:border-stone-700`}>{LIBELLES_SOURCE_RDV[rdv.source]}</span>
            {rdv.aVerifier ? <span className={`${ETIQUETTE} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100`}>À vérifier</span> : null}
            {nomCloser ? <span>Closer : {nomCloser}</span> : null}
          </p>
          {rdv.lienVisio && rdv.canal === "visio" ? (
            <p className="text-sm">
              <a href={rdv.lienVisio} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline-offset-4 hover:underline">
                Rejoindre la visio
              </a>
            </p>
          ) : null}
          {sansFiche && (rdv.inviteEmail || rdv.inviteTelephone) ? (
            <p className="break-all text-xs text-stone-600 dark:text-stone-400">{[rdv.inviteEmail, rdv.inviteTelephone].filter(Boolean).join(" · ")}</p>
          ) : null}
          {rdv.note ? <p className="whitespace-pre-line text-xs text-stone-600 dark:text-stone-400">{rdv.note}</p> : null}
        </div>
        {modifiable ? (
          <ChangerStatut rdvId={rdv.id} statut={rdv.statut} />
        ) : (
          <span className={`${ETIQUETTE} ${TON_STATUT[rdv.statut]}`}>{LIBELLES_STATUT_RDV[rdv.statut]}</span>
        )}
      </div>
      {sansFiche && modifiable ? (
        <RattacherRdv rdvId={rdv.id} indice={rdv.inviteEmail ?? rdv.inviteTelephone ?? rdv.inviteNom} peutRetirer={gestionnaire && rdv.aVerifier} />
      ) : null}
    </li>
  );
}
