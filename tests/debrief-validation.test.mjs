// La validation STRICTE du JSON d'un débrief (scripts/debrief/lib.mjs, schéma : docs/debrief.md) contre la config d'exemple (niche
// fictive « paysagistes »). Dialogues inventés, numéros de la plage réservée à la fiction (01 99 00), aucune donnée réelle.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import {
  citationNette,
  codesPermis,
  dateIsoStricte,
  normaliserNom,
  normaliserTelephone,
  pourComparer,
  tel9,
  validerDebrief,
  verifierCitations,
  verifierIssue,
} from "../scripts/debrief/lib.mjs";
import { exemple } from "./aides.mjs";
import { debrief } from "./debrief-exemple.mjs";

const niche = chargerNiche(exemple());
const MAINTENANT = Date.parse("2026-11-09T16:00:00+01:00");

const valider = (entree) => validerDebrief(entree, niche, { maintenant: MAINTENANT });
const erreurs = (entree) => {
  const v = valider(entree);
  assert.equal(v.ok, false, "le débrief aurait dû être refusé");
  return v.erreurs.join("\n");
};

test("un débrief complet passe, normalisé (tags en minuscules, champs vides retirés)", () => {
  const v = valider(debrief());
  assert.equal(v.ok, true, v.erreurs.join("\n"));
  const d = v.donnees;
  assert.equal(d.source, "colle");
  assert.equal(d.lead.e164, "+33199000007");
  assert.equal(d.appel.debut, "2026-11-09T14:20:00.000Z");
  assert.deepEqual(d.extraction.tags, ["plateformes", "distance"]);
  assert.deepEqual(d.extraction.champs, { source_clients: "Bouche-à-oreille, un peu les plateformes" });
  assert.equal(d.verdict, "utile");
  assert.equal(d.transcription.length, 4);
  assert.deepEqual(v.avertissements, []);
});

