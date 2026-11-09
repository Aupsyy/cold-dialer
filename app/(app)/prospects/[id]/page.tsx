// La fiche d'un prospect : coordonnées, accroche, sources datées (RGPD), rappels et rendez-vous, notes, chronologie, puis les blocs ajoutés
// au registre de la fiche (<FicheBlocs>, par exemple « Appels transcrits ») et, pour le propriétaire seulement, « Effacer cette
// fiche » (le droit d'effacement d'une personne). Appeler : depuis le Poste.

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { chargerFiche } from "@/app/_actions/fiche";
import { FicheBlocs } from "@/app/_components/fiche/FicheBlocs";
import { Pastille, PastilleTier, Section, classesBouton } from "@/app/_ui/elements";
import { niche } from "@/config/niche";
import { accrocheDeFiche } from "@/lib/poste/accroche";
import { chronologie } from "@/lib/poste/chronologie";
import { champsDecouverte, reponsesDecouverte } from "@/lib/poste/decouverte";
import { issuesDuPoste } from "@/lib/poste/issues";
import { LIBELLES_CANAL, LIBELLES_SOURCE_RDV, LIBELLES_STATUT_RDV, libelleDans, libelleStatut } from "@/lib/poste/libelles";
import { lireSources } from "@/lib/poste/sources";
import { affichageNumero, numerosDeFiche } from "@/lib/poste/telephone";
import { dateHeureLongue, libelleJourHeure } from "@/lib/poste/temps";
import { estGestionnaire } from "@/lib/roles";
import { getContext } from "@/lib/server/action-kit";
import { uuid } from "@/lib/server/validation";
import { EffacerFiche } from "../../reglages/_composants/EffacerFiche";
import { ActionsFiche } from "./ActionsFiche";
import { ContactFiche } from "./ContactFiche";
import { NoteFiche } from "./NoteFiche";

export const metadata: Metadata = { title: "Fiche prospect" };

type Props = { params: Promise<{ id: string }> };

