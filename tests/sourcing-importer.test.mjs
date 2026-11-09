// L'import (scripts/sourcing/importer.mjs), sans base : lecture des lignes, numéros en E.164, sources datées, liste STOP, doublons du
// fichier, complément d'une fiche existante (jamais de remplacement), choix de l'équipe, déroulé de la transaction (simulation =
// ROLLBACK, --appliquer = COMMIT) et sorties sans donnée, avec un FAUX client SQL. Le test contre une vraie base locale est dans
// tests/sourcing-importer-base.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { completer, construireSources, executer, lireStop, preparer, preparerLigne, resoudreWorkspace, sourceImport } from "../scripts/sourcing/importer.mjs";
import { normaliserE164, tel9 } from "../scripts/sourcing/lib.mjs";
import { e164, fixe, mobile, niche, sirenFictif } from "./sourcing-outils.mjs";

const AUJOURDHUI = "2026-11-09";
const N = niche();
const CTX = { pays: "FR", aujourdhui: AUJOURDHUI, grille: N.score };
const ligne = (o) => ({ entreprise: "Atelier Démo 01", ...o });

test("numéros : E.164 selon le pays (règle de la fonction SQL normaliser_e164), 9 derniers chiffres", () => {
  assert.equal(normaliserE164("01 99 00 01 01"), "+33199000101");
  assert.equal(normaliserE164("+33 (0)1 99 00 01 01"), "+33199000101");
  assert.equal(normaliserE164("0033 1 99 00 01 01"), "+33199000101");
  assert.equal(normaliserE164("33199000101"), "+33199000101");
  assert.equal(normaliserE164("06.39.98.00.01"), "+33639980001");
  assert.equal(normaliserE164("01 99 00 01"), null, "trop court");
  assert.equal(normaliserE164("+33 1 99 00 01 01 99"), null, "trop long pour la France");
  assert.equal(normaliserE164("514 555 0123", "CA"), "+15145550123", "Canada : 10 chiffres (plage 555-01xx, fictive)");
  assert.equal(normaliserE164("514 555 0123", "FR"), null);
  assert.equal(normaliserE164("+1 514 555 0123", "FR"), "+15145550123", "le format international vaut partout");
  assert.equal(normaliserE164(""), null);
  assert.equal(tel9("+33 1 99 00 01 01"), "199000101");
  assert.equal(tel9("0101"), null);
});

test("une ligne : entreprise, identifiant, SIREN lisible ; sinon une raison sans donnée", () => {
  assert.deepEqual(preparerLigne(ligne({ entreprise: " ", siren: sirenFictif(1) }), CTX), { ok: false, raison: "entreprise_manquante" });
  assert.deepEqual(preparerLigne(ligne({ siren: "12345" }), CTX), { ok: false, raison: "siren_illisible" });
  assert.deepEqual(preparerLigne(ligne({ telephone: "pas un numéro" }), CTX), { ok: false, raison: "aucun_identifiant" });
  const enTrop = Object.defineProperty(ligne({ siren: sirenFictif(1) }), "enTrop", { value: true });
  assert.deepEqual(preparerLigne(enTrop, CTX), { ok: false, raison: "colonnes_en_trop" });
  const r = preparerLigne(ligne({ siren: sirenFictif(1), telephone: "n/a" }), CTX);
  assert.equal(r.ok, true, "un numéro illisible n'empêche pas une fiche qui a un SIREN");
  assert.equal(r.illisibles, 1);
  assert.equal(r.fiche.telephone, null);
});

