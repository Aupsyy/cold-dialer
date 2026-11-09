// L'adaptateur Onoff Business (mode « extension »).
//
// APPELER. Onoff n'a pas d'API pour lancer un appel. L'extension Chrome « Onoff Business Click2Call » ne prend PAS les liens tel: : elle
// lit le texte de la page, repère les numéros et les entoure d'une balise <onoff-telecom-ce-phone-number> ; un clic sur cette balise
// ouvre son cadran, numéro déjà tapé. Donc :
//   - preparer(el) affiche dans `el` les numéros de la fiche (attribut data-numero, posé par le Poste) et observe l'arrivée de la balise
//     (MutationObserver) : « attente » tant qu'elle n'est pas là, « pret » quand elle y est, « indisponible » sans elle au bout de
//     2,5 s (extension absente, déconnectée, en pause sur ce site ou surbrillance éteinte) ou sur un téléphone ;
//   - appeler() relaie un clic (qui ne remonte pas : bubbles false) vers la balise du bon numéro, en l'attendant 600 ms au plus si la
//     fiche vient de s'ouvrir ; sinon il copie le numéro (repli « copie »). Jamais de lien tel: : sur ordinateur il ouvrirait une autre
//     application, et sur iPhone il partirait sur la carte SIM, pas sur la ligne Onoff.
//   - le micro : l'extension décroche dans la page ; la Permissions-Policy doit l'autoriser (originesMicro), sinon « ce site restreint
//     notre extension ».
//
// WEBHOOK (plans Onoff Advanced et Max). En-tête X-API-KEY comparé en temps constant à ONOFF_WEBHOOK_TOKEN (16 caractères au moins).
// Événements CDR (appel), VM (messagerie) et RECORDING (avec l'enregistrement activé, RECORDING remplace CDR et porte le lien de
// l'audio). Onoff coupe à 10 s et réessaie 4 fois : la route répond tout de suite, le reste se fait après (apres()). La fiche est
// retrouvée par la base (9 derniers chiffres), l'appelant par son e-mail Onoff.
//
// API (facultative, ONOFF_API_KEY) : https://public-apigateway.onoffapp.net, en-tête X-API-Key, 2 requêtes par seconde.
//   GET /api/v1/calls/{id}/recording : { url } présignée (404 tant que l'audio n'est pas prêt : 5 à 8 minutes après l'appel) ;
//   GET /api/v1/calls/{id}/logs      : callTranscription { summarization, diarization[], actionItems[] }.

import { valeurEnv } from "../integrations/base";
import {
  BUDGET_SUITE_MS,
  DELAI_API_MS,
  MAX_LIGNES_TRANSCRIPTION,
  conserverEnregistrement,
  conserverTranscription,
  journaliser,
  lireEtatRecuperation,
  type AppelCible,
  type Recuperateur,
  type TranscriptionLue,
} from "./audio";
import { estE164, formaterNumero, neufDerniersChiffres, numeroRecu } from "./e164";
import {
  EVENEMENT_ETAT,
  copierTexte,
  estMobile,
  fenetreDe,
  optionsDe,
  signaler,
} from "./navigateur";
import { emailOuNull, entierBorne, idExterne, isoOuNull, nettoyerTexte, objet, secondesDepuis, secretEgal, urlHttps } from "./outils";
import type {
  AdaptateurTelephonie,
  ClientTelephonie,
  Dependances,
  EtatTelephone,
  EvenementAppel,
  LigneTranscription,
  ResultatEvenementAppel,
  StatutAppel,
} from "./types";

/** L'identifiant public de l'extension Chrome « Onoff Business Click2Call » (Chrome Web Store). */
export const ID_EXTENSION_ONOFF = "jbfkkljambdhjlkcfkcbpjfkkamkccfm";
export const ORIGINE_EXTENSION_ONOFF = `chrome-extension://${ID_EXTENSION_ONOFF}`;
/** La balise posée par l'extension autour de chaque numéro repéré dans la page. */
export const BALISE_NUMERO_ONOFF = "onoff-telecom-ce-phone-number";
/** L'attribut des numéros que l'adaptateur affiche lui-même (il ne touche à rien d'autre dans l'élément). */
export const ATTRIBUT_NUMERO_AFFICHE = "data-telephonie-numero";

