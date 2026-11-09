// Le flux iCalendar d'un closer (/api/agenda/ics/<jeton>) : un fichier RFC 5545 auquel Google Agenda, Apple Calendrier ou Outlook
// s'abonnent (« ajouter un agenda par URL »). Google ne relit un flux qu'au bout de quelques heures : ce n'est pas du temps réel.
//
//   - evenementsDepuisFlux(flux, options) : la réponse de agenda_flux(p_jeton) en événements. Titre : le nom du rendez-vous et celui de
//     l'entreprise, rien d'autre (agenda_flux ne donne ni numéro ni e-mail) ; description : le canal, le lien de visio, le lien vers la
//     fiche dans l'application ;
//   - genererIcs(evenements, options) : le texte .ics. Dates en UTC, texte échappé, lignes pliées à 75 octets, fins de ligne CRLF, UID
//     stable (« <id du rendez-vous>@cold-dialer »), rappel 10 minutes avant ; un rendez-vous annulé, reporté ou no-show est CANCELLED,
//     « pris » est TENTATIVE, « confirmé » et « tenu » CONFIRMED ;
//   - jetonDepuisSegment(« <jeton> » ou « <jeton>.ics ») : le jeton (64 caractères hexadécimaux), ou null.
// Module PUR : ni base, ni réseau.

import { objet } from "../integrations/base";
import { chaine, isoOuNull, lienHttpsOuNull, liste, uuidOuNull } from "./lecture";
import type { StatutRdv } from "./types";

export const PRODID_ICS = "-//cold-dialer//Agenda//FR";
export const DOMAINE_UID = "cold-dialer";
export const RE_JETON_AGENDA = /^[0-9a-f]{64}$/;
/** Les clients relisent le flux au plus toutes les heures (Google, lui, décide seul : souvent plusieurs heures). */
export const RAFRAICHISSEMENT_ICS = "PT1H";
export const RAPPEL_MINUTES_ICS = 10;

export type StatutIcs = "TENTATIVE" | "CONFIRMED" | "CANCELLED";

export interface EvenementIcs {
  id: string;
  debut: string;
  fin: string;
  titre: string;
  lieu: string | null;
  description: string | null;
  url: string | null;
  statut: StatutIcs;
  creeLe: string | null;
  modifieLe: string | null;
}

/** Le jeton d'un segment d'adresse (« <jeton> » ou « <jeton>.ics ») ; null si la forme n'est pas la bonne. */
export function jetonDepuisSegment(segment: unknown): string | null {
  if (typeof segment !== "string" || segment.length > 200) return null;
  let brut: string;
  try {
    brut = decodeURIComponent(segment);
  } catch {
    return null;
  }
  brut = brut.trim().replace(/\.ics$/i, "");
  return RE_JETON_AGENDA.test(brut) ? brut : null;
}

