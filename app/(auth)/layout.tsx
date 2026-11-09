import type { ReactNode } from "react";
import { niche } from "@/config/niche";

// Les pages d'accès : une carte centrée, le nom du produit au-dessus.
export default function AccesLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <p className="text-sm font-semibold tracking-wide text-accent">{niche.marque.nomProduit}</p>
      {children}
    </main>
  );
}
