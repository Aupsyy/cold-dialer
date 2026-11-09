// Le point d'arrivée des liens envoyés par e-mail (confirmation d'inscription, mot de passe oublié) : échange le code ou le jeton contre
// une session, puis ouvre l'écran demandé (« suite »), seulement s'il s'agit d'un chemin INTERNE.
//   - ?code=…                       (format PKCE, par défaut) : à ouvrir dans le MÊME navigateur que la demande ;
//   - ?token_hash=…&type=recovery…  (modèle d'e-mail personnalisé) : marche depuis n'importe quel navigateur.

import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ACCUEIL, cheminInterne } from "@/lib/supabase/chemins";
import { createClient } from "@/lib/supabase/server";

const TYPES_OTP: readonly string[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
const PAGE_NOUVEAU_MOT_DE_PASSE = "/nouveau-mot-de-passe";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const typeBrut = searchParams.get("type");
  const type = typeBrut && TYPES_OTP.includes(typeBrut) ? (typeBrut as EmailOtpType) : null;
  const suite = cheminInterne(searchParams.get("suite"), origin, type === "recovery" ? PAGE_NOUVEAU_MOT_DE_PASSE : ACCUEIL);

  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${suite}`);
    console.error("[acces] échange du code", error.code ?? error.status ?? "sans-code");
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${suite}`);
    console.error("[acces] vérification du jeton", error.code ?? error.status ?? "sans-code");
  }

  if (type === "recovery" || suite.startsWith(PAGE_NOUVEAU_MOT_DE_PASSE)) {
    return NextResponse.redirect(`${origin}/mot-de-passe-oublie?erreur=lien`);
  }
  return NextResponse.redirect(`${origin}/login?erreur=lien`);
}
