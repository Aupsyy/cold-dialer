// Le lecteur et l'écrivain CSV du sourcing (scripts/sourcing/csv.mjs) : RFC 4180, BOM, séparateur détecté, en-têtes normalisés,
// protection contre les formules, UTF-8 strict. Données fictives.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cellule, decoderUtf8, decouper, detecterSeparateur, ecrireCsv, ErreurCsv, lireCsv, normaliserEntete } from "../scripts/sourcing/csv.mjs";

test("séparateur détecté sur la première ligne : point-virgule ou virgule, hors guillemets", () => {
  assert.equal(detecterSeparateur("a;b;c\n1,2;3;4"), ";");
  assert.equal(detecterSeparateur("a,b,c\n1;2,3,4"), ",");
  assert.equal(detecterSeparateur('"x;y;z",b\n'), ",");
  assert.equal(detecterSeparateur("seule"), ",");
});

test("guillemets : séparateur, retour à la ligne et guillemet doublé dans un champ", () => {
  const texte = 'entreprise;ville\n"Atelier Démo 01; Jardins";Lyon\n"Atelier ""Démo"" 02";"Saint-\nÉtienne"\n';
  const { colonnes, lignes, separateur } = lireCsv(texte);
  assert.equal(separateur, ";");
  assert.deepEqual(colonnes, ["entreprise", "ville"]);
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].entreprise, "Atelier Démo 01; Jardins");
  assert.equal(lignes[1].entreprise, 'Atelier "Démo" 02');
  assert.equal(lignes[1].ville, "Saint-\nÉtienne");
});

test("BOM, CRLF, CR seul, lignes vides et absence de retour final", () => {
  for (const fin of ["\r\n", "\n", "\r"]) {
    const texte = `﻿entreprise,siren${fin}${fin}Atelier Démo 01,000000001${fin}  ${fin}Atelier Démo 02,000000002`;
    const { colonnes, lignes } = lireCsv(texte);
    assert.deepEqual(colonnes, ["entreprise", "siren"], `fin de ligne ${JSON.stringify(fin)}`);
    assert.equal(lignes.length, 2);
    assert.equal(lignes[1].siren, "000000002");
  }
});

test("le numéro de ligne d'une rangée tient compte des retours dans les champs", () => {
  const rangees = decouper('a,b\n"1\n2",3\n4,5\n', ",");
  assert.deepEqual(rangees.map((r) => r.ligne), [1, 2, 4]);
  const { lignes } = lireCsv('a,b\n"1\n2",3\n4,5\n');
  assert.equal(lignes[1].ligne, 4);
});

test("en-têtes normalisés : minuscules, sans accents, « _ » entre les mots ; doublons ignorés", () => {
  assert.equal(normaliserEntete(" Code postal "), "code_postal");
  assert.equal(normaliserEntete("Téléphone"), "telephone");
  assert.equal(normaliserEntete("E-mail"), "e_mail");
  assert.equal(normaliserEntete("N° SIREN"), "n_siren");
  const { colonnes, lignes } = lireCsv("Ville;ville;CP\nLyon;Bron;69003\n");
  assert.deepEqual(colonnes, ["ville", "cp"]);
  assert.equal(lignes[0].ville, "Lyon");
});

test("une ligne trop longue est signalée (enTrop), une ligne courte complétée de cellules vides", () => {
  const { lignes } = lireCsv("a;b\n1;2;3\n4\n");
  assert.equal(lignes[0].enTrop, true);
  assert.equal(lignes[1].enTrop, false);
  assert.equal(lignes[1].b, "");
  assert.deepEqual(Object.keys(lignes[0]), ["a", "b"], "ligne et enTrop ne sont pas des colonnes");
});

test("un guillemet jamais refermé est une erreur qui cite la ligne, pas le contenu", () => {
  assert.throws(
    () => lireCsv('a;b\n1;2\n"Atelier Démo 03;4\n'),
    (e) => e instanceof ErreurCsv && /ligne 3/.test(e.message) && !e.message.includes("Atelier"),
  );
});

