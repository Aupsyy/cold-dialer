// L'écran Agenda : les rendez-vous du jour ou de la semaine, dans le fuseau de l'équipe (config.pays.fuseau), filtrés par closer et par
// statut ; les rendez-vous « à vérifier » (venus d'un outil d'agenda sans fiche retrouvée) à rattacher ; un rendez-vous ajouté à la
// main ; le lien d'abonnement ICS. Composant serveur : la lecture passe par la session (RLS) ; la logique est dans lib/agenda/vues.ts.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avis } from "@/app/_ui/primitives";
import { niche } from "@/config/niche";
import { adaptateurAgenda } from "@/lib/agenda/registre";
import { STATUTS_RDV, type FournisseurAgenda } from "@/lib/agenda/types";
import {
  COLONNES_RDV,
  LIBELLES_STATUT_RDV,
  STATUTS_ACTIFS,
  aujourdhui,
  filtrerRdv,
  hrefVue,
  lireEtatVue,
  plageVue,
  rdvDepuisLignes,
  regrouperParJour,
  type RdvAgenda,
} from "@/lib/agenda/vues";
import { estGestionnaire } from "@/lib/roles";
import { getContext } from "@/lib/server/action-kit";
import { AbonnementIcs } from "./_composants/AbonnementIcs";
import { CarteRdv } from "./_composants/CarteRdv";
import { NouveauRdv, type Closer } from "./_composants/NouveauRdv";
import { BOUTON_SECONDAIRE, CHAMP } from "./_composants/styles";

export const metadata: Metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

const PROVENANCE: Readonly<Record<FournisseurAgenda, string>> = {
  calendly: "Calendly envoie les réservations, annulations et no-show par webhook (offre payante de Calendly).",
  iclosed: "iClosed envoie les réservations, reports et annulations par webhook.",
  google: "Les rendez-vous de Google Agenda arrivent par une synchronisation planifiée (une fois par jour sur l'offre gratuite de Vercel).",
  aucun: "Agenda interne : les rendez-vous sont pris au Poste ou ajoutés ici.",
};

const OUTIL_QUI_ECRIT: Readonly<Record<FournisseurAgenda, string | null>> = { calendly: "Calendly", iclosed: "iClosed", google: "Google Agenda", aucun: null };

const JOURS_A_VERIFIER = 30;

function closersDepuisLignes(lignes: unknown): Closer[] {
  const sortie: Closer[] = [];
  for (const l of Array.isArray(lignes) ? lignes : []) {
    if (l === null || typeof l !== "object") continue;
    const r = l as { id?: unknown; nom?: unknown };
    if (typeof r.id === "string") sortie.push({ id: r.id, nom: typeof r.nom === "string" && r.nom.trim() ? r.nom.trim() : "Sans nom" });
  }
  return sortie;
}

