import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BoutonEnvoi } from "@/app/_ui/BoutonEnvoi";
import { Avis, Carte, Champ, LienTexte } from "@/app/_ui/primitives";
import { ACCUEIL } from "@/lib/supabase/chemins";
import { createClient } from "@/lib/supabase/server";
import { changerMotDePasse } from "../actions";
import { ERREURS_NOUVEAU_MOT_DE_PASSE, message } from "../textes";

export const metadata: Metadata = { title: "Nouveau mot de passe" };
export const dynamic = "force-dynamic";

// Page protégée (le middleware demande une session) : on y arrive par le lien « mot de passe oublié », ou pour changer de mot de passe.
export default async function PageNouveauMotDePasse({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  if (sp.ok === "1") {
    return (
      <Carte titre="Mot de passe changé" sousTitre="Tes autres appareils ont été déconnectés.">
        <div className="text-center">
          <LienTexte href={ACCUEIL}>Ouvrir le poste d&apos;appels</LienTexte>
        </div>
      </Carte>
    );
  }

  const erreur = message(ERREURS_NOUVEAU_MOT_DE_PASSE, sp.erreur);
  return (
    <Carte titre="Nouveau mot de passe">
      {erreur ? <Avis ton="erreur">{erreur}</Avis> : null}
      <form action={changerMotDePasse} className="space-y-4">
        <Champ
          libelle="Nouveau mot de passe"
          name="motDePasse"
          type="password"
          autoComplete="new-password"
          requis
          minLength={8}
          maxLength={72}
          aide="8 caractères au moins."
        />
        <Champ libelle="Confirme-le" name="confirmation" type="password" autoComplete="new-password" requis minLength={8} maxLength={72} />
        <BoutonEnvoi libelleAttente="Enregistrement…">Enregistrer</BoutonEnvoi>
      </form>
      <div className="mt-4 text-center">
        <LienTexte href={ACCUEIL}>Annuler</LienTexte>
      </div>
    </Carte>
  );
}