test("une ligne complète devient une fiche : normalisations, enseigne, forme, département, score et tier", () => {
  const r = preparerLigne(
    ligne({
      enseigne: "Les Jardins Démo | Autre enseigne",
      siren: sirenFictif(1),
      siret: `${sirenFictif(1)}00011`,
      telephone: fixe(1),
      mobile: fixe(1),
      email: " Contact@Example.ORG ",
      email_source: "https://example.org/atelier-demo-01/contact",
      site: "example.org/atelier-demo-01",
      ville: "Lyon",
      code_postal: "69003",
      naf: "8130z",
      categorie_juridique: "5499",
      effectif: "6 à 9 salariés",
      date_creation: "01/03/2015",
      dirigeant: "Camille Démo",
      note_google: "4,6",
      nb_avis: "12",
    }),
    { ...CTX, metier: "paysagiste" },
  );
  assert.equal(r.ok, true);
  const f = r.fiche;
  assert.equal(f.entreprise, "Atelier Démo 01 (Les Jardins Démo)");
  assert.deepEqual([f.telephone, f.mobile], [e164(fixe(1)), null], "le mobile identique au fixe n'est pas gardé deux fois");
  assert.deepEqual([f.email, f.email_source, f.site], ["contact@example.org", "https://example.org/atelier-demo-01/contact", "https://example.org/atelier-demo-01"]);
  assert.deepEqual([f.naf, f.forme, f.departement, f.cp, f.date_creation, f.metier], ["81.30Z", "SARL", "69", "69003", "2015-03-01", "paysagiste"]);
  assert.deepEqual([f.note_google, f.nb_avis], [4.6, 12]);
  assert.deepEqual([f.score, f.tier], [100, "A"], "score calculé avec la grille de la config");
  assert.equal(preparerLigne(ligne({ siren: sirenFictif(2), score: "50" }), CTX).fiche.tier, "B", "un score du fichier est gardé, le tier en découle");
  assert.equal(preparerLigne(ligne({ siren: sirenFictif(2), email: "x", email_source: "https://example.org" }), CTX).fiche.email_source, null);
});

test("sources datées : origine de la fiche, des coordonnées et de l'e-mail ; date du jour à défaut", () => {
  const sources = construireSources(
    {
      source: "sirene",
      source_url: "https://recherche-entreprises.api.gouv.fr",
      source_date: "2026-11-01",
      coordonnees_source: "maps",
      coordonnees_url: "https://www.google.com/maps/place/demo",
      coordonnees_date: "2026-11-02",
      email_source: "https://example.org/contact",
      email_date: "2026-11-03",
    },
    { aujourdhui: AUJOURDHUI, email: "contact@example.org", coordonnees: true },
  );
  assert.deepEqual(sources, [
    { type: "sirene", detail: "registre SIRENE (API Recherche Entreprises)", url: "https://recherche-entreprises.api.gouv.fr/", le: "2026-11-01" },
    { type: "maps", detail: "téléphone et site : fiche Google Maps", url: "https://www.google.com/maps/place/demo", le: "2026-11-02" },
    { type: "site", detail: "e-mail publié sur le site de l'entreprise", url: "https://example.org/contact", le: "2026-11-03" },
  ]);
  assert.deepEqual(construireSources({ source: "Annuaire démo des pros" }, { aujourdhui: AUJOURDHUI }), [
    { type: "fichier", detail: "Annuaire démo des pros", le: AUJOURDHUI },
  ]);
  assert.deepEqual(construireSources({}, { aujourdhui: AUJOURDHUI }), [{ type: "fichier", detail: "fichier importé", le: AUJOURDHUI }]);
});

test("liste STOP : SIREN (ou SIRET) et numéros ; un fichier sans colonne connue est refusé, jamais ignoré", () => {
  const stop = lireStop(`siren;telephone\n${sirenFictif(1)};\n;${fixe(2)}\n${sirenFictif(3)}00011;${mobile(3)}\n`);
  assert.deepEqual([...stop.sirens], [sirenFictif(1), sirenFictif(3)]);
  assert.deepEqual([...stop.tels], [tel9(fixe(2)), tel9(mobile(3))]);
  assert.equal(stop.entrees, 4);
  assert.throws(() => lireStop("nom\nAtelier Démo 01\n"), /ni colonne « siren » ni colonne « telephone »/);
  assert.equal(lireStop("").entrees, 0);
});

