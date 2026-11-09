// Les types de la téléphonie. Contrat partagé : le Poste, les routes de webhook et next.config.ts en dépendent ; on le change avec ses tests.
//
// Un adaptateur = un fournisseur (Onoff, Aircall, Ringover, un softphone, le téléphone). Il est rangé dans lib/telephonie/registre.ts.
// Règles pour tout adaptateur :
//   - aucun module Node (« node:* ») et aucun accès au DOM au chargement du module : le registre est importé par le navigateur (le Poste),
//     par next.config.ts (la Permissions-Policy, au build) et par les routes de webhook (serveur) ;
//   - la vérification d'un webhook passe par Web Crypto (lib/integrations/base.ts) ;
//   - le journal ne porte que des codes : jamais un numéro, un e-mail, une URL ni un secret.

import type { Env, Journal, Rpc } from "../integrations/base";

export const FOURNISSEURS_TELEPHONIE = ["onoff", "aircall", "ringover", "softphone", "telephone"] as const;
export type FournisseurTelephonie = (typeof FOURNISSEURS_TELEPHONIE)[number];
/** Le nom court du plan (section 5.1). */
export type Fournisseur = FournisseurTelephonie;

export const MODES_TELEPHONIE = ["extension", "iframe", "api", "lien"] as const;
export type ModeTelephonie = (typeof MODES_TELEPHONIE)[number];

/** Les modes possibles pour chaque fournisseur : config/schema.ts refuse les autres. */
export const MODES_PAR_FOURNISSEUR: Readonly<Record<FournisseurTelephonie, readonly ModeTelephonie[]>> = {
  onoff: ["extension"],
  aircall: ["iframe"],
  ringover: ["iframe"], // seul le téléphone embarqué (iframe) est livré ; extension et API de rappel : pas encore
  softphone: ["lien"],
  telephone: ["lien"],
};

/** Les fournisseurs qui peuvent envoyer l'enregistrement d'un appel (webhook). */
export const FOURNISSEURS_AVEC_ENREGISTREMENT: readonly FournisseurTelephonie[] = ["onoff", "aircall", "ringover"];

export const SCHEMAS_LIEN = ["tel", "callto", "sip"] as const;
export type SchemaLien = (typeof SCHEMAS_LIEN)[number];

// ---------------------------------------------------------------------------------------------------------------------------------
// Navigateur
// ---------------------------------------------------------------------------------------------------------------------------------

export type EtatTelephone = "pret" | "attente" | "indisponible";
export type ResultatAppel = "lance" | "repli_tel" | "copie";

export interface ContexteAppel {
  leadId: string;
}

