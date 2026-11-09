// Les issues du Poste (lib/poste/issues.ts, lib/poste/saisie-issue.ts) : lues de la config, gabarit de note, final, exigeRappel,
// rappelAuto, validation côté serveur (entrées invalides refusées), arguments exacts de enregistrer_issue, opposition vérifiée après
// « ne_plus_contacter », et un journal qui ne porte que des codes. La base est simulée (aucun réseau).
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { ErreurSaisie } from "../lib/server/validation.ts";
import { effetIssue, estJointe, issueParTouche, issuesDuPoste, nettoyerNote, noteDepuisGabarit } from "../lib/poste/issues.ts";
import {
  AVERTISSEMENT_SANS_IDENTIFIANT,
  argumentsEnregistrerIssue,
  executerIssue,
  lireIssueEnregistree,
  validerSaisieIssue,
} from "../lib/poste/saisie-issue.ts";
import { exemple, lire } from "./aides.mjs";

const niche = chargerNiche(exemple());
const ISSUES = issuesDuPoste(niche.issues);
const LEAD = "ca100000-0000-4000-8000-000000000001";
const LUNDI_10H = Date.parse("2026-11-09T09:00:00Z");
const CONTEXTE = { issues: ISSUES, objections: niche.objections.map((o) => o.code), lieu: { fuseau: "Europe/Paris", pays: "FR" }, maintenant: LUNDI_10H };
const issue = (code) => ISSUES.find((i) => i.code === code);

test("les issues viennent de la config : touche, final, rappel, gabarit", () => {
  assert.deepEqual(ISSUES.map((i) => i.code), niche.issues.map((i) => i.code));
  assert.equal(issue("messagerie").rappelAuto, "creneau_alterne");
  assert.equal(issue("a_rappeler").exigeRappel, true);
  assert.equal(issue("rdv_fixe").final, true);
  assert.equal(issue("pas_repondu").final, false);
  assert.equal(issue("sous_contrat").final, true, "une issue ajoutée par la niche");
  assert.deepEqual(issue("standard").gabaritNote, ["Interlocuteur", "Meilleur moment"]);
  assert.equal(issueParTouche(ISSUES, "2").code, "messagerie");
  assert.equal(issueParTouche(ISSUES, "z"), null);
});

test("joints : tout sauf pas de réponse, messagerie et standard", () => {
  assert.ok(!estJointe("pas_repondu") && !estJointe("messagerie") && !estJointe("standard"));
  assert.ok(estJointe("rdv_fixe") && estJointe("pas_interesse") && estJointe("sous_contrat"));
  assert.ok(!estJointe(null) && !estJointe(""));
});

test("gabarit de note : pré-rempli, lignes vides retirées à l'enregistrement", () => {
  const g = ["Interlocuteur", "Meilleur moment"];
  assert.equal(noteDepuisGabarit(g), "Interlocuteur : \nMeilleur moment : ");
  assert.equal(nettoyerNote("Interlocuteur : \nMeilleur moment : ", g), null, "gabarit laissé vide : pas de note");
  assert.equal(nettoyerNote("Interlocuteur : l'assistante\nMeilleur moment :  \nRappeler avant midi", g), "Interlocuteur : l'assistante\nRappeler avant midi");
  assert.equal(nettoyerNote("Note : libre", g), "Note : libre", "une ligne hors gabarit reste");
  assert.equal(nettoyerNote("  ", []), null);
  assert.equal(nettoyerNote("a — b", []), "a , b", "pas de tiret cadratin");
});

