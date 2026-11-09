// Le reste de la logique du Poste : compteurs et objectif du jour, accroche, clavier, chronomètre, chronologie, rendez-vous, « mes leads »,
// adresse du Poste, vue de la fiche et de la file, ce que le navigateur reçoit de la config.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { accrocheDeFiche, lienSourceSur } from "../lib/poste/accroche.ts";
import {
  appliquerSignal,
  dureeAppel,
  dureeSecondes,
  formatChrono,
  lireDureeSaisie,
  lireEtatTelephone,
  lireSignalTelephone,
  messageAppel,
  nouvelAppel,
  signalPourFiche,
} from "../lib/poste/appel.ts";
import { chronologie, dureeLisible } from "../lib/poste/chronologie.ts";
import { estAnnuler, estChampTexte, estEnregistrer, issueDeLaTouche } from "../lib/poste/clavier.ts";
import { configAgendaDe, configPosteClient, contexteIssueDe, lieuDe } from "../lib/poste/config-poste.ts";
import { lireActivite, lireFiche, lireFicheFile, lireLigneListe, lireListe, lireMembre, lireRdv } from "../lib/poste/fiche.ts";
import { construireFile } from "../lib/poste/file.ts";
import { issuesDuPoste } from "../lib/poste/issues.ts";
import { enLots, lireDepartements, validerPrise } from "../lib/poste/mes-leads.ts";
import { compteursDuJour, fichesAppeleesAujourdhui, jauge, resteAFaire } from "../lib/poste/objectif.ts";
import { champsDecouverte, reponsesDecouverte } from "../lib/poste/decouverte.ts";
import { rdvRecusAutomatiquement } from "../lib/agenda/registre.ts";
import { lienReservationSur, ligneRendezVous, validerSaisieRdv } from "../lib/poste/rdv.ts";
import { qualificationAvecUrgence, validerAttribution, validerModification, validerNote, validerUrgent } from "../lib/poste/saisie-fiche.ts";
import { adressePoste, lireDemandePoste } from "../lib/poste/saisie-poste.ts";
import { contexteScriptDe, ficheVue, fileVue, raisonHorsFile } from "../lib/poste/vue.ts";
import { exemple } from "./aides.mjs";

const niche = chargerNiche(exemple());
const LEAD = "ca100000-0000-4000-8000-000000000001";
const MOI = "a3000000-0000-4000-8000-000000000003";
const PARIS = "Europe/Paris";
const LUNDI_10H = Date.parse("2026-11-09T09:00:00Z");

test("compteurs du jour : mes appels, mes joints, mes RDV (une fois par fiche)", () => {
  const appels = [
    { leadId: "l1", appelantId: MOI, issue: "pas_repondu", statutApres: "a_appeler" },
    { leadId: "l2", appelantId: MOI, issue: "messagerie", statutApres: "a_appeler" },
    { leadId: "l3", appelantId: MOI, issue: "rdv_fixe", statutApres: "rdv_fixe" },
    { leadId: "l3", appelantId: MOI, issue: "rdv_fixe", statutApres: "rdv_fixe" },
    { leadId: "l4", appelantId: MOI, issue: "pas_interesse", statutApres: "pas_interesse" },
    { leadId: "l5", appelantId: "autre", issue: "rdv_fixe", statutApres: "rdv_fixe" },
  ];
  assert.deepEqual(compteursDuJour(appels, MOI), { appels: 5, joints: 3, rdv: 1 });
  assert.deepEqual([...fichesAppeleesAujourdhui(appels)].sort(), ["l1", "l2", "l3", "l4", "l5"]);
  assert.deepEqual(compteursDuJour([], MOI), { appels: 0, joints: 0, rdv: 0 });
});

