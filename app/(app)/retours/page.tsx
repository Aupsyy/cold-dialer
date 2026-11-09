// La page « Retours du marché » : ce que disent les prospects sur les 7 ou les 30 derniers jours. Objections les plus fréquentes (libellés
// de la config), répartition des issues, verdicts de l'accroche, intérêt moyen, citations récentes mot pour mot (avec l'entreprise et la
// date), tags fréquents, douleurs. Un gestionnaire peut filtrer par appelant ; un appelant ne voit que ses propres retours (RLS). Aucun
// export. Saisie rapide d'un retour en bas de page.

import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Avis } from "@/app/_ui/primitives";
import { niche } from "@/config/niche";
import { dateLisible, libelleInteret, libelleIssue, libelleObjection, libellePourcentage, LIBELLES_VERDICT, pourcentage, VERDICTS_BASE } from "@/lib/retours/libelles";
import { libellePeriode, lirePeriode, PERIODES, type Periode } from "@/lib/retours/periode";
import { getContext } from "@/lib/server/action-kit";
import { chargerRetours, MAX_LIGNES } from "./donnees";
import { SaisieRetour } from "./SaisieRetour";

export const metadata: Metadata = { title: "Retours" };

type Parametres = Record<string, string | string[] | undefined>;

function lienPeriode(jours: Periode, appelant: string | null): { pathname: string; query: Record<string, string> } {
  return { pathname: "/retours", query: { periode: String(jours), ...(appelant ? { appelant } : {}) } };
}