test("l'effet de l'issue est dit avant d'enregistrer", () => {
  assert.match(effetIssue(issue("ne_plus_contacter"), { derniereTentative: false }), /liste d'opposition/);
  assert.match(effetIssue(issue("messagerie"), { derniereTentative: true }), /injoignable/);
  assert.match(effetIssue(issue("rdv_fixe"), { derniereTentative: false }), /sort de la file/);
  assert.match(effetIssue(issue("a_rappeler"), { derniereTentative: false }), /date du rappel/);
  assert.match(effetIssue(issue("messagerie"), { derniereTentative: false }), /rappel automatique/);
  // Une fiche « rdv_fixe » : la base la garde hors de la file pour une issue non finale tant que son rendez-vous est à venir.
  for (const code of ["pas_repondu", "messagerie", "standard", "a_rappeler"]) {
    assert.match(effetIssue(issue(code), { derniereTentative: true, rdvFixe: true }), /ne la remet pas dans la file/, code);
  }
  assert.match(effetIssue(issue("pas_interesse"), { derniereTentative: false, rdvFixe: true }), /changera son statut.*sort de la file/);
  assert.match(effetIssue(issue("rdv_fixe"), { derniereTentative: false, rdvFixe: true }), /^La fiche sort de la file/);
});

test("validation : rappelAuto pose le créneau alterné, calculé par le serveur", () => {
  const s = validerSaisieIssue({ leadId: LEAD, issue: "messagerie", rappelLe: "2030-01-01T00:00:00Z" }, CONTEXTE);
  assert.equal(s.rappelLe, "2026-11-10T15:00:00.000Z", "la date envoyée par le navigateur est ignorée");
  assert.equal(s.issue.code, "messagerie");
});

test("validation : a_rappeler sans date est refusé ; une date passée aussi", () => {
  assert.throws(() => validerSaisieIssue({ leadId: LEAD, issue: "a_rappeler" }, CONTEXTE), /date et l'heure du rappel/);
  assert.throws(
    () => validerSaisieIssue({ leadId: LEAD, issue: "a_rappeler", rappelLe: "2026-11-09T07:00:00Z" }, CONTEXTE),
    /passée/,
  );
  assert.throws(() => validerSaisieIssue({ leadId: LEAD, issue: "a_rappeler", rappelLe: "2028-01-01T07:00:00Z" }, CONTEXTE), /trop loin/);
  const s = validerSaisieIssue({ leadId: LEAD, issue: "a_rappeler", rappelLe: "2026-11-12T08:30:00Z", note: "Pourquoi : chantier\nAvec qui : " }, CONTEXTE);
  assert.equal(s.rappelLe, "2026-11-12T08:30:00.000Z");
  assert.equal(s.note, "Pourquoi : chantier");
});

test("validation : une issue finale n'envoie jamais de rappel, et « final » vient de la config", () => {
  const s = validerSaisieIssue({ leadId: LEAD, issue: "rdv_fixe", rappelLe: "2026-11-12T08:30:00Z", final: false }, CONTEXTE);
  assert.equal(s.rappelLe, null);
  assert.deepEqual(argumentsEnregistrerIssue(s).p_details, { final: true });
  const t = validerSaisieIssue({ leadId: LEAD, issue: "sous_contrat" }, CONTEXTE);
  assert.deepEqual(argumentsEnregistrerIssue(t).p_details, { final: true });
});

test("validation : entrées invalides refusées avec un message lisible", () => {
  const refus = (brut, motif) => assert.throws(() => validerSaisieIssue(brut, CONTEXTE), (e) => e instanceof ErreurSaisie && motif.test(e.message));
  refus(null, /illisible/);
  refus([], /illisible/);
  refus({ issue: "messagerie" }, /fiche est obligatoire/);
  refus({ leadId: "pas-un-uuid", issue: "messagerie" }, /identifiant invalide/);
  refus({ leadId: LEAD }, /Choisis l'issue/);
  refus({ leadId: LEAD, issue: "decroche_magique" }, /Choisis l'issue/);
  refus({ leadId: LEAD, issue: 42 }, /valeur invalide/);
  refus({ leadId: LEAD, issue: "pas_repondu", dureeS: -1 }, /durée/);
  refus({ leadId: LEAD, issue: "pas_repondu", dureeS: 90_000 }, /durée/);
  refus({ leadId: LEAD, issue: "pas_repondu", dureeS: "longue" }, /durée/);
  refus({ leadId: LEAD, issue: "pas_interesse", objection: "pas-une-objection" }, /objection/);
  refus({ leadId: LEAD, issue: "pas_repondu", note: "x".repeat(5001) }, /5000 caractères/);
  refus({ leadId: LEAD, issue: "a_rappeler", rappelLe: "demain" }, /date ou heure invalide/);
});

test("arguments exacts de enregistrer_issue(p_lead_id, p_issue, p_note, p_rappel_le, p_details)", () => {
  const s = validerSaisieIssue({ leadId: LEAD.toUpperCase(), issue: "pas_interesse", note: "Raison : prix", dureeS: 95.4, objection: "combien-ca-coute" }, CONTEXTE);
  assert.deepEqual(argumentsEnregistrerIssue(s), {
    p_lead_id: LEAD,
    p_issue: "pas_interesse",
    p_note: "Raison : prix",
    p_rappel_le: null,
    p_details: { final: true, duree_s: 95, objection: "combien-ca-coute" },
  });
  // La signature SQL est bien celle-là (migration 0001).
  assert.match(lire("supabase/migrations/0001_schema.sql"), /function public\.enregistrer_issue\(\s*p_lead_id uuid,\s*p_issue text,\s*p_note text default null,\s*p_rappel_le timestamptz default null,\s*p_details jsonb/);
});

function baseSimulee(reponses) {
  const appels = [];
  return {
    appels,
    rpc: async (fonction, args) => {
      appels.push({ fonction, args });
      const r = reponses[fonction];
      return typeof r === "function" ? r(args) : r;
    },
  };
}

test("executerIssue : appelle enregistrer_issue et lit sa réponse", async () => {
  const base = baseSimulee({
    enregistrer_issue: { data: { leadId: LEAD, statut: "a_appeler", rappelLe: "2026-11-10T15:00:00+00:00", tentatives: 1, activiteId: "act-1" }, error: null },
  });
  const s = validerSaisieIssue({ leadId: LEAD, issue: "messagerie" }, CONTEXTE);
  const r = await executerIssue(s, { rpc: base.rpc, identifiants: async () => null, journal: () => {} });
  assert.deepEqual(r, {
    ok: true,
    data: { leadId: LEAD, statut: "a_appeler", rappelLe: "2026-11-10T15:00:00+00:00", tentatives: 1, activiteId: "act-1", opposition: null, avertissement: null },
  });
  assert.deepEqual(base.appels.map((a) => a.fonction), ["enregistrer_issue"]);
});

test("executerIssue : une erreur de la base devient un message lisible ; le journal ne garde que le code", async () => {
  const journal = [];
  const base = baseSimulee({
    enregistrer_issue: { data: null, error: { code: "23514", message: "Fiche Atelier Démo 01 au +33199000101 sur la liste", details: "x@example.com" } },
  });
  const s = validerSaisieIssue({ leadId: LEAD, issue: "pas_repondu" }, CONTEXTE);
  const r = await executerIssue(s, { rpc: base.rpc, identifiants: async () => null, journal: (c) => journal.push(c) });
  assert.deepEqual(r, { ok: false, error: "Cette fiche est sur la liste d'opposition : elle ne peut plus être appelée." });
  assert.deepEqual(journal, ["issue:23514"]);
  for (const ligne of journal) assert.doesNotMatch(ligne, /Atelier|\+33|@|ca100000/);
  const illisible = await executerIssue(s, { rpc: async () => ({ data: { inattendu: true }, error: null }), identifiants: async () => null, journal: (c) => journal.push(c) });
  assert.equal(illisible.ok, false);
  assert.equal(journal.at(-1), "issue:reponse_illisible");
  const codeBizarre = await executerIssue(s, { rpc: async () => ({ data: null, error: { code: "<script>Atelier" } }), identifiants: async () => null, journal: (c) => journal.push(c) });
  assert.equal(codeBizarre.ok, false);
  assert.equal(journal.at(-1), "issue:sans-code", "un code inattendu n'est jamais recopié");
});

test("ne_plus_contacter : la base alimente l'opposition, l'action le vérifie", async () => {
  const s = validerSaisieIssue({ leadId: LEAD, issue: "ne_plus_contacter" }, CONTEXTE);
  const ok = baseSimulee({
    enregistrer_issue: { data: { leadId: LEAD, statut: "ne_plus_contacter", rappelLe: null, tentatives: 0, activiteId: "act-2" }, error: null },
    lead_en_opposition: (args) => ({ data: args.p_telephone === "+33199000101" && args.p_siren === "000000001", error: null }),
  });
  const r = await executerIssue(s, { rpc: ok.rpc, identifiants: async () => ({ siren: "000000001", telephone: "+33199000101", mobile: null }), journal: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.data.opposition, true);
  assert.equal(r.data.avertissement, null);
  assert.deepEqual(ok.appels.map((a) => a.fonction), ["enregistrer_issue", "lead_en_opposition"]);
  assert.deepEqual(ok.appels[0].args.p_issue, "ne_plus_contacter");

  // Une fiche sans aucun identifiant lisible (ni SIREN, ni numéro, ni nom) : rien à vérifier, on le dit.
  const journal = [];
  const sans = baseSimulee({ enregistrer_issue: { data: { leadId: LEAD, statut: "ne_plus_contacter", tentatives: 0, activiteId: "a" }, error: null } });
  const r2 = await executerIssue(s, { rpc: sans.rpc, identifiants: async () => ({ siren: null, telephone: null, mobile: null }), journal: (c) => journal.push(c) });
  assert.equal(r2.data.opposition, false);
  assert.equal(r2.data.avertissement, AVERTISSEMENT_SANS_IDENTIFIANT);
  assert.deepEqual(journal, ["issue:opposition_sans_identifiant"]);

  // Une fiche sans SIREN ni numéro lisible : la base a inscrit son nom et son code postal ; la vérification les passe, aucun avertissement.
  const parCle = baseSimulee({
    enregistrer_issue: { data: { leadId: LEAD, statut: "ne_plus_contacter", tentatives: 0, activiteId: "a" }, error: null },
    lead_en_opposition: (args) => ({ data: args.p_entreprise === "Atelier Démo 05" && args.p_cp === "69001", error: null }),
  });
  const r4 = await executerIssue(s, {
    rpc: parCle.rpc,
    identifiants: async () => ({ siren: null, telephone: "01 99 00 05", mobile: null, entreprise: "Atelier Démo 05", cp: "69001" }),
    journal: () => {},
  });
  assert.deepEqual(parCle.appels[1].args, { p_telephone: "01 99 00 05", p_siren: null, p_entreprise: "Atelier Démo 05", p_cp: "69001" });
  assert.equal(r4.data.opposition, true);
  assert.equal(r4.data.avertissement, null);

  // Le mobile sert quand il n'y a pas de téléphone ; une opposition absente est signalée.
  const absente = baseSimulee({
    enregistrer_issue: { data: { leadId: LEAD, statut: "ne_plus_contacter", tentatives: 0, activiteId: "a" }, error: null },
    lead_en_opposition: { data: false, error: null },
  });
  const r3 = await executerIssue(s, { rpc: absente.rpc, identifiants: async () => ({ siren: null, telephone: null, mobile: "+33639980001" }), journal: () => {} });
  assert.equal(absente.appels[1].args.p_telephone, "+33639980001");
  assert.equal(r3.data.opposition, false);
  assert.equal(r3.data.avertissement, AVERTISSEMENT_SANS_IDENTIFIANT);
});

test("la réponse de enregistrer_issue est lue prudemment", () => {
  assert.equal(lireIssueEnregistree(null), null);
  assert.equal(lireIssueEnregistree([]), null);
  assert.equal(lireIssueEnregistree({ leadId: LEAD }), null);
  assert.deepEqual(lireIssueEnregistree({ leadId: LEAD, statut: "clos", activiteId: "a", tentatives: "3" }), {
    leadId: LEAD,
    statut: "clos",
    rappelLe: null,
    tentatives: 0,
    activiteId: "a",
  });
});