/** « 2026-11-10T09:00:00.000Z » → « 20261110T090000Z » ; null si la date est illisible. */
export function dateIcs(v: string | number | Date): string | null {
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Un texte iCalendar : antislash, point-virgule et virgule échappés, sauts de ligne en « \n », caractères de contrôle retirés. */
export function echapperIcs(texteSource: string): string {
  return texteSource
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Une ligne pliée à 75 octets (UTF-8, sans couper un caractère) ; les suites commencent par une espace (RFC 5545, 3.1). */
export function plierLigne(ligne: string): string[] {
  const encodeur = new TextEncoder();
  const sortie: string[] = [];
  let courante = "";
  let octets = 0;
  for (const c of ligne) {
    const taille = encodeur.encode(c).byteLength;
    const limite = sortie.length === 0 ? 75 : 74;
    if (octets + taille > limite) {
      sortie.push(courante);
      courante = "";
      octets = 0;
    }
    courante += c;
    octets += taille;
  }
  sortie.push(courante);
  return sortie.map((l, i) => (i === 0 ? l : ` ${l}`));
}

export function statutIcs(statut: unknown): StatutIcs {
  if (statut === "annule" || statut === "reporte" || statut === "no_show") return "CANCELLED";
  if (statut === "confirme" || statut === "tenu") return "CONFIRMED";
  return "TENTATIVE";
}

export interface OptionsFlux {
  /** L'adresse de l'application (« https://mon-domaine.example »), pour le lien vers la fiche. */
  base: string;
  /** Le nom du rendez-vous (config.offre.rdv.nom). */
  nomRdv: string;
}

const LIBELLES_STATUT_ICS: Partial<Record<StatutRdv, string>> = { no_show: "Statut : no-show.", reporte: "Statut : reporté.", annule: "Statut : annulé." };

/** La réponse de agenda_flux() en événements (les lignes illisibles sont ignorées). */
export function evenementsDepuisFlux(flux: unknown, o: OptionsFlux): EvenementIcs[] {
  const base = o.base.replace(/\/+$/, "");
  const sortie: EvenementIcs[] = [];
  for (const brut of liste(objet(flux).rendezVous, 600)) {
    const r = objet(brut);
    const id = uuidOuNull(r.id);
    const debut = isoOuNull(r.debut);
    const fin = isoOuNull(r.fin);
    if (!id || !debut || !fin) continue;
    const entreprise = chaine(r.entreprise, 200);
    const leadId = uuidOuNull(r.leadId);
    const lien = lienHttpsOuNull(r.lienVisio);
    const canal = r.canal === "telephone" ? "Par téléphone." : r.canal === "sur_place" ? "Sur place." : lien ? `Visio : ${lien}` : "Visio (lien à venir).";
    const fiche = leadId ? `${base}/prospects/${leadId}` : null;
    const description = [canal, fiche ? `Fiche : ${fiche}` : null, LIBELLES_STATUT_ICS[r.statut as StatutRdv] ?? null]
      .filter((l): l is string => l !== null)
      .join("\n");
    sortie.push({
      id,
      debut,
      fin,
      titre: entreprise ? `${o.nomRdv} · ${entreprise}` : o.nomRdv,
      lieu: lien,
      description,
      url: fiche,
      statut: statutIcs(r.statut),
      creeLe: isoOuNull(r.creeLe),
      modifieLe: isoOuNull(r.majLe),
    });
  }
  return sortie;
}

/** Le nom du calendrier : « <produit> · <prénom du closer> ». */
export function nomCalendrier(flux: unknown, nomProduit: string): string {
  const nom = chaine(objet(objet(flux).closer).nom, 120);
  const prenom = nom ? nom.split(/\s+/)[0] : null;
  return prenom ? `${nomProduit} · ${prenom}` : `${nomProduit} · Rendez-vous`;
}

export interface OptionsIcs {
  nom: string;
  fuseau: string;
  /** DTSTAMP : la date de génération du flux. */
  genereLe: string | number | Date;
}

/** SEQUENCE : les secondes écoulées entre la création et la dernière modification (croît à chaque modification). */
function sequence(e: EvenementIcs): number {
  const cree = e.creeLe ? Date.parse(e.creeLe) : NaN;
  const maj = e.modifieLe ? Date.parse(e.modifieLe) : NaN;
  return Number.isFinite(cree) && Number.isFinite(maj) && maj > cree ? Math.floor((maj - cree) / 1000) : 0;
}

/** Le texte .ics complet (CRLF). Les événements sans date lisible sont ignorés. */
export function genererIcs(evenements: readonly EvenementIcs[], o: OptionsIcs): string {
  const stamp = dateIcs(o.genereLe) ?? dateIcs(Date.now()) ?? "20000101T000000Z";
  const lignes: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID_ICS}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${echapperIcs(o.nom)}`,
    `X-WR-TIMEZONE:${echapperIcs(o.fuseau)}`,
    `X-PUBLISHED-TTL:${RAFRAICHISSEMENT_ICS}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${RAFRAICHISSEMENT_ICS}`,
  ];
  for (const e of evenements) {
    const debut = dateIcs(e.debut);
    const fin = dateIcs(e.fin);
    if (!debut || !fin) continue;
    lignes.push("BEGIN:VEVENT", `UID:${echapperIcs(e.id)}@${DOMAINE_UID}`, `DTSTAMP:${stamp}`);
    const cree = e.creeLe ? dateIcs(e.creeLe) : null;
    const modifie = e.modifieLe ? dateIcs(e.modifieLe) : null;
    if (cree) lignes.push(`CREATED:${cree}`);
    if (modifie) lignes.push(`LAST-MODIFIED:${modifie}`);
    lignes.push(`DTSTART:${debut}`, `DTEND:${fin}`, `SUMMARY:${echapperIcs(e.titre)}`);
    if (e.lieu) lignes.push(`LOCATION:${echapperIcs(e.lieu)}`);
    if (e.description) lignes.push(`DESCRIPTION:${echapperIcs(e.description)}`);
    if (e.url) lignes.push(`URL:${e.url}`);
    lignes.push(`STATUS:${e.statut}`, `SEQUENCE:${sequence(e)}`, "TRANSP:OPAQUE");
    if (e.statut !== "CANCELLED") {
      lignes.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${echapperIcs(e.titre)}`, `TRIGGER:-PT${RAPPEL_MINUTES_ICS}M`, "END:VALARM");
    }
    lignes.push("END:VEVENT");
  }
  lignes.push("END:VCALENDAR");
  return `${lignes.flatMap(plierLigne).join("\r\n")}\r\n`;
}