test("le fichier : invalides, STOP, doublons (SIREN puis numéro), --exiger-telephone ; les compteurs se recoupent", () => {
  const lignes = [
    ligne({ siren: sirenFictif(1), telephone: fixe(1) }),
    ligne({ siren: sirenFictif(1), telephone: fixe(9) }),
    ligne({ siren: sirenFictif(2), telephone: fixe(1) }),
    ligne({ mobile: mobile(1) }),
    ligne({ mobile: mobile(1) }),
    ligne({ siren: sirenFictif(4) }),
    ligne({ siren: sirenFictif(5), telephone: fixe(5) }),
    ligne({ telephone: fixe(6) }),
    ligne({ entreprise: "" }),
    ligne({ siren: "abc" }),
  ];
  const stop = { sirens: new Set([sirenFictif(5)]), tels: new Set([tel9(fixe(6))]), entrees: 2 };
  const { candidates, compteurs: c } = preparer(lignes, { ...CTX, stop, exigerTelephone: true });
  assert.deepEqual(
    [c.lues, c.invalides, c.stop, c.doublons_siren, c.doublons_telephone, c.sans_numero, candidates.length],
    [10, 2, 2, 1, 2, 1, 2],
  );
  assert.equal(c.lues, c.invalides + c.stop + c.doublons_siren + c.doublons_telephone + c.sans_numero + candidates.length);
  assert.deepEqual(c.raisons, { entreprise_manquante: 1, siren_illisible: 1 });
});

test("compléter une fiche existante : seulement les champs vides, jamais un numéro d'une autre fiche, sources si quelque chose change", () => {
  const existante = {
    id: "e1",
    siren: sirenFictif(1),
    telephone: e164(fixe(1)),
    mobile: null,
    email: null,
    email_source: null,
    site: "https://example.org/garde",
    ville: "Lyon",
    score: 40,
    tier: null,
    sources: [{ type: "sirene", le: "2026-10-01" }],
  };
  const fiche = preparerLigne(
    ligne({
      siren: sirenFictif(1),
      telephone: fixe(2),
      mobile: mobile(2),
      email: "contact@example.org",
      email_source: "https://example.org/contact",
      site: "https://example.org/autre",
      ville: "Bron",
      dirigeant: "Camille Démo",
      score: "90",
      source: "sirene",
      source_date: "2026-11-01",
    }),
    CTX,
  ).fiche;
  const patch = completer(existante, fiche, { seuils: N.score.seuils, numeroPris: (t9) => t9 === tel9(mobile(2)) });
  assert.equal(patch.id, "e1");
  assert.equal(patch.telephone, undefined, "le téléphone présent n'est jamais remplacé");
  assert.equal(patch.mobile, undefined, "un numéro déjà porté par une autre fiche n'est pas copié");
  assert.equal(patch.site, undefined);
  assert.equal(patch.ville, undefined);
  assert.equal(patch.score, undefined, "le score présent est gardé");
  assert.equal(patch.tier, "C", "le tier manquant se déduit du score présent");
  assert.deepEqual([patch.email, patch.email_source, patch.dirigeant], ["contact@example.org", "https://example.org/contact", "Camille Démo"]);
  assert.deepEqual(patch.sources_ajout.map((s) => s.type), ["sirene", "site"]);
  const pleine = { ...existante, ...patch, tier: "C" };
  assert.equal(completer(pleine, fiche, { seuils: N.score.seuils, numeroPris: () => true }), null, "rien de nouveau : null");
  // La provenance des coordonnées dit ce qu'elle couvre (colonne coordonnees_champs de l'appariement).
  const couverte = construireSources(
    { source: "sirene", coordonnees_source: "maps", coordonnees_date: "2026-11-02", coordonnees_champs: "telephone,note_google,inconnu" },
    { aujourdhui: "2026-11-09", coordonnees: true },
  );
  assert.equal(couverte[1].detail, "téléphone, note : fiche Google Maps");
  // Une fiche qui a déjà 20 sources ne peut plus en prendre : ses champs vides ne sont pas remplis (jamais une donnée sans sa source).
  const sources = Array.from({ length: 20 }, (_, i) => ({ type: "manuel", detail: `source ${i}`, le: "2026-10-01" }));
  assert.equal(completer({ ...existante, sources }, fiche, { seuils: N.score.seuils, numeroPris: () => false }), null);
});

