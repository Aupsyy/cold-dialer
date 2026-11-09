import { redirect } from "next/navigation";
import { ACCUEIL } from "@/lib/supabase/chemins";

export default function Accueil(): never {
  redirect(ACCUEIL);
}