function Carte({ titre, children, className = "" }: { titre: string; children: ReactNode; className?: string }) {
  const id = `retours-${titre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={`rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 ${className}`}>
      <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {titre}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Vide({ children }: { children: ReactNode }) {
  return <p className="text-sm text-stone-500 dark:text-stone-400">{children}</p>;
}

function Barres({ lignes, total }: { lignes: { cle: string; libelle: string; n: number }[]; total: number }) {
  return (
    <ul className="space-y-2">
      {lignes.map((l) => {
        const p = pourcentage(l.n, total) ?? 0;
        return (
          <li key={l.cle}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{l.libelle}</span>
              <span className="shrink-0 tabular-nums font-semibold">
                {l.n} <span className="font-normal text-stone-500">({libellePourcentage(p)})</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-stone-100 dark:bg-stone-800" aria-hidden>
              <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(p, 2)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PageRetours({ searchParams }: { searchParams: Promise<Parametres> }) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  const parametres = await searchParams;
  const jours = lirePeriode(parametres.periode);
  const vue = await chargerRetours(ctx, { jours, appelant: parametres.appelant, maintenant: Date.now() });
  const a = vue.agregats;
  const fuseau = niche.pays.fuseau;
  const nomAppelant = vue.appelant ? (vue.membres.find((m) => m.id === vue.appelant)?.nom ?? "") : "";
  const portee = vue.appelant ? `les retours de ${nomAppelant}` : vue.gestionnaire ? "toute l'équipe" : "tes retours";
  const totalVerdicts = VERDICTS_BASE.reduce((s, v) => s + a.verdicts[v], 0);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retours du marché</h1>
          <p className="mt-1 text-stone-600 dark:text-stone-400">
            Ce que disent les prospects, sur les {libellePeriode(jours)} ({portee}).
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <nav aria-label="Période" className="flex gap-1">
            {PERIODES.map((p) => (
              <Link
                key={p}
                href={lienPeriode(p, vue.appelant)}
                aria-current={p === jours ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  p === jours ? "bg-accent text-white" : "border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                }`}
              >
                {p} jours
              </Link>
            ))}
          </nav>
          {vue.gestionnaire && vue.membres.length > 1 ? (
            <Form action="/retours" className="flex items-end gap-2">
              <input type="hidden" name="periode" value={String(jours)} />
              <div className="space-y-1">
                <label htmlFor="filtre-appelant" className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                  Appelant
                </label>
                <select
                  id="filtre-appelant"
                  name="appelant"
                  defaultValue={vue.appelant ?? ""}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-950"
                >
                  <option value="">Toute l&apos;équipe</option>
                  {vue.membres.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nom}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">
                Filtrer
              </button>
            </Form>
          ) : null}
        </div>
      </header>

      {vue.erreur ? <Avis ton="erreur">{vue.erreur}</Avis> : null}
      {vue.tronque ? (
        <Avis ton="info">Plus de {MAX_LIGNES.toLocaleString("fr-FR")} retours sur la période : la répartition des issues porte sur les plus récents.</Avis>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { libelle: "Retours", valeur: String(a.total) },
          { libelle: "Avec le décideur", valeur: String(a.decideurs) },
          { libelle: "Rendez-vous", valeur: String(a.rdv) },
          { libelle: "Intérêt moyen", valeur: libelleInteret(a.interetMoyen) },
        ].map((x) => (
          <div key={x.libelle} className="rounded-xl border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
            <dt className="text-xs font-medium text-stone-500 dark:text-stone-400">{x.libelle}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{x.valeur}</dd>
          </div>
        ))}
      </dl>

      {a.total === 0 && !vue.erreur ? (
        <Avis ton="info">Aucun retour sur cette période. Ils arrivent avec les débriefs d&apos;appels, ou par la saisie rapide en bas de page.</Avis>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre="Objections les plus fréquentes">
          {a.objections.length === 0 ? (
            <Vide>Aucune objection notée.</Vide>
          ) : (
            <Barres lignes={a.objections.slice(0, 10).map((o) => ({ cle: o.code, libelle: libelleObjection(o.code, niche), n: o.n }))} total={a.total} />
          )}
        </Carte>
        <Carte titre="Issues des appels">
          {vue.issues.length === 0 ? (
            <Vide>Aucune issue notée.</Vide>
          ) : (
            <Barres
              lignes={vue.issues.map((i) => ({ cle: i.code ?? "sans-issue", libelle: libelleIssue(i.code, niche), n: i.n }))}
              total={vue.issues.reduce((s, i) => s + i.n, 0)}
            />
          )}
        </Carte>
        <Carte titre="Verdicts de l'accroche">
          {totalVerdicts === 0 ? (
            <Vide>Aucun verdict noté.</Vide>
          ) : (
            <Barres lignes={VERDICTS_BASE.map((v) => ({ cle: v, libelle: LIBELLES_VERDICT[v], n: a.verdicts[v] }))} total={totalVerdicts} />
          )}
        </Carte>
        <Carte titre="Tags fréquents">
          {a.tags.length === 0 ? (
            <Vide>Aucun tag noté.</Vide>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {a.tags.slice(0, 20).map((t) => (
                <li key={t.tag} className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 px-3 py-1 text-sm dark:border-stone-700">
                  {t.tag}
                  <span className="tabular-nums font-semibold">{t.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Carte>
        <Carte titre="Citations récentes" className="lg:col-span-2">
          {vue.citations.length === 0 ? (
            <Vide>Aucune citation notée.</Vide>
          ) : (
            <ul className="space-y-3">
              {vue.citations.map((c, i) => (
                <li key={`${c.le}-${i}`} className="border-l-2 border-accent pl-3">
                  <blockquote className="italic [overflow-wrap:anywhere]">« {c.texte} »</blockquote>
                  <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                    {c.entreprise ?? "Sans fiche"} · {dateLisible(c.le, fuseau)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Carte>
        <Carte titre="Douleurs récentes" className="lg:col-span-2">
          {a.douleurs.length === 0 ? (
            <Vide>Aucune douleur notée.</Vide>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {a.douleurs.map((d, i) => (
                <li key={`${d.le}-${i}`} className="[overflow-wrap:anywhere]">
                  {d.texte} <span className="text-xs text-stone-500 dark:text-stone-400">· {dateLisible(d.le, fuseau)}</span>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      </div>

      <Carte titre="Noter un retour">
        <SaisieRetour
          objections={niche.objections.map((o) => ({ code: o.code, libelle: o.libelle }))}
          verdicts={VERDICTS_BASE.map((v) => ({ code: v, libelle: LIBELLES_VERDICT[v] }))}
        />
      </Carte>
    </div>
  );
}