test("codes contraints : issue, objection, verdict, prochaine étape, locuteur", () => {
  assert.match(erreurs(debrief({ issue: "gagne" })), /extraction\.issue : code d'issue obligatoire \(permis : pas_repondu, .*sous_contrat\)/);
  assert.match(erreurs(debrief({ issue: undefined })), /extraction\.issue/);
  assert.match(erreurs(debrief({ objection: "trop-cher" })), /extraction\.objection : code inconnu \(permis : .*libre/);
  assert.equal(valider(debrief({ objection: "libre", objection_texte: "Il attend la fin de la saison." })).ok, true);
  assert.equal(valider(debrief({ objection: null })).ok, true);
  assert.match(erreurs(debrief({ objection: null, objection_texte: "Ses mots." })), /donne aussi extraction\.objection/);
  assert.match(erreurs(debrief({}, { verdict_accroche: "accroche" })), /verdict_accroche : verdict inconnu \(permis : utile, neutre, contre-productive/);
  assert.equal(valider(debrief({}, { verdict_accroche: null })).ok, true);
  assert.match(erreurs(debrief({ prochaine_etape: { type: "r1", date: null } })), /prochaine_etape\.type : type inconnu/);
  assert.match(erreurs(debrief({ prochaine_etape: { type: "rappel", date: null } })), /un rappel a une date/);
  const t = debrief();
  t.transcription[0].locuteur = "moi";
  assert.match(erreurs(t), /transcription\[0\]\.locuteur : « appelant » ou « prospect »/);
});

test("les champs de découverte viennent de la config : une clé inconnue est refusée", () => {
  const e = erreurs(debrief({ source_projets_actuelle: "Réseau" }));
  assert.match(e, /extraction\.source_projets_actuelle : clé inconnue \(champs de la config : source_clients, chantiers_voulus, frein_principal, zone, capacite\)/);
  assert.equal(valider(debrief({ capacite: "Oui, au printemps" })).ok, true, "les questions du script sont des champs aussi");
  assert.match(erreurs(debrief({ zone: ["Lyon"] })), /extraction\.zone : texte attendu/);
  assert.match(erreurs(debrief({ zone: "z".repeat(601) })), /extraction\.zone : 600 caractères au plus/);
  assert.match(erreurs(debrief({}, { inconnu: 1 })), /inconnu : clé inconnue/);
});

test("un champ de la config au nom réservé est signalé (config à corriger)", () => {
  const n = structuredClone(niche);
  n.debrief.champs.push({ id: "tags", question: "Quels tags ?" });
  const v = validerDebrief(debrief(), n, { maintenant: MAINTENANT });
  assert.equal(v.ok, false);
  assert.match(v.erreurs[0], /config : champ de découverte au nom réservé \(tags\)/);
});

test("citations : non vides, bornées, et MOT POUR MOT dans ce que le prospect a dit", () => {
  assert.equal(valider(debrief({ citations: ["« Surtout le bouche-à-oreille, et un peu les plateformes. »"] })).ok, true, "guillemets retirés");
  assert.equal(valider(debrief({ citations: ["surtout le bouche-à-oreille,   et un peu les plateformes"] })).ok, true, "casse et espaces");
  assert.equal(valider(debrief({ citations: ["… je ne peux pas suivre"] })).ok, true, "points de suspension autour");
  assert.match(erreurs(debrief({ citations: ["Les plateformes m'envoient trop de demandes."] })), /citations\[0\] : introuvable mot pour mot/);
  assert.match(erreurs(debrief({ citations: ["vos clients arrivent surtout comment"] })), /citations\[0\] : phrase de l'appelant/);
  assert.match(erreurs(debrief({ citations: [""] })), /citations\[0\] : élément vide/);
  assert.match(erreurs(debrief({ citations: ["« »"] })), /citations\[0\] : citation vide/);
  assert.match(erreurs(debrief({ citations: ["mot ".repeat(80)] })), /citations\[0\] : 300 caractères au plus/);
  assert.match(erreurs(debrief({ citations: Array(11).fill("Surtout le bouche-à-oreille") })), /extraction\.citations : 10 éléments au plus/);
  const sans = valider(debrief({}, { transcription: [] }));
  assert.equal(sans.ok, true);
  assert.deepEqual(sans.avertissements, ["extraction.citations : non vérifiées (aucune transcription)"]);
  const courte = valider(debrief({ citations: ["je ne peux"] }));
  assert.match(courte.avertissements.join(), /citation très courte/);
});

test("dates ISO avec fuseau, jamais dans le futur ; durée bornée", () => {
  assert.match(erreurs(debrief({}, { appel: { debut: "2026-11-09 15:20" } })), /appel\.debut : date ISO 8601 avec fuseau/);
  assert.match(erreurs(debrief({}, { appel: { debut: "2026-11-09T15:20:00" } })), /appel\.debut : date ISO 8601 avec fuseau/);
  assert.match(erreurs(debrief({}, { appel: { debut: "2026-11-10T15:20:00+01:00" } })), /appel\.debut : date dans le futur/);
  assert.match(erreurs(debrief({}, { appel: { duree_s: 60 } })), /appel\.debut : obligatoire/);
  assert.match(erreurs(debrief({}, { appel: { debut: "2026-11-09T15:20:00+01:00", duree_s: -1 } })), /appel\.duree_s : entier de 0 à 86400/);
  assert.match(erreurs(debrief({}, { appel: { debut: "2026-11-09T15:20:00Z", duree: 3 } })), /appel\.duree : clé inconnue/);
  assert.equal(dateIsoStricte("2026-11-09T15:20:00Z"), "2026-11-09T15:20:00.000Z");
  assert.equal(dateIsoStricte("2026-11-09T15:20+0100"), "2026-11-09T14:20:00.000Z");
  assert.equal(dateIsoStricte("2026-13-09T15:20:00Z"), null);
  assert.equal(dateIsoStricte("1999-12-31T23:00:00Z"), null);
  assert.equal(dateIsoStricte("demain"), null);
});

test("la fiche : id, téléphone ou entreprise ; créer exige le nom ; un appel en base suffit", () => {
  assert.match(erreurs(debrief({}, { lead: {} })), /lead : il faut lead\.id, lead\.telephone ou lead\.entreprise/);
  assert.match(erreurs(debrief({}, { lead: { id: "pas-un-uuid" } })), /lead\.id : identifiant de fiche \(uuid\) attendu/);
  assert.match(erreurs(debrief({}, { lead: { telephone: "12 34" } })), /lead\.telephone : numéro illisible/);
  assert.match(erreurs(debrief({}, { lead: { telephone: "01 99 00 00 07" }, creer_si_absent: true })), /creer_si_absent : lead\.entreprise est obligatoire/);
  assert.match(erreurs(debrief({}, { lead: { siren: "000000001" } })), /lead\.siren : clé inconnue/);
  const appel = valider(debrief({}, { lead: null, source: undefined, transcription: [], appel: { externe_id: "appel-demo-1" } }));
  assert.equal(appel.ok, true, appel.erreurs.join("\n"));
  assert.equal(appel.donnees.source, "appel");
  assert.equal(appel.donnees.appel.fournisseur, "telephone", "le fournisseur de la config par défaut");
  assert.match(erreurs(debrief({}, { source: "appel" })), /source : « appel » exige appel\.externe_id/);
  assert.match(erreurs(debrief({}, { source: "micro" })), /source : source inconnue/);
});

test("bornes : tags, douleurs, transcription", () => {
  assert.match(erreurs(debrief({ tags: ["Pas un code !"] })), /extraction\.tags\[0\] : code en minuscules/);
  assert.match(erreurs(debrief({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })), /extraction\.tags : 10 tags au plus/);
  assert.match(erreurs(debrief({ tags: Array.from({ length: 10 }, (_, i) => `${"t".repeat(39)}${i}`) })), /400 caractères au plus au total/);
  assert.match(erreurs(debrief({ douleurs: ["d".repeat(401)] })), /extraction\.douleurs\[0\] : 400 caractères au plus/);
  assert.match(erreurs(debrief({ douleurs: "Une seule douleur" })), /extraction\.douleurs : liste de textes attendue/);
  assert.match(erreurs(debrief({ interet: 5 })), /extraction\.interet : entier de 0 à 3/);
  assert.match(erreurs(debrief({ interet: 1.5 })), /extraction\.interet/);
  assert.match(erreurs(debrief({ decideur_joint: "oui" })), /extraction\.decideur_joint : true, false ou null/);
  const longue = debrief();
  longue.transcription = [{ locuteur: "prospect", texte: "x".repeat(4001) }];
  assert.match(erreurs({ ...longue, extraction: { ...longue.extraction, citations: [] } }), /transcription\[0\]\.texte : 4000 caractères au plus/);
  assert.match(erreurs(debrief({}, { transcription: "pas une liste" })), /transcription : liste attendue/);
  assert.match(erreurs(null), /objet JSON/);
  assert.match(erreurs(debrief({}, { version: 2 })), /seule la version 1 existe/);
});

test("rien d'inventé : un champ absent reste vide", () => {
  const v = valider(debrief({ douleurs: undefined, citations: undefined, interet: null, decideur_joint: null, prochaine_etape: null, resume: undefined }));
  assert.equal(v.ok, true, v.erreurs.join("\n"));
  const x = v.donnees.extraction;
  assert.deepEqual([x.douleurs, x.citations, x.interet, x.decideurJoint, x.prochaineEtape, x.resume], [[], [], null, null, null, null]);
});

test("les messages d'erreur ne recopient jamais une valeur du JSON", () => {
  const secret = "Valeur-Fictive-A-Ne-Pas-Recopier";
  const e = erreurs(
    debrief({ issue: secret, objection: secret, citations: [secret], zone: secret.repeat(40), tags: [secret] }, { verdict_accroche: secret, lead: { telephone: secret } }),
  );
  assert.ok(!e.includes(secret), "une valeur du débrief apparaît dans un message");
  assert.ok(!e.toLowerCase().includes(secret.toLowerCase()));
});

test("--issue : jamais rdv_fixe ; un rappel daté dans les bornes de la base", () => {
  const d = (x) => valider(debrief(x)).donnees;
  assert.deepEqual(verifierIssue(d({}), niche, MAINTENANT), []);
  assert.match(verifierIssue(d({ issue: "rdv_fixe", prochaine_etape: null }), niche, MAINTENANT).join(), /rdv_fixe/);
  assert.match(verifierIssue(d({ prochaine_etape: { type: "mail", date: null } }), niche, MAINTENANT).join(), /exige extraction\.prochaine_etape\.date/);
  assert.match(verifierIssue(d({ prochaine_etape: { type: "rappel", date: "2026-11-01T10:00:00+01:00" } }), niche, MAINTENANT).join(), /entre hier et dans 400 jours/);
  assert.deepEqual(verifierIssue(d({ issue: "pas_interesse", prochaine_etape: null }), niche, MAINTENANT), []);
});

test("normalisations : E.164 (comme la base), 9 derniers chiffres, nom d'entreprise", () => {
  assert.equal(normaliserTelephone("01 99 00 00 07"), "+33199000007");
  assert.equal(normaliserTelephone("+33 (0)1 99 00 00 07"), "+33199000007");
  assert.equal(normaliserTelephone("0033 6 39 98 00 01"), "+33639980001");
  assert.equal(normaliserTelephone("33199000007"), "+33199000007");
  assert.equal(normaliserTelephone("0470 00 00 01", "BE"), "+32470000001");
  assert.equal(normaliserTelephone("514 555 0123", "CA"), "+15145550123");
  assert.equal(normaliserTelephone("12"), null);
  assert.equal(normaliserTelephone("+33 1 99 00"), null);
  assert.equal(tel9("+33 1 99 00 00 07"), "199000007");
  assert.equal(tel9("01.99.00.00.07"), "199000007");
  assert.equal(tel9("123"), null);
  assert.equal(normaliserNom("  Atelier DÉMO 07 & Fils  "), "atelier demo 07 fils");
  assert.equal(normaliserNom("Cœur de Jardin"), "coeur de jardin");
});

test("comparaison mot pour mot : apostrophes, guillemets, espaces typographiques", () => {
  assert.equal(pourComparer("C’est « trop loin » !"), "c'est trop loin!");
  assert.equal(citationNette("« … ça ne m'intéresse pas… »"), "ça ne m'intéresse pas");
  const lignes = [
    { locuteur: "appelant", texte: "Vous avez une minute ?" },
    { locuteur: "inconnu", texte: "Une minute, pas plus." },
  ];
  assert.deepEqual(verifierCitations(["Une minute, pas plus.", "vous avez une minute", "inventée de toutes pièces"], lignes), {
    introuvables: [2],
    deLAppelant: [1],
  });
});

test("codesPermis : « libre » toujours permis", () => {
  const c = codesPermis({ ...niche, objections: niche.objections.filter((o) => o.code !== "libre") });
  assert.ok(c.objections.includes("libre"));
  assert.equal(c.issues.length, niche.issues.length);
});
