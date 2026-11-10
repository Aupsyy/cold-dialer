// Les phrases « à dire au prospect » de docs/offre.md et docs/scripts-de-base.md tiennent les garde-fous de la config.
// Convention : tout ce qui se dit au prospect est dans un bloc de citation Markdown (lignes commençant par « > »), un bloc par phrase
// ou par suite de phrases ; le reste du document est de la prose pour le lecteur.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MOTIF_CLE,
  MOTIF_EMAIL,
  MOTIF_URL,
  PROMESSES_INTERDITES,
  TIRET_CADRATIN,
} from "../config/garde-fous.ts";
import { CROCHETS_CONNUS } from "../config/schema.ts";
import { lire } from "./aides.mjs";

const DOCUMENTS = ["docs/offre.md", "docs/scripts-de-base.md"];

/** Les blocs de citation d'un texte Markdown, chacun recollé en une seule ligne. */
export function citations(md) {
  const blocs = [];
  let courant = null;
  for (const ligne of md.split("\n")) {
    const m = /^>\s?(.*)$/.exec(ligne);
    if (m) {
      courant = courant === null ? m[1].trim() : `${courant} ${m[1].trim()}`;
    } else if (courant !== null) {
      blocs.push(courant);
      courant = null;
    }
  }
  if (courant !== null) blocs.push(courant);
  return blocs;
}

test("la convention de citation est comprise : les lignes d'un bloc sont recollées", () => {
  assert.deepEqual(citations("a\n> un\n> deux\n\n> trois\nfin"), ["un deux", "trois"]);
});

for (const doc of DOCUMENTS) {
  const phrases = citations(lire(doc));

  test(`${doc} : des phrases à dire sont présentes`, () => {
    if (doc === "docs/scripts-de-base.md") assert.ok(phrases.length >= 20, `trop peu de citations : ${phrases.length}`);
  });

  test(`${doc} : aucune phrase à dire ne promet un résultat`, () => {
    for (const p of phrases) {
      for (const motif of PROMESSES_INTERDITES) assert.ok(!motif.test(p), `promesse interdite (${motif}) dans : ${p}`);
    }
  });

  test(`${doc} : aucun tiret cadratin, URL, e-mail ni clé dans les phrases à dire`, () => {
    for (const p of phrases) {
      assert.ok(!TIRET_CADRATIN.test(p), `tiret cadratin dans : ${p}`);
      assert.ok(!MOTIF_URL.test(p), `URL dans : ${p}`);
      assert.ok(!MOTIF_EMAIL.test(p), `e-mail dans : ${p}`);
      assert.ok(!MOTIF_CLE.test(p), `motif de clé dans : ${p}`);
    }
  });

  test(`${doc} : les crochets des phrases à dire sont ceux que le schéma accepte`, () => {
    for (const p of phrases) {
      for (const c of p.match(/\[[^[\]]*\]/g) ?? []) {
        assert.ok(CROCHETS_CONNUS.includes(c), `crochet inconnu du schéma ${c} dans : ${p}`);
      }
    }
  });

  test(`${doc} : les phrases à dire sont au vouvoiement`, () => {
    for (const p of phrases) {
      const sansCrochets = p.replace(/\[[^[\]]*\]/g, "");
      assert.ok(!/(?<![\p{L}\p{N}_])(?:tu|toi|ton|ta|tes|te|t')(?![\p{L}\p{N}_])/iu.test(sansCrochets), `tutoiement dans : ${p}`);
    }
  });
}

test("docs/offre.md renvoie à chaque champ offre.* de la config", () => {
  const md = lire("docs/offre.md");
  for (const champ of ["nom", "pourQui", "probleme", "promesse", "mecanisme", "objectifAppel", "phrasePrix", "rdv.nom", "rdv.dureeMin", "rdv.canal"]) {
    assert.ok(md.includes(`offre.${champ}`), `offre.${champ} n'est pas cité dans docs/offre.md`);
  }
});

test("docs/scripts-de-base.md renvoie aux champs script.* et objections de la config", () => {
  const md = lire("docs/scripts-de-base.md");
  for (const champ of [
    "script.ouverture.portable",
    "script.ouverture.standard",
    "script.ouverture.commentAvezVousMonNumero",
    "script.permission",
    "script.questions",
    "script.pitch",
    "script.close",
    "script.messagerie",
    "script.crochets",
    "objections",
  ]) {
    assert.ok(md.includes(champ), `${champ} n'est pas cité dans docs/scripts-de-base.md`);
  }
});

test("docs/scripts-de-base.md : dix objections, chacune avec un code valide, et une phrase à dire", () => {
  const md = lire("docs/scripts-de-base.md");
  const codes = [...md.matchAll(/\(`([a-z][a-z0-9-]{1,39})`\)\.\*\*/g)].map((m) => m[1]);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(!codes.includes("libre"));
});

test("les documents ne contiennent ni tiret cadratin ni URL", () => {
  for (const doc of DOCUMENTS) {
    const md = lire(doc);
    assert.ok(!TIRET_CADRATIN.test(md), `tiret cadratin dans ${doc}`);
    assert.ok(!MOTIF_URL.test(md), `URL dans ${doc}`);
  }
});
