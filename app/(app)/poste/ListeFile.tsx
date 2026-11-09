"use client";

// La file d'appels, à côté de la fiche : les rappels dus, la file à appeler, puis (repliés) les fiches déjà appelées aujourd'hui et les
// rappels à venir. Un clic ouvre une fiche, sauf pendant un appel dont l'issue n'est pas encore enregistrée : l'issue d'abord.

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { adressePoste } from "@/lib/poste/saisie-poste";
import type { FileVue, LigneFileVue } from "@/lib/poste/vue";
import { Pastille, PastilleTier } from "@/app/_ui/elements";

function Ligne({ l, courante, mesLeads, onClic }: { l: LigneFileVue; courante: boolean; mesLeads: boolean; onClic: (e: MouseEvent) => void }) {
  return (
    <li>
      <Link
        href={adressePoste({ fiche: l.id, mesLeads })}
        onClick={onClic}
        aria-current={courante ? "true" : undefined}
        className={`block rounded-lg px-2.5 py-2 text-sm transition ${
          courante ? "bg-accent/15 ring-1 ring-accent" : "hover:bg-stone-100 dark:hover:bg-stone-800"
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{l.entreprise}</span>
          <span className="flex shrink-0 items-center gap-1">
            {l.urgent ? <Pastille ton="alerte">Urgent</Pastille> : null}
            <PastilleTier tier={l.tier} />
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400">
          <span className="truncate">{l.ville ?? "Ville inconnue"}</span>
          {l.rappel ? (
            <span className={l.enRetard ? "font-medium text-red-700 dark:text-red-300" : ""}>
              {l.enRetard ? "dû " : ""}
              {l.rappel}
            </span>
          ) : l.tentatives > 0 ? (
            <span>
              {l.tentatives} tentative{l.tentatives > 1 ? "s" : ""}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function Groupe({ titre, total, ouvert, children }: { titre: string; total: number; ouvert: boolean; children: ReactNode }) {
  if (total === 0) return null;
  return (
    <details open={ouvert} className="group">
      <summary className="flex cursor-pointer items-center justify-between py-1 text-xs font-semibold tracking-wide text-stone-500 uppercase select-none dark:text-stone-400">
        <span>{titre}</span>
        <span className="tabular-nums">{total}</span>
      </summary>
      <ul className="mt-1 space-y-0.5">{children}</ul>
    </details>
  );
}

export function ListeFile({
  file,
  ficheId,
  mesLeads,
  bloquee,
  onBloquee,
}: {
  file: FileVue;
  ficheId: string | null;
  mesLeads: boolean;
  /** Vrai pendant un appel dont l'issue n'est pas enregistrée. */
  bloquee: boolean;
  onBloquee: () => void;
}) {
  const clic = (id: string) => (e: MouseEvent) => {
    if (bloquee && id !== ficheId) {
      e.preventDefault();
      onBloquee();
    }
  };
  const lignes = (liste: readonly LigneFileVue[]) =>
    liste.map((l) => <Ligne key={l.id} l={l} courante={l.id === ficheId} mesLeads={mesLeads} onClic={clic(l.id)} />);
  const plus = (affichees: number, total: number) =>
    total > affichees ? <li className="px-2.5 py-1 text-xs text-stone-500">et {total - affichees} de plus</li> : null;
  const vide = file.totaux.dus + file.totaux.aAppeler === 0;
  return (
    <nav aria-label="File d'appels" className="space-y-3">
      <div role="group" aria-label="Quelles fiches" className="flex rounded-lg border border-stone-300 p-0.5 text-xs dark:border-stone-700">
        {[false, true].map((m) => (
          <Link
            key={String(m)}
            href={adressePoste({ mesLeads: m })}
            onClick={clic("")}
            aria-current={mesLeads === m ? "true" : undefined}
            className={`flex-1 rounded-md px-2 py-1 text-center font-medium ${mesLeads === m ? "bg-accent text-white" : "text-stone-700 dark:text-stone-300"}`}
          >
            {m ? "Mes fiches" : "Toute ma file"}
          </Link>
        ))}
      </div>
      {vide ? <p className="text-sm text-stone-500 dark:text-stone-400">Aucune fiche à appeler pour l&apos;instant.</p> : null}
      <Groupe titre="Rappels dus" total={file.totaux.dus} ouvert>
        {lignes(file.dus)}
        {plus(file.dus.length, file.totaux.dus)}
      </Groupe>
      <Groupe titre="À appeler" total={file.totaux.aAppeler} ouvert>
        {lignes(file.aAppeler)}
        {plus(file.aAppeler.length, file.totaux.aAppeler)}
      </Groupe>
      <Groupe titre="Déjà appelées aujourd'hui" total={file.totaux.dejaAppelees} ouvert={false}>
        {lignes(file.dejaAppelees)}
        {plus(file.dejaAppelees.length, file.totaux.dejaAppelees)}
      </Groupe>
      <Groupe titre="Rappels à venir" total={file.totaux.aVenir} ouvert={false}>
        {lignes(file.aVenir)}
        {plus(file.aVenir.length, file.totaux.aVenir)}
      </Groupe>
    </nav>
  );
}
