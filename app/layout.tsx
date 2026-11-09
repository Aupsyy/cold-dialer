import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { niche } from "@/config/niche";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: niche.marque.nomProduit, template: `%s · ${niche.marque.nomProduit}` },
  description: `Le poste d'appels de ${niche.marque.nomEquipe}.`,
  // Un outil interne : jamais indexé par les moteurs de recherche.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const style = niche.marque.couleur ? ({ "--accent": niche.marque.couleur } as CSSProperties) : undefined;
  return (
    <html lang="fr">
      <body style={style} className="min-h-dvh font-sans">
        {children}
      </body>
    </html>
  );
}