function Ligne({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 py-1 text-sm">
      <dt className="text-stone-500 dark:text-stone-400">{libelle}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default async function PageFicheProspect({ params }: Props) {
  const { id } = await params;
  let leadId: string | null = null;
  try {
    leadId = uuid(id, "La fiche");
  } catch {
    leadId = null;
  }
  if (!leadId) notFound();
  const [r, ctx] = await Promise.all([chargerFiche({ leadId }), getContext()]);
  if (!r.ok) notFound();
  const { fiche: f, activites, rdvs, membres } = r.data;
  const maintenant = Date.now();
  const fuseau = niche.pays.fuseau;
  const pays = niche.pays.code;
  const quand = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(t) ? libelleJourHeure(t, maintenant, fuseau) : null;
  };
  const accroche = accrocheDeFiche(f);
  const sources = lireSources(f.sources);
  const numeros = numerosDeFiche(f, pays);
  const libellesIssues = Object.fromEntries(issuesDuPoste(niche.issues).map((i) => [i.code, i.libelle]));
  const entrees = chronologie(activites, [], { libellesIssues, membres, fuseau, maintenant });
  const attribuee = f.assigneA ? (membres.find((m) => m.id === f.assigneA)?.nom ?? "Quelqu'un de l'équipe") : "File commune";
  const opposition = f.statut === "ne_plus_contacter";
  const decouverte = reponsesDecouverte(f.qualification, champsDecouverte(niche));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">
            <Link href="/prospects" className="text-stone-600 underline-offset-4 hover:underline dark:text-stone-400">
              Prospects
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{f.entreprise}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <PastilleTier tier={f.tier} />
            {f.urgent ? <Pastille ton="alerte">Urgente</Pastille> : null}
            <Pastille ton={opposition ? "alerte" : f.statut === "rdv_fixe" ? "ok" : "neutre"}>{libelleStatut(f.statut)}</Pastille>
            {f.score !== null ? <Pastille>Score {f.score}</Pastille> : null}
            <Pastille>{attribuee}</Pastille>
          </div>
        </div>
        {opposition ? (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            Liste d&apos;opposition : ne plus appeler.
          </p>
        ) : (
          <Link href={`/poste?fiche=${f.id}`} className={classesBouton("principal")}>
            Appeler depuis le Poste
          </Link>
        )}
      </div>

      <ActionsFiche
        leadId={f.id}
        urgent={f.urgent}
        gestionnaire={estGestionnaire(ctx?.role ?? null)}
        assigneA={f.assigneA}
        membres={membres.map((m) => ({ id: m.id, nom: m.nom }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section titre="Coordonnées" id="coordonnees">
          <dl>
            <Ligne libelle="Dirigeant">{f.dirigeant ?? "Inconnu"}</Ligne>
            {numeros.length === 0 ? <Ligne libelle="Téléphone">Aucun numéro</Ligne> : null}
            {numeros.map((n) => (
              <Ligne key={`${n.colonne}-${n.brut}`} libelle={n.colonne === "mobile" ? "Mobile" : "Téléphone"}>
                <span className="tabular-nums">{n.e164 ? affichageNumero(n.e164, pays) : n.brut}</span>
                {n.e164 ? null : <span className="text-stone-500"> (format illisible)</span>}
              </Ligne>
            ))}
            <Ligne libelle="E-mail">
              {f.email ?? "Aucun"}
              {f.email && f.emailSource ? <span className="block text-xs text-stone-500">source : {f.emailSource}</span> : null}
            </Ligne>
            <Ligne libelle="Site">
              {f.site && /^https?:\/\//i.test(f.site) ? (
                <a href={f.site} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                  {f.site.replace(/^https?:\/\//i, "")}
                </a>
              ) : (
                "Aucun"
              )}
            </Ligne>
            <Ligne libelle="Adresse">{[f.cp, f.ville, f.departement ? `(${f.departement})` : null].filter(Boolean).join(" ") || "Inconnue"}</Ligne>
            <Ligne libelle="Métier">{f.metier ?? "Non renseigné"}</Ligne>
            {f.siren ? <Ligne libelle="SIREN">{f.siren}</Ligne> : null}
            {f.naf ? <Ligne libelle="NAF">{f.naf}</Ligne> : null}
            {f.forme ? <Ligne libelle="Forme">{f.forme}</Ligne> : null}
            {f.effectif ? <Ligne libelle="Effectif">{f.effectif}</Ligne> : null}
            {f.dateCreation ? <Ligne libelle="Création">{f.dateCreation}</Ligne> : null}
            {f.noteGoogle !== null ? (
              <Ligne libelle="Avis en ligne">
                {f.noteGoogle} / 5{f.nbAvis !== null ? ` (${f.nbAvis} avis)` : ""}
              </Ligne>
            ) : null}
          </dl>
          <div className="mt-3">
            <ContactFiche
              leadId={f.id}
              valeurs={{
                dirigeant: f.dirigeant ?? "",
                telephone: f.telephone ?? "",
                mobile: f.mobile ?? "",
                email: f.email ?? "",
                site: f.site ?? "",
                ville: f.ville ?? "",
                cp: f.cp ?? "",
                metier: f.metier ?? "",
              }}
            />
          </div>
        </Section>

        <div className="space-y-4">
          <Section titre="Suivi" id="suivi">
            <dl>
              <Ligne libelle="Prochain rappel">{quand(f.rappelLe) ?? "Aucun"}</Ligne>
              <Ligne libelle="Rendez-vous">{quand(f.rdvLe) ?? "Aucun"}</Ligne>
              <Ligne libelle="Tentatives">
                {f.tentatives} sur {niche.tentativesMax}
              </Ligne>
              <Ligne libelle="Dernière issue">{f.derniereIssue ? (libellesIssues[f.derniereIssue] ?? f.derniereIssue) : "Jamais appelée"}</Ligne>
              {f.objection ? <Ligne libelle="Objection">{niche.objections.find((o) => o.code === f.objection)?.libelle ?? f.objection}</Ligne> : null}
              <Ligne libelle="Dernière activité">{quand(f.derniereActivite) ?? "Aucune"}</Ligne>
            </dl>
          </Section>

          {accroche ? (
            <Section titre="Accroche" id="accroche">
              <p className="text-base font-medium">{accroche.texte}</p>
              {accroche.source ? (
                <a href={accroche.source} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-accent underline-offset-4 hover:underline">
                  Voir la source
                </a>
              ) : null}
            </Section>
          ) : null}

          <Section titre="Sources des coordonnées" id="sources">
            {sources.length === 0 ? (
              <p className="text-sm text-amber-900 dark:text-amber-200">Aucune source datée sur cette fiche : précise-la dans une note.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {sources.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.libelle}</span>
                    {s.donnee ? <span> ({s.donnee})</span> : null}
                    {s.le ? <span className="text-stone-500"> · {s.le}</span> : null}
                    {s.precision ? <span className="block text-stone-600 dark:text-stone-400">{s.precision}</span> : null}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate text-accent underline-offset-4 hover:underline">
                        {s.url}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <Section titre="Découverte" id="decouverte">
        <dl className="divide-y divide-stone-100 dark:divide-stone-800">
          {decouverte.map((r) => (
            <div key={r.id} className="grid gap-1 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
              <dt className="text-stone-600 dark:text-stone-400">{r.question}</dt>
              <dd className={r.valeur ? "whitespace-pre-line" : "text-stone-400"}>{r.valeur ?? "Pas encore noté"}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section titre="Rendez-vous" id="rendez-vous">
        {rdvs.length === 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">Aucun rendez-vous.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rdvs.map((r) => {
              const t = Date.parse(r.debut);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{Number.isFinite(t) ? dateHeureLongue(t, fuseau) : r.debut}</span>
                  <Pastille ton={r.statut === "pris" || r.statut === "confirme" ? "ok" : "neutre"}>{libelleDans(LIBELLES_STATUT_RDV, r.statut)}</Pastille>
                  <span className="text-stone-600 dark:text-stone-400">
                    {libelleDans(LIBELLES_CANAL, r.canal)} · {libelleDans(LIBELLES_SOURCE_RDV, r.source)}
                    {r.closerId ? ` · ${membres.find((m) => m.id === r.closerId)?.nom ?? "closer"}` : ""}
                  </span>
                  {r.aVerifier ? <Pastille ton="attention">À vérifier</Pastille> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section titre="Notes" id="notes">
        {f.notes ? <p className="mb-3 text-sm whitespace-pre-line">{f.notes}</p> : null}
        <NoteFiche leadId={f.id} />
      </Section>

      <Section titre="Chronologie" id="chronologie">
        {entrees.length === 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">Rien pour l&apos;instant : aucun appel ni note.</p>
        ) : (
          <ol className="space-y-2">
            {entrees.map((e) => (
              <li key={e.id} className="text-sm">
                <p>
                  <span className="text-stone-500 dark:text-stone-400">{e.quandLibelle}</span> · <span className="font-medium">{e.titre}</span>
                  {e.auteur ? <span className="text-stone-500 dark:text-stone-400"> · {e.auteur}</span> : null}
                </p>
                {e.detail ? <p className="whitespace-pre-line text-stone-700 dark:text-stone-300">{e.detail}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <FicheBlocs leadId={f.id} />

      {ctx?.role === "proprietaire" ? <EffacerFiche leadId={f.id} entreprise={f.entreprise} opposee={opposition} /> : null}
    </div>
  );
}
