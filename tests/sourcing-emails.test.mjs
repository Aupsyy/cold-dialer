// Les e-mails publics lus sur les sites (scripts/sourcing/emails.mjs) : extraction (mailto, texte, masquage simple), choix (préfixes de
// la config, domaine du site, messageries, adresses de service), robots.txt, liens utiles, cadence d'une requête par seconde par
// domaine, User-Agent de la config, les garde-fous partagés avec le crawl des accroches (réseaux sociaux, adresses non publiques
// écrites ou atteintes par le DNS, redirections contrôlées à chaque saut, 1 Mo au plus), des pages hostiles lues en temps linéaire, et
// le script sur un CSV fictif. Aucun réseau : fetch et le DNS sont des faux, les sites sont en example.org (adresses de documentation).
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { jetonRobot } from "../scripts/accroches/lib/config.mjs";
import { creerControleHotes } from "../scripts/accroches/lib/hotes.mjs";
import { analyserRobots, cheminAutorise, reglesPour } from "../scripts/accroches/lib/robots.mjs";
import { lireCsv } from "../scripts/sourcing/csv.mjs";
import {
  chercherEmailSurSite,
  choisirEmail,
  executer,
  extraireEmails,
  liensUtiles,
  memeDomaine,
  texteDePage,
} from "../scripts/sourcing/emails.mjs";
import { creerCadence } from "../scripts/sourcing/lib.mjs";
import { dossierTemporaire, fausseHorloge, niche } from "./sourcing-outils.mjs";

const SITE = "atelier-demo-01.example.org";
const MESSAGERIES = ["messagerie.example"];
const avecPage = (liste, page = "https://atelier-demo-01.example.org/") => liste.map((t) => ({ ...t, page }));

test("extraction : mailto (avec sujet, plusieurs adresses), texte, entités ; rien dans les scripts", () => {
  const html = `
    <a href="mailto:Contact@${SITE}?subject=Devis">écrire</a>
    <a href='mailto:devis@${SITE},bonjour@${SITE}'>x</a>
    <p>Notre adresse : info&#64;${SITE}</p>
    <script>var piste = "suivi@${SITE}";</script>
    <img src="logo@2x.png">`;
  const emails = extraireEmails(html, { domaineSite: SITE }).map((t) => t.email);
  assert.deepEqual(emails, [`contact@${SITE}`, `devis@${SITE}`, `bonjour@${SITE}`, `info@${SITE}`]);
});

test("masquage simple ([at], (at), arobase, [dot], point) : accepté seulement pour le domaine du site", () => {
  const html = `<p>contact [at] atelier-demo-01 [dot] example [dot] org</p><p>devis(at)${SITE}</p>
    <p>bonjour arobase atelier-demo-01 point example point org</p><p>agence [at] example [dot] net</p>`;
  const trouves = extraireEmails(html, { domaineSite: SITE });
  assert.deepEqual(trouves.map((t) => t.email), [`contact@${SITE}`, `devis@${SITE}`, `bonjour@${SITE}`]);
  assert.ok(trouves.every((t) => t.masque));
});

test("choix : les préfixes de la config dans leur ordre, parmi les adresses TROUVÉES seulement", () => {
  const trouves = avecPage([{ email: `bonjour@${SITE}` }, { email: `jean.demo@${SITE}` }, { email: `contact@${SITE}` }]);
  assert.equal(choisirEmail(trouves, { domaineSite: SITE, prefixes: ["contact", "bonjour"], messageries: MESSAGERIES }).email, `contact@${SITE}`);
  assert.equal(choisirEmail(trouves, { domaineSite: SITE, prefixes: ["bonjour", "contact"], messageries: MESSAGERIES }).email, `bonjour@${SITE}`);
  const sansPrefixe = avecPage([{ email: `jean.demo@${SITE}` }]);
  assert.equal(choisirEmail(sansPrefixe, { domaineSite: SITE, prefixes: ["contact"], messageries: MESSAGERIES }).email, `jean.demo@${SITE}`, "rien n'est construit : pas de contact@ deviné");
  assert.equal(choisirEmail([], { domaineSite: SITE, prefixes: ["contact"], messageries: MESSAGERIES }), null);
});

