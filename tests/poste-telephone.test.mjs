// Les numéros au Poste (lib/poste/telephone.ts) : E.164 selon la même règle que normaliser_e164 (migration 0001 : les cas ci-dessous ont
// été rejoués sur la fonction SQL), portable ou fixe, numéros d'une fiche, affichage, lien d'appel de repli. Numéros fictifs seulement.
import assert from "node:assert/strict";
import { test } from "node:test";
import { affichageNumero, lienAppel, numerosDeFiche, ouverturePour, typeNumero, versE164 } from "../lib/poste/telephone.ts";

// [numéro saisi, pays, attendu] : les mêmes réponses que public.normaliser_e164(numéro, pays).
const CAS_E164 = [
  ["01 99 00 01 01", "FR", "+33199000101"],
  ["01.99.00.01.01", "FR", "+33199000101"],
  ["(01) 99-00-01-01", "FR", "+33199000101"],
  ["+33 1 99 00 01 01", "FR", "+33199000101"],
  ["+33 (0)1 99 00 01 01", "FR", "+33199000101"],
  ["0033199000101", "FR", "+33199000101"],
  ["33199000101", "FR", "+33199000101"],
  ["06 39 98 00 01", "FR", "+33639980001"],
  ["+33 0 6 39 98 00 01", "FR", "+33639980001"],
  ["0199", "FR", null],
  ["01 99 00 01 01 poste 3", "FR", null],
  ["+3319900010", "FR", null],
  ["", "FR", null],
  ["02 123 45 67", "BE", "+3221234567"],
  ["0471 00 00 01", "BE", "+32471000001"],
  ["021 345 67 89", "CH", "+41213456789"],
  ["514 555 0100", "CA", "+15145550100"],
  ["1 514 555 0100", "CA", "+15145550100"],
  ["+44 20 7946 0000", "FR", "+442079460000"],
  ["01 99 00 01 01", "ZZ", null],
];

test("versE164 : la même règle que normaliser_e164 en base", () => {
  for (const [saisi, pays, attendu] of CAS_E164) assert.equal(versE164(saisi, pays), attendu, `${saisi} (${pays})`);
  assert.equal(versE164(null, "FR"), null);
});

test("portable ou fixe, et l'ouverture du script qui va avec", () => {
  assert.equal(typeNumero("+33639980001"), "portable");
  assert.equal(typeNumero("+33639980101"), "portable");
  assert.equal(typeNumero("+33199000101"), "fixe");
  assert.equal(typeNumero("+32471123456"), "portable");
  assert.equal(typeNumero("+3221234567"), "fixe");
  assert.equal(typeNumero("+41791234567"), "portable");
  assert.equal(typeNumero("+15145550100"), "inconnu");
  assert.equal(typeNumero("0199000101"), "inconnu");
  assert.equal(ouverturePour("portable"), "portable");
  assert.equal(ouverturePour("fixe"), "standard");
  assert.equal(ouverturePour("inconnu"), "standard");
});

test("les numéros d'une fiche : téléphone puis mobile, sans doublon ; la colonne mobile compte comme un portable", () => {
  assert.deepEqual(numerosDeFiche({ telephone: "01 99 00 01 01", mobile: "06 39 98 00 01" }, "FR"), [
    { e164: "+33199000101", brut: "01 99 00 01 01", type: "fixe", colonne: "telephone" },
    { e164: "+33639980001", brut: "06 39 98 00 01", type: "portable", colonne: "mobile" },
  ]);
  assert.equal(numerosDeFiche({ telephone: "+33639980001", mobile: "06 39 98 00 01" }, "FR").length, 1, "même numéro deux fois");
  assert.deepEqual(numerosDeFiche({ telephone: null, mobile: "514 555 0100" }, "CA"), [
    { e164: "+15145550100", brut: "514 555 0100", type: "portable", colonne: "mobile" },
  ]);
  assert.deepEqual(numerosDeFiche({ telephone: "poste 12", mobile: null }, "FR"), [{ e164: null, brut: "poste 12", type: "inconnu", colonne: "telephone" }]);
  assert.deepEqual(numerosDeFiche({ telephone: "  ", mobile: null }, "FR"), []);
});

test("affichage et lien d'appel de repli", () => {
  assert.equal(affichageNumero("+33199000101", "FR"), "01 99 00 01 01");
  assert.equal(affichageNumero("+3221234567", "BE"), "+3221234567");
  assert.equal(lienAppel("+33199000101"), "tel:+33199000101");
  assert.equal(lienAppel("+33199000101", "sip"), "sip:+33199000101");
  assert.equal(lienAppel("+33199000101", "callto"), "callto:+33199000101");
  for (const v of ["0199000101", "javascript:alert(1)", null, "+0123"]) assert.equal(lienAppel(v), null, String(v));
});
