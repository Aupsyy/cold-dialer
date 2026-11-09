// L'adaptateur Aircall (mode « iframe »).
//
// APPELER. Le téléphone Aircall est une iframe (workspace.aircall.io) montée dans l'élément du Poste. On lui parle par postMessage, avec
// le protocole de la bibliothèque officielle « aircall-everywhere » (version 2.0.6, licence ISC), réécrit ici en quelques lignes pour ne
// pas ajouter de dépendance, et en plus strict : un message n'est lu que s'il vient de CETTE iframe et d'une origine Aircall.
//   - l'iframe envoie « apm_phone_loaded » quand l'appelant est connecté (il se connecte DANS l'iframe, à chaque session) : on répond
//     « apm_app_isready » et l'état passe à « pret » ; « apm_phone_logout » le remet en « attente » ;
//   - appeler() envoie « apm_app_dial_number » { phone_number } et attend « apm_phone_dial_number_response » (2 s) ;
//   - les événements du téléphone (outgoing_call, outgoing_answered, call_ended…) sont relayés au Poste (« telephonie:appel »).
//
// WEBHOOK. Le jeton est DANS le corps (champ token), comparé en temps constant à AIRCALL_WEBHOOK_TOKEN (c'est Aircall qui le crée et
// l'affiche à la création du webhook). Événements suivis : call.created, call.answered, call.hungup, call.ended,
// call.comm_assets_generated (l'enregistrement est prêt) et transcription.created (la transcription se lit ensuite par l'API).
// API (facultative) : https://api.aircall.io/v1, en Basic AIRCALL_API_ID:AIRCALL_API_TOKEN (transcription, reprise de l'audio).

