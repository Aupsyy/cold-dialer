// L'enregistrement et la transcription d'un appel, côté SERVEUR (apres() des webhooks, reprise différée) : téléchargement borné de
// l'audio chez le fournisseur, dépôt dans le bucket privé, enregistrement_appel, transcription_appel. Tout est injecté (Dependances :
// base, fetch, dépôt, horloge) : testé sans réseau. Le journal ne reçoit que des codes.
//
// CADRE LÉGAL (non négociable) : la base décide. Rien n'est téléchargé si evenement_appel a répondu conserverAudio: false ; et si
// enregistrement_appel refuse un audio déjà déposé (réglage coupé entre-temps, chemin refusé), le fichier est EFFACÉ du bucket aussitôt.

import { effacerDuStockage } from "./stockage";
import { codeSur, lireFluxBorne, objet, RE_EXTERNE_ID, texte, urlHttps } from "./outils";
import {
  FONCTIONS_SQL_TELEPHONIE,
  type Dependances,
  type FournisseurTelephonie,
  type LigneTranscription,
  type ResultatEvenementAppel,
} from "./types";

export const TAILLE_MAX_AUDIO = 25 * 1024 * 1024;
export const DELAI_TELECHARGEMENT_MS = 20_000;
export const DELAI_API_MS = 8_000;
/** Au-delà, une transcription n'est pas envoyée à la base (la base refuse au-delà de 5 000 lignes). */
export const MAX_LIGNES_TRANSCRIPTION = 5000;
/** Une suite (after()) ne dépasse pas ce budget : la route a 60 s au plus, et la reprise différée fera le reste. */
export const BUDGET_SUITE_MS = 45_000;

export type ExtensionAudio = "mp3" | "mp4" | "m4a" | "wav" | "ogg" | "webm";