test("jauge de l'objectif : sans objectif, rien d'affiché ; jamais négative", () => {
  assert.equal(jauge(10, 0), null);
  assert.equal(jauge(10, null), null);
  assert.deepEqual(jauge(15, 60), { fait: 15, cible: 60, reste: 45, part: 0.25, atteint: false });
  assert.deepEqual(jauge(70, 60), { fait: 70, cible: 60, reste: 0, part: 1, atteint: true });
  assert.equal(resteAFaire(jauge(59, 60)), "Encore 1 appel pour l'objectif");
  assert.equal(resteAFaire(jauge(60, 60)), "Objectif atteint");
  assert.equal(resteAFaire(null), null);
});

test("accroche : affichée seulement si elle existe ; seul un lien http(s) devient un lien", () => {
  assert.deepEqual(accrocheDeFiche({ accroche: "  Vos  bassins naturels ?  ", accrocheSource: "https://example.org/realisations" }), {
    texte: "Vos bassins naturels ?",
    source: "https://example.org/realisations",
  });
  assert.equal(accrocheDeFiche({ accroche: "   ", accrocheSource: null }), null);
  assert.equal(accrocheDeFiche({ accroche: null, accrocheSource: "https://example.org" }), null);
  for (const v of ["javascript:alert(1)", "data:text/html,x", "ftp://example.org", "example.org", 42, null]) assert.equal(lienSourceSur(v), null, String(v));
});

test("clavier : la touche d'une issue, jamais dans un champ de saisie ni avec un modificateur", () => {
  const issues = issuesDuPoste(niche.issues);
  assert.equal(issueDeLaTouche({ key: "2", target: { tagName: "BODY" } }, issues).code, "messagerie");
  assert.equal(issueDeLaTouche({ key: "2", target: { tagName: "TEXTAREA" } }, issues), null);
  assert.equal(issueDeLaTouche({ key: "2", target: { tagName: "INPUT", type: "text" } }, issues), null);
  assert.equal(issueDeLaTouche({ key: "2", target: { tagName: "INPUT", type: "checkbox" } }, issues).code, "messagerie");
  assert.equal(issueDeLaTouche({ key: "2", target: { tagName: "DIV", isContentEditable: true } }, issues), null);
  assert.equal(issueDeLaTouche({ key: "2", ctrlKey: true }, issues), null);
  assert.equal(issueDeLaTouche({ key: "2", metaKey: true }, issues), null);
  assert.equal(issueDeLaTouche({ key: "2", repeat: true }, issues), null);
  assert.equal(issueDeLaTouche({ key: "Enter" }, issues), null);
  assert.equal(issueDeLaTouche({ key: "z" }, issues), null);
  assert.ok(estChampTexte({ tagName: "select" }));
  assert.ok(!estChampTexte(null));
  assert.ok(estEnregistrer({ key: "Enter", ctrlKey: true, target: { tagName: "TEXTAREA" } }), "Ctrl+Entrée depuis la note");
  assert.ok(estEnregistrer({ key: "Enter", target: { tagName: "BODY" } }));
  assert.ok(!estEnregistrer({ key: "Enter", target: { tagName: "TEXTAREA" } }), "Entrée seule dans la note : une nouvelle ligne");
  assert.ok(!estEnregistrer({ key: "Enter", shiftKey: true }));
  assert.ok(estAnnuler({ key: "Escape" }) && !estAnnuler({ key: "Escape", repeat: true }));
});

