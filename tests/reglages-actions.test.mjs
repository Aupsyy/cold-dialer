// Les actions serveur de l'écran Réglages (app/(app)/reglages/actions.ts), exécutées pour de vrai avec le vrai client Supabase dont seul
// le réseau est simulé (tests/poste-base-factice.mjs pour la session, tests/reglages-factices.mjs pour la clé service et next/cache) :
// les rôles insuffisants et les saisies invalides s'arrêtent avant toute écriture ; chaque geste envoie la requête PostgREST attendue
// (fonction SQL, table, filtres, corps) ; la purge et l'effacement passent par la clé service seulement là où la RLS ne le permet pas ;
// le journal ne porte que des codes (jamais le jeton d'une invitation, un e-mail, un identifiant ni le chemin d'un audio).
// Sur la niche d'exemple (CONTRIBUTING.md) : téléphone, agenda interne, tentativesMax 4, conservation 36 mois.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register(
  "data:text/javascript," +
    encodeURIComponent(`
let faux = "";
let factices = "";
export async function initialize(d) { faux = d.faux; factices = d.factices; }
export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  if (specifier === "../supabase/server" && parent.endsWith("/lib/server/action-kit.ts")) return { url: faux, shortCircuit: true };
  if (specifier === "@/lib/supabase/service" && parent.endsWith("/reglages/actions.ts")) return { url: factices, shortCircuit: true };
  if (specifier === "next/cache") return { url: factices, shortCircuit: true };
  return next(specifier, context);
}`),
  {
    parentURL: import.meta.url,
    data: { faux: new URL("./poste-base-factice.mjs", import.meta.url).href, factices: new URL("./reglages-factices.mjs", import.meta.url).href },
  },
);

const base = await import("./poste-base-factice.mjs");
const factices = await import("./reglages-factices.mjs");
const actions = await import("../app/(app)/reglages/actions.ts");
const { ERR_REFUS } = await import("../lib/server/contexte.ts");

const WS = "a0000000-0000-4000-8000-000000000000";
const MOI = "a1000000-0000-4000-8000-000000000001";
const AUTRE = "a3000000-0000-4000-8000-000000000003";
const INVITATION = "e1000000-0000-4000-8000-000000000001";
const LEAD = "ca100000-0000-4000-8000-000000000001";
const JETON = "9f".repeat(32);
const CHEMIN = `${WS}/onoff/appel-efface-1.mp3`;
const LUNDI = Date.parse("2026-11-09T09:00:00Z");

/** La session : le contexte de la personne connectée (ou personne), puis les réponses par « MÉTHODE chemin ». */
function session(role, routes = {}) {
  base.repondre((r) => {
    if (r.methode === "POST" && r.chemin === "rpc/contexte") return { corps: role ? { uid: MOI, workspace_id: WS, role, nom: "Camille Démo" } : {} };
    const f = routes[`${r.methode} ${r.chemin}`];
    return typeof f === "function" ? f(r) : (f ?? { corps: [] });
  });
}
function service(routes = {}, options = {}) {
  factices.repondreService((r) => {
    const f = routes[`${r.methode} ${r.chemin}`];
    return typeof f === "function" ? f(r) : (f ?? { corps: [] });
  }, options);
}
const ecritures = () => base.requetes.filter((r) => r.chemin !== "rpc/contexte");
const param = (r, cle) => r.params.getAll(cle);
const journalDe = (t) => t.mock.method(console, "error", () => {});
const texteJournal = (j) => j.mock.calls.map((c) => c.arguments.join(" ")).join("\n");

/** Le stockage simulé (fetch global) : les requêtes notées ; la clé et l'URL du projet posées pour le temps du test. */
function stockage(t, repondre = () => new Response("[]", { status: 200 })) {
  const cle = `cle-${Math.random().toString(36).slice(2)}`;
  const avant = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, cle: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stockage.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = cle;
  t.after(() => {
    for (const [nom, v] of [["NEXT_PUBLIC_SUPABASE_URL", avant.url], ["SUPABASE_SERVICE_ROLE_KEY", avant.cle]]) {
      if (v === undefined) delete process.env[nom];
      else process.env[nom] = v;
    }
  });
  const requetes = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const r = { url: String(url), methode: init.method ?? "GET", corps: typeof init.body === "string" ? JSON.parse(init.body) : null };
    requetes.push(r);
    return repondre(r);
  });
  return { requetes, cle };
}

