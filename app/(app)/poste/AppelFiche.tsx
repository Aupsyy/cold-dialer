"use client";

// L'appel d'une fiche, du clic sur « Appeler » à l'issue enregistrée : le bouton Appeler (l'adaptateur de téléphonie de la config, ou le
// repli lien d'appel et copie du numéro), le chronomètre, l'annonce d'enregistrement, le script, l'issue obligatoire (raccourcis clavier,
// gabarit de note, rappel exigé ou automatique, rendez-vous), puis la fiche suivante. Remonté à chaque fiche (clé = identifiant) : rien
// d'une fiche ne fuit sur la suivante.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { reserverFiche } from "@/app/_actions/fiche";
import { enregistrerIssue, noterAnnonceLue, poserRdv, signalerDebutAppel } from "@/app/_actions/issue";
import { Pastille, PastilleTier, classesBouton } from "@/app/_ui/elements";
import {
  ALERTE_SANS_ANNONCE,
  EVENEMENT_APPEL_TELEPHONE,
  annonceCochable,
  appliquerSignal,
  dureeAppel,
  formatChrono,
  libelleCaseAnnonce,
  lireDureeSaisie,
  lireSignalTelephone,
  messageAppel,
  nouvelAppel,
  refusCocheAnnonce,
  signalPourFiche,
  type AppelEnCours,
} from "@/lib/poste/appel";
import type { EntreeChronologie } from "@/lib/poste/chronologie";
import { estAnnuler, estEnregistrer, issueDeLaTouche } from "@/lib/poste/clavier";
import type { ConfigPosteClient } from "@/lib/poste/config-poste";
import { ISSUES_TENTATIVE, effetIssue, estJointe, issueParCode, nettoyerNote, noteDepuisGabarit } from "@/lib/poste/issues";
import { LIBELLES_CANAL } from "@/lib/poste/libelles";
import { etatTentatives, raccourcisRappel, rappelAutomatique } from "@/lib/poste/rappels";
import { CANAUX } from "@/lib/poste/rdv";
import { adressePoste } from "@/lib/poste/saisie-poste";
import type { ScriptRempli } from "@/lib/poste/script";
import { lienAppel, ouverturePour } from "@/lib/poste/telephone";
import { depuisChampsLocaux, libelleHeure, libelleJourHeure, versChampsLocaux } from "@/lib/poste/temps";
import type { FicheVue } from "@/lib/poste/vue";
import type { AdaptateurTelephonie, EtatTelephone } from "@/lib/telephonie/types";
import { PanneauIssue, PanneauRdv, type ChampsRappel, type RaccourciRappel } from "./PanneauIssue";
import { ScriptAppel } from "./ScriptAppel";

export interface PropsAppelFiche {
  fiche: FicheVue;
  script: ScriptRempli;
  config: ConfigPosteClient;
  /**
   * auto : l'outil d'agenda renvoie lui-même ses rendez-vous (webhook branché) ; le Poste n'écrit alors que l'issue. Sinon, « RDV pris »
   * écrit le rendez-vous dans l'agenda interne, puis l'issue.
   */
  rdv: { auto: boolean; lienReservation: string | null; creneaux: RaccourciRappel[]; closers: { id: string; nom: string }[] };
  chronologie: EntreeChronologie[];
  suivanteSansAppel: string | null;
  mesLeads: boolean;
  adaptateur: AdaptateurTelephonie | null;
  etatTelephone: EtatTelephone;
  onVerrou: (verrou: boolean) => void;
  /** L'élément de téléphonie du Poste (monté une fois) : la fiche y écoute « telephonie:appel » pour son chronomètre. */
  zoneTelephone: RefObject<HTMLDivElement | null>;
}

