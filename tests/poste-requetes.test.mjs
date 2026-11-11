// Les actions serveur du Poste et des prospects (app/_actions), exécutées pour de vrai avec le vrai client Supabase dont seul le réseau est
// simulé (tests/poste-base-factice.mjs) : ce test vérifie les requêtes PostgREST qu'elles envoient (tables, fonctions SQL, filtres, corps),
// que les entrées invalides et les rôles insuffisants s'arrêtent avant toute écriture, et que le journal ne garde que des codes.
// Le vrai parcours, sur une vraie base, est joué par les tests SQL (supabase/tests/poste.sql).
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
  // La session commune lit son branchement avec la clé service (lib/concours/serveur.ts) : ici, un client service simulé.
  if (specifier === "@/lib/supabase/service" && parent.endsWith("/lib/concours/serveur.ts")) return { url: factices, shortCircuit: true };
  return next(specifier, context);
}`),
  {
    parentURL: import.meta.url,
    data: { faux: new URL("./poste-base-factice.mjs", import.meta.url).href, factices: new URL("./reglages-factices.mjs", import.meta.url).href },
  },
);

const base = await import("./poste-base-factice.mjs");
const { enregistrerIssue, noterAnnonceLue, poserRdv } = await import("../app/_actions/issue.ts");
const { attribuerFiche, creerProspect, modifierContact, reserverFiche } = await import("../app/_actions/fiche.ts");
const { chargerPoste } = await import("../app/_actions/file.ts");
const { listerProspects } = await import("../app/_actions/filtres.ts");
const { prendreMesLeads, rendreMesLeads } = await import("../app/_actions/mes-leads.ts");
// La config que lisent les actions (la niche d'exemple, par le chargeur des tests) : son plafond de tentatives part avec l'issue.
const { niche } = await import("../config/niche.ts");

const LUNDI_10H = Date.parse("2026-11-09T09:00:00Z");
const WS = "a0000000-0000-4000-8000-000000000000";
const APPELANT = "a3000000-0000-4000-8000-000000000003";
const LEAD = "ca100000-0000-4000-8000-000000000001";
const LEAD2 = "ca200000-0000-4000-8000-000000000002";

/** Un répondeur : le contexte de la personne connectée, puis les réponses par « MÉTHODE chemin ». */
function base_(role, routes = {}) {
  base.repondre((r) => {
    if (r.methode === "POST" && r.chemin === "rpc/contexte") return { corps: { uid: APPELANT, workspace_id: WS, role, nom: "Alex Démo" } };
    const f = routes[`${r.methode} ${r.chemin}`];
    return typeof f === "function" ? f(r) : (f ?? { corps: [] });
  });
}
const appels = () => base.requetes.filter((r) => r.chemin !== "rpc/contexte");
const param = (r, cle) => r.params.getAll(cle);

function horlogeFixe(t) {
  t.mock.timers.enable({ apis: ["Date"], now: LUNDI_10H });
}

test("enregistrerIssue : la fonction SQL enregistrer_issue, avec le rappel au créneau alterné calculé par le serveur", async (t) => {
  horlogeFixe(t);
  base_("appelant", {
    "POST rpc/enregistrer_issue": { corps: { leadId: LEAD, statut: "a_appeler", rappelLe: "2026-11-10T15:00:00+00:00", tentatives: 1, activiteId: "act-1" } },
  });
  const r = await enregistrerIssue({ leadId: LEAD, issue: "messagerie", note: "  Message laissé  ", dureeS: 42, rappelLe: "2030-01-01T00:00:00Z" });
  assert.equal(r.ok, true);
  assert.deepEqual(appels().map((x) => `${x.methode} ${x.chemin}`), ["POST rpc/enregistrer_issue"]);
  assert.deepEqual(appels()[0].corps, {
    p_lead_id: LEAD,
    p_issue: "messagerie",
    p_note: "Message laissé",
    p_rappel_le: "2026-11-10T15:00:00.000Z",
    p_details: { final: false, duree_s: 42, tentativesMax: niche.tentativesMax },
  });
});

test("enregistrerIssue : une saisie invalide s'arrête avant la base (a_rappeler sans date, issue inconnue)", async (t) => {
  horlogeFixe(t);
  base_("appelant");
  assert.deepEqual(await enregistrerIssue({ leadId: LEAD, issue: "a_rappeler" }), { ok: false, error: "Choisis la date et l'heure du rappel." });
  assert.deepEqual(await enregistrerIssue({ leadId: LEAD, issue: "decroche_magique" }), { ok: false, error: "Choisis l'issue de l'appel." });
  assert.deepEqual(await enregistrerIssue("n'importe quoi"), { ok: false, error: "Saisie illisible." });
  assert.deepEqual(appels(), [], "aucune écriture");
});

test("enregistrerIssue : ne_plus_contacter, puis la vérification de l'opposition par lead_en_opposition", async (t) => {
  horlogeFixe(t);
  base_("appelant", {
    "POST rpc/enregistrer_issue": { corps: { leadId: LEAD, statut: "ne_plus_contacter", rappelLe: null, tentatives: 0, activiteId: "act-2" } },
    "GET leads": { corps: [{ siren: "000000001", telephone: "+33199000101", mobile: null, entreprise: "Atelier Démo 01", cp: "69001" }] },
    "POST rpc/lead_en_opposition": { corps: true },
  });
  const r = await enregistrerIssue({ leadId: LEAD, issue: "ne_plus_contacter" });
  assert.equal(r.ok, true);
  assert.equal(r.data.opposition, true);
  const [issue, lecture, verif] = appels();
  assert.equal(issue.corps.p_issue, "ne_plus_contacter");
  assert.deepEqual(issue.corps.p_details, { final: true, tentativesMax: niche.tentativesMax });
  assert.equal(lecture.params.get("select"), "siren,telephone,mobile,entreprise,cp");
  assert.deepEqual(param(lecture, "id"), [`eq.${LEAD}`]);
  assert.deepEqual(verif.corps, { p_telephone: "+33199000101", p_siren: "000000001", p_entreprise: "Atelier Démo 01", p_cp: "69001" });
});

test("une erreur de la base : message lisible, journal en codes seulement (jamais le détail, qui peut citer une valeur)", async (t) => {
  horlogeFixe(t);
  const journal = t.mock.method(console, "error", () => {});
  base_("appelant", {
    "POST rpc/enregistrer_issue": { status: 400, corps: { code: "23514", message: "Atelier Démo 01 +33199000101 contact01@example.com", details: null, hint: null } },
  });
  const r = await enregistrerIssue({ leadId: LEAD, issue: "pas_repondu" });
  assert.deepEqual(r, { ok: false, error: "Cette fiche est sur la liste d'opposition : elle ne peut plus être appelée." });
  const ecrit = journal.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.match(ecrit, /issue:23514/);
  assert.doesNotMatch(ecrit, /Atelier|\+33|@|ca100000/);
});

test("noterAnnonceLue : une activité « annonce » à mon nom (horodatée et rattachée à l'appel par la base)", async () => {
  base_("appelant", { "POST lead_activities": { status: 201, corps: { cree_le: "2026-11-09T09:01:00+00:00" } } });
  const r = await noterAnnonceLue({ leadId: LEAD });
  assert.deepEqual(r, { ok: true, data: { lueLe: "2026-11-09T09:01:00+00:00" } });
  const [ecriture] = appels();
  assert.deepEqual(ecriture.corps, { lead_id: LEAD, type: "annonce" }, "ni l'heure ni l'appel ne viennent du navigateur");
  assert.equal(ecriture.params.get("select"), "cree_le");
  assert.deepEqual(await noterAnnonceLue({ leadId: "pas-un-uuid" }), { ok: false, error: "La fiche : identifiant invalide." });
});

test("poserRdv : la ligne de rendez_vous (source poste), date et heure lues dans le fuseau de la config ; chevauchement lisible", async (t) => {
  horlogeFixe(t);
  base_("appelant", { "POST rendez_vous": { status: 201, corps: { id: "rdv-1", debut: "2026-11-10T13:30:00+00:00" } } });
  const r = await poserRdv({ leadId: LEAD, date: "2026-11-10", heure: "14:30", canal: "visio", closerId: "", note: "Zone : Lyon" });
  assert.deepEqual(r, { ok: true, data: { rdvId: "rdv-1", debut: "2026-11-10T13:30:00+00:00" } });
  assert.deepEqual(appels()[0].corps, {
    lead_id: LEAD,
    closer_id: null,
    debut: "2026-11-10T13:30:00.000Z",
    fin: "2026-11-10T13:50:00.000Z",
    canal: "visio",
    source: "poste",
    statut: "pris",
    note: "Zone : Lyon",
  });
  t.mock.method(console, "error", () => {});
  base_("appelant", { "POST rendez_vous": { status: 409, corps: { code: "23P01", message: "chevauche", details: null, hint: null } } });
  const chevauche = await poserRdv({ leadId: LEAD, date: "2026-11-10", heure: "14:30", canal: "visio" });
  assert.deepEqual(chevauche, { ok: false, error: "Ce créneau chevauche un autre rendez-vous du closer : choisis-en un autre." });
});

test("chargerPoste : la file de l'appelant (ses fiches et les fiches libres), les urgents, les appels du jour, la fiche ouverte", async (t) => {
  horlogeFixe(t);
  const fiche = { id: LEAD, entreprise: "Atelier Démo 01", statut: "a_appeler", tentatives: 0, created_at: "2026-10-01T00:00:00Z", qualification: {}, sources: [] };
  base_("appelant", {
    "GET leads": (r) => {
      if (r.params.get("id")) return { corps: [fiche] };
      if (r.params.get("rappel_le") === "is.null" && !r.params.get("qualification->>urgent")) {
        return { corps: [{ id: LEAD, entreprise: "Atelier Démo 01", statut: "a_appeler", tentatives: 0, tier: "A", score: 80, created_at: "2026-10-01T00:00:00Z" }] };
      }
      return { corps: [] };
    },
    "GET reglages": { corps: [{ enregistrement_complet: true, objectif_appels_jour: 60 }] },
    "GET lead_activities": (r) =>
      r.params.get("type") === "eq.appel" ? { corps: [{ lead_id: LEAD2, appelant_id: APPELANT, issue: "rdv_fixe", statut_apres: "rdv_fixe" }] } : { corps: [] },
    "GET profiles": { corps: [{ id: APPELANT, nom: "Alex Démo", role: "appelant" }] },
    "GET rpc/creneaux_occupes": { corps: [{ debut: "2026-11-10T09:00:00+00:00", fin: "2026-11-10T09:30:00+00:00" }] },
  });
  const r = await chargerPoste({});
  assert.equal(r.ok, true);
  // Les créneaux occupés du closer : par la fonction SQL (même les rendez-vous qu'un appelant ne voit pas), jamais la table elle-même.
  assert.deepEqual(r.data.occupes, [{ debut: Date.parse("2026-11-10T09:00:00Z"), fin: Date.parse("2026-11-10T09:30:00Z") }]);
  const creneaux = appels().find((x) => x.chemin === "rpc/creneaux_occupes");
  assert.deepEqual([param(creneaux, "p_debut"), param(creneaux, "p_fin")], [["2026-11-09T09:00:00.000Z"], ["2026-11-30T09:00:00.000Z"]]);
  assert.ok(
    !appels().some((x) => x.chemin === "rendez_vous" && !x.params.get("lead_id")),
    "les créneaux ne se lisent plus dans la table rendez_vous (sa RLS cache à un appelant ceux de ses collègues)",
  );
  assert.deepEqual(r.data.file.ordre, [LEAD]);
  assert.equal(r.data.fiche.fiche.id, LEAD);
  assert.deepEqual(r.data.compteurs, { appels: 1, joints: 1, rdv: 1 });
  assert.equal(r.data.objectifAppels, 60);
  assert.equal(r.data.enregistrementComplet, true);

  const leads = appels().filter((x) => x.chemin === "leads" && !x.params.get("id"));
  assert.equal(leads.length, 3, "rappels, urgents, file");
  for (const q of leads) {
    assert.deepEqual(param(q, "statut"), ["in.(a_appeler,a_rappeler)"]);
    assert.deepEqual(param(q, "or"), [`(assigned_to.eq.${APPELANT},assigned_to.is.null)`], "ses fiches et les fiches libres, jamais celles d'un collègue");
    assert.match(q.params.get("select"), /urgent:qualification->urgent/);
  }
  const [rappels, urgents, file] = leads;
  assert.deepEqual(param(rappels, "rappel_le"), ["not.is.null"]);
  assert.deepEqual(param(rappels, "order"), ["rappel_le.asc"]);
  assert.deepEqual(param(urgents, "qualification->>urgent"), ["eq.true"]);
  assert.deepEqual(param(file, "tentatives"), ["lt.4"], "le plafond de tentatives de la config");
  assert.deepEqual(param(file, "order"), ["tier.asc.nullslast,score.desc.nullslast,tentatives.asc,created_at.asc"]);
  const jour = appels().find((x) => x.chemin === "lead_activities" && x.params.get("type") === "eq.appel");
  assert.deepEqual(param(jour, "cree_le"), ["gte.2026-11-08T23:00:00.000Z"], "depuis minuit, heure de Paris");
  assert.ok(appels().every((x) => x.methode === "GET"), "le chargement n'écrit rien");

  base_("appelant");
  await chargerPoste({ mes: "1" });
  assert.deepEqual(param(appels().find((x) => x.chemin === "leads"), "or"), [`(assigned_to.eq.${APPELANT})`], "« Mes fiches »");
});

test("listerProspects : les filtres de l'adresse deviennent des filtres PostgREST, 50 par page, total exact", async (t) => {
  horlogeFixe(t);
  base_("appelant", { "GET leads": { corps: [], entetes: { "content-range": "50-49/51" } } });
  const r = await listerProspects({ q: "Démo 0%", statut: "a_rappeler", tier: "aucun", ville: "Lyon", departement: "69", email: "1", accroche: "1", mes: "1", rappels: "dus", page: "2" });
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 51);
  const q = appels().find((x) => x.chemin === "leads");
  assert.deepEqual(param(q, "entreprise"), ["ilike.%Démo 0\\%%"]);
  assert.deepEqual(param(q, "statut"), ["eq.a_rappeler"]);
  assert.deepEqual(param(q, "tier"), ["is.null"]);
  assert.deepEqual(param(q, "ville"), ["ilike.%Lyon%"]);
  assert.deepEqual(param(q, "departement"), ["eq.69"]);
  assert.deepEqual(param(q, "email"), ["not.is.null"]);
  assert.deepEqual(param(q, "accroche"), ["not.is.null", "neq."]);
  assert.deepEqual(param(q, "assigned_to"), [`eq.${APPELANT}`]);
  assert.deepEqual(param(q, "rappel_le"), ["lte.2026-11-09T09:00:00.000Z"]);
  assert.deepEqual(param(q, "order"), ["rappel_le.asc.nullslast,created_at.desc,id.asc"]);
  assert.equal(q.params.get("offset"), "50");
  assert.equal(q.params.get("limit"), "50");
  assert.match(q.entetes.get("prefer") ?? "", /count=exact/);
});

test("prendre et rendre mes leads : seules les fiches libres sont prises, seules les jamais appelées sont rendues", async () => {
  const ids = ["f1000000-0000-4000-8000-000000000001", "f2000000-0000-4000-8000-000000000002", "f3000000-0000-4000-8000-000000000003"];
  base_("appelant", {
    "GET leads": { corps: ids.map((id) => ({ id })) },
    "PATCH leads": { corps: [{ id: ids[0] }, { id: ids[2] }] },
  });
  const r = await prendreMesLeads({ nombre: 3, tiers: ["A"], departements: "69", ville: "Lyon" });
  assert.deepEqual(r, { ok: true, data: { demandees: 3, attribuees: 2 } });
  const [lecture, prise] = appels();
  assert.deepEqual(param(lecture, "assigned_to"), ["is.null"]);
  assert.deepEqual(param(lecture, "statut"), ["eq.a_appeler"]);
  assert.deepEqual(param(lecture, "or"), ["(telephone.not.is.null,mobile.not.is.null)"]);
  assert.deepEqual(param(lecture, "tier"), ["in.(A)"]);
  assert.deepEqual(param(lecture, "departement"), ["in.(69)"]);
  assert.equal(lecture.params.get("limit"), "3");
  assert.equal(prise.methode, "PATCH");
  assert.deepEqual(prise.corps, { assigned_to: APPELANT });
  assert.deepEqual(param(prise, "id"), [`in.(${ids.join(",")})`]);
  assert.deepEqual(param(prise, "assigned_to"), ["is.null"], "une fiche prise entre-temps par un collègue n'est pas reprise");

  base_("appelant", { "PATCH leads": { corps: [{ id: ids[1] }] } });
  assert.deepEqual(await rendreMesLeads(), { ok: true, data: { rendues: 1 } });
  const [rendre] = appels();
  assert.deepEqual(rendre.corps, { assigned_to: null });
  assert.deepEqual(param(rendre, "assigned_to"), [`eq.${APPELANT}`]);
  assert.deepEqual(param(rendre, "tentatives"), ["eq.0"]);
  assert.deepEqual(param(rendre, "derniere_issue"), ["is.null"]);
  assert.deepEqual(await prendreMesLeads({ nombre: 500 }), { ok: false, error: "Le nombre de fiches : de 1 à 100." });
});

test("creerProspect : la ligne avec sa source datée et ses numéros en E.164 ; doublon et opposition lisibles", async (t) => {
  horlogeFixe(t);
  base_("appelant", { "POST leads": { status: 201, corps: { id: LEAD } } });
  const saisie = { entreprise: "Atelier Démo 41", telephone: "01 99 00 01 41", attribuer: true, source: { type: "annuaire" } };
  assert.deepEqual(await creerProspect(saisie), { ok: true, data: { id: LEAD } });
  const ligne = appels()[0].corps;
  assert.equal(ligne.telephone, "+33199000141");
  assert.equal(ligne.assigned_to, APPELANT);
  assert.deepEqual(ligne.sources, [{ type: "annuaire", le: "2026-11-09", origine: "manuel" }]);
  t.mock.method(console, "error", () => {});
  for (const [code, message] of [
    ["23505", /existe déjà/],
    ["23514", /liste d'opposition/],
  ]) {
    base_("appelant", { "POST leads": { status: 409, corps: { code, message: "détail", details: null, hint: null } } });
    const r = await creerProspect(saisie);
    assert.equal(r.ok, false);
    assert.match(r.error, message);
  }
  base_("appelant");
  assert.match((await creerProspect({ entreprise: "Atelier Démo 42", telephone: "01 99 00 01 42" })).error, /source/);
  assert.deepEqual(appels(), []);
});

test("modifierContact : relit la fiche, écrit les coordonnées et la trace datée de la saisie manuelle", async (t) => {
  horlogeFixe(t);
  base_("appelant", {
    "GET leads": { corps: [{ dirigeant: null, telephone: "+33199000101", mobile: null, email: null, sources: [{ type: "demo", le: "2026-11-01" }] }] },
    "PATCH leads": { corps: [{ id: LEAD }] },
  });
  assert.deepEqual(await modifierContact({ leadId: LEAD, champs: { telephone: "01 99 00 01 09" } }), { ok: true, data: null });
  const ecriture = appels().find((x) => x.methode === "PATCH");
  assert.deepEqual(ecriture.corps, {
    telephone: "+33199000109",
    sources: [
      { type: "demo", le: "2026-11-01" },
      { type: "saisie_manuelle", donnee: "telephone", le: "2026-11-09", origine: "manuel" },
    ],
  });
});

test("réservation au clic sur Appeler (appelant seulement) et attribution (gestionnaires seulement)", async () => {
  base_("appelant", { "PATCH leads": { corps: [] }, "GET leads": { corps: [] } });
  assert.deepEqual(await reserverFiche({ leadId: LEAD }), { ok: true, data: { reservee: false, dejaPrise: true } });
  const [prise] = appels();
  assert.deepEqual(prise.corps, { assigned_to: APPELANT });
  assert.deepEqual(param(prise, "assigned_to"), ["is.null"]);

  base_("membre");
  assert.deepEqual(await reserverFiche({ leadId: LEAD }), { ok: true, data: { reservee: false, dejaPrise: false } });
  assert.deepEqual(appels(), [], "un gestionnaire ne réserve rien");

  base_("appelant");
  assert.deepEqual(await attribuerFiche({ leadId: LEAD, membreId: null }), { ok: false, error: "Tu n'as pas l'autorisation de faire cette action." });
  assert.deepEqual(appels(), [], "refusé avant toute écriture");
});
