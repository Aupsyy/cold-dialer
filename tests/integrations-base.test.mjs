// Le socle des intégrations (lib/integrations/base.ts) : lecture tolérante, temps constant, HMAC par Web Crypto, aucun module Node.
import assert from "node:assert/strict";
import { test } from "node:test";
import { egalTempsConstant, hmacSha256Hex, objet, sha256Hex, texte, valeurEnv, variablesManquantes } from "../lib/integrations/base.ts";
import { lire } from "./aides.mjs";

test("lecture tolérante", () => {
  assert.deepEqual(objet([1]), {});
  assert.deepEqual(objet(null), {});
  assert.equal(texte("  a  "), "a");
  assert.equal(texte(""), null);
  assert.equal(texte("x".repeat(201)), null);
  assert.equal(valeurEnv({ A: " v " }, "A"), "v");
  assert.deepEqual(variablesManquantes({ A: "1", B: " " }, ["A", "B", "C"]), ["B", "C"]);
});

test("comparaison de secrets en temps constant", () => {
  assert.ok(egalTempsConstant("jeton-secret", "jeton-secret"));
  assert.ok(!egalTempsConstant("jeton-secret", "jeton-secreT"));
  assert.ok(!egalTempsConstant("court", "court-mais-plus-long"));
  assert.ok(!egalTempsConstant("", "x"));
});

test("HMAC-SHA256 et SHA-256 par Web Crypto (vecteurs connus)", async () => {
  // RFC 4231, cas 2.
  assert.equal(
    await hmacSha256Hex("Jefe", "what do ya want for nothing?"),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("aucun module Node dans le socle ni dans les adaptateurs (le registre est lu par le navigateur)", () => {
  for (const f of ["lib/integrations/base.ts", "lib/telephonie/types.ts", "lib/telephonie/registre.ts", "lib/telephonie/telephone.ts",
    "lib/agenda/types.ts", "lib/agenda/registre.ts"]) {
    assert.doesNotMatch(lire(f), /from\s+["']node:|require\(/, f);
  }
});