test("choix : domaine du site avant messagerie ; jamais un autre domaine ; jamais une adresse de service", () => {
  const trouves = avecPage([
    { email: "atelier.demo01@messagerie.example" },
    { email: "studio@example.net" },
    { email: `rh@${SITE}` },
    { email: `ne-pas-repondre@${SITE}` },
    { email: `webmaster@${SITE}` },
    { email: `jean.demo@${SITE}` },
  ]);
  assert.equal(choisirEmail(trouves, { domaineSite: SITE, prefixes: [], messageries: MESSAGERIES }).email, `jean.demo@${SITE}`);
  const messagerieSeule = avecPage([{ email: "atelier.demo01@messagerie.example" }, { email: "studio@example.net" }]);
  assert.equal(choisirEmail(messagerieSeule, { domaineSite: SITE, prefixes: [], messageries: MESSAGERIES }).email, "atelier.demo01@messagerie.example");
  const autreDomaine = avecPage([{ email: "studio@example.net" }, { email: "contact@example.com" }]);
  assert.equal(choisirEmail(autreDomaine, { domaineSite: SITE, prefixes: ["contact"], messageries: MESSAGERIES }), null);
  const masqueMessagerie = avecPage([{ email: "atelier.demo01@messagerie.example", masque: true }]);
  assert.equal(choisirEmail(masqueMessagerie, { domaineSite: SITE, prefixes: [], messageries: MESSAGERIES }), null);
});

test("domaines : www ignoré, sous-domaine du site accepté, jamais le domaine parent (une plateforme d'hébergement)", () => {
  assert.equal(memeDomaine("www.example.org", "example.org"), true);
  assert.equal(memeDomaine("atelier-demo-01.example.org", "example.org"), true);
  assert.equal(memeDomaine("example.net", "example.org"), false);
  assert.equal(memeDomaine("", "example.org"), false);
  assert.equal(memeDomaine("plateforme.example", "atelier-demo-01.plateforme.example"), false, "le domaine parent est celui de la plateforme");
  const trouves = [{ email: "contact@plateforme.example", page: "https://atelier-demo-01.plateforme.example/" }];
  assert.equal(choisirEmail(trouves, { domaineSite: "atelier-demo-01.plateforme.example", prefixes: ["contact"], messageries: MESSAGERIES }), null);
});

test("robots.txt : le module partagé avec le crawl (scripts/accroches/lib/robots.mjs) ; le groupe qui nomme le robot avec sa version compte", () => {
  const regles = (texte, produit) => reglesPour(analyserRobots(texte), produit);
  const versionne = regles("User-agent: *\nAllow: /\n\nUser-agent: AtelierDemoBot/1.0\nDisallow: /\n", jetonRobot("AtelierDemoBot/1.0 (+https://example.org/robot)"));
  assert.equal(versionne.groupe, "specifique");
  assert.equal(cheminAutorise(versionne.regles, "/"), false, "« User-agent: AtelierDemoBot/1.0 » ferme le site à notre robot");
});

test("robots.txt : le groupe du robot l'emporte sur *, règle la plus longue, Allow à égalité, * et $, Crawl-delay", () => {
  const texte = [
    "# commentaire",
    "User-agent: *",
    "Disallow: /",
    "",
    "User-agent: AtelierDemoBot",
    "User-agent: AutreBot",
    "Disallow: /contact",
    "Allow: /contact/public",
    "Disallow: /*.php$",
    "Disallow:",
    "Crawl-delay: 2",
  ].join("\n");
  const r = reglesPour(analyserRobots(texte), jetonRobot("AtelierDemoBot/1.0 (+https://example.org/robot)"));
  const autorise = (regles, chemin) => cheminAutorise(regles.regles, chemin);
  assert.equal(autorise(r, "/"), true);
  assert.equal(autorise(r, "/contact"), false);
  assert.equal(autorise(r, "/contact-nous"), false);
  assert.equal(autorise(r, "/contact/public"), true);
  assert.equal(autorise(r, "/page.php"), false);
  assert.equal(autorise(r, "/page.php?x=1"), true, "$ : fin du chemin");
  assert.equal(r.delai, 2);
  const autre = reglesPour(analyserRobots(texte), "InconnuBot");
  assert.equal(autorise(autre, "/"), false, "les autres robots : le groupe *");
  assert.equal(autorise(reglesPour(analyserRobots(""), "AtelierDemoBot"), "/tout"), true);
  const egalite = reglesPour(analyserRobots("User-agent: *\nDisallow: /a\nAllow: /a"), "x");
  assert.equal(autorise(egalite, "/a"), true);
});

