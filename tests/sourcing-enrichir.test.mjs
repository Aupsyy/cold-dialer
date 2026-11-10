// L'enrichissement (scripts/sourcing/enrichir.mjs et signaux.mjs) : ce que dit le registre (chiffre d'affaires, effectif, employeur,
// état, non-diffusion), les signaux d'un site (pixel Meta, balise Google Ads, prise de rendez-vous, agence créditée), UNE seule lecture
// du site pour les signaux et l'e-mail, les colonnes écrites, la reprise par le cache, --essai, --refaire, les rapports sans donnée, et
// la suite jusqu'au score. Aucun réseau : fetch et le DNS sont des faux ; sites en example.org, SIREN fictifs (sourcing-outils.mjs).
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { lireCsv } from "../scripts/sourcing/csv.mjs";
import { appliquerRegistre, executer, extraireRegistre } from "../scripts/sourcing/enrichir.mjs";
import { executer as noter } from "../scripts/sourcing/score.mjs";
import { agenceCreditee, lireSignaux, listerSignaux, SIGNAUX } from "../scripts/sourcing/signaux.mjs";
import { dossierTemporaire, fausseHorloge, niche, sirenFictif } from "./sourcing-outils.mjs";

const MAINTENANT = new Date("2026-11-09T09:00:00Z");
const hote = (n) => `atelier-demo-0${n}.example.org`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Le registre
// ---------------------------------------------------------------------------------------------------------------------------------

const resultat = (siren, o = {}) => ({
  siren,
  nom_complet: "Atelier Démo",
  etat_administratif: o.etat ?? "A",
  date_creation: o.creation ?? "2015-03-01",
  tranche_effectif_salarie: o.tranche ?? "03",
  siege: { caractere_employeur: o.employeur ?? "O", tranche_effectif_salarie: "NN" },
  finances: o.finances ?? { 2022: { ca: 310000, resultat_net: 12000 }, 2023: { ca: 352000.4, resultat_net: 9000 } },
  ...(o.plus ?? {}),
});

test("registre : dernier chiffre d'affaires publié, effectif en libellé, employeur, état, date de création", () => {
  assert.deepEqual(extraireRegistre(resultat(sirenFictif(1))), {
    ca: 352000,
    ca_annee: 2023,
    employeur: true,
    etat: "A",
    tranche: "6 à 9 salariés",
    date_creation: "2015-03-01",
  });
  const sans = extraireRegistre(resultat(sirenFictif(2), { finances: {}, employeur: "N", etat: "C", tranche: "NN" }));
  assert.deepEqual([sans.ca, sans.ca_annee, sans.employeur, sans.etat, sans.tranche], [null, null, false, "C", ""]);
  const inconnu = extraireRegistre({ siren: sirenFictif(3), siege: {} });
  assert.deepEqual([inconnu.employeur, inconnu.etat, inconnu.ca], [null, "", null], "ni oui ni non quand le registre ne dit rien");
  assert.equal(extraireRegistre(resultat(sirenFictif(4), { plus: { statut_diffusion: "P" } })), null, "non diffusible : rien n'est gardé");
  assert.equal(extraireRegistre(null), null);
});

