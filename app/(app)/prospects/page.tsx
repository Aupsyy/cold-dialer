// La liste des prospects : filtres dans l'adresse (statut, tier, ville, département, recherche, a un e-mail, a une accroche, mes leads,
// rappels), 50 par page, la fiche d'un clic. « Mes leads » : prendre des fiches libres, rendre celles qu'on n'a jamais appelées.
// Aucun export de fichier.

import type { Metadata } from "next";
import Link from "next/link";
import { lireObjectifDuJour } from "@/app/_actions/file";
import { listerProspects } from "@/app/_actions/filtres";
import { etatMesLeads } from "@/app/_actions/mes-leads";
import { CLASSES_CHAMP, Pastille, PastilleTier, Section, classesBouton } from "@/app/_ui/elements";
import { Avis } from "@/app/_ui/primitives";
import { niche } from "@/config/niche";
import type { LigneListe, Membre } from "@/lib/poste/fiche";
import { LIBELLES_TRI, TRIS, adresseListe, filtresActifs, nombrePages, type FiltresProspects } from "@/lib/poste/filtres";
import { LIBELLES_STATUT, STATUTS_LEAD, libelleStatut } from "@/lib/poste/libelles";
import { libelleJourHeure } from "@/lib/poste/temps";
import { BarreObjectif } from "../poste/BarreObjectif";
import { PanneauMesLeads } from "./PanneauMesLeads";

export const metadata: Metadata = { title: "Prospects" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Filtres({ f }: { f: FiltresProspects }) {
  return (
    <form method="get" action="/prospects" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1">
        <span className="block text-xs font-medium">Entreprise</span>
        <input name="q" defaultValue={f.recherche ?? ""} placeholder="Nom de l'entreprise" className={CLASSES_CHAMP} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-medium">Statut</span>
        <select name="statut" defaultValue={f.statut ?? ""} className={CLASSES_CHAMP}>
          <option value="">Tous</option>
          {STATUTS_LEAD.map((s) => (
            <option key={s} value={s}>
              {LIBELLES_STATUT[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-medium">Tier</span>
        <select name="tier" defaultValue={f.tier ?? ""} className={CLASSES_CHAMP}>
          <option value="">Tous</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="aucun">Sans tier</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-medium">Rappels</span>
        <select name="rappels" defaultValue={f.rappels ?? ""} className={CLASSES_CHAMP}>
          <option value="">Avec ou sans</option>
          <option value="dus">Rappels dus</option>
          <option value="a_venir">Rappels à venir</option>
          <option value="tous">Tous les rappels</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-medium">Ville</span>
        <input name="ville" defaultValue={f.ville ?? ""} className={CLASSES_CHAMP} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-medium">Département</span>
        <input name="departement" defaultValue={f.departement ?? ""} placeholder="69" maxLength={3} className={CLASSES_CHAMP} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-medium">Tri</span>
        <select name="tri" defaultValue={f.tri} className={CLASSES_CHAMP}>
          {TRIS.map((t) => (
            <option key={t} value={t}>
              {LIBELLES_TRI[t]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-wrap items-end gap-x-4 gap-y-1 text-sm">
        <legend className="sr-only">Autres filtres</legend>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="email" value="1" defaultChecked={f.avecEmail} /> A un e-mail
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="accroche" value="1" defaultChecked={f.avecAccroche} /> A une accroche
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="mes" value="1" defaultChecked={f.mesLeads} /> Mes leads
        </label>
      </fieldset>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={classesBouton("principal")}>
          Filtrer
        </button>
        {filtresActifs(f) > 0 ? (
          <Link href="/prospects" className={classesBouton("discret", "sm")}>
            Effacer les filtres
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function Rappel({ l, maintenant }: { l: LigneListe; maintenant: number }) {
  const fuseau = niche.pays.fuseau;
  const rdv = l.rdvLe ? Date.parse(l.rdvLe) : Number.NaN;
  if (Number.isFinite(rdv)) return <Pastille ton="ok">RDV {libelleJourHeure(rdv, maintenant, fuseau)}</Pastille>;
  const t = l.rappelLe ? Date.parse(l.rappelLe) : Number.NaN;
  if (!Number.isFinite(t)) return <span className="text-stone-400">-</span>;
  return <Pastille ton={t <= maintenant ? "alerte" : "attention"}>{libelleJourHeure(t, maintenant, fuseau)}</Pastille>;
}

function nomDe(membres: readonly Membre[], id: string | null): string {
  if (!id) return "File commune";
  return membres.find((m) => m.id === id)?.nom ?? "Quelqu'un de l'équipe";
}

export default async function PageProspects({ searchParams }: Props) {
  const parametres = await searchParams;
  const [r, etat, objectif] = await Promise.all([listerProspects(parametres), etatMesLeads(), lireObjectifDuJour()]);
  if (!r.ok) {
    return (
      <section className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
        <div className="mt-4">
          <Avis ton="erreur">{r.error}</Avis>
        </div>
      </section>
    );
  }
  const { filtres: f, lignes, total, membres, maintenant } = r.data;
  const pages = nombrePages(total);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/prospects/nouveau" className={classesBouton("principal")}>
            Saisir un prospect
          </Link>
          <Link href="/poste" className={classesBouton("secondaire")}>
            Ouvrir le Poste
          </Link>
        </div>
      </div>

      {objectif.ok ? <BarreObjectif compteurs={objectif.data.compteurs} objectif={objectif.data.objectifAppels} /> : null}

      <Section titre="Filtres">
        <Filtres f={f} />
      </Section>

      <Section titre="Mes leads">
        <PanneauMesLeads etat={etat.ok ? etat.data : null} />
      </Section>

      <section aria-labelledby="liste-titre" className="space-y-2">
        <h2 id="liste-titre" className="text-sm text-stone-600 dark:text-stone-400">
          {total} prospect{total > 1 ? "s" : ""}
          {pages > 1 ? ` · page ${Math.min(f.page, pages)} sur ${pages}` : ""}
        </h2>
        {lignes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-stone-600 dark:border-stone-700 dark:text-stone-400">
            Aucun prospect ne correspond. {filtresActifs(f) > 0 ? "Essaie avec moins de filtres." : "Saisis-en un, ou lance un import."}
          </p>
        ) : (
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {lignes.map((l) => (
              <li key={l.id}>
                <Link href={`/prospects/${l.id}`} className="grid gap-1 px-4 py-3 hover:bg-stone-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4 dark:hover:bg-stone-800">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.entreprise}</span>
                    <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                      {[l.ville, l.departement ? `(${l.departement})` : null].filter(Boolean).join(" ") || "Ville inconnue"} · {nomDe(membres, l.assigneA)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <PastilleTier tier={l.tier} />
                    <Pastille ton={l.statut === "ne_plus_contacter" ? "alerte" : l.statut === "rdv_fixe" ? "ok" : "neutre"}>{libelleStatut(l.statut)}</Pastille>
                    {l.tentatives > 0 ? <span className="text-xs text-stone-500">{l.tentatives} tent.</span> : null}
                  </span>
                  <span className="text-sm sm:text-right">
                    <Rappel l={l} maintenant={maintenant} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 pt-2">
            {f.page > 1 ? (
              <Link href={adresseListe(f, { page: f.page - 1 })} className={classesBouton("secondaire", "sm")}>
                Page précédente
              </Link>
            ) : (
              <span />
            )}
            {f.page < pages ? (
              <Link href={adresseListe(f, { page: f.page + 1 })} className={classesBouton("secondaire", "sm")}>
                Page suivante
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