test("liens utiles : même site seulement, contact puis mentions puis à propos, ni fichiers ni mailto", () => {
  const html = `
    <a href="/a-propos">Qui sommes-nous</a>
    <a href="https://example.net/contact">Agence web</a>
    <a href="mentions-legales.html">Mentions légales</a>
    <a href="/nous-contacter#form">Nous écrire</a>
    <a href="/plaquette.pdf">Contact (PDF)</a>
    <a href="mailto:contact@${SITE}">contact</a>
    <a href="/realisations">Réalisations</a>`;
  assert.deepEqual(liensUtiles(html, `https://${SITE}/`, SITE), [
    `https://${SITE}/nous-contacter`,
    `https://${SITE}/mentions-legales.html`,
    `https://${SITE}/a-propos`,
  ]);
});

/** Une réponse HTTP, refaite à chaque requête (un vrai objet Response : le corps se lit en flux, comme sur le réseau). */
function reponse(corps, { status = 200, type = "text/html; charset=utf-8", redirection = null } = {}) {
  if (redirection) return () => new Response(null, { status: 301, headers: { location: redirection } });
  return () => new Response(corps, { status, headers: { "content-type": type } });
}

function fauxSite(pages, horloge) {
  const appels = [];
  const fetch = async (url, init) => {
    appels.push({ url, t: horloge.horloge(), ua: init.headers["User-Agent"], redirect: init.redirect });
    const page = pages[url];
    if (page === undefined) return reponse("introuvable", { status: 404, type: "text/plain" })();
    if (page instanceof Error) throw page;
    return page();
  };
  return { fetch, appels };
}

/** Un faux DNS : chaque nom mène à une adresse de documentation (publique pour le contrôle), sauf les pièges donnés. */
function fauxDns(pieges = {}) {
  const appels = [];
  const resoudre = async (hote) => {
    appels.push(hote);
    return [{ address: pieges[hote] ?? "203.0.113.20", family: 4 }];
  };
  return { resoudre, appels };
}

function contexte(fetch, horloge, prefixes = ["contact", "bonjour"], dns = fauxDns()) {
  return {
    fetch,
    patienter: creerCadence(1000, { horloge: horloge.horloge, attendre: horloge.attendre }),
    adresseSure: creerControleHotes({ resoudre: dns.resoudre }),
    userAgent: "AtelierDemoBot/1.0 (+https://example.org/robot)",
    jeton: "AtelierDemoBot",
    prefixes,
    messageries: MESSAGERIES,
    robots: new Map(),
    compteurs: { requetes: 0 },
  };
}

test("un site : robots.txt respecté (la page interdite n'est jamais demandée), source notée, User-Agent de la config, 1 req/s", async () => {
  const h = fausseHorloge(1_000_000);
  const base = `https://${SITE}`;
  const site = fauxSite(
    {
      [`${base}/robots.txt`]: reponse("User-agent: *\nDisallow: /contact\n", { type: "text/plain" }),
      [`${base}/`]: reponse(`<a href="/contact">Contact</a><a href="/mentions-legales">Mentions légales</a><p>Bienvenue</p>`),
      [`${base}/mentions-legales`]: reponse(`<p>Éditeur : Atelier Démo 01, bonjour@${SITE}</p>`),
      [`${base}/contact`]: reponse(`<p>contact@${SITE}</p>`),
    },
    h,
  );
  const r = await chercherEmailSurSite(`${base}/`, contexte(site.fetch, h));
  assert.deepEqual(r, { statut: "trouve", email: `bonjour@${SITE}`, source: `${base}/mentions-legales` });
  assert.ok(!site.appels.some((a) => a.url === `${base}/contact`), "robots.txt interdit /contact : jamais demandée");
  assert.ok(site.appels.every((a) => a.ua === "AtelierDemoBot/1.0 (+https://example.org/robot)"));
  for (let i = 1; i < site.appels.length; i++) assert.ok(site.appels[i].t - site.appels[i - 1].t >= 1000, "une requête par seconde au plus");
});

