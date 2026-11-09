// Les en-têtes de sécurité, posés sur toutes les adresses par next.config.ts.
//   - pas de devinette du type de fichier ; l'adresse d'origine n'est envoyée qu'au même site ;
//   - l'application ne s'affiche jamais dans le cadre d'un autre site (X-Frame-Options et frame-ancestors) : c'est ELLE qui encadre l'iframe
//     d'un fournisseur de téléphonie, jamais l'inverse ;
//   - caméra, position et paiement coupés ; le micro n'est permis qu'à l'application et aux origines du fournisseur de téléphonie choisi
//     (registre[config.telephonie.fournisseur].originesMicro), sinon son iframe ou son extension ne peut pas décrocher le micro.
// Pas de Content-Security-Policy stricte : elle casserait les scripts de Next.js sans test dédié.
// Module PUR, testé par tests/entetes.test.mjs.

export interface Entete {
  key: string;
  value: string;
}

/** Une origine autorisée au micro : « https://hote[:port] » ou l'identifiant d'une extension Chrome (32 lettres de a à p). */
export const RE_ORIGINE_MICRO = /^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?|chrome-extension:\/\/[a-p]{32})$/;

export function politiquePermissions(originesMicro: readonly string[] = []): string {
  const refusees = originesMicro.filter((o) => !RE_ORIGINE_MICRO.test(o));
  if (refusees.length > 0) {
    throw new Error(`Permissions-Policy : origine de micro invalide (${refusees.length}). Attendu « https://hote » ou « chrome-extension://… ».`);
  }
  const micro = ["self", ...Array.from(new Set(originesMicro), (o) => `"${o}"`)].join(" ");
  return `camera=(), microphone=(${micro}), geolocation=(), payment=()`;
}

export function entetesSecurite(originesMicro: readonly string[] = []): Entete[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "Permissions-Policy", value: politiquePermissions(originesMicro) },
  ];
}
