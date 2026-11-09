// Le middleware : les routes d'intégration (/api/telephonie/, /api/agenda/) et /api/sante passent sans session (elles vérifient
// elles-mêmes leur secret ou ne renvoient que des booléens) ; tout le reste passe par la session Supabase (lib/supabase/middleware.ts).

import { NextResponse, type NextRequest } from "next/server";
import { estApiPublique } from "./lib/supabase/chemins";
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  if (estApiPublique(request.nextUrl.pathname)) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  // Toutes les adresses sauf les fichiers statiques et les images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
