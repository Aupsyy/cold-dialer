// Les garde-fous de la config (config/garde-fous.ts) : aucune promesse de résultat, aucun tiret cadratin, aucune URL ni e-mail hors des
// champs prévus, aucune clé.
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyserNiche } from "../config/charger.ts";
import { PROMESSES_INTERDITES, textesDitsAuProspect, verifierGardeFous } from "../config/garde-fous.ts";
import { schemaNiche } from "../config/schema.ts";
import { exemple } from "./aides.mjs";

function violations(modifier) {
  const n = exemple();
  modifier(n);
  return verifierGardeFous(schemaNiche.parse(n));
}

test("l'exemple ne déclenche aucun garde-fou", () => {
  assert.deepEqual(verifierGardeFous(schemaNiche.parse(exemple())), []);
});

test("les promesses chiffrées sont refusées", () => {
  const promesses = [
    "Nous vous apportons 30 clients par mois.",
    "+20 % de chiffre d'affaires",
    "500 € de plus chaque semaine",
    "10 rendez-vous qualifiés",
    "3 RDV par semaine",
    "15 leads chauds",
    "40 prospects",
    "12 chantiers signés",
    "un retour sur investissement de 3x",
    "2k€ de marge",
  ];
  for (const p of promesses) {
    assert.ok(PROMESSES_INTERDITES.some((m) => m.test(p)), `non détecté : ${p}`);
  }
});

test("garanti, assuré, doubler, sans risque, résultats sûrs, délais promis : refusés", () => {
  for (const p of [
    "Résultat garanti.",
    "C'est garantie à vie",
    "Succès assuré",
    "On double votre activité",
    "Tripler vos demandes",
    "Sans risque pour vous",
    "Des résultats certains",
    "en 3 mois",
    "en 6 semaines",
    "en 10 jours",
  ]) {
    assert.ok(PROMESSES_INTERDITES.some((m) => m.test(p)), `non détecté : ${p}`);
  }
});

test("les phrases honnêtes passent", () => {
  for (const p of [
    "Le plus simple, c'est d'en parler vingt minutes en visio.",
    "Vous avez 2 minutes ?",
    "Je vous propose [deux créneaux].",
    "Nous travaillons avec des entreprises de 2 à 20 personnes.",
    "3 xylophones",
  ]) {
    assert.ok(!PROMESSES_INTERDITES.some((m) => m.test(p)), `faux positif : ${p}`);
  }
});

test("chaque texte dit au prospect est contrôlé : promesse, pitch, close, objections, ouverture, messagerie, accroches", () => {
  const chemins = textesDitsAuProspect(schemaNiche.parse(exemple())).map(([c]) => c);
  for (const attendu of ["offre.promesse", "script.pitch", "script.close", "objections.0.reponse", "objections.0.relance",
    "script.ouverture.portable", "script.messagerie", "accroche.exemples.2"]) {
    assert.ok(chemins.includes(attendu), `chemin non contrôlé : ${attendu}`);
  }
  const v = violations((n) => {
    n.objections[2].reponse = "Avec nous, c'est 15 clients en plus, garanti.";
  });
  assert.ok(v.some((x) => x.chemin === "objections.2.reponse" && x.regle === "promesse"));
});

test("le tiret cadratin est refusé partout", () => {
  const v = violations((n) => {
    n.cible.description = "Des paysagistes — surtout en ville.";
  });
  assert.ok(v.some((x) => x.regle === "tiret_cadratin" && x.chemin === "cible.description"));
});

test("une URL n'est permise que dans agenda.lienReservation (et l'adresse du robot)", () => {
  const v = violations((n) => {
    n.script.pitch = "Voyez nos résultats sur https://example.org/cas, puis je vous propose [deux créneaux].";
  });
  assert.ok(v.some((x) => x.regle === "url" && x.chemin === "script.pitch"));
  const w = violations((n) => {
    n.offre.mecanisme = "Voir www.example.org pour le détail.";
  });
  assert.ok(w.some((x) => x.regle === "url"));
  assert.deepEqual(
    violations((n) => {
      n.agenda = { fournisseur: "calendly", lienReservation: "https://example.org/reserver", prefill: true, champLead: "utm_content" };
    }),
    [],
  );
});

test("un e-mail n'est permis que dans legal.contactRGPD", () => {
  const v = violations((n) => {
    n.legal.phraseOpposition = "Écrivez à stop@example.org pour ne plus être appelé.";
  });
  assert.ok(v.some((x) => x.regle === "email" && x.chemin === "legal.phraseOpposition"));
});

test("aucune clé : sk_, eyJ, key=, token, secret ; la valeur n'est jamais recopiée dans le message", () => {
  for (const motif of ["sk" + "_live_abc", "ey" + "Jabc.def", "api" + "key=123", "mon to" + "ken", "le se" + "cret"]) {
    const v = violations((n) => {
      n.offre.nom = motif;
    });
    const cle = v.find((x) => x.regle === "cle");
    assert.ok(cle, `non détecté : ${motif}`);
    assert.ok(!cle.extrait.includes(motif));
  }
});

test("le chargeur rend des messages lisibles pour chaque garde-fou", () => {
  const n = exemple();
  n.offre.promesse = "Doublez vos demandes de devis en 3 mois.";
  const r = analyserNiche(n);
  assert.equal(r.ok, false);
  assert.ok(r.problemes.some((p) => p.startsWith("offre.promesse : promesse de résultat interdite")));
});