test("chronomètre et durée saisie", () => {
  assert.equal(dureeSecondes(1000, 96_400), 95);
  assert.equal(dureeSecondes(5000, 1000), 0);
  assert.equal(dureeSecondes(0, 10 * 86_400_000), 86_400);
  assert.equal(formatChrono(7), "0:07");
  assert.equal(formatChrono(754), "12:34");
  assert.equal(formatChrono(3723), "1:02:03");
  assert.equal(lireDureeSaisie("2:35"), 155);
  assert.equal(lireDureeSaisie("155"), 155);
  assert.equal(lireDureeSaisie("2 min"), 120);
  assert.equal(lireDureeSaisie("1:00:00"), 3600);
  for (const v of ["", "deux minutes", "2:75", "-3", "999999"]) assert.equal(lireDureeSaisie(v), null, v);
  assert.match(messageAppel("copie", true), /copié/);
  assert.match(messageAppel("repli_tel", true), /lien d'appel ouvert/i);
  assert.match(messageAppel("echec", false), /à la main/);
});

test("chronologie : appels, notes, annonce, rendez-vous, du plus récent au plus ancien", () => {
  const membres = [lireMembre({ id: MOI, nom: "Alex Démo", role: "appelant" })];
  const activites = lireListe(
    [
      { id: "a1", type: "appel", issue: "messagerie", duree_s: 35, rappel_le: "2026-11-10T15:00:00Z", appelant_id: MOI, cree_le: "2026-11-09T09:00:00Z" },
      { id: "a2", type: "note", note: "Préfère le matin", appelant_id: MOI, cree_le: "2026-11-09T10:00:00Z" },
      { id: "a3", type: "annonce", appelant_id: MOI, appel_id: "x", cree_le: "2026-11-09T08:00:00Z" },
      { id: "a4", type: "inconnu", cree_le: "2026-11-09T08:00:00Z" },
    ],
    lireActivite,
  );
  assert.equal(activites.length, 3, "un type inconnu est ignoré");
  const rdvs = lireListe([{ id: "r1", debut: "2026-11-12T13:30:00Z", fin: "2026-11-12T13:50:00Z", canal: "visio", statut: "pris", source: "poste" }], lireRdv);
  const c = chronologie(activites, rdvs, { libellesIssues: { messagerie: "Messagerie" }, membres, fuseau: PARIS, maintenant: LUNDI_10H });
  assert.deepEqual(c.map((e) => e.id), ["rdv-r1", "a2", "a1", "a3"]);
  assert.equal(c[2].titre, "Appel : Messagerie · 35 s · rappel demain 16 h");
  assert.equal(c[2].auteur, "Alex Démo");
  assert.equal(c[3].titre, "Annonce d'enregistrement lue (rattachée à l'appel)");
  assert.match(c[0].titre, /^Rendez-vous pris : jeudi 14 h 30/);
  assert.equal(c[1].quandLibelle, "aujourd'hui 11 h");
  assert.equal(dureeLisible(125), "2 min 05");
});

test("lecture prudente des lignes de la base", () => {
  assert.equal(lireFiche(null), null);
  assert.equal(lireFiche({ id: LEAD }), null, "sans entreprise");
  const f = lireFiche({ id: LEAD, entreprise: "Atelier Démo 01", tier: "Z", score: "72", note_google: "4.5", qualification: { urgent: true }, sources: "pas un tableau" });
  assert.equal(f.tier, null);
  assert.equal(f.score, 72);
  assert.equal(f.noteGoogle, 4.5);
  assert.equal(f.urgent, true);
  assert.deepEqual(f.sources, []);
  assert.equal(f.statut, "a_appeler");
  assert.equal(lireFicheFile({ id: "x", entreprise: "Atelier Démo 02", urgent: true }).urgent, true);
  assert.equal(lireFicheFile({ id: "x", entreprise: "Atelier Démo 02", urgent: null }).urgent, false);
  assert.equal(lireLigneListe({ id: "x", entreprise: "Atelier Démo 03", email: "contact03@example.com", accroche: " " }).aAccroche, false);
  assert.equal(lireMembre({ id: "x", role: "roi" }), null);
  assert.deepEqual(lireListe("rien", lireMembre), []);
});

test("rendez-vous interne : date et heure lues dans le fuseau, futur, canal connu ; la ligne pour rendez_vous", () => {
  const c = { fuseau: PARIS, dureeMin: 20, maintenant: LUNDI_10H };
  const s = validerSaisieRdv({ leadId: LEAD, date: "2026-11-10", heure: "10:00", canal: "visio", closerId: "", note: "Zone : Lyon" }, c);
  assert.deepEqual(s, { leadId: LEAD, debut: "2026-11-10T09:00:00.000Z", fin: "2026-11-10T09:20:00.000Z", canal: "visio", closerId: null, note: "Zone : Lyon" });
  assert.deepEqual(ligneRendezVous(s), {
    lead_id: LEAD,
    closer_id: null,
    debut: "2026-11-10T09:00:00.000Z",
    fin: "2026-11-10T09:20:00.000Z",
    canal: "visio",
    source: "poste",
    statut: "pris",
    note: "Zone : Lyon",
  });
  const refus = (brut, motif) => assert.throws(() => validerSaisieRdv(brut, c), motif);
  refus({ leadId: LEAD, date: "2026-11-09", heure: "09:00", canal: "visio" }, /futur/);
  refus({ leadId: LEAD, date: "2027-11-09", heure: "09:00", canal: "visio" }, /trop loin/);
  refus({ leadId: LEAD, date: "2026-11-10", heure: "10:00", canal: "pigeon" }, /canal/);
  refus({ leadId: LEAD, heure: "10:00", canal: "visio" }, /date et l'heure/);
  refus({ leadId: LEAD, date: "2026-13-40", heure: "10:00", canal: "visio" }, /illisible/);
  refus({ leadId: LEAD, date: "2026-11-10", heure: "10:00", canal: "visio", closerId: "moi" }, /identifiant invalide/);
  refus({ date: "2026-11-10", heure: "10:00", canal: "visio" }, /fiche est obligatoire/);
});

test("lien de réservation : seulement d'un adaptateur d'agenda, et seulement en https ; sans adaptateur, null", () => {
  const lead = { id: LEAD, entreprise: "Atelier Démo 01", dirigeant: null, email: null, telephone: null };
  const cfg = configAgendaDe(niche);
  assert.equal(lienReservationSur(null, lead, cfg), null);
  const faux = (lien) => ({ id: "calendly", libelle: "Faux", lienReservation: () => lien });
  assert.equal(lienReservationSur(faux("https://example.org/reserver?utm_content=x"), lead, cfg), "https://example.org/reserver?utm_content=x");
  assert.equal(lienReservationSur(faux("http://example.org/reserver"), lead, cfg), null);
  assert.equal(lienReservationSur(faux("javascript:alert(1)"), lead, cfg), null);
  assert.equal(lienReservationSur(faux(null), lead, cfg), null);
  assert.equal(lienReservationSur({ id: "google", libelle: "Faux", lienReservation: () => { throw new Error("x"); } }, lead, cfg), null);
});

test("mes leads : la prise revérifiée", () => {
  assert.deepEqual(validerPrise({ nombre: 25, tiers: ["A", "Z", "A"], departements: "69, 38 ; 2a, 1, xx", ville: " Lyon " }), {
    nombre: 25,
    filtres: { tiers: ["A"], departements: ["69", "38", "2A", "01"], ville: "Lyon" },
  });
  assert.throws(() => validerPrise({ nombre: 0 }), /de 1 à 100/);
  assert.throws(() => validerPrise({ nombre: 101 }), /de 1 à 100/);
  assert.throws(() => validerPrise({ nombre: 2.5 }), /de 1 à 100/);
  assert.throws(() => validerPrise(null), /illisible/);
  assert.deepEqual(lireDepartements(null), []);
  assert.deepEqual(enLots([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("petites saisies sur une fiche, revérifiées", () => {
  assert.deepEqual(validerNote({ leadId: LEAD, note: " Rappeler le matin — avant 10 h " }), { leadId: LEAD, note: "Rappeler le matin , avant 10 h" });
  assert.throws(() => validerNote({ leadId: LEAD, note: "  " }), /vide/);
  assert.throws(() => validerUrgent({ leadId: LEAD, urgent: "oui" }), /oui ou non/);
  assert.deepEqual(validerAttribution({ leadId: LEAD, membreId: "" }), { leadId: LEAD, membreId: null });
  assert.throws(() => validerAttribution({ leadId: LEAD, membreId: "quelqu'un" }), /identifiant invalide/);
  assert.deepEqual(validerModification({ leadId: LEAD, champs: { telephone: "01 99 00 01 01" } }, "FR"), { leadId: LEAD, maj: { telephone: "+33199000101" } });
  assert.deepEqual(qualificationAvecUrgence({ source: "x" }, true), { source: "x", urgent: true });
  assert.deepEqual(qualificationAvecUrgence({ source: "x", urgent: true }, false), { source: "x" });
  assert.deepEqual(qualificationAvecUrgence(null, false), {});
});

test("l'adresse du Poste : lue prudemment, écrite sans donnée", () => {
  assert.deepEqual(lireDemandePoste({ fiche: LEAD, apres: "n'importe quoi", mes: "1" }), { fiche: LEAD, apres: null, mesLeads: true });
  assert.deepEqual(lireDemandePoste({ fiche: [LEAD, "x"] }), { fiche: LEAD, apres: null, mesLeads: false });
  assert.deepEqual(lireDemandePoste({}), { fiche: null, apres: null, mesLeads: false });
  assert.equal(adressePoste({}), "/poste");
  assert.equal(adressePoste({ apres: LEAD, mesLeads: true, ok: "messagerie" }), `/poste?apres=${LEAD}&mes=1&ok=messagerie`);
  assert.equal(adressePoste({ fiche: LEAD, ok: "<script>" }), `/poste?fiche=${LEAD}`);
});

test("vue de la fiche : numéros prêts à composer, raison hors file, opposition", () => {
  const o = { pays: "FR", fuseau: PARIS, maintenant: LUNDI_10H, tentativesMax: 4, schemaLien: "tel" };
  const f = lireFiche({ id: LEAD, entreprise: "Atelier Démo 01", telephone: "01 99 00 01 01", mobile: "+33639980001", statut: "a_appeler", tentatives: 1, site: "javascript:x" });
  const v = ficheVue(f, o);
  assert.deepEqual(v.numeros.map((n) => [n.affichage, n.type, n.lien]), [
    ["01 99 00 01 01", "fixe", "tel:+33199000101"],
    ["06 39 98 00 01", "portable", "tel:+33639980001"],
  ]);
  assert.equal(v.site, null, "jamais un lien qui n'est pas http(s)");
  assert.equal(v.horsFile, null);
  assert.equal(v.opposition, false);
  assert.equal(raisonHorsFile({ statut: "pas_interesse", tentatives: 0, rappelLe: null }, o), "Hors de la file : pas intéressé.");
  assert.match(raisonHorsFile({ statut: "a_appeler", tentatives: 4, rappelLe: null }, o), /plafond est de 4/);
  assert.match(raisonHorsFile({ statut: "a_rappeler", tentatives: 0, rappelLe: "2026-11-10T08:30:00Z" }, o), /demain 9 h 30/);
  assert.equal(ficheVue({ ...f, statut: "ne_plus_contacter" }, o).opposition, true);
  const ctx = contexteScriptDe({ dirigeant: "CAMILLE DÉMO", entreprise: "Atelier Démo 01", ville: null, metier: null }, {
    equipe: "Atelier Démo",
    metierParDefaut: "paysagiste",
    vouvoiement: true,
    tonPrenom: "Alex",
    deuxCreneaux: "demain à 10 h ou jeudi à 14 h 30",
  });
  assert.equal(ctx.prenom, "Camille");
  assert.equal(ctx.metier, "paysagiste", "le métier de la fiche, sinon le premier de la cible");
});

test("vue de la file : libellés de rappel et totaux exacts même coupée", () => {
  const fiches = Array.from({ length: 5 }, (_, i) => lireFicheFile({ id: `f${i}`, entreprise: `Atelier Démo 0${i}`, statut: "a_appeler", tentatives: 0, created_at: `2026-10-0${i + 1}` }));
  fiches.push(lireFicheFile({ id: "r", entreprise: "Atelier Démo 09", statut: "a_rappeler", rappel_le: "2026-11-09T08:30:00Z", created_at: "2026-10-01" }));
  const v = fileVue(construireFile(fiches, { maintenant: LUNDI_10H, tentativesMax: 4 }), LUNDI_10H, PARIS, 2);
  assert.equal(v.aAppeler.length, 2);
  assert.equal(v.totaux.aAppeler, 5);
  assert.deepEqual(v.dus.map((l) => [l.rappel, l.enRetard]), [["aujourd'hui 9 h 30", true]]);
  assert.equal(v.ordre.length, 6);
});

test("le navigateur ne reçoit de la config que ce qu'il affiche", () => {
  const c = configPosteClient(niche);
  assert.deepEqual(Object.keys(c).sort(), ["issues", "lieu", "objections", "rdv", "telephonie", "tentativesMax"]);
  assert.deepEqual(c.lieu, { fuseau: "Europe/Paris", pays: "FR" });
  assert.deepEqual(c.telephonie, { fournisseur: "telephone", mode: "lien", schemaLien: "tel", copierNumero: true });
  assert.ok(!JSON.stringify(c).includes(niche.legal.contactRGPD), "pas l'e-mail RGPD");
  assert.ok(c.objections.every((o) => Object.keys(o).join() === "code,libelle"), "les objections sans leur texte (le script les porte)");
  assert.deepEqual(lieuDe(niche), c.lieu);
  assert.equal(contexteIssueDe(niche, LUNDI_10H).objections.at(-1), "libre");
});

test("rendez-vous reçus automatiquement : la règle de l'agenda (toutes les variables de l'outil et la clé service ; leurs noms seulement)", () => {
  const service = { SUPABASE_SERVICE_ROLE_KEY: "cle-service-inventee" };
  assert.equal(rdvRecusAutomatiquement("aucun", { ...service }), false, "agenda interne : RDV pris au Poste");
  assert.equal(rdvRecusAutomatiquement("calendly", { ...service }), false, "variable absente : RDV pris au Poste");
  assert.equal(rdvRecusAutomatiquement("calendly", { ...service, CALENDLY_WEBHOOK_SIGNING_KEY: "  " }), false, "variable vide");
  assert.equal(rdvRecusAutomatiquement("calendly", { CALENDLY_WEBHOOK_SIGNING_KEY: "valeur-factice" }), false, "sans la clé service, rien n'arrive");
  assert.equal(rdvRecusAutomatiquement("calendly", { ...service, CALENDLY_WEBHOOK_SIGNING_KEY: "valeur-factice" }), true);
  const google = { ...service, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REFRESH_TOKEN: "jeton", CRON_SECRET: "x".repeat(32) };
  assert.equal(rdvRecusAutomatiquement("google", google), true, "Google synchronisé : pas de second rendez-vous au Poste");
});

test("découverte : champs du débrief puis questions du script (même id : le débrief l'emporte), lus dans qualification", () => {
  const champs = champsDecouverte(niche);
  assert.deepEqual(champs.map((c) => c.id), ["source_clients", "chantiers_voulus", "frein_principal", "zone", "capacite"]);
  assert.equal(champs[0].question, niche.debrief.champs[0].question, "même id que la question du script : la question du débrief");
  assert.equal(champs.at(-1).question, niche.script.questions.find((q) => q.id === "capacite").texte);
  const r = reponsesDecouverte({ source_clients: " Bouche-à-oreille ", zone: "", capacite: 3, urgent: true, frein_principal: { x: 1 } }, champs);
  assert.deepEqual(r.map((x) => [x.id, x.valeur]), [
    ["source_clients", "Bouche-à-oreille"],
    ["chantiers_voulus", null],
    ["frein_principal", null],
    ["zone", null],
    ["capacite", "3"],
  ]);
  assert.deepEqual(reponsesDecouverte(null, champs).filter((x) => x.valeur), []);
  const v = ficheVue(lireFiche({ id: LEAD, entreprise: "Atelier Démo 01", qualification: { source_clients: "Plateformes", zone: " " } }), {
    pays: "FR",
    fuseau: PARIS,
    maintenant: LUNDI_10H,
    tentativesMax: 4,
    schemaLien: "tel",
    champsDecouverte: champs,
  });
  assert.deepEqual(v.reponses, { source_clients: "Plateformes" }, "le Poste reçoit seulement les réponses notées");
});

test("signaux du téléphone (iframe) : lus prudemment, seulement pour la fiche ouverte, ils pilotent chronomètre et durée", () => {
  assert.equal(lireEtatTelephone("pret"), "pret");
  assert.equal(lireEtatTelephone("occupe"), null);
  assert.equal(lireSignalTelephone({ etat: "explose" }), null);
  assert.equal(lireSignalTelephone("sonne"), null);
  assert.deepEqual(lireSignalTelephone({ etat: "termine", direction: "sortant", dureeS: 95.4, externeId: "x", leadId: LEAD }), {
    etat: "termine",
    direction: "sortant",
    dureeS: 95,
    leadId: LEAD,
  });
  assert.equal(lireSignalTelephone({ etat: "termine", dureeS: -4 }).dureeS, null);
  // À qui est ce signal ?
  const s = (etat, leadId = null, direction = "sortant") => ({ etat, direction, dureeS: null, leadId });
  assert.ok(signalPourFiche(s("sonne", LEAD), LEAD, false), "lancé par appeler() sur cette fiche");
  assert.ok(!signalPourFiche(s("sonne", "autre-fiche"), LEAD, true), "jamais le signal d'une autre fiche");
  assert.ok(signalPourFiche(s("decroche"), LEAD, true), "sans fiche : seulement pendant un appel sortant de cette fiche");
  assert.ok(!signalPourFiche(s("decroche"), LEAD, false));
  assert.ok(!signalPourFiche(s("sonne", null, "entrant"), LEAD, true), "jamais un appel entrant");
  // Le déroulé : sonne à 10 h, décroché 20 s plus tard, terminé 95 s après avec la durée du fournisseur.
  const t0 = LUNDI_10H;
  let a = appliquerSignal(null, s("sonne", LEAD), t0);
  assert.deepEqual(a, nouvelAppel(t0));
  a = appliquerSignal(a, s("decroche", LEAD), t0 + 20_000);
  assert.equal(a.decroche, t0 + 20_000);
  assert.equal(dureeAppel(a, t0 + 50_000), 30, "pendant l'appel : depuis le décroché");
  a = appliquerSignal(a, { ...s("termine", LEAD), dureeS: 95 }, t0 + 115_000);
  assert.equal(a.fin, t0 + 115_000);
  assert.equal(dureeAppel(a, t0 + 999_000), 95, "la durée du fournisseur l'emporte");
  assert.equal(dureeAppel(appliquerSignal(nouvelAppel(t0), s("termine", LEAD), t0 + 40_000), t0 + 99_000), 40, "sans durée du fournisseur : le chronomètre");
  assert.equal(dureeAppel(null, t0), 0);
  const sansLancement = appliquerSignal(null, { ...s("termine", LEAD), dureeS: 12 }, t0);
  assert.equal(dureeAppel(sansLancement, t0), 12, "un appel passé depuis le téléphone, vu seulement à sa fin");
  const relance = appliquerSignal({ ...nouvelAppel(t0), fin: t0 + 5000 }, s("sonne", LEAD), t0 + 60_000);
  assert.equal(relance.debut, t0 + 60_000, "un nouvel appel après la fin du précédent repart de zéro");
});
