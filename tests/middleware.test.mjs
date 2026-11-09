// Le middleware : les routes d'intégration et /api/sante passent sans session ; le reste demande une session (page : /login, API : 401).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projet-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";

const { cheminDeRetour, cheminInterne, decider, estApiPublique, estPagePublique } = await import("../lib/supabase/chemins.ts");
const { middleware, config } = await import("../middleware.ts");
const { NextRequest } = await import("next/server");

const requete = (chemin) => new NextRequest(new URL(chemin, "https://app.example.org"));

test("routes d'intégration et santé : publiques", () => {
  for (const c of ["/api/telephonie/onoff/webhook", "/api/telephonie/aircall/webhook", "/api/agenda/calendly/webhook", "/api/agenda/ics/abc", "/api/sante"]) {
    assert.ok(estApiPublique(c), c);
  }
  for (const c of ["/api/santex", "/api/telephonie", "/api/agendas/x", "/api/actions", "/poste"]) {
    assert.ok(!estApiPublique(c), c);
  }
});

test("pages d'accès publiques ; le reste protégé", () => {
  for (const c of ["/login", "/signup", "/mot-de-passe-oublie", "/auth/callback"]) assert.ok(estPagePublique(c), c);
  for (const c of ["/poste", "/prospects", "/reglages", "/nouveau-mot-de-passe", "/loginx", "/"]) assert.ok(!estPagePublique(c), c);
});

test("les décisions", () => {
  assert.equal(decider("/poste", false), "vers_connexion");
  assert.equal(decider("/api/autre", false), "refus_api");
  assert.equal(decider("/api/sante", false), "suivant");
  assert.equal(decider("/login", false), "suivant");
  assert.equal(decider("/login", true), "vers_accueil");
  assert.equal(decider("/signup", true), "vers_accueil");
  assert.equal(decider("/poste", true), "suivant");
});

test("l'écran gardé pour après la connexion : un écran de l'application, jamais une adresse extérieure", () => {
  assert.equal(cheminDeRetour("/prospects/abc-123"), "/prospects/abc-123");
  for (const v of ["//site.example", "https://site.example", "/poste?x=1", "/admin", "\\\\site", 42]) assert.equal(cheminDeRetour(v), null, String(v));
  const o = "https://app.example.org";
  assert.equal(cheminInterne("/nouveau-mot-de-passe", o, "/poste"), "/nouveau-mot-de-passe");
  for (const v of ["//site.example", "https://site.example/x", "/\\site", null, "poste"]) assert.equal(cheminInterne(v, o, "/poste"), "/poste", String(v));
});

test("le middleware laisse passer les webhooks et /api/sante sans toucher à la session", async () => {
  for (const c of ["/api/telephonie/onoff/webhook", "/api/agenda/ics/abc", "/api/sante"]) {
    const r = await middleware(requete(c));
    assert.equal(r.headers.get("x-middleware-next"), "1", c);
  }
});

test("sans session : une page renvoie vers /login (avec l'écran demandé), une route /api/ répond 401", async () => {
  const page = await middleware(requete("/prospects"));
  assert.equal(page.status, 307);
  const destination = new URL(page.headers.get("location"));
  assert.equal(destination.pathname, "/login");
  assert.equal(destination.searchParams.get("suite"), "/prospects");
  const api = await middleware(requete("/api/actions"));
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { ok: false, code: "non_connecte" });
  const login = await middleware(requete("/login"));
  assert.equal(login.headers.get("x-middleware-next"), "1");
});

test("le matcher épargne les fichiers statiques", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  assert.ok(re.test("/poste"));
  assert.ok(re.test("/api/sante"));
  for (const f of ["/_next/static/x.js", "/_next/image", "/favicon.ico", "/icon.svg", "/logo.png"]) assert.ok(!re.test(f), f);
});
