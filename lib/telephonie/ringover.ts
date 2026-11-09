// L'adaptateur Ringover (mode « iframe ») : EXPÉRIMENTAL, jamais testé sur un vrai compte. Écrit d'après la documentation publique de
// Ringover et ses deux dépôts publics (le SDK du téléphone embarqué, ringover-sdk 1.1.3, et les exemples de webhooks), lus le
// 9 nov. 2026.
//
// POURQUOI L'IFRAME. Ringover propose trois chemins : son téléphone embarqué (iframe app.ringover.com, piloté par postMessage), son
// extension Chrome, ou l'API de rappel (callback). L'iframe est documentée et publique (ringover-sdk), elle ne demande aucune clé côté
// serveur pour appeler (l'appelant se connecte DANS l'iframe), elle n'ouvre aucune route capable de lancer un appel (rien d'automatique)
// et elle suit le même chemin qu'Aircall. L'extension ne publie ni son comportement ni son identifiant ; l'API de rappel exigerait une
// clé d'écriture sur le serveur et sonne d'abord chez l'appelant.
//
// APPELER. Iframe https://app.ringover.com. Elle demande « checkSDK » : on répond « presenceSDK » avec notre origine. « dialerReady » ou
// « login » : prêt ; « logout » : en attente. appeler() envoie { action: "dial", number } (sans accusé de réception). Les événements
// ringingCall, answeredCall et hangupCall sont relayés au Poste (« telephonie:appel »).
//
// WEBHOOK. Dashboard Ringover › Développeur › Webhooks. Les exemples publics de Ringover ne s'accordent pas sur la signature (un jeton
// signé dans un en-tête pour l'un, une empreinte du corps dans un autre en-tête pour l'autre) : on n'en dépend pas. Le secret est dans
// l'URL (?secret=…, RINGOVER_WEBHOOK_SECRET, 24 caractères au moins), comparé en temps constant. Événements : resource « call »
// (ringing, answered, hangup, missed, voicemail) et resource « aftercall » (record_available : le lien de l'enregistrement).
// Les numéros arrivent en chiffres, indicatif compris, sans « + » (« 33199000101 ») ; les dates en secondes Unix.

import {
  conserverEnregistrement,
  journaliser,
  lireEtatRecuperation,
  type AppelCible,
} from "./audio";
import { estE164, normaliserE164 } from "./e164";
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
import { emailOuNull, entierBorne, idExterne, isoOuNull, objet, secretEgal, texte, urlHttps } from "./outils";
import type {
  AdaptateurTelephonie,
  ClientTelephonie,
  Dependances,
  DirectionAppel,
  EtatTelephone,
  EvenementAppel,
  ResultatEvenementAppel,
  StatutAppel,
} from "./types";

export const ORIGINE_RINGOVER = "https://app.ringover.com";
export const PERMISSIONS_RINGOVER = ["microphone", "autoplay", "clipboard-read", "clipboard-write"] as const;
/** Le paramètre d'URL qui porte le secret du webhook. */
export const PARAMETRE_SECRET_RINGOVER = "secret";

const MESSAGE_NUMERO_ILLISIBLE = "Numéro illisible : il faut un numéro au format international (+33…).";

// ---------------------------------------------------------------------------------------------------------------------------------
// Navigateur : le téléphone en iframe
// ---------------------------------------------------------------------------------------------------------------------------------

function directionSdk(v: unknown): DirectionAppel | null {
  return v === "in" ? "entrant" : v === "out" ? "sortant" : null;
}