test("un site : Crawl-delay respecté ; robots.txt absent (404) = permis ; en erreur (500) = rien n'est lu", async () => {
  const h = fausseHorloge(0);
  const base = `https://${SITE}`;
  const lent = fauxSite(
    {
      [`${base}/robots.txt`]: reponse("User-agent: AtelierDemoBot\nCrawl-delay: 3\n", { type: "text/plain" }),
      [`${base}/`]: reponse(`<a href="/contact">Contact</a>`),
      [`${base}/contact`]: reponse(`<a href="mailto:contact@${SITE}">écrire</a>`),
    },
    h,
  );
  assert.equal((await chercherEmailSurSite(base, contexte(lent.fetch, h))).email, `contact@${SITE}`);
  assert.ok(lent.appels[2].t - lent.appels[1].t >= 3000, "Crawl-delay de 3 secondes");

  const sansRobots = fauxSite({ [`${base}/`]: reponse(`<p>contact@${SITE}</p>`) }, h);
  assert.equal((await chercherEmailSurSite(base, contexte(sansRobots.fetch, h))).statut, "trouve");

  const enPanne = fauxSite({ [`${base}/robots.txt`]: reponse("erreur", { status: 500, type: "text/plain" }), [`${base}/`]: reponse(`<p>contact@${SITE}</p>`) }, h);
  assert.equal((await chercherEmailSurSite(base, contexte(enPanne.fetch, h))).statut, "robots");
  assert.equal(enPanne.appels.length, 1, "seul robots.txt a été demandé");
});

test("un site : injoignable, pas une page web, redirigé vers un autre domaine, aucune adresse publiée", async () => {
  const h = fausseHorloge(0);
  const base = `https://${SITE}`;
  const panne = fauxSite({ [`${base}/`]: new Error("réseau") }, h);
  assert.equal((await chercherEmailSurSite(base, contexte(panne.fetch, h))).statut, "injoignable");
  const pdf = fauxSite({ [`${base}/`]: reponse("%PDF", { type: "application/pdf" }) }, h);
  assert.equal((await chercherEmailSurSite(base, contexte(pdf.fetch, h))).statut, "pas_html");
  const redirige = fauxSite({ [`${base}/`]: reponse("", { redirection: "https://example.net/page-demo" }) }, h);
  assert.equal((await chercherEmailSurSite(base, contexte(redirige.fetch, h))).statut, "redirige_ailleurs");
  assert.ok(!redirige.appels.some((a) => a.url.startsWith("https://example.net")), "l'autre domaine n'est jamais demandé");
  const muet = fauxSite({ [`${base}/`]: reponse("<p>Appelez-nous.</p>") }, h);
  assert.equal((await chercherEmailSurSite(base, contexte(muet.fetch, h))).statut, "aucun");
  assert.equal((await chercherEmailSurSite("pas un site", contexte(muet.fetch, h))).statut, "site_illisible");
});

