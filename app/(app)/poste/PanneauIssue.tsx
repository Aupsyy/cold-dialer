// L'issue de l'appel, obligatoire avant de passer à la fiche suivante : les issues de la config (touche clavier entre crochets), puis pour
// l'issue choisie : la note (pré-remplie par son gabarit), la date de rappel si elle est exigée, le rappel automatique s'il y en a un, le
// rendez-vous, l'objection entendue, la durée de l'appel, et ce que l'issue fera de la fiche.

import type { ReactNode } from "react";
import type { IssuePoste } from "@/lib/poste/issues";
import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";

export interface ChampsRappel {
  date: string;
  heure: string;
}

export interface RaccourciRappel extends ChampsRappel {
  id: string;
  libelle: string;
}

export function PanneauIssue(p: {
  issues: readonly IssuePoste[];
  choisie: IssuePoste | null;
  onChoisir: (code: string) => void;
  onAnnuler: () => void;
  note: string;
  onNote: (v: string) => void;
  rappel: ChampsRappel;
  onRappel: (r: ChampsRappel) => void;
  raccourcis: readonly RaccourciRappel[];
  rappelAuto: string | null;
  objection: string;
  onObjection: (v: string) => void;
  objections: readonly { code: string; libelle: string }[];
  duree: string;
  onDuree: (v: string) => void;
  dureeChrono: string | null;
  effet: string | null;
  tentatives: string | null;
  alerteAnnonce: string | null;
  rdv: ReactNode;
  enCours: boolean;
  erreur: string | null;
  libelleEnregistrer: string;
  onEnregistrer: () => void;
}) {
  const c = p.choisie;
  return (
    <section aria-labelledby="issue-titre" className="rounded-xl border-2 border-accent/40 bg-white p-4 dark:bg-stone-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="issue-titre" className="text-sm font-semibold tracking-wide uppercase">
          Issue de l&apos;appel
        </h2>
        <p className="text-xs text-stone-500 dark:text-stone-400">Touche du clavier entre crochets · Ctrl+Entrée pour enregistrer · Échap pour annuler</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {p.issues.map((i) => (
          <button
            key={i.code}
            type="button"
            disabled={p.enCours}
            aria-pressed={c?.code === i.code}
            onClick={() => p.onChoisir(i.code)}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
              c?.code === i.code
                ? "border-accent bg-accent text-white"
                : i.code === "ne_plus_contacter"
                  ? "border-red-200 bg-red-50 text-red-900 hover:border-red-400 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
                  : "border-stone-200 bg-stone-50 hover:border-accent dark:border-stone-700 dark:bg-stone-800"
            }`}
          >
            <span>{i.libelle}</span>
            {i.touche ? <kbd className="rounded border border-current/30 px-1.5 text-xs opacity-80">{i.touche}</kbd> : null}
          </button>
        ))}
      </div>

      {c ? (
        <div className="mt-4 space-y-4">
          {p.tentatives ? <p className="text-sm text-stone-600 dark:text-stone-400">{p.tentatives}</p> : null}
          {p.rdv}
          {c.exigeRappel ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Date du rappel (obligatoire)</legend>
              <div className="flex flex-wrap gap-2">
                {p.raccourcis.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => p.onRappel({ date: r.date, heure: r.heure })}
                    aria-pressed={p.rappel.date === r.date && p.rappel.heure === r.heure}
                    className={`${classesBouton(p.rappel.date === r.date && p.rappel.heure === r.heure ? "principal" : "secondaire", "sm")}`}
                  >
                    {r.libelle}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="text-sm">
                  <span className="sr-only">Jour du rappel</span>
                  <input type="date" value={p.rappel.date} onChange={(e) => p.onRappel({ ...p.rappel, date: e.target.value })} className={CLASSES_CHAMP} />
                </label>
                <label className="text-sm">
                  <span className="sr-only">Heure du rappel</span>
                  <input type="time" value={p.rappel.heure} onChange={(e) => p.onRappel({ ...p.rappel, heure: e.target.value })} className={CLASSES_CHAMP} />
                </label>
              </div>
            </fieldset>
          ) : null}
          {p.rappelAuto ? (
            <p className="text-sm">
              <span className="font-medium">Rappel automatique : </span>
              {p.rappelAuto} <span className="text-stone-500">(créneau alterné)</span>
            </p>
          ) : null}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Note</span>
            <textarea
              value={p.note}
              onChange={(e) => p.onNote(e.target.value)}
              rows={Math.min(8, Math.max(3, p.note.split("\n").length + 1))}
              maxLength={5000}
              className={CLASSES_CHAMP}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="min-w-48 flex-1 space-y-1.5">
              <span className="text-sm font-medium">Objection entendue (facultatif)</span>
              <select value={p.objection} onChange={(e) => p.onObjection(e.target.value)} className={CLASSES_CHAMP}>
                <option value="">Aucune</option>
                {p.objections.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.libelle}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-32 space-y-1.5">
              <span className="text-sm font-medium">Durée</span>
              <input
                value={p.duree}
                onChange={(e) => p.onDuree(e.target.value)}
                inputMode="numeric"
                placeholder={p.dureeChrono ?? "m:ss"}
                aria-describedby="duree-aide"
                className={CLASSES_CHAMP}
              />
            </label>
          </div>
          <p id="duree-aide" className="-mt-2 text-xs text-stone-500 dark:text-stone-400">
            Vide : la durée du chronomètre{p.dureeChrono ? ` (${p.dureeChrono})` : ""}. Sinon « 2:35 ».
          </p>
          {p.effet ? <p className="text-sm text-stone-700 dark:text-stone-300">{p.effet}</p> : null}
          {p.alerteAnnonce ? (
            <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              {p.alerteAnnonce}
            </p>
          ) : null}
          {p.erreur ? (
            <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
              {p.erreur}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={p.onEnregistrer} disabled={p.enCours} aria-busy={p.enCours} className={classesBouton("principal", "lg")}>
              {p.enCours ? "Enregistrement…" : p.libelleEnregistrer}
            </button>
            <button type="button" onClick={p.onAnnuler} disabled={p.enCours} className={classesBouton("discret")}>
              Changer d&apos;issue
            </button>
          </div>
        </div>
      ) : p.erreur ? (
        <p role="alert" className="mt-3 text-sm text-red-800 dark:text-red-200">
          {p.erreur}
        </p>
      ) : null}
    </section>
  );
}

export function PanneauRdv(p: {
  nom: string;
  /** L'outil d'agenda renvoie lui-même le rendez-vous (webhook) : pas de formulaire interne, pas de second rendez-vous. */
  auto: boolean;
  lienReservation: string | null;
  creneaux: readonly RaccourciRappel[];
  valeur: { date: string; heure: string; canal: string; closerId: string };
  onValeur: (v: { date: string; heure: string; canal: string; closerId: string }) => void;
  canaux: readonly { code: string; libelle: string }[];
  closers: readonly { id: string; nom: string }[];
  dejaPose: string | null;
}) {
  // Le lien pré-rempli s'ouvre seulement sur un clic explicite (iClosed crée le contact dès l'ouverture), sans accès à cette page.
  const ouvrir = p.lienReservation ? (
    <button
      type="button"
      onClick={() => {
        if (p.lienReservation) window.open(p.lienReservation, "_blank", "noopener,noreferrer");
      }}
      className={classesBouton("secondaire")}
    >
      Ouvrir la réservation (nouvel onglet)
    </button>
  ) : null;
  if (p.auto) {
    return (
      <div className="space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
        <p className="text-sm font-medium">{p.nom} : réserve le créneau dans l&apos;outil d&apos;agenda</p>
        {ouvrir}
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Le rendez-vous arrivera tout seul dans l&apos;agenda et sur la fiche (webhook de l&apos;outil). Ici, enregistre seulement l&apos;issue de
          l&apos;appel : un second rendez-vous ferait doublon.
        </p>
      </div>
    );
  }
  if (p.dejaPose) {
    return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100">Rendez-vous posé : {p.dejaPose}.</p>;
  }
  const v = p.valeur;
  return (
    <fieldset className="space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
      <legend className="px-1 text-sm font-medium">{p.nom} : le créneau convenu</legend>
      {ouvrir ? (
        <div className="space-y-1">
          {ouvrir}
          <p className="text-xs text-stone-500 dark:text-stone-400">L&apos;outil ne renvoie pas ses rendez-vous : note aussi le créneau ici.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {p.creneaux.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={v.date === c.date && v.heure === c.heure}
            onClick={() => p.onValeur({ ...v, date: c.date, heure: c.heure })}
            className={classesBouton(v.date === c.date && v.heure === c.heure ? "principal" : "secondaire", "sm")}
          >
            {c.libelle}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <label>
          <span className="sr-only">Jour du rendez-vous</span>
          <input type="date" value={v.date} onChange={(e) => p.onValeur({ ...v, date: e.target.value })} className={CLASSES_CHAMP} />
        </label>
        <label>
          <span className="sr-only">Heure du rendez-vous</span>
          <input type="time" value={v.heure} onChange={(e) => p.onValeur({ ...v, heure: e.target.value })} className={CLASSES_CHAMP} />
        </label>
        <label>
          <span className="sr-only">Canal</span>
          <select value={v.canal} onChange={(e) => p.onValeur({ ...v, canal: e.target.value })} className={CLASSES_CHAMP}>
            {p.canaux.map((c) => (
              <option key={c.code} value={c.code}>
                {c.libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Closer</span>
          <select value={v.closerId} onChange={(e) => p.onValeur({ ...v, closerId: e.target.value })} className={CLASSES_CHAMP}>
            <option value="">Closer : le propriétaire</option>
            {p.closers.map((m) => (
              <option key={m.id} value={m.id}>
                Closer : {m.nom}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