/** Le temps laissé à l'extension pour surligner un numéro qui vient d'apparaître (« environ 500 ms »). */
export const DELAI_SURLIGNAGE_MS = 600;
/** Sans balise au bout de ce délai : « indisponible » (le repli est la copie du numéro). */
export const DELAI_EXTENSION_ABSENTE_MS = 2500;
/** Un clic de l'utilisateur sur le numéro surligné lui-même : l'extension l'a déjà reçu, on ne le relaie pas une seconde fois. */
const FENETRE_CLIC_DIRECT_MS = 1000;

export const URL_API_ONOFF = "https://public-apigateway.onoffapp.net";
/** Si la transcription n'est pas prête juste après l'audio, une seconde lecture après cette attente (dans le budget de la suite). */
export const ATTENTE_TRANSCRIPTION_MS = 15_000;

const MESSAGE_NUMERO_ILLISIBLE = "Numéro illisible : il faut un numéro au format international (+33…).";

// ---------------------------------------------------------------------------------------------------------------------------------
// Navigateur : l'extension Chrome
// ---------------------------------------------------------------------------------------------------------------------------------

export interface OptionsClientOnoff {
  delaiSurlignageMs?: number;
  delaiAbsenceMs?: number;
  /** L'horloge (tests). */
  maintenant?: () => number;
}

function balisesDans(el: HTMLElement): Element[] {
  try {
    return Array.from(el.querySelectorAll(BALISE_NUMERO_ONOFF));
  } catch {
    return [];
  }
}

/** La balise de l'extension qui porte ce numéro (par ses 9 derniers chiffres), ou null. */
export function trouverBaliseOnoff(el: HTMLElement | null, e164: string): Element | null {
  if (!el) return null;
  const cible = neufDerniersChiffres(e164);
  if (!cible) return null;
  return balisesDans(el).find((b) => neufDerniersChiffres(b.textContent ?? "") === cible) ?? null;
}

