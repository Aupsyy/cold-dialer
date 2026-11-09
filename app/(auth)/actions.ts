"use server";

// Les actions d'accès (connexion, inscription sur invitation, mot de passe oublié, nouveau mot de passe, déconnexion). Elles tournent
// SUR LE SERVEUR : le mot de passe va du navigateur à Supabase, n'est jamais gardé par l'application et n'apparaît dans aucun journal
// (les journaux ne portent que des codes d'erreur).

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACCUEIL, cheminDeRetour } from "@/lib/supabase/chemins";
import { createClient } from "@/lib/supabase/server";
import { nomsCookiesDeSession } from "@/lib/supabase/session-cookies";

const RE_JETON = /^[0-9a-f]{64}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function champ(fd: FormData, cle: string): string {
  return String(fd.get(cle) ?? "").trim();
}

// L'adresse du site pour les liens envoyés par e-mail. Supabase ne redirige que vers les adresses autorisées dans ses réglages
// (Authentication › URL Configuration) : une adresse falsifiée est ignorée.
async function origineDuSite(): Promise<string> {
  const h = await headers();
  const origine = h.get("origin");
  if (origine && /^https?:\/\/[^\s/]+$/.test(origine)) return origine;
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
}

export async function seConnecter(formData: FormData): Promise<void> {
  const email = champ(formData, "email");
  const motDePasse = String(formData.get("motDePasse") ?? "");
  const suite = cheminDeRetour(champ(formData, "suite"));
  const garder = suite ? `&suite=${encodeURIComponent(suite)}` : "";
  if (!email || !motDePasse) redirect(`/login?erreur=champs${garder}`);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) redirect(`/login?erreur=${error.code === "email_not_confirmed" ? "non-confirme" : "identifiants"}${garder}`);
  redirect(suite ?? ACCUEIL);
}

function codeInscription(erreur: { code?: string; status?: number }): string {
  if (erreur.code === "weak_password") return "mdp-faible";
  if (erreur.code === "email_address_invalid" || erreur.code === "validation_failed") return "email-refuse";
  if (erreur.code === "over_email_send_rate_limit") return "quota-email";
  // La base refuse le compte (déclencheur gerer_nouvel_utilisateur) : invitation invalide, expirée, utilisée ou pour un autre e-mail.
  if (erreur.code === "unexpected_failure" || erreur.status === 500) return "invitation";
  return "inscription";
}

// Inscription : UNIQUEMENT avec une invitation (lien /signup?invitation=<jeton>). La base revérifie tout (déclencheur sur auth.users) :
// sans invitation valide, le compte n'est pas créé.
export async function sInscrire(formData: FormData): Promise<void> {
  const jeton = champ(formData, "jeton");
  if (!RE_JETON.test(jeton)) redirect("/signup");
  function retour(code: string): never {
    redirect(`/signup?invitation=${jeton}&erreur=${code}`);
  }

  const nom = champ(formData, "nom");
  const email = champ(formData, "email").toLowerCase();
  const motDePasse = String(formData.get("motDePasse") ?? "");
  if (!nom || !email || !motDePasse || nom.length > 120) retour("champs");
  if (email.length > 254 || !RE_EMAIL.test(email)) retour("email");
  if (motDePasse.length < 8) retour("mdp-court");
  if (motDePasse.length > 72) retour("mdp-long");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: motDePasse,
    options: {
      data: { nom, jeton_invitation: jeton },
      emailRedirectTo: `${await origineDuSite()}/auth/callback`,
    },
  });
  if (error) {
    console.error("[acces] inscription refusée", error.code ?? error.status ?? "sans-code");
    retour(codeInscription(error));
  }
  // Confirmation d'e-mail désactivée : la session est ouverte tout de suite ; sinon, on attend le clic dans l'e-mail.
  if (data.session) redirect(ACCUEIL);
  redirect("/login?message=confirme");
}

// Mot de passe oublié : le message affiché est le même que l'adresse ait un compte ou non (on ne dit pas qui est inscrit).
export async function demanderReinitialisation(formData: FormData): Promise<void> {
  const email = champ(formData, "email");
  if (!email || email.length > 254 || !RE_EMAIL.test(email)) redirect("/mot-de-passe-oublie?erreur=email");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origineDuSite()}/auth/callback?suite=/nouveau-mot-de-passe`,
  });
  if (error) console.error("[acces] mot de passe oublié", error.code ?? error.status ?? "sans-code");
  redirect("/mot-de-passe-oublie?envoye=1");
}

function codeNouveauMotDePasse(erreur: { code?: string }): string {
  if (erreur.code === "same_password") return "identique";
  if (erreur.code === "weak_password") return "mdp-faible";
  if (erreur.code === "reauthentication_needed") return "session";
  return "echec";
}

// Nouveau mot de passe pour la personne connectée (après le lien reçu par e-mail, ou pour en changer).
export async function changerMotDePasse(formData: FormData): Promise<void> {
  const motDePasse = String(formData.get("motDePasse") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  function retour(code: string): never {
    redirect(`/nouveau-mot-de-passe?erreur=${code}`);
  }
  if (!motDePasse || !confirmation) retour("champs");
  if (motDePasse.length < 8) retour("mdp-court");
  if (motDePasse.length > 72) retour("mdp-long");
  if (motDePasse !== confirmation) retour("confirmation");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password: motDePasse });
  if (error) {
    console.error("[acces] nouveau mot de passe refusé", error.code ?? error.status ?? "sans-code");
    retour(codeNouveauMotDePasse(error));
  }
  // Sécurité : les AUTRES appareils sont déconnectés ; la session actuelle reste ouverte.
  const { error: autres } = await supabase.auth.signOut({ scope: "others" });
  if (autres) console.error("[acces] déconnexion des autres sessions", autres.code ?? autres.status ?? "sans-code");
  redirect("/nouveau-mot-de-passe?ok=1");
}

// Déconnexion : la révocation est tentée auprès de Supabase, mais la session LOCALE est effacée quoi qu'il arrive (cookies compris).
export async function seDeconnecter(): Promise<void> {
  const supabase = await createClient();
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    // le serveur de Supabase n'a pas répondu : on efface quand même la session locale
  }
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // idem : les cookies sont effacés juste en dessous
  }
  const magasin = await cookies();
  for (const nom of nomsCookiesDeSession(magasin.getAll().map((c) => c.name))) {
    magasin.set(nom, "", { path: "/", maxAge: 0 });
  }
  redirect("/login");
}
