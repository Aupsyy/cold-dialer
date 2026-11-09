// Reconnaître une coordonnée dans un texte de site : e-mail écrit en clair, e-mail masqué simplement (« contact [at] domaine [dot] fr »,
// « (at) », « arobase »), numéro de téléphone (France, Belgique, Suisse, Luxembourg ou Monaco avec leur 0, international en « + »,
// Amérique du Nord), séparateurs compris (espaces, points, tirets, barres, parenthèses, « (0) »). Une seule implémentation :
//   - scripts/accroches/compact.mjs écarte toute ligne qui en porte une (une accroche n'en a jamais besoin, et rien de tel ne part
//     vers l'agent qui écrit les accroches) ;
//   - scripts/sourcing/emails.mjs y lit les e-mails publiés par l'entreprise (motifs EMAIL_TEXTE, MASQUE, POINT).
// Les motifs sont bornés : sur une ligne de site, aucun retour arrière coûteux.

/** Un e-mail en clair dans un texte (minuscules ou majuscules). */
export const EMAIL_TEXTE = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}\b/gi;
/** « @ » masqué : « [at] », « (at) », « {arobase} », « [@] », ou « at » / « arobase » entre deux espaces. */
export const AT = String.raw`(?:\s*[[({]\s*(?:at|arobase|@)\s*[\])}]\s*|\s+(?:at|arobase)\s+)`;
/** « . » masqué : « [dot] », « (point) », « [.] », « dot » / « point » entre deux espaces, ou un vrai point. */
export const POINT = String.raw`(?:\s*[[({]\s*(?:dot|point|\.)\s*[\])}]\s*|\s+(?:dot|point)\s+|\.)`;
/** Un e-mail masqué simplement : (début)(domaine, avec ses points masqués). */
export const MASQUE = new RegExp(String.raw`([a-z0-9._%+-]{1,64})${AT}([a-z0-9-]{1,63}(?:${POINT}[a-z0-9-]{1,63}){1,4})`, "gi");

const EMAIL_LARGE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;
const MASQUE_UN = new RegExp(MASQUE.source, "i");

/** Vrai si le texte porte un e-mail, en clair ou masqué simplement. */
export function contientEmail(texte) {
  const t = String(texte ?? "");
  return EMAIL_LARGE.test(t) || MASQUE_UN.test(t);
}

/**
 * Les formes d'un numéro de téléphone, chiffre par chiffre (un séparateur au plus entre deux chiffres : espace, point, barre, tiret) :
 *   - national avec son 0 (France, Monaco, Belgique, Suisse, Luxembourg) : 0, un chiffre de 1 à 9, puis 7 à 9 chiffres ;
 *   - international : « + », l'indicatif, un « (0) » éventuel, puis 6 à 13 chiffres ;
 *   - Amérique du Nord : la forme 3-3-4, avec ou sans le 1 devant (« (555) 000-0001 », « 1 555 000 0001 »).
 * Bornés : chaque essai lit 20 caractères au plus, aucun retour arrière coûteux.
 */
const TELEPHONES = [
  /(?<![\d+])0[1-9](?:[\s.\/-]?\d){7,9}(?!\d)/,
  /\+\s?\d{1,3}(?:\s?\(0\))?(?:[\s.\/-]?\d){6,13}(?!\d)/,
  /(?<![\d+])(?:1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}(?!\d)/,
];

/** Vrai si le texte porte un numéro de téléphone (séparateurs, « (0) », parenthèses compris). */
export function contientTelephone(texte) {
  const t = String(texte ?? "");
  return TELEPHONES.some((motif) => motif.test(t));
}

/** Vrai si le texte porte une coordonnée (e-mail ou téléphone). */
export function contientCoordonnees(texte) {
  return contientEmail(texte) || contientTelephone(texte);
}
