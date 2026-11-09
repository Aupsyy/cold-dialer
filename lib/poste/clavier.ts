// Les raccourcis clavier du Poste : la touche d'une issue (config.issues[].touche), Ctrl+Entrée (ou Cmd+Entrée) pour enregistrer, Échap
// pour annuler. Jamais quand on tape dans un champ (texte, zone de saisie, liste, contenu modifiable), ni avec Ctrl, Alt ou Cmd, ni en
// maintenant la touche enfoncée. Module PUR (l'événement est lu par ses propriétés : testable sans navigateur).

import { issueParTouche, type IssuePoste } from "./issues";

export interface CibleClavier {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
}

const INPUTS_SANS_TEXTE = ["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"];

/** Vrai si la cible d'une touche est un champ où l'on tape du texte. */
export function estChampTexte(cible: unknown): boolean {
  if (cible === null || typeof cible !== "object") return false;
  const c = cible as CibleClavier;
  const tag = typeof c.tagName === "string" ? c.tagName.toUpperCase() : "";
  if (tag === "INPUT") return !INPUTS_SANS_TEXTE.includes(typeof c.type === "string" ? c.type.toLowerCase() : "text");
  return tag === "TEXTAREA" || tag === "SELECT" || c.isContentEditable === true;
}

export interface Touche {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target?: unknown;
}

/** L'issue que choisit cette touche, ou null (champ de saisie, modificateur, touche maintenue, touche sans issue). */
export function issueDeLaTouche(e: Touche, issues: readonly IssuePoste[]): IssuePoste | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return null;
  if (estChampTexte(e.target)) return null;
  if (typeof e.key !== "string" || e.key.length !== 1) return null;
  return issueParTouche(issues, e.key);
}

/** Ctrl+Entrée ou Cmd+Entrée : enregistrer, même depuis la note. Entrée seule, hors d'un champ, aussi. */
export function estEnregistrer(e: Touche): boolean {
  if (e.key !== "Enter" || e.repeat || e.isComposing || e.altKey) return false;
  if (e.ctrlKey || e.metaKey) return true;
  return !e.shiftKey && !estChampTexte(e.target);
}

export function estAnnuler(e: Touche): boolean {
  return e.key === "Escape" && !e.repeat;
}
