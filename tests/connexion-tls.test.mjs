// Les scripts qui se connectent à une base distante (import, débrief, installation) vérifient son certificat quand SUPABASE_DB_CA est
// posée, et le disent sinon, sans jamais citer l'adresse : une seule règle, optionsTls (scripts/accroches/lib/base.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { configurationPg, ouvrirConnexion } from "../scripts/debrief/base.mjs";
import { configurationConnexion as connexionInstall } from "../scripts/install/lib.mjs";
import { configurationConnexion as connexionImport } from "../scripts/sourcing/importer.mjs";

const DISTANTE = "postgresql://utilisateur@base-distante.example.org:5432/postgres";
const LOCALE = "postgresql://postgres@127.0.0.1:54322/postgres";
const PEM = "-----BEGIN CERTIFICATE-----\nQ0VSVElGSUNBVC1JTlZFTlRFLVBPVVItTEVTLVRFU1RT\n-----END CERTIFICATE-----";
const SCRIPTS = [
  ["débrief", (u) => configurationPg(u)],
  ["installation", (u) => connexionInstall(u)],
  ["import", (u) => connexionImport(u)],
];

test("TLS : rien en local ; vers une base distante, le certificat vérifié avec SUPABASE_DB_CA, sinon un avertissement sans valeur", (t) => {
  const avertissements = t.mock.method(console, "warn", () => {});
  const avant = process.env.SUPABASE_DB_CA;
  try {
    for (const [nom, configuration] of SCRIPTS) {
      delete process.env.SUPABASE_DB_CA;
      assert.equal(configuration(LOCALE).ssl, false, `${nom} : base locale`);
      assert.deepEqual(configuration(DISTANTE).ssl, { rejectUnauthorized: false }, `${nom} : sans certificat`);
      process.env.SUPABASE_DB_CA = PEM;
      assert.deepEqual(configuration(DISTANTE).ssl, { ca: PEM, rejectUnauthorized: true }, `${nom} : certificat vérifié`);
      process.env.SUPABASE_DB_CA = "-----BEGIN PAS UN CERTIFICAT-----";
      assert.throws(() => configuration(DISTANTE), /SUPABASE_DB_CA/, `${nom} : un certificat illisible arrête tout`);
    }
  } finally {
    if (avant === undefined) delete process.env.SUPABASE_DB_CA;
    else process.env.SUPABASE_DB_CA = avant;
  }
  assert.equal(avertissements.mock.callCount(), SCRIPTS.length, "un avertissement par connexion distante sans certificat");
  for (const appel of avertissements.mock.calls) assert.doesNotMatch(appel.arguments.join(" "), /base-distante|utilisateur|5432/);
});

test("le débrief : un certificat illisible arrête avant toute connexion, avec une raison qui ne cite rien de l'adresse", async () => {
  const r = await ouvrirConnexion({ SUPABASE_DB_URL: DISTANTE, SUPABASE_DB_CA: "-----BEGIN PAS UN CERTIFICAT-----" });
  assert.equal(r.ok, false);
  assert.match(r.raison, /SUPABASE_DB_CA illisible/);
  assert.doesNotMatch(r.raison, /base-distante|utilisateur/);
});
