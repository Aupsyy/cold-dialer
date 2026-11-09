// La logique pure de l'écran Réglages (lib/reglages) : lecture des lignes, saisies revérifiées, lien d'invitation, messages lisibles des
// refus de la base, écart des deux plafonds de tentatives, blocage de l'enregistrement, date limite de conservation (comme PostgreSQL),
// purge complète avec ses dépendances simulées, effacement d'une fiche, balayage des audios restés sans appel, aide des outils (des
// NOMS de variables, jamais une valeur). Sur la niche d'exemple (CONTRIBUTING.md) ; aucun réseau.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exemple } from "./aides.mjs";

const equipe = await import("../lib/reglages/equipe.ts");
const reglages = await import("../lib/reglages/reglages.ts");
const rgpd = await import("../lib/reglages/rgpd.ts");
const audios = await import("../lib/reglages/audios.ts");
const { vueAide } = await import("../lib/reglages/aide.ts");
const { PHRASE_OPPOSITION } = await import("../lib/reglages/libelles.ts");
const { chargerNiche } = await import("../config/charger.ts");
const { niche } = await import("../config/niche.ts");

const MOI = "a1000000-0000-4000-8000-000000000001";
const AUTRE = "a3000000-0000-4000-8000-000000000003";
const WS = "a0000000-0000-4000-8000-000000000000";
const JETON = "0123456789abcdef".repeat(4);

test("les lignes : un membre (rôle connu), une invitation (jamais son jeton), l'équipe triée par rôle puis par nom", () => {
  assert.deepEqual(equipe.lireMembreEquipe({ id: AUTRE, nom: " Alex Démo ", email: "alex@example.com", role: "appelant", email_telephonie: null, created_at: "2026-11-01" }), {
    id: AUTRE,
    nom: "Alex Démo",
    email: "alex@example.com",
    role: "appelant",
    emailTelephonie: null,
    depuis: "2026-11-01",
  });
  assert.equal(equipe.lireMembreEquipe({ id: AUTRE, role: "roi" }), null);
  assert.equal(equipe.lireMembreEquipe({ id: AUTRE, role: "membre" }).nom, "Sans nom");
  const inv = equipe.lireInvitation({ id: "i1", role: "membre", email: null, nom_invite: "Lou", expire_le: "2026-11-23T09:00:00Z", jeton: JETON });
  assert.deepEqual(Object.keys(inv).sort(), ["creeLe", "email", "expireLe", "id", "nom", "role"], "le jeton n'est jamais repris");
  assert.equal(equipe.lireInvitation({ id: "i1", role: "membre", expire_le: "pas une date" }), null);
  assert.doesNotMatch(equipe.COLONNES_INVITATION, /jeton/, "la liste ne lit jamais le jeton");
  const tries = equipe.trierEquipe([
    { id: "3", nom: "Zoé", role: "appelant" },
    { id: "2", nom: "Bruno", role: "membre" },
    { id: "1", nom: "Ana", role: "appelant" },
    { id: "0", nom: "Yann", role: "proprietaire" },
  ]);
  assert.deepEqual(tries.map((m) => m.id), ["0", "2", "1", "3"]);
  assert.equal(equipe.estExpiree({ expireLe: "2026-11-09T09:00:00Z" }, Date.parse("2026-11-09T09:00:01Z")), true);
  assert.equal(equipe.estExpiree({ expireLe: "2026-11-23T09:00:00Z" }, Date.parse("2026-11-09T09:00:00Z")), false);
});

