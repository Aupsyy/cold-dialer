import type { Metadata } from "next";
import { BoutonEnvoi } from "@/app/_ui/BoutonEnvoi";
import { Avis, Carte, Champ, LienTexte } from "@/app/_ui/primitives";
import { demanderReinitialisation } from "../actions";
import { ERREURS_OUBLI, message } from "../textes";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default async function PageOubli({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const erreur = message(ERREURS_OUBLI, sp.erreur);

  return (
    <Carte titre="Mot de passe oublié" sousTitre="Saisis ton e-mail : tu recevras un lien pour choisir un nouveau mot de passe.">
      {sp.envoye === "1" ? <Avis ton="ok">Si un compte existe avec cette adresse, un lien vient d&apos;être envoyé.</Avis> : null}
      {erreur ? <Avis ton="erreur">{erreur}</Avis> : null}
      <form action={demanderReinitialisation} className="space-y-4">
        <Champ libelle="E-mail" name="email" type="email" autoComplete="email" requis />
        <BoutonEnvoi libelleAttente="Envoi…">Recevoir le lien</BoutonEnvoi>
      </form>
      <div className="mt-4 text-center">
        <LienTexte href="/login">Retour à la connexion</LienTexte>
      </div>
    </Carte>
  );
}
