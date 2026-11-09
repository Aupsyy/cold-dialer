// La saisie manuelle d'un prospect et la modification de ses coordonnées, revérifiées côté serveur. Les numéros sont rangés au format
// E.164 (la base retrouve une fiche, un doublon ou une opposition par leurs 9 derniers chiffres) ; la source des coordonnées, datée, est
// obligatoire (RGPD). Module PUR : rien n'est écrit ici, on prépare la ligne.

import { ErreurSaisie, MAX_NOTE, email as emailValide, texte, texteObligatoire } from "@/lib/server/validation";
import { validerSource, type SourceDatee } from "./sources";
import { versE164 } from "./telephone";

/** Le département d'un code postal français (« 69003 » -> « 69 », « 20090 » -> « 2A », « 97411 » -> « 974 ») ; null ailleurs. */
export function departementDepuisCp(cp: string | null | undefined, pays: string): string | null {
  const c = (cp ?? "").replace(/\s/g, "");
  if (pays.toUpperCase() !== "FR" || !/^\d{5}$/.test(c)) return null;
  if (c.startsWith("97")) return /^97[1-6]/.test(c) ? c.slice(0, 3) : null;
  if (c.startsWith("20")) return Number(c.slice(2, 3)) <= 1 ? "2A" : "2B";
  return c.slice(0, 2) === "00" ? null : c.slice(0, 2);
}

/** Un site saisi (« example.org/atelier ») ramené à une adresse http(s) valide, ou null s'il est vide ; erreur s'il est illisible. */
export function normaliserSite(v: unknown): string | null {
  const t = texte(v, "Le site", 500);
  if (t === null) return null;
  const avecSchema = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(avecSchema);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) throw new Error("hote");
    return u.href.length <= 500 ? u.href : null;
  } catch {
    throw new ErreurSaisie("Le site : adresse illisible (exemple : https://example.org).");
  }
}

function numero(v: unknown, libelle: string, pays: string): string | null {
  const t = texte(v, libelle, 30);
  if (t === null) return null;
  const e164 = versE164(t, pays);
  if (!e164) throw new ErreurSaisie(`${libelle} : numéro illisible (exemple : 01 99 00 01 01 ou +33 1 99 00 01 01).`);
  return e164;
}

function siren(v: unknown): string | null {
  const t = texte(v, "Le SIREN", 20);
  if (t === null) return null;
  const chiffres = t.replace(/\s/g, "");
  if (!/^\d{9}$/.test(chiffres)) throw new ErreurSaisie("Le SIREN : 9 chiffres.");
  return chiffres;
}

function codePostal(v: unknown): string | null {
  const t = texte(v, "Le code postal", 10);
  if (t === null) return null;
  if (!/^[0-9A-Za-z -]{3,10}$/.test(t)) throw new ErreurSaisie("Le code postal : 3 à 10 chiffres ou lettres.");
  return t.toUpperCase();
}

function objetSaisi(brut: unknown): Record<string, unknown> {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) throw new ErreurSaisie("Saisie illisible.");
  return brut as Record<string, unknown>;
}

export interface LigneProspect {
  entreprise: string;
  dirigeant: string | null;
  telephone: string | null;
  mobile: string | null;
  email: string | null;
  email_source: string | null;
  site: string | null;
  siren: string | null;
  ville: string | null;
  cp: string | null;
  departement: string | null;
  metier: string | null;
  notes: string | null;
  sources: SourceDatee[];
  assigned_to: string | null;
}

export interface ContexteSaisie {
  pays: string;
  /** Le jour local (AAAA-MM-JJ) : la date de la source. */
  aujourdhui: string;
  /** La personne connectée (la fiche lui est attribuée si elle le demande). */
  userId: string;
}

/** La fiche saisie à la main, prête à insérer ; lève ErreurSaisie (message lisible) sinon. */
export function validerSaisieProspect(brut: unknown, c: ContexteSaisie): LigneProspect {
  const o = objetSaisi(brut);
  const entreprise = texteObligatoire(o.entreprise, "Le nom de l'entreprise", 200);
  const telephone = numero(o.telephone, "Le téléphone", c.pays);
  const mobile = numero(o.mobile, "Le mobile", c.pays);
  if (!telephone && !mobile) throw new ErreurSaisie("Il faut au moins un numéro (téléphone ou mobile) : c'est un poste d'appels.");
  const source = validerSource(o.source, c.aujourdhui);
  const email = emailValide(o.email, "L'e-mail");
  const cp = codePostal(o.cp);
  return {
    entreprise,
    dirigeant: texte(o.dirigeant, "Le dirigeant", 160),
    telephone,
    mobile: mobile !== telephone ? mobile : null,
    email,
    email_source: email ? (source.url ?? source.type) : null,
    site: normaliserSite(o.site),
    siren: siren(o.siren),
    ville: texte(o.ville, "La ville", 120),
    cp,
    departement: departementDepuisCp(cp, c.pays),
    metier: texte(o.metier, "Le métier", 80),
    notes: texte(o.notes, "La note", MAX_NOTE),
    sources: [source],
    assigned_to: o.attribuer === true ? c.userId : null,
  };
}

/** Les coordonnées modifiables à la main sur la fiche. */
export const CHAMPS_CONTACT = ["dirigeant", "telephone", "mobile", "email", "site", "ville", "cp", "metier"] as const;
export type ChampContact = (typeof CHAMPS_CONTACT)[number];

/**
 * La modification des coordonnées : seulement les champs envoyés (une chaîne vide efface le champ). Renvoie la mise à jour en colonnes de
 * la base ; lève ErreurSaisie sinon. Le département suit le code postal.
 */
export function validerModifContact(brut: unknown, pays: string): Partial<Record<ChampContact | "departement", string | null>> {
  const o = objetSaisi(brut);
  const maj: Partial<Record<ChampContact | "departement", string | null>> = {};
  if ("dirigeant" in o) maj.dirigeant = texte(o.dirigeant, "Le dirigeant", 160);
  if ("telephone" in o) maj.telephone = numero(o.telephone, "Le téléphone", pays);
  if ("mobile" in o) maj.mobile = numero(o.mobile, "Le mobile", pays);
  if ("email" in o) maj.email = emailValide(o.email, "L'e-mail");
  if ("site" in o) maj.site = normaliserSite(o.site);
  if ("ville" in o) maj.ville = texte(o.ville, "La ville", 120);
  if ("cp" in o) {
    maj.cp = codePostal(o.cp);
    maj.departement = departementDepuisCp(maj.cp, pays);
  }
  if ("metier" in o) maj.metier = texte(o.metier, "Le métier", 80);
  if (Object.keys(maj).length === 0) throw new ErreurSaisie("Rien à modifier.");
  return maj;
}
