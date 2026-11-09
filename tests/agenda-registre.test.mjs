// Le registre des adaptateurs d'agenda, le lien de réservation pré-rempli, la route générique des webhooks (404, 503, 413, 401, 400,
// 500, 200) et les contrôles statiques (aucun module Node dans lib/agenda, routes minces, aucun secret journalisé). Tout est inventé.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { CODES_DEFINITIFS } from "../lib/agenda/appliquer.ts";
import { calendly } from "../lib/agenda/calendly.ts";
import { lienAvecParametres, telephonePourLien } from "../lib/agenda/lien.ts";
import {
  REGISTRE_AGENDA,
  adaptateurAgenda,
  creerRegistreAgenda,
  lienReservationPour,
  rdvRecusAutomatiquement,
  variablesAgenda,
} from "../lib/agenda/registre.ts";
import { FOURNISSEURS_AGENDA } from "../lib/agenda/types.ts";
import { lireCorpsBorne, recevoirWebhookAgenda } from "../lib/agenda/webhook.ts";
import { TAILLE_MAX_CORPS } from "../lib/integrations/base.ts";
import { RACINE, lire } from "./aides.mjs";

const LEAD = "11111111-2222-4333-8444-555555555555";
const FICHE = { id: LEAD, entreprise: "Atelier Démo 01", dirigeant: "Camille Démo", email: "contact.demo01@example.com", telephone: "+33 1 99 00 01 01" };
const LIEN = "https://reservation.example.org/equipe/diagnostic";
const config = (fournisseur, extra = {}) => ({ fournisseur, lienReservation: LIEN, prefill: true, champLead: "utm_content", ...extra });
const SECRET = randomBytes(20).toString("hex"); // tiré au hasard à chaque passage, jamais une valeur figée
const ENV = { ICLOSED_WEBHOOK_SECRET: SECRET, CALENDLY_WEBHOOK_SIGNING_KEY: "cle-inventee", NEXT_PUBLIC_SUPABASE_URL: "https://projet-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-service-inventee" };

test("le registre contient les 4 fournisseurs, chacun sous son identifiant", () => {
  assert.deepEqual(Object.keys(REGISTRE_AGENDA).sort(), [...FOURNISSEURS_AGENDA].sort());
  for (const f of FOURNISSEURS_AGENDA) {
    const a = adaptateurAgenda(f);
    assert.ok(a, f);
    assert.equal(a.id, f);
    assert.equal(typeof a.lienReservation, "function");
    assert.ok(a.libelle.length > 0);
  }
  assert.equal(adaptateurAgenda("autre"), null);
  // Les webhooks : Calendly et iClosed seulement (Google se synchronise, l'agenda interne n'en a pas).
  assert.deepEqual(FOURNISSEURS_AGENDA.filter((f) => adaptateurAgenda(f).webhook), ["calendly", "iclosed"]);
  assert.deepEqual(Object.keys(creerRegistreAgenda({ fuseau: "America/Toronto" })).sort(), [...FOURNISSEURS_AGENDA].sort());
});

test("les variables par NOM : webhook, synchronisation Google, rien pour l'agenda interne ; « RDV pris » quand rien ne revient seul", () => {
  assert.deepEqual(variablesAgenda("calendly"), ["CALENDLY_WEBHOOK_SIGNING_KEY"]);
  assert.deepEqual(variablesAgenda("iclosed"), ["ICLOSED_WEBHOOK_SECRET"]);
  assert.deepEqual(variablesAgenda("google"), ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "CRON_SECRET"]);
  assert.deepEqual(variablesAgenda("aucun"), []);
  const exemple = lire(".env.example");
  for (const f of FOURNISSEURS_AGENDA) for (const v of variablesAgenda(f)) assert.match(exemple, new RegExp(`^${v}=$`, "m"), `${v} absente de .env.example`);
  assert.equal(rdvRecusAutomatiquement("iclosed", ENV), true);
  assert.equal(rdvRecusAutomatiquement("calendly", { ...ENV, CALENDLY_WEBHOOK_SIGNING_KEY: "" }), false, "Calendly sans webhook (offre gratuite) : « RDV pris »");
  assert.equal(rdvRecusAutomatiquement("aucun", ENV), false);
  assert.equal(rdvRecusAutomatiquement("google", ENV), false, "Google sans ses variables");
  const google = { ...ENV, GOOGLE_CLIENT_ID: "id-invente", GOOGLE_CLIENT_SECRET: "secret-invente", GOOGLE_REFRESH_TOKEN: "jeton-invente", CRON_SECRET: "x".repeat(32) };
  assert.equal(rdvRecusAutomatiquement("google", google), true, "Google synchronisé : le Poste n'écrit pas un second rendez-vous");
});

