// L'adaptateur Calendly : le lien de réservation pré-rempli, et le webhook (offre PAYANTE de Calendly ; sur l'offre gratuite, le lien
// seul, puis le bouton « RDV pris » du Poste).
//
// Webhook : POST JSON { event, created_at, payload } ; payload = l'invité (InviteePayload de l'API v2 de Calendly). Signature dans
// l'en-tête « Calendly-Webhook-Signature: t=<horodatage>,v1=<hex> » : HMAC-SHA256 de « <t>.<corps brut> » avec la clé de signature
// (CALENDLY_WEBHOOK_SIGNING_KEY, choisie à la création de l'abonnement), horodatage à 3 minutes au plus de l'horloge.
//
//   invitee.created          → reserve (deplace si l'invité vient d'un report : old_invitee)
//   invitee.canceled         → annule (un report envoie aussi cette annulation pour l'ancien rendez-vous)
//   invitee_no_show.created  → issue no_show
//   autres événements        → ignorés
// rdvExterneId : l'identifiant de l'ÉVÉNEMENT Calendly (dernier segment de son URI « …/scheduled_events/<id> »). Un report crée un
// nouvel événement chez Calendly : l'ancien rendez-vous est annulé, le nouveau créé (deux lignes, l'historique reste juste).
// externeId : « <type d'événement>:<identifiant de l'invité> » (un renvoi du même événement est reconnu par la base).

import { egalTempsConstant, hmacSha256Hex, objet, valeurEnv } from "../integrations/base";
import {
  chaine,
  chemin,
  emailOuNull,
  idExterneOuNull,
  isoOuNull,
  lienHttpsOuNull,
  liste,
  segmentUri,
  telephoneOuNull,
  uuidOuNull,
} from "./lecture";
import { emailPourLien, identifiantPourLien, lienAvecParametres, lienNu, nomPourLien } from "./lien";
import type { AdaptateurAgenda, CanalRdv, EvenementRdv, TypeEvenementRdv } from "./types";

export const VARIABLE_CALENDLY = "CALENDLY_WEBHOOK_SIGNING_KEY";
export const ENTETE_CALENDLY = "calendly-webhook-signature";
export const TOLERANCE_CALENDLY_S = 180;
/** Les événements à cocher dans l'abonnement Calendly (docs/agenda.md). */
export const EVENEMENTS_CALENDLY = ["invitee.created", "invitee.canceled", "invitee_no_show.created"] as const;

/** L'en-tête de signature lu : l'horodatage et les signatures v1 (plusieurs pendant un changement de clé). */
export function lireSignatureCalendly(entete: string | null | undefined): { t: number; v1: string[] } | null {
  if (!entete || entete.length > 2000) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const morceau of entete.split(",")) {
    const i = morceau.indexOf("=");
    if (i <= 0) continue;
    const cle = morceau.slice(0, i).trim();
    const valeur = morceau.slice(i + 1).trim();
    if (cle === "t" && /^\d{1,12}$/.test(valeur)) t = Number(valeur);
    else if (cle === "v1" && /^[0-9a-f]{64}$/i.test(valeur)) v1.push(valeur.toLowerCase());
  }
  return t === null || v1.length === 0 ? null : { t, v1 };
}

/**
 * La clé de signature : 32 caractères au moins. Une clé courte se casserait hors ligne à partir d'une seule requête signée (HMAC) ; elle
 * est refusée comme une mauvaise signature, et l'installation (scripts/install/secrets.mjs) en tire une de 43 caractères.
 */
export const LONGUEUR_MIN_CLE_CALENDLY = 32;

/** Vrai si la signature est bonne ET récente (3 minutes au plus d'écart avec maintenantS, dans un sens comme dans l'autre). */
export async function signatureCalendlyValide(
  corps: Uint8Array,
  entete: string | null,
  secret: string,
  maintenantS: number,
): Promise<boolean> {
  if (secret.length < LONGUEUR_MIN_CLE_CALENDLY) return false;
  const s = lireSignatureCalendly(entete);
  if (!s || !Number.isFinite(maintenantS) || Math.abs(maintenantS - s.t) > TOLERANCE_CALENDLY_S) return false;
  const prefixe = new TextEncoder().encode(`${s.t}.`);
  const donnees = new Uint8Array(prefixe.length + corps.length);
  donnees.set(prefixe, 0);
  donnees.set(corps, prefixe.length);
  const attendue = await hmacSha256Hex(secret, donnees);
  let bonne = false;
  for (const v of s.v1) if (egalTempsConstant(v, attendue)) bonne = true;
  return bonne;
}