test("source du journal : --source, sinon la source commune du fichier si elle est connue, sinon csv", () => {
  assert.equal(sourceImport([{ source: "sirene" }, { source: "SIRENE" }]), "sirene");
  assert.equal(sourceImport([{ source: "sirene" }, { source: "maps" }]), "csv");
  assert.equal(sourceImport([{ source: "Annuaire démo" }]), "csv");
  assert.equal(sourceImport([{}], "manuel"), "manuel");
});

/** Un faux client SQL : il répond aux requêtes de l'import et garde le journal. */
function fauxClient({ equipes = ["a0000000-0000-4000-8000-000000000000"], opposees = () => false, existantes = [], panne = null } = {}) {
  const journal = [];
  return {
    journal,
    async query(texte, valeurs = []) {
      const t = String(texte).trim().toLowerCase();
      journal.push({ t, valeurs });
      if (panne && t.startsWith(panne)) throw Object.assign(new Error(`violation : ${valeurs[1] ?? ""}`), { code: "23514" });
      if (["begin", "commit", "rollback"].includes(t) || /^(savepoint|release|rollback to)/.test(t)) return { rows: [] };
      if (t.startsWith("select id from public.workspaces where id")) return { rows: equipes.filter((e) => e === valeurs[0]).map((id) => ({ id })) };
      if (t.startsWith("select id from public.workspaces")) return { rows: equipes.slice(0, 2).map((id) => ({ id })) };
      if (t.includes("identifiants_en_opposition")) {
        const [, sirens, tels, mobiles] = valeurs;
        return { rows: sirens.map((s, i) => ({ s, t: tels[i], m: mobiles[i], i: i + 1 })).filter((x) => opposees(x)).map((x) => ({ i: x.i })) };
      }
      if (t.startsWith("select id, siren")) return { rows: existantes };
      if (t.startsWith("insert into public.leads")) {
        const lignes = JSON.parse(valeurs[1]);
        return { rowCount: lignes.length, rows: lignes.map((l) => ({ tier: l.tier, sans_numero: !l.telephone && !l.mobile })) };
      }
      if (t.startsWith("update public.leads")) return { rowCount: JSON.parse(valeurs[1]).length, rows: [] };
      if (t.startsWith("insert into public.imports")) return { rowCount: 1, rows: [] };
      throw new Error(`requête inattendue : ${t.slice(0, 40)}`);
    },
  };
}

const CSV = [
  "entreprise;siren;telephone;source;source_date",
  `Atelier Démo 01;${sirenFictif(1)};${fixe(1)};sirene;2026-11-01`,
  `Atelier Démo 02;${sirenFictif(2)};${fixe(2)};sirene;2026-11-01`,
  `Atelier Démo 03;${sirenFictif(3)};${fixe(3)};sirene;2026-11-01`,
  `Atelier Démo 04;${sirenFictif(4)};${fixe(4)};sirene;2026-11-01`,
].join("\n");

const sansDonnee = (r) => {
  const texte = [...r.lignes, r.erreur ?? ""].join("\n");
  assert.ok(!/Démo|\d{7,}|example/.test(texte), "la sortie ne cite aucune donnée (nom, numéro, SIREN, e-mail)");
};

test("simulation par défaut : la transaction est annulée (ROLLBACK), le journal des imports noté « simulation »", async () => {
  const client = fauxClient({
    opposees: (x) => x.s === sirenFictif(2),
    existantes: [{ id: "e3", siren: sirenFictif(3), telephone: null, statut: "a_appeler", sources: [], telephone_9: null, mobile_9: null }],
  });
  const r = await executer(client, { niche: N, texteCsv: CSV, maintenant: new Date("2026-11-09T09:00:00Z") });
  assert.equal(r.erreur, null);
  sansDonnee(r);
  assert.equal(client.journal.at(-1).t, "rollback");
  assert.ok(!client.journal.some((q) => q.t === "commit"));
  const c = r.compteurs;
  assert.deepEqual([c.opposition, c.mises_a_jour, c.creees], [1, 1, 2]);
  const imports = client.journal.find((q) => q.t.startsWith("insert into public.imports"));
  assert.deepEqual(imports.valeurs.slice(1), ["sirene", true, 4, 2, 1, 0, 1, 0]);
});

