// Les sources RGPD d'une fiche (leads.sources, un tableau daté) : d'où viennent ses coordonnées. Une fiche saisie à la main porte
// OBLIGATOIREMENT sa source et sa date ; un changement manuel du dirigeant ou d'un numéro laisse aussi une trace datée « saisie
// manuelle » (un robot d'enrichissement ne remplace jamais une valeur saisie à la main). Sources publiques seulement : jamais LinkedIn
// (conditions d'utilisation : ni scraping ni copie). Module PUR.

import { ErreurSaisie, texte } from "@/lib/server/validation";

export const TYPES_SOURCE = [
  { code: "site", libelle: "Site internet de l'entreprise" },
  { code: "registre", libelle: "Registre public des entreprises" },
  { code: "annuaire", libelle: "Annuaire professionnel" },
  { code: "fiche_locale", libelle: "Fiche d'établissement en ligne (carte, avis)" },
  { code: "salon", libelle: "Salon ou événement professionnel" },
  { code: "recommandation", libelle: "Recommandation d'un contact" },
  { code: "contact_entrant", libelle: "Le prospect nous a contactés" },
  { code: "autre", libelle: "Autre source publique (à préciser)" },
] as const;
export type TypeSource = (typeof TYPES_SOURCE)[number]["code"];

const LIBELLES_SOURCE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(TYPES_SOURCE.map((t) => [t.code, t.libelle])),
  demo: "Démonstration (fiche fictive)",
  sirene: "Registre public des entreprises",
  maps: "Fiche d'établissement en ligne",
  csv: "Import d'un fichier",
  import: "Import",
  // Les types écrits par l'import (scripts/sourcing/importer.mjs : sirene, maps, site, manuel, fichier) et par le débrief.
  manuel: "Saisie manuelle (fichier de l'équipe)",
  fichier: "Fichier apporté par l'équipe",
  debrief: "Débrief d'un appel",
  saisie_manuelle: "Saisie manuelle",
  accroche: "Page du site d'où vient l'accroche",
};

export interface SourceDatee {
  type: string;
  /** AAAA-MM-JJ. */
  le: string;
  url?: string;
  precision?: string;
  /** Pour une trace de saisie manuelle : la donnée modifiée (dirigeant, telephone, mobile, email). */
  donnee?: string;
  origine?: "manuel";
}

const RE_LINKEDIN = /linked\s*-?\s*in|lnkd\.in/i;

/** La source saisie avec une fiche (type, lien facultatif, précision), datée du jour ; lève ErreurSaisie si elle manque ou si elle est refusée. */
export function validerSource(brut: unknown, le: string): SourceDatee {
  const o = brut !== null && typeof brut === "object" && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const type = texte(o.type, "La source", 40);
  if (!type) throw new ErreurSaisie("La source des coordonnées est obligatoire (RGPD) : d'où viennent-elles ?");
  if (!TYPES_SOURCE.some((t) => t.code === type)) throw new ErreurSaisie("La source : choisis-la dans la liste.");
  const url = texte(o.url, "Le lien de la source", 500);
  const precision = texte(o.precision, "La précision de la source", 200);
  if (url !== null) {
    let lien: URL;
    try {
      lien = new URL(url);
    } catch {
      throw new ErreurSaisie("Le lien de la source doit commencer par https://.");
    }
    if (lien.protocol !== "https:" && lien.protocol !== "http:") throw new ErreurSaisie("Le lien de la source doit commencer par https://.");
  }
  if (RE_LINKEDIN.test(`${url ?? ""} ${precision ?? ""}`)) {
    throw new ErreurSaisie("LinkedIn n'est pas une source permise (conditions d'utilisation) : indique une source publique.");
  }
  if (type === "autre" && !precision && !url) throw new ErreurSaisie("Source « autre » : précise laquelle.");
  const source: SourceDatee = { type, le, origine: "manuel" };
  if (url) source.url = url;
  if (precision) source.precision = precision;
  return source;
}

export interface SourceAffichee {
  libelle: string;
  le: string | null;
  url: string | null;
  precision: string | null;
  donnee: string | null;
}

const LIBELLES_DONNEE: Readonly<Record<string, string>> = { dirigeant: "dirigeant", telephone: "téléphone", mobile: "mobile", email: "e-mail" };

/** Les sources d'une fiche, lisibles (un lien n'est gardé que s'il est en http ou https). */
export function lireSources(v: unknown): SourceAffichee[] {
  if (!Array.isArray(v)) return [];
  const sortie: SourceAffichee[] = [];
  for (const brut of v) {
    if (brut === null || typeof brut !== "object" || Array.isArray(brut)) continue;
    const s = brut as Record<string, unknown>;
    const type = typeof s.type === "string" ? s.type : typeof s.origine === "string" ? s.origine : "inconnue";
    const url = typeof s.url === "string" && /^https?:\/\//i.test(s.url) ? s.url : null;
    const donnee = typeof s.donnee === "string" ? (LIBELLES_DONNEE[s.donnee] ?? s.donnee) : null;
    sortie.push({
      libelle: LIBELLES_SOURCE[type] ?? type,
      le: typeof s.le === "string" ? s.le.slice(0, 10) : null,
      url,
      // Le détail de l'import (« Annuaire démo », « registre SIRENE… ») et l'extrait de l'accroche tiennent lieu de précision.
      precision:
        typeof s.precision === "string"
          ? s.precision
          : typeof s.detail === "string"
            ? s.detail.slice(0, 200)
            : typeof s.extrait === "string"
              ? s.extrait.slice(0, 200)
              : null,
      donnee,
    });
  }
  return sortie;
}

/** Les données suivies : leur changement à la main laisse une trace datée. */
export const DONNEES_SUIVIES = ["dirigeant", "telephone", "mobile", "email"] as const;
export type DonneeSuivie = (typeof DONNEES_SUIVIES)[number];

const norme = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Les sources après une modification manuelle : une entrée « saisie_manuelle » datée par donnée changée (l'ancienne trace de cette donnée
 * est remplacée ; une donnée effacée perd sa trace). null s'il n'y a rien à écrire. 40 entrées au plus (les plus récentes).
 */
export function marquerSaisiesManuelles(
  avant: Partial<Record<DonneeSuivie, string | null>>,
  apres: Partial<Record<DonneeSuivie, string | null>>,
  sources: unknown,
  le: string,
): SourceDatee[] | null {
  const changees = DONNEES_SUIVIES.filter((d) => d in apres && norme(avant[d]) !== norme(apres[d]));
  if (changees.length === 0) return null;
  const actuelles = Array.isArray(sources)
    ? sources.filter((x): x is SourceDatee => x !== null && typeof x === "object" && !Array.isArray(x))
    : [];
  const gardees = actuelles.filter((s) => !(s.type === "saisie_manuelle" && changees.includes(s.donnee as DonneeSuivie)));
  const nouvelles: SourceDatee[] = changees
    .filter((d) => norme(apres[d]) !== "")
    .map((d) => ({ type: "saisie_manuelle", donnee: d, le, origine: "manuel" }));
  return [...gardees, ...nouvelles].slice(-40);
}