test("appliquerRegistre : une case déjà remplie n'est jamais remplacée (sauf --refaire) ; l'effectif et la date viennent du registre seulement s'ils manquent", () => {
  const reg = extraireRegistre(resultat(sirenFictif(1)));
  const ligne = { effectif: "10 à 19 salariés", date_creation: "", chiffre_affaires: "1" };
  assert.equal(appliquerRegistre(ligne, reg, "2026-11-09"), true);
  assert.deepEqual([ligne.effectif, ligne.date_creation, ligne.chiffre_affaires, ligne.employeur, ligne.etat_registre, ligne.registre_date], ["10 à 19 salariés", "2015-03-01", "1", "oui", "A", "2026-11-09"]);
  appliquerRegistre(ligne, reg, "2026-11-10", { refaire: true });
  assert.equal(ligne.chiffre_affaires, "352000");
  assert.equal(appliquerRegistre({}, null, "2026-11-09"), false);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Les signaux du site
// ---------------------------------------------------------------------------------------------------------------------------------

test("signaux : pixel Meta, balise Google Ads (pas Google Analytics), prise de rendez-vous, agence créditée en pied de page", () => {
  assert.deepEqual(SIGNAUX, ["pixel_meta", "balise_google_ads", "prise_rdv", "agence_creditee"]);
  const page = (html) => lireSignaux([{ url: "https://example.org/", html }]);
  assert.equal(page(`<script>fbq('init', '123456789012345'); fbq('track','PageView');</script>`).pixel_meta, true);
  assert.equal(page(`<script src="https://connect.facebook.net/fr_FR/fbevents.js"></script>`).pixel_meta, true);
  assert.equal(page(`<p>Retrouvez-nous sur facebook.com/atelierdemo</p>`).pixel_meta, false, "un lien vers une page n'est pas un pixel");
  assert.equal(page(`<script>gtag('config', 'AW-1234567890');</script>`).balise_google_ads, true);
  assert.equal(page(`<script src="https://www.googleadservices.com/pagead/conversion.js"></script>`).balise_google_ads, true);
  assert.equal(page(`<script>gtag('config', 'G-ABCDE12345');</script>`).balise_google_ads, false, "Google Analytics mesure l'audience, ce n'est pas de la publicité");
  assert.equal(page(`<a href="https://calendly.com/atelier-demo/30min">Prendre rendez-vous</a>`).prise_rdv, true);
  assert.equal(page(`<iframe src="https://cal.com/atelier-demo"></iframe>`).prise_rdv, true);
  assert.equal(page(`<a href="/contact">Prendre rendez-vous</a>`).prise_rdv, false, "un lien « contact » n'est pas un outil de réservation");
  const tout = page(`<script>fbq('init','1')</script><script>gtag('config','AW-1234567')</script><a href="https://calendly.com/x">rdv</a><footer>Site réalisé par Agence Démo</footer>`);
  assert.equal(listerSignaux(tout), "pixel_meta,balise_google_ads,prise_rdv,agence_creditee", "l'ordre de SIGNAUX");
  assert.equal(listerSignaux(page("<p>Rien</p>")), "");
  assert.equal(lireSignaux([]).agence_creditee, false);
});

test("agence créditée : pied de page ou fin de page ; une plateforme (« Powered by ») n'est pas une agence ; le corps de la page ne compte pas", () => {
  assert.equal(agenceCreditee(`<main><p>Bienvenue</p></main><footer><p>© 2026 Atelier Démo - Site réalisé par Agence Démo</p></footer>`), true);
  assert.equal(agenceCreditee(`<main><p>Bienvenue</p></main><footer><p>Création : Studio Démo</p></footer>`), true);
  assert.equal(agenceCreditee(`<p>Bienvenue chez nous. Mentions légales. Site conçu par Studio Démo</p>`), true, "sans <footer> : la fin du texte");
  assert.equal(agenceCreditee(`<footer><p>© 2026 Atelier Démo - Powered by Wix.com</p></footer>`), false);
  assert.equal(agenceCreditee(`<main><p>Nous avons réalisé par exemple cette terrasse.</p>${"<p>texte</p>".repeat(400)}</main><footer>© 2026</footer>`), false);
  assert.equal(agenceCreditee(""), false);
});

test("signaux : une page hostile (des milliers de <footer> jamais fermés) se lit vite", () => {
  const hostile = "<footer>x".repeat(20000);
  const debut = Date.now();
  lireSignaux([{ url: "https://example.org/", html: hostile }]);
  assert.ok(Date.now() - debut < 3000, "temps borné");
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Le script
// ---------------------------------------------------------------------------------------------------------------------------------

const reponseHtml = (corps, { status = 200, type = "text/html; charset=utf-8" } = {}) => () => new Response(corps, { status, headers: { "content-type": type } });

/** Le faux réseau : le registre (par SIREN), les sites (par adresse). Chaque requête est gardée. */
function fauxReseau({ registre = {}, sites = {} }, horloge) {
  const appels = { registre: [], sites: [] };
  const fetch = async (url, init) => {
    if (String(url).startsWith("https://recherche-entreprises.api.gouv.fr/search")) {
      const q = new URL(url).searchParams.get("q");
      appels.registre.push(q);
      const r = registre[q];
      if (r instanceof Error) throw r;
      if (typeof r === "number") return new Response("{}", { status: r });
      return new Response(JSON.stringify({ results: r ? [r] : [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    appels.sites.push({ url, t: horloge.horloge(), ua: init.headers["User-Agent"] });
    const page = sites[url];
    if (page === undefined) return reponseHtml("introuvable", { status: 404, type: "text/plain" })();
    if (page instanceof Error) throw page;
    return page();
  };
  return { fetch, appels };
}

const fauxDns = () => ({ resoudre: async () => [{ address: "203.0.113.20", family: 4 }] });

const SITES = {
  [`https://${hote(1)}/`]: reponseHtml(
    `<html><body><script>fbq('init','1');</script><a href="https://calendly.com/atelier-demo">Rendez-vous</a><footer><a href="mailto:contact@${hote(1)}">contact@${hote(1)}</a></footer></body></html>`,
  ),
  [`https://${hote(2)}/robots.txt`]: reponseHtml("User-agent: *\nDisallow: /\n", { type: "text/plain" }),
  [`https://${hote(2)}/`]: reponseHtml("<p>ne doit jamais être lu</p>"),
  [`https://${hote(3)}/`]: reponseHtml(`<html><body><p>Atelier sans publicité.</p><footer>Site réalisé par Agence Démo</footer></body></html>`),
  [`https://${hote(4)}/`]: new Error("réseau"),
};

function ecrireBase(chemin) {
  writeFileSync(
    chemin,
    [
      "entreprise;siren;site;email;effectif",
      `Atelier Démo 01;${sirenFictif(1)};https://${hote(1)}/;;`,
      `Atelier Démo 02;${sirenFictif(2)};https://${hote(2)}/;deja@${hote(2)};2 salariés`,
      `Atelier Démo 03;${sirenFictif(3)};https://${hote(3)}/;;`,
      `Atelier Démo 04;${sirenFictif(4)};https://${hote(4)}/;;`,
      "Atelier Démo 05;;;;",
      `Atelier Démo 06;${sirenFictif(6)};;;`,
    ].join("\n"),
  );
}

const REGISTRE = {
  [sirenFictif(1)]: resultat(sirenFictif(1)),
  [sirenFictif(2)]: resultat(sirenFictif(2), { finances: {}, employeur: "N", etat: "C" }),
  [sirenFictif(3)]: resultat(sirenFictif(3)),
  [sirenFictif(4)]: resultat(sirenFictif(4), { plus: { statut_diffusion: "P" } }),
  // SIREN n° 6 : absent du registre
};

function deps(reseau, h) {
  return { fetch: reseau.fetch, resoudre: fauxDns().resoudre, attendre: h.attendre, horloge: h.horloge, maintenant: MAINTENANT };
}

test("le script : registre et site sur un CSV fictif, colonnes écrites, une seule lecture de site pour les signaux ET l'e-mail", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    ecrireBase(entree);
    const h = fausseHorloge(0);
    const reseau = fauxReseau({ registre: REGISTRE, sites: SITES }, h);
    const r = await executer({ niche: niche(), entree, dossier: dossier.chemin, dependances: deps(reseau, h) });
    const texte = r.lignes.join("\n");
    assert.ok(!/Démo|example|@/.test(texte) && !texte.includes(sirenFictif(1)), "le rapport ne cite aucune donnée");
    assert.deepEqual(reseau.appels.registre.sort(), [1, 2, 3, 4, 6].map((n) => sirenFictif(n)).sort(), "un appel par SIREN, aucun pour les lignes sans SIREN");
    // le site 2 est interdit par robots.txt : la page n'est jamais demandée
    assert.ok(!reseau.appels.sites.some((a) => a.url === `https://${hote(2)}/`));
    // une seule requête sur la page d'accueil du site 1 : les signaux et l'e-mail viennent de la même lecture
    assert.equal(reseau.appels.sites.filter((a) => a.url === `https://${hote(1)}/`).length, 1);
    assert.ok(reseau.appels.sites.every((a) => a.ua === niche().marque.userAgent), "l'identité du robot vient de la config");

    const { colonnes, lignes } = lireCsv(readFileSync(join(dossier.chemin, "base-enrichi.csv"), "utf8"));
    for (const c of ["chiffre_affaires", "ca_annee", "employeur", "etat_registre", "registre_date", "site_joignable", "signaux_site", "signaux_date", "email_source"]) {
      assert.ok(colonnes.includes(c), c);
    }
    const [l1, l2, l3, l4, l5, l6] = lignes;
    assert.deepEqual([l1.chiffre_affaires, l1.ca_annee, l1.employeur, l1.etat_registre, l1.registre_date], ["352000", "2023", "oui", "A", "2026-11-09"]);
    assert.deepEqual([l1.site_joignable, l1.signaux_site, l1.signaux_date], ["oui", "pixel_meta,prise_rdv", "2026-11-09"]);
    assert.deepEqual([l1.email, l1.email_source, l1.email_date, l1.effectif], [`contact@${hote(1)}`, `https://${hote(1)}/`, "2026-11-09", "6 à 9 salariés"]);
    assert.deepEqual([l2.chiffre_affaires, l2.employeur, l2.etat_registre, l2.effectif, l2.email], ["", "non", "C", "2 salariés", `deja@${hote(2)}`], "CA non publié : vide ; case remplie jamais remplacée");
    assert.deepEqual([l2.site_joignable, l2.signaux_site, l2.signaux_date], ["", "", ""], "site interdit par robots.txt : pas lu, ni oui ni non");
    assert.deepEqual([l3.etat_registre, l3.chiffre_affaires, l3.site_joignable, l3.signaux_site], ["A", "352000", "oui", "agence_creditee"]);
    assert.deepEqual([l4.registre_date, l4.chiffre_affaires, l4.employeur], ["", "", ""], "non diffusible : rien n'est écrit");
    assert.deepEqual([l4.site_joignable, l4.signaux_site], ["non", ""], "site qui n'a pas répondu");
    assert.deepEqual([l5.registre_date, l5.site_joignable], ["", ""]);
    assert.deepEqual([l6.registre_date, l6.chiffre_affaires], ["", ""], "introuvable au registre : rien");
    assert.deepEqual(
      [r.compteurs.registre_lus, r.compteurs.registre_introuvables, r.compteurs.non_diffusibles, r.compteurs.avec_ca, r.compteurs.employeurs, r.compteurs.cessees],
      [5, 1, 1, 2, 2, 1],
    );
    assert.deepEqual([r.compteurs.sites_joignables, r.compteurs.pixel_meta, r.compteurs.prise_rdv, r.compteurs.agence_creditee, r.compteurs.emails_trouves, r.compteurs.robots, r.compteurs.injoignables], [2, 1, 1, 1, 1, 1, 1]);
    assert.ok(!readFileSync(join(dossier.chemin, "base.csv"), "utf8").includes("registre_date"), "le fichier d'entrée n'est jamais modifié");
  } finally {
    dossier.supprimer();
  }
});

test("cadence : une requête par seconde au plus par domaine, 150 ms entre deux requêtes au registre", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    ecrireBase(entree);
    const h = fausseHorloge(1_000_000);
    const reseau = fauxReseau({ registre: REGISTRE, sites: SITES }, h);
    await executer({ niche: niche(), entree, dossier: dossier.chemin, dependances: deps(reseau, h) });
    const pourHote1 = reseau.appels.sites.filter((a) => a.url.includes(hote(1)));
    for (let i = 1; i < pourHote1.length; i++) assert.ok(pourHote1[i].t - pourHote1[i - 1].t >= 1000);
    assert.ok(h.etat.attentes.some((m) => m <= 150 && m > 0), "le registre est cadencé");
  } finally {
    dossier.supprimer();
  }
});

test("--essai : compteurs seulement, aucune requête, ni CSV ni cache ; --sans-registre et --sans-site", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    ecrireBase(entree);
    const h = fausseHorloge(0);
    const reseau = fauxReseau({ registre: REGISTRE, sites: SITES }, h);
    const essai = await executer({ niche: niche(), entree, dossier: dossier.chemin, essai: true, dependances: deps(reseau, h) });
    assert.deepEqual([essai.compteurs.sirens_a_lire, essai.compteurs.domaines_a_lire], [5, 4]);
    assert.deepEqual([reseau.appels.registre.length, reseau.appels.sites.length], [0, 0]);
    assert.ok(!existsSync(join(dossier.chemin, "base-enrichi.csv")) && !existsSync(join(dossier.chemin, "cache")));

    const sansSite = await executer({ niche: niche(), entree, dossier: dossier.chemin, site: false, limite: 2, dependances: deps(reseau, h) });
    assert.equal(reseau.appels.sites.length, 0);
    assert.equal(sansSite.compteurs.registre_lus, 2, "--limite N : N SIREN au plus");
    const sansRegistre = await executer({ niche: niche(), entree, sortie: join(dossier.chemin, "site.csv"), dossier: dossier.chemin, registre: false, dependances: deps(reseau, h) });
    assert.equal(sansRegistre.compteurs.registre_lus, 0);
    const colonnes = lireCsv(readFileSync(join(dossier.chemin, "site.csv"), "utf8")).colonnes;
    assert.ok(!colonnes.includes("chiffre_affaires") && colonnes.includes("signaux_site"));
  } finally {
    dossier.supprimer();
  }
});

test("reprise : le cache évite de relire le registre et les sites ; une ligne déjà enrichie est sautée ; --refaire relit", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    ecrireBase(entree);
    const h = fausseHorloge(0);
    const reseau = fauxReseau({ registre: REGISTRE, sites: SITES }, h);
    await executer({ niche: niche(), entree, dossier: dossier.chemin, dependances: deps(reseau, h) });
    const [r0, s0] = [reseau.appels.registre.length, reseau.appels.sites.length];

    // même entrée, autre sortie : tout vient du cache (sauf le site qui n'avait pas répondu, retenté)
    const repris = await executer({ niche: niche(), entree, sortie: join(dossier.chemin, "relance.csv"), dossier: dossier.chemin, dependances: deps(reseau, h) });
    assert.equal(reseau.appels.registre.length, r0, "le registre n'est pas relu");
    assert.equal(repris.compteurs.registre_repris_du_cache, 5, "y compris l'introuvable et le non diffusible");
    assert.equal(repris.compteurs.sites_repris_du_cache, 3, "le site interdit par robots.txt est en cache aussi");
    assert.ok(reseau.appels.sites.length - s0 <= 2, "seul le site injoignable est retenté");
    const lignes = lireCsv(readFileSync(join(dossier.chemin, "relance.csv"), "utf8")).lignes;
    assert.equal(lignes[0].chiffre_affaires, "352000");
    assert.equal(lignes[0].email, `contact@${hote(1)}`);

    // une base déjà enrichie : rien à refaire
    const dejaFait = await executer({ niche: niche(), entree: join(dossier.chemin, "base-enrichi.csv"), sortie: join(dossier.chemin, "encore.csv"), dossier: dossier.chemin, dependances: deps(reseau, h), essai: true });
    assert.deepEqual([dejaFait.compteurs.sirens_a_lire, dejaFait.compteurs.domaines_a_lire], [2, 1], "restent : le SIREN introuvable et le non diffusible (pas de date), et le site interdit par robots.txt (pas lu)");
    const refait = await executer({ niche: niche(), entree: join(dossier.chemin, "base-enrichi.csv"), sortie: join(dossier.chemin, "refait.csv"), dossier: dossier.chemin, refaire: true, essai: true, dependances: deps(reseau, h) });
    assert.equal(refait.compteurs.sirens_a_lire, 5);
  } finally {
    dossier.supprimer();
  }
});

test("pannes du registre : une erreur ne bloque rien, la ligne reste sans donnée (ni gain ni perte)", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    ecrireBase(entree);
    const h = fausseHorloge(0);
    const registre = { ...REGISTRE, [sirenFictif(1)]: 404 };
    const reseau = fauxReseau({ registre, sites: SITES }, h);
    const r = await executer({ niche: niche(), entree, dossier: dossier.chemin, site: false, dependances: deps(reseau, h) });
    assert.equal(r.compteurs.registre_erreurs, 1);
    const lignes = lireCsv(readFileSync(join(dossier.chemin, "base-enrichi.csv"), "utf8")).lignes;
    assert.deepEqual([lignes[0].chiffre_affaires, lignes[0].registre_date], ["", ""]);
    assert.equal(lignes[1].etat_registre, "C");
  } finally {
    dossier.supprimer();
  }
});