test("le lien d'invitation : l'origine de l'instance (https, ou http en local) et un jeton de 64 caractères hexadécimaux", () => {
  assert.equal(equipe.lienInvitation("https://atelier-demo.example.org/reglages?x=1", JETON), `https://atelier-demo.example.org/signup?invitation=${JETON}`);
  assert.equal(equipe.lienInvitation("http://localhost:3000", JETON), `http://localhost:3000/signup?invitation=${JETON}`);
  assert.equal(equipe.lienInvitation("http://atelier-demo.example.org", JETON), null, "jamais en clair hors de la machine");
  assert.equal(equipe.lienInvitation("https://u:p@atelier-demo.example.org", JETON), null);
  assert.equal(equipe.lienInvitation("pas une adresse", JETON), null);
  assert.equal(equipe.lienInvitation("https://atelier-demo.example.org", "ABC"), null);
  assert.equal(equipe.DUREE_INVITATION_JOURS, 14);
});

test("les rôles qu'on peut donner : le propriétaire seul invite un propriétaire ; un appelant n'invite personne", () => {
  assert.deepEqual(equipe.rolesInvitables("proprietaire"), ["appelant", "membre", "proprietaire"]);
  assert.deepEqual(equipe.rolesInvitables("membre"), ["appelant", "membre"]);
  assert.deepEqual(equipe.rolesInvitables("appelant"), []);
  assert.deepEqual(equipe.validerInvitation({ role: "appelant", email: " Lou.Demo@Example.com ", nom: "" }, "membre"), {
    role: "appelant",
    email: "lou.demo@example.com",
    nom_invite: null,
  });
  assert.throws(() => equipe.validerInvitation({ role: "proprietaire", nom: "Associé" }, "membre"), /Seul le propriétaire invite un autre propriétaire/);
  assert.throws(() => equipe.validerInvitation({ role: "appelant", email: "", nom: " " }, "proprietaire"), /e-mail ou le nom/);
  assert.throws(() => equipe.validerInvitation({ role: "appelant", nom: "Lou" }, "appelant"), /autorisation/);
  assert.throws(() => equipe.validerInvitation({ role: "appelant", email: "pas-un-email" }, "proprietaire"), /adresse invalide/);
  assert.throws(() => equipe.validerInvitation({ role: "roi", nom: "Lou" }, "proprietaire"), /Choisis un rôle/);
  assert.throws(() => equipe.validerInvitation("n'importe quoi", "proprietaire"), /Saisie illisible/);
});

test("les gestes de l'équipe : jamais son propre rôle ni son propre retrait ; l'e-mail de téléphonie vide est effacé", () => {
  assert.deepEqual(equipe.validerChangementRole({ membreId: AUTRE.toUpperCase(), role: "membre" }, MOI), { membreId: AUTRE, role: "membre" });
  assert.throws(() => equipe.validerChangementRole({ membreId: MOI.toUpperCase(), role: "membre" }, MOI), { message: equipe.ERR_PROPRE_ROLE });
  assert.throws(() => equipe.validerChangementRole({ membreId: "pas-un-uuid", role: "membre" }, MOI), /identifiant invalide/);
  assert.deepEqual(equipe.validerRetrait({ membreId: AUTRE }, MOI), { membreId: AUTRE });
  assert.throws(() => equipe.validerRetrait({ membreId: MOI }, MOI), { message: equipe.ERR_SE_RETIRER });
  assert.deepEqual(equipe.validerEmailTelephonie({ membreId: AUTRE, email: " Poste.Alex@Example.com " }), { membreId: AUTRE, email: "poste.alex@example.com" });
  assert.deepEqual(equipe.validerEmailTelephonie({ membreId: AUTRE, email: "" }), { membreId: AUTRE, email: null });
  assert.throws(() => equipe.validerEmailTelephonie({ membreId: AUTRE, email: "poste@" }), /adresse invalide/);
  assert.deepEqual(equipe.validerNom({ nom: "  Alex Démo " }), { nom: "Alex Démo" });
  assert.throws(() => equipe.validerNom({ nom: "   " }), /obligatoire/);
  assert.throws(() => equipe.validerNom({ nom: "x".repeat(121) }), /120 caractères/);
  assert.deepEqual(equipe.validerRevocation({ invitationId: AUTRE }), { invitationId: AUTRE });
});

