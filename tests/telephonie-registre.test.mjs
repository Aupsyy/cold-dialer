// Le registre de téléphonie (lib/telephonie/registre.ts) : les cinq adaptateurs, leurs origines de micro, leurs webhooks ; les règles
// du dossier lib/telephonie (aucun module Node, aucun DOM au chargement, imports relatifs : il est lu par le navigateur, par
// next.config.ts et par les routes) ; le softphone et ses liens ; les textes d'aide de chaque fournisseur.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { RE_ORIGINE_MICRO } from "../lib/securite/entetes.ts";
import { AIDES_TELEPHONIE, aideTelephonie, cheminWebhook } from "../lib/telephonie/aide.ts";
import { REGISTRE_TELEPHONIE, adaptateurTelephonie, originesMicro } from "../lib/telephonie/registre.ts";
import { creerClientSoftphone, softphone } from "../lib/telephonie/softphone.ts";
import { FOURNISSEURS_TELEPHONIE, FOURNISSEURS_AVEC_ENREGISTREMENT } from "../lib/telephonie/types.ts";
import { RACINE, lire } from "./aides.mjs";
import { fauxNavigateur } from "./telephonie-faux.mjs";

const FICHIERS = readdirSync(new URL("lib/telephonie/", RACINE)).filter((f) => f.endsWith(".ts"));

test("le registre range un adaptateur par fournisseur, sous son propre identifiant", () => {
  assert.deepEqual(Object.keys(REGISTRE_TELEPHONIE).sort(), [...FOURNISSEURS_TELEPHONIE].sort());
  for (const f of FOURNISSEURS_TELEPHONIE) {
    const a = adaptateurTelephonie(f);
    assert.equal(a.id, f);
    assert.ok(a.libelle.length > 3, f);
    for (const m of ["preparer", "etat", "appeler"]) assert.equal(typeof a.client[m], "function", `${f}.client.${m}`);
  }
});

test("originesMicro : la forme attendue par la Permissions-Policy, et les bonnes origines", () => {
  for (const f of FOURNISSEURS_TELEPHONIE) {
    for (const o of originesMicro(f)) assert.match(o, RE_ORIGINE_MICRO, `${f} : ${o}`);
  }
  assert.deepEqual([...originesMicro("onoff")], ["chrome-extension://jbfkkljambdhjlkcfkcbpjfkkamkccfm"]);
  assert.deepEqual([...originesMicro("aircall")], ["https://workspace.aircall.io", "https://phone.aircall.io"]);
  assert.deepEqual([...originesMicro("ringover")], ["https://app.ringover.com"]);
  assert.deepEqual([...originesMicro("softphone")], []);
  assert.deepEqual([...originesMicro("telephone")], []);
});

test("webhooks : Onoff, Aircall et Ringover en ont un (les noms de leurs variables, jamais une valeur) ; softphone et téléphone non", () => {
  assert.deepEqual([...REGISTRE_TELEPHONIE.onoff.webhook.variables], ["ONOFF_WEBHOOK_TOKEN"]);
  assert.deepEqual([...REGISTRE_TELEPHONIE.aircall.webhook.variables], ["AIRCALL_WEBHOOK_TOKEN"]);
  assert.deepEqual([...REGISTRE_TELEPHONIE.ringover.webhook.variables], ["RINGOVER_WEBHOOK_SECRET"]);
  assert.equal(REGISTRE_TELEPHONIE.softphone.webhook, undefined);
  assert.equal(REGISTRE_TELEPHONIE.telephone.webhook, undefined);
  for (const f of FOURNISSEURS_AVEC_ENREGISTREMENT) {
    const w = adaptateurTelephonie(f).webhook;
    for (const m of ["verifier", "lire", "apres"]) assert.equal(typeof w[m], "function", `${f}.webhook.${m}`);
  }
});

test("Ringover est le seul adaptateur expérimental", () => {
  for (const f of FOURNISSEURS_TELEPHONIE) assert.equal(adaptateurTelephonie(f).experimental === true, f === "ringover", f);
  assert.equal(aideTelephonie("ringover").experimental, true);
});

