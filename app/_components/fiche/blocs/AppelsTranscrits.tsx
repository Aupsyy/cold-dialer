// Le bloc « Appels transcrits » de la fiche prospect : les appels de la fiche (date, statut, durée, enregistrement et
// transcription présents ou non) et leurs débriefs (scripts/debrief/ecrire.mjs : extraction résumée, citations mot pour mot, verdict de
// l'accroche, prochaine étape). Composant SERVEUR, lecture seule, sous la RLS du compte connecté : un appelant ne voit que ses appels et
// ses débriefs, un gestionnaire ceux de l'équipe. La transcription n'est jamais affichée ici (sa présence seulement). L'audio ne se joue
// que si l'appel est conservable (audioJouable) ET lisible pour ce compte (enregistrement_lisible, la règle du bucket privé).

import type { ReactNode } from "react";
import { niche } from "@/config/niche";
import {
  assembler,
  audioJouable,
  LIBELLES_ETAPE,
  LIBELLES_SOURCE_DEBRIEF,
  LIBELLES_STATUT_APPEL,
  lireAppel,
  lireDebrief,
  type EntreeAppels,
  type VueAppel,
  type VueDebrief,
} from "@/lib/retours/appels-transcrits";
import { dateLisible, dureeLisible, libelleChamp, libelleIssue, libelleObjection, LIBELLES_VERDICT } from "@/lib/retours/libelles";
import { createClient } from "@/lib/supabase/server";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIGNES = 20;
/** Au plus quelques lecteurs audio par fiche (un lien signé chacun, valable 10 minutes). */
const MAX_AUDIOS = 5;
const FUSEAU = niche.pays.fuseau;

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function lienAudio(supabase: Supabase, chemin: string): Promise<string | null> {
  const { data: lisible, error } = await supabase.rpc("enregistrement_lisible", { p_nom: chemin });
  if (error || lisible !== true) return null;
  const { data } = await supabase.storage.from("enregistrements").createSignedUrl(chemin, 600);
  return data?.signedUrl ?? null;
}

export async function AppelsTranscrits({ leadId }: { leadId: string }) {
  if (!RE_UUID.test(leadId)) return <p className="text-sm text-stone-500">Fiche inconnue.</p>;
  const supabase = await createClient();
  const [appels, debriefs, avecTranscription, verdicts, reglages] = await Promise.all([
    supabase
      .from("appels")
      .select("id, fournisseur, direction, statut, debut, duree_s, annonce_lue, enregistrement_chemin, created_at, premiere_ligne:transcription->0")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(MAX_LIGNES),
    supabase.from("debriefs").select("id, appel_id, source, extraction, appel_le, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(MAX_LIGNES),
    supabase.from("debriefs").select("id").eq("lead_id", leadId).not("transcription", "is", null).limit(MAX_LIGNES),
    supabase.from("retours_marche").select("debrief_id, accroche_verdict").eq("lead_id", leadId).not("debrief_id", "is", null).limit(MAX_LIGNES * 2),
    supabase.from("reglages").select("enregistrement_complet").maybeSingle(),
  ]);
  const echec = appels.error ?? debriefs.error ?? avecTranscription.error ?? verdicts.error;
  if (echec) {
    console.error("[bloc] appels transcrits", echec.code ?? "sans-code");
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-300">
        Les appels de cette fiche n&apos;ont pas pu être lus. Réessaie dans un instant.
      </p>
    );
  }

  const transcrits = new Set(((avecTranscription.data ?? []) as unknown[]).map((l) => String((l as { id?: unknown }).id ?? "")));
  const verdictParDebrief = new Map<string, unknown>(
    ((verdicts.data ?? []) as unknown[]).map((l) => {
      const o = l as { debrief_id?: unknown; accroche_verdict?: unknown };
      return [String(o.debrief_id ?? ""), o.accroche_verdict ?? null];
    }),
  );
  const vuesAppels = ((appels.data ?? []) as unknown[]).map(lireAppel).filter((a): a is VueAppel => a !== null);
  const vuesDebriefs = ((debriefs.data ?? []) as unknown[])
    .map((d) => {
      const id = String((d as { id?: unknown }).id ?? "");
      return lireDebrief(d, verdictParDebrief.get(id) ?? null, transcrits.has(id));
    })
    .filter((d): d is VueDebrief => d !== null);
  const entrees = assembler(vuesAppels, vuesDebriefs);

  if (entrees.length === 0) {
    return (
      <p className="text-sm text-stone-500 dark:text-stone-400">
        Aucun appel transcrit ni débrief sur cette fiche pour l&apos;instant. Après un appel, le débrief (skill Claude Code) range ici ce que le
        prospect a dit.
      </p>
    );
  }

  const enregistrementComplet = (reglages.data as { enregistrement_complet?: unknown } | null)?.enregistrement_complet === true;
  const audios = new Map<string, string>();
  for (const a of vuesAppels.filter((x) => audioJouable(x, enregistrementComplet)).slice(0, MAX_AUDIOS)) {
    const url = await lienAudio(supabase, a.enregistrement as string);
    if (url) audios.set(a.id, url);
  }

  return (
    <ol className="space-y-3" aria-label="Appels et débriefs, du plus récent au plus ancien">
      {entrees.map((e) => (
        <Entree key={e.cle} entree={e} audio={e.appel ? (audios.get(e.appel.id) ?? null) : null} />
      ))}
    </ol>
  );
}

