// Les issues d'un appel, telles que le Poste les montre : celles de config.issues (le socle et les ajouts de la niche), avec leur touche
// clavier, leur gabarit de note, leur rappel (exigé ou automatique) et leur effet sur la file (final). Module PUR, importé par le
// navigateur : aucun import d'exécution de config/schema (types seulement).
//
// Le gabarit de note (gabaritNote) : des lignes « Clé : valeur » pré-remplies dans la note (« Interlocuteur : », « Meilleur moment : »).
// À l'enregistrement, une ligne du gabarit laissée vide est retirée : la note ne garde que ce qui a été dit.

import type { Issue } from "@/config/schema";

export interface IssuePoste {
  code: string;
  libelle: string;
  touche: string | null;
  /** Vrai : la fiche sort de la file (rdv_fixe, pas_interesse, hors_cible, ne_plus_contacter, et les ajouts « final » de la niche). */
  final: boolean;
  /** Vrai : une date de rappel est obligatoire (a_rappeler). */
  exigeRappel: boolean;
  /** « creneau_alterne » : le rappel est posé d'office (lib/poste/rappels.ts). */
  rappelAuto: "creneau_alterne" | null;
  gabaritNote: string[];
}

/** Les issues où personne n'a été joint : elles ne comptent pas dans les « joints » du jour. */
export const ISSUES_NON_JOINTES: readonly string[] = ["pas_repondu", "messagerie", "standard"];

/** Les issues qui comptent une tentative de plus (la base passe la fiche « injoignable » au plafond). */
export const ISSUES_TENTATIVE: readonly string[] = ["pas_repondu", "messagerie", "standard"];

export function estJointe(code: string | null | undefined): boolean {
  return typeof code === "string" && code !== "" && !ISSUES_NON_JOINTES.includes(code);
}

export function issuesDuPoste(issues: readonly Issue[]): IssuePoste[] {
  return issues.map((i) => ({
    code: i.code,
    libelle: i.libelle,
    touche: i.touche ?? null,
    final: i.final,
    exigeRappel: i.exigeRappel === true || i.code === "a_rappeler",
    rappelAuto: i.rappelAuto === "creneau_alterne" ? "creneau_alterne" : null,
    gabaritNote: [...(i.gabaritNote ?? [])],
  }));
}

export function issueParCode(issues: readonly IssuePoste[], code: string | null | undefined): IssuePoste | null {
  return issues.find((i) => i.code === code) ?? null;
}

/** L'issue de cette touche (« 1 », « m »), sans tenir compte des majuscules. */
export function issueParTouche(issues: readonly IssuePoste[], touche: string): IssuePoste | null {
  const t = touche.toLowerCase();
  return issues.find((i) => i.touche === t) ?? null;
}

/** La note pré-remplie d'un gabarit : une ligne « Clé : » par champ. */
export function noteDepuisGabarit(gabarit: readonly string[]): string {
  return gabarit.map((cle) => `${cle} : `).join("\n");
}

/**
 * La note à enregistrer : les lignes du gabarit restées vides sont retirées, les espaces de fin de ligne aussi ; null si rien ne reste.
 * Le tiret cadratin n'est jamais gardé (règle d'écriture du projet).
 */
export function nettoyerNote(note: string | null | undefined, gabarit: readonly string[] = []): string | null {
  const cles = new Set(gabarit.map((c) => c.trim().toLowerCase()));
  const lignes = (note ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/—/g, ",")
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""))
    .filter((l) => {
      const m = /^([^:]{1,40}?)\s*:\s*$/u.exec(l.trim());
      return !(m && cles.has((m[1] as string).trim().toLowerCase()));
    });
  const texte = lignes.join("\n").trim();
  return texte === "" ? null : texte;
}

export const EFFET_RDV_GARDE =
  "Cette fiche a un rendez-vous fixé : tant qu'il est à venir, cet appel ne la remet pas dans la file (ni tentative ni rappel) ; pour la rouvrir, annule ou reporte d'abord le rendez-vous.";
export const EFFET_RDV_CHANGE = "Cette fiche a déjà un rendez-vous fixé : cette issue changera son statut (le rendez-vous reste dans l'agenda).";

/**
 * Ce que l'issue fera de la fiche, en une phrase (montré avant d'enregistrer). `rdvFixe` : la fiche est « rdv_fixe » ; la base la garde
 * alors hors de la file pour toute issue non finale tant que son rendez-vous est à venir (enregistrer_issue).
 */
export function effetIssue(issue: IssuePoste, o: { derniereTentative: boolean; rdvFixe?: boolean }): string {
  if (o.rdvFixe && issue.code !== "rdv_fixe") {
    if (!issue.final) return EFFET_RDV_GARDE;
    return `${EFFET_RDV_CHANGE} ${effetIssue(issue, { derniereTentative: o.derniereTentative })}`;
  }
  if (issue.code === "ne_plus_contacter") {
    return "Le SIREN et les numéros de la fiche (sans SIREN : son nom et son code postal) entrent dans la liste d'opposition : plus aucun appel.";
  }
  if (ISSUES_TENTATIVE.includes(issue.code) && o.derniereTentative) return "Dernière tentative : la fiche passera « injoignable ».";
  if (issue.final) return "La fiche sort de la file.";
  if (issue.exigeRappel) return "La fiche revient dans la file à la date du rappel.";
  if (issue.rappelAuto) return "La fiche revient dans la file au créneau du rappel automatique.";
  return "La fiche reste dans la file.";
}