test("jusqu'au score : chiffre d'affaires et absence de publicité rapportent leurs points, cessée écartée, site non lu ni gain ni perte", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    ecrireBase(entree);
    const h = fausseHorloge(0);
    const reseau = fauxReseau({ registre: REGISTRE, sites: SITES }, h);
    await executer({ niche: niche(), entree, dossier: dossier.chemin, dependances: deps(reseau, h) });
    const n = niche();
    const r = await noter({ niche: n, entree: join(dossier.chemin, "base-enrichi.csv"), maintenant: MAINTENANT });
    assert.equal(r.compteurs.criteres.chiffre_affaires_etabli, 2, "352 000 € publiés pour les entreprises 1 et 3");
    assert.equal(r.compteurs.criteres.pas_de_pub_vue, 1, "seul le site 3, lu, n'a ni pixel ni balise ; le site 1 a un pixel, les autres ne sont pas lus");
    assert.equal(r.compteurs.criteres.cessee, 1, "l'entreprise cessée est écartée");
    const lignes = lireCsv(readFileSync(join(dossier.chemin, "base-enrichi-score.csv"), "utf8")).lignes;
    assert.deepEqual([lignes[1].score, lignes[1].tier, lignes[1].score_detail], ["0", "C", "cessee"]);
    assert.ok(!/Démo|example/.test(r.lignes.join("\n")));
  } finally {
    dossier.supprimer();
  }
});