test("lienReservation : Calendly pré-rempli (name, email, utm_content), encodage strict", () => {
  const lien = lienReservationPour(FICHE, config("calendly"));
  const u = new URL(lien);
  assert.equal(u.origin + u.pathname, LIEN);
  assert.equal(u.searchParams.get("name"), "Camille Démo");
  assert.equal(u.searchParams.get("email"), "contact.demo01@example.com");
  assert.equal(u.searchParams.get("utm_content"), LEAD);
  assert.ok(lien.includes("name=Camille%20D%C3%A9mo"), "espace en %20, accent encodé");
  assert.ok(!lien.includes("+"));
  // Caractères spéciaux dans le nom : jamais un paramètre en plus.
  const piege = lienReservationPour({ ...FICHE, dirigeant: "A&B=C #D?e+f" }, config("calendly"));
  assert.equal(new URL(piege).searchParams.get("name"), "A&B=C #D?e+f");
  assert.deepEqual([...new URL(piege).searchParams.keys()], ["name", "email", "utm_content"]);
  // Les paramètres déjà présents dans le lien public sont gardés ; ceux du même nom remplacés.
  const avecRequete = lienReservationPour(FICHE, config("calendly", { lienReservation: `${LIEN}?month=2026-11&utm_content=vieux` }));
  assert.equal(new URL(avecRequete).searchParams.get("month"), "2026-11");
  assert.deepEqual(new URL(avecRequete).searchParams.getAll("utm_content"), [LEAD]);
});