export interface ClientTelephonie {
  /** Monte l'iframe ou observe l'extension dans `el` ; renvoie la fonction de démontage. */
  preparer(el: HTMLElement): () => void;
  etat(): EtatTelephone;
  /** Lance l'appel vers un numéro E.164 (« +33… ») : « lance » (le fournisseur appelle), « repli_tel » (lien tel: ouvert), « copie ». */
  appeler(e164: string, ctx: ContexteAppel): Promise<ResultatAppel>;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Événements d'appel (serveur)
// ---------------------------------------------------------------------------------------------------------------------------------

export const STATUTS_APPEL = ["repondu", "sans_reponse", "occupe", "messagerie", "faux_numero", "inconnu"] as const;
export type StatutAppel = (typeof STATUTS_APPEL)[number];

export const DIRECTIONS_APPEL = ["sortant", "entrant"] as const;
export type DirectionAppel = (typeof DIRECTIONS_APPEL)[number];

/**
 * Un événement d'appel normalisé, envoyé tel quel à la fonction SQL evenement_appel(p_evenement jsonb). La base lit les clés de
 * CHAMPS_EVENEMENT_APPEL (une clé en plus est ignorée). Idempotent : un même externeId met à jour la même ligne de `appels`.
 */
export interface EvenementAppel {
  fournisseur: FournisseurTelephonie;
  /** Identifiant de l'appel chez le fournisseur, en texte (^[A-Za-z0-9_.:-]{1,80}$) : le même pour tous les événements d'un appel. */
  externeId: string;
  direction: DirectionAppel;
  /** « inconnu » n'écrase jamais un statut connu. */
  statut: StatutAppel;
  /** ISO 8601 (entre 2000 et 2100), ou null : toute autre valeur compte pour absente. */
  debut: string | null;
  fin: string | null;
  dureeS: number | null;
  /** Le numéro du prospect en E.164 : la fiche est retrouvée par ses 9 derniers chiffres. */
  numeroExterne: string | null;
  /** L'e-mail du membre chez le fournisseur : l'appelant est retrouvé par profiles.email_telephonie ou profiles.email (un seul compte). */
  emailAppelant: string | null;
  /** Vrai si le fournisseur a joué lui-même une annonce d'enregistrement au prospect. */
  annonceJouee: boolean;
  /** URL temporaire de l'audio chez le fournisseur, pour apres() : jamais lue ni gardée par la base. */
  urlEnregistrement: string | null;
}

/** Les clés lues par evenement_appel (tests/telephonie.test.mjs vérifie qu'elles figurent dans la migration). */
export const CHAMPS_EVENEMENT_APPEL = [
  "fournisseur",
  "externeId",
  "direction",
  "statut",
  "debut",
  "fin",
  "dureeS",
  "numeroExterne",
  "emailAppelant",
  "annonceJouee",
] as const satisfies readonly (keyof EvenementAppel)[];

/** La réponse de evenement_appel (jsonb, clés en camelCase). */
export interface ResultatEvenementAppel {
  id: string;
  workspaceId: string;
  leadId: string | null;
  appelantId: string | null;
  nouveau: boolean;
  /**
   * Vrai seulement si l'enregistrement est activé (reglages.enregistrement_complet) ET l'annonce faite pour CET appel : jouée par le
   * fournisseur (annonceJouee), ou lue au Poste par CET appelant pendant CET appel (une activité « annonce », horodatée par la base,
   * rattachée à un seul appel). Un appel dont l'appelant n'est pas reconnu (emailAppelant) n'est jamais conservable.
   */
  conserverAudio: boolean;
}

/** Une ligne de transcription : appels.transcription est un tableau de ces lignes. `t` : secondes depuis le début de l'appel. */
export interface LigneTranscription {
  t: number;
  locuteur: "appelant" | "prospect" | "inconnu";
  texte: string;
}

/** Les fonctions SQL de la téléphonie (clé service seule). */
export const FONCTIONS_SQL_TELEPHONIE = {
  evenement: "evenement_appel",
  enregistrement: "enregistrement_appel",
  transcription: "transcription_appel",
} as const;

/** Le bucket privé des enregistrements ; chemin d'un audio : <workspace_id>/<fournisseur>/<externeId>.<ext>. */
export const BUCKET_ENREGISTREMENTS = "enregistrements";

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook (serveur) : route app/api/telephonie/[fournisseur]/webhook
// ---------------------------------------------------------------------------------------------------------------------------------

/** Ce que la route donne à apres() (injecté : testable sans réseau). */
export interface Dependances {
  env: Env;
  /** Le client de la base (clé service), créé à la demande. */
  base: () => Rpc;
  journal: Journal;
  fetch: typeof fetch;
  /** Dépose un audio dans le bucket privé « enregistrements » (clé service). */
  deposer: (chemin: string, octets: Uint8Array, mime: string) => Promise<{ ok: boolean; code?: string }>;
  /** Horloge en millisecondes. */
  maintenant: () => number;
  attendre: (ms: number) => Promise<void>;
}

export interface WebhookTelephonie {
  /** Les NOMS des variables d'environnement nécessaires (jamais leurs valeurs) : /api/sante dit seulement si elles sont présentes. */
  variables: readonly string[];
  /** Vrai si la requête vient bien du fournisseur (jeton comparé en temps constant, ou signature par Web Crypto). */
  verifier(req: Request, corps: Uint8Array, env: Env): boolean | Promise<boolean>;
  /** Le corps JSON lu, ramené à des événements normalisés (tableau vide si rien d'utile). */
  lire(corps: unknown): EvenementAppel[];
  /**
   * Après la réponse 200 (after() de next/server) : audio, transcription. Ne télécharge rien si r.conserverAudio est faux ; si
   * enregistrement_appel refuse un audio déjà déposé, le fichier est effacé du bucket.
   */
  apres?(e: EvenementAppel, r: ResultatEvenementAppel, d: Dependances): Promise<void>;
}

export interface AdaptateurTelephonie {
  id: FournisseurTelephonie;
  libelle: string;
  /** Vrai tant que l'adaptateur n'a pas été testé sur un vrai compte (Ringover). */
  experimental?: boolean;
  /** Les origines qui ont droit au micro (Permissions-Policy) : « https://hote » ou « chrome-extension://<32 lettres a-p> ». */
  originesMicro: readonly string[];
  client: ClientTelephonie;
  webhook?: WebhookTelephonie;
}

export type RegistreTelephonie = Partial<Record<FournisseurTelephonie, AdaptateurTelephonie>>;