test("--appliquer : COMMIT ; une erreur SQL annule tout (ROLLBACK) et n'affiche que son code", async () => {
  const client = fauxClient();
  const r = await executer(client, { niche: N, texteCsv: CSV, appliquer: true });
  assert.equal(r.erreur, null);
  assert.equal(client.journal.at(-1).t, "commit");
  assert.ok(r.lignes.some((l) => /APPLIQUÉ : 4 fiche/.test(l)));

  const enPanne = fauxClient({ panne: "insert into public.leads" });
  const echec = await executer(enPanne, { niche: N, texteCsv: CSV, appliquer: true });
  assert.match(echec.erreur, /ROLLBACK.*code 23514/);
  sansDonnee(echec);
  assert.equal(enPanne.journal.at(-1).t, "rollback");
  assert.ok(!enPanne.journal.some((q) => q.t === "commit"));
});

test("transaction déjà ouverte par l'appelant : un point de sauvegarde, jamais BEGIN ni COMMIT", async () => {
  const simulation = fauxClient();
  await executer(simulation, { niche: N, texteCsv: CSV, transactionExterne: true });
  const ordres = (c) => c.journal.map((q) => q.t).filter((t) => /^(begin|commit|rollback|savepoint|release)/.test(t));
  assert.deepEqual(ordres(simulation), ["savepoint import_sourcing", "rollback to savepoint import_sourcing"]);
  const appliquee = fauxClient();
  await executer(appliquee, { niche: N, texteCsv: CSV, transactionExterne: true, appliquer: true });
  assert.deepEqual(ordres(appliquee), ["savepoint import_sourcing", "release savepoint import_sourcing"]);
});

test("l'équipe : la seule de la base ; plusieurs : --workspace obligatoire ; inconnue ou mal écrite : refus", async () => {
  const une = "a0000000-0000-4000-8000-000000000000";
  const deux = "b0000000-0000-4000-8000-000000000000";
  assert.equal(await resoudreWorkspace(fauxClient({ equipes: [une] })), une);
  await assert.rejects(resoudreWorkspace(fauxClient({ equipes: [] })), /Aucune équipe/);
  await assert.rejects(resoudreWorkspace(fauxClient({ equipes: [une, deux] })), /--workspace/);
  assert.equal(await resoudreWorkspace(fauxClient({ equipes: [une, deux] }), deux), deux);
  await assert.rejects(resoudreWorkspace(fauxClient({ equipes: [une] }), deux), /inconnue/);
  await assert.rejects(resoudreWorkspace(fauxClient({ equipes: [une] }), "pas-un-uuid"), /uuid/);
  const r = await executer(fauxClient({ equipes: [une, deux] }), { niche: N, texteCsv: CSV });
  assert.match(r.erreur, /--workspace/);
});

test("fichiers refusés avant toute écriture : sans colonne entreprise, sans identifiant, vide ; --source inconnue", async () => {
  const client = fauxClient();
  assert.match((await executer(client, { niche: N, texteCsv: "siren\n000000001\n" })).erreur, /entreprise/);
  assert.match((await executer(client, { niche: N, texteCsv: "entreprise;ville\nAtelier Démo 01;Lyon\n" })).erreur, /siren, telephone ou mobile/);
  assert.match((await executer(client, { niche: N, texteCsv: "entreprise;siren\n" })).erreur, /aucune ligne/);
  assert.match((await executer(client, { niche: N, texteCsv: CSV, source: "linkedin" })).erreur, /--source/);
  assert.equal(client.journal.length, 0, "aucune requête envoyée");
});