test("personne de connecté, puis un appelant : chaque geste des gestionnaires est refusé avant toute écriture", async () => {
  service();
  session(null);
  assert.deepEqual(await actions.modifierObjectif({ objectif: 10 }), { ok: false, error: "Tu dois être connecté." });
  session("appelant");
  const gestes = [
    () => actions.definirEmailTelephonie({ membreId: AUTRE, email: "poste@example.com" }),
    () => actions.creerInvitation({ role: "appelant", email: "lou@example.com" }),
    () => actions.revoquerInvitation({ invitationId: INVITATION }),
    () => actions.activerEnregistrement({ accepte: true }),
    () => actions.desactiverEnregistrement(),
    () => actions.alignerTentatives(),
    () => actions.modifierObjectif({ objectif: 10 }),
    () => actions.compterPurge(),
    () => actions.purgerMaintenant({ confirme: true }),
    () => actions.changerRole({ membreId: AUTRE, role: "membre" }),
    () => actions.retirerMembre({ membreId: AUTRE }),
    () => actions.effacerFiche({ leadId: LEAD, confirme: true }),
  ];
  for (const geste of gestes) assert.deepEqual(await geste(), { ok: false, error: ERR_REFUS });
  assert.deepEqual(ecritures(), [], "aucune requête après le contexte");
  assert.deepEqual(factices.requetesService, [], "jamais la clé service");
});

test("un membre : les gestes du propriétaire (rôles, retrait, effacement d'une fiche) sont refusés avant toute écriture", async () => {
  service();
  session("membre");
  for (const geste of [
    () => actions.changerRole({ membreId: AUTRE, role: "appelant" }),
    () => actions.retirerMembre({ membreId: AUTRE }),
    () => actions.effacerFiche({ leadId: LEAD, confirme: true, opposition: true }),
  ]) {
    assert.deepEqual(await geste(), { ok: false, error: ERR_REFUS });
  }
  assert.match((await actions.creerInvitation({ role: "proprietaire", nom: "Associée" })).error, /Seul le propriétaire invite un autre propriétaire/);
  assert.deepEqual(ecritures(), []);
  assert.deepEqual(factices.requetesService, []);
});