function Pastille({ children, ton = "neutre" }: { children: ReactNode; ton?: "neutre" | "ok" | "attention" }) {
  const couleurs = {
    neutre: "border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300",
    ok: "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200",
    attention: "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-200",
  }[ton];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${couleurs}`}>{children}</span>;
}

function Entree({ entree, audio }: { entree: EntreeAppels; audio: string | null }) {
  const a = entree.appel;
  return (
    <li className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{dateLisible(entree.quand, FUSEAU, true)}</span>
        {a ? (
          <>
            <span className="text-stone-600 dark:text-stone-400">
              {LIBELLES_STATUT_APPEL[a.statut]} · {dureeLisible(a.dureeS)} · {a.direction === "entrant" ? "entrant" : "sortant"}
            </span>
            <Pastille ton={a.enregistrement ? "ok" : "neutre"}>{a.enregistrement ? "Enregistrement" : "Sans enregistrement"}</Pastille>
            <Pastille ton={a.aTranscription ? "ok" : "neutre"}>{a.aTranscription ? "Transcription" : "Sans transcription"}</Pastille>
          </>
        ) : (
          <Pastille>Débrief sans appel en base</Pastille>
        )}
      </div>
      {audio ? (
        <audio controls preload="none" src={audio} className="mt-2 w-full">
          Ton navigateur ne lit pas l&apos;audio.
        </audio>
      ) : null}
      {entree.debriefs.map((d) => (
        <Debrief key={d.id} debrief={d} />
      ))}
    </li>
  );
}

function Liste({ titre, elements, citation = false }: { titre: string; elements: string[]; citation?: boolean }) {
  if (elements.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{titre}</p>
      <ul className="mt-1 space-y-1">
        {elements.map((t, i) => (
          <li key={i} className={`[overflow-wrap:anywhere] ${citation ? "border-l-2 border-accent pl-2 italic" : ""}`}>
            {citation ? `« ${t} »` : t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Debrief({ debrief: d }: { debrief: VueDebrief }) {
  const etape = d.prochaineEtape;
  const verdict = d.verdict;
  return (
    <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Débrief</span>
        <Pastille>{LIBELLES_SOURCE_DEBRIEF[d.source] ?? d.source}</Pastille>
        {d.issue ? <Pastille>{libelleIssue(d.issue, niche)}</Pastille> : null}
        {d.interet !== null ? <Pastille>Intérêt {d.interet}/3</Pastille> : null}
        {d.decideurJoint !== null ? <Pastille>{d.decideurJoint ? "Décideur joint" : "Décideur non joint"}</Pastille> : null}
        {verdict ? <Pastille ton={verdict === "rejet" ? "attention" : verdict === "accroche" ? "ok" : "neutre"}>Accroche : {LIBELLES_VERDICT[verdict]}</Pastille> : null}
        {d.aTranscription ? <Pastille>Transcription gardée</Pastille> : null}
      </div>
      {d.resume ? <p className="mt-2 [overflow-wrap:anywhere]">{d.resume}</p> : null}
      {d.objection ? (
        <p className="mt-2">
          <span className="font-medium">Objection : </span>
          {libelleObjection(d.objection, niche)}
          {d.objectionTexte ? <span className="text-stone-600 dark:text-stone-400"> ({d.objectionTexte})</span> : null}
        </p>
      ) : null}
      {d.champs.length > 0 ? (
        <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_1fr]">
          {d.champs.map((c) => (
            <div key={c.id} className="contents">
              <dt className="text-stone-500 dark:text-stone-400">{libelleChamp(c.id, niche)}</dt>
              <dd className="[overflow-wrap:anywhere]">{c.valeur}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Liste titre="Douleurs" elements={d.douleurs} />
      <Liste titre="Croyances" elements={d.croyances} />
      <Liste titre="Citations (mot pour mot)" elements={d.citations} citation />
      {etape ? (
        <p className="mt-2 text-xs">
          <span className="font-semibold text-stone-500 dark:text-stone-400">Prochaine étape : </span>
          {LIBELLES_ETAPE[etape.type] ?? etape.type}
          {etape.date ? ` le ${dateLisible(etape.date, FUSEAU, true)}` : ""}
          {etape.detail ? ` (${etape.detail})` : ""}
        </p>
      ) : null}
      {d.tags.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-1">
          {d.tags.map((t) => (
            <Pastille key={t}>{t}</Pastille>
          ))}
        </p>
      ) : null}
    </div>
  );
}