async function copier(texte: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

const CANAUX_RDV = CANAUX.map((c) => ({ code: c, libelle: LIBELLES_CANAL[c] ?? c }));

export function AppelFiche(p: PropsAppelFiche) {
  const { fiche, script, config } = p;
  const router = useRouter();
  const lieu = config.lieu;

  const [numero, setNumero] = useState(0);
  const numeroChoisi = fiche.numeros[numero] ?? null;
  const [ouverture, setOuverture] = useState<"portable" | "standard">(ouverturePour(fiche.numeros[0]?.type ?? "inconnu"));
  const [appel, setAppel] = useState<AppelEnCours | null>(null);
  const [reservation, setReservation] = useState(false);
  const [tic, setTic] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [proposerCopie, setProposerCopie] = useState(false);
  const [avertissement, setAvertissement] = useState<string | null>(null);

  const [annonceLue, setAnnonceLue] = useState<string | null>(null);
  const [annonceEnCours, setAnnonceEnCours] = useState(false);
  const [erreurAnnonce, setErreurAnnonce] = useState<string | null>(null);

  const [choisie, setChoisie] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteAuto, setNoteAuto] = useState("");
  const [rappel, setRappel] = useState<ChampsRappel>({ date: "", heure: "" });
  const [raccourcis, setRaccourcis] = useState<RaccourciRappel[]>([]);
  const [rappelAuto, setRappelAuto] = useState<string | null>(null);
  const [objection, setObjection] = useState("");
  const [duree, setDuree] = useState("");
  const [rdv, setRdv] = useState<{ date: string; heure: string; canal: string; closerId: string }>({
    date: p.rdv.creneaux[0]?.date ?? "",
    heure: p.rdv.creneaux[0]?.heure ?? "",
    canal: config.rdv.canal,
    closerId: "",
  });
  const [rdvPose, setRdvPose] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [enregistree, setEnregistree] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const issue = useMemo(() => issueParCode(config.issues, choisie), [config.issues, choisie]);
  const enAppel = appel !== null && appel.fin === null;
  const secondes = dureeAppel(appel, tic);

  // Le chronomètre tourne pendant l'appel.
  useEffect(() => {
    if (!enAppel) return;
    const t = setInterval(() => setTic(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enAppel]);

  // Pendant un appel sans issue enregistrée : la file est verrouillée, et quitter la page demande confirmation (après le lancement de
  // l'appel : le lien d'appel ouvert par le navigateur ne doit pas déclencher l'alerte).
  const { onVerrou } = p;
  useEffect(() => {
    const verrou = appel !== null && !enregistree;
    onVerrou(verrou);
    if (!verrou) return;
    let arme = false;
    const t = setTimeout(() => {
      arme = true;
    }, 3000);
    const garde = (e: BeforeUnloadEvent) => {
      if (arme) e.preventDefault();
    };
    window.addEventListener("beforeunload", garde);
    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeunload", garde);
    };
  }, [appel, enregistree, onVerrou]);
  useEffect(() => () => onVerrou(false), [onVerrou]);

  // Les signaux du téléphone (iframe du fournisseur) : sonne, décroché, terminé avec sa durée. Seulement pour CETTE fiche, et jamais
  // après l'issue enregistrée.
  const { zoneTelephone } = p;
  useEffect(() => {
    const el = zoneTelephone.current;
    if (!el || enregistree) return;
    const surAppel = (e: Event) => {
      const signal = lireSignalTelephone((e as CustomEvent<unknown>).detail);
      if (!signal) return;
      setAppel((a) => (signalPourFiche(signal, fiche.id, a !== null && a.fin === null) ? appliquerSignal(a, signal, Date.now()) : a));
    };
    el.addEventListener(EVENEMENT_APPEL_TELEPHONE, surAppel);
    return () => el.removeEventListener(EVENEMENT_APPEL_TELEPHONE, surAppel);
  }, [zoneTelephone, fiche.id, enregistree]);

  async function appeler() {
    if (!numeroChoisi || fiche.opposition || enregistree || reservation) return;
    setMessage(null);
    setProposerCopie(false);
    const e164 = numeroChoisi.e164;
    // La copie du numéro part pendant le clic (certains navigateurs la refusent ensuite) ; elle ne compose rien.
    const copieEnCours = !p.adaptateur && e164 && config.telephonie.copierNumero ? copier(e164) : Promise.resolve(false);
    // La fiche d'abord, l'appel ensuite : un collègue qui vient de la prendre ne l'appelle pas en même temps.
    setReservation(true);
    try {
      const r = await reserverFiche({ leadId: fiche.id });
      if (r.ok && r.data.dejaPrise) {
        setAvertissement("Un collègue vient de prendre cette fiche : l'appel n'est pas parti. Passe à la fiche suivante.");
        return;
      }
    } catch {
      // la réservation est une précaution : l'appel part quand même
    } finally {
      setReservation(false);
    }
    setAppel(nouvelAppel(Date.now()));
    // Une annonce ne vaut que pour UN appel : un nouvel appel repart d'une case vide.
    setAnnonceLue(null);
    setErreurAnnonce(null);
    if (!e164) {
      setMessage("Numéro illisible : compose-le à la main.");
      return;
    }
    let resultat: "lance" | "repli_tel" | "copie" | "echec" = "echec";
    let copie = false;
    let erreurAdaptateur: string | null = null;
    try {
      if (p.adaptateur) {
        resultat = await p.adaptateur.client.appeler(e164, { leadId: fiche.id });
      } else {
        copie = await copieEnCours;
        const lien = lienAppel(e164, config.telephonie.schemaLien);
        if (lien) {
          window.location.href = lien;
          resultat = "repli_tel";
        } else {
          resultat = copie ? "copie" : "echec";
        }
      }
    } catch (e) {
      // L'adaptateur lève une erreur au message lisible : on l'affiche telle quelle et on propose la copie du numéro.
      erreurAdaptateur = e instanceof Error && e.message ? e.message.slice(0, 300) : null;
      resultat = "echec";
    }
    setMessage(erreurAdaptateur ?? messageAppel(resultat, copie));
    if (resultat === "echec") setProposerCopie(true);
    // L'appel est lancé (l'outil l'a composé, ou le lien tel: est parti) : la session commune, si elle est branchée, peut le chronométrer.
    // Sans effet quand elle ne l'est pas ; ne bloque rien et n'envoie aucune donnée de la fiche.
    if (resultat === "lance" || resultat === "repli_tel") void signalerDebutAppel().catch(() => undefined);
  }

  function raccroche() {
    if (appel && appel.fin === null) setAppel({ ...appel, fin: Date.now() });
  }

  async function copierLeNumero() {
    const n = numeroChoisi?.e164 ?? numeroChoisi?.brut ?? null;
    if (!n) return;
    const ok = await copier(n);
    setMessage(ok ? "Numéro copié : colle-le dans ton téléphone ou ton logiciel d'appel." : "Le navigateur refuse la copie : recopie le numéro affiché.");
    if (ok) setProposerCopie(false);
  }

  async function cocherAnnonce() {
    const refus = refusCocheAnnonce(appel);
    if (refus) {
      setErreurAnnonce(refus);
      return;
    }
    setAnnonceEnCours(true);
    setErreurAnnonce(null);
    try {
      const r = await noterAnnonceLue({ leadId: fiche.id });
      if (r.ok) {
        const t = Date.parse(r.data.lueLe);
        setAnnonceLue(Number.isFinite(t) ? libelleHeure(t, lieu.fuseau) : "à l'instant");
      } else {
        setErreurAnnonce(r.error);
      }
    } catch {
      setErreurAnnonce("Connexion impossible : coche à nouveau dans un instant.");
    }
    setAnnonceEnCours(false);
  }

  const choisir = useCallback(
    (code: string) => {
      const i = issueParCode(config.issues, code);
      if (!i || enCours || enregistree || fiche.opposition) return;
      const maintenant = Date.now();
      const gabarit = noteDepuisGabarit(i.gabaritNote);
      setChoisie(i.code);
      setErreur(null);
      setNote((actuelle) => (actuelle.trim() === "" || actuelle === noteAuto ? gabarit : actuelle));
      setNoteAuto(gabarit);
      setRaccourcis(raccourcisRappel(maintenant, lieu).map((r) => ({ id: r.id, libelle: r.libelle, ...versChampsLocaux(r.t, lieu.fuseau) })));
      setRappelAuto(rappelAutomatique(i, maintenant, lieu)?.libelle ?? null);
    },
    [config.issues, enCours, enregistree, fiche.opposition, noteAuto, lieu],
  );

  const enregistrer = useCallback(async () => {
    const i = issueParCode(config.issues, choisie);
    if (!i) {
      setErreur("Choisis l'issue de l'appel.");
      return;
    }
    if (enCours || enregistree) return;
    const fin = appel ? (appel.fin ?? Date.now()) : null;
    let dureeS: number | null = null;
    if (duree.trim() !== "") {
      dureeS = lireDureeSaisie(duree);
      if (dureeS === null) {
        setErreur("Durée illisible : écris-la comme « 2:35 ».");
        return;
      }
    } else if (appel && fin !== null) {
      dureeS = dureeAppel({ ...appel, fin }, fin);
    }
    let rappelLe: string | null = null;
    if (i.exigeRappel) {
      const t = depuisChampsLocaux(rappel.date, rappel.heure, lieu.fuseau);
      if (t === null) {
        setErreur("Choisis la date et l'heure du rappel.");
        return;
      }
      rappelLe = new Date(t).toISOString();
    }
    setEnCours(true);
    setErreur(null);
    if (appel && appel.fin === null) setAppel({ ...appel, fin });
    try {
      const noteFinale = nettoyerNote(note, i.gabaritNote);
      if (i.code === "rdv_fixe" && !p.rdv.auto && !rdvPose) {
        const r = await poserRdv({ leadId: fiche.id, date: rdv.date, heure: rdv.heure, canal: rdv.canal, closerId: rdv.closerId || null, note: noteFinale });
        if (!r.ok) {
          setErreur(r.error);
          setEnCours(false);
          return;
        }
        const t = Date.parse(r.data.debut);
        setRdvPose(Number.isFinite(t) ? libelleJourHeure(t, Date.now(), lieu.fuseau) : "enregistré");
      }
      const r = await enregistrerIssue({ leadId: fiche.id, issue: i.code, note: noteFinale, rappelLe, dureeS, objection: objection || null });
      if (!r.ok) {
        setErreur(r.error);
        setEnCours(false);
        return;
      }
      setEnregistree(true);
      if (r.data.avertissement) {
        setAvertissement(r.data.avertissement);
        setEnCours(false);
        return;
      }
      router.push(adressePoste({ apres: fiche.id, mesLeads: p.mesLeads, ok: i.code }));
    } catch {
      setErreur("Connexion impossible : rien n'est perdu, réessaie dans un instant.");
      setEnCours(false);
    }
  }, [config.issues, choisie, enCours, enregistree, appel, duree, rappel, lieu, note, p.rdv.auto, p.mesLeads, rdvPose, rdv, fiche.id, objection, router]);

  // Raccourcis clavier : la touche d'une issue la choisit ; Ctrl+Entrée (ou Entrée hors d'un champ) enregistre ; Échap annule le choix.
  useEffect(() => {
    function surTouche(e: KeyboardEvent) {
      if (estAnnuler(e)) {
        if (choisie && !enCours && !enregistree) {
          setChoisie(null);
          setErreur(null);
        }
        return;
      }
      if (estEnregistrer(e)) {
        if (choisie && !enCours && !enregistree) {
          e.preventDefault();
          void enregistrer();
        }
        return;
      }
      const i = issueDeLaTouche(e, config.issues);
      if (i) {
        e.preventDefault();
        choisir(i.code);
      }
    }
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [choisie, enCours, enregistree, enregistrer, choisir, config.issues]);

  const tentatives = issue && ISSUES_TENTATIVE.includes(issue.code) ? etatTentatives(fiche.tentatives, config.tentativesMax) : null;
  const effet = issue ? effetIssue(issue, { derniereTentative: tentatives?.derniere ?? false, rdvFixe: fiche.statut === "rdv_fixe" }) : null;
  // Une information seulement : l'issue s'enregistre sans détour, et l'écran n'invite jamais à cocher après coup.
  const alerteAnnonce = issue && script.annonce && appel && !annonceLue && estJointe(issue.code) ? ALERTE_SANS_ANNONCE : null;
  const libelleEnregistrer =
    issue?.code === "rdv_fixe" ? (p.rdv.auto ? "Enregistrer l'issue et suivant" : "RDV pris : enregistrer et suivant") : "Enregistrer et suivant";

  const annonce = script.annonce ? (
    <div
      className={`mb-4 rounded-lg border-2 p-3 ${
        annonceLue
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
          : annonceCochable(appel)
            ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
            : "border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-800"
      }`}
    >
      <p className="text-xs font-semibold tracking-wide uppercase">Annonce d&apos;enregistrement : à lire dès que le prospect décroche</p>
      <p className="mt-1 text-base font-medium">{script.annonce}</p>
      <label className="mt-2 flex items-start gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="mt-0.5 size-5 accent-[var(--accent)]"
          checked={annonceLue !== null}
          disabled={!annonceCochable(appel) || annonceLue !== null || annonceEnCours}
          onChange={() => void cocherAnnonce()}
        />
        <span>{libelleCaseAnnonce(appel, annonceLue)}</span>
      </label>
      {erreurAnnonce ? (
        <p role="alert" className="mt-1 text-sm text-red-800 dark:text-red-200">
          {erreurAnnonce}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">Sans annonce lue pendant l&apos;appel, l&apos;audio et sa transcription ne sont jamais conservés.</p>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <section aria-labelledby="fiche-titre" className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id="fiche-titre" className="text-2xl font-semibold tracking-tight break-words">
              {fiche.entreprise}
            </h1>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {[fiche.dirigeant, fiche.metier, [fiche.cp, fiche.ville].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Coordonnées à compléter"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <PastilleTier tier={fiche.tier} />
              {fiche.urgent ? <Pastille ton="alerte">Urgent</Pastille> : null}
              <Pastille>{fiche.statutLibelle}</Pastille>
              {fiche.rappel ? <Pastille ton="attention">Rappel {fiche.rappel}</Pastille> : null}
              <Pastille>{etatTentatives(fiche.tentatives, config.tentativesMax).texte}</Pastille>
            </div>
          </div>
          <Link href={`/prospects/${fiche.id}`} className={classesBouton("discret", "sm")}>
            Fiche complète
          </Link>
        </div>

        {fiche.opposition ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            Liste d&apos;opposition : cette entreprise a demandé à ne plus être appelée. Aucun appel.
          </p>
        ) : fiche.horsFile ? (
          <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-800">{fiche.horsFile}</p>
        ) : null}

        {!fiche.opposition ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {fiche.numeros.length > 1 ? (
              <div role="radiogroup" aria-label="Numéro à appeler" className="flex flex-wrap gap-2">
                {fiche.numeros.map((n, i) => (
                  <button
                    key={`${n.colonne}-${n.brut}`}
                    type="button"
                    role="radio"
                    aria-checked={numero === i}
                    disabled={enAppel}
                    onClick={() => {
                      setNumero(i);
                      setOuverture(ouverturePour(n.type));
                    }}
                    className={classesBouton(numero === i ? "principal" : "secondaire", "sm")}
                  >
                    {n.type === "portable" ? "Portable" : n.type === "fixe" ? "Fixe" : "Numéro"} {n.affichage}
                  </button>
                ))}
              </div>
            ) : numeroChoisi ? (
              <p className="text-lg font-semibold tabular-nums">{numeroChoisi.affichage}</p>
            ) : (
              <p className="text-sm text-stone-600 dark:text-stone-400">Aucun numéro sur cette fiche : complète-la depuis la fiche complète.</p>
            )}
            {numeroChoisi ? (
              <button type="button" onClick={() => void appeler()} disabled={enregistree || reservation} className={classesBouton("principal", "lg")}>
                {appel ? "Rappeler ce numéro" : "Appeler"}
              </button>
            ) : null}
            {appel ? (
              <span className="flex items-center gap-2">
                <span aria-live="off" className={`font-mono text-xl tabular-nums ${enAppel ? "text-accent" : "text-stone-500"}`}>
                  {formatChrono(secondes)}
                </span>
                {enAppel ? (
                  <button type="button" onClick={raccroche} className={classesBouton("secondaire", "sm")}>
                    Raccroché
                  </button>
                ) : null}
              </span>
            ) : null}
            {numeroChoisi ? (
              <button type="button" onClick={() => void copierLeNumero()} className={classesBouton(proposerCopie ? "secondaire" : "discret", "sm")}>
                Copier le numéro
              </button>
            ) : null}
            {numeroChoisi?.lien && appel ? (
              <a href={numeroChoisi.lien} className={classesBouton("discret", "sm")}>
                Ouvrir le lien d&apos;appel
              </a>
            ) : null}
            {p.etatTelephone !== "pret" && p.adaptateur ? (
              <Pastille ton="attention">Téléphone {p.etatTelephone === "attente" ? "en attente" : "indisponible : repli lien et copie"}</Pastille>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <p role="status" className="mt-2 text-sm text-stone-700 dark:text-stone-300">
            {message}
          </p>
        ) : null}
        {avertissement ? (
          <p role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {avertissement}
          </p>
        ) : null}
        {fiche.accroche ? (
          <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 px-4 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-xs font-semibold tracking-wide text-accent uppercase">Accroche</span>
              {fiche.accroche.source ? (
                <a href={fiche.accroche.source} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline-offset-2 hover:underline">
                  voir la source
                </a>
              ) : null}
            </div>
            <p className="mt-0.5 text-base leading-snug font-medium break-words">{fiche.accroche.texte}</p>
          </div>
        ) : null}
      </section>

      {!fiche.opposition ? (
        <ScriptAppel script={script} ouverture={ouverture} onOuverture={setOuverture} annonce={annonce} reponses={fiche.reponses} />
      ) : null}

      {enregistree && avertissement ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">Issue enregistrée.</p>
          <button type="button" onClick={() => router.push(adressePoste({ apres: fiche.id, mesLeads: p.mesLeads }))} className={classesBouton("principal")}>
            Fiche suivante
          </button>
        </div>
      ) : !fiche.opposition ? (
        <PanneauIssue
          issues={config.issues}
          choisie={issue}
          onChoisir={choisir}
          onAnnuler={() => {
            setChoisie(null);
            setErreur(null);
          }}
          note={note}
          onNote={setNote}
          rappel={rappel}
          onRappel={setRappel}
          raccourcis={raccourcis}
          rappelAuto={rappelAuto}
          objection={objection}
          onObjection={setObjection}
          objections={config.objections}
          duree={duree}
          onDuree={setDuree}
          dureeChrono={appel ? formatChrono(secondes) : null}
          effet={effet}
          tentatives={tentatives?.texte ?? null}
          alerteAnnonce={alerteAnnonce}
          rdv={
            issue?.code === "rdv_fixe" ? (
              <PanneauRdv
                nom={config.rdv.nom}
                auto={p.rdv.auto}
                lienReservation={p.rdv.lienReservation}
                creneaux={p.rdv.creneaux}
                valeur={rdv}
                onValeur={setRdv}
                canaux={CANAUX_RDV}
                closers={p.rdv.closers}
                dejaPose={rdvPose}
              />
            ) : null
          }
          enCours={enCours}
          erreur={erreur}
          libelleEnregistrer={libelleEnregistrer}
          onEnregistrer={() => void enregistrer()}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {!appel || fiche.opposition ? (
          p.suivanteSansAppel ? (
            <Link href={adressePoste({ fiche: p.suivanteSansAppel, mesLeads: p.mesLeads })} className={classesBouton("secondaire", "sm")}>
              {fiche.opposition ? "Fiche suivante" : "Passer cette fiche sans appeler"}
            </Link>
          ) : null
        ) : (
          <p className="text-xs text-stone-500 dark:text-stone-400">Appel lancé : enregistre son issue pour passer à la fiche suivante.</p>
        )}
      </div>

      {p.chronologie.length > 0 ? (
        <section aria-labelledby="historique-titre" className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <h2 id="historique-titre" className="text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
            Historique de la fiche
          </h2>
          <ol className="mt-2 space-y-2">
            {p.chronologie.map((e) => (
              <li key={e.id} className="text-sm">
                <p>
                  <span className="text-stone-500 dark:text-stone-400">{e.quandLibelle}</span> · <span className="font-medium">{e.titre}</span>
                  {e.auteur ? <span className="text-stone-500 dark:text-stone-400"> · {e.auteur}</span> : null}
                </p>
                {e.detail ? <p className="whitespace-pre-line text-stone-700 dark:text-stone-300">{e.detail}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
