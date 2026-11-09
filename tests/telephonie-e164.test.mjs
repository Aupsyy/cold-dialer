// Les numéros E.164 (lib/telephonie/e164.ts) : normalisation d'un numéro saisi ou reçu, validation par pays, affichage. Numéros de la
// plage réservée à la fiction (01 99 00, 06 39 98 ; 555-01xx en Amérique du Nord) ou impossibles à attribuer (abonné en 0).
import assert from "node:assert/strict";
import { test } from "node:test";
import { estE164, formaterNumero, neufDerniersChiffres, normaliserE164, numeroRecu, chiffresIndicatif } from "../lib/telephonie/e164.ts";

test("France : espaces, points, tirets, 0 national, préfixe 00, « (0) », indicatif collé, espaces insécables", () => {
  for (const saisie of [
    "01 99 00 01 01",
    "01.99.00.01.01",
    "01-99-00-01-01",
    "0199000101",
    "+33 1 99 00 01 01",
    "+33 (0)1 99 00 01 01",
    "+33 0 1 99 00 01 01",
    "0033 1 99 00 01 01",
    "33 1 99 00 01 01",
    "01 99 00 01 01",
    "01 99 00 01 01",
    " (01) 99 00 01 01 ",
  ]) {
    assert.equal(normaliserE164(saisie, "+33"), "+33199000101", saisie);
  }
  assert.equal(normaliserE164("06 39 98 01 02", "+33"), "+33639980102");
  assert.equal(normaliserE164("06 39 98 01 02", "33"), "+33639980102", "l'indicatif sans « + » est accepté");
});

test("France : les numéros trop courts, trop longs ou illisibles sont refusés", () => {
  for (const saisie of ["019900010", "01 99 00 01 010", "+33 1 99 00 01 0", "+33 0 00 00 00 00", "abc", "01 99 00 0x 01", "", "   ", null, undefined, {}, "+", "0"]) {
    assert.equal(normaliserE164(saisie, "+33"), null, String(saisie));
  }
  assert.equal(normaliserE164("x".repeat(41), "+33"), null);
});

test("un numéro national sans indicatif est illisible ; un numéro international garde son pays quel que soit l'indicatif", () => {
  assert.equal(normaliserE164("01 99 00 01 01"), null);
  assert.equal(normaliserE164("01 99 00 01 01", null), null);
  assert.equal(normaliserE164("+33 1 99 00 01 01", "+32"), "+33199000101");
  assert.equal(normaliserE164("0033639980102", "+1"), "+33639980102");
});

test("Belgique, Suisse : le 0 national tombe, la longueur du pays est vérifiée", () => {
  assert.equal(normaliserE164("02 000 00 01", "+32"), "+3220000001");
  assert.equal(normaliserE164("+32 (0)2 000 00 01"), "+3220000001");
  assert.equal(normaliserE164("0032 2 000 00 01"), "+3220000001");
  assert.equal(normaliserE164("+32 2 000 00 0"), null, "Belgique : 8 ou 9 chiffres après l'indicatif");
  assert.equal(normaliserE164("022 000 00 00", "+41"), "+41220000000");
  assert.equal(normaliserE164("+41 22 000 00 00"), "+41220000000");
  assert.equal(normaliserE164("+41 22 000 00 0"), null, "Suisse : 9 chiffres après l'indicatif");
});

test("Canada (+1) : 10 chiffres, éventuellement précédés de 1 ; indicatif régional et central sans 0 ni 1 en tête", () => {
  assert.equal(normaliserE164("613-555-0123", "+1"), "+16135550123");
  assert.equal(normaliserE164("1 (613) 555-0199", "+1"), "+16135550199");
  assert.equal(normaliserE164("+1 613 555 0100"), "+16135550100");
  assert.equal(normaliserE164("613.555.0142", "+1"), "+16135550142");
  assert.equal(normaliserE164("613-055-0123", "+1"), null, "central en 0");
  assert.equal(normaliserE164("013-555-0123", "+1"), null, "régional en 0");
  assert.equal(normaliserE164("555-0123", "+1"), null, "7 chiffres : il manque l'indicatif régional");
});

test("validation : E.164 et règles des pays connus", () => {
  for (const ok of ["+33199000101", "+33639980102", "+3220000001", "+41220000000", "+16135550123", "+352123456", "+447700900123"]) {
    assert.ok(estE164(ok), ok);
  }
  for (const ko of ["33199000101", "+3319900010", "+331990001011", "+0123456", "+16130550123", "+12", "+3220000", " +33199000101", 33199000101, null]) {
    assert.ok(!estE164(ko), String(ko));
  }
});

test("numéro reçu d'un fournisseur : international -> E.164 ; national ou en chiffres -> gardé pour l'indicatif de l'instance", () => {
  assert.equal(numeroRecu("+33 1 99 00 01 01"), "+33199000101");
  assert.equal(numeroRecu("0033 6 39 98 01 02"), "+33639980102");
  assert.equal(numeroRecu("01 99 00 01 01"), "0199000101");
  assert.equal(numeroRecu("33199000101"), "33199000101");
  assert.equal(numeroRecu("pas un numéro"), null);
  assert.equal(numeroRecu(""), null);
  assert.equal(normaliserE164(numeroRecu("01 99 00 01 01"), "+33"), "+33199000101");
});

test("affichage, 9 derniers chiffres, indicatif", () => {
  assert.equal(formaterNumero("+33199000101"), "+33 1 99 00 01 01");
  assert.equal(formaterNumero("+33639980102"), "+33 6 39 98 01 02");
  assert.equal(formaterNumero("+16135550123"), "+1 613 555 0123");
  assert.equal(formaterNumero("+3220000001"), "+3220000001");
  assert.equal(neufDerniersChiffres("+33 1 99 00 01 01"), "199000101");
  assert.equal(neufDerniersChiffres("0199000101"), "199000101");
  assert.equal(neufDerniersChiffres("12345678"), null);
  assert.equal(chiffresIndicatif("+33"), "33");
  assert.equal(chiffresIndicatif("+1"), "1");
  assert.equal(chiffresIndicatif("+0"), null);
  assert.equal(chiffresIndicatif(undefined), null);
});
