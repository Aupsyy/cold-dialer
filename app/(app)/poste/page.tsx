// Le Poste d'appels : l'objectif du jour, la file, la fiche ouverte (adresse : ?fiche=…), son script rempli depuis la config, l'issue
// obligatoire et la fiche suivante (?apres=… : la première de la file qui n'est pas celle qu'on vient de traiter). Tout est lu ici, côté
// serveur (app/_actions/file.ts) ; le navigateur ne reçoit que ce qu'il affiche.

import type { Metadata } from "next";
import Link from "next/link";
import { chargerPoste } from "@/app/_actions/file";
import { etatMesLeads } from "@/app/_actions/mes-leads";
import { classesBouton, Section } from "@/app/_ui/elements";
import { Avis } from "@/app/_ui/primitives";
import { niche } from "@/config/niche";
import { adaptateurAgenda, rdvRecusAutomatiquement } from "@/lib/agenda/registre";
import { chronologie } from "@/lib/poste/chronologie";
import { configAgendaDe, configPosteClient, configScriptDe, lieuDe } from "@/lib/poste/config-poste";
import { deuxCreneaux } from "@/lib/poste/creneaux";
import { ficheSuivante } from "@/lib/poste/file";
import { issueParCode } from "@/lib/poste/issues";
import { champsDecouverte } from "@/lib/poste/decouverte";
import { lienReservationSur } from "@/lib/poste/rdv";
import { premierPrenom, remplirLeScript } from "@/lib/poste/script";
import { majuscule, versChampsLocaux } from "@/lib/poste/temps";
import { contexteScriptDe, ficheVue, fileVue } from "@/lib/poste/vue";
import { PanneauMesLeads } from "../prospects/PanneauMesLeads";
import { BarreObjectif } from "./BarreObjectif";
import { Poste } from "./Poste";

export const metadata: Metadata = { title: "Poste" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PagePoste({ searchParams }: Props) {
  const parametres = await searchParams;
  const r = await chargerPoste(parametres);
  if (!r.ok) {
    return (
      <section className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Poste d&apos;appels</h1>
        <div className="mt-4">
          <Avis ton="erreur">{r.error}</Avis>
        </div>
      </section>
    );
  }
  const d = r.data;
  const lieu = lieuDe(niche);
  const config = configPosteClient(niche);
  const file = fileVue(d.file, d.maintenant, lieu.fuseau);
  const ok = typeof parametres.ok === "string" ? issueParCode(config.issues, parametres.ok) : null;

  const entete = (
    <>
      <BarreObjectif compteurs={d.compteurs} objectif={d.objectifAppels} />
      {ok ? <Avis ton="ok">Fiche précédente enregistrée : {ok.libelle}.</Avis> : null}
      {d.ficheIntrouvable ? (
        <Avis ton="info">La fiche demandée n&apos;est pas accessible (attribuée à quelqu&apos;un d&apos;autre, ou supprimée) : voici la suivante de ta file.</Avis>
      ) : null}
    </>
  );

  if (!d.fiche) {
    const etat = await etatMesLeads();
    return (
      <div className="space-y-4">
        {entete}
        <section className="rounded-xl border border-dashed border-stone-300 p-6 text-center dark:border-stone-700">
          <h1 className="text-xl font-semibold">Ta file est vide</h1>
          <p className="mt-1 text-stone-600 dark:text-stone-400">
            {d.mesLeads
              ? "Aucune de tes fiches n'est à appeler maintenant. Prends-en d'autres, ou passe sur toute ta file."
              : "Rien à appeler maintenant : les rappels à venir reviendront à leur heure."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {d.mesLeads ? (
              <Link href="/poste" className={classesBouton("secondaire")}>
                Voir toute ma file
              </Link>
            ) : null}
            <Link href="/prospects" className={classesBouton("secondaire")}>
              Voir les prospects
            </Link>
            <Link href="/prospects/nouveau" className={classesBouton("secondaire")}>
              Saisir un prospect
            </Link>
          </div>
        </section>
        <Section titre="Prendre des fiches">
          <PanneauMesLeads etat={etat.ok ? etat.data : null} />
        </Section>
      </div>
    );
  }

  const f = d.fiche.fiche;
  const vue = ficheVue(f, {
    pays: lieu.pays,
    fuseau: lieu.fuseau,
    maintenant: d.maintenant,
    tentativesMax: config.tentativesMax,
    schemaLien: config.telephonie.schemaLien,
    champsDecouverte: champsDecouverte(niche),
  });
  const deux = deuxCreneaux(d.maintenant, lieu, { dureeMin: niche.offre.rdv.dureeMin, occupes: d.occupes });
  const script = remplirLeScript(
    configScriptDe(niche),
    contexteScriptDe(f, {
      equipe: niche.marque.nomEquipe,
      metierParDefaut: niche.cible.metiers[0] ?? null,
      vouvoiement: niche.script.vouvoiement,
      tonPrenom: premierPrenom(d.nom),
      deuxCreneaux: deux?.texte ?? null,
    }),
    { enregistrement: d.enregistrementComplet },
  );
  // L'outil d'agenda renvoie-t-il lui-même ses rendez-vous (webhook ou synchronisation Google, variables posées) ? La même règle que
  // l'écran Agenda : sinon, avec Google, un « RDV pris » au Poste doublerait le rendez-vous importé par la synchro.
  const agenda = adaptateurAgenda(niche.agenda.fournisseur);
  const rdvAuto = rdvRecusAutomatiquement(niche.agenda.fournisseur, process.env);
  const lienReservation = lienReservationSur(
    agenda,
    { id: f.id, entreprise: f.entreprise, dirigeant: f.dirigeant, email: f.email, telephone: vue.numeros[0]?.e164 ?? f.telephone },
    configAgendaDe(niche),
  );
  const libellesIssues = Object.fromEntries(config.issues.map((i) => [i.code, i.libelle]));

  return (
    <div className="space-y-4">
      {entete}
      <Poste
        file={file}
        mesLeads={d.mesLeads}
        appel={{
          fiche: vue,
          script,
          config,
          rdv: {
            auto: rdvAuto,
            lienReservation,
            creneaux: deux
              ? [deux.premier, deux.second].map((c, i) => ({ id: `creneau-${i}`, libelle: majuscule(c.libelle), ...versChampsLocaux(c.debut, lieu.fuseau) }))
              : [],
            closers: d.membres.filter((m) => m.role !== "appelant").map((m) => ({ id: m.id, nom: m.nom })),
          },
          chronologie: chronologie(d.fiche.activites, d.fiche.rdvs, { libellesIssues, membres: d.membres, fuseau: lieu.fuseau, maintenant: d.maintenant }).slice(0, 10),
          suivanteSansAppel: ficheSuivante(file.ordre, f.id),
          mesLeads: d.mesLeads,
        }}
      />
    </div>
  );
}
