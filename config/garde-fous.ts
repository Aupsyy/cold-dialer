// Les garde-fous de config/niche.json, joués par npm test et au build (config/charger.ts, lu par next.config.ts).
//
//   1. Aucune promesse de résultat dans ce qui est dit au prospect : promesse, pitch, close, réponses aux objections, et aussi l'ouverture,
//      la permission, les questions, la messagerie, la phrase prix et les exemples d'accroche. Ni chiffre de résultat (« 30 clients »,
//      « +20 % », « 3x »), ni « garanti », « assuré », « doubler », « sans risque », ni délai promis (« en 3 mois »).
//   2. Au téléphone, on ne vend QUE le rendez-vous : offre.objectifAppel vaut « rdv ».
//   3. Dans toute la config : aucun tiret cadratin, aucune URL hors agenda.lienReservation (et l'adresse de contact du robot dans
//      marque.userAgent), aucun e-mail hors legal.contactRGPD, aucune clé (sk_, eyJ, key=, token, secret).
// Module PUR : il ne lit ni fichier ni réseau.

import type { Niche } from "./schema";

/** Les motifs interdits dans tout texte dit au prospect. */
export const PROMESSES_INTERDITES: readonly RegExp[] = [
  /\d+\s*(%|€|k€|clients?|rdv|rendez-vous|leads?|prospects?|chantiers?|x)(?![\p{L}\p{N}_])/iu,
  /garanti|assuré|doubl|tripl|sans risque|résultats? (sûr|certain)/iu,
  /en \d+ (jours|semaines|mois)/iu,
];

export const TIRET_CADRATIN = /—/u;
export const MOTIF_URL = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./iu;
export const MOTIF_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
export const MOTIF_CLE = /sk_|eyJ|key=|token|secret/iu;

/** Les seuls endroits où une URL ou un e-mail est permis. */
export const CHEMINS_URL_PERMISE: readonly string[] = ["agenda.lienReservation", "marque.userAgent"];
export const CHEMINS_EMAIL_PERMIS: readonly string[] = ["legal.contactRGPD"];

export type RegleGardeFou = "promesse" | "objectif_appel" | "tiret_cadratin" | "url" | "email" | "cle";

export interface Violation {
  chemin: string;
  regle: RegleGardeFou;
  /** Le passage fautif (jamais la valeur d'une clé). */
  extrait: string;
}

/** Les textes dits au prospect, avec leur chemin dans la config. */
export function textesDitsAuProspect(n: Niche): [string, string][] {
  const t: [string, string][] = [
    ["offre.promesse", n.offre.promesse],
    ["offre.phrasePrix", n.offre.phrasePrix],
    ["script.ouverture.portable", n.script.ouverture.portable],
    ["script.ouverture.standard", n.script.ouverture.standard],
    ["script.ouverture.commentAvezVousMonNumero", n.script.ouverture.commentAvezVousMonNumero],
    ["script.pitch", n.script.pitch],
    ["script.close", n.script.close],
    ["script.messagerie", n.script.messagerie],
  ];
  if (n.script.permission) t.push(["script.permission", n.script.permission]);
  n.script.questions.forEach((q, i) => t.push([`script.questions.${i}.texte`, q.texte]));
  n.objections.forEach((o, i) => {
    t.push([`objections.${i}.reponse`, o.reponse]);
    if (o.relance) t.push([`objections.${i}.relance`, o.relance]);
  });
  n.accroche.exemples.forEach((e, i) => t.push([`accroche.exemples.${i}`, e]));
  return t;
}

/** Toutes les chaînes d'un objet JSON (clés comprises), avec leur chemin pointé. */
export function toutesLesChaines(valeur: unknown, chemin = ""): [string, string][] {
  if (typeof valeur === "string") return [[chemin, valeur]];
  if (Array.isArray(valeur)) return valeur.flatMap((v, i) => toutesLesChaines(v, chemin ? `${chemin}.${i}` : String(i)));
  if (valeur !== null && typeof valeur === "object") {
    return Object.entries(valeur).flatMap(([cle, v]) => {
      const sous = chemin ? `${chemin}.${cle}` : cle;
      return [[`${sous} (clé)`, cle] as [string, string], ...toutesLesChaines(v, sous)];
    });
  }
  return [];
}

function extraitAutour(texteSource: string, motif: RegExp): string {
  const m = motif.exec(texteSource);
  return m ? m[0] : "";
}

export function verifierGardeFous(n: Niche): Violation[] {
  const violations: Violation[] = [];

  for (const [chemin, valeur] of textesDitsAuProspect(n)) {
    for (const motif of PROMESSES_INTERDITES) {
      if (motif.test(valeur)) violations.push({ chemin, regle: "promesse", extrait: extraitAutour(valeur, motif) });
    }
  }

  if ((n.offre as { objectifAppel: unknown }).objectifAppel !== "rdv") {
    violations.push({ chemin: "offre.objectifAppel", regle: "objectif_appel", extrait: String(n.offre.objectifAppel) });
  }

  for (const [chemin, valeur] of toutesLesChaines(n)) {
    if (TIRET_CADRATIN.test(valeur)) violations.push({ chemin, regle: "tiret_cadratin", extrait: "—" });
    if (MOTIF_URL.test(valeur) && !CHEMINS_URL_PERMISE.includes(chemin)) {
      violations.push({ chemin, regle: "url", extrait: extraitAutour(valeur, MOTIF_URL) });
    }
    if (MOTIF_EMAIL.test(valeur) && !CHEMINS_EMAIL_PERMIS.includes(chemin)) {
      violations.push({ chemin, regle: "email", extrait: extraitAutour(valeur, MOTIF_EMAIL) });
    }
    if (MOTIF_CLE.test(valeur)) violations.push({ chemin, regle: "cle", extrait: "(valeur masquée)" });
  }

  return violations;
}

const LIBELLES: Record<RegleGardeFou, string> = {
  promesse: "promesse de résultat interdite",
  objectif_appel: "au téléphone, on ne vend que le rendez-vous (objectifAppel : rdv)",
  tiret_cadratin: "tiret cadratin interdit",
  url: "URL interdite ici (seulement agenda.lienReservation)",
  email: "e-mail interdit ici (seulement legal.contactRGPD)",
  cle: "ce qui ressemble à une clé ou un secret est interdit",
};

export function formaterViolation(v: Violation): string {
  return `${v.chemin} : ${LIBELLES[v.regle]}${v.extrait ? ` (« ${v.extrait} »)` : ""}`;
}
