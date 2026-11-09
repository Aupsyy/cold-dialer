// Ce que le débrief écrit (scripts/debrief/lib.mjs et ecrire.mjs) : note datée « clé : valeur », ligne retours_marche, extraction gardée
// en base, mise à jour des SEULS champs vides de la fiche, compte rendu en compteurs. Config d'exemple, données fictives.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { VERDICT_EN_BASE as VERDICTS_TS } from "../lib/retours/libelles.ts";
import { lignesCompteRendu } from "../scripts/debrief/ecrire.mjs";
import {
  BORNES,
  composerNote,
  extractionPourBase,
  ligneRetour,
  lireTranscriptionAppel,
  majFiche,
  transcriptionEnTexte,
  validerDebrief,
  VERDICT_EN_BASE,
} from "../scripts/debrief/lib.mjs";
import { exemple } from "./aides.mjs";
import { debrief } from "./debrief-exemple.mjs";

const niche = chargerNiche(exemple());
const MAINTENANT = Date.parse("2026-11-09T16:00:00+01:00");
const donnees = (x = {}, r = {}) => {
  const v = validerDebrief(debrief(x, r), niche, { maintenant: MAINTENANT });
  assert.equal(v.ok, true, v.erreurs.join("\n"));
  return v.donnees;
};

test("la table des verdicts est la même dans le script et dans l'application", () => {
  assert.deepEqual(VERDICT_EN_BASE, VERDICTS_TS);
});

test("note datée : en-tête dans le fuseau de l'équipe, une ligne « clé : valeur » par information dite", () => {
  const note = composerNote(donnees(), niche).replace(/[^\S\n]/gu, " ");
  const lignes = note.split("\n");
  assert.equal(lignes[0], "Débrief de l'appel du 9 nov. 2026 à 15 h 20 (transcription collée)");
  assert.ok(lignes.includes("Issue : À rappeler"));
  assert.ok(lignes.includes("Objection : Je n'ai pas le temps"));
  assert.ok(lignes.includes("Intérêt : 2/3"));
  assert.ok(lignes.includes("Décideur joint : oui"));
  assert.ok(lignes.includes("Accroche : utile"));
  assert.ok(lignes.includes("D'où viennent ses clients aujourd'hui : Bouche-à-oreille, un peu les plateformes"));
  assert.ok(lignes.includes("Douleurs : Demandes trop loin de sa zone"));
  assert.ok(lignes.some((l) => l.startsWith("Citation : « Les plateformes m'envoient")));
  assert.ok(lignes.includes("Prochaine étape : rappel le 12 nov. 2026 à 10 h 00"));
  assert.ok(lignes.includes("Tags : plateformes, distance"));
  // Rien pour ce qui n'a pas été dit.
  assert.ok(!note.includes("Quels chantiers"), "champ vide : pas de ligne");
  assert.ok(!note.includes("Croyances"));
  for (const l of lignes.slice(1)) assert.match(l, /^[^:]+ : .+/, `gabarit clé : valeur (${l.slice(0, 20)})`);
});

test("note datée : bornée à 5000 caractères (lead_activities.note)", () => {
  const long = Object.fromEntries(["source_clients", "chantiers_voulus", "frein_principal", "zone", "capacite"].map((id) => [id, "mot ".repeat(140).trim()]));
  const d = donnees({ ...long, douleurs: Array(10).fill("d".repeat(390)), resume: "r".repeat(590), citations: [] });
  const note = composerNote(d, niche);
  assert.ok(note.length <= BORNES.note);
  assert.ok(note.endsWith("…"));
});

test("retours_marche : la douleur et la citation principales, le verdict traduit pour la base", () => {
  const r = ligneRetour(donnees(), { leadId: "l", debriefId: "d", appelLe: "2026-11-09T14:20:00.000Z" });
  assert.deepEqual(r, {
    lead_id: "l",
    debrief_id: "d",
    appel_le: "2026-11-09T14:20:00.000Z",
    issue: "a_rappeler",
    douleur: "Demandes trop loin de sa zone",
    objection_code: "pas-le-temps",
    objection_texte: null,
    accroche_verdict: "accroche",
    interet: 2,
    decideur_joint: true,
    citation: "Les plateformes m'envoient des demandes à quarante kilomètres, je ne peux pas suivre.",
    tags: ["plateformes", "distance"],
  });
  const vide = ligneRetour(donnees({ douleurs: [], citations: [], decideur_joint: null, objection: null }, { verdict_accroche: "contre-productive" }), {
    leadId: "l",
    debriefId: "d",
    appelLe: "x",
  });
  assert.equal(vide.douleur, null);
  assert.equal(vide.citation, null);
  assert.equal(vide.decideur_joint, false);
  assert.equal(vide.objection_code, null);
  assert.equal(vide.accroche_verdict, "rejet");
});

test("extraction gardée en base : clés stables, compteur de transcription, jamais trop lourde", () => {
  const x = extractionPourBase(donnees());
  assert.deepEqual(Object.keys(x), [
    "version",
    "issue",
    "objection",
    "objection_texte",
    "interet",
    "decideur_joint",
    "resume",
    "douleurs",
    "croyances",
    "citations",
    "champs",
    "prochaine_etape",
    "tags",
    "verdict_accroche",
    "duree_s",
    "transcription_lignes",
  ]);
  assert.equal(x.version, 1);
  assert.equal(x.transcription_lignes, 4);
  assert.equal(x.duree_s, 312);
  assert.deepEqual(x.prochaine_etape, { type: "rappel", date: "2026-11-12T09:00:00.000Z", detail: null });
});

