// Le script rempli (lib/poste/script.ts) : chaque crochet de CROCHETS_CONNUS, les valeurs manquantes, les deux créneaux, les noms, et le
// script complet de la niche d'exemple. Tout le texte dit au prospect vient de la config.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { CROCHETS_CONNUS } from "../config/schema.ts";
import { deuxCreneaux } from "../lib/poste/creneaux.ts";
import {
  CROCHETS,
  crochetsManquants,
  nomDirigeant,
  premierPrenom,
  prenomDirigeant,
  remplirLeScript,
  remplirScript,
  segmentsScript,
  texteDesSegments,
  titreNom,
} from "../lib/poste/script.ts";
import { exemple } from "./aides.mjs";

const COMPLET = {
  prenom: "Camille",
  nom: "Démo",
  entreprise: "Atelier Démo 01",
  ville: "Lyon",
  metier: "Paysagiste",
  tonPrenom: "Alex",
  equipe: "Atelier Démo",
  deuxCreneaux: "demain à 10 h ou jeudi à 14 h 30",
  vouvoiement: true,
};

test("le Poste connaît exactement les crochets du schéma", () => {
  assert.deepEqual([...CROCHETS], [...CROCHETS_CONNUS]);
});

test("remplirScript : chaque crochet est remplacé", () => {
  const texte = CROCHETS.join(" | ");
  assert.equal(
    remplirScript(texte, COMPLET),
    "Camille | Démo | Atelier Démo 01 | Lyon | paysagiste | Alex | Atelier Démo | demain à 10 h ou jeudi à 14 h 30",
  );
  assert.deepEqual(crochetsManquants(texte, COMPLET), []);
  const segments = segmentsScript("Bonjour [prénom] !", COMPLET);
  assert.deepEqual(segments, [{ texte: "Bonjour " }, { texte: "Camille", crochet: "[prénom]" }, { texte: " !" }]);
});

test("remplirScript : les deux créneaux calculés pour maintenant, dans le fuseau de la config", () => {
  const d = deuxCreneaux(Date.parse("2026-11-09T10:00:00Z"), { fuseau: "Europe/Paris", pays: "FR" }, { dureeMin: 20 });
  const close = "Je peux vous proposer [deux créneaux] : lequel vous arrange le mieux ?";
  assert.equal(
    remplirScript(close, { ...COMPLET, deuxCreneaux: d.texte }),
    "Je peux vous proposer demain à 10 h ou jeudi à 14 h 30 : lequel vous arrange le mieux ?",
  );
});

test("valeurs manquantes : jamais de trou ni de crochet dit au prospect (sauf ton prénom)", () => {
  const vide = { ...COMPLET, prenom: null, nom: null, entreprise: null, ville: null, metier: null, tonPrenom: null, deuxCreneaux: null };
  assert.equal(remplirScript("Bonjour [prénom], [ton prénom] de [équipe].", vide), "Bonjour, [ton prénom] de Atelier Démo.");
  assert.equal(
    remplirScript("Vous dirigez [entreprise] à [ville] : je suis bien avec le gérant ?", vide),
    "Vous dirigez votre entreprise : je suis bien avec le gérant ?",
  );
  assert.equal(remplirScript("Des chantiers sur [ville].", vide), "Des chantiers.");
  assert.equal(remplirScript("Bonjour [prénom] [nom], ça va ?", vide), "Bonjour, ça va ?");
  assert.equal(remplirScript("Les entreprises de [métier] comme [entreprise].", { ...vide, vouvoiement: false }), "Les entreprises de ton métier comme ton entreprise.");
  assert.deepEqual(crochetsManquants("[ton prénom] et [deux créneaux] et [ville]", vide), ["[ton prénom]", "[deux créneaux]", "[ville]"]);
  const s = segmentsScript("Je vous propose [deux créneaux].", vide);
  assert.deepEqual(s[1], { texte: "[deux créneaux]", crochet: "[deux créneaux]", manquant: true });
  assert.equal(texteDesSegments(s), "Je vous propose [deux créneaux].");
});

test("un texte sans crochet reste tel quel", () => {
  const t = "Le prix dépend de votre zone : on le voit ensemble.";
  assert.equal(remplirScript(t, COMPLET), t);
  assert.deepEqual(segmentsScript(t, COMPLET), [{ texte: t }]);
});

test("les noms : prénom et nom du dirigeant, prénom de la personne qui appelle", () => {
  assert.equal(prenomDirigeant("CAMILLE DÉMO"), "Camille");
  assert.equal(nomDirigeant("CAMILLE DÉMO"), "Démo");
  assert.equal(prenomDirigeant("M. jean-marc d'arcy"), "Jean-Marc");
  assert.equal(nomDirigeant("Mme Lou Démo Exemple"), "Démo Exemple");
  assert.equal(prenomDirigeant("  "), null);
  assert.equal(nomDirigeant("Lou"), null);
  assert.equal(premierPrenom("alex démo"), "Alex");
  assert.equal(premierPrenom(null), null);
  assert.equal(titreNom("ÉLODIE"), "Élodie");
});

test("le script complet de la niche d'exemple : tout vient de la config, crochets remplis", () => {
  const niche = chargerNiche(exemple());
  const s = remplirLeScript(niche, COMPLET, { enregistrement: false });
  assert.equal(s.annonce, null, "sans enregistrement : pas d'annonce");
  assert.equal(
    texteDesSegments(s.ouverture.portable),
    "Bonjour Camille, Alex de Atelier Démo. Je vous appelle parce que vous dirigez Atelier Démo 01 à Lyon : je suis bien avec le gérant ?",
  );
  assert.match(texteDesSegments(s.ouverture.standard), /^Bonjour, Alex de Atelier Démo\. J'aimerais parler au gérant de Atelier Démo 01/);
  assert.equal(s.questions.length, niche.script.questions.length);
  assert.equal(s.questions[0].but, niche.script.questions[0].but);
  assert.match(texteDesSegments(s.close), /demain à 10 h ou jeudi à 14 h 30/);
  assert.equal(s.objections.at(-1).code, "libre", "l'objection « libre » ajoutée par le chargeur");
  assert.ok(s.objections.find((o) => o.code === "pas-le-temps").relance, "la relance d'une objection");
  assert.equal(texteDesSegments(s.phrasePrix), niche.offre.phrasePrix);
  assert.equal(s.phraseSource, niche.legal.phraseSource);
  assert.deepEqual(s.manquants, []);
  const avec = remplirLeScript(niche, { ...COMPLET, tonPrenom: null }, { enregistrement: true });
  assert.equal(avec.annonce, niche.legal.annonceEnregistrement, "avec enregistrement : l'annonce de la config en tête");
  assert.deepEqual(avec.manquants, ["[ton prénom]"]);
});
