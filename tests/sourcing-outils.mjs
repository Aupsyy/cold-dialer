// Outils partagés par les tests du sourcing (tests/sourcing-*.test.mjs). Tout est fictif :
//   - SIREN : la suite 000000001, 000000002… en sautant ceux qui passent la clé de Luhn (aucun ne peut être un vrai SIREN) ;
//   - numéros : les plages réservées à la fiction par l'ARCEP (01 99 00 xx xx, 06 39 98 xx xx) ;
//   - e-mails et sites : les domaines réservés aux exemples (example.com, example.org, example.net) ;
//   - entreprises « Atelier Démo 01 »… ; aucun fichier de données dans le dépôt : les CSV sont écrits dans un dossier temporaire.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exemple } from "./aides.mjs";

/** Vrai si 9 chiffres passent la clé de Luhn (un SIREN réel possible). */
export function luhn(chiffres) {
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let c = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) c = c * 2 > 9 ? c * 2 - 9 : c * 2;
    somme += c;
  }
  return somme % 10 === 0;
}

const SIRENS = [];
let prochain = 1;

/** Le n-ième SIREN fictif (n ≥ 1) : 9 chiffres qui échouent à la clé de Luhn. */
export function sirenFictif(n) {
  while (SIRENS.length < n) {
    const s = String(prochain++).padStart(9, "0");
    if (!luhn(s)) SIRENS.push(s);
  }
  return SIRENS[n - 1];
}

/** Un fixe fictif (01 99 00 00 nn) et un mobile fictif (06 39 98 00 nn), au format national. */
export const fixe = (n) => `01 99 00 ${String(Math.floor(n / 100) % 100).padStart(2, "0")} ${String(n % 100).padStart(2, "0")}`;
export const mobile = (n) => `06 39 98 ${String(Math.floor(n / 100) % 100).padStart(2, "0")} ${String(n % 100).padStart(2, "0")}`;
export const e164 = (national) => `+33${national.replace(/\s/g, "").slice(1)}`;

/** Une copie de la niche d'exemple (config/niche.exemple.json), modifiable par le test. */
export const niche = () => exemple();

/** Un dossier temporaire, et sa suppression. */
export function dossierTemporaire() {
  const chemin = mkdtempSync(join(tmpdir(), "sourcing-test-"));
  return { chemin, supprimer: () => rmSync(chemin, { recursive: true, force: true }) };
}

/** Une fausse horloge : attendre(ms) avance le temps sans attendre ; journal des attentes. */
export function fausseHorloge(depart = 0) {
  const etat = { t: depart, attentes: [] };
  return {
    etat,
    horloge: () => etat.t,
    attendre: async (ms) => {
      etat.attentes.push(ms);
      etat.t += ms;
    },
  };
}

/** Une réponse HTTP minimale (ce que lisent les scripts : ok, status, url, headers.get, text, json). */
export function reponse(corps, { status = 200, type = "text/html; charset=utf-8", url = "", entetes = {} } = {}) {
  const h = { "content-type": type, ...entetes };
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (nom) => h[nom.toLowerCase()] ?? null },
    text: async () => (typeof corps === "string" ? corps : JSON.stringify(corps)),
    json: async () => (typeof corps === "string" ? JSON.parse(corps) : corps),
  };
}