test("les saisies invalides s'arrêtent avant la base", async () => {
  service();
  session("proprietaire");
  const cas = [
    [() => actions.changerRole({ membreId: MOI, role: "appelant" }), /propre rôle/],
    [() => actions.changerRole({ membreId: AUTRE, role: "roi" }), /Choisis un rôle/],
    [() => actions.retirerMembre({ membreId: MOI }), /te retirer toi-même/],
    [() => actions.retirerMembre({ membreId: "pas-un-uuid" }), /identifiant invalide/],
    [() => actions.definirEmailTelephonie({ membreId: AUTRE, email: "pas-un-email" }), /adresse invalide/],
    [() => actions.creerInvitation({ role: "appelant", email: "", nom: "" }), /e-mail ou le nom/],
    [() => actions.modifierObjectif({ objectif: 5000 }), /de 0 à 1000/],
    [() => actions.modifierMonNom({ nom: "" }), /obligatoire/],
    [() => actions.activerEnregistrement({}), /Coche d'abord/],
    [() => actions.activerEnregistrement({ accepte: true }), /Le téléphone n'envoie aucun enregistrement/],
    [() => actions.purgerMaintenant({}), /Confirme d'abord/],
    [() => actions.effacerFiche({ leadId: LEAD }), /Confirme d'abord/],
    [() => actions.revoquerInvitation("n'importe quoi"), /Saisie illisible/],
  ];
  for (const [geste, motif] of cas) {
    const r = await geste();
    assert.equal(r.ok, false);
    assert.match(r.error, motif);
  }
  assert.deepEqual(ecritures(), [], "aucune écriture, aucune lecture");
  assert.deepEqual(factices.requetesService, []);
});

test("chargerReglages : toute l'équipe et les invitations en attente pour un gestionnaire (jamais le jeton) ; son profil pour un appelant", async () => {
  service();
  session("membre", {
    "GET profiles": { corps: [{ id: MOI, nom: "Camille Démo", email: "camille@example.com", role: "membre", email_telephonie: null }, { id: AUTRE, nom: "Alex", role: "appelant" }] },
    "GET reglages": { corps: [{ enregistrement_complet: false, annonce_lue_le: null, tentatives_max: 4, objectif_appels_jour: 60 }] },
    "GET invitations": { corps: [{ id: INVITATION, role: "appelant", email: "lou@example.com", nom_invite: null, expire_le: "2026-11-23T09:00:00Z" }] },
  });
  const r = await actions.chargerReglages();
  assert.equal(r.ok, true);
  assert.equal(r.data.role, "membre");
  assert.equal(r.data.moi.id, MOI);
  assert.deepEqual(r.data.equipe.map((m) => m.id), [MOI, AUTRE]);
  assert.deepEqual(r.data.invitations.map((i) => i.id), [INVITATION]);
  assert.equal(r.data.reglages.tentativesMax, 4);
  const inv = ecritures().find((x) => x.chemin === "invitations");
  assert.doesNotMatch(inv.params.get("select"), /jeton/, "la liste ne lit jamais le jeton");
  assert.deepEqual(param(inv, "acceptee_le"), ["is.null"]);
  assert.ok(ecritures().every((x) => x.methode === "GET"), "la lecture n'écrit rien");

  session("appelant", { "GET profiles": { corps: [{ id: MOI, nom: "Camille Démo", role: "appelant" }] } });
  const a = await actions.chargerReglages();
  assert.equal(a.ok, true);
  assert.deepEqual(a.data.invitations, []);
  assert.deepEqual(ecritures().map((x) => x.chemin).sort(), ["profiles", "reglages"], "un appelant ne lit pas les invitations");
  assert.deepEqual(param(ecritures().find((x) => x.chemin === "profiles"), "id"), [`eq.${MOI}`]);
});

test("l'équipe : changer_role, retirer_membre, definir_email_telephonie, son nom ; refus de la base lisibles et journal en codes", async (t) => {
  service();
  session("proprietaire", { "POST rpc/changer_role": { status: 204 }, "POST rpc/retirer_membre": { status: 204 } });
  assert.deepEqual(await actions.changerRole({ membreId: AUTRE, role: "membre" }), { ok: true, data: null });
  assert.deepEqual(await actions.retirerMembre({ membreId: AUTRE }), { ok: true, data: null });
  assert.deepEqual(
    ecritures().map((x) => [`${x.methode} ${x.chemin}`, x.corps]),
    [
      ["POST rpc/changer_role", { p_membre: AUTRE, p_role: "membre" }],
      ["POST rpc/retirer_membre", { p_membre: AUTRE }],
    ],
  );
  assert.deepEqual(factices.revalidations, ["/reglages", "/reglages"]);

  session("membre", { "POST rpc/definir_email_telephonie": { status: 204 }, "PATCH profiles": { corps: [{ id: MOI }] } });
  assert.deepEqual(await actions.definirEmailTelephonie({ membreId: AUTRE, email: " Poste.Alex@Example.com " }), { ok: true, data: null });
  assert.deepEqual(await actions.definirEmailTelephonie({ membreId: AUTRE, email: "" }), { ok: true, data: null });
  assert.deepEqual(await actions.modifierMonNom({ nom: " Camille Démo " }), { ok: true, data: null });
  const [poser, effacer, nom] = ecritures();
  assert.deepEqual(poser.corps, { p_membre: AUTRE, p_email: "poste.alex@example.com" });
  assert.deepEqual(effacer.corps, { p_membre: AUTRE, p_email: null }, "vide : l'e-mail de téléphonie est effacé");
  assert.equal(nom.methode, "PATCH");
  assert.deepEqual(nom.corps, { nom: "Camille Démo" });
  assert.deepEqual(param(nom, "id"), [`eq.${MOI}`], "seulement son propre profil");

  const journal = journalDe(t);
  session("membre", {
    "POST rpc/definir_email_telephonie": { status: 409, corps: { code: "23505", message: "poste.alex@example.com", details: null, hint: null } },
  });
  const doublon = await actions.definirEmailTelephonie({ membreId: AUTRE, email: "poste.alex@example.com" });
  assert.match(doublon.error, /déjà celui d'un autre compte/);
  session("proprietaire", { "POST rpc/changer_role": { status: 404, corps: { code: "P0002", message: "Membre introuvable.", details: null, hint: null } } });
  assert.match((await actions.changerRole({ membreId: AUTRE, role: "appelant" })).error, /n'est plus dans l'équipe/);
  const ecrit = texteJournal(journal);
  assert.match(ecrit, /reglages\.email_telephonie 23505/);
  assert.doesNotMatch(ecrit, /@|a3000000/, "jamais un e-mail ni un identifiant");
});

test("les invitations : le jeton tiré par la base est rendu une fois, jamais journalisé ; la révocation ne vise qu'une invitation en attente", async (t) => {
  const journal = journalDe(t);
  service();
  session("membre", { "POST invitations": { status: 201, corps: { jeton: JETON, expire_le: "2026-11-23T09:00:00Z" } } });
  const r = await actions.creerInvitation({ role: "appelant", email: "Lou.Demo@Example.com", nom: "" });
  assert.deepEqual(r, { ok: true, data: { jeton: JETON, expireLe: "2026-11-23T09:00:00Z" } });
  const [ecriture] = ecritures();
  assert.equal(ecriture.methode, "POST");
  assert.deepEqual(ecriture.corps, { role: "appelant", email: "lou.demo@example.com", nom_invite: null }, "ni jeton, ni équipe, ni auteur venus du navigateur");
  assert.equal(ecriture.params.get("select"), "jeton,expire_le");

  session("membre", { "POST invitations": { status: 201, corps: { jeton: "illisible" } } });
  assert.match((await actions.creerInvitation({ role: "appelant", nom: "Lou" })).error, /révoque-la et recommence/);

  session("membre", { "POST invitations": { status: 403, corps: { code: "42501", message: "new row violates row-level security policy", details: null, hint: null } } });
  assert.match((await actions.creerInvitation({ role: "membre", nom: "Lou" })).error, /ne peux pas créer cette invitation/);

  session("membre", { "DELETE invitations": { corps: [{ id: INVITATION }] } });
  assert.deepEqual(await actions.revoquerInvitation({ invitationId: INVITATION }), { ok: true, data: null });
  const [revocation] = ecritures();
  assert.deepEqual(param(revocation, "id"), [`eq.${INVITATION}`]);
  assert.deepEqual(param(revocation, "acceptee_le"), ["is.null"], "une invitation déjà utilisée n'est jamais touchée");
  session("membre", { "DELETE invitations": { corps: [] } });
  assert.match((await actions.revoquerInvitation({ invitationId: INVITATION })).error, /déjà été utilisée ou révoquée/);

  const ecrit = texteJournal(journal);
  assert.ok(!ecrit.includes(JETON), "le jeton n'est jamais journalisé");
  assert.doesNotMatch(ecrit, /@|signup/);
});

test("les réglages : plafond aligné sur la configuration (valeur du serveur), objectif, désactivation ; la ligne de l'équipe seulement", async () => {
  service();
  session("membre", { "PATCH reglages": { corps: [{ workspace_id: WS }] } });
  assert.deepEqual(await actions.alignerTentatives(), { ok: true, data: { tentativesMax: 4 } });
  assert.deepEqual(await actions.modifierObjectif({ objectif: "45" }), { ok: true, data: null });
  assert.deepEqual(await actions.desactiverEnregistrement(), { ok: true, data: null });
  const [plafond, objectif, arret] = ecritures();
  assert.deepEqual(plafond.corps, { tentatives_max: 4 }, "tentativesMax de la niche d'exemple");
  assert.deepEqual(objectif.corps, { objectif_appels_jour: 45 });
  assert.deepEqual(arret.corps, { enregistrement_complet: false });
  for (const e of [plafond, objectif, arret]) {
    assert.equal(e.methode, "PATCH");
    assert.deepEqual(param(e, "workspace_id"), [`eq.${WS}`]);
  }
  assert.ok(factices.revalidations.includes("/poste"), "le Poste relit l'objectif");

  session("membre", { "PATCH reglages": { corps: [] } });
  assert.deepEqual(await actions.modifierObjectif({ objectif: 10 }), { ok: false, error: ERR_REFUS }, "aucune ligne touchée : refus");
});

test("compterPurge : des comptages sous la RLS (rien n'est écrit), les fiches qui ont un rendez-vous à venir retirées du compte", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LUNDI });
  service();
  const LIMITE = "2023-11-09T09:00:00.000Z";
  const filtre = `(last_activity_at.lt.${LIMITE},and(last_activity_at.is.null,created_at.lt.${LIMITE}))`;
  const compte = (n) => ({ status: 200, corps: null, entetes: { "content-range": `*/${n}` } });
  session("membre", {
    "HEAD leads": (r) => (r.params.get("id") ? compte(1) : compte(5)),
    "GET rendez_vous": { corps: [{ lead_id: LEAD }, { lead_id: LEAD }] },
    "HEAD appels": compte(7),
    "HEAD rendez_vous": compte(2),
    "HEAD debriefs": compte(1),
    "HEAD retours_marche": compte(3),
  });
  const r = await actions.compterPurge();
  assert.deepEqual(r, { ok: true, data: { mois: 36, limite: LIMITE, fiches: 4, appels: 7, rendezVous: 2, debriefs: 1, retours: 3, cleService: true } });
  const leads = ecritures().filter((x) => x.chemin === "leads");
  assert.equal(leads.length, 2);
  for (const q of leads) assert.deepEqual(param(q, "or"), [filtre]);
  assert.deepEqual(param(leads.find((q) => q.params.get("id")), "id"), [`in.(${LEAD})`], "les fiches gardées, sans doublon");
  const avenir = ecritures().find((x) => x.methode === "GET" && x.chemin === "rendez_vous");
  assert.deepEqual(param(avenir, "lead_id"), ["not.is.null"]);
  assert.deepEqual(param(avenir, "debut"), [`gt.${new Date(LUNDI).toISOString()}`]);
  assert.deepEqual(param(avenir, "statut"), ["in.(pris,confirme)"]);
  assert.deepEqual([param(avenir, "order"), param(avenir, "offset"), param(avenir, "limit")], [["id.asc"], ["0"], ["1000"]], "lus page par page");
  assert.deepEqual(param(ecritures().find((x) => x.chemin === "appels"), "created_at"), [`lt.${LIMITE}`]);
  assert.deepEqual(param(ecritures().find((x) => x.chemin === "retours_marche"), "appel_le"), [`lt.${LIMITE}`]);
  assert.ok(ecritures().every((x) => x.methode === "GET" || x.methode === "HEAD"), "rien n'est écrit");
  assert.deepEqual(factices.requetesService, [], "le comptage n'utilise pas la clé service");
});

test("purgerMaintenant : la base (clé service), ses audios, le journal des webhooks, puis les audios restés sans appel ; des compteurs", async (t) => {
  const journal = journalDe(t);
  const vieux = "2020-01-01T00:00:00Z";
  const recent = new Date(Date.now() - 86_400_000).toISOString();
  const s = stockage(t, (r) => {
    if (r.methode === "DELETE") return new Response(r.corps.prefixes[0].includes("refuse") ? "{}" : "[]", { status: r.corps.prefixes[0].includes("refuse") ? 403 : 200 });
    if (r.corps.prefix === `${WS}/onoff`) {
      return new Response(
        JSON.stringify([
          { name: "orphelin-1.mp3", id: "o1", created_at: vieux },
          { name: "garde-1.mp3", id: "g1", created_at: vieux },
          { name: "recent-1.mp3", id: "r1", created_at: recent },
        ]),
        { status: 200 },
      );
    }
    return new Response("[]", { status: 200 });
  });
  session("membre");
  service({
    "POST rpc/purger_fiches_inactives": {
      corps: { fiches: 2, appels: 3, rendezVous: 1, debriefs: 0, retours: 1, enregistrementsAEffacer: [CHEMIN, `${WS}/aircall/audio-refuse.wav`] },
    },
    "POST rpc/purger_integrations_evenements": { corps: 5 },
    "GET appels": { corps: [{ enregistrement_chemin: `${WS}/onoff/garde-1.mp3` }] },
  });
  const r = await actions.purgerMaintenant({ confirme: true });
  assert.equal(r.ok, true);
  assert.deepEqual(
    { ...r.data, orphelins: { effaces: r.data.orphelins.effaces, orphelins: r.data.orphelins.orphelins, complet: r.data.orphelins.complet } },
    {
      mois: 36,
      fiches: 2,
      appels: 3,
      rendezVous: 1,
      debriefs: 0,
      retours: 1,
      evenements: 5,
      audiosEffaces: 1,
      audiosEnEchec: 1,
      audiosEnAttente: 0,
      orphelins: { effaces: 1, orphelins: 1, complet: true },
      balayageSaute: false,
    },
  );
  assert.deepEqual(
    factices.requetesService.map((x) => `${x.methode} ${x.chemin}`),
    ["POST rpc/purger_fiches_inactives", "POST rpc/purger_integrations_evenements", "GET appels"],
  );
  assert.deepEqual(factices.requetesService[0].corps, { p_mois: 36 }, "la durée de la configuration");
  const references = factices.requetesService[2];
  assert.deepEqual(param(references, "enregistrement_chemin"), [`in.(${WS}/onoff/orphelin-1.mp3,${WS}/onoff/garde-1.mp3)`]);
  const effaces = s.requetes.filter((x) => x.methode === "DELETE").map((x) => x.corps.prefixes[0]);
  assert.deepEqual(effaces, [CHEMIN, `${WS}/aircall/audio-refuse.wav`, `${WS}/onoff/orphelin-1.mp3`], "jamais un audio qu'un appel désigne encore");
  assert.ok(s.requetes.every((x) => x.url.startsWith("http://stockage.test/storage/v1/object/")));
  assert.deepEqual(ecritures(), [], "rien d'autre sous la session : la purge n'est pas ouverte aux comptes connectés");
  const ecrit = texteJournal(journal);
  assert.match(ecrit, /purge:audio:stockage_403/);
  assert.ok(!ecrit.includes(WS) && !ecrit.includes(s.cle), "ni chemin, ni identifiant, ni clé dans le journal");
});

test("purgerMaintenant sans clé service : refus lisible, rien n'est tenté", async () => {
  session("proprietaire");
  service({}, { sansCle: true });
  const r = await actions.purgerMaintenant({ confirme: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /clé service.*node scripts\/maintenance\/purger\.mjs/);
  assert.deepEqual(ecritures(), []);
});

test("effacerFiche : sans SIREN ni numéro, la liste d'opposition reçoit la clé nom + code postal calculée par la base", async (t) => {
  journalDe(t);
  stockage(t);
  session("proprietaire", {
    "GET leads": { corps: [{ id: LEAD, siren: null, telephone: null, mobile: null, entreprise: "Atelier Démo 01", cp: "75001", statut: "a_appeler" }] },
    "POST rpc/cle_entreprise": { corps: "atelier demo 01|75001" },
    "POST opposition": { status: 201, corps: null },
    "DELETE rendez_vous": { corps: [] },
    "DELETE retours_marche": { corps: [] },
    "DELETE leads": { corps: [{ id: LEAD }] },
  });
  service({ "GET appels": { corps: [] }, "DELETE appels": { corps: [] } });
  const r = await actions.effacerFiche({ leadId: LEAD, opposition: true, confirme: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.opposition, "inscrite");
  const cle = ecritures().find((x) => x.chemin === "rpc/cle_entreprise");
  assert.deepEqual(cle.corps, { p_entreprise: "Atelier Démo 01", p_cp: "75001" });
  const opposition = ecritures().find((x) => x.chemin === "opposition");
  assert.deepEqual(opposition.corps, { cle: "atelier demo 01|75001", motif: "Demande d'effacement", source: "manuel" });
});

test("effacerFiche : l'opposition d'abord, les audios PUIS les appels (clé service), ses rendez-vous, ses retours, puis la fiche ; aucune relecture de la page", async (t) => {
  const journal = journalDe(t);
  const s = stockage(t);
  session("proprietaire", {
    "GET leads": { corps: [{ id: LEAD, siren: "000000001", telephone: "+33199000101", mobile: "06 39 98 00 01", statut: "a_appeler" }] },
    "POST opposition": { status: 201, corps: null },
    "DELETE rendez_vous": { corps: [{ id: "r1" }] },
    "DELETE retours_marche": { corps: [{ id: "m1" }, { id: "m2" }] },
    "DELETE leads": { corps: [{ id: LEAD }] },
  });
  service({
    "GET appels": (r) => (r.params.get("lead_id") === `eq.${LEAD}` ? { corps: [{ enregistrement_chemin: CHEMIN }] } : { corps: [] }),
    "DELETE appels": (r) => (r.params.get("lead_id") === `eq.${LEAD}` ? { corps: [{ id: "a1" }, { id: "a2" }] } : { corps: [{ id: "a3" }] }),
  });
  const r = await actions.effacerFiche({ leadId: LEAD, opposition: true, confirme: true });
  assert.deepEqual(r, { ok: true, data: { appels: 4, audios: 1, rendezVous: 1, retours: 2, opposition: "inscrite" } });

  assert.deepEqual(
    ecritures().map((x) => `${x.methode} ${x.chemin}`),
    ["GET leads", "POST opposition", "DELETE rendez_vous", "DELETE retours_marche", "DELETE leads"],
  );
  const [lecture, opposition, rdv, retours, fiche] = ecritures();
  assert.deepEqual(param(lecture, "id"), [`eq.${LEAD}`]);
  assert.deepEqual(opposition.corps, { siren: "000000001", motif: "Demande d'effacement", source: "manuel" });
  for (const e of [rdv, retours]) assert.deepEqual(param(e, "lead_id"), [`eq.${LEAD}`]);
  assert.deepEqual(param(fiche, "id"), [`eq.${LEAD}`]);

  assert.deepEqual(
    factices.requetesService.map((x) => `${x.methode} ${x.chemin}`),
    ["GET appels", "GET appels", "GET appels", "DELETE appels", "DELETE appels", "DELETE appels"],
    "les audios lus et effacés AVANT les lignes des appels",
  );
  for (const x of factices.requetesService) assert.deepEqual(param(x, "workspace_id"), [`eq.${WS}`], "jamais hors de l'équipe");
  const [parFiche, ...parNumero] = factices.requetesService.slice(0, 3);
  assert.deepEqual(param(parFiche, "lead_id"), [`eq.${LEAD}`]);
  assert.deepEqual(param(parFiche, "enregistrement_chemin"), ["not.is.null"]);
  assert.deepEqual(
    parNumero.map((x) => [param(x, "lead_id")[0], param(x, "numero_externe")[0]]),
    [
      ["is.null", "like.%199000101"],
      ["is.null", "like.%639980001"],
    ],
    "les appels arrivés sans fiche à l'un de ses numéros",
  );
  assert.deepEqual(s.requetes.map((x) => x.corps.prefixes), [[CHEMIN]]);
  assert.deepEqual(factices.revalidations, [], "pas de revalidatePath : Next.js relirait la fiche effacée (une 404) au lieu du compte rendu");
  assert.doesNotMatch(texteJournal(journal), /ca100000|199000101|onoff\//);
});

test("effacerFiche : un audio qui ne s'efface pas arrête tout avant les appels ; une fiche déjà effacée le dit", async (t) => {
  journalDe(t);
  stockage(t, () => new Response("{}", { status: 403 }));
  session("proprietaire", {
    "GET leads": { corps: [{ id: LEAD, siren: null, telephone: "+33199000101", mobile: null, statut: "a_appeler" }] },
  });
  service({ "GET appels": (r) => (r.params.get("lead_id") === `eq.${LEAD}` ? { corps: [{ enregistrement_chemin: CHEMIN }] } : { corps: [] }) });
  const r = await actions.effacerFiche({ leadId: LEAD, opposition: false, confirme: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /audio n'a pas pu être retiré du stockage \(code stockage_403\).*relance/);
  assert.ok(!factices.requetesService.some((x) => x.methode === "DELETE"), "les appels restent : la relance retrouvera l'audio");
  assert.deepEqual(ecritures().map((x) => `${x.methode} ${x.chemin}`), ["GET leads"], "ni opposition (non demandée), ni rendez-vous, ni fiche");

  service();
  session("proprietaire", {
    "GET leads": { corps: [{ id: LEAD, siren: null, telephone: "+33199000101", mobile: null, statut: "a_appeler" }] },
    "DELETE leads": { corps: [] },
  });
  assert.deepEqual(await actions.effacerFiche({ leadId: LEAD, confirme: true }), { ok: false, error: "Cette fiche a déjà été effacée." });
});

test("effacerFiche sans clé service : refus avant toute écriture si la fiche a des appels ; sinon, tout sous la RLS", async () => {
  service({}, { sansCle: true });
  session("proprietaire", {
    "GET leads": { corps: [{ id: LEAD, siren: null, telephone: "+33199000101", mobile: null, statut: "ne_plus_contacter" }] },
    "HEAD appels": { status: 200, corps: null, entetes: { "content-range": "*/2" } },
  });
  const r = await actions.effacerFiche({ leadId: LEAD, opposition: true, confirme: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /clé service.*Rien n'a été effacé/);
  assert.deepEqual(ecritures().map((x) => `${x.methode} ${x.chemin}`), ["GET leads", "HEAD appels"]);
  assert.deepEqual(param(ecritures()[1], "or"), [`(lead_id.eq.${LEAD},and(lead_id.is.null,numero_externe.like.*199000101))`]);

  session("proprietaire", {
    "GET leads": { corps: [{ id: LEAD, siren: null, telephone: "+33199000101", mobile: null, statut: "ne_plus_contacter" }] },
    "HEAD appels": { status: 200, corps: null, entetes: { "content-range": "*/0" } },
    "POST opposition": { status: 409, corps: { code: "23505", message: "doublon", details: null, hint: null } },
    "DELETE leads": { corps: [{ id: LEAD }] },
  });
  const ok = await actions.effacerFiche({ leadId: LEAD, opposition: false, confirme: true });
  assert.deepEqual(ok, { ok: true, data: { appels: 0, audios: 0, rendezVous: 0, retours: 0, opposition: "deja" } });
  const inscription = ecritures().find((x) => x.chemin === "opposition");
  assert.deepEqual(inscription.corps, { telephone: "33199000101", motif: "Demande d'effacement", source: "manuel" }, "« ne plus contacter » : on vérifie en inscrivant");

  session("proprietaire", { "GET leads": { corps: [] } });
  assert.match((await actions.effacerFiche({ leadId: LEAD, confirme: true })).error, /Fiche introuvable/);
});
