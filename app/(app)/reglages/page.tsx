// L'écran Réglages. Pour tout le monde : son profil et l'aide de son outil d'appel et de son agenda. Pour les gestionnaires (propriétaire
// et membre) : l'équipe, les invitations, le plafond de tentatives et l'objectif du jour, l'enregistrement des appels et son cadre
// légal, le RGPD (conservation, purge, effacement d'une fiche, contact), les variables qui manquent sur le serveur (par leur nom).
// Composant serveur : la lecture passe par la session (RLS) ; la logique est dans lib/reglages ; les gestes, dans ./actions.ts.

import type { Metadata } from "next";
import { Pastille, Section } from "@/app/_ui/elements";
import { Avis } from "@/app/_ui/primitives";
import { niche } from "@/config/niche";
import { lireSession } from "@/lib/concours/client";
import { lireConfigConcours, pagePublique } from "@/lib/concours/configuration";
import { dateHeureLongue } from "@/lib/poste/temps";
import { DOC_AGENDA, DOC_TELEPHONIE, VARIABLE_CLE_SERVICE, vueAide } from "@/lib/reglages/aide";
import { DESCRIPTION_ROLE, DUREE_INVITATION_JOURS, estExpiree, libelleRole, rolesInvitables } from "@/lib/reglages/equipe";
import { CASE_ACCEPTATION, blocageEnregistrement, cadreLegalEnregistrement, ecartPlafonds } from "@/lib/reglages/reglages";
import { estGestionnaire } from "@/lib/roles";
import { chargerReglages } from "./actions";
import { Enregistrement } from "./_composants/Enregistrement";
import { Equipe } from "./_composants/Equipe";
import { Invitations } from "./_composants/Invitations";
import { MonProfil } from "./_composants/MonProfil";
import { PlafondObjectif } from "./_composants/PlafondObjectif";
import { Purge } from "./_composants/Purge";

export const metadata: Metadata = { title: "Réglages" };
export const dynamic = "force-dynamic";
// La purge efface aussi des audios, un par un, dans le stockage : elle peut prendre plus que la durée par défaut d'une fonction.
export const maxDuration = 60;

const NOM_OUTIL = { onoff: "Onoff", aircall: "Aircall", ringover: "Ringover", softphone: "ton softphone", telephone: "ton téléphone" } as const;

function Variables({ noms, vide }: { noms: readonly string[]; vide: string }) {
  if (noms.length === 0) return <p className="text-sm text-emerald-800 dark:text-emerald-200">{vide}</p>;
  return (
    <p className="text-sm">
      Il manque sur le serveur :{" "}
      {noms.map((n, i) => (
        <span key={n}>
          {i > 0 ? ", " : null}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs dark:bg-stone-800">{n}</code>
        </span>
      ))}{" "}
      (à poser dans Vercel, puis redéployer).
    </p>
  );
}