test("le script : CSV fictif, e-mails ajoutés avec source et date, e-mail existant jamais remplacé, cache réutilisé, --essai n'écrit rien", async () => {
  const dossier = dossierTemporaire();
  try {
    const entree = join(dossier.chemin, "base.csv");
    writeFileSync(
      entree,
      [
        "entreprise;site;email",
        `Atelier Démo 01;https://${SITE}/;`,
        "Atelier Démo 02;https://atelier-demo-02.example.org;deja@atelier-demo-02.example.org",
        "Atelier Démo 03;;",
        "Atelier Démo 04;https://atelier-demo-04.example.org;",
      ].join("\n"),
    );
    const h = fausseHorloge(0);
    const site = fauxSite(
      {
        [`https://${SITE}/`]: reponse(`<footer><a href="mailto:contact@${SITE}">contact@${SITE}</a></footer>`),
        "https://atelier-demo-04.example.org/": reponse("<p>Rien ici.</p>"),
      },
      h,
    );
    const dependances = {
      fetch: site.fetch,
      resoudre: fauxDns().resoudre,
      attendre: h.attendre,
      horloge: h.horloge,
      maintenant: new Date("2026-11-09T09:00:00Z"),
      messageries: MESSAGERIES,
    };
    const essai = await executer({ niche: niche(), entree, dossier: dossier.chemin, essai: true, dependances });
    assert.equal(essai.compteurs.trouves, 1);
    assert.ok(!existsSync(join(dossier.chemin, "base-emails.csv")) && !existsSync(join(dossier.chemin, "cache", "emails.jsonl")), "--essai : ni CSV ni cache");

    const r = await executer({ niche: niche(), entree, dossier: dossier.chemin, dependances });
    assert.ok(!/Démo|example/.test(r.lignes.join("\n")), "le rapport ne cite aucune donnée");
    assert.deepEqual([r.compteurs.a_chercher, r.compteurs.trouves, r.compteurs.aucun], [2, 1, 1]);
    const lignes = lireCsv(readFileSync(join(dossier.chemin, "base-emails.csv"), "utf8")).lignes;
    assert.deepEqual([lignes[0].email, lignes[0].email_source, lignes[0].email_date], [`contact@${SITE}`, `https://${SITE}/`, "2026-11-09"]);
    assert.equal(lignes[1].email, "deja@atelier-demo-02.example.org");
    assert.equal(lignes[2].email, "");
    assert.equal(lignes[3].email, "");

    const appelsAvant = site.appels.length;
    const repris = await executer({ niche: niche(), entree, dossier: dossier.chemin, sortie: join(dossier.chemin, "relance.csv"), dependances });
    assert.equal(site.appels.length, appelsAvant, "les domaines déjà lus viennent du cache");
    assert.equal(repris.compteurs.repris_du_cache, 2);
    assert.equal(lireCsv(readFileSync(join(dossier.chemin, "relance.csv"), "utf8")).lignes[0].email, `contact@${SITE}`);
  } finally {
    dossier.supprimer();
  }
});

test("garde-fous du crawl : réseau social, LinkedIn, IP privée, métadonnées du cloud, port inhabituel : aucune requête", async () => {
  const h = fausseHorloge(0);
  const vide = fauxSite({}, h);
  for (const site of [
    "https://www.linkedin.com/company/atelier-demo",
    "https://fr-fr.facebook.com/atelierdemo",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "https://atelier-demo-03.example.org:8443/",
  ]) {
    assert.equal((await chercherEmailSurSite(site, contexte(vide.fetch, h))).statut, "hors_perimetre", site);
  }
  assert.equal((await chercherEmailSurSite("http://localhost/", contexte(vide.fetch, h))).statut, "site_illisible");
  assert.equal(vide.appels.length, 0);
});

test("redirections suivies à la main : l'accueil qui renvoie vers 127.0.0.1 ou un réseau social n'est jamais suivi ; robots.txt redirigé vers LinkedIn non plus", async () => {
  const h = fausseHorloge(0);
  const base = `https://${SITE}`;
  for (const cible of ["http://127.0.0.1:54321/", "https://www.facebook.com/atelierdemo", "http://[::1]/"]) {
    const piege = fauxSite({ [`${base}/`]: reponse("", { redirection: cible }) }, h);
    const r = await chercherEmailSurSite(`${base}/`, contexte(piege.fetch, h));
    assert.equal(r.statut, "redirige_ailleurs", cible);
    assert.deepEqual(piege.appels.map((a) => a.url), [`${base}/robots.txt`, `${base}/`], "robots.txt et l'accueil, rien d'autre");
    assert.ok(piege.appels.every((a) => a.redirect === "manual"));
  }
  const robotsPiege = fauxSite({ [`${base}/robots.txt`]: reponse("", { redirection: "https://www.linkedin.com/robots.txt" }), [`${base}/`]: reponse(`<p>contact@${SITE}</p>`) }, h);
  assert.equal((await chercherEmailSurSite(`${base}/`, contexte(robotsPiege.fetch, h))).statut, "robots");
  assert.ok(!robotsPiege.appels.some((a) => a.url.includes("linkedin")), "jamais une requête vers LinkedIn");
});

