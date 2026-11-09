// Étape 7 des accroches : le fichier de relecture, pour un œil humain, avant toute écriture en base.
//
//   node scripts/accroches/revue.mjs [--dossier D]                   écrit donnees/accroches/revue.md
//   node scripts/accroches/revue.mjs --vider <id>[,<id>…]             vide ces accroches dans validees.json (refus à la relecture)
//
// revue.md montre, pour chaque accroche retenue : l'entreprise (si a-crawler.json la connaît), l'accroche, l'extrait du site qui la
// prouve et la page source ; puis les accroches vidées par le contrôle, avec leurs motifs. Une accroche refusée à la relecture est
// vidée, jamais réécrite : la règle est la même que pour le contrôle automatique. La console n'affiche que des compteurs.

import { liste, lireOptions } from "./lib/args.mjs";
import { dossierDeTravail, fichiers } from "./lib/chemins.mjs";
import { ecrireJson, ecrireTexte, lireJson } from "./lib/fichiers.mjs";
import { lancerSiPrincipal } from "./lib/lancer.mjs";
import { LIBELLES_MOTIFS } from "./lib/validation.mjs";

function citation(texte) {
  return `« ${String(texte).replace(/\s+/g, " ").trim()} »`;
}

/** Le Markdown de relecture. */
export function rendreRevue(validees, { noms = new Map(), date }) {
  const retenues = validees.filter((v) => v.accroche && v.motifs.length === 0);
  const videes = validees.filter((v) => v.motifs.length > 0);
  const sans = validees.filter((v) => !v.accroche && v.motifs.length === 0);
  const titre = (v) => noms.get(v.id) ?? `Fiche ${v.id}`;
  const lignes = [
    `# Relecture des accroches (${date})`,
    "",
    `Retenues : ${retenues.length} ; vidées par le contrôle : ${videes.length} ; sans accroche : ${sans.length}.`,
    "",
    "Pour chaque accroche : est-elle vraie (l'extrait le prouve), utile au téléphone, sans flatterie ni promesse ? Sinon, on la vide :",
    "`node scripts/accroches/revue.mjs --vider <id>`. On ne la réécrit jamais.",
    "",
    "## Retenues",
    "",
  ];
  for (const v of retenues) {
    lignes.push(`### ${titre(v)}`, "", `- Accroche : ${citation(v.accroche)}`, `- Extrait du site : ${citation(v.source.extrait)}`);
    lignes.push(`- Page : ${v.source.url} (lue le ${v.source.le})`, `- id : ${v.id}`, "");
  }
  if (videes.length) {
    lignes.push("## Vidées (jamais réécrites)", "");
    for (const v of videes) {
      const motifs = v.motifs.map((m) => `${LIBELLES_MOTIFS[m.code] ?? m.code}${m.detail ? ` (${m.detail})` : ""}`).join(" ; ");
      lignes.push(`### ${titre(v)}`, "");
      if (v.refusee) lignes.push(`- Proposée : ${citation(v.refusee)}`);
      lignes.push(`- Motifs : ${motifs}`, `- id : ${v.id}`, "");
    }
  }
  return lignes.join("\n");
}

/** Vide les accroches désignées (refus humain). Rend le nombre d'accroches vidées et d'identifiants inconnus. */
export function viderALaRelecture(validees, ids) {
  let videes = 0;
  let inconnus = 0;
  for (const id of ids) {
    const v = validees.find((x) => x.id === id);
    if (!v) {
      inconnus++;
      continue;
    }
    if (!v.accroche) continue;
    v.refusee = v.accroche;
    v.accroche = "";
    v.source = null;
    v.motifs = [...v.motifs, { code: "revue" }];
    videes++;
  }
  return { videes, inconnus };
}

export async function principal(argv, { journal = console.log, maintenant = () => new Date() } = {}) {
  const options = lireOptions(argv, { drapeaux: ["aide"], valeurs: ["vider", "dossier"] });
  if (options.aide) {
    journal("Écrit revue.md (accroche, extrait, page) ; --vider <id>[,<id>] vide des accroches refusées à la relecture.");
    return 0;
  }
  const f = fichiers(dossierDeTravail(options.dossier));
  const validees = lireJson(f.validees);
  if (!Array.isArray(validees)) throw new Error("validees.json illisible : relance valide.mjs.");

  const aVider = liste(options, "vider");
  if (aVider) {
    const { videes, inconnus } = viderALaRelecture(validees, aVider);
    ecrireJson(f.validees, validees);
    journal(`Vidées à la relecture : ${videes}${inconnus ? ` ; identifiants inconnus : ${inconnus}` : ""}.`);
  }

  const noms = new Map();
  for (const fiche of lireJson(f.aCrawler, { defaut: [] })) {
    if (fiche && typeof fiche.id === "string" && typeof fiche.entreprise === "string") noms.set(fiche.id, fiche.entreprise);
  }
  const date = maintenant().toISOString().slice(0, 10);
  ecrireTexte(f.revue, `${rendreRevue(validees, { noms, date })}\n`);
  const retenues = validees.filter((v) => v.accroche && v.motifs.length === 0).length;
  journal(`Relecture écrite : ${retenues} accroche(s) retenue(s), ${validees.filter((v) => v.motifs.length > 0).length} vidée(s). Fichier : donnees/accroches/revue.md (ou le dossier choisi).`);
  return 0;
}

lancerSiPrincipal(import.meta.url, principal);