export default async function PageAgenda({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (!ctx.workspaceId) return null;

  const fuseau = niche.pays.fuseau;
  const jourCourant = aujourdhui(fuseau);
  const etat = lireEtatVue(await searchParams, jourCourant);
  const plage = plageVue(etat, fuseau);
  const closerFiltre = etat.closer === "moi" ? ctx.userId : etat.closer;

  let requete = ctx.supabase.from("rendez_vous").select(COLONNES_RDV).gte("debut", plage.debutIso).lt("debut", plage.finIso);
  if (closerFiltre) requete = requete.eq("closer_id", closerFiltre);
  if (etat.statut === "actifs") requete = requete.in("statut", [...STATUTS_ACTIFS]);
  else if (etat.statut) requete = requete.eq("statut", etat.statut);

  const depuis = new Date(Date.now() - JOURS_A_VERIFIER * 86_400_000).toISOString();
  const [lus, aVerifierLus, equipeLue, profilLu] = await Promise.all([
    requete.order("debut").limit(500),
    ctx.supabase.from("rendez_vous").select(COLONNES_RDV).eq("a_verifier", true).is("lead_id", null).gte("debut", depuis).order("debut").limit(50),
    ctx.supabase.from("profiles").select("id, nom").order("nom"),
    ctx.supabase.from("profiles").select("agenda_jeton_empreinte").eq("id", ctx.userId).maybeSingle(),
  ]);
  const erreur = lus.error ?? aVerifierLus.error ?? equipeLue.error ?? profilLu.error;
  if (erreur) console.error("[agenda] lecture", erreur.code ?? "sans-code");

  const closers = closersDepuisLignes(equipeLue.data);
  const nomCloser = new Map(closers.map((c) => [c.id, c.nom]));
  const rdvs = filtrerRdv(rdvDepuisLignes(lus.data), etat, ctx.userId);
  const aVerifier = rdvDepuisLignes(aVerifierLus.data);
  const jours = regrouperParJour(rdvs, plage.jours, fuseau, jourCourant);
  const gestionnaire = estGestionnaire(ctx.role);
  const modifiable = (r: RdvAgenda) => gestionnaire || r.prisPar === ctx.userId || r.closerId === ctx.userId;
  const jetonActif =
    profilLu.data !== null && typeof profilLu.data === "object" && Boolean((profilLu.data as { agenda_jeton_empreinte?: unknown }).agenda_jeton_empreinte);
  const fournisseur = niche.agenda.fournisseur;

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Heures de {fuseau.replace(/_/g, " ")}. {adaptateurAgenda(fournisseur)?.libelle ?? "Agenda"} : {PROVENANCE[fournisseur]}
        </p>
      </header>

      {erreur ? <Avis ton="erreur">Une partie de l&apos;agenda n&apos;a pas pu être lue. Recharge la page dans un instant.</Avis> : null}

      <nav aria-label="Période affichée" className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-stone-300 p-0.5 dark:border-stone-700">
          {(["jour", "semaine"] as const).map((v) => (
            <Link
              key={v}
              href={hrefVue(etat, { vue: v })}
              aria-current={etat.vue === v ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${etat.vue === v ? "bg-accent text-white" : "hover:bg-stone-100 dark:hover:bg-stone-800"}`}
            >
              {v === "jour" ? "Jour" : "Semaine"}
            </Link>
          ))}
        </div>
        <Link href={hrefVue(etat, { jour: plage.precedent })} className={BOUTON_SECONDAIRE} aria-label="Période précédente">
          ←
        </Link>
        <Link href={hrefVue(etat, { jour: jourCourant })} className={BOUTON_SECONDAIRE}>
          Aujourd&apos;hui
        </Link>
        <Link href={hrefVue(etat, { jour: plage.suivant })} className={BOUTON_SECONDAIRE} aria-label="Période suivante">
          →
        </Link>
        <p className="text-sm font-semibold first-letter:uppercase">{plage.titre}</p>
      </nav>

      <form method="get" action="/agenda" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {etat.vue !== "semaine" ? <input type="hidden" name="vue" value={etat.vue} /> : null}
        <input type="hidden" name="jour" value={etat.jour} />
        <div className="space-y-1.5">
          <label htmlFor="filtre-closer" className="block text-sm font-medium">
            Closer
          </label>
          <select id="filtre-closer" name="closer" defaultValue={etat.closer ?? ""} className={CHAMP}>
            <option value="">Tous</option>
            <option value="moi">Moi</option>
            {closers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filtre-statut" className="block text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut" name="statut" defaultValue={etat.statut ?? ""} className={CHAMP}>
            <option value="">Tous</option>
            <option value="actifs">À venir (pris ou confirmé)</option>
            {STATUTS_RDV.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUT_RDV[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={BOUTON_SECONDAIRE}>
          Filtrer
        </button>
      </form>

      {aVerifier.length > 0 ? (
        <section aria-labelledby="titre-a-verifier" className="space-y-3">
          <h2 id="titre-a-verifier" className="text-lg font-semibold">
            À vérifier ({aVerifier.length})
          </h2>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Ces rendez-vous viennent d&apos;un outil d&apos;agenda sans fiche retrouvée (ni par le lien, ni par l&apos;e-mail, ni par le
            téléphone). Rattache chacun à la bonne fiche.
          </p>
          <ul className="space-y-3">
            {aVerifier.map((r) => (
              <CarteRdv
                key={r.id}
                rdv={r}
                fuseau={fuseau}
                nomCloser={r.closerId ? (nomCloser.get(r.closerId) ?? null) : null}
                modifiable={modifiable(r)}
                gestionnaire={gestionnaire}
                avecDate
              />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="space-y-6">
        {jours.map((j) => (
          <section key={j.cle} aria-labelledby={`jour-${j.cle}`} className="space-y-3">
            <h2 id={`jour-${j.cle}`} className="flex items-center gap-2 text-base font-semibold capitalize">
              {j.libelle}
              {j.aujourdhui ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium normal-case text-white">aujourd&apos;hui</span>
              ) : null}
            </h2>
            {j.rdvs.length === 0 ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">Aucun rendez-vous.</p>
            ) : (
              <ul className="space-y-3">
                {j.rdvs.map((r) => (
                  <CarteRdv
                    key={r.id}
                    rdv={r}
                    fuseau={fuseau}
                    nomCloser={r.closerId ? (nomCloser.get(r.closerId) ?? null) : null}
                    modifiable={modifiable(r)}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <NouveauRdv
        jourParDefaut={etat.jour}
        dureeParDefaut={niche.offre.rdv.dureeMin}
        canalParDefaut={niche.offre.rdv.canal}
        closers={closers}
        moi={ctx.userId}
        fuseau={fuseau.replace(/_/g, " ")}
      />
      <AbonnementIcs actifAuDepart={jetonActif} outilExterne={OUTIL_QUI_ECRIT[fournisseur]} />
    </section>
  );
}