import { valeurEnv } from "../integrations/base";
import {
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
import { estE164, numeroRecu } from "./e164";
import {
  EVENEMENT_APPEL,
  EVENEMENT_ETAT,
  copierTexte,
  fenetreDe,
  monterIframe,
  signaler,
  type IframeMontee,
  type SignalAppel,
} from "./navigateur";
import { analyserJson, emailOuNull, entierBorne, idExterne, isoOuNull, nettoyerTexte, objet, secondesDepuis, secretEgal, texte, urlHttps } from "./outils";
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

export const ORIGINES_AIRCALL = ["https://workspace.aircall.io", "https://phone.aircall.io"] as const;
/** L'adresse chargée par aircall-everywhere 2.0.6 (intégration « generic »). */
export const URL_TELEPHONE_AIRCALL = "https://workspace.aircall.io?integration=generic";
/** Les permissions de l'iframe (celles de la bibliothèque officielle). */
export const PERMISSIONS_AIRCALL = ["microphone", "autoplay", "clipboard-read", "clipboard-write", "hid"] as const;
/** Le délai de réponse de l'iframe à un ordre (celui de la bibliothèque officielle). */
export const DELAI_REPONSE_AIRCALL_MS = 2000;
export const URL_API_AIRCALL = "https://api.aircall.io/v1";

export const EVENEMENTS_AIRCALL = [
  "call.created",
  "call.answered",
  "call.hungup",
  "call.ended",
  "call.comm_assets_generated",
  "transcription.created",
] as const;
type EvenementAircall = (typeof EVENEMENTS_AIRCALL)[number];

const MESSAGE_NUMERO_ILLISIBLE = "Numéro illisible : il faut un numéro au format international (+33…).";

// ---------------------------------------------------------------------------------------------------------------------------------
// Navigateur : le téléphone en iframe
// ---------------------------------------------------------------------------------------------------------------------------------

export interface OptionsClientAircall {
  delaiReponseMs?: number;
}

interface ReponseOrdre {
  success: boolean;
  errorCode: string | null;
}

function lireReponse(v: unknown): ReponseOrdre {
  const o = objet(v);
  return { success: o.success === true, errorCode: texte(o.errorCode, 40) };
}

export function creerClientAircall(options: OptionsClientAircall = {}): ClientTelephonie {
  const delaiReponse = options.delaiReponseMs ?? DELAI_REPONSE_AIRCALL_MS;
  let el: HTMLElement | null = null;
  let iframe: IframeMontee | null = null;
  let generation = 0;
  let etat: EtatTelephone = "attente";
  let leadEnCours: string | null = null;
  const attentes = new Map<string, (r: ReponseOrdre) => void>();

  const changer = (nouvel: EtatTelephone) => {
    if (nouvel === etat) return;
    etat = nouvel;
    signaler(el, EVENEMENT_ETAT, nouvel);
  };

  const appel = (s: Omit<SignalAppel, "leadId">, entrant: boolean) => {
    signaler(el, EVENEMENT_APPEL, { ...s, leadId: entrant ? null : leadEnCours });
    if (s.etat === "termine") leadEnCours = null;
  };

  const surMessage = (data: unknown) => {
    const o = objet(data);
    const nom = typeof o.name === "string" ? o.name : "";
    if (!nom.startsWith("apm_phone_")) return;
    const evenement = nom.slice("apm_phone_".length);
    const v = objet(o.value);
    const id = idExterne(v.call_id);
    if (evenement.endsWith("_response")) {
      const attente = attentes.get(evenement);
      if (attente) {
        attentes.delete(evenement);
        attente(lireReponse(o.value));
      }
      return;
    }
    switch (evenement) {
      case "loaded":
        iframe?.envoyer({ name: "apm_app_isready" });
        changer("pret");
        break;
      case "logout":
        changer("attente");
        break;
      case "outgoing_call":
        appel({ etat: "sonne", direction: "sortant", dureeS: null, externeId: id }, false);
        break;
      case "incoming_call":
        appel({ etat: "sonne", direction: "entrant", dureeS: null, externeId: id }, true);
        break;
      case "outgoing_answered":
        appel({ etat: "decroche", direction: "sortant", dureeS: null, externeId: id }, false);
        break;
      case "call_end_ringtone":
        appel(
          v.answer_status === "answered"
            ? { etat: "decroche", direction: "entrant", dureeS: null, externeId: id }
            : { etat: "termine", direction: "entrant", dureeS: null, externeId: id },
          true,
        );
        break;
      case "call_ended":
        appel({ etat: "termine", direction: null, dureeS: entierBorne(v.duration, 0, 86_400), externeId: id }, false);
        break;
      default:
        break;
    }
  };

  /** Un ordre au téléphone, et sa réponse (ou « no_answer » au bout du délai, comme la bibliothèque officielle). */
  const ordonner = (evenement: string, valeur: unknown): Promise<ReponseOrdre> =>
    new Promise((resolve) => {
      const f = fenetreDe(el);
      if (!iframe || !f) {
        resolve({ success: false, errorCode: "not_ready" });
        return;
      }
      const cle = `${evenement}_response`;
      const minuterie = f.setTimeout(() => {
        attentes.delete(cle);
        resolve({ success: false, errorCode: "no_answer" });
      }, delaiReponse);
      attentes.set(cle, (r) => {
        f.clearTimeout(minuterie);
        resolve(r);
      });
      if (!iframe.envoyer({ name: `apm_app_${evenement}`, value: valeur })) {
        f.clearTimeout(minuterie);
        attentes.delete(cle);
        resolve({ success: false, errorCode: "not_ready" });
      }
    });

  const demonter = () => {
    iframe?.demonter();
    iframe = null;
    for (const [cle, attente] of attentes) {
      attentes.delete(cle);
      attente({ success: false, errorCode: "not_ready" });
    }
    el = null;
    etat = "attente";
    leadEnCours = null;
  };

  return {
    preparer(nouvel) {
      demonter();
      const moi = ++generation;
      el = nouvel;
      iframe = monterIframe(nouvel, { src: URL_TELEPHONE_AIRCALL, origines: ORIGINES_AIRCALL, permissions: PERMISSIONS_AIRCALL, titre: "Téléphone Aircall" }, surMessage);
      etat = iframe ? "attente" : "indisponible";
      signaler(el, EVENEMENT_ETAT, etat);
      return () => {
        if (moi === generation) demonter();
      };
    },

    etat() {
      return etat;
    },

    async appeler(e164, ctx) {
      if (!estE164(e164)) throw new Error(MESSAGE_NUMERO_ILLISIBLE);
      if (etat === "pret" && iframe) {
        const r = await ordonner("dial_number", { phone_number: e164 });
        if (r.success) {
          leadEnCours = ctx.leadId;
          return "lance";
        }
        if (r.errorCode === "in_call") throw new Error("Un appel est déjà en cours dans Aircall : termine-le avant d'en lancer un autre.");
      }
      if (await copierTexte(e164, fenetreDe(el))) return "copie";
      throw new Error("Le téléphone Aircall n'est pas prêt : connecte-toi dans le téléphone du Poste, puis réessaie.");
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook : lecture
// ---------------------------------------------------------------------------------------------------------------------------------

function typeEvenement(v: unknown): EvenementAircall | null {
  return typeof v === "string" && (EVENEMENTS_AIRCALL as readonly string[]).includes(v) ? (v as EvenementAircall) : null;
}

/** L'identifiant de l'appel : data.call_id, data.call.id, puis data.id pour un événement « call.* » (l'objet call lui-même). */
export function identifiantAppelAircall(data: Record<string, unknown>, type: EvenementAircall): string | null {
  return idExterne(data.call_id) ?? idExterne(objet(data.call).id) ?? (type.startsWith("call.") ? idExterne(data.id) : null);
}

/** Le statut d'après l'événement : « done » ne dit pas si l'appel a été décroché, seul answered_at le dit. */
export function statutAircall(type: EvenementAircall, data: Record<string, unknown>): StatutAppel {
  const decroche = isoOuNull(data.answered_at) !== null || data.status === "answered" || data.status === "answering";
  if (type === "call.answered") return "repondu";
  if (type === "call.created" || type === "transcription.created") return decroche ? "repondu" : "inconnu";
  if (urlHttps(data.voicemail)) return "messagerie";
  return decroche ? "repondu" : "sans_reponse";
}

/** Un corps Aircall -> zéro ou un événement (un type non suivi, ou sans identifiant d'appel : rien). */
export function lireAircall(corps: unknown): EvenementAppel[] {
  const o = objet(corps);
  const type = typeEvenement(o.event);
  if (!type) return [];
  const data = objet(o.data);
  const externeId = identifiantAppelAircall(data, type);
  if (!externeId) return [];
  if (type === "transcription.created") {
    // Un signal sans données d'appel : la suite lit la transcription par l'API (voir estSignalTranscription).
    return [
      {
        fournisseur: "aircall",
        externeId,
        direction: "sortant",
        statut: "inconnu",
        debut: null,
        fin: null,
        dureeS: null,
        numeroExterne: null,
        emailAppelant: null,
        annonceJouee: false,
        urlEnregistrement: null,
      },
    ];
  }
  const numero = texte(data.raw_digits, 40) ?? texte(objet(data.contact).phone_number, 40);
  return [
    {
      fournisseur: "aircall",
      externeId,
      direction: data.direction === "inbound" ? "entrant" : "sortant",
      statut: statutAircall(type, data),
      debut: isoOuNull(data.started_at),
      fin: isoOuNull(data.ended_at),
      dureeS: entierBorne(data.duration, 0, 86_400),
      numeroExterne: numeroRecu(numero),
      emailAppelant: emailOuNull(objet(data.user).email),
      annonceJouee: false,
      urlEnregistrement: urlHttps(data.recording) ?? urlHttps(data.asset),
    },
  ];
}

/** L'événement normalisé d'un « transcription.created » : ni début, ni fin, ni numéro, ni audio (un « call.* » a toujours started_at). */
export function estSignalTranscription(e: EvenementAppel): boolean {
  return e.fournisseur === "aircall" && e.debut === null && e.fin === null && e.numeroExterne === null && e.urlEnregistrement === null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// API Aircall (facultative)
// ---------------------------------------------------------------------------------------------------------------------------------

function base64(texteBrut: string): string {
  let binaire = "";
  for (const octet of new TextEncoder().encode(texteBrut)) binaire += String.fromCharCode(octet);
  return btoa(binaire);
}

/** L'en-tête Basic de l'API, ou null si une des deux clés manque. Sa valeur ne va jamais dans un journal. */
export function enteteBasicAircall(env: Dependances["env"]): string | null {
  const id = valeurEnv(env, "AIRCALL_API_ID");
  const jeton = valeurEnv(env, "AIRCALL_API_TOKEN");
  return id && jeton ? `Basic ${base64(`${id}:${jeton}`)}` : null;
}

async function appelerApiAircall(chemin: string, d: Pick<Dependances, "env" | "fetch">): Promise<{ statut: number; json: unknown }> {
  const basic = enteteBasicAircall(d.env);
  if (!basic) return { statut: 0, json: null };
  try {
    const r = await d.fetch(`${URL_API_AIRCALL}${chemin}`, {
      headers: { Authorization: basic, Accept: "application/json" },
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

/** Les phrases d'Aircall (internal = l'appelant, external = le prospect) -> des lignes { t (secondes), locuteur, texte }. */
export function lireTranscriptionAircall(json: unknown): TranscriptionLue {
  const racine = objet(json);
  const transcription = objet(racine.transcription ?? racine);
  const brutes = objet(transcription.content).utterances;
  const lignes: LigneTranscription[] = [];
  for (const b of Array.isArray(brutes) ? brutes.slice(0, MAX_LIGNES_TRANSCRIPTION) : []) {
    const u = objet(b);
    const t = nettoyerTexte(u.text);
    if (t === "") continue;
    const qui = texte(u.participant_type, 20);
    lignes.push({
      t: secondesDepuis(u.start_time) ?? 0,
      locuteur: qui === "internal" ? "appelant" : qui === "external" ? "prospect" : "inconnu",
      texte: t,
    });
  }
  lignes.sort((a, b) => a.t - b.t);
  return { lignes, resume: null };
}

/** La transcription par l'API (GET /v1/calls/{id}/transcription), ou un code. */
export async function transcriptionAircall(externeId: string, d: Pick<Dependances, "env" | "fetch">): Promise<TranscriptionLue | { code: string }> {
  const r = await appelerApiAircall(`/calls/${encodeURIComponent(externeId)}/transcription`, d);
  if (r.statut !== 200) return { code: codeApi(r.statut, "transcription_pas_prete") };
  const t = lireTranscriptionAircall(r.json);
  return t.lignes.length === 0 ? { code: "transcription_vide" } : t;
}

/** L'URL de l'audio par l'API (GET /v1/calls/{id} : call.recording), pour la reprise différée. */
export async function urlEnregistrementAircall(externeId: string, d: Pick<Dependances, "env" | "fetch">): Promise<{ url: string } | { code: string }> {
  const r = await appelerApiAircall(`/calls/${encodeURIComponent(externeId)}`, d);
  if (r.statut !== 200) return { code: codeApi(r.statut, "appel_introuvable") };
  const call = objet(objet(r.json).call);
  const url = urlHttps(call.recording) ?? urlHttps(call.asset);
  return url ? { url } : { code: "enregistrement_pas_pret" };
}

export const recuperateurAircall: Recuperateur = {
  variables: ["AIRCALL_API_ID", "AIRCALL_API_TOKEN"],
  extension: "mp3",
  urlEnregistrement: urlEnregistrementAircall,
  transcription: transcriptionAircall,
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook : après la réponse
// ---------------------------------------------------------------------------------------------------------------------------------

/** Après la réponse 200, et seulement si la base a dit conserverAudio : l'audio annoncé par l'événement, la transcription annoncée. */
export async function suiteAircall(e: EvenementAppel, r: ResultatEvenementAppel, d: Dependances): Promise<string[]> {
  if (!r.conserverAudio) return ["audio_ignore"];
  const transcription = estSignalTranscription(e);
  if (!e.urlEnregistrement && !transcription) return ["rien_a_recuperer"];
  const cible: AppelCible = { fournisseur: "aircall", externeId: e.externeId, workspaceId: r.workspaceId };
  const etat = await lireEtatRecuperation(cible, false, d);
  if ("code" in etat) return [etat.code];
  if (!etat.conserverAudio) return ["audio_ignore"];
  const codes: string[] = [];
  if (e.urlEnregistrement) codes.push(etat.aEnregistrement ? "audio_deja_la" : await conserverEnregistrement(cible, e.urlEnregistrement, d, "mp3"));
  if (transcription) {
    if (etat.aTranscription) codes.push("transcription_deja_la");
    else {
      const t = await transcriptionAircall(e.externeId, d);
      codes.push("code" in t ? t.code : await conserverTranscription(cible, t.lignes, t.resume, d));
    }
  }
  return codes;
}

export const aircall: AdaptateurTelephonie = {
  id: "aircall",
  libelle: "Aircall (téléphone dans le Poste)",
  originesMicro: [...ORIGINES_AIRCALL],
  client: creerClientAircall(),
  webhook: {
    variables: ["AIRCALL_WEBHOOK_TOKEN"],
    verifier(_req, corps, env) {
      return secretEgal(objet(analyserJson(corps)).token, env, "AIRCALL_WEBHOOK_TOKEN");
    },
    lire: lireAircall,
    async apres(e, r, d) {
      journaliser(d, "aircall", await suiteAircall(e, r, d));
    },
  },
};
