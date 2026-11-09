// Rafraîchit la session Supabase à chaque requête et protège l'application (règles : lib/supabase/chemins.ts).
//   - visiteur sans session sur une page protégée : renvoyé vers /login (l'écran demandé est gardé dans « suite ») ;
//   - visiteur sans session sur une route /api/ : 401 en JSON ;
//   - compte connecté qui ouvre /login ou /signup : renvoyé vers l'accueil.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACCUEIL, cheminDeRetour, decider, estPagePublique } from "./chemins";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const chemin = request.nextUrl.pathname;
  let reponse = NextResponse.next({ request });

  // Sans configuration, personne ne peut s'authentifier : on le dit clairement (sauf sur les pages d'accès, qui l'expliquent).
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (estPagePublique(chemin)) return reponse;
    return new NextResponse("Configuration Supabase manquante (voir .env.example).", { status: 500 });
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(aPoser, entetes) {
        for (const { name, value } of aPoser) request.cookies.set(name, value);
        reponse = NextResponse.next({ request });
        for (const { name, value, options } of aPoser) reponse.cookies.set(name, value, options);
        // Une réponse qui porte une session ne doit jamais être mise en cache.
        for (const [cle, valeur] of Object.entries(entetes ?? {})) reponse.headers.set(cle, valeur);
      },
    },
  });

  // Ne rien intercaler entre la création du client et getUser() : getUser() valide le jeton auprès de Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  switch (decider(chemin, user !== null)) {
    case "refus_api":
      return NextResponse.json({ ok: false, code: "non_connecte" }, { status: 401 });
    case "vers_connexion": {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      const suite = cheminDeRetour(chemin);
      if (suite) url.searchParams.set("suite", suite);
      return NextResponse.redirect(url);
    }
    case "vers_accueil": {
      const url = request.nextUrl.clone();
      url.pathname = ACCUEIL;
      url.search = "";
      const redirection = NextResponse.redirect(url);
      for (const c of reponse.cookies.getAll()) redirection.cookies.set(c);
      return redirection;
    }
    case "suivant":
      return reponse;
  }
}
