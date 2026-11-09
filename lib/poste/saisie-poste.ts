// Ce que demande l'écran du Poste (lu depuis l'adresse : ?fiche=…, ?apres=…, ?mes=1), revérifié. Module PUR.

import { uuid } from "@/lib/server/validation";

export interface DemandePoste {
  /** La fiche à ouvrir (depuis la liste des prospects ou la file). */
  fiche: string | null;
  /** La fiche qu'on vient de traiter : on ouvre la première de la file qui n'est pas elle. */
  apres: string | null;
  /** Seulement mes fiches (attribuées à moi). */
  mesLeads: boolean;
}

function premier(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

/** Une adresse bricolée ne fait jamais d'erreur : une valeur illisible est ignorée. */
export function lireDemandePoste(p: Readonly<Record<string, unknown>>): DemandePoste {
  const id = (v: unknown) => {
    try {
      return uuid(premier(v), "La fiche");
    } catch {
      return null;
    }
  };
  const mes = premier(p.mes);
  return { fiche: id(p.fiche), apres: id(p.apres), mesLeads: mes === "1" || mes === true };
}

/** L'adresse du Poste. */
export function adressePoste(d: Partial<DemandePoste> & { ok?: string | null }): string {
  const q = new URLSearchParams();
  if (d.fiche) q.set("fiche", d.fiche);
  if (d.apres) q.set("apres", d.apres);
  if (d.mesLeads) q.set("mes", "1");
  if (d.ok && /^[a-z][a-z0-9_]{1,39}$/.test(d.ok)) q.set("ok", d.ok);
  const s = q.toString();
  return s ? `/poste?${s}` : "/poste";
}
