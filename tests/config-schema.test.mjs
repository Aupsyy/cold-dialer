// Le schéma de config/niche.json (config/schema.ts) et le chargeur (config/charger.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyserNiche, chargerNiche, ErreurConfig, OBJECTION_LIBRE } from "../config/charger.ts";
import { CROCHETS_CONNUS, ISSUES_SOCLE } from "../config/schema.ts";
import { exemple, lire } from "./aides.mjs";

function problemes(modifier) {
  const n = exemple();
  modifier(n);
  const r = analyserNiche(n);
  assert.equal(r.ok, false, "la config modifiée aurait dû être refusée");
  return r.problemes.join("\n");
}

test("la niche d'exemple et config/niche.json sont valides", () => {
  const r = analyserNiche(exemple());
  assert.equal(r.ok, true, r.ok ? "" : r.problemes.join("\n"));
  const n = analyserNiche(JSON.parse(lire("config/niche.json")));
  assert.equal(n.ok, true, n.ok ? "" : n.problemes.join("\n"));
});

test("le chargeur ajoute d'office l'objection « libre », une seule fois", () => {
  const n = chargerNiche(exemple());
  assert.equal(n.objections.filter((o) => o.code === "libre").length, 1);
  assert.deepEqual(n.objections.at(-1), OBJECTION_LIBRE);
  const avecLibre = exemple();
  avecLibre.objections.push({ code: "libre", libelle: "Autre", reponse: "Note la phrase exacte." });
  assert.equal(chargerNiche(avecLibre).objections.filter((o) => o.code === "libre").length, 1);
});

test("une config invalide lève ErreurConfig avec la liste des problèmes", () => {
  const n = exemple();
  delete n.legal;
  assert.throws(() => chargerNiche(n), (e) => e instanceof ErreurConfig && e.problemes.some((p) => p.includes("legal")));
});

test("les messages d'erreur du schéma sont en français, avec le chemin", () => {
  const p = problemes((n) => {
    n.tentativesMax = 99;
  });
  assert.match(p, /tentativesMax/);
  assert.match(p, /Trop grand/);
});

test("une clé inconnue (faute de frappe) est refusée", () => {
  assert.match(
    problemes((n) => {
      n.script.ouvertur = "x";
    }),
    /ouvertur/,
  );
});

test("toutes les issues du socle sont obligatoires", () => {
  assert.equal(ISSUES_SOCLE.length, 8);
  assert.match(
    problemes((n) => {
      n.issues = n.issues.filter((i) => i.code !== "ne_plus_contacter");
    }),
    /issue du socle manquante : ne_plus_contacter/,
  );
});

test("le sens des issues du socle est verrouillé", () => {
  assert.match(
    problemes((n) => {
      n.issues.find((i) => i.code === "rdv_fixe").final = false;
    }),
    /rdv_fixe doit avoir final: true/,
  );
  assert.match(
    problemes((n) => {
      delete n.issues.find((i) => i.code === "a_rappeler").exigeRappel;
    }),
    /exige une date de rappel/,
  );
});

test("codes et touches uniques", () => {
  assert.match(
    problemes((n) => {
      n.issues.push({ ...n.issues[0] });
    }),
    /code d'issue en double : pas_repondu/,
  );
  assert.match(
    problemes((n) => {
      n.issues[1].touche = n.issues[0].touche;
    }),
    /touche en double/,
  );
  assert.match(
    problemes((n) => {
      n.objections.push({ ...n.objections[0] });
    }),
    /code d'objection en double/,
  );
  assert.match(
    problemes((n) => {
      n.objections[0].code = "Pas Le Temps";
    }),
    /code en minuscules et tirets/,
  );
});

test("au téléphone, on ne vend que le rendez-vous", () => {
  assert.match(
    problemes((n) => {
      n.offre.objectifAppel = "vente";
    }),
    /objectifAppel/,
  );
});

test("les crochets : connus, déclarés, et [deux créneaux] dans le close", () => {
  assert.ok(CROCHETS_CONNUS.includes("[deux créneaux]"));
  assert.match(
    problemes((n) => {
      n.script.crochets.push("[pointure]");
    }),
    /crochet inconnu : \[pointure\]/,
  );
  assert.match(
    problemes((n) => {
      n.script.pitch += " Bonjour [métier].";
    }),
    /crochet non déclaré dans script.crochets : \[métier\]/,
  );
  assert.match(
    problemes((n) => {
      n.script.close = "Quand êtes-vous disponible ?";
    }),
    /\[deux créneaux\]/,
  );
});

