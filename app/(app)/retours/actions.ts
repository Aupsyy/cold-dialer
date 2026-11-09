"use server";

// La saisie rapide d'un retour du marché depuis la page /retours : objection (code de la config), verdict d'une accroche, citation.
// Revalidée par lib/retours/saisie.ts, écrite sous la RLS (retours_marche_creation : à son nom, dans son équipe ; la date est celle de la
// base). Journal : le nom de l'action et un code d'erreur, jamais la saisie.

import { revalidatePath } from "next/cache";
import { niche } from "@/config/niche";
import { validerSaisieRetour } from "@/lib/retours/saisie";
import { echecBase, run } from "@/lib/server/action-kit";
import { VALEURS_VIDES, type EtatSaisie, type ValeursSaisie } from "./etat";

function valeurs(formData: FormData): ValeursSaisie {
  const champ = (cle: string) => {
    const v = formData.get(cle);
    return typeof v === "string" ? v.slice(0, 1000) : "";
  };
  return { objection: champ("objection"), objectionTexte: champ("objectionTexte"), verdict: champ("verdict"), citation: champ("citation") };
}

export async function enregistrerRetour(_precedent: EtatSaisie, formData: FormData): Promise<EtatSaisie> {
  const saisies = valeurs(formData);
  const r = await run<null>("enregistrerRetour", "equipe", async (ctx) => {
    const saisie = validerSaisieRetour(
      { objection: saisies.objection, objectionTexte: saisies.objectionTexte, verdict: saisies.verdict, citation: saisies.citation },
      niche.objections.map((o) => o.code),
    );
    const { error } = await ctx.supabase.from("retours_marche").insert(saisie);
    if (error) return echecBase("enregistrerRetour", error);
    return { ok: true, data: null };
  });
  if (!r.ok) return { statut: "erreur", message: r.error, valeurs: saisies };
  revalidatePath("/retours");
  return { statut: "ok", message: "Retour noté : il compte dans les chiffres de la page.", valeurs: VALEURS_VIDES };
}
