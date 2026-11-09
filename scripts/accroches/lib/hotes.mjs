// Les adresses qu'un script a le droit de lire : le site PUBLIC d'une entreprise, jamais une machine de notre réseau, jamais un réseau
// social, un annuaire ou une carte. Un seul module pour le crawl des accroches (scripts/accroches/crawl.mjs) et la recherche d'e-mails
// (scripts/sourcing/emails.mjs), appliqué avant CHAQUE requête, redirections comprises :
//   - hotePublic : un nom de domaine (jamais une adresse IP écrite, « localhost » ni un nom de réseau local) ;
//   - hoteExclu : réseaux sociaux (jamais LinkedIn), annuaires, cartes, plateformes d'avis ou de mise en relation ;
//   - portPermis : les ports du web seulement (80 et 443) ;
//   - resolutionPublique : le nom, résolu par le DNS, ne mène qu'à des adresses publiques (ni bouclage, ni réseau privé, ni lien local,
//     CGNAT, ULA, multicast, ni adresse IPv4 cachée dans une adresse IPv6). Le résolveur est injectable : les tests n'interrogent aucun
//     DNS. Limite connue : le DNS peut répondre autre chose entre ce contrôle et la connexion de fetch (« DNS rebinding ») ; fixer
//     l'adresse vérifiée à la connexion demanderait un client HTTP propre, hors de fetch.

import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/** Un nom d'hôte public : jamais une adresse IP, « localhost » ni un nom de réseau local (une fiche ne doit pas viser nos machines). */
export function hotePublic(hote) {
  const h = String(hote).toLowerCase().replace(/\.$/, "");
  if (!h.includes(".") || h.startsWith("[") || /^[\d.]+$/.test(h)) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(h)) return false;
  return /\.[a-z][a-z0-9-]*[a-z0-9]$|\.xn--[a-z0-9-]+$/.test(h);
}

/**
 * Ce qui n'est pas le site d'une entreprise : réseaux sociaux (jamais LinkedIn), annuaires, cartes, plateformes d'avis ou de mise en
 * relation. Un « site » de fiche qui pointe là n'est jamais lu (aucune requête). Le domaine et tous ses sous-domaines.
 */
export const DOMAINES_EXCLUS = [
  "linkedin.com", "lnkd.in", "facebook.com", "fb.com", "fb.me", "fb.watch", "m.me", "messenger.com", "instagram.com", "instagr.am",
  "twitter.com", "t.co", "x.com", "tiktok.com", "youtube.com", "youtu.be", "pinterest.com", "pinterest.fr", "pin.it", "snapchat.com",
  "threads.net", "whatsapp.com", "wa.me", "linktr.ee", "pagesjaunes.fr", "goo.gl", "g.page", "g.co", "maps.google.com",
  "maps.google.fr", "business.google.com", "waze.com", "mappy.com", "bing.com", "maps.apple.com", "tripadvisor.fr", "tripadvisor.com",
  "yelp.fr", "yelp.com", "houzz.fr", "houzz.com", "societe.com", "pappers.fr", "infogreffe.fr", "verif.com", "manageo.fr",
  "kompass.com", "data.gouv.fr", "leboncoin.fr", "starofservice.com", "habitatpresto.com", "travaux.com", "justacote.com", "118712.fr",
  "calendly.com", "doctolib.fr",
];
/** Hôtes exclus tels quels (sans leurs sous-domaines : un site fait avec Google Sites reste lisible). */
export const HOTES_EXCLUS = ["google.com", "www.google.com", "google.fr", "www.google.fr"];

