// La saisie manuelle d'un prospect, avec la source de ses coordonnées (obligatoire, datée du jour).

import type { Metadata } from "next";
import Link from "next/link";
import { classesBouton } from "@/app/_ui/elements";
import { niche } from "@/config/niche";
import { getContext } from "@/lib/server/action-kit";
import { FormulaireProspect } from "./FormulaireProspect";

export const metadata: Metadata = { title: "Nouveau prospect" };

export default async function PageNouveauProspect() {
  const ctx = await getContext();
  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Saisir un prospect</h1>
        <Link href="/prospects" className={classesBouton("discret", "sm")}>
          Retour à la liste
        </Link>
      </div>
      <FormulaireProspect metiers={niche.cible.metiers} attribuerParDefaut={ctx?.role === "appelant"} />
    </section>
  );
}