test("lib/telephonie : aucun module Node, aucun « server-only », imports relatifs, aucune variable lue directement", () => {
  assert.ok(FICHIERS.length >= 13, `${FICHIERS.length} fichiers`);
  for (const f of FICHIERS) {
    const t = lire(`lib/telephonie/${f}`);
    assert.doesNotMatch(t, /from\s+["']node:|require\(|import\(["']node:/, `${f} : module Node`);
    assert.doesNotMatch(t, /(from|import)\s+["'](server-only|next\/server|next\/headers)["']/, `${f} : module réservé au serveur`);
    assert.doesNotMatch(t, /from\s+["']@\//, `${f} : import « @/ » (next.config.ts ne le connaît pas)`);
    assert.doesNotMatch(t, /process\.env/, `${f} : les variables arrivent par env (injectées), jamais lues ici`);
    assert.doesNotMatch(t, /\bany\b(?!thing)/, `${f} : any`);
    assert.ok(!t.includes(String.fromCharCode(8212)), `${f} : tiret cadratin`);
  }
});

test("aucun accès au DOM au chargement : les modules se chargent sans navigateur (déjà fait par les imports de ce test)", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(typeof globalThis.document, "undefined");
  assert.ok(Object.keys(REGISTRE_TELEPHONIE).length === 5);
});

/** Un élément du Poste dont on garde les éléments créés (le lien temporaire du softphone). */
function elementEspion(attributs) {
  const nav = fauxNavigateur();
  const el = nav.element(attributs);
  const crees = [];
  const creer = el.ownerDocument.createElement;
  el.ownerDocument.createElement = (tag) => {
    const x = creer(tag);
    crees.push(x);
    return x;
  };
  return { nav, el, crees };
}

test("softphone : le lien suit data-schema-lien (tel, callto, sip), le numéro est copié (sauf data-copier-numero=0)", async () => {
  for (const [schema, attendu] of [
    [null, "tel:+33199000101"],
    ["tel", "tel:+33199000101"],
    ["callto", "callto:+33199000101"],
    ["sip", "sip:+33199000101"],
    ["javascript", "tel:+33199000101"],
  ]) {
    const { nav, el, crees } = elementEspion(schema ? { "data-schema-lien": schema } : {});
    const client = creerClientSoftphone();
    const fermer = client.preparer(el);
    assert.equal(client.etat(), "pret");
    assert.equal(await client.appeler("+33199000101", { leadId: "x" }), "repli_tel");
    assert.equal(crees.length, 1);
    assert.equal(crees[0].href, attendu, String(schema));
    assert.equal(crees[0].clics, 1);
    assert.equal(el.enfants.filter((e) => e.tagName === "A").length, 0, "le lien temporaire est retiré après le clic");
    assert.deepEqual(nav.copies, ["+33199000101"]);
    fermer();
  }
  const { nav, el, crees } = elementEspion({ "data-schema-lien": "callto", "data-copier-numero": "0" });
  const client = creerClientSoftphone();
  client.preparer(el);
  assert.equal(await client.appeler("+33639980102", { leadId: "x" }), "repli_tel");
  assert.equal(crees[0].href, "callto:+33639980102");
  assert.deepEqual(nav.copies, [], "data-copier-numero=0 : rien n'est copié");
  await assert.rejects(() => client.appeler("0199000101", { leadId: "x" }), /format international/);
  await assert.rejects(() => client.appeler("javascript:alert(1)", { leadId: "x" }), /format international/);
  await assert.rejects(() => creerClientSoftphone().appeler("+33199000101", { leadId: "x" }), /n'a pas pu s'ouvrir/, "sans navigateur ni presse-papiers");
  assert.equal(softphone.webhook, undefined);
});

test("aide : chaque fournisseur a sa ligne de Poste, son installation, ses pannes ; les pannes connues d'Onoff y sont", () => {
  for (const f of FOURNISSEURS_TELEPHONIE) {
    const a = AIDES_TELEPHONIE[f];
    assert.equal(a.fournisseur, f);
    assert.ok(a.poste.length > 20, f);
    assert.ok(a.installationAppelant.length > 0 && a.pannes.length > 0, f);
    assert.equal(a.webhook === null, !adaptateurTelephonie(f).webhook, `${f} : webhook dans l'aide`);
    if (a.webhook) {
      assert.ok(a.webhook.chemin.startsWith(cheminWebhook(f)), f);
      assert.deepEqual([...a.webhook.variables], [...adaptateurTelephonie(f).webhook.variables], f);
    }
  }
  const onoff = JSON.stringify(AIDES_TELEPHONIE.onoff);
  for (const attendu of [
    "Ce site restreint notre extension",
    "Permissions-Policy",
    "attends une demi-seconde",
    "3 appareils au plus",
    "Advanced et Max",
    "AVANT de créer l'intégration",
    "« échec »",
    "10 secondes",
    "4 fois",
    "46.137.171.21",
    "52.50.239.4",
    "54.220.111.56",
    "carte SIM",
  ]) {
    assert.ok(onoff.includes(attendu), `aide Onoff : ${attendu}`);
  }
  assert.ok(JSON.stringify(AIDES_TELEPHONIE.aircall).includes("à chaque session"));
  assert.ok(JSON.stringify(AIDES_TELEPHONIE.softphone).includes("macOS") && JSON.stringify(AIDES_TELEPHONIE.softphone).includes("Windows"));
  for (const f of FOURNISSEURS_TELEPHONIE) {
    const t = JSON.stringify(AIDES_TELEPHONIE[f]);
    assert.ok(!t.includes(String.fromCharCode(8212)), `${f} : tiret cadratin`);
    assert.doesNotMatch(t, /[A-Z0-9_]+=\S/, `${f} : jamais une valeur de variable`);
  }
});

test("docs/telephonie.md : chaque fournisseur, chaque variable par son NOM (jamais une valeur), les chemins des webhooks, le légal", () => {
  const doc = lire("docs/telephonie.md");
  for (const nom of [
    "ONOFF_WEBHOOK_TOKEN",
    "ONOFF_API_KEY",
    "AIRCALL_WEBHOOK_TOKEN",
    "AIRCALL_API_ID",
    "AIRCALL_API_TOKEN",
    "RINGOVER_WEBHOOK_SECRET",
    "CRON_SECRET",
    "/api/telephonie/onoff/webhook",
    "/api/telephonie/aircall/webhook",
    "/api/telephonie/ringover/webhook?secret=",
    "/api/telephonie/recuperation",
    "226-1",
    "expérimental",
    "Permissions-Policy",
    "macOS",
    "Windows",
  ]) {
    assert.ok(doc.includes(nom), `docs/telephonie.md : ${nom}`);
  }
  assert.doesNotMatch(doc, /\b(ONOFF|AIRCALL|RINGOVER|CRON|SUPABASE)_[A-Z_]+=\S/, "jamais une valeur de variable");
  assert.doesNotMatch(doc, /https:\/\/(?!<ton-domaine>|app\.ringover\.com|workspace\.aircall\.io|phone\.aircall\.io|hote)[a-z]/i, "aucune adresse réelle d'une instance");
  assert.ok(!doc.includes(String.fromCharCode(8212)), "aucun tiret cadratin");
});
