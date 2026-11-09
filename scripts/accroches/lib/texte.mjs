// Le texte : HTML → texte propre, normalisation (accents, casse, apostrophes), mots, phrases. Code maison, sans dépendance : un site
// n'est jamais exécuté, seulement lu (aucun JavaScript, aucune image). La lecture du HTML est LINÉAIRE : aucune expression régulière à
// retour arrière sur le texte d'un site (une page faite de « < », de liens ou de titres jamais fermés se lit en quelques millisecondes).
// Ces outils servent aussi à la recherche d'e-mails (scripts/sourcing/emails.mjs).

// ---------------------------------------------------------------------------------------------------------------------------------
// Entités HTML
// ---------------------------------------------------------------------------------------------------------------------------------

const ENTITES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", lsaquo: "‹", rsaquo: "›",
  hellip: "…", ndash: "–", mdash: "—", middot: "·", bull: "•", euro: "€", copy: "©", reg: "®", trade: "™", deg: "°", sect: "§",
  para: "¶", times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³",
  ordm: "º", ordf: "ª", cent: "¢", pound: "£", yen: "¥", iexcl: "¡", iquest: "¿", micro: "µ", prime: "′", Prime: "″",
  shy: "", zwnj: "", zwj: "", lrm: "", rlm: "", thinsp: " ", ensp: " ", emsp: " ", hairsp: " ",
  aelig: "æ", AElig: "Æ", oelig: "œ", OElig: "Œ", szlig: "ß", oslash: "ø", Oslash: "Ø", eth: "ð", ETH: "Ð", thorn: "þ", THORN: "Þ",
};
// Les lettres accentuées se composent : « eacute » = e + accent aigu.
const ACCENTS = { acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧", ring: "̊" };
// Les caractères 128 à 159 des anciennes pages Windows (&#146; pour l'apostrophe, &#156; pour œ).
const WINDOWS_1252 = {
  128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ", 137: "‰", 138: "Š", 139: "‹", 140: "Œ", 142: "Ž",
  145: "‘", 146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—", 152: "˜", 153: "™", 154: "š", 155: "›", 156: "œ", 158: "ž",
  159: "Ÿ",
};
// Sans point-virgule, seules ces entités historiques sont décodées (« R&D » reste « R&D »).
const SANS_POINT_VIRGULE = new Set(["amp", "lt", "gt", "quot", "nbsp"]);

function entiteNommee(nom) {
  if (Object.hasOwn(ENTITES, nom)) return ENTITES[nom];
  const m = /^([a-zA-Z])(acute|grave|circ|uml|tilde|cedil|ring)$/.exec(nom);
  return m ? (m[1] + ACCENTS[m[2]]).normalize("NFC") : undefined;
}

function caractere(code) {
  if (WINDOWS_1252[code]) return WINDOWS_1252[code];
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
  return String.fromCodePoint(code);
}

export function decoderEntites(s) {
  return String(s).replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31})(;?)/g, (tout, corps, pointVirgule) => {
    if (corps[0] === "#") {
      const code = corps[1] === "x" || corps[1] === "X" ? parseInt(corps.slice(2), 16) : parseInt(corps.slice(1), 10);
      return caractere(code);
    }
    const valeur = entiteNommee(corps);
    if (valeur === undefined) return pointVirgule ? " " : tout;
    if (!pointVirgule && !SANS_POINT_VIRGULE.has(corps)) return tout;
    return valeur;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Espaces et normalisation
// ---------------------------------------------------------------------------------------------------------------------------------

/** Espaces normalisés ligne par ligne ; lignes vides retirées. */
export function nettoyerTexte(s) {
  return String(s)
    .replace(/[­​-‍⁠﻿]/g, "")
    .replace(/[  -   　\t\r\f\v]/g, " ")
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").replace(/ ([,.)\]])/g, "$1").replace(/([([]) /g, "$1").trim())
    .filter(Boolean)
    .join("\n");
}

/** Une seule ligne, espaces normalisés. */
export function nettoyerLigne(s) {
  return nettoyerTexte(s).replace(/\n+/g, " ").trim();
}

/** Minuscules, sans accents, apostrophes et tirets unifiés, espaces simples. « L’Été à Saint-Étienne » → « l'ete a saint-etienne ». */
export function normaliser(s) {
  return String(s ?? "")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘ʼ`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Les mots normalisés (lettres et chiffres) : « J’ai vu vos 3 bassins » → j, ai, vu, vos, 3, bassins. */
export function mots(s) {
  return normaliser(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** La forme de comparaison d'un passage : mots normalisés séparés par une espace (la ponctuation ne compte pas). */
export function pourComparer(s) {
  return mots(s).join(" ");
}

/** Vrai si le passage (comparé mot à mot, sans accents ni casse) figure dans le texte. */
export function contientPassage(texte, passage) {
  const p = pourComparer(passage);
  if (!p) return false;
  return ` ${pourComparer(texte)} `.includes(` ${p} `);
}

/**
 * Deux mots normalisés de la même famille : identiques, pluriel ou féminin d'un mot court, ou même début à une lettre près pour les mots
 * d'au moins cinq lettres (« naturel » et « naturelle », « bassin » et « bassins », mais pas « terrain » et « terrasse »).
 */
export function memeFamille(a, b) {
  if (a === b) return true;
  const [court, long] = a.length <= b.length ? [a, b] : [b, a];
  if (court.length < 5) return [`${court}s`, `${court}x`, `${court}e`, `${court}es`].includes(long);
  let commun = 0;
  while (commun < court.length && court[commun] === long[commun]) commun++;
  return commun >= court.length - 1;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTML → texte
// ---------------------------------------------------------------------------------------------------------------------------------

/** Les commentaires HTML retirés (un commentaire jamais fermé court jusqu'à la fin : page tronquée à 1 Mo). Linéaire. */
export function retirerCommentaires(html) {
  return String(html).replace(/<!--[\s\S]*?(-->|$)/g, " ");
}

/**
 * Retire un élément et son contenu. Les éléments « bruts » (script, style…) non fermés sont coupés jusqu'à la fin (page tronquée à
 * 1 Mo) ; les autres (nav, footer…) non fermés perdent seulement leur balise ouvrante. Linéaire : le premier élément non fermé avale
 * la fin de la page, aucune position n'est relue.
 */
export function retirerBlocs(html, noms, { jusquALaFin }) {
  let h = String(html);
  for (const nom of noms) {
    const motif = new RegExp(`<${nom}(?=[\\s>/])[\\s\\S]*?(<\\/${nom}\\s*>|$)`, "gi");
    h = h.replace(motif, (tout, fermeture) => {
      if (fermeture || jusquALaFin) return "\n";
      const finBalise = tout.indexOf(">");
      return finBalise === -1 ? tout : `\n${tout.slice(finBalise + 1)}`;
    });
  }
  return h;
}

/**
 * Remplace chaque balise « <…> » (du « < » au premier « > » qui suit) en un seul passage : le même résultat que
 * s.replace(/<[^>]*>/g, …), sans son coût quadratique sur une page pleine de « < » jamais fermés. remplacement : une chaîne, ou une
 * fonction (nom de la balise en minuscules, vrai pour une fermeture) → chaîne.
 */
export function remplacerBalises(s, remplacement = " ") {
  const texte = String(s);
  let sortie = "";
  let position = 0;
  for (;;) {
    const debut = texte.indexOf("<", position);
    if (debut === -1) break;
    const fin = texte.indexOf(">", debut + 1);
    if (fin === -1) break;
    let par = remplacement;
    if (typeof remplacement === "function") {
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(texte.slice(debut, Math.min(fin, debut + 40)));
      par = remplacement(m ? m[2].toLowerCase() : "", Boolean(m?.[1]));
    }
    sortie += texte.slice(position, debut) + par;
    position = fin + 1;
  }
  return sortie + texte.slice(position);
}

function enleverBalises(s) {
  return remplacerBalises(s, " ");
}

/**
 * Une recherche « la prochaine occurrence à partir de p », mise en cache : quand les positions demandées ne font que croître, chaque
 * caractère n'est lu qu'une fois au total. trouver(p) → { index, fin } ou null.
 */
function curseur(trouver) {
  let depuis = Infinity;
  let resultat = null;
  return (p) => {
    if (depuis <= p && (resultat === null || resultat.index >= p)) return resultat;
    depuis = p;
    resultat = trouver(p);
    return resultat;
  };
}

/**
 * Les balises ouvrantes « <nom …> » d'une page (du « <nom » au premier « > »), dans l'ordre : le même résultat que
 * html.match(/<nom\b[^>]*>/gi), en un seul passage.
 */
export function balisesOuvrantes(html, nom, limite = Infinity) {
  const h = String(html);
  const ouverture = new RegExp(`<${nom}\\b`, "gi");
  const balises = [];
  let m;
  while (balises.length < limite && (m = ouverture.exec(h))) {
    const fin = h.indexOf(">", m.index + 1);
    if (fin === -1) break;
    balises.push(h.slice(m.index, fin + 1));
    ouverture.lastIndex = fin + 1;
  }
  return balises;
}

/**
 * Les éléments « <nom …>contenu</nom> » d'une page, en un seul passage, sans retour arrière : l'ouverture va du « <nom » au premier
 * « > » ; le contenu, jusqu'à la première fermeture « </nom> » (espaces permis avant « > ») à `max` caractères au plus, sinon cette
 * ouverture est ignorée. Le même résultat que /<(nom)\b([^>]*)>([\s\S]{0,max}?)<\/\1\s*>/gi, en temps linéaire même sur 50 000
 * liens jamais fermés.
 * @returns {{ nom: string, attributs: string, contenu: string }[]}
 */
export function elementsFermes(html, noms, { max = 3000, limite = Infinity } = {}) {
  const h = String(html);
  const elements = [];
  const ouverture = new RegExp(`<(${noms.join("|")})\\b`, "gi");
  const chevron = curseur((p) => {
    const i = h.indexOf(">", p);
    return i === -1 ? null : { index: i, fin: i + 1 };
  });
  const fermetures = new Map(
    noms.map((n) => {
      const motif = new RegExp(`<\\/${n}\\s*>`, "gi");
      return [
        n.toLowerCase(),
        curseur((p) => {
          motif.lastIndex = p;
          const m = motif.exec(h);
          return m ? { index: m.index, fin: m.index + m[0].length } : null;
        }),
      ];
    }),
  );
  let m;
  while (elements.length < limite && (m = ouverture.exec(h))) {
    const nom = m[1].toLowerCase();
    const fin = chevron(m.index + 1);
    if (!fin) break; // plus aucun « > » : plus aucun élément complet
    const fermeture = fermetures.get(nom)(fin.fin);
    if (fermeture && fermeture.index - fin.fin <= max) {
      elements.push({ nom, attributs: h.slice(m.index + 1 + nom.length, fin.index), contenu: h.slice(fin.fin, fermeture.index) });
      ouverture.lastIndex = fermeture.fin;
    } else {
      ouverture.lastIndex = m.index + 1;
    }
  }
  return elements;
}

function attribut(balise, nom) {
  const m = new RegExp(`\\b${nom}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(balise);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function meta(html, ...noms) {
  for (const balise of balisesOuvrantes(html, "meta")) {
    const nom = (attribut(balise, "name") ?? attribut(balise, "property") ?? "").toLowerCase();
    if (noms.includes(nom)) {
      const contenu = attribut(balise, "content");
      if (contenu) return contenu;
    }
  }
  return "";
}

function urlSure(brut, base) {
  const href = decoderEntites(String(brut)).trim();
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel|sms|data|ftp|file):/i.test(href)) return null;
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Lit une page HTML.
 * @returns {{ titre: string, description: string, titres: string[], texte: string, liens: { url: string, texte: string }[] }}
 *   titre : la balise <title> ; titres : les intertitres h1 à h4 ; texte : le corps lisible, un bloc par ligne (scripts, styles, menus,
 *   pieds de page et formulaires retirés) ; liens : les liens http(s) de la page (menu compris), adresses absolues sans ancre.
 */
const BLOCS = new Set([
  "p", "div", "section", "article", "header", "main", "aside", "li", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "blockquote", "figure", "figcaption", "address", "pre", "details",
  "summary", "center",
]);

/** Une balise qui coupe le texte (saut de ligne) ou non (espace) : <br>, <hr> et les blocs (paragraphes, listes, tableaux…). */
function separateur(nom, fermante) {
  return (!fermante && (nom === "br" || nom === "hr")) || BLOCS.has(nom) ? "\n" : " ";
}

/** Les liens http(s) d'une page HTML (balises <a> fermées, contenu de 3 000 caractères au plus), adresses absolues sans ancre. */
export function liensDePage(html, base) {
  const liens = [];
  const vus = new Set();
  for (const e of elementsFermes(html, ["a"], { max: 3000 })) {
    const href = attribut(e.attributs, "href");
    const url = href === null ? null : urlSure(href, base);
    if (!url || vus.has(url)) continue;
    vus.add(url);
    liens.push({ url, texte: nettoyerLigne(decoderEntites(enleverBalises(e.contenu))).slice(0, 160) });
  }
  return liens;
}

export function analyserHtml(html, urlPage) {
  let h = retirerCommentaires(String(html ?? ""));
  const titreBrut = elementsFermes(h, ["title"], { max: Infinity, limite: 1 })[0]?.contenu ?? "";
  const titre = nettoyerLigne(decoderEntites(enleverBalises(titreBrut)));
  const description = nettoyerLigne(decoderEntites(meta(h, "description", "og:description")));
  const baseBrute = balisesOuvrantes(h, "base", 1)[0];
  const base = (baseBrute && urlSure(attribut(baseBrute, "href") ?? "", urlPage)) || urlPage;

  h = retirerBlocs(h, ["head", "script", "style", "noscript", "template", "svg", "iframe", "object", "canvas", "math"], { jusquALaFin: true });

  // Les liens AVANT de retirer le menu : c'est lui qui mène aux pages utiles (réalisations, à propos…). Contenu borné : un lien jamais
  // fermé ne fait pas relire toute la page.
  const liens = liensDePage(h, base);

  h = retirerBlocs(h, ["nav", "footer", "form", "select", "button"], { jusquALaFin: false });

  const titres = [];
  for (const e of elementsFermes(h, ["h1", "h2", "h3", "h4"], { max: 3000 })) {
    const t = nettoyerLigne(decoderEntites(enleverBalises(e.contenu)));
    if (t.length >= 3 && t.length <= 200 && !titres.includes(t)) titres.push(t);
  }

  const texte = nettoyerTexte(decoderEntites(remplacerBalises(h, separateur)));
  return { titre, description, titres, texte, liens };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Phrases
// ---------------------------------------------------------------------------------------------------------------------------------

/** Les phrases d'un texte : une ligne par bloc, coupée après . ! ? … suivis d'une majuscule, d'un chiffre ou d'un guillemet. */
export function decouperPhrases(texte) {
  const phrases = [];
  for (const ligne of String(texte ?? "").split("\n")) {
    for (const morceau of ligne.split(/(?<=[.!?…])\s+(?=[\p{Lu}\d«"“(])/u)) {
      const p = morceau.trim();
      if (p) phrases.push(p);
    }
  }
  return phrases;
}
