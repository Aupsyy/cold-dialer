"use client";

// L'encart « Session commune » : se brancher à un concours d'appels en collant son lien, voir où on en est, quitter. Le serveur lit le
// lien, appelle le service et range le branchement en base : le secret du service ne revient jamais ici. Seuls des compteurs partent ensuite (docs/concours.md).

import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";
import { quitterSession, rejoindreSession } from "../actions";
import { MessageGeste, soumettre, useGeste } from "./geste";

export interface VueSession {
  titre: string | null;
  lienPublic: string;
  /** Le pseudo de l'équipe (branchement en base), ou null quand seules les variables d'environnement branchent. */
  pseudo: string | null;
  /** Ses compteurs au classement, si le service les a rendus. */
  scores: { appels: number; conversations: number; rdv: number } | null;
  /** Les envois depuis le dernier démarrage du serveur, si au moins un a été tenté. */
  envois: { reussis: number; echoues: number } | null;
}

export function SessionCommune({
  gestionnaire,
  session,
  viaVariables,
  baseAJour,
}: {
  gestionnaire: boolean;
  session: VueSession | null;
  /** Vrai si le branchement vient des variables CONCOURS_* (l'ancienne méthode) et non de la base. */
  viaVariables: boolean;
  baseAJour: boolean;
}) {
  const rejoindre = useGeste();
  const quitter = useGeste();

  function envoyer(donnees: FormData) {
    rejoindre.lancer(
      () => rejoindreSession({ lien: String(donnees.get("lien") ?? ""), code: String(donnees.get("code") ?? ""), pseudo: String(donnees.get("pseudo") ?? "") }),
      (d) => `Tu as rejoint la session sous le pseudo « ${d.pseudo} » : tes compteurs partent dès ton prochain appel.`,
    );
  }

  function partir() {
    const question =
      "Quitter la session commune ? Plus aucun compteur ne partira. Ton pseudo reste au classement du service : demande à l'organisateur de l'effacer si tu veux.";
    if (!window.confirm(question)) return;
    quitter.lancer(
      () => quitterSession(),
      (d) =>
        d.variablesRestantes
          ? "Branchement retiré de la base. Attention : les variables CONCOURS_* du serveur existent encore et continuent d'envoyer ; retire-les chez ton hébergeur."
          : "Tu as quitté la session : plus rien ne part. Ton pseudo reste au classement du service.",
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {session ? (
        <div className="space-y-2">
          <p>
            Tu es dans la session commune{session.titre ? ` « ${session.titre} »` : ""}
            {session.pseudo ? (
              <>
                {" "}
                sous le pseudo <strong>{session.pseudo}</strong>
              </>
            ) : null}
            . Tes compteurs partent (appels, conversations, rendez-vous), rien d&apos;autre : jamais une fiche, un nom ou un numéro.
          </p>
          <p>
            <a href={session.lienPublic} target="_blank" rel="noopener noreferrer" className="font-medium underline">
              Voir le classement de la session
            </a>
          </p>
          {session.scores ? (
            <p className="text-stone-600 dark:text-stone-400">
              Ton équipe au classement : {session.scores.appels} appels, {session.scores.conversations} conversations, {session.scores.rdv} rendez-vous.
            </p>
          ) : null}
          {session.envois ? (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Depuis le dernier démarrage du serveur : {session.envois.reussis} envois réussis, {session.envois.echoues} échoués (un envoi perdu n&apos;est pas rejoué).
            </p>
          ) : null}
          {viaVariables ? (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Branchement par les variables CONCOURS_* du serveur. Pour le défaire, retire-les chez ton hébergeur ; rejoindre une session ci-dessous les remplace.
            </p>
          ) : null}
        </div>
      ) : (
        <p>
          Une session commune met plusieurs équipes face à un même classement. Rejoins-en une avec son lien : seuls tes compteurs partent (appels, conversations,
          rendez-vous), jamais une fiche, un nom ou un numéro.
        </p>
      )}

      {gestionnaire ? (
        !baseAJour ? (
          <p role="alert" className="text-red-800 dark:text-red-200">
            La base n&apos;a pas encore la mise à jour de la session commune : joue le fichier supabase/migrations/0002_concours_branchement.sql dans Supabase (SQL
            Editor). Les variables CONCOURS_* marchent toujours en attendant.
          </p>
        ) : (
          <div className="space-y-4">
            <form onSubmit={soumettre(envoyer)} className="space-y-3">
              <h3 className="font-semibold">{session && !viaVariables ? "Rejoindre une autre session" : "Rejoindre une session"}</h3>
              <div className="space-y-1">
                <label htmlFor="session-lien" className="block font-medium">
                  Lien de la session
                </label>
                <input
                  id="session-lien"
                  name="lien"
                  type="url"
                  required
                  placeholder="https://example.org/concours/ABCD1234"
                  autoComplete="off"
                  className={`${CLASSES_CHAMP} w-full max-w-xl`}
                />
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Le lien public que te donne l&apos;organisateur. Tu n&apos;as que l&apos;adresse du service et un code ? Mets l&apos;adresse ici et le code ci-dessous.
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="session-code" className="block font-medium">
                  Code de la session <span className="font-normal text-stone-500 dark:text-stone-400">(seulement si le lien n&apos;en contient pas)</span>
                </label>
                <input id="session-code" name="code" type="text" maxLength={12} autoComplete="off" placeholder="ABCD1234" className={`${CLASSES_CHAMP} w-40 uppercase`} />
              </div>
              <div className="space-y-1">
                <label htmlFor="session-pseudo" className="block font-medium">
                  Pseudo de ton équipe
                </label>
                <input id="session-pseudo" name="pseudo" type="text" required maxLength={40} autoComplete="off" className={`${CLASSES_CHAMP} w-full max-w-xs`} />
                <p className="text-xs text-stone-500 dark:text-stone-400">Le nom qui s&apos;affiche au classement (40 caractères au plus).</p>
              </div>
              <button type="submit" disabled={rejoindre.enCours || quitter.enCours} className={classesBouton("principal")}>
                Rejoindre
              </button>
              <MessageGeste message={rejoindre.message} />
            </form>

            {session && !viaVariables ? (
              <div className="space-y-2">
                <button type="button" disabled={rejoindre.enCours || quitter.enCours} onClick={partir} className={classesBouton("danger", "sm")}>
                  Quitter la session
                </button>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Quitter retire le branchement : plus rien ne part. Ton pseudo reste au classement du service (seul l&apos;organisateur peut l&apos;effacer).
                </p>
                <MessageGeste message={quitter.message} />
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