/** Vrai si l'hôte n'est pas le site d'une entreprise (réseau social, annuaire, carte…). */
export function hoteExclu(hote) {
  const h = String(hote).toLowerCase().replace(/\.$/, "");
  return HOTES_EXCLUS.includes(h) || DOMAINES_EXCLUS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Les ports du web seulement : 80 et 443 (ou le port par défaut du protocole). */
export function portPermis(url) {
  return url.port === "" || url.port === "80" || url.port === "443";
}

/**
 * Une adresse qu'un script peut demander : http(s), sans identifiants, port 80 ou 443, hôte public et hors réseaux sociaux, annuaires
 * et cartes. Le contrôle synchrone (sans DNS) : voir creerControleHotes pour le contrôle complet.
 */
export function adresseLisible(url) {
  let u;
  try {
    u = url instanceof URL ? url : new URL(String(url));
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password || !portPermis(u)) return false;
  return hotePublic(u.hostname) && !hoteExclu(u.hostname);
}

/** Les adresses de départ d'un site : HTTPS puis HTTP. Vide si l'adresse est invalide ou non publique (les exclusions sont à part). */
export function adressesDeDepart(site) {
  const brut = String(site ?? "").trim();
  if (!brut) return [];
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`);
  } catch {
    return [];
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !portPermis(u) || !hotePublic(u.hostname)) {
    return [];
  }
  u.hash = "";
  const securise = new URL(u.href);
  securise.protocol = "https:";
  const simple = new URL(u.href);
  simple.protocol = "http:";
  return [securise.href, simple.href];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Le DNS : un nom public peut pointer vers une adresse interne (« 127.0.0.1.nip.io », un site mal configuré ou piégé)
// ---------------------------------------------------------------------------------------------------------------------------------

function ipv4Publique(ip) {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // « ce réseau », privé, bouclage, multicast et réservé
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT (100.64.0.0/10)
  if (a === 169 && b === 254) return false; // lien local (dont 169.254.169.254, les métadonnées des clouds)
  if (a === 172 && b >= 16 && b <= 31) return false; // privé
  if (a === 192 && b === 168) return false; // privé
  if (a === 192 && b === 0 && c === 0) return false; // réservé à l'IETF
  if (a === 198 && (b === 18 || b === 19)) return false; // bancs d'essai, souvent internes
  return true;
}

/** Les 8 groupes de 16 bits d'une adresse IPv6 valide (« :: » développé, IPv4 finale convertie). */
function groupesIpv6(ip) {
  let s = ip.split("%")[0];
  const v4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const o = v4[2].split(".").map(Number);
    s = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [tete, queue] = s.split("::");
  const debut = tete ? tete.split(":") : [];
  const fin = queue === undefined ? null : queue ? queue.split(":") : [];
  const tous = fin === null ? debut : [...debut, ...Array(8 - debut.length - fin.length).fill("0"), ...fin];
  return tous.map((g) => parseInt(g, 16));
}

function ipv4Dans(g6, g7) {
  return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
}

function ipv6Publique(ip) {
  const g = groupesIpv6(ip);
  if (g.length !== 8 || g.some((x) => !Number.isInteger(x) || x < 0 || x > 0xffff)) return false;
  const zerosAvant = (n) => g.slice(0, n).every((x) => x === 0);
  if (zerosAvant(6)) return ipv4Publique(ipv4Dans(g[6], g[7])); // ::, ::1 et IPv4 « compatible »
  if (zerosAvant(5) && g[5] === 0xffff) return ipv4Publique(ipv4Dans(g[6], g[7])); // IPv4 dans IPv6 (::ffff:a.b.c.d)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return ipv4Publique(ipv4Dans(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return ipv4Publique(ipv4Dans(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return false; // ULA (fc00::/7)
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return false; // lien local, site local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  return true;
}

/** Vrai pour une adresse IP joignable sur Internet : jamais bouclage, réseau privé, lien local, CGNAT, ULA, multicast ni réservée. */
export function ipPublique(adresse) {
  const ip = String(adresse ?? "").trim().toLowerCase();
  if (isIPv4(ip)) return ipv4Publique(ip);
  if (isIPv6(ip)) return ipv6Publique(ip);
  return false;
}

/** Vrai si le nom se résout, et seulement vers des adresses publiques. Une erreur de résolution vaut refus. */
export async function resolutionPublique(hote, resoudre = lookup) {
  try {
    const reponse = await resoudre(String(hote), { all: true, verbatim: true });
    const adresses = (Array.isArray(reponse) ? reponse : [reponse]).map((a) => (typeof a === "string" ? a : a?.address));
    return adresses.length > 0 && adresses.every((a) => ipPublique(a));
  } catch {
    return false;
  }
}

/**
 * Le contrôle complet d'une adresse avant une requête : adresseLisible, puis le DNS (chaque nom n'est résolu qu'une fois par passage).
 * @param {{ resoudre?: (hote: string, options: object) => Promise<unknown> }} [options] le résolveur (dns.promises.lookup par défaut)
 * @returns {(url: string | URL) => Promise<boolean>}
 */
export function creerControleHotes({ resoudre = lookup } = {}) {
  const resultats = new Map();
  return async function adresseSure(url) {
    let u;
    try {
      u = url instanceof URL ? url : new URL(String(url));
    } catch {
      return false;
    }
    if (!adresseLisible(u)) return false;
    const hote = u.hostname.toLowerCase().replace(/\.$/, "");
    let promesse = resultats.get(hote);
    if (!promesse) {
      promesse = resolutionPublique(hote, resoudre);
      resultats.set(hote, promesse);
    }
    return promesse;
  };
}
