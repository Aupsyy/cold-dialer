// Sans configuration Supabase : les pages d'accès et les routes publiques s'ouvrent, le reste répond 500 (rien n'est servi sans base).
import assert from "node:assert/strict";
import { test } from "node:test";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { middleware } = await import("../middleware.ts");
const { NextRequest } = await import("next/server");
const requete = (chemin) => new NextRequest(new URL(chemin, "https://app.example.org"));

test("sans configuration : 500 sur les écrans protégés, passage libre sur les pages d'accès et /api/sante", async () => {
  assert.equal((await middleware(requete("/poste"))).status, 500);
  assert.equal((await middleware(requete("/api/actions"))).status, 500);
  assert.equal((await middleware(requete("/login"))).headers.get("x-middleware-next"), "1");
  assert.equal((await middleware(requete("/api/sante"))).headers.get("x-middleware-next"), "1");
});