test("UTF-8 strict : avec ou sans BOM ; un fichier Latin-1 est refusé avec la marche à suivre", () => {
  const avecBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("ville\nÉchirolles\n", "utf8")]);
  assert.equal(lireCsv(decoderUtf8(avecBom)).lignes[0].ville, "Échirolles");
  assert.equal(lireCsv(decoderUtf8(Buffer.from("ville\nÉchirolles\n", "utf8"))).lignes[0].ville, "Échirolles");
  const latin1 = Buffer.from("ville\n\xc9chirolles\n", "latin1");
  assert.throws(() => decoderUtf8(latin1), (e) => e instanceof ErreurCsv && /CSV UTF-8/.test(e.message));
});

test("écriture : point-virgule, BOM, CRLF, guillemets seulement quand il le faut", () => {
  const texte = ecrireCsv(["entreprise", "ville", "note"], [
    { entreprise: "Atelier Démo 01; Jardins", ville: "Lyon", note: 4.5 },
    { entreprise: 'Atelier "Démo" 02', ville: "Saint-\nÉtienne" },
  ]);
  assert.ok(texte.startsWith("﻿entreprise;ville;note\r\n"));
  assert.ok(texte.includes('"Atelier Démo 01; Jardins";Lyon;4.5\r\n'));
  assert.ok(texte.includes('"Atelier ""Démo"" 02";"Saint-\nÉtienne";\r\n'));
  assert.equal(ecrireCsv(["a"], [{ a: "x" }], { separateur: ",", bom: false, finDeLigne: "\n" }), "a\nx\n");
});

test("formules désamorcées à l'écriture et rétablies à la lecture ; les numéros +33 et -5 restent tels quels", () => {
  assert.equal(cellule("=SOMME(A1)"), "'=SOMME(A1)");
  assert.equal(cellule("@contact"), "'@contact");
  assert.equal(cellule("+FORMULE()"), "'+FORMULE()");
  assert.equal(cellule("-x"), "'-x");
  assert.equal(cellule("+33199000101"), "+33199000101");
  assert.equal(cellule("-5"), "-5");
  assert.equal(cellule(null), "");
  const lignes = [{ a: "=1+1", b: "+33199000101", c: "@x", d: "texte ; avec \"tout\"\n" }];
  const relu = lireCsv(ecrireCsv(["a", "b", "c", "d"], lignes)).lignes[0];
  assert.deepEqual({ ...relu }, lignes[0]);
});

test("M22 : une formule qui commence par un signe suivi d'un chiffre est désamorcée aussi ; un nombre ne l'est jamais", () => {
  assert.equal(cellule("+1+cmd|' /C calc'!A0"), "'+1+cmd|' /C calc'!A0");
  assert.equal(cellule("-1+LIEN_HYPERTEXTE(\"https://example.org\")"), "\"'-1+LIEN_HYPERTEXTE(\"\"https://example.org\"\")\"");
  assert.equal(cellule("+33 1 99 00 01 01"), "'+33 1 99 00 01 01", "un numéro avec espaces se relit à l'identique, désamorcé");
  for (const nombre of ["+33199000101", "-5", "4,5", "-0.75", "+12"]) assert.equal(cellule(nombre), nombre, nombre);
  const lignes = [{ a: "+1+cmd|' /C calc'!A0", b: "-1+2", c: "+33 1 99 00 01 01" }];
  assert.deepEqual({ ...lireCsv(ecrireCsv(["a", "b", "c"], lignes)).lignes[0] }, lignes[0], "relu à l'identique");
});

test("aller-retour : ce qui est écrit se relit à l'identique, en virgule comme en point-virgule", () => {
  const lignes = Array.from({ length: 20 }, (_, i) => ({
    entreprise: `Atelier Démo ${String(i + 1).padStart(2, "0")}${i % 3 === 0 ? ', "et fils"' : ""}`,
    ville: i % 2 ? "Lyon" : "Saint-Étienne\r\nCedex",
    vide: "",
  }));
  for (const separateur of [";", ","]) {
    const relu = lireCsv(ecrireCsv(["entreprise", "ville", "vide"], lignes, { separateur }));
    assert.equal(relu.separateur, separateur);
    assert.deepEqual(relu.lignes.map((l) => ({ ...l })), lignes);
  }
});

test("un fichier vide ou fait d'un en-tête seul ne donne aucune ligne", () => {
  assert.deepEqual(lireCsv("").lignes, []);
  assert.deepEqual(lireCsv("﻿").colonnes, []);
  assert.deepEqual(lireCsv("entreprise;siren\r\n").lignes, []);
});
