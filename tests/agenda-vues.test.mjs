// L'écran Agenda, sa logique pure (lib/agenda/fuseau.ts, vues.ts, saisie.ts) : fuseau de l'équipe, jours de 23 et 25 heures,
// regroupement par jour autour d'un changement d'heure, état de la vue, lecture des lignes, effet sur la fiche, recherche, saisies.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleJour,
  debutJourMs,
  decalerJour,
  estCleJour,
  heureLocale,
  heuresDuJour,
  instantLocal,
  jourSemaine,
  libelleJour,
  libelleSemaine,
  lundiDe,
} from "../lib/agenda/fuseau.ts";
import { validerChangementStatut, validerRattachement, validerRdvManuel } from "../lib/agenda/saisie.ts";
import {
  classerRecherche,
  creneauRdv,
  echapperMotif,
  effetSurFiche,
  filtrerRdv,
  hrefVue,
  lireEtatVue,
  plageVue,
  rdvDepuisLigne,
  rdvDepuisLignes,
  regrouperParJour,
  titreRdv,
} from "../lib/agenda/vues.ts";

const PARIS = "Europe/Paris";

function rdv(id, debut, fin, extra = {}) {
  return {
    id, leadId: null, closerId: null, prisPar: null, debut, fin, canal: "visio", statut: "pris", source: "poste", lienVisio: null, note: null,
    aVerifier: false, inviteNom: null, inviteEmail: null, inviteTelephone: null, entreprise: null, dirigeant: null, ...extra,
  };
}

test("fuseau : jours de 23 et 25 heures (Paris, mars et octobre 2026), minuit local en UTC", () => {
  assert.equal(heuresDuJour("2026-03-29", PARIS), 23);
  assert.equal(heuresDuJour("2026-10-25", PARIS), 25);
  assert.equal(heuresDuJour("2026-11-09", PARIS), 24);
  assert.equal(new Date(debutJourMs("2026-10-25", PARIS)).toISOString(), "2026-10-24T22:00:00.000Z", "minuit en heure d'été");
  assert.equal(new Date(debutJourMs("2026-10-26", PARIS)).toISOString(), "2026-10-25T23:00:00.000Z", "minuit en heure d'hiver");
  assert.equal(heuresDuJour("2026-11-01", "America/Toronto"), 25);
  assert.equal(cleJour(Date.parse("2026-10-25T22:30:00Z"), PARIS), "2026-10-25", "23 h 30 en heure d'hiver : encore le 25");
  assert.equal(cleJour(Date.parse("2026-10-25T23:30:00Z"), PARIS), "2026-10-26");
  assert.equal(heureLocale("2026-10-25T00:30:00Z", PARIS), "02:30");
  assert.equal(heureLocale("2026-10-25T01:30:00Z", PARIS), "02:30", "02:30 existe deux fois ce jour-là");
});

test("fuseau : saisie d'une heure locale (heure qui n'existe pas au passage à l'heure d'été)", () => {
  assert.deepEqual(instantLocal("2026-11-10", "10:00", PARIS), { iso: "2026-11-10T09:00:00.000Z", decale: false });
  assert.deepEqual(instantLocal("2026-07-10", "10:00", PARIS), { iso: "2026-07-10T08:00:00.000Z", decale: false });
  assert.equal(instantLocal("2026-03-29", "02:30", PARIS).decale, true);
  assert.equal(instantLocal("2026-03-29", "03:30", PARIS).decale, false);
  for (const [j, h] of [["2026-02-30", "10:00"], ["2026-11-10", "24:00"], ["2026-11-10", "9:00"], ["10/11/2026", "10:00"]]) assert.equal(instantLocal(j, h, PARIS), null, `${j} ${h}`);
});

test("fuseau : calendrier pur (clés, semaine du lundi, libellés)", () => {
  assert.ok(estCleJour("2028-02-29"));
  assert.ok(!estCleJour("2026-02-29"));
  assert.equal(decalerJour("2026-12-31", 1), "2027-01-01");
  assert.equal(decalerJour("2026-03-01", -1), "2026-02-28");
  assert.equal(jourSemaine("2026-11-09"), 1);
  assert.equal(jourSemaine("2026-11-15"), 7);
  assert.equal(lundiDe("2026-11-15"), "2026-11-09");
  assert.equal(lundiDe("2026-11-09"), "2026-11-09");
  assert.equal(libelleJour("2026-11-09"), "lundi 9 novembre");
  assert.equal(libelleSemaine("2026-11-09"), "du 9 au 15 novembre 2026");
  assert.equal(libelleSemaine("2026-11-30"), "du 30 novembre au 6 décembre 2026");
});

