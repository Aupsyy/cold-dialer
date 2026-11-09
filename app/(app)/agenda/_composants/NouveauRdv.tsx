"use client";

// Créer un rendez-vous à la main (source « manuel ») : jour et heure dans le fuseau de l'équipe, durée, canal, lien de visio, closer,
// fiche (facultative) et note. La saisie est revalidée par l'action serveur ; la base refuse un chevauchement pour le même closer.

import { useRef, useState, useTransition, type FormEvent } from "react";
import { DUREES_RDV_MIN } from "@/lib/agenda/saisie";
import { CANAUX_RDV, type CanalRdv } from "@/lib/agenda/types";
import { LIBELLES_CANAL_RDV, type FicheTrouvee } from "@/lib/agenda/vues";
import { creerRdvManuel } from "../actions";
import { ChercheurFiche } from "./ChercheurFiche";
import { BOUTON, BOUTON_SECONDAIRE, CARTE, CHAMP } from "./styles";

export interface Closer {
  id: string;
  nom: string;
}

export function NouveauRdv({
  jourParDefaut,
  dureeParDefaut,
  canalParDefaut,
  closers,
  moi,
  fuseau,
}: {
  jourParDefaut: string;
  dureeParDefaut: number;
  canalParDefaut: CanalRdv;
  closers: readonly Closer[];
  moi: string;
  fuseau: string;
}) {
  const formulaire = useRef<HTMLFormElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [fiche, setFiche] = useState<FicheTrouvee | null>(null);
  const [canal, setCanal] = useState<CanalRdv>(canalParDefaut);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  function envoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const champ = (nom: string) => String(fd.get(nom) ?? "");
    setMessage(null);
    demarrer(async () => {
      const r = await creerRdvManuel({
        jour: champ("jour"),
        heure: champ("heure"),
        dureeMin: champ("dureeMin"),
        canal: champ("canal"),
        lienVisio: champ("lienVisio"),
        closerId: champ("closerId"),
        leadId: fiche?.id ?? "",
        note: champ("note"),
      });
      if (!r.ok) {
        setMessage({ ok: false, texte: r.error });
        return;
      }
      formulaire.current?.reset();
      setFiche(null);
      setCanal(canalParDefaut);
      setMessage({ ok: true, texte: "Rendez-vous créé." });
    });
  }

  const dureeInitiale = (DUREES_RDV_MIN as readonly number[]).includes(dureeParDefaut) ? dureeParDefaut : 30;

  return (
    <section className={CARTE}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Nouveau rendez-vous</h2>
        <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} className={BOUTON_SECONDAIRE}>
          {ouvert ? "Fermer" : "Ajouter"}
        </button>
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`mt-3 text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
          {message.texte}
        </p>
      ) : null}
      {ouvert ? (
        <form ref={formulaire} onSubmit={envoyer} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="nrdv-jour" className="block text-sm font-medium">
              Jour
            </label>
            <input id="nrdv-jour" name="jour" type="date" required defaultValue={jourParDefaut} className={CHAMP} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="nrdv-heure" className="block text-sm font-medium">
              Heure ({fuseau})
            </label>
            <input id="nrdv-heure" name="heure" type="time" required step={300} className={CHAMP} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="nrdv-duree" className="block text-sm font-medium">
              Durée
            </label>
            <select id="nrdv-duree" name="dureeMin" defaultValue={String(dureeInitiale)} className={CHAMP}>
              {DUREES_RDV_MIN.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="nrdv-canal" className="block text-sm font-medium">
              Canal
            </label>
            <select id="nrdv-canal" name="canal" value={canal} onChange={(e) => setCanal(e.target.value as CanalRdv)} className={CHAMP}>
              {CANAUX_RDV.map((c) => (
                <option key={c} value={c}>
                  {LIBELLES_CANAL_RDV[c]}
                </option>
              ))}
            </select>
          </div>
          {canal === "visio" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="nrdv-lien" className="block text-sm font-medium">
                Lien de visio (facultatif)
              </label>
              <input id="nrdv-lien" name="lienVisio" type="url" inputMode="url" maxLength={300} placeholder="https://…" className={CHAMP} />
            </div>
          ) : null}
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="nrdv-closer" className="block text-sm font-medium">
              Closer
            </label>
            <select id="nrdv-closer" name="closerId" defaultValue={closers.some((c) => c.id === moi) ? moi : ""} className={CHAMP}>
              <option value="">Le propriétaire de l&apos;équipe (par défaut)</option>
              {closers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            {fiche ? (
              <p className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
                <span>
                  Fiche : <strong>{fiche.entreprise}</strong>
                </span>
                <button type="button" onClick={() => setFiche(null)} className="text-xs underline underline-offset-4">
                  Retirer
                </button>
              </p>
            ) : (
              <ChercheurFiche id="nrdv-fiche" libelleChoix="Choisir" onChoisir={setFiche} />
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="nrdv-note" className="block text-sm font-medium">
              Note (facultative)
            </label>
            <textarea id="nrdv-note" name="note" rows={2} maxLength={2000} className={CHAMP} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={enCours} aria-busy={enCours} className={BOUTON}>
              {enCours ? "Création…" : "Créer le rendez-vous"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