export const MIME_AUDIO: Readonly<Record<ExtensionAudio, string>> = {
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

/** Les fournisseurs dont l'audio peut aller dans le bucket (la contrainte SQL du chemin). */
const FOURNISSEURS_AUDIO: readonly FournisseurTelephonie[] = ["onoff", "aircall", "ringover"];

/** Un appel désigné pour la base : fournisseur, identifiant chez lui, équipe. */
export interface AppelCible {
  fournisseur: FournisseurTelephonie;
  externeId: string;
  workspaceId: string;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La réponse de evenement_appel, lue sans rien supposer ; null si elle n'a pas la forme attendue. */
export function lireResultatEvenement(brut: unknown): ResultatEvenementAppel | null {
  const d = objet(brut);
  const id = texte(d.id, 60);
  const workspaceId = texte(d.workspaceId, 60);
  if (!id || !RE_UUID.test(id) || !workspaceId || !RE_UUID.test(workspaceId)) return null;
  const uuid = (v: unknown) => {
    const t = texte(v, 60);
    return t && RE_UUID.test(t) ? t : null;
  };
  return {
    id,
    workspaceId: workspaceId.toLowerCase(),
    leadId: uuid(d.leadId),
    appelantId: uuid(d.appelantId),
    nouveau: d.nouveau === true,
    conserverAudio: d.conserverAudio === true,
  };
}

export interface EtatRecuperation {
  existe: boolean;
  workspaceId: string | null;
  conserverAudio: boolean;
  aEnregistrement: boolean;
  aTranscription: boolean;
  tentatives: number;
  derniereTentative: string | null;
}

/** etat_recuperation_appel : où en est l'audio de cet appel. `compter` compte une tentative (la reprise différée en est bornée). */
export async function lireEtatRecuperation(
  c: { fournisseur: FournisseurTelephonie; externeId: string; workspaceId: string | null },
  compter: boolean,
  d: Pick<Dependances, "base">,
): Promise<EtatRecuperation | { code: string }> {
  try {
    const r = await d.base()("etat_recuperation_appel", {
      p_fournisseur: c.fournisseur,
      p_externe_id: c.externeId,
      p_compter: compter,
      p_workspace_id: c.workspaceId,
    });
    if (r.error) return { code: `etat_${codeSur(r.error.code, "base")}` };
    const o = objet(r.data);
    const ws = texte(o.workspaceId, 60);
    return {
      existe: o.existe === true,
      workspaceId: ws && RE_UUID.test(ws) ? ws.toLowerCase() : null,
      conserverAudio: o.conserverAudio === true,
      aEnregistrement: o.aEnregistrement === true,
      aTranscription: o.aTranscription === true,
      tentatives: typeof o.tentatives === "number" && Number.isFinite(o.tentatives) ? o.tentatives : 0,
      derniereTentative: texte(o.derniereTentative, 40),
    };
  } catch {
    return { code: "etat_base_injoignable" };
  }
}

/** L'extension du fichier d'après le type annoncé, puis l'URL ; sinon le repli du fournisseur. */
export function extensionAudio(mime: string | null, url: string | null, repli: ExtensionAudio): ExtensionAudio {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("m4a")) return "m4a";
  if (m.includes("mp4")) return "mp4";
  let chemin = "";
  try {
    chemin = url ? new URL(url).pathname.toLowerCase() : "";
  } catch {
    chemin = "";
  }
  for (const ext of ["mp3", "wav", "ogg", "webm", "m4a", "mp4"] as const) if (chemin.endsWith(`.${ext}`)) return ext;
  return repli;
}

/** Le chemin d'un audio dans le bucket (la forme exigée par la base), ou null. */
export function cheminEnregistrement(c: AppelCible, ext: ExtensionAudio): string | null {
  if (!RE_UUID.test(c.workspaceId) || !RE_EXTERNE_ID.test(c.externeId) || !FOURNISSEURS_AUDIO.includes(c.fournisseur)) return null;
  return `${c.workspaceId.toLowerCase()}/${c.fournisseur}/${c.externeId}.${ext}`;
}

/** Au plus 3 redirections, chacune vérifiée (une URL présignée passe souvent par une redirection). */
export const MAX_REDIRECTIONS = 3;

/** Une adresse de téléchargement : https, et un nom d'hôte public (ni adresse IP, ni « localhost », ni domaine interne). */
export function urlTelechargeable(v: unknown): string | null {
  const u = urlHttps(v);
  if (!u) return null;
  try {
    const hote = new URL(u).hostname.toLowerCase();
    if (hote === "localhost" || /\.(localhost|local|internal|lan)$/.test(hote)) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || hote.startsWith("[") || hote.includes(":") || !hote.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

/** Télécharge un audio : https seulement (redirections comprises), 25 Mo et 20 s au plus par étape. */
export async function telechargerAudio(
  url: string,
  d: Pick<Dependances, "fetch">,
  repli: ExtensionAudio,
): Promise<{ ok: true; octets: Uint8Array; ext: ExtensionAudio } | { ok: false; code: string }> {
  let adresse = urlTelechargeable(url);
  if (!adresse) return { ok: false, code: "url_refusee" };
  let r: Response | null = null;
  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut += 1) {
    try {
      r = await d.fetch(adresse, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(DELAI_TELECHARGEMENT_MS) });
    } catch {
      return { ok: false, code: "telechargement_reseau" };
    }
    if (r.status < 300 || r.status >= 400) break;
    await r.body?.cancel().catch(() => undefined);
    let suivante: string | null = null;
    try {
      suivante = urlTelechargeable(new URL(r.headers.get("location") ?? "", adresse).href);
    } catch {
      suivante = null;
    }
    if (!suivante || saut === MAX_REDIRECTIONS) return { ok: false, code: "redirection_refusee" };
    adresse = suivante;
  }
  if (!r) return { ok: false, code: "telechargement_reseau" };
  if (!r.ok) {
    await r.body?.cancel().catch(() => undefined);
    return { ok: false, code: `telechargement_${r.status}` };
  }
  const annonce = Number(r.headers.get("content-length") ?? "");
  if (Number.isFinite(annonce) && annonce > TAILLE_MAX_AUDIO) {
    await r.body?.cancel().catch(() => undefined);
    return { ok: false, code: "audio_trop_gros" };
  }
  const octets = await lireFluxBorne(r.body, TAILLE_MAX_AUDIO);
  if (octets === "trop_gros") return { ok: false, code: "audio_trop_gros" };
  if (octets === "illisible" || octets.byteLength === 0) return { ok: false, code: "audio_illisible" };
  return { ok: true, octets, ext: extensionAudio(r.headers.get("content-type"), adresse, repli) };
}

/**
 * L'audio d'un appel : téléchargé, déposé, noté par enregistrement_appel. Si la base refuse (ou ne répond pas), le fichier déposé est
 * effacé. Renvoie un code pour le journal : « audio_garde », « audio_refuse_<raison> », « telechargement_404 »…
 */
export async function conserverEnregistrement(c: AppelCible, url: string, d: Dependances, repli: ExtensionAudio): Promise<string> {
  const t = await telechargerAudio(url, d, repli);
  if (!t.ok) return t.code;
  const chemin = cheminEnregistrement(c, t.ext);
  if (!chemin) return "chemin_illisible";
  let depot: { ok: boolean; code?: string };
  try {
    depot = await d.deposer(chemin, t.octets, MIME_AUDIO[t.ext]);
  } catch {
    depot = { ok: false, code: "exception" };
  }
  if (!depot.ok) return `depot_${codeSur(depot.code, "refuse")}`;
  let raison = "base";
  try {
    const r = await d.base()(FONCTIONS_SQL_TELEPHONIE.enregistrement, {
      p_fournisseur: c.fournisseur,
      p_externe_id: c.externeId,
      p_chemin: chemin,
      p_workspace_id: c.workspaceId,
    });
    if (!r.error) {
      const data = objet(r.data);
      if (data.garde === true) return "audio_garde";
      raison = codeSur(data.raison, "refuse");
    }
  } catch {
    raison = "base_injoignable";
  }
  const effacement = await effacerDuStockage(chemin, d.env, d.fetch);
  return `audio_refuse_${raison}${effacement.ok ? "" : "_non_efface"}`;
}

/** La transcription (et le résumé) d'un appel, envoyés à transcription_appel : la base les garde seulement si l'appel est conservable. */
export async function conserverTranscription(
  c: AppelCible,
  lignes: readonly LigneTranscription[],
  resume: string | null,
  d: Pick<Dependances, "base">,
): Promise<string> {
  if (lignes.length === 0 && !resume) return "transcription_vide";
  try {
    const r = await d.base()(FONCTIONS_SQL_TELEPHONIE.transcription, {
      p_fournisseur: c.fournisseur,
      p_externe_id: c.externeId,
      p_lignes: lignes.slice(0, MAX_LIGNES_TRANSCRIPTION),
      p_resume: resume,
      p_workspace_id: c.workspaceId,
    });
    if (r.error) return `transcription_${codeSur(r.error.code, "base")}`;
    const data = objet(r.data);
    return data.garde === true ? "transcription_gardee" : `transcription_refusee_${codeSur(data.raison, "refuse")}`;
  } catch {
    return "transcription_base_injoignable";
  }
}

/** Écrit les codes d'une suite au journal, préfixés par le fournisseur (« onoff:audio_garde,transcription_gardee »). */
export function journaliser(d: Pick<Dependances, "journal">, fournisseur: FournisseurTelephonie, codes: readonly string[]): void {
  const grave = codes.some((c) => /reseau|injoignable|non_efface|exception|base$/.test(c));
  d.journal(`${fournisseur}:${codes.join(",") || "rien"}`, grave);
}

/** Une transcription lue chez le fournisseur, prête pour transcription_appel. */
export interface TranscriptionLue {
  lignes: LigneTranscription[];
  resume: string | null;
}

/** Ce qu'un fournisseur sait retrouver par son API après coup : la reprise différée (recuperation.ts) s'en sert. */
export interface Recuperateur {
  /** Les variables de son API (facultatives pour le webhook ; sans elles, pas de reprise). */
  variables: readonly string[];
  /** L'extension de l'audio quand ni le type ni l'URL ne la disent. */
  extension: ExtensionAudio;
  urlEnregistrement(externeId: string, d: Dependances): Promise<{ url: string } | { code: string }>;
  transcription?(externeId: string, d: Dependances): Promise<TranscriptionLue | { code: string }>;
}