test("regroupement par jour autour d'un changement d'heure (semaine du 19 au 25 octobre 2026, Paris)", () => {
  const etat = { vue: "semaine", jour: "2026-10-22" };
  const plage = plageVue(etat, PARIS);
  assert.equal(plage.debutIso, "2026-10-18T22:00:00.000Z");
  assert.equal(plage.finIso, "2026-10-25T23:00:00.000Z", "la semaine dure 169 heures");
  assert.deepEqual(plage.jours, ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.equal(plage.precedent, "2026-10-12");
  assert.equal(plage.suivant, "2026-10-26");
  const rdvs = [
    rdv("b", "2026-10-25T22:30:00.000Z", "2026-10-25T22:50:00.000Z"), // dimanche 23:30 (heure d'hiver)
    rdv("a", "2026-10-25T00:30:00.000Z", "2026-10-25T00:50:00.000Z"), // dimanche 02:30 (heure d'été)
    rdv("c", "2026-10-18T22:30:00.000Z", "2026-10-18T22:50:00.000Z"), // lundi 00:30
    rdv("d", "2026-10-18T21:30:00.000Z", "2026-10-18T21:50:00.000Z"), // dimanche 18 à 23:30 : hors de la semaine
  ];
  const jours = regrouperParJour(rdvs, plage.jours, PARIS, "2026-10-21");
  assert.deepEqual(jours.map((j) => j.rdvs.map((r) => r.id)), [["c"], [], [], [], [], [], ["a", "b"]]);
  assert.equal(jours[2].aujourdhui, true);
  assert.equal(jours[6].libelle, "dimanche 25 octobre");
  assert.equal(creneauRdv(rdvs[0], PARIS), "23:30 – 23:50");
  assert.equal(creneauRdv(rdv("x", "2026-11-10T22:30:00Z", "2026-11-10T23:30:00Z"), PARIS), "23:30 – 11 novembre 2026 00:30");
});

test("vue jour : de minuit à minuit dans le fuseau ; navigation", () => {
  const plage = plageVue({ vue: "jour", jour: "2026-03-29" }, PARIS);
  assert.equal(plage.debutIso, "2026-03-28T23:00:00.000Z");
  assert.equal(plage.finIso, "2026-03-29T22:00:00.000Z", "23 heures ce jour-là");
  assert.equal(plage.precedent, "2026-03-28");
  assert.equal(plage.suivant, "2026-03-30");
});

test("état de la vue lu dans l'adresse, et l'adresse d'une vue", () => {
  const closer = "a1000000-0000-4000-8000-000000000001";
  assert.deepEqual(lireEtatVue({}, "2026-11-09"), { vue: "semaine", jour: "2026-11-09", closer: null, statut: null });
  assert.deepEqual(lireEtatVue({ vue: "jour", jour: "2026-11-12", closer, statut: "no_show" }, "2026-11-09"), { vue: "jour", jour: "2026-11-12", closer, statut: "no_show" });
  assert.deepEqual(lireEtatVue({ vue: "mois", jour: "2026-02-30", closer: "'; drop", statut: "bizarre" }, "2026-11-09"), { vue: "semaine", jour: "2026-11-09", closer: null, statut: null });
  assert.equal(lireEtatVue({ closer: "moi", statut: "actifs", jour: ["2026-11-10", "x"] }, "2026-11-09").jour, "2026-11-10");
  const etat = lireEtatVue({ closer: "moi" }, "2026-11-09");
  assert.equal(hrefVue(etat), "/agenda?jour=2026-11-09&closer=moi");
  assert.equal(hrefVue(etat, { vue: "jour", jour: "2026-11-10", statut: "actifs" }), "/agenda?vue=jour&jour=2026-11-10&closer=moi&statut=actifs");
});

test("lecture des lignes de rendez_vous (fiche jointe ou invisible), titres, filtres", () => {
  const ligne = {
    id: "d0000000-0000-4000-8000-000000000001", lead_id: "ca100000-0000-4000-8000-000000000001", closer_id: "a1000000-0000-4000-8000-000000000001",
    pris_par: null, debut: "2026-11-10T09:00:00+00:00", fin: "2026-11-10T09:20:00+00:00", canal: "telephone", statut: "confirme", source: "calendly",
    lien_visio: null, note: null, a_verifier: false, invite_nom: "Camille Démo", invite_email: "contact.demo01@example.com", invite_telephone: null,
    lead: { entreprise: "Atelier Démo 01", dirigeant: "Camille Démo" },
  };
  const r = rdvDepuisLigne(ligne);
  assert.equal(r.debut, "2026-11-10T09:00:00.000Z");
  assert.equal(r.canal, "telephone");
  assert.equal(r.source, "calendly");
  assert.equal(titreRdv(r), "Atelier Démo 01");
  assert.equal(titreRdv(rdvDepuisLigne({ ...ligne, lead: null })), "Camille Démo", "fiche invisible : le nom de l'invité");
  assert.equal(titreRdv(rdvDepuisLigne({ ...ligne, lead: null, invite_nom: null })), "Fiche non visible");
  assert.equal(titreRdv(rdvDepuisLigne({ ...ligne, lead: null, invite_nom: null, lead_id: null })), "Rendez-vous sans fiche");
  assert.equal(rdvDepuisLigne({ ...ligne, statut: "bizarre", canal: 3 }).statut, "pris");
  assert.equal(rdvDepuisLigne({ ...ligne, id: "x" }), null);
  assert.equal(rdvDepuisLigne({ ...ligne, debut: "pas une date" }), null);
  assert.deepEqual(rdvDepuisLignes([ligne, null, { ...ligne, id: "d0000000-0000-4000-8000-000000000000", debut: "2026-11-09T09:00:00Z" }]).map((x) => x.id.slice(-1)), ["0", "1"]);
  assert.deepEqual(rdvDepuisLignes("rien"), []);

  const moi = "a1000000-0000-4000-8000-000000000001";
  const liste = [rdv("1", "2026-11-10T09:00:00Z", "2026-11-10T09:20:00Z", { closerId: moi }), rdv("2", "2026-11-10T10:00:00Z", "2026-11-10T10:20:00Z", { statut: "annule" })];
  assert.deepEqual(filtrerRdv(liste, { closer: "moi", statut: null }, moi).map((x) => x.id), ["1"]);
  assert.deepEqual(filtrerRdv(liste, { closer: null, statut: "actifs" }, moi).map((x) => x.id), ["1"]);
  assert.deepEqual(filtrerRdv(liste, { closer: null, statut: "annule" }, moi).map((x) => x.id), ["2"]);
  assert.deepEqual(filtrerRdv(liste, { closer: null, statut: null }, moi).length, 2);
});

test("effet d'un rendez-vous sur sa fiche (les règles de evenement_agenda)", () => {
  const maintenant = Date.parse("2026-11-09T08:00:00Z");
  const avenir = "2026-11-10T09:20:00Z";
  const passe = "2026-11-08T09:20:00Z";
  const e = (statutRdv, statutFiche, autreRdvActif = false, finRdv = avenir) => effetSurFiche({ statutRdv, finRdv, statutFiche, autreRdvActif, maintenant });
  assert.deepEqual(e("pris", "a_appeler"), { statut: "rdv_fixe", rappelMaintenant: false });
  assert.equal(e("confirme", "rdv_fixe"), null, "déjà rdv_fixe");
  assert.equal(e("pris", "a_appeler", false, passe), null, "un rendez-vous passé ne refait pas « rdv_fixe »");
  assert.deepEqual(e("annule", "rdv_fixe"), { statut: "a_rappeler", rappelMaintenant: true });
  assert.equal(e("annule", "rdv_fixe", true), null, "un autre rendez-vous actif : la fiche reste « rdv_fixe »");
  assert.equal(e("annule", "pas_interesse"), null);
  assert.deepEqual(e("reporte", "rdv_fixe"), { statut: "a_rappeler", rappelMaintenant: true });
  assert.deepEqual(e("no_show", "rdv_fixe"), { statut: "a_rappeler", rappelMaintenant: true });
  assert.equal(e("no_show", "a_rappeler"), null);
  assert.equal(e("tenu", "rdv_fixe"), null);
  for (const s of ["pris", "annule", "no_show"]) assert.equal(e(s, "ne_plus_contacter"), null, "la liste d'opposition ne bouge jamais");
  assert.equal(e("pris", null), null, "fiche invisible : rien");
});

test("recherche d'une fiche : e-mail, numéro (9 derniers chiffres) ou entreprise ; motif échappé", () => {
  assert.deepEqual(classerRecherche(" Contact.Demo01@Example.com "), { type: "email", motif: "contact.demo01@example.com" });
  assert.deepEqual(classerRecherche("01 99 00 01 01"), { type: "telephone", tel9: "199000101" });
  assert.deepEqual(classerRecherche("+33 6 39 98 00 01"), { type: "telephone", tel9: "639980001" });
  assert.deepEqual(classerRecherche("Atelier Démo"), { type: "entreprise", motif: "%Atelier Démo%" });
  assert.deepEqual(classerRecherche("100%_réel\\"), { type: "entreprise", motif: "%100\\%\\_réel\\\\%" });
  assert.deepEqual(classerRecherche("Atelier 0199000101"), { type: "entreprise", motif: "%Atelier 0199000101%" }, "du texte et des chiffres : une entreprise");
  for (const v of ["", "a", "x".repeat(121), null, 42]) assert.equal(classerRecherche(v), null, String(v));
  assert.equal(echapperMotif("a%b_c\\d"), "a\\%b\\_c\\\\d");
});

test("saisie d'un rendez-vous manuel : jour et heure dans le fuseau, durée proposée, lien https, uuid", () => {
  const maintenant = Date.parse("2026-11-09T08:00:00Z");
  const base = { jour: "2026-11-10", heure: "10:00", dureeMin: 30, canal: "visio", lienVisio: "https://visio.example.org/salle", closerId: "", leadId: "CA100000-0000-4000-8000-000000000001", note: " À préparer " };
  assert.deepEqual(validerRdvManuel(base, { fuseau: PARIS, maintenant }), {
    debut: "2026-11-10T09:00:00.000Z", fin: "2026-11-10T09:30:00.000Z", canal: "visio", lienVisio: "https://visio.example.org/salle",
    closerId: null, leadId: "ca100000-0000-4000-8000-000000000001", note: "À préparer",
  });
  assert.equal(validerRdvManuel({ ...base, canal: "telephone" }, { fuseau: PARIS, maintenant }).lienVisio, null, "pas de lien de visio au téléphone");
  assert.equal(validerRdvManuel({ ...base, dureeMin: "45" }, { fuseau: PARIS, maintenant }).fin, "2026-11-10T09:45:00.000Z");
  const refus = [
    [{ ...base, jour: "" }, /obligatoires/],
    [{ ...base, heure: "25:00" }, /illisible/],
    [{ ...base, jour: "2026-03-29", heure: "02:30" }, /changement d'heure/],
    [{ ...base, dureeMin: 31 }, /durée/],
    [{ ...base, canal: "pigeon" }, /canal/i],
    [{ ...base, lienVisio: "http://visio.example.org" }, /https/],
    [{ ...base, leadId: "pas-un-uuid" }, /fiche/i],
    [{ ...base, jour: "2026-09-01" }, /30 jours/],
    [{ ...base, note: "x".repeat(2001) }, /note/i],
  ];
  for (const [entree, motif] of refus) assert.throws(() => validerRdvManuel(entree, { fuseau: PARIS, maintenant }), motif);
  assert.deepEqual(validerChangementStatut("d0000000-0000-4000-8000-000000000001", "no_show"), { rdvId: "d0000000-0000-4000-8000-000000000001", statut: "no_show" });
  assert.throws(() => validerChangementStatut("d0000000-0000-4000-8000-000000000001", "supprime"), /Le statut/);
  assert.throws(() => validerChangementStatut("x", "pris"), /rendez-vous/);
  assert.throws(() => validerRattachement("d0000000-0000-4000-8000-000000000001", null), /fiche/);
});