test("lienReservation : prefill false → lien nu ; agenda interne → null ; rien d'inventé", () => {
  assert.equal(lienReservationPour(FICHE, config("calendly", { prefill: false })), LIEN);
  assert.equal(lienReservationPour(FICHE, config("aucun")), null);
  assert.equal(lienReservationPour(FICHE, { fournisseur: "aucun", prefill: true, champLead: "utm_content" }), null);
  assert.equal(lienReservationPour(FICHE, config("calendly", { lienReservation: undefined })), null, "sans lien public : rien");
  assert.equal(lienReservationPour(FICHE, config("calendly", { lienReservation: "http://pas-https.example.org" })), null);
  assert.equal(lienReservationPour(FICHE, config("calendly", { lienReservation: "javascript:alert(1)" })), null);
  const vide = new URL(lienReservationPour({ id: "pas-un-uuid", entreprise: "Atelier Démo 02", dirigeant: null, email: "pas-un-email", telephone: null }, config("calendly")));
  assert.equal(vide.search, "", "aucun champ connu : aucun paramètre (le nom de l'entreprise n'est pas un nom de personne)");
  assert.equal(telephonePourLien({ telephone: "0033 1 99 00 01 01" }), "+33199000101");
  assert.equal(telephonePourLien({ telephone: "01 99 00 01 01" }), null);
  assert.equal(lienAvecParametres("pas une adresse", [["a", "b"]]), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// La route générique
// ---------------------------------------------------------------------------------------------------------------------------------

function dependances({ env = ENV, reponse } = {}) {
  const appels = [];
  const journal = [];
  return {
    appels,
    journal,
    d: {
      env,
      base: () => async (fonction, args) => {
        appels.push({ fonction, args });
        return reponse ? reponse(args, appels.length) : { data: { doublon: false, workspaceId: "w", rendezVousId: "r", leadId: null, aVerifier: true }, error: null };
      },
      journal: (code, grave) => journal.push({ code, grave: Boolean(grave) }),
      maintenantS: () => 1_794_000_000,
    },
  };
}

const callBooked = (uuid = "45526") => ({ hookType: "Call booked", event: { uuid, start_time: "2026-11-10T10:00:00+01:00" }, invitee: { email: "contact.demo01@example.com" } });
const requete = (fournisseur, corps, entetes = {}) =>
  new Request(`https://app.example.org/api/agenda/${fournisseur}/webhook?secret=${encodeURIComponent(SECRET)}`, { method: "POST", headers: entetes, body: corps });

test("webhook : fournisseur inconnu ou sans webhook → 404, sans rien lire", async () => {
  for (const f of ["inconnu", "google", "aucun", "../sante", ""]) {
    const x = dependances();
    const r = await recevoirWebhookAgenda(f, requete("x", "[]"), x.d);
    assert.equal(r.statut, 404, f);
    assert.deepEqual(r.corps, { ok: false, code: "inconnu" });
    assert.equal(x.appels.length, 0);
    assert.ok(x.journal.every((l) => !l.code.includes("sante")), "le segment brut n'est pas journalisé");
  }
});

test("webhook : variables manquantes → 503 sans lire le corps (clé service comprise)", async () => {
  for (const env of [{ ...ENV, ICLOSED_WEBHOOK_SECRET: "" }, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined }, {}]) {
    const x = dependances({ env });
    let lu = false;
    // highWaterMark 0 : le flux n'est tiré que si quelqu'un le lit vraiment.
    const corps = new ReadableStream(
      {
        pull(c) {
          lu = true;
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
    const r = await recevoirWebhookAgenda("iclosed", new Request("https://app.example.org/api/agenda/iclosed/webhook", { method: "POST", body: corps, duplex: "half" }), x.d);
    assert.equal(r.statut, 503);
    assert.equal(lu, false, "le corps n'est pas lu");
    assert.equal(x.appels.length, 0);
  }
});

test("webhook : corps trop gros → 413 (annoncé ou réel)", async () => {
  const gros = "x".repeat(TAILLE_MAX_CORPS + 1);
  const x = dependances();
  assert.equal((await recevoirWebhookAgenda("iclosed", requete("iclosed", gros), x.d)).statut, 413);
  const annonce = dependances();
  assert.equal((await recevoirWebhookAgenda("iclosed", requete("iclosed", "[]", { "content-length": String(TAILLE_MAX_CORPS + 10) }), annonce.d)).statut, 413);
  assert.equal(await lireCorpsBorne(new Request("https://app.example.org/", { method: "POST", body: "abcdef" }), 5), "trop_gros");
  assert.deepEqual(await lireCorpsBorne(new Request("https://app.example.org/", { method: "POST", body: "abc" }), 5), new TextEncoder().encode("abc"));
  assert.equal(x.appels.length + annonce.appels.length, 0);
});

test("webhook : JSON illisible → 400 ; rien d'utile → 200 sans écriture", async () => {
  for (const corps of ["{pas du json", "\xff\xfe"]) {
    const x = dependances();
    const r = await recevoirWebhookAgenda("iclosed", requete("iclosed", corps), x.d);
    assert.equal(r.statut, 400);
    assert.equal(x.appels.length, 0);
  }
  const vide = dependances();
  const r = await recevoirWebhookAgenda("iclosed", requete("iclosed", JSON.stringify([{ hookType: "Contact created" }])), vide.d);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.recus, 0);
  assert.equal(vide.appels.length, 0);
});

test("webhook : erreur définitive de la base → événement écarté, la suite passe (200) ; erreur passagère → 500 (renvoi)", async () => {
  const corps = JSON.stringify([callBooked("1"), callBooked("2"), callBooked("3")]);
  const definitive = dependances({ reponse: (args, n) => (n === 1 ? { data: null, error: { code: "22023" } } : { data: { doublon: false, aVerifier: false }, error: null }) });
  const r = await recevoirWebhookAgenda("iclosed", requete("iclosed", corps), definitive.d);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { ok: true, recus: 3, traites: 2, doublons: 0, aVerifier: 0, rejetes: 1 });
  assert.ok(CODES_DEFINITIFS.has("P0002"), "équipe introuvable : définitif");

  const passagere = dependances({ reponse: (args, n) => (n === 2 ? { data: null, error: { code: "40001" } } : { data: { doublon: false, aVerifier: false }, error: null }) });
  const r2 = await recevoirWebhookAgenda("iclosed", requete("iclosed", corps), passagere.d);
  assert.equal(r2.statut, 500);
  assert.equal(passagere.appels.length, 2, "on s'arrête à la première erreur passagère");
  const injoignable = dependances({ reponse: () => Promise.reject(new Error("réseau")) });
  assert.equal((await recevoirWebhookAgenda("iclosed", requete("iclosed", corps), injoignable.d)).statut, 500);
  const illisible = dependances({ reponse: () => ({ data: "bizarre", error: null }) });
  assert.equal((await recevoirWebhookAgenda("iclosed", requete("iclosed", corps), illisible.d)).statut, 500);
  for (const l of [...definitive.journal, ...passagere.journal]) assert.ok(!l.code.includes(SECRET) && !l.code.includes("contact.demo01"));
});

test("webhook : un verifier qui lève compte pour un refus (401)", async () => {
  const registre = { ...REGISTRE_AGENDA, calendly: { ...calendly, webhook: { ...calendly.webhook, verifier: () => { throw new Error("x"); } } } };
  const x = dependances();
  const r = await recevoirWebhookAgenda("calendly", requete("calendly", "{}"), { ...x.d, registre });
  assert.equal(r.statut, 401);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Contrôles statiques
// ---------------------------------------------------------------------------------------------------------------------------------

test("aucun module Node (« node: », require) dans lib/agenda : le registre est lu par le navigateur", () => {
  const fichiers = readdirSync(new URL("lib/agenda/", RACINE)).filter((f) => f.endsWith(".ts"));
  assert.ok(fichiers.length >= 12);
  for (const f of fichiers) assert.doesNotMatch(lire(`lib/agenda/${f}`), /from\s+["']node:|require\(|import\(["']node:/, f);
});

test("les routes d'agenda sont minces, en Node, sans cache, et ne journalisent ni corps ni jeton", () => {
  for (const f of ["app/api/agenda/[fournisseur]/webhook/route.ts", "app/api/agenda/ics/[jeton]/route.ts", "app/api/agenda/google/sync/route.ts"]) {
    const t = lire(f);
    assert.match(t, /export const dynamic = "force-dynamic";/, f);
    assert.match(t, /export const runtime = "nodejs";/, f);
    assert.ok(t.split("\n").length < 70, `${f} : la logique va dans lib/agenda`);
    assert.doesNotMatch(t, /console\.\w+\([^)]*(jeton|corps|json|requete\.url)/i, `${f} : rien de la requête au journal`);
  }
});