export function creerClientOnoff(options: OptionsClientOnoff = {}): ClientTelephonie {
  const delaiSurlignage = options.delaiSurlignageMs ?? DELAI_SURLIGNAGE_MS;
  const delaiAbsence = options.delaiAbsenceMs ?? DELAI_EXTENSION_ABSENTE_MS;
  const maintenant = options.maintenant ?? (() => Date.now());
  let el: HTMLElement | null = null;
  let generation = 0;
  let etat: EtatTelephone = "attente";
  let observateur: MutationObserver | null = null;
  let minuterie: number | null = null;
  let affiches = "";
  let dernierClicDirect = Number.NEGATIVE_INFINITY;
  let surClic: ((e: Event) => void) | null = null;

  const changer = (nouvel: EtatTelephone) => {
    if (nouvel === etat) return;
    etat = nouvel;
    signaler(el, EVENEMENT_ETAT, nouvel);
  };

  const armer = () => {
    const f = fenetreDe(el);
    if (!f) return;
    if (minuterie !== null) f.clearTimeout(minuterie);
    minuterie = f.setTimeout(() => {
      minuterie = null;
      if (el && balisesDans(el).length === 0) changer("indisponible");
    }, delaiAbsence);
  };

  /** Affiche les numéros de data-numero (un <span> par numéro) ; seuls les éléments de l'adaptateur sont touchés. */
  const rendre = () => {
    if (!el) return;
    const { numeros } = optionsDe(el);
    const cle = numeros.join(" ");
    if (cle === affiches) return;
    affiches = cle;
    for (const ancien of Array.from(el.querySelectorAll(`[${ATTRIBUT_NUMERO_AFFICHE}]`))) ancien.remove();
    for (const n of numeros) {
      const span = el.ownerDocument.createElement("span");
      span.setAttribute(ATTRIBUT_NUMERO_AFFICHE, n);
      span.textContent = formaterNumero(n);
      el.appendChild(span);
    }
    if (numeros.length > 0 && balisesDans(el).length === 0) {
      changer("attente");
      armer();
    }
  };

  const recalculer = () => {
    if (!el || balisesDans(el).length === 0) return;
    const f = fenetreDe(el);
    if (minuterie !== null && f) f.clearTimeout(minuterie);
    minuterie = null;
    changer("pret");
  };

  const demonter = () => {
    const f = fenetreDe(el);
    observateur?.disconnect();
    observateur = null;
    if (minuterie !== null && f) f.clearTimeout(minuterie);
    minuterie = null;
    if (el && surClic) el.removeEventListener("click", surClic, true);
    surClic = null;
    if (el) for (const n of Array.from(el.querySelectorAll(`[${ATTRIBUT_NUMERO_AFFICHE}]`))) n.remove();
    el = null;
    affiches = "";
    etat = "attente";
  };

  const attendreBalise = (e164: string): Promise<Element | null> =>
    new Promise((resolve) => {
      const f = fenetreDe(el);
      if (!f || !el) {
        resolve(null);
        return;
      }
      const fin = maintenant() + delaiSurlignage;
      let tours = Math.ceil(delaiSurlignage / 50) + 1;
      const tour = () => {
        const b = trouverBaliseOnoff(el, e164);
        tours -= 1;
        if (b || maintenant() >= fin || !el || tours <= 0) resolve(b);
        else f.setTimeout(tour, 50);
      };
      tour();
    });

  return {
    preparer(nouvel) {
      demonter();
      const moi = ++generation;
      el = nouvel;
      const f = fenetreDe(el);
      const fermer = () => {
        if (moi === generation) demonter();
      };
      if (!f || estMobile(f)) {
        etat = "indisponible";
        signaler(el, EVENEMENT_ETAT, etat);
        return fermer;
      }
      rendre();
      recalculer();
      if (typeof f.MutationObserver === "function") {
        observateur = new f.MutationObserver(() => {
          rendre();
          recalculer();
        });
        observateur.observe(nouvel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-numero"] });
      }
      surClic = (e: Event) => {
        const cible = e.target as Element | null;
        if (e.isTrusted && typeof cible?.closest === "function" && cible.closest(BALISE_NUMERO_ONOFF)) dernierClicDirect = maintenant();
      };
      nouvel.addEventListener("click", surClic, true);
      if (etat !== "pret") armer();
      signaler(el, EVENEMENT_ETAT, etat);
      return fermer;
    },

    etat() {
      return etat;
    },

    async appeler(e164) {
      if (!estE164(e164)) throw new Error(MESSAGE_NUMERO_ILLISIBLE);
      const f = fenetreDe(el);
      if (el && f && !estMobile(f)) {
        if (maintenant() - dernierClicDirect < FENETRE_CLIC_DIRECT_MS) return "lance";
        const balise = trouverBaliseOnoff(el, e164) ?? (await attendreBalise(e164));
        if (balise) {
          balise.dispatchEvent(new f.MouseEvent("click", { bubbles: false, cancelable: true }));
          if (optionsDe(el).copierNumero) void copierTexte(e164, f);
          return "lance";
        }
      }
      if (await copierTexte(e164, f)) return "copie";
      throw new Error("Le numéro n'a pas pu être copié : compose-le dans Onoff.");
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook : lecture
// ---------------------------------------------------------------------------------------------------------------------------------

/** Le statut d'après callStatus (webhook) ou status (API). */
export function statutOnoff(v: unknown): StatutAppel {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (s === "ANSWERED" || s === "ANSWER" || s === "END") return "repondu";
  if (s === "MISSED_CALL" || s === "ABORT" || s === "DROPPED_VERIFICATION" || s === "NO_ANSWER") return "sans_reponse";
  if (s === "BUSY") return "occupe";
  if (s === "VMS") return "messagerie";
  if (s === "WRONG_NUMBER" || s === "UNKNOWN_SUBSCRIBER") return "faux_numero";
  return "inconnu";
}

/** Un corps Onoff -> zéro ou un événement. L'essai envoyé par Onoff à la création de l'intégration, sans événement connu : rien. */
export function lireOnoff(corps: unknown): EvenementAppel[] {
  const o = objet(corps);
  const nom = typeof o.eventName === "string" ? o.eventName.trim().toUpperCase() : "";
  if (nom !== "CDR" && nom !== "RECORDING" && nom !== "VM") return [];
  const externeId = idExterne(o.id);
  if (!externeId) return [];
  const entrant = typeof o.callDirection === "string" && o.callDirection.trim().toUpperCase() === "INBOUND";
  return [
    {
      fournisseur: "onoff",
      externeId,
      direction: entrant ? "entrant" : "sortant",
      statut: nom === "VM" ? "messagerie" : statutOnoff(o.callStatus),
      debut: isoOuNull(o.callStarted),
      fin: isoOuNull(o.callEnded),
      dureeS: entierBorne(o.callDuration, 0, 86_400),
      numeroExterne: numeroRecu(o.externalNumber),
      emailAppelant: emailOuNull(o.onoffUserEmail),
      annonceJouee: false,
      urlEnregistrement: nom === "RECORDING" ? urlHttps(o.callRecordingUrl) : null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// API Onoff (facultative) : l'audio et la transcription après coup
// ---------------------------------------------------------------------------------------------------------------------------------

export function apiOnoffConfiguree(env: Dependances["env"]): boolean {
  return valeurEnv(env, "ONOFF_API_KEY") !== "";
}

/** Un appel à l'API : { statut, json } ; 0 = clé absente, -1 = réseau. La clé ne sort jamais (ni journal, ni erreur). */
async function appelerApiOnoff(chemin: string, d: Pick<Dependances, "env" | "fetch">): Promise<{ statut: number; json: unknown }> {
  const cle = valeurEnv(d.env, "ONOFF_API_KEY");
  if (!cle) return { statut: 0, json: null };
  try {
    const r = await d.fetch(`${URL_API_ONOFF}${chemin}`, {
      headers: { "X-API-Key": cle, Accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_API_MS),
    });
    let json: unknown = null;
    try {
      json = await r.json();
    } catch {
      json = null;
    }
    return { statut: r.status, json };
  } catch {
    return { statut: -1, json: null };
  }
}

function codeApi(statut: number, pasPret: string): string {
  if (statut === 0) return "api_non_configuree";
  if (statut === -1) return "api_reseau";
  if (statut === 404) return pasPret;
  return `api_${statut}`;
}

/** L'URL présignée de l'audio (GET /api/v1/calls/{id}/recording), ou un code. */
export async function urlEnregistrementOnoff(externeId: string, d: Pick<Dependances, "env" | "fetch">): Promise<{ url: string } | { code: string }> {
  const r = await appelerApiOnoff(`/api/v1/calls/${encodeURIComponent(externeId)}/recording`, d);
  if (r.statut !== 200) return { code: codeApi(r.statut, "enregistrement_pas_pret") };
  const url = urlHttps(objet(r.json).url);
  return url ? { url } : { code: "api_sans_url" };
}

/** Qui parle : l'étiquette d'Onoff (Agent, User… = l'appelant ; Customer, Contact… = le prospect), sinon l'index (0 = le membre Onoff). */
export function locuteurOnoff(etiquette: unknown, index: unknown): LigneTranscription["locuteur"] {
  const l = typeof etiquette === "string" ? etiquette.trim().toLowerCase() : "";
  if (/(customer|client|contact|external|externe|prospect|caller|interlocut)/.test(l)) return "prospect";
  if (/(agent|user|utilisateur|member|membre|onoff|appelant|employee)/.test(l)) return "appelant";
  if (index === 0) return "appelant";
  if (index === 1) return "prospect";
  return "inconnu";
}

/** La réponse de GET /api/v1/calls/{id}/logs -> des lignes { t, locuteur, texte } et un résumé (actions comprises). */
export function lireTranscriptionOnoff(json: unknown): TranscriptionLue {
  const ct = objet(objet(json).callTranscription);
  const brutes = Array.isArray(ct.diarization) ? ct.diarization.slice(0, MAX_LIGNES_TRANSCRIPTION) : [];
  const lignes: LigneTranscription[] = [];
  for (const b of brutes) {
    const u = objet(b);
    const t = nettoyerTexte(u.text);
    if (t === "") continue;
    lignes.push({ t: secondesDepuis(u.startTime) ?? 0, locuteur: locuteurOnoff(u.speakerLabel, u.speakerIndex), texte: t });
  }
  lignes.sort((a, b) => a.t - b.t);
  const actions = (Array.isArray(ct.actionItems) ? ct.actionItems : [])
    .map((a) => nettoyerTexte(objet(a).action, 300))
    .filter((a) => a !== "")
    .slice(0, 20);
  const morceaux = [nettoyerTexte(ct.summarization, 3500), actions.length > 0 ? `À faire : ${actions.join(" ; ")}` : ""].filter((m) => m !== "");
  const resume = morceaux.join("\n").slice(0, 4000);
  return { lignes, resume: resume === "" ? null : resume };
}

/** La transcription par l'API, ou un code (« transcription_pas_prete » tant qu'Onoff ne l'a pas). */
export async function transcriptionOnoff(externeId: string, d: Pick<Dependances, "env" | "fetch">): Promise<TranscriptionLue | { code: string }> {
  const r = await appelerApiOnoff(`/api/v1/calls/${encodeURIComponent(externeId)}/logs`, d);
  if (r.statut !== 200) return { code: codeApi(r.statut, "transcription_pas_prete") };
  const t = lireTranscriptionOnoff(r.json);
  return t.lignes.length === 0 && t.resume === null ? { code: "transcription_pas_prete" } : t;
}

/** Pour la reprise différée (cron) : l'audio et la transcription par l'API. */
export const recuperateurOnoff: Recuperateur = {
  variables: ["ONOFF_API_KEY"],
  extension: "mp4",
  urlEnregistrement: urlEnregistrementOnoff,
  transcription: transcriptionOnoff,
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook : après la réponse
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Ce qui se fait après la réponse 200, et seulement si la base a dit conserverAudio : l'audio (lien de RECORDING, sinon l'API), puis la
 * transcription (l'API), relue une fois après une attente bornée si elle n'est pas prête. Le reste attend la reprise différée.
 */
export async function suiteOnoff(e: EvenementAppel, r: ResultatEvenementAppel, d: Dependances): Promise<string[]> {
  if (!r.conserverAudio) return ["audio_ignore"];
  if (e.statut !== "repondu" && !(e.statut === "inconnu" && e.urlEnregistrement)) return ["sans_audio_attendu"];
  const debut = d.maintenant();
  const cible: AppelCible = { fournisseur: "onoff", externeId: e.externeId, workspaceId: r.workspaceId };
  const etat = await lireEtatRecuperation(cible, false, d);
  if ("code" in etat) return [etat.code];
  if (!etat.conserverAudio) return ["audio_ignore"];
  const codes: string[] = [];
  if (etat.aEnregistrement) {
    codes.push("audio_deja_la");
  } else {
    let url = e.urlEnregistrement;
    if (!url && apiOnoffConfiguree(d.env)) {
      const u = await urlEnregistrementOnoff(e.externeId, d);
      if ("code" in u) codes.push(u.code);
      else url = u.url;
    }
    if (url) codes.push(await conserverEnregistrement(cible, url, d, "mp4"));
    else if (codes.length === 0) codes.push("audio_en_attente");
  }
  if (!etat.aTranscription && apiOnoffConfiguree(d.env)) {
    let t = await transcriptionOnoff(e.externeId, d);
    if ("code" in t && t.code === "transcription_pas_prete" && d.maintenant() - debut + ATTENTE_TRANSCRIPTION_MS < BUDGET_SUITE_MS) {
      await d.attendre(ATTENTE_TRANSCRIPTION_MS);
      t = await transcriptionOnoff(e.externeId, d);
    }
    codes.push("code" in t ? t.code : await conserverTranscription(cible, t.lignes, t.resume, d));
  }
  return codes;
}

export const onoff: AdaptateurTelephonie = {
  id: "onoff",
  libelle: "Onoff Business (extension Chrome Click2Call)",
  originesMicro: [ORIGINE_EXTENSION_ONOFF],
  client: creerClientOnoff(),
  webhook: {
    variables: ["ONOFF_WEBHOOK_TOKEN"],
    verifier(req, _corps, env) {
      return secretEgal(req.headers.get("x-api-key"), env, "ONOFF_WEBHOOK_TOKEN");
    },
    lire: lireOnoff,
    async apres(e, r, d) {
      journaliser(d, "onoff", await suiteOnoff(e, r, d));
    },
  },
};
