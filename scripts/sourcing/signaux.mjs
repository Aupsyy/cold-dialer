// Les signaux PUBLICS d'un site d'entreprise, lus dans les pages déjà téléchargées (aucun réseau ici : fonctions pures) :
//   pixel_meta         un pixel publicitaire de Meta (Facebook, Instagram) est installé : l'entreprise a fait ou fait de la publicité ;
//   balise_google_ads  une balise de conversion ou de remarketing de Google Ads est installée (pas Google Analytics, qui mesure
//                      seulement l'audience) ;
//   prise_rdv          un outil de prise de rendez-vous en ligne (calendrier de réservation) est intégré ou lié ;
//   agence_creditee    une agence web ou de communication est créditée dans le pied de page (« site réalisé par … ») : le site a un
//                      prestataire.
// Un signal n'a de sens que si le site a été lu : sans lecture, aucun signal n'est ni vrai ni faux (voir lireSignaux).
// Les motifs sont bornés et sans retour arrière coûteux : une page hostile ne bloque pas le script.

import { texteDePage } from "./emails.mjs";

/** Les signaux connus, dans l'ordre où ils s'écrivent dans le CSV (colonne signaux_site). */
export const SIGNAUX = ["pixel_meta", "balise_google_ads", "prise_rdv", "agence_creditee"];

const PIXEL_META = /\bfbq\s*\(|connect\.facebook\.net|facebook\.com\/tr\?/i;
const GOOGLE_ADS = /\bAW-\d{6,12}\b|googleadservices\.com|googleads\.g\.doubleclick\.net|google_conversion_id/i;
const PRISE_RDV =
  /calendly\.com|cal\.com\/|iclosed\.io|meetings\.hubspot\.com|hubspot\.com\/meetings|tidycal\.com|savvycal\.com|doodle\.com\/bp|setmore\.com|youcanbook\.me|simplybook\.(?:me|it)|reservio\.com/i;
const CREDIT =
  /site (?:web )?(?:réalisé|realise|conçu|concu|créé|cree|développé|developpe)e? (?:par|avec)|réalisation (?:du site )?:|création (?:du site )?:|création de site|conception :|webdesign :|propulsé par|powered by|made (?:by|with)|design (?:by|&)|agence (?:web|digitale|de communication)|développé par|réalisé par|créé par/i;
/** « Powered by » suivi d'un outil de création de site (une plateforme n'est pas une agence). */
const PLATEFORME_CREDIT = /(?:powered by|made (?:with|by)|propulsé par|créé avec|réalisé avec)\s+(?:wix|squarespace|wordpress|webflow|shopify|godaddy|jimdo|weebly)[\w.]*/gi;

/** Le texte des pieds de page (<footer>) du HTML, au plus 5 blocs de 20 000 caractères, par recherche de position (pas de motif lazy). */
function piedsDePage(html) {
  const bas = html.toLowerCase();
  const pieds = [];
  let depart = 0;
  while (pieds.length < 5) {
    const debut = bas.indexOf("<footer", depart);
    if (debut < 0) break;
    const fin = bas.indexOf("</footer>", debut);
    const bout = fin < 0 ? Math.min(bas.length, debut + 20000) : Math.min(fin + 9, debut + 20000);
    pieds.push(texteDePage(html.slice(debut, bout)));
    depart = bout;
  }
  return pieds.join(" ");
}

/** Vrai si une agence est créditée en pied de page (le dernier bloc de texte de la page si elle n'a pas de <footer>). */
export function agenceCreditee(html) {
  const brut = String(html ?? "");
  const texte = texteDePage(brut);
  const zone = `${piedsDePage(brut)} ${texte.slice(-600)}`.replace(PLATEFORME_CREDIT, " ");
  return CREDIT.test(zone);
}

/**
 * Les signaux d'un site d'après ses pages lues (lireSite d'emails.mjs : [{ url, html }], l'accueil en premier).
 * Renvoie { pixel_meta, balise_google_ads, prise_rdv, agence_creditee } en booléens.
 */
export function lireSignaux(pages) {
  const toutes = (pages ?? []).map((p) => String(p.html ?? ""));
  const partout = toutes.join("\n");
  return {
    pixel_meta: PIXEL_META.test(partout),
    balise_google_ads: GOOGLE_ADS.test(partout),
    prise_rdv: PRISE_RDV.test(partout),
    agence_creditee: toutes.length > 0 && agenceCreditee(toutes[0]),
  };
}

/** La liste des signaux présents, séparés par des virgules (colonne signaux_site), dans l'ordre de SIGNAUX. */
export const listerSignaux = (signaux) => SIGNAUX.filter((s) => signaux?.[s] === true).join(",");