export default async function PageReglages() {
  const r = await chargerReglages();
  if (!r.ok) {
    return (
      <section className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>
        <div className="mt-4">
          <Avis ton="erreur">{r.error}</Avis>
        </div>
      </section>
    );
  }
  const d = r.data;
  const gestionnaire = estGestionnaire(d.role);
  const proprietaire = d.role === "proprietaire";
  const fuseau = niche.pays.fuseau;
  const maintenant = Date.now();
  const aide = vueAide(niche, process.env);
  const outil = { nom: NOM_OUTIL[niche.telephonie.fournisseur], aWebhook: aide.telephonie.aWebhook };
  const quand = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(t) ? dateHeureLongue(t, fuseau) : null;
  };
  const reg = d.reglages;
  const ecart = reg ? ecartPlafonds(reg.tentativesMax, niche.tentativesMax) : null;
  // Session commune (facultative, docs/concours.md) : l'encart n'existe que si les trois variables sont posées ; le titre est lu avec un
  // délai court, et sans lui l'encart s'affiche quand même.
  const concours = lireConfigConcours(process.env);
  const session = concours ? await lireSession(concours, { delaiMs: 2000 }) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {gestionnaire
            ? "Ton profil, l'aide de tes outils, l'équipe et ses invitations, les appels, l'enregistrement et le RGPD."
            : "Ton profil et l'aide de tes outils. L'équipe et les réglages sont gérés par le propriétaire et les membres."}
        </p>
      </header>

      {d.partiel ? <Avis ton="erreur">Une partie des réglages n&apos;a pas pu être lue : recharge la page dans un instant.</Avis> : null}

      <Section titre="Mon profil" id="profil">
        {d.moi ? (
          <MonProfil
            profil={{
              nom: d.moi.nom,
              email: d.moi.email,
              role: libelleRole(d.moi.role),
              droits: DESCRIPTION_ROLE[d.moi.role],
              emailTelephonie: d.moi.emailTelephonie,
            }}
            outil={outil}
          />
        ) : (
          <p className="text-sm text-stone-600 dark:text-stone-400">Ton profil n&apos;a pas pu être lu.</p>
        )}
      </Section>

      {concours ? (
        <Section titre="Session commune" id="session-commune">
          <div className="space-y-2 text-sm">
            <p>
              Session commune{session?.titre ? ` : ${session.titre}` : ""}, tes compteurs partent (appels, conversations, rendez-vous), rien
              d&apos;autre.
            </p>
            <p>
              <a href={pagePublique(concours)} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                Voir la page publique de la session
              </a>
            </p>
          </div>
        </Section>
      ) : null}

      <Section titre="Aide de mes outils" id="aide">
        <div className="space-y-5 text-sm">
          <div className="space-y-2">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {aide.telephonie.titre}
              {aide.telephonie.experimental ? <Pastille ton="attention">Expérimental</Pastille> : null}
            </h3>
            <p>{aide.telephonie.poste}</p>
            {aide.telephonie.pannes.length > 0 ? (
              <div>
                <h4 className="font-medium">Pannes connues</h4>
                <dl className="mt-1 space-y-2">
                  {aide.telephonie.pannes.map((p) => (
                    <div key={p.symptome}>
                      <dt className="font-medium text-stone-800 dark:text-stone-200">{p.symptome}</dt>
                      <dd className="text-stone-600 dark:text-stone-400">{p.remede}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            <details>
              <summary className="cursor-pointer font-medium">Première installation sur ton ordinateur</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-stone-700 dark:text-stone-300">
                {aide.telephonie.installationAppelant.map((etape) => (
                  <li key={etape}>{etape}</li>
                ))}
              </ol>
            </details>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold">Agenda : {aide.agenda.libelle}</h3>
            <p>{aide.agenda.mode}</p>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Le détail, outil par outil : {DOC_TELEPHONIE} et {DOC_AGENDA}, dans le dépôt de ton instance.
          </p>
        </div>
      </Section>

      {gestionnaire ? (
        <>
          <Section titre="Équipe" id="equipe">
            <Equipe membres={d.equipe.map((m) => ({ ...m, estMoi: m.id === d.moi?.id }))} proprietaire={proprietaire} outil={outil} />
          </Section>

          <Section titre="Invitations" id="invitations">
            <Invitations
              roles={rolesInvitables(d.role)}
              dureeJours={DUREE_INVITATION_JOURS}
              invitations={d.invitations.map((i) => {
                const expiree = estExpiree(i, maintenant);
                const date = quand(i.expireLe) ?? i.expireLe;
                return { id: i.id, role: i.role, pour: i.email ?? i.nom ?? "Sans nom", expiree, expiration: `${expiree ? "expirée le" : "expire le"} ${date}` };
              })}
            />
          </Section>

          <Section titre="Appels : plafond et objectif" id="appels">
            <PlafondObjectif
              base={reg?.tentativesMax ?? null}
              config={niche.tentativesMax}
              ecart={ecart?.explication ?? null}
              objectif={reg?.objectifAppelsJour ?? null}
            />
          </Section>

          <Section titre="Enregistrement des appels" id="enregistrement">
            <Enregistrement
              actif={reg?.enregistrementComplet ?? false}
              accepteLe={quand(reg?.annonceLueLe ?? null)}
              blocage={blocageEnregistrement(niche.telephonie)}
              cadre={cadreLegalEnregistrement(niche.legal.annonceEnregistrement, niche.legal.conservationMois)}
              caseLibelle={CASE_ACCEPTATION}
            />
          </Section>

          <Section titre="RGPD" id="rgpd">
            <div className="space-y-5 text-sm">
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <dt className="text-stone-500 dark:text-stone-400">Responsable du traitement</dt>
                <dd className="break-words">{niche.legal.responsable}</dd>
                <dt className="text-stone-500 dark:text-stone-400">Contact pour les droits (public)</dt>
                <dd className="break-words">{niche.legal.contactRGPD}</dd>
                <dt className="text-stone-500 dark:text-stone-400">D&apos;où viennent les coordonnées</dt>
                <dd>« {niche.legal.phraseSource} »</dd>
                <dt className="text-stone-500 dark:text-stone-400">Pour ne plus être appelé</dt>
                <dd>« {niche.legal.phraseOpposition} »</dd>
                <dt className="text-stone-500 dark:text-stone-400">Conservation</dt>
                <dd>{niche.legal.conservationMois} mois sans contact, puis la fiche est purgée.</dd>
              </dl>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Ces textes viennent de la configuration (partie legal de config/niche.json) : le Poste affiche les deux phrases sous « Comment
                avez-vous mon numéro ? ». Garde-les vraies si tu changes de sources.
              </p>

              <div className="space-y-2">
                <h3 className="font-semibold">La purge des fiches inactives</h3>
                <p>
                  La purge efface les fiches sans activité depuis {niche.legal.conservationMois} mois (un import ne compte pas comme un contact ; une
                  fiche qui a un rendez-vous à venir est gardée), avec leurs appels et leurs rendez-vous passés, et, pour toute l&apos;équipe, les
                  appels, rendez-vous, débriefs et retours plus anciens. Elle retire aussi leurs audios du stockage et vide le journal des webhooks
                  de plus de 90 jours. La liste d&apos;opposition n&apos;est jamais purgée.
                </p>
                <Purge mois={niche.legal.conservationMois} />
              </div>

              <div className="space-y-1">
                <h3 className="font-semibold">Une personne demande l&apos;effacement de ses données</h3>
                <p>
                  Ouvre sa fiche (Prospects, recherche par le nom de l&apos;entreprise) : en bas, « Effacer cette fiche »
                  {proprietaire ? "" : " (réservé au propriétaire)"}. Ses identifiants peuvent rester sur la liste d&apos;opposition, pour
                  qu&apos;elle ne soit plus jamais rappelée. Les autres droits (accès, rectification, opposition) : docs/legal.md.
                </p>
              </div>
            </div>
          </Section>

          <Section titre="Variables des outils" id="variables">
            <div className="space-y-4 text-sm">
              <div className="space-y-1">
                <h3 className="font-semibold">Téléphonie : {aide.telephonie.titre}</h3>
                {aide.telephonie.aWebhook ? (
                  <>
                    <Variables noms={aide.telephonie.variablesManquantes} vide="Les variables du webhook sont posées." />
                    {aide.telephonie.variablesFacultativesAbsentes.length > 0 ? (
                      <p className="text-stone-600 dark:text-stone-400">
                        Facultatives, absentes : {aide.telephonie.variablesFacultativesAbsentes.join(", ")} (reprise de l&apos;audio et des
                        transcriptions).
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>Aucun webhook avec cet outil : rien à poser sur le serveur.</p>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold">Agenda : {aide.agenda.libelle}</h3>
                <Variables
                  noms={aide.agenda.variablesManquantes}
                  vide={niche.agenda.fournisseur === "aucun" ? "Agenda interne : rien à poser sur le serveur." : "Les variables de l'agenda sont posées."}
                />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold">Purge et effacement</h3>
                <Variables
                  noms={aide.cleServicePresente ? [] : [VARIABLE_CLE_SERVICE]}
                  vide="La clé service est posée : la purge et l'effacement des appels et des audios peuvent tourner."
                />
              </div>
              <p className="text-xs text-stone-500 dark:text-stone-400">Des noms seulement, jamais une valeur. L&apos;état complet de l&apos;instance : /api/sante.</p>
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}