test("3 à 6 questions de découverte", () => {
  assert.match(
    problemes((n) => {
      n.script.questions = n.script.questions.slice(0, 2);
    }),
    /script\.questions/,
  );
});

test("téléphonie : un mode possible pour le fournisseur, l'enregistrement seulement s'il est envoyé", () => {
  assert.match(
    problemes((n) => {
      n.telephonie.mode = "iframe";
    }),
    /mode iframe impossible avec telephone/,
  );
  assert.match(
    problemes((n) => {
      n.telephonie.enregistrement = true;
    }),
    /n'envoie pas d'enregistrement/,
  );
  const onoff = exemple();
  onoff.telephonie = { fournisseur: "onoff", mode: "extension", copierNumero: true, enregistrement: true };
  assert.equal(analyserNiche(onoff).ok, true);
});

test("agenda : Calendly et iClosed exigent un lien public en https", () => {
  assert.match(
    problemes((n) => {
      n.agenda.fournisseur = "calendly";
    }),
    /le lien public de réservation est obligatoire/,
  );
  assert.match(
    problemes((n) => {
      n.agenda = { fournisseur: "calendly", lienReservation: "http://example.org/r", prefill: true, champLead: "utm_content" };
    }),
    /https/,
  );
  const ok = exemple();
  ok.agenda = { fournisseur: "calendly", lienReservation: "https://example.org/reserver", prefill: true, champLead: "utm_content" };
  assert.equal(analyserNiche(ok).ok, true);
});

test("cohérences : tailles, seuils, règles du score, longueur des accroches, indicatif", () => {
  assert.match(
    problemes((n) => {
      n.cible.tailleMin = 30;
    }),
    /tailleMin/,
  );
  assert.match(
    problemes((n) => {
      n.score.seuils = { A: 40, B: 45 };
    }),
    /seuil A/,
  );
  assert.match(
    problemes((n) => {
      n.score.criteres[0].regle = {};
    }),
    /forme_juridique : il faut une liste inclure ou exclure/,
  );
  assert.match(
    problemes((n) => {
      n.score.criteres.push({ id: "x", type: "naf", regle: { inclure: ["8130Z"] }, points: 5 });
    }),
    /code NAF au format 81.30Z/,
  );
  assert.match(
    problemes((n) => {
      n.accroche.longueurMax = 60;
    }),
    /exemple trop long/,
  );
  assert.match(
    problemes((n) => {
      n.pays.indicatif = "+32";
    }),
    /indicatif attendu pour FR : \+33/,
  );
  assert.match(
    problemes((n) => {
      n.pays.fuseau = "Europe/Atlantide";
    }),
    /fuseau horaire inconnu/,
  );
});

test("Maps est livré désactivé dans l'exemple", () => {
  assert.equal(exemple().sources.maps.actif, false);
});

test("un exemple d'accroche trop court ou trop long est refusé (de 15 à 30 mots)", () => {
  assert.match(
    problemes((n) => {
      n.accroche.exemples[0] = "Cinq mots, c'est trop court.";
    }),
    /exemple de 5 mots \(de 15 à 30 attendus\)/,
  );
  assert.match(
    problemes((n) => {
      n.accroche.exemples[1] = Array.from({ length: 31 }, (_, i) => `mot${i}`).join(" ");
    }),
    /exemple de 31 mots/,
  );
});

test("un champ de découverte ou une question ne prend pas une clé réservée du débrief", () => {
  assert.match(
    problemes((n) => {
      n.debrief.champs[0].id = "citations";
    }),
    /debrief\.champs\.0\.id.*identifiant réservé au débrief : citations/,
  );
  assert.match(
    problemes((n) => {
      n.script.questions[0].id = "tags";
    }),
    /script\.questions\.0\.id.*identifiant réservé au débrief : tags/,
  );
});

test("les clés réservées du débrief sont les mêmes dans le schéma et dans scripts/debrief/lib.mjs", async () => {
  const { IDS_RESERVES_DEBRIEF } = await import("../config/schema.ts");
  const { CLES_EXTRACTION } = await import("../scripts/debrief/lib.mjs");
  assert.deepEqual([...IDS_RESERVES_DEBRIEF].sort(), [...CLES_EXTRACTION].sort());
});
