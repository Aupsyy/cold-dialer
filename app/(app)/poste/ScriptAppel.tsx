// Le script de l'appel, rempli pour la fiche : l'ouverture (portable ou standard, selon le numéro composé), la réponse à « comment avez-vous
// mon numéro », la permission, les questions avec leur but, le pitch, le close sur deux créneaux, puis, dépliables, les objections (réponse
// et relance), la phrase prix et le message de messagerie. Tout le texte vient de config/niche.json.

import type { ReactNode } from "react";
import type { ScriptRempli } from "@/lib/poste/script";
import { Segments } from "./Segments";

function Etape({ numero, titre, children }: { numero: number; titre: string; children: ReactNode }) {
  return (
    <li className="relative pl-9">
      <span
        aria-hidden
        className="absolute top-0.5 left-0 flex size-6 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200"
      >
        {numero}
      </span>
      <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">{titre}</h3>
      <div className="mt-1 text-base leading-relaxed">{children}</div>
    </li>
  );
}

function Replie({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
      <summary className="cursor-pointer text-sm font-medium select-none">{titre}</summary>
      <div className="mt-2 space-y-2 text-sm leading-relaxed">{children}</div>
    </details>
  );
}

export function ScriptAppel({
  script,
  ouverture,
  onOuverture,
  annonce,
  reponses,
}: {
  script: ScriptRempli;
  ouverture: "portable" | "standard";
  onOuverture: (o: "portable" | "standard") => void;
  /** Les réponses déjà notées sur la fiche (débrief), par id de question. */
  reponses: Readonly<Record<string, string>>;
  /** Le bandeau de l'annonce d'enregistrement (avec sa case), en tête du script, si l'équipe enregistre ses appels. */
  annonce: ReactNode;
}) {
  let n = 0;
  const etape = () => ++n;
  return (
    <section aria-labelledby="script-titre" className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 id="script-titre" className="sr-only">
        Script de l&apos;appel
      </h2>
      {annonce}
      {script.manquants.includes("[ton prénom]") ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          Ton prénom n&apos;est pas renseigné sur ton compte : dis-le toi-même là où il est surligné.
        </p>
      ) : null}
      <ol className="space-y-5">
        <li className="relative pl-9">
          <span
            aria-hidden
            className="absolute top-0.5 left-0 flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white"
          >
            {etape()}
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">Ouverture</h3>
            <div role="group" aria-label="Qui décroche" className="inline-flex rounded-lg border border-stone-300 p-0.5 text-xs dark:border-stone-700">
              {(["portable", "standard"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={ouverture === o}
                  onClick={() => onOuverture(o)}
                  className={`rounded-md px-2.5 py-1 font-medium ${ouverture === o ? "bg-accent text-white" : "text-stone-700 dark:text-stone-300"}`}
                >
                  {o === "portable" ? "Le dirigeant (portable)" : "Un standard"}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-lg leading-relaxed font-medium">
            <Segments segments={ouverture === "portable" ? script.ouverture.portable : script.ouverture.standard} />
          </p>
          <div className="mt-2">
            <Replie titre="« Comment avez-vous mon numéro ? »">
              <p>
                <Segments segments={script.commentAvezVousMonNumero} />
              </p>
              <p className="text-stone-600 dark:text-stone-400">{script.phraseSource}</p>
              <p className="text-stone-600 dark:text-stone-400">{script.phraseOpposition}</p>
            </Replie>
          </div>
        </li>
        {script.permission ? (
          <Etape numero={etape()} titre="Permission">
            <Segments segments={script.permission} />
          </Etape>
        ) : null}
        <Etape numero={etape()} titre="Questions">
          <ul className="space-y-2">
            {script.questions.map((q) => (
              <li key={q.id}>
                <p>
                  <Segments segments={q.texte} />
                </p>
                <p className="text-sm text-stone-500 dark:text-stone-400">But : {q.but}</p>
                {reponses[q.id] ? (
                  <p className="mt-0.5 text-sm text-emerald-800 dark:text-emerald-200">
                    <span className="font-medium">Déjà noté : </span>
                    {reponses[q.id]}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Etape>
        <Etape numero={etape()} titre="Pitch">
          <Segments segments={script.pitch} />
        </Etape>
        <Etape numero={etape()} titre="Close : deux créneaux">
          <span className="font-medium">
            <Segments segments={script.close} />
          </span>
        </Etape>
      </ol>
      <div className="mt-5 space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">Objections</h3>
        {script.objections.map((o) => (
          <Replie key={o.code} titre={o.libelle}>
            <p>
              <Segments segments={o.reponse} />
            </p>
            {o.relance ? (
              <p className="text-stone-700 dark:text-stone-300">
                <span className="font-medium">Relance : </span>
                <Segments segments={o.relance} />
              </p>
            ) : null}
          </Replie>
        ))}
        <Replie titre="S'il demande le prix">
          <p>
            <Segments segments={script.phrasePrix} />
          </p>
        </Replie>
        <Replie titre="Messagerie">
          <p>
            <Segments segments={script.messagerie} />
          </p>
        </Replie>
      </div>
    </section>
  );
}