/** Le canal et le lien de visio d'après le lieu de l'événement Calendly. */
export function lieuCalendly(lieu: unknown): { canal: CanalRdv | null; lienVisio: string | null; telephone: string | null } {
  const o = objet(lieu);
  const type = chaine(o.type, 60) ?? "";
  const joinUrl = lienHttpsOuNull(o.join_url);
  const texteLieu = chaine(o.location, 300);
  if (/conference|^zoom$|gotomeeting|webex/.test(type)) return { canal: "visio", lienVisio: joinUrl, telephone: null };
  if (type === "outbound_call") return { canal: "telephone", lienVisio: null, telephone: telephoneOuNull(texteLieu) };
  if (type === "inbound_call") return { canal: "telephone", lienVisio: null, telephone: null };
  if (type === "physical") return { canal: "sur_place", lienVisio: null, telephone: null };
  const lien = joinUrl ?? lienHttpsOuNull(texteLieu);
  return lien ? { canal: "visio", lienVisio: lien, telephone: null } : { canal: null, lienVisio: null, telephone: null };
}

/** Le téléphone de l'invité : le numéro des rappels SMS, sinon la réponse à une question qui parle de téléphone. */
function telephoneInvite(p: Record<string, unknown>): string | null {
  const rappel = telephoneOuNull(p.text_reminder_number);
  if (rappel) return rappel;
  for (const qa of liste(p.questions_and_answers, 30)) {
    const o = objet(qa);
    if (/t[ée]l[ée]phone|phone|portable|mobile|num[ée]ro/i.test(chaine(o.question, 300) ?? "")) {
      const t = telephoneOuNull(o.answer);
      if (t) return t;
    }
  }
  return null;
}

/** Le nom de l'invité : name, sinon prénom et nom séparés. */
function nomInvite(p: Record<string, unknown>): string | null {
  const nom = chaine(p.name, 160);
  if (nom) return nom;
  const complet = [chaine(p.first_name, 80), chaine(p.last_name, 80)].filter(Boolean).join(" ").trim();
  return complet || null;
}

/** L'identifiant de l'événement Calendly : scheduled_event.uri, sinon event, sinon l'URI de l'invité (…/scheduled_events/<id>/invitees/…). */
function idEvenement(p: Record<string, unknown>): string | null {
  return (
    segmentUri(chemin(p, "scheduled_event.uri"), "scheduled_events") ??
    segmentUri(p.event, "scheduled_events") ??
    segmentUri(p.uri, "scheduled_events") ??
    segmentUri(p.invitee, "scheduled_events")
  );
}

/** Un envoi Calendly ramené aux événements de rendez-vous (0 ou 1). */
export function lireCalendly(corps: unknown): EvenementRdv[] {
  const json = objet(corps);
  const evenement = chaine(json.event, 60);
  const p = objet(json.payload);
  let type: TypeEvenementRdv;
  if (evenement === "invitee.created") type = chaine(p.old_invitee, 500) ? "deplace" : "reserve";
  else if (evenement === "invitee.canceled") type = "annule";
  else if (evenement === "invitee_no_show.created") type = "issue";
  else return [];

  const rdv = idExterneOuNull(idEvenement(p));
  // L'invité (pour un no-show : la marque de no-show, qui change si on la retire puis la remet) ; un renvoi garde le même identifiant.
  const idInvite =
    type === "issue"
      ? (segmentUri(chemin(p, "no_show.uri")) ?? segmentUri(p.uri) ?? segmentUri(p.invitee))
      : (segmentUri(p.uri) ?? segmentUri(p.invitee));
  if (!rdv || !idInvite) return [];
  const externeId = idExterneOuNull(`${evenement}:${idInvite}`);
  if (!externeId) return [];

  const lieu = lieuCalendly(chemin(p, "scheduled_event.location"));
  const hote = liste(chemin(p, "scheduled_event.event_memberships"), 10)
    .map((m) => emailOuNull(objet(m).user_email))
    .find((e): e is string => e !== null);
  return [
    {
      fournisseur: "calendly",
      type,
      externeId,
      rdvExterneId: rdv,
      debut: isoOuNull(chemin(p, "scheduled_event.start_time")),
      fin: isoOuNull(chemin(p, "scheduled_event.end_time")),
      issue: type === "issue" ? "no_show" : null,
      leadId: uuidOuNull(chemin(p, "tracking.utm_content")),
      email: emailOuNull(p.email),
      telephone: telephoneInvite(p) ?? lieu.telephone,
      nom: nomInvite(p),
      canal: lieu.canal,
      lienVisio: lieu.lienVisio,
      emailCloser: hote ?? null,
    },
  ];
}

export const calendly: AdaptateurAgenda = {
  id: "calendly",
  libelle: "Calendly",
  lienReservation(lead, config) {
    if (!config.prefill) return lienNu(config);
    return lienAvecParametres(config.lienReservation, [
      ["name", nomPourLien(lead)],
      ["email", emailPourLien(lead)],
      [config.champLead, identifiantPourLien(lead)],
    ]);
  },
  webhook: {
    variables: [VARIABLE_CALENDLY],
    verifier(req, corps, env, maintenantS) {
      return signatureCalendlyValide(corps, req.headers.get(ENTETE_CALENDLY), valeurEnv(env, VARIABLE_CALENDLY), maintenantS);
    },
    lire: lireCalendly,
  },
};
