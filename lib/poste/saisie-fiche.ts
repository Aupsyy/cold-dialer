// Les petites saisies sur une fiche (note, urgence, attribution, modification des coordonnées, réservation au Poste), revérifiées côté
// serveur avant toute écriture. Module PUR : lève ErreurSaisie (message lisible) si une entrée est invalide.

import { ErreurSaisie, MAX_NOTE, texte, uuid, uuidObligatoire } from "@/lib/server/validation";
import { validerModifContact, type ChampContact } from "./prospect";

function objet(brut: unknown): Record<string, unknown> {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) throw new ErreurSaisie("Saisie illisible.");
  return brut as Record<string, unknown>;
}

export function validerLeadId(brut: unknown): string {
  return uuidObligatoire(objet(brut).leadId, "La fiche");
}

export function validerNote(brut: unknown): { leadId: string; note: string } {
  const o = objet(brut);
  const leadId = uuidObligatoire(o.leadId, "La fiche");
  const note = texte(o.note, "La note", MAX_NOTE);
  if (!note) throw new ErreurSaisie("La note est vide.");
  return { leadId, note: note.replace(/—/g, ",") };
}

export function validerUrgent(brut: unknown): { leadId: string; urgent: boolean } {
  const o = objet(brut);
  const leadId = uuidObligatoire(o.leadId, "La fiche");
  if (typeof o.urgent !== "boolean") throw new ErreurSaisie("Urgent : oui ou non.");
  return { leadId, urgent: o.urgent };
}

export function validerAttribution(brut: unknown): { leadId: string; membreId: string | null } {
  const o = objet(brut);
  return { leadId: uuidObligatoire(o.leadId, "La fiche"), membreId: uuid(o.membreId, "La personne") };
}

export function validerModification(
  brut: unknown,
  pays: string,
): { leadId: string; maj: Partial<Record<ChampContact | "departement", string | null>> } {
  const o = objet(brut);
  return { leadId: uuidObligatoire(o.leadId, "La fiche"), maj: validerModifContact(o.champs, pays) };
}

/** La qualification après le changement d'urgence (la clé « urgent » n'est gardée que si elle vaut vrai). */
export function qualificationAvecUrgence(qualification: unknown, urgent: boolean): Record<string, unknown> {
  const q =
    qualification !== null && typeof qualification === "object" && !Array.isArray(qualification)
      ? { ...(qualification as Record<string, unknown>) }
      : {};
  if (urgent) q.urgent = true;
  else delete q.urgent;
  return q;
}
