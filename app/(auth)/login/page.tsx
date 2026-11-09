import type { Metadata } from "next";
import { BoutonEnvoi } from "@/app/_ui/BoutonEnvoi";
import { Avis, Carte, Champ, LienTexte } from "@/app/_ui/primitives";
import { cheminDeRetour } from "@/lib/supabase/chemins";
import { seConnecter } from "../actions";
import { ERREURS_CONNEXION, message } from "../textes";

export const metadata: Metadata = { title: "Connexion" };

export default async function PageConnexion({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const erreur = message(ERREURS_CONNEXION, sp.erreur);
  const suite = cheminDeRetour(sp.suite);

  return (
    <Carte titre="Connexion" sousTitre="Retrouve ta file d'appels.">
      {sp.message === "confirme" ? <Avis ton="ok">Compte créé. Confirme ton e-mail avec le lien reçu, puis connecte-toi.</Avis> : null}
      {erreur ? <Avis ton="erreur">{erreur}</Avis> : null}
      <form action={seConnecter} className="space-y-4">
        {suite ? <input type="hidden" name="suite" value={suite} /> : null}
        <Champ libelle="E-mail" name="email" type="email" autoComplete="email" requis />
        <Champ libelle="Mot de passe" name="motDePasse" type="password" autoComplete="current-password" requis />
        <BoutonEnvoi libelleAttente="Connexion…">Se connecter</BoutonEnvoi>
      </form>
      <div className="mt-4 flex flex-col items-center gap-3 text-center">
        <LienTexte href="/mot-de-passe-oublie">Mot de passe oublié ?</LienTexte>
        <p className="text-xs text-stone-500 dark:text-stone-400">Pas de compte ? L&apos;accès se fait sur invitation de ton équipe.</p>
      </div>
    </Carte>
  );
}
