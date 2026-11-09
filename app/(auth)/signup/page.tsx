import type { Metadata } from "next";
import { cache } from "react";
import { BoutonEnvoi } from "@/app/_ui/BoutonEnvoi";
import { Avis, Carte, Champ, LienTexte } from "@/app/_ui/primitives";
import { objet, texte } from "@/lib/integrations/base";
import { LIBELLES_ROLE, estRole } from "@/lib/roles";
import { clientService } from "@/lib/supabase/service";
import { sInscrire } from "../actions";
import { ERREURS_INSCRIPTION, message } from "../textes";

export const metadata: Metadata = { title: "Inscription" };
export const dynamic = "force-dynamic";

const RE_JETON = /^[0-9a-f]{64}$/;

interface InvitationPublique {
  equipe: string;
  role: string;
  email: string | null;
  nom: string | null;
}

// L'aperçu d'une invitation (nom de l'équipe, rôle, e-mail ou nom prévus), lu avec la clé service par invitation_publique() : la base
// n'ouvre rien au visiteur anonyme. Sans clé service, pas d'aperçu : le formulaire s'affiche et la base tranche à l'inscription.
const lireInvitation = cache(async (jeton: string): Promise<InvitationPublique | null | "sans_apercu"> => {
  const client = clientService();
  if (!client) return "sans_apercu";
  const { data, error } = await client.rpc("invitation_publique", { p_jeton: jeton });
  if (error) return "sans_apercu";
  const o = objet(data);
  const equipe = texte(o.equipe, 120);
  const role = texte(o.role, 20);
  if (!equipe || !role) return null;
  return { equipe, role, email: texte(o.email, 254), nom: texte(o.nom, 120) };
});

export default async function PageInscription({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const jeton = typeof sp.invitation === "string" && RE_JETON.test(sp.invitation) ? sp.invitation : null;
  const invitation = jeton ? await lireInvitation(jeton) : null;

  if (!jeton || invitation === null) {
    return (
      <Carte titre="Accès sur invitation" sousTitre="Les comptes sont créés par un lien d'invitation envoyé par ton équipe.">
        {sp.invitation ? <Avis ton="erreur">Ce lien d&apos;invitation est invalide, expiré ou déjà utilisé.</Avis> : null}
        <div className="text-center">
          <LienTexte href="/login">J&apos;ai déjà un compte</LienTexte>
        </div>
      </Carte>
    );
  }

  const erreur = message(ERREURS_INSCRIPTION, sp.erreur);
  const apercu = invitation === "sans_apercu" ? null : invitation;
  const role = apercu && estRole(apercu.role) ? LIBELLES_ROLE[apercu.role] : null;

  return (
    <Carte
      titre="Créer ton compte"
      sousTitre={apercu ? `Invitation à rejoindre ${apercu.equipe}${role ? ` (${role.toLowerCase()})` : ""}.` : "Invitation à rejoindre l'équipe."}
    >
      {erreur ? <Avis ton="erreur">{erreur}</Avis> : null}
      <form action={sInscrire} className="space-y-4">
        <input type="hidden" name="jeton" value={jeton} />
        <Champ libelle="Prénom et nom" name="nom" autoComplete="name" requis maxLength={120} valeurParDefaut={apercu?.nom ?? undefined} />
        <Champ libelle="E-mail" name="email" type="email" autoComplete="email" requis valeurParDefaut={apercu?.email ?? undefined} />
        <Champ
          libelle="Mot de passe"
          name="motDePasse"
          type="password"
          autoComplete="new-password"
          requis
          minLength={8}
          maxLength={72}
          aide="8 caractères au moins."
        />
        <BoutonEnvoi libelleAttente="Création…">Créer mon compte</BoutonEnvoi>
      </form>
      <div className="mt-4 text-center">
        <LienTexte href="/login">J&apos;ai déjà un compte</LienTexte>
      </div>
    </Carte>
  );
}
