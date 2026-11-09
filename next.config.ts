// La configuration de Next.js. Elle valide config/niche.json au build (schéma et garde-fous : un problème arrête le build, avec la liste
// des erreurs) et pose les en-têtes de sécurité sur toutes les adresses. La Permissions-Policy laisse le micro à l'application et aux
// origines du fournisseur de téléphonie choisi (registre[config.telephonie.fournisseur].originesMicro).
// Imports RELATIFS seulement : l'alias « @/ » n'existe pas quand Next.js lit ce fichier.

import type { NextConfig } from "next";
import { chargerNiche } from "./config/charger";
import brut from "./config/niche.json";
import { entetesSecurite } from "./lib/securite/entetes";
import { adaptateurTelephonie, originesMicro } from "./lib/telephonie/registre";

const niche = chargerNiche(brut);
const fournisseur = niche.telephonie.fournisseur;
if (!adaptateurTelephonie(fournisseur)) {
  console.warn(`[config] telephonie.fournisseur = « ${fournisseur} » : aucun adaptateur dans lib/telephonie/registre.ts pour l'instant.`);
}

export const ENTETES_SECURITE = entetesSecurite(originesMicro(fournisseur));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: ENTETES_SECURITE }];
  },
};

export default nextConfig;
