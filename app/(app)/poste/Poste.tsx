"use client";

// Le Poste d'appels : la file à côté de la fiche ouverte. Il reste monté d'une fiche à l'autre (la navigation change seulement l'adresse).
// Il porte UN élément dédié à la téléphonie, préparé une seule fois par l'adaptateur de la config (adaptateurTelephonie(config.telephonie
// .fournisseur), lib/telephonie) et démonté seulement avec le Poste : une iframe de fournisseur survit au changement de fiche. Sur cet élément :
//   data-numero (les numéros E.164 de la fiche ouverte, trois au plus), data-schema-lien, data-copier-numero : lus par l'adaptateur ;
//   événements « telephonie:etat » (lu ici) et « telephonie:appel » (lu par la fiche : chronomètre et durée).
// Rien n'est mis dans cet élément : l'adaptateur en est le seul maître. Sans adaptateur : repli lien d'appel et copie (AppelFiche).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avis } from "@/app/_ui/primitives";
import { EVENEMENT_ETAT_TELEPHONE, lireEtatTelephone } from "@/lib/poste/appel";
import type { FileVue } from "@/lib/poste/vue";
import { adaptateurTelephonie } from "@/lib/telephonie/registre";
import type { EtatTelephone } from "@/lib/telephonie/types";
import { AppelFiche, type PropsAppelFiche } from "./AppelFiche";
import { ListeFile } from "./ListeFile";

export interface PropsPoste {
  file: FileVue;
  mesLeads: boolean;
  appel: Omit<PropsAppelFiche, "adaptateur" | "etatTelephone" | "onVerrou" | "zoneTelephone">;
}

const LIBELLES_ETAT: Readonly<Record<EtatTelephone, string>> = { pret: "prêt", attente: "en attente", indisponible: "indisponible" };

export function Poste({ file, mesLeads, appel }: PropsPoste) {
  const { fournisseur, mode, schemaLien, copierNumero } = appel.config.telephonie;
  const adaptateur = useMemo(() => adaptateurTelephonie(fournisseur), [fournisseur]);
  const zone = useRef<HTMLDivElement>(null);
  const [etat, setEtat] = useState<EtatTelephone>("pret");
  const [verrou, setVerrou] = useState(false);
  const [blocage, setBlocage] = useState(false);
  const [reduit, setReduit] = useState(false);

  // Préparé une fois (le Poste reste monté d'une fiche à l'autre), démonté avec le Poste.
  useEffect(() => {
    const el = zone.current;
    if (!adaptateur || !el) return;
    const lire = () => {
      try {
        setEtat(adaptateur.client.etat());
      } catch {
        setEtat("indisponible");
      }
    };
    const surEtat = (e: Event) => {
      const etatLu = lireEtatTelephone((e as CustomEvent<unknown>).detail);
      if (etatLu) setEtat(etatLu);
    };
    el.addEventListener(EVENEMENT_ETAT_TELEPHONE, surEtat);
    let demonter: () => void = () => {};
    try {
      demonter = adaptateur.client.preparer(el);
    } catch {
      setEtat("indisponible");
    }
    lire();
    // Filet de sécurité pour un adaptateur qui ne prévient pas de ses changements d'état.
    const t = setInterval(lire, 5000);
    return () => {
      clearInterval(t);
      el.removeEventListener(EVENEMENT_ETAT_TELEPHONE, surEtat);
      try {
        demonter();
      } catch {
        // rien à démonter
      }
    };
  }, [adaptateur]);

  const surVerrou = useCallback((v: boolean) => {
    setVerrou(v);
    if (!v) setBlocage(false);
  }, []);

  const numeros = appel.fiche.numeros
    .map((n) => n.e164)
    .filter((n): n is string => n !== null)
    .slice(0, 3)
    .join(" ");
  const attributs = { "data-zone-telephone": "", "data-numero": numeros, "data-schema-lien": schemaLien, "data-copier-numero": copierNumero ? "1" : "0" };

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="order-2 lg:order-1">
        <div className="rounded-xl border border-stone-200 bg-white p-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto dark:border-stone-800 dark:bg-stone-900">
          <ListeFile file={file} ficheId={appel.fiche.id} mesLeads={mesLeads} bloquee={verrou} onBloquee={() => setBlocage(true)} />
        </div>
      </aside>
      <div className="order-1 min-w-0 space-y-4 lg:order-2">
        {mode === "iframe" ? null : <div ref={zone} {...attributs} className="empty:hidden" />}
        {blocage && verrou ? <Avis ton="erreur">Un appel est en cours : enregistre d&apos;abord son issue, puis passe à une autre fiche.</Avis> : null}
        <AppelFiche
          key={appel.fiche.id}
          {...appel}
          adaptateur={adaptateur}
          etatTelephone={adaptateur ? etat : "indisponible"}
          onVerrou={surVerrou}
          zoneTelephone={zone}
        />
      </div>
      {mode === "iframe" ? (
        // Le téléphone en iframe (Aircall, Ringover) : un panneau flottant d'environ 376 × 600 pixels, réductible mais jamais démonté.
        <section
          aria-label="Téléphone"
          className={`fixed right-4 bottom-4 z-40 flex w-[376px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-stone-300 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900 ${
            reduit ? "h-11" : "h-[600px] max-h-[calc(100dvh-2rem)]"
          }`}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-stone-200 px-3 text-sm dark:border-stone-800">
            <span className="font-medium">Téléphone · {adaptateur ? LIBELLES_ETAT[etat] : "non branché"}</span>
            <button type="button" onClick={() => setReduit((r) => !r)} aria-expanded={!reduit} className="text-sm underline-offset-4 hover:underline">
              {reduit ? "Ouvrir" : "Réduire"}
            </button>
          </div>
          <div ref={zone} {...attributs} className="min-h-0 flex-1" />
        </section>
      ) : null}
    </div>
  );
}