test("fiche : seuls les champs VIDES sont remplis, jamais un champ rempli", () => {
  const d = donnees({ zone: "Une vingtaine de kilomètres autour de l'atelier" }, { lead: { telephone: "01 99 00 00 07", dirigeant: "Camille Démo", ville: "Lyon" } });
  const vierge = majFiche({ statut: "a_appeler", objection: null, dirigeant: null, ville: "", qualification: {} }, d);
  assert.deepEqual(vierge.maj, {
    qualification: { source_clients: "Bouche-à-oreille, un peu les plateformes", zone: "Une vingtaine de kilomètres autour de l'atelier" },
    objection: "pas-le-temps",
    dirigeant: "Camille Démo",
    ville: "Lyon",
  });
  assert.deepEqual(vierge.remplis, ["source_clients", "zone", "objection", "dirigeant", "ville"]);
  assert.deepEqual(vierge.dejaRemplis, []);

  const pleine = majFiche(
    { statut: "a_rappeler", objection: "combien-ca-coute", dirigeant: "Alex Démo", ville: "Bron", qualification: { source_clients: "Déjà noté au Poste", capacite: "oui", zone: "  " } },
    d,
  );
  assert.deepEqual(pleine.maj, {
    qualification: { source_clients: "Déjà noté au Poste", capacite: "oui", zone: "Une vingtaine de kilomètres autour de l'atelier" },
  });
  assert.deepEqual(pleine.remplis, ["zone"]);
  assert.deepEqual(pleine.dejaRemplis, ["source_clients", "objection", "dirigeant", "ville"]);
  assert.deepEqual(majFiche({ qualification: null }, d, { objection: false }).remplis.includes("objection"), false);
});

test("transcription : en texte pour debriefs, et lue depuis un appel en base", () => {
  assert.equal(
    transcriptionEnTexte([
      { locuteur: "appelant", texte: "Bonjour." },
      { locuteur: "prospect", texte: "Bonjour, oui ?" },
      { locuteur: "inconnu", texte: "(inaudible)" },
    ]),
    "Appelant : Bonjour.\nProspect : Bonjour, oui ?\nInconnu : (inaudible)",
  );
  assert.deepEqual(lireTranscriptionAppel([{ t: 0, locuteur: "prospect", texte: "  Allô  " }, { t: 1, locuteur: "x", texte: "Oui" }, { t: 2 }, "texte"]), [
    { locuteur: "prospect", texte: "Allô" },
    { locuteur: "inconnu", texte: "Oui" },
  ]);
  assert.deepEqual(lireTranscriptionAppel(null), []);
});

test("compte rendu en console : des compteurs et des codes, jamais une valeur du débrief", () => {
  const essai = {
    statut: "essai",
    avertissements: [],
    fiche: { id: "11111111-1111-4111-8111-111111111111", par: "telephone", remplis: ["source_clients"], dejaRemplis: ["objection"] },
    debrief: { id: "x", source: "colle", appelLie: false, transcription: { gardee: true, lignes: 4, origine: "json", raison: null }, champs: 1, douleurs: 1, croyances: 0, citations: 1, tags: 2 },
    retour: { id: "y", issue: "a_rappeler", objection: "pas-le-temps", verdict: "utile", verdictBase: "accroche", interet: 2, decideur: true },
    journal: { type: "note", caracteres: 412 },
    issue: { enregistree: false },
  };
  const texte = lignesCompteRendu(essai).join("\n");
  assert.match(texte, /^ESSAI : tout a été contrôlé par la base puis ANNULÉ/);
  assert.match(texte, /transcription gardée \(4 énoncés\)/);
  assert.match(texte, /verdict de l'accroche utile \(« accroche » en base\)/);
  assert.match(texte, /1 rempli\(s\) \(source_clients\), 1 déjà rempli\(s\)/);
  assert.match(texte, /Relance avec --ecrire/);
  const d = donnees();
  for (const valeur of [d.extraction.citations[0], d.extraction.douleurs[0], d.lead.telephone, d.lead.entreprise, d.extraction.champs.source_clients]) {
    assert.ok(!texte.includes(valeur), "une valeur du débrief apparaît en console");
  }
  const creee = lignesCompteRendu({ ...essai, fiche: { ...essai.fiche, par: "creee" } }).join("\n");
  assert.match(creee, /fiche {10}: nouvelle fiche \(serait créée\)/);
  assert.ok(!creee.includes(essai.fiche.id), "en essai, l'identifiant d'une fiche annulée n'est pas montré");
  const arret = lignesCompteRendu({ statut: "arret", raison: "plusieurs fiches correspondent (par telephone) : mets lead.id", candidats: [{ id: "a", statut: "a_appeler", derniere: null }], total: 2 });
  assert.match(arret.join("\n"), /ARRÊT : plusieurs fiches.*\n {2}fiches candidates : 2 \(les 1 premières\)\n {2}a {2}statut a_appeler {2}dernière activité aucune/);
  assert.match(lignesCompteRendu({ statut: "erreur", erreur: "refusé par la base (code 42501)" }).join(), /ERREUR : rien n'est écrit/);
  assert.match(lignesCompteRendu({ statut: "invalide", erreurs: ["a : b"], avertissements: ["c"] }).join("\n"), /attention : c\nJSON REFUSÉ \(1 problème\)/);
});
