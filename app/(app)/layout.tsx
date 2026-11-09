// La coquille de l'application : l'en-tête (produit, équipe, personne connectée, déconnexion), la navigation (Poste, Prospects, Agenda,
// Retours, Réglages), l'écran et un pied de page discret (l'équipe et le contact RGPD de la configuration). Un compte sans équipe (retiré
// par le propriétaire) ne voit que l'explication.

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { seDeconnecter } from "@/app/(auth)/actions";
import { niche } from "@/config/niche";
import { LIBELLES_ROLE } from "@/lib/roles";
import { getContext } from "@/lib/server/action-kit";
import { NavPrincipale } from "./_coquille/NavPrincipale";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold">
              <span className="text-accent">{niche.marque.nomProduit}</span>
              <span className="text-stone-400"> · </span>
              <span>{niche.marque.nomEquipe}</span>
            </p>
            <form action={seDeconnecter} className="sm:hidden">
              <button type="submit" className="text-sm text-stone-600 underline-offset-4 hover:underline dark:text-stone-400">
                Déconnexion
              </button>
            </form>
          </div>
          {ctx.workspaceId ? <NavPrincipale /> : null}
          <div className="hidden items-center gap-3 sm:flex">
            <p className="text-right text-xs leading-tight text-stone-600 dark:text-stone-400">
              <span className="block font-medium text-stone-900 dark:text-stone-100">{ctx.nom ?? "Mon compte"}</span>
              {ctx.role ? LIBELLES_ROLE[ctx.role] : null}
            </p>
            <form action={seDeconnecter}>
              <button
                type="submit"
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
              >
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {ctx.workspaceId ? (
          children
        ) : (
          <section className="mx-auto max-w-lg text-center">
            <h1 className="text-xl font-semibold">Ton compte n&apos;est rattaché à aucune équipe</h1>
            <p className="mt-2 text-stone-600 dark:text-stone-400">Demande un nouveau lien d&apos;invitation au propriétaire de l&apos;équipe.</p>
          </section>
        )}
      </main>
      <footer className="border-t border-stone-200 dark:border-stone-800">
        <p className="mx-auto max-w-6xl px-4 py-3 text-xs text-stone-500 dark:text-stone-400">
          {niche.marque.nomEquipe} · Données personnelles : {niche.legal.responsable}, {niche.legal.contactRGPD}
        </p>
      </footer>
    </div>
  );
}