test("DNS : un nom public qui mène à une adresse interne n'est jamais demandé (le site, ni une redirection)", async () => {
  const h = fausseHorloge(0);
  const base = `https://${SITE}`;
  const site = fauxSite({ [`${base}/`]: reponse(`<p>contact@${SITE}</p>`) }, h);
  const interne = fauxDns({ [SITE]: "10.0.0.5" });
  assert.equal((await chercherEmailSurSite(`${base}/`, contexte(site.fetch, h, ["contact"], interne))).statut, "injoignable");
  assert.equal(site.appels.length, 0);
  const sous = `interne.${SITE}`;
  const redirige = fauxSite({ [`${base}/`]: reponse("", { redirection: `https://${sous}/` }), [`https://${sous}/`]: reponse(`<p>contact@${SITE}</p>`) }, h);
  const dns = fauxDns({ [sous]: "127.0.0.1" });
  assert.equal((await chercherEmailSurSite(`${base}/`, contexte(redirige.fetch, h, ["contact"], dns))).statut, "injoignable");
  assert.ok(!redirige.appels.some((a) => a.url.includes(sous)));
});

test("robots.txt qui ferme le site à notre robot nommé avec sa version : seul robots.txt est demandé ; 429 aussi ferme le site", async () => {
  const h = fausseHorloge(0);
  const base = `https://${SITE}`;
  const ferme = fauxSite({ [`${base}/robots.txt`]: reponse("User-agent: AtelierDemoBot/1.0\nDisallow: /\n", { type: "text/plain" }), [`${base}/`]: reponse(`<p>contact@${SITE}</p>`) }, h);
  assert.equal((await chercherEmailSurSite(`${base}/`, contexte(ferme.fetch, h))).statut, "robots");
  assert.deepEqual(ferme.appels.map((a) => a.url), [`${base}/robots.txt`]);
  const tropVite = fauxSite({ [`${base}/robots.txt`]: reponse("attendez", { status: 429, type: "text/plain" }), [`${base}/`]: reponse(`<p>contact@${SITE}</p>`) }, h);
  assert.equal((await chercherEmailSurSite(`${base}/`, contexte(tropVite.fetch, h))).statut, "robots");
  assert.equal(tropVite.appels.length, 1);
});

test("1 Mo au plus par page : une page de 5 Mo est lue en flux et la lecture s'arrête au premier Mo", async () => {
  const h = fausseHorloge(0);
  const base = `https://${SITE}`;
  let tires = 0;
  const lourde = () =>
    new Response(
      new ReadableStream({
        pull(c) {
          if (tires >= 5_000_000) return c.close();
          const morceau = new TextEncoder().encode(`<p>${"a".repeat(65_000)}</p>\n`);
          tires += morceau.length;
          c.enqueue(morceau);
        },
      }),
      { headers: { "content-type": "text/html" } },
    );
  const site = fauxSite({ [`${base}/`]: lourde }, h);
  assert.equal((await chercherEmailSurSite(`${base}/`, contexte(site.fetch, h))).statut, "aucun");
  assert.ok(tires < 1_300_000, `octets tirés : ${tires} (1 Mo, plus le morceau déjà en route)`);
});

test("pages hostiles lues en temps linéaire : 50 000 liens jamais fermés, scripts et commentaires jamais fermés, une page de « < »", () => {
  const base = `https://${SITE}/`;
  let debut = performance.now();
  assert.deepEqual(liensUtiles('<a href="/contact">'.repeat(50_000), base, SITE), []);
  assert.ok(performance.now() - debut < 200, `liens : ${performance.now() - debut} ms`);
  debut = performance.now();
  texteDePage("<script>".repeat(100_000));
  texteDePage("<!--".repeat(200_000));
  texteDePage("<".repeat(1_000_000));
  assert.deepEqual(extraireEmails(`<style>x${"<a".repeat(100_000)}`, { domaineSite: SITE }), []);
  assert.ok(performance.now() - debut < 500, `texte : ${performance.now() - debut} ms`);
  assert.equal(texteDePage(`<p>avant</p><script>var x = "suivi@${SITE}";`), " avant ", "un script jamais fermé ne laisse rien passer");
});
