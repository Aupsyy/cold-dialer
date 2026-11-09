// La Permissions-Policy de chaque fournisseur : lib/securite/entetes.ts la calcule d'après registre[fournisseur].originesMicro (c'est
// ce que fait next.config.ts au build, avec config.telephonie.fournisseur). Sans l'origine du fournisseur, son iframe ou son extension ne
// peut pas décrocher le micro (Onoff : « ce site restreint notre extension »).
import assert from "node:assert/strict";
import { test } from "node:test";
import { entetesSecurite, politiquePermissions } from "../lib/securite/entetes.ts";
import { originesMicro } from "../lib/telephonie/registre.ts";
import { FOURNISSEURS_TELEPHONIE } from "../lib/telephonie/types.ts";

const ATTENDU = {
  onoff: 'camera=(), microphone=(self "chrome-extension://jbfkkljambdhjlkcfkcbpjfkkamkccfm"), geolocation=(), payment=()',
  aircall: 'camera=(), microphone=(self "https://workspace.aircall.io" "https://phone.aircall.io"), geolocation=(), payment=()',
  ringover: 'camera=(), microphone=(self "https://app.ringover.com"), geolocation=(), payment=()',
  softphone: "camera=(), microphone=(self), geolocation=(), payment=()",
  telephone: "camera=(), microphone=(self), geolocation=(), payment=()",
};

test("la Permissions-Policy de chaque fournisseur (celle que next.config.ts pose au build)", () => {
  for (const f of FOURNISSEURS_TELEPHONIE) {
    assert.equal(politiquePermissions(originesMicro(f)), ATTENDU[f], f);
    const entete = entetesSecurite(originesMicro(f)).find((e) => e.key === "Permissions-Policy");
    assert.equal(entete.value, ATTENDU[f], f);
  }
});

test("le micro n'est jamais ouvert à tous, ni la caméra à personne, quel que soit le fournisseur", () => {
  for (const f of FOURNISSEURS_TELEPHONIE) {
    const p = politiquePermissions(originesMicro(f));
    assert.doesNotMatch(p, /\*/, f);
    assert.match(p, /^camera=\(\), microphone=\(self[^)]*\), geolocation=\(\), payment=\(\)$/, f);
  }
});

test("les autres en-têtes ne dépendent pas du fournisseur (l'application n'est jamais encadrée par un autre site)", () => {
  for (const f of FOURNISSEURS_TELEPHONIE) {
    const e = Object.fromEntries(entetesSecurite(originesMicro(f)).map((x) => [x.key, x.value]));
    assert.equal(e["X-Frame-Options"], "DENY", f);
    assert.equal(e["Content-Security-Policy"], "frame-ancestors 'none'", f);
  }
});