export function creerClientRingover(): ClientTelephonie {
  let el: HTMLElement | null = null;
  let iframe: IframeMontee | null = null;
  let generation = 0;
  let etat: EtatTelephone = "attente";
  let leadEnCours: string | null = null;

  const changer = (nouvel: EtatTelephone) => {
    if (nouvel === etat) return;
    etat = nouvel;
    signaler(el, EVENEMENT_ETAT, nouvel);
  };

  const appel = (etatAppel: SignalAppel["etat"], data: Record<string, unknown>) => {
    const direction = directionSdk(data.direction);
    signaler(el, EVENEMENT_APPEL, {
      etat: etatAppel,
      direction,
      dureeS: etatAppel === "termine" ? entierBorne(data.callDuration, 0, 86_400) : null,
      externeId: idExterne(data.call_id),
      leadId: direction === "entrant" ? null : leadEnCours,
    });
    if (etatAppel === "termine") leadEnCours = null;
  };

  const surMessage = (brut: unknown) => {
    const o = objet(brut);
    const data = objet(o.data);
    switch (o.action) {
      case "checkSDK":
        iframe?.envoyer({ action: "presenceSDK", location: fenetreDe(el)?.location?.origin ?? null });
        break;
      case "dialerReady":
      case "login":
        changer("pret");
        break;
      case "logout":
        changer("attente");
        break;
      case "ringingCall":
        appel("sonne", data);
        break;
      case "answeredCall":
        appel("decroche", data);
        break;
      case "hangupCall":
        appel("termine", data);
        break;
      default:
        break;
    }
  };

  const demonter = () => {
    iframe?.demonter();
    iframe = null;
    el = null;
    etat = "attente";
    leadEnCours = null;
  };

  return {
    preparer(nouvel) {
      demonter();
      const moi = ++generation;
      el = nouvel;
      iframe = monterIframe(nouvel, { src: ORIGINE_RINGOVER, origines: [ORIGINE_RINGOVER], permissions: PERMISSIONS_RINGOVER, titre: "Téléphone Ringover" }, surMessage);
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
      if (etat === "pret" && iframe?.envoyer({ action: "dial", number: e164 })) {
        leadEnCours = ctx.leadId;
        return "lance";
      }
      if (await copierTexte(e164, fenetreDe(el))) return "copie";
      throw new Error("Le téléphone Ringover n'est pas prêt : connecte-toi dans le téléphone du Poste, puis réessaie.");
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook : lecture
// ---------------------------------------------------------------------------------------------------------------------------------

/** Un numéro de Ringover (« 33199000101 », indicatif compris, sans « + ») -> E.164, ou null. */
export function numeroRingover(v: unknown): string | null {
  const t = typeof v === "number" ? String(v) : texte(v, 40);
  if (!t) return null;
  const c = t.replace(/[\s.()/-]/g, "");
  if (/^[1-9]\d{6,14}$/.test(c)) return normaliserE164(`+${c}`);
  return normaliserE164(c);
}

const STATUTS_EVENEMENT_RINGOVER: Readonly<Record<string, StatutAppel>> = {
  ringing: "inconnu",
  answered: "repondu",
  // « Appel terminé » ne dit pas si le prospect a décroché : « answered » le dit. « inconnu » n'écrase jamais un statut connu.
  hangup: "inconnu",
  missed: "sans_reponse",
  voicemail: "messagerie",
};

/** Un corps Ringover -> zéro ou un événement (une ressource ou un événement non suivi, ou sans identifiant d'appel : rien). */
export function lireRingover(corps: unknown): EvenementAppel[] {
  const o = objet(corps);
  const data = objet(o.data);
  const externeId = idExterne(data.call_id);
  if (!externeId) return [];
  const evenement = texte(o.event, 40);
  if (o.resource === "aftercall") {
    if (evenement !== "record_available") return [];
    const url = urlHttps(data.record_link);
    if (!url) return [];
    return [
      {
        fournisseur: "ringover",
        externeId,
        direction: "sortant",
        statut: "inconnu",
        debut: null,
        fin: null,
        dureeS: null,
        numeroExterne: null,
        emailAppelant: null,
        annonceJouee: false,
        urlEnregistrement: url,
      },
    ];
  }
  if (o.resource !== "call" || evenement === null || !Object.hasOwn(STATUTS_EVENEMENT_RINGOVER, evenement)) return [];
  const entrant = data.direction === "inbound";
  return [
    {
      fournisseur: "ringover",
      externeId,
      direction: entrant ? "entrant" : "sortant",
      statut: STATUTS_EVENEMENT_RINGOVER[evenement] ?? "inconnu",
      debut: isoOuNull(data.start_time),
      fin: isoOuNull(data.hangup_time),
      dureeS: entierBorne(data.duration_in_seconds, 0, 86_400),
      numeroExterne: numeroRingover(entrant ? data.from_number : data.to_number),
      emailAppelant: emailOuNull(objet(data.user).email),
      annonceJouee: false,
      urlEnregistrement: evenement === "hangup" ? urlHttps(data.record) : null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Webhook : après la réponse
// ---------------------------------------------------------------------------------------------------------------------------------

/** Après la réponse 200, et seulement si la base a dit conserverAudio : l'audio dont l'événement porte le lien. Pas d'API : pas de reprise. */
export async function suiteRingover(e: EvenementAppel, r: ResultatEvenementAppel, d: Dependances): Promise<string[]> {
  if (!r.conserverAudio) return ["audio_ignore"];
  if (!e.urlEnregistrement) return ["rien_a_recuperer"];
  const cible: AppelCible = { fournisseur: "ringover", externeId: e.externeId, workspaceId: r.workspaceId };
  const etat = await lireEtatRecuperation(cible, false, d);
  if ("code" in etat) return [etat.code];
  if (!etat.conserverAudio) return ["audio_ignore"];
  if (etat.aEnregistrement) return ["audio_deja_la"];
  return [await conserverEnregistrement(cible, e.urlEnregistrement, d, "mp3")];
}

export const ringover: AdaptateurTelephonie = {
  id: "ringover",
  libelle: "Ringover (téléphone dans le Poste, expérimental)",
  experimental: true,
  originesMicro: [ORIGINE_RINGOVER],
  client: creerClientRingover(),
  webhook: {
    variables: ["RINGOVER_WEBHOOK_SECRET"],
    verifier(req, _corps, env) {
      let secret: string | null = null;
      try {
        secret = new URL(req.url).searchParams.get(PARAMETRE_SECRET_RINGOVER);
      } catch {
        secret = null;
      }
      return secretEgal(secret, env, "RINGOVER_WEBHOOK_SECRET");
    },
    lire: lireRingover,
    async apres(e, r, d) {
      journaliser(d, "ringover", await suiteRingover(e, r, d));
    },
  },
};