test("les refus de la base deviennent des messages lisibles, propres à chaque geste", () => {
  assert.match(equipe.messageEquipe("email_telephonie", "23505"), /déjà celui d'un autre compte/);
  assert.match(equipe.messageEquipe("email_telephonie", "22023"), /pas valide/);
  assert.match(equipe.messageEquipe("role", "42501"), /propriétaire, et jamais sur son propre compte/);
  assert.match(equipe.messageEquipe("retrait", "P0002"), /n'est plus dans l'équipe/);
  assert.match(equipe.messageEquipe("revocation", "P0002"), /déjà été utilisée ou révoquée/);
  assert.match(equipe.messageEquipe("invitation", "23514"), /e-mail ou le nom/);
  assert.match(equipe.messageEquipe("invitation", "42501"), /seul le propriétaire invite un propriétaire/);
  assert.match(equipe.messageEquipe("nom", "XX000"), /Réessaie/);
});

test("les réglages : la ligne lue, les deux plafonds de tentatives et leur écart expliqué, l'objectif borné", () => {
  assert.deepEqual(reglages.lireReglages({ enregistrement_complet: true, annonce_lue_le: "2026-11-09T09:00:00Z", tentatives_max: 4, objectif_appels_jour: 60 }), {
    enregistrementComplet: true,
    annonceLueLe: "2026-11-09T09:00:00Z",
    tentativesMax: 4,
    objectifAppelsJour: 60,
  });
  assert.equal(reglages.lireReglages({ tentatives_max: "4" }), null);
  assert.equal(reglages.ecartPlafonds(niche.tentativesMax, niche.tentativesMax), null, "la niche d'exemple : alignés");
  const bas = reglages.ecartPlafonds(2, 4);
  assert.match(bas.explication, /dès 2 tentatives.*file \(4\)/);
  const haut = reglages.ecartPlafonds(6, 4);
  assert.match(haut.explication, /après 4 tentatives.*au bout de 6.*sans jamais revenir dans la file/);
  assert.equal(reglages.validerObjectif({ objectif: "45" }), 45);
  assert.equal(reglages.validerObjectif({ objectif: 0 }), 0);
  for (const mauvais of [1001, -1, 4.5, "abc", "", null]) assert.throws(() => reglages.validerObjectif({ objectif: mauvais }), /de 0 à 1000/);
});

test("l'enregistrement : seuls Onoff, Aircall et Ringover enregistrent ; la config doit le déclarer ; la case est obligatoire", () => {
  assert.equal(reglages.outilsQuiEnregistrent(), "Onoff, Aircall et Ringover");
  assert.match(reglages.blocageEnregistrement(niche.telephonie), /Le téléphone n'envoie aucun enregistrement/, "la niche d'exemple n'enregistre pas");
  assert.match(reglages.blocageEnregistrement({ fournisseur: "softphone", enregistrement: false }), /Le softphone n'envoie aucun/);
  assert.match(reglages.blocageEnregistrement({ fournisseur: "onoff", enregistrement: false }), /telephonie\.enregistrement vaut false/);
  assert.equal(reglages.blocageEnregistrement({ fournisseur: "aircall", enregistrement: true }), null);
  reglages.validerAcceptation({ accepte: true });
  for (const non of [{ accepte: "true" }, { accepte: false }, {}, null]) assert.throws(() => reglages.validerAcceptation(non), /Coche d'abord/);
  assert.deepEqual(reglages.ligneActivation(Date.parse("2026-11-09T09:00:00Z")), {
    annonce_lue_le: "2026-11-09T09:00:00.000Z",
    enregistrement_complet: true,
  });
  const cadre = reglages.cadreLegalEnregistrement(niche.legal.annonceEnregistrement, niche.legal.conservationMois).join("\n");
  assert.match(cadre, /article 226-1 du Code pénal/);
  assert.match(cadre, /CNIL/);
  assert.match(cadre, /CHAQUE appel/);
  assert.ok(cadre.includes(niche.legal.annonceEnregistrement), "l'annonce de la config");
  assert.match(cadre, /36 mois/);
  assert.match(cadre, /pas un avis juridique/);
  assert.ok(!cadre.includes("—"), "pas de tiret cadratin");
});

test("la date limite de conservation se calcule comme PostgreSQL (fin de mois ramenée au dernier jour)", () => {
  assert.equal(rgpd.limiteConservation(Date.parse("2026-11-09T09:00:00Z"), 36), "2023-11-09T09:00:00.000Z");
  assert.equal(rgpd.limiteConservation(Date.parse("2026-05-31T10:00:00Z"), 3), "2026-02-28T10:00:00.000Z");
  assert.equal(rgpd.limiteConservation(Date.parse("2028-05-31T10:00:00Z"), 3), "2028-02-29T10:00:00.000Z");
  assert.equal(rgpd.limiteConservation(Date.parse("2026-03-31T23:30:00Z"), 1), "2026-02-28T23:30:00.000Z");
  assert.equal(rgpd.limiteConservation(Date.parse("2026-01-15T00:00:00Z"), 13), "2024-12-15T00:00:00.000Z");
  assert.equal(rgpd.seuilAudiosOrphelins(Date.parse("2026-11-09T09:00:00Z"), 36), Date.parse("2023-11-12T09:00:00.000Z"), "la date limite plus 3 jours");
  assert.equal(
    rgpd.filtreFichesInactives("2023-11-09T09:00:00.000Z"),
    "last_activity_at.lt.2023-11-09T09:00:00.000Z,and(last_activity_at.is.null,created_at.lt.2023-11-09T09:00:00.000Z)",
  );
});

const CHEMIN_1 = `${WS}/onoff/appel-1.mp3`;
const CHEMIN_2 = `${WS}/aircall/appel-2.wav`;

test("la réponse de purger_fiches_inactives : des compteurs entiers, des chemins d'audio valides et sans doublon", () => {
  assert.deepEqual(
    rgpd.lirePurge({ fiches: 2, appels: 3, rendezVous: 1, debriefs: 0, retours: 4, enregistrementsAEffacer: [CHEMIN_1, CHEMIN_1, "../etc/passwd", 7, CHEMIN_2] }),
    { fiches: 2, appels: 3, rendezVous: 1, debriefs: 0, retours: 4, chemins: [CHEMIN_1, CHEMIN_2] },
  );
  assert.equal(rgpd.lirePurge({ fiches: "2", appels: 3, rendezVous: 1, debriefs: 0, retours: 4 }), null);
  assert.equal(rgpd.lirePurge(null), null);
});

function purgeSimulee({ base, evenements = { data: 3, error: null }, audiosEnEchec = [], balayage = null } = {}) {
  const appels = [];
  const journal = [];
  const d = {
    mois: 36,
    purgerBase: async (mois) => (appels.push(`base:${mois}`), base ?? { data: { fiches: 2, appels: 3, rendezVous: 1, debriefs: 1, retours: 0, enregistrementsAEffacer: [CHEMIN_1, CHEMIN_2] }, error: null }),
    purgerEvenements: async () => (appels.push("evenements"), evenements),
    effacerAudio: async (chemin) => (appels.push(`audio:${chemin}`), audiosEnEchec.includes(chemin) ? { ok: false, code: "stockage_500" } : { ok: true }),
    balayer: balayage ? async () => (appels.push("balayage"), balayage) : undefined,
    journal: (code) => journal.push(code),
  };
  return { d, appels, journal };
}

test("la purge complète : la base, puis ses audios, puis le journal des webhooks, puis le balayage ; des compteurs seulement", async () => {
  const balayage = { examines: 10, orphelins: 2, effaces: 2, enEchec: 0, complet: true, code: null };
  const { d, appels, journal } = purgeSimulee({ audiosEnEchec: [CHEMIN_2], balayage });
  const r = await rgpd.executerPurge(d);
  assert.deepEqual(appels, ["base:36", `audio:${CHEMIN_1}`, `audio:${CHEMIN_2}`, "evenements", "balayage"]);
  assert.deepEqual(r, {
    ok: true,
    data: {
      mois: 36,
      fiches: 2,
      appels: 3,
      rendezVous: 1,
      debriefs: 1,
      retours: 0,
      evenements: 3,
      audiosEffaces: 1,
      audiosEnEchec: 1,
      audiosEnAttente: 0,
      orphelins: balayage,
      balayageSaute: false,
    },
  });
  assert.deepEqual(journal, ["purge:audio:stockage_500"], "un code, jamais le chemin");

  const refus = purgeSimulee({ base: { data: null, error: { code: "42501", message: "Atelier Démo 01" } } });
  assert.deepEqual(await rgpd.executerPurge(refus.d), { ok: false, error: rgpd.ERR_PURGE });
  assert.deepEqual(refus.appels, ["base:36"], "la base refuse : rien d'autre n'est tenté");
  assert.deepEqual(refus.journal, ["purge:base:42501"]);

  const sansEvenements = purgeSimulee({ evenements: { data: null, error: { code: "PGRST202" } } });
  const r2 = await rgpd.executerPurge(sansEvenements.d);
  assert.equal(r2.data.evenements, null);
  assert.equal(r2.data.orphelins, null, "sans balayage fourni");
  assert.equal(r2.data.balayageSaute, false);
  assert.deepEqual(sansEvenements.journal, ["purge:evenements:PGRST202"]);

  const illisible = purgeSimulee({ base: { data: { fiches: 1 }, error: null } });
  assert.match((await rgpd.executerPurge(illisible.d)).error, /sans compteurs lisibles/);

  // Le temps est compté (une fonction de Vercel s'arrête) : après l'échéance, plus d'audio ni de balayage ; le reste est compté.
  let t = 0;
  const presse = purgeSimulee({ balayage });
  const r3 = await rgpd.executerPurge({ ...presse.d, echeance: 0, horloge: () => t++ });
  assert.deepEqual([r3.data.audiosEffaces, r3.data.audiosEnAttente, r3.data.orphelins, r3.data.balayageSaute], [1, 1, null, true]);
  assert.deepEqual(presse.appels, ["base:36", `audio:${CHEMIN_1}`, "evenements"], "le journal des webhooks est purgé quand même");
  assert.ok(presse.journal.includes("purge:audio:temps_ecoule"));
});

test("l'effacement d'une fiche : la confirmation exigée, ses identifiants, la ligne d'opposition à inscrire", () => {
  assert.throws(() => rgpd.validerEffacement({ leadId: AUTRE }), /Confirme d'abord/);
  assert.throws(() => rgpd.validerConfirmation({ confirme: "oui" }), /Confirme d'abord/);
  assert.deepEqual(rgpd.validerEffacement({ leadId: AUTRE, confirme: true, opposition: true }), { leadId: AUTRE, opposition: true });
  assert.deepEqual(rgpd.validerEffacement({ leadId: AUTRE, confirme: true }), { leadId: AUTRE, opposition: false });
  const fiche = rgpd.lireFicheAEffacer({ id: "f1", siren: "000000001", telephone: "+33 1 99 00 01 01", mobile: "06 39 98 00 01", statut: "a_appeler" });
  assert.deepEqual(fiche, { id: "f1", siren: "000000001", telephone: "+33 1 99 00 01 01", mobile: "06 39 98 00 01", entreprise: null, cp: null, opposee: false });
  assert.equal(rgpd.lireFicheAEffacer({ id: "f1", statut: "ne_plus_contacter" }).opposee, true);
  assert.deepEqual(rgpd.neufChiffresDe(fiche), ["199000101", "639980001"]);
  assert.deepEqual(rgpd.neufChiffresDe({ telephone: "+33199000101", mobile: "01 99 00 01 01" }), ["199000101"], "sans doublon");
  assert.deepEqual(rgpd.ligneOpposition(fiche), { siren: "000000001", motif: "Demande d'effacement", source: "manuel" });
  assert.deepEqual(rgpd.ligneOpposition({ ...fiche, siren: null }), { telephone: "33199000101", motif: "Demande d'effacement", source: "manuel" });
  const sansNumero = { id: "f1", siren: null, telephone: "12", mobile: null, entreprise: "Atelier Démo 01", cp: "75001", opposee: false };
  assert.equal(rgpd.ligneOpposition(sansNumero), null, "sans clé calculée par la base : rien");
  assert.deepEqual(rgpd.ligneOpposition(sansNumero, "atelier demo 01|75001"), { cle: "atelier demo 01|75001", motif: "Demande d'effacement", source: "manuel" });
  assert.equal(rgpd.ligneOpposition(sansNumero, "pas une clé !"), null, "une clé illisible est ignorée");
  assert.equal(rgpd.lireFicheAEffacer({ id: "f1", entreprise: " Atelier Démo 02 ", cp: "75002", statut: "a_appeler" }).entreprise, "Atelier Démo 02");
  assert.deepEqual(Object.keys(PHRASE_OPPOSITION).sort(), ["deja", "inscrite", "non_demandee", "sans_identifiant"]);
});

test("le stockage : la liste d'un dossier par l'API Storage (clé service en en-tête, jamais dans le résultat)", async () => {
  const cle = `cle-${Math.random().toString(36).slice(2)}`;
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://projet.example.org/", SUPABASE_SERVICE_ROLE_KEY: cle };
  const requetes = [];
  const reponses = [
    new Response(
      JSON.stringify([
        { name: "dossier", id: null },
        { name: "a.mp3", id: "x", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-02T00:00:00Z" },
        { name: "b/c.mp3", id: "y" },
      ]),
      { status: 200 },
    ),
    new Response("{}", { status: 400 }),
  ];
  const f = async (url, init) => (requetes.push({ url: String(url), init }), reponses.shift());
  const lister = audios.listerParStockage(env, f);
  const r = await lister(`${WS}/onoff`, 0, 100);
  assert.deepEqual(r, {
    ok: true,
    objets: [
      { nom: "dossier", creeLe: null, majLe: null, dossier: true },
      { nom: "a.mp3", creeLe: Date.parse("2026-11-01T00:00:00Z"), majLe: Date.parse("2026-11-02T00:00:00Z"), dossier: false },
    ],
  });
  assert.equal(requetes[0].url, "https://projet.example.org/storage/v1/object/list/enregistrements");
  assert.equal(requetes[0].init.method, "POST");
  assert.equal(requetes[0].init.headers.apikey, cle);
  assert.equal(requetes[0].init.headers.Authorization, `Bearer ${cle}`);
  assert.deepEqual(JSON.parse(requetes[0].init.body), { prefix: `${WS}/onoff`, limit: 100, offset: 0, sortBy: { column: "created_at", order: "asc" } });
  assert.deepEqual(await lister(`${WS}/onoff`, 100, 100), { ok: false, code: "liste_400" });
  assert.deepEqual(await audios.listerParStockage({}, f)(`${WS}/onoff`, 0, 100), { ok: false, code: "configuration" });
  const panne = audios.listerParStockage(env, async () => {
    throw new Error(`réseau ${cle}`);
  });
  assert.deepEqual(await panne(`${WS}/onoff`, 0, 100), { ok: false, code: "liste_reseau" });
});

/**
 * Un bucket simulé : des fichiers par dossier ([nom, âge en jours, réécrit il y a N jours ?]), une liste triée par date de dépôt et
 * paginée, des effacements notés. Le seuil des tests : il y a 10 jours.
 */
const MAINTENANT = Date.parse("2026-11-09T09:00:00Z");
const JOUR = 86_400_000;
const SEUIL = MAINTENANT - 10 * JOUR;
function bucketSimule(dossiers, { references = [], echecEffacement = [], erreurReferences = false } = {}) {
  const fichiers = new Map(
    Object.entries(dossiers).map(([p, l]) => [p, l.map(([nom, jours, reecrit]) => ({ nom, creeLe: MAINTENANT - jours * JOUR, majLe: MAINTENANT - (reecrit ?? jours) * JOUR }))]),
  );
  const effaces = [];
  const listes = [];
  return {
    effaces,
    listes,
    d: {
      workspaceIds: [WS, "pas-un-uuid"],
      avant: SEUIL,
      lister: async (prefixe, offset, limite) => {
        listes.push(`${prefixe}@${offset}`);
        const tous = [...(fichiers.get(prefixe) ?? [])].sort((a, b) => a.creeLe - b.creeLe).map((o) => ({ ...o, dossier: false }));
        return { ok: true, objets: tous.slice(offset, offset + limite) };
      },
      references: async (chemins) => (erreurReferences ? { ok: false, code: "references_500" } : { ok: true, chemins: new Set(chemins.filter((c) => references.includes(c))) }),
      effacer: async (chemin) => {
        if (echecEffacement.includes(chemin)) return { ok: false, code: "stockage_403" };
        effaces.push(chemin);
        const [ws, f, nom] = chemin.split("/");
        const p = `${ws}/${f}`;
        fichiers.set(p, fichiers.get(p).filter((o) => o.nom !== nom));
        return { ok: true };
      },
    },
  };
}

test("le balayage des audios restés sans appel : déposés et réécrits avant le seuil, forme d'un audio, aucun appel ne les désigne", async () => {
  const b = bucketSimule(
    {
      [`${WS}/onoff`]: [["vieux-orphelin.mp3", 400], ["vieux-garde.mp3", 300], ["pas un audio.txt", 200], ["reecrit.mp3", 100, 1], ["recent.mp3", 2], ["apres.mp3", 1]],
      [`${WS}/aircall`]: [["autre-orphelin.wav", 30]],
    },
    { references: [`${WS}/onoff/vieux-garde.mp3`] },
  );
  const r = await audios.balayerAudiosOrphelins(b.d);
  assert.deepEqual(b.effaces, [`${WS}/onoff/vieux-orphelin.mp3`, `${WS}/aircall/autre-orphelin.wav`]);
  assert.deepEqual(r, { examines: 5, orphelins: 2, effaces: 2, enEchec: 0, complet: true, code: null }, "la liste s'arrête au premier fichier après le seuil");
  assert.deepEqual(b.listes, [`${WS}/onoff@0`, `${WS}/aircall@0`, `${WS}/ringover@0`], "seulement le dossier d'une équipe connue");

  const erreur = bucketSimule({ [`${WS}/onoff`]: [["vieux.mp3", 48]] }, { erreurReferences: true });
  const r2 = await audios.balayerAudiosOrphelins(erreur.d);
  assert.deepEqual(erreur.effaces, [], "une lecture en échec n'efface rien");
  assert.deepEqual(r2, { examines: 1, orphelins: 0, effaces: 0, enEchec: 0, complet: false, code: "references_500" });

  const echec = bucketSimule({ [`${WS}/onoff`]: [["a.mp3", 48], ["b.mp3", 48]] }, { echecEffacement: [`${WS}/onoff/a.mp3`] });
  const r3 = await audios.balayerAudiosOrphelins(echec.d);
  assert.deepEqual({ effaces: r3.effaces, enEchec: r3.enEchec, code: r3.code }, { effaces: 1, enEchec: 1, code: "stockage_403" });

  const tard = bucketSimule({ [`${WS}/onoff`]: [["a.mp3", 48]] });
  const r4 = await audios.balayerAudiosOrphelins({ ...tard.d, echeance: 0, horloge: () => 1 });
  assert.equal(r4.complet, false, "le temps écoulé arrête le balayage");
  assert.deepEqual(tard.effaces, []);
});

test("le balayage pagine en tenant compte des fichiers effacés (aucun fichier sauté) ; un plafond de fichiers examinés, levé pour le script", async () => {
  const noms = Array.from({ length: 250 }, (_, i) => [`appel-${String(i).padStart(3, "0")}.mp3`, 500 - i]);
  const gardes = noms.filter((_, i) => i % 2 === 1).map(([n]) => `${WS}/onoff/${n}`);
  const b = bucketSimule({ [`${WS}/onoff`]: noms }, { references: gardes });
  const r = await audios.balayerAudiosOrphelins(b.d);
  assert.equal(r.effaces, 125, "tous les orphelins, sur trois pages");
  assert.equal(r.examines, 250, "chaque fichier examiné une fois");
  assert.equal(r.complet, true);

  const plafonne = bucketSimule({ [`${WS}/onoff`]: noms }, { references: gardes });
  const r2 = await audios.balayerAudiosOrphelins({ ...plafonne.d, maxExamines: 100 });
  assert.equal(r2.complet, false, "au-delà du plafond : le reste attend le passage suivant");
  const suite = await audios.balayerAudiosOrphelins({ ...plafonne.d, maxExamines: Number.POSITIVE_INFINITY });
  assert.equal(r2.effaces + suite.effaces, 125, "la relance reprend : les fichiers effacés ont quitté la liste");
});

test("l'aide des outils : la niche d'exemple (téléphone, agenda interne), puis Onoff et Calendly sans variables ; des NOMS seulement", () => {
  const vue = vueAide(niche, {});
  assert.equal(vue.telephonie.aWebhook, false);
  assert.deepEqual(vue.telephonie.variablesManquantes, []);
  assert.match(vue.telephonie.poste, /numéro est copié/);
  assert.ok(vue.telephonie.pannes.length > 0);
  assert.equal(vue.agenda.automatique, false);
  assert.match(vue.agenda.mode, /Agenda interne/);
  assert.deepEqual(vue.agenda.variablesManquantes, []);
  assert.equal(vue.cleServicePresente, false);

  const n = exemple();
  n.telephonie = { fournisseur: "onoff", mode: "extension", copierNumero: true, enregistrement: true };
  n.agenda = { fournisseur: "calendly", lienReservation: "https://calendly.com/atelier-demo/diagnostic", prefill: true, champLead: "utm_content" };
  const autre = chargerNiche(n);
  const sans = vueAide(autre, {});
  assert.equal(sans.telephonie.aWebhook, true);
  assert.deepEqual(sans.telephonie.variablesManquantes, ["ONOFF_WEBHOOK_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]);
  assert.deepEqual(sans.telephonie.variablesFacultativesAbsentes, ["ONOFF_API_KEY"]);
  assert.deepEqual(sans.agenda.variablesManquantes, ["CALENDLY_WEBHOOK_SIGNING_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  assert.match(sans.agenda.mode, /RDV pris/);

  const secrets = { ONOFF_WEBHOOK_TOKEN: `t-${Math.random()}`, SUPABASE_SERVICE_ROLE_KEY: `s-${Math.random()}`, CALENDLY_WEBHOOK_SIGNING_KEY: `c-${Math.random()}` };
  const avec = vueAide(autre, secrets);
  assert.deepEqual(avec.telephonie.variablesManquantes, []);
  assert.equal(avec.agenda.automatique, true);
  assert.match(avec.agenda.mode, /arrivent tout seuls/);
  const texte = JSON.stringify([sans, avec]);
  for (const v of Object.values(secrets)) assert.ok(!texte.includes(v), "jamais une valeur");
});
