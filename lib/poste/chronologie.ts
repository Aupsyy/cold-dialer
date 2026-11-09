// La chronologie d'une fiche : son journal (appels, notes, annonces, rendez-vous reçus de l'agenda, imports) et ses rendez-vous, du plus
// récent au plus ancien, en phrases courtes. Les libellés des issues viennent de la config. Module PUR.

import type { Activite, Membre, RdvFiche } from "./fiche";
import { libelleDans, LIBELLES_CANAL, LIBELLES_SOURCE_RDV, LIBELLES_STATUT_RDV } from "./libelles";
import { libelleJourHeure } from "./temps";

export interface EntreeChronologie {
  id: string;
  /** ISO 8601 : l'heure de l'événement. */
  quand: string;
  /** « demain 9 h 30 », dans le fuseau de la config. */
  quandLibelle: string;
  genre: "appel" | "note" | "annonce" | "rdv" | "statut" | "import";
  titre: string;
  detail: string | null;
  auteur: string | null;
}

/** « 45 s », « 2 min 05 », « 1 h 02 ». */
export function dureeLisible(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  if (t < 3600) return `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, "0")}`;
  return `${Math.floor(t / 3600)} h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
}

export interface OptionsChronologie {
  libellesIssues: Readonly<Record<string, string>>;
  membres: readonly Membre[];
  fuseau: string;
  maintenant: number;
}

export function chronologie(activites: readonly Activite[], rdvs: readonly RdvFiche[], o: OptionsChronologie): EntreeChronologie[] {
  const nom = (id: string | null) => (id ? (o.membres.find((m) => m.id === id)?.nom ?? null) : null);
  const quand = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? libelleJourHeure(t, o.maintenant, o.fuseau) : iso;
  };
  const entrees: Omit<EntreeChronologie, "quandLibelle">[] = activites.map((a) => {
    switch (a.type) {
      case "appel": {
        const morceaux = [a.dureeS !== null && a.dureeS > 0 ? dureeLisible(a.dureeS) : null, a.rappelLe ? `rappel ${quand(a.rappelLe)}` : null];
        const suite = morceaux.filter(Boolean).join(" · ");
        return {
          id: a.id,
          quand: a.creeLe,
          genre: "appel",
          titre: `Appel : ${a.issue ? libelleDans(o.libellesIssues, a.issue, a.issue) : "sans issue"}${suite ? ` · ${suite}` : ""}`,
          detail: a.note,
          auteur: nom(a.appelantId),
        };
      }
      case "annonce":
        return {
          id: a.id,
          quand: a.creeLe,
          genre: "annonce",
          titre: a.appelId ? "Annonce d'enregistrement lue (rattachée à l'appel)" : "Annonce d'enregistrement lue",
          detail: null,
          auteur: nom(a.appelantId),
        };
      case "rdv":
        return { id: a.id, quand: a.creeLe, genre: "rdv", titre: "Agenda", detail: a.note, auteur: nom(a.appelantId) };
      case "statut":
        return { id: a.id, quand: a.creeLe, genre: "statut", titre: "Statut modifié", detail: a.note, auteur: nom(a.appelantId) };
      case "import":
        return { id: a.id, quand: a.creeLe, genre: "import", titre: "Import", detail: a.note, auteur: null };
      case "note":
        return { id: a.id, quand: a.creeLe, genre: "note", titre: "Note", detail: a.note, auteur: nom(a.appelantId) };
    }
  });
  for (const r of rdvs) {
    const debut = Date.parse(r.debut);
    entrees.push({
      id: `rdv-${r.id}`,
      quand: r.debut,
      genre: "rdv",
      titre: `Rendez-vous ${libelleDans(LIBELLES_STATUT_RDV, r.statut).toLowerCase()} : ${Number.isFinite(debut) ? quand(r.debut) : r.debut}`,
      detail: [libelleDans(LIBELLES_CANAL, r.canal, r.canal), `pris via ${libelleDans(LIBELLES_SOURCE_RDV, r.source, r.source)}`, r.aVerifier ? "à vérifier" : null]
        .filter(Boolean)
        .join(" · "),
      auteur: nom(r.closerId),
    });
  }
  return entrees
    .sort((a, b) => (Date.parse(b.quand) || 0) - (Date.parse(a.quand) || 0))
    .map((e) => ({ ...e, quandLibelle: quand(e.quand) }));
}
