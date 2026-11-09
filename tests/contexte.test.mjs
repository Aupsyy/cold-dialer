// Le contexte d'une personne connectée (lib/server/contexte.ts) et les rôles (lib/roles.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { autorise, lireContexte, messageDepuisCode, ERR_OPPOSITION, ERR_REFUS } from "../lib/server/contexte.ts";
import { estGestionnaire, ROLES } from "../lib/roles.ts";

const uid = "a1000000-0000-4000-8000-000000000001";
const ws = "a0000000-0000-4000-8000-000000000000";

test("lireContexte : la réponse de contexte(), ou null", () => {
  assert.deepEqual(lireContexte({ uid, workspace_id: ws, role: "membre", nom: "Membre" }), { userId: uid, workspaceId: ws, role: "membre", nom: "Membre" });
  assert.equal(lireContexte({ uid: null, workspace_id: null, role: null, nom: null }), null);
  assert.equal(lireContexte(null), null);
  assert.equal(lireContexte([]), null);
  assert.equal(lireContexte({ uid, workspace_id: ws, role: "roi" }).role, null);
});

test("autorise : équipe, gestionnaire, propriétaire", () => {
  const ctx = (role, workspaceId = ws) => ({ userId: uid, workspaceId, role, nom: null });
  assert.ok(autorise(ctx("appelant"), "equipe"));
  assert.ok(!autorise(ctx("appelant"), "gestionnaire"));
  assert.ok(autorise(ctx("membre"), "gestionnaire"));
  assert.ok(!autorise(ctx("membre"), "proprietaire"));
  assert.ok(autorise(ctx("proprietaire"), "proprietaire"));
  assert.ok(!autorise(ctx("proprietaire", null), "equipe"), "sans équipe, rien");
  assert.deepEqual([...ROLES], ["proprietaire", "membre", "appelant"]);
  assert.ok(estGestionnaire("membre") && !estGestionnaire("appelant") && !estGestionnaire(null));
});

test("messages lisibles par code d'erreur, jamais le détail brut", () => {
  assert.equal(messageDepuisCode("42501"), ERR_REFUS);
  assert.equal(messageDepuisCode("23514"), ERR_OPPOSITION);
  assert.match(messageDepuisCode("23P01"), /chevauche/);
  assert.match(messageDepuisCode("XX999"), /Réessaie/);
});
