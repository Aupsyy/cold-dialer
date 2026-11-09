// Les en-têtes de sécurité (lib/securite/entetes.ts) et ce que next.config.ts pose réellement.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entetesSecurite, politiquePermissions } from "../lib/securite/entetes.ts";
import { lire } from "./aides.mjs";

test("les en-têtes de sécurité attendus, et eux seuls", () => {
  const e = Object.fromEntries(entetesSecurite().map((x) => [x.key, x.value]));
  assert.deepEqual(Object.keys(e).sort(), [
    "Content-Security-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
  ]);
  assert.equal(e["X-Content-Type-Options"], "nosniff");
  assert.equal(e["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(e["X-Frame-Options"], "DENY");
  assert.equal(e["Content-Security-Policy"], "frame-ancestors 'none'");
});

test("Permissions-Policy de base : micro pour l'application seule ; caméra, position et paiement coupés", () => {
  assert.equal(politiquePermissions(), "camera=(), microphone=(self), geolocation=(), payment=()");
});

test("les origines du fournisseur de téléphonie s'ajoutent au micro (iframe https, extension Chrome)", () => {
  const p = politiquePermissions(["https://phone.example.org", "chrome-extension://abcdefghijklmnopabcdefghijklmnop"]);
  assert.equal(
    p,
    'camera=(), microphone=(self "https://phone.example.org" "chrome-extension://abcdefghijklmnopabcdefghijklmnop"), geolocation=(), payment=()',
  );
  assert.equal(politiquePermissions(["https://a.example.org", "https://a.example.org"]).match(/a\.example\.org/g).length, 1);
});

test("une origine invalide arrête le build (jamais de politique trop large)", () => {
  for (const o of ["*", "http://phone.example.org", "https://", "self", 'https://x.example.org" *', "chrome-extension://court"]) {
    assert.throws(() => politiquePermissions([o]), /origine de micro invalide/, o);
  }
});

test("next.config.ts pose ces en-têtes sur toutes les adresses, d'après la config de téléphonie", async () => {
  const { default: config, ENTETES_SECURITE } = await import("../next.config.ts");
  assert.equal(config.poweredByHeader, false);
  const regles = await config.headers();
  assert.equal(regles.length, 1);
  assert.equal(regles[0].source, "/:path*");
  assert.deepEqual(regles[0].headers, ENTETES_SECURITE);
  const politique = regles[0].headers.find((h) => h.key === "Permissions-Policy").value;
  assert.equal(politique, "camera=(), microphone=(self), geolocation=(), payment=()", "les tests tournent sur la niche d'exemple (téléphone) : le micro n'est ouvert à personne d'autre");
});

test("next.config.ts et ce qu'il lit n'utilisent que des imports relatifs (l'alias @/ n'existe pas au chargement de la config)", () => {
  for (const f of [
    "next.config.ts",
    "config/charger.ts",
    "config/schema.ts",
    "config/garde-fous.ts",
    "lib/securite/entetes.ts",
    "lib/telephonie/registre.ts",
    "lib/telephonie/telephone.ts",
    "lib/telephonie/types.ts",
    "lib/agenda/types.ts",
    "lib/agenda/registre.ts",
    "lib/integrations/base.ts",
  ]) {
    assert.doesNotMatch(lire(f), /from\s+["']@\//, f);
  }
});
