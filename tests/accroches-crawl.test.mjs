// Accroches, le crawl, sans réseau : un faux web (fetch injecté) et une horloge virtuelle (aucune vraie attente). On vérifie : robots.txt
// lu et respecté, accueil puis pages probables (6 au plus), 1 requête par seconde par domaine (et Crawl-delay), délai d'attente, 1 Mo
// au plus, HTTPS puis HTTP, User-Agent de la config, adresses non publiques refusées (écrites, ou atteintes par le DNS : un faux résolveur
// répond), ports 80 et 443 seulement, reprise sans relire. Sites fictifs (example.org) ; adresses de documentation (203.0.113.0/24).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { crawler, crawlerSite, creerContexte, hoteExclu, lienExclu, principal } from "../scripts/accroches/crawl.mjs";
import { ipPublique } from "../scripts/accroches/lib/hotes.mjs";
import { RACINE } from "./aides.mjs";

const UA = "AtelierDemoBot/1.0 (+https://example.org/robot)";
const INDICES = ["terrasse", "bassin", "potager"];

/** Une horloge virtuelle : quand tout le monde attend, le temps saute à la prochaine échéance. */
function horlogeVirtuelle(debut = Date.parse("2026-11-02T09:00:00Z")) {
  let t = debut;
  const attentes = [];
  let prevu = false;
  const avancer = () => {
    prevu = false;
    if (attentes.length === 0) return;
    attentes.sort((a, b) => a.echeance - b.echeance);
    const prochaine = attentes.shift();
    t = Math.max(t, prochaine.echeance);
    prochaine.resoudre();
    planifier();
  };
  const planifier = () => {
    if (!prevu && attentes.length > 0) {
      prevu = true;
      setImmediate(avancer);
    }
  };
  return {
    debut,
    maintenant: () => t,
    attendre: (ms) =>
      new Promise((resoudre) => {
        attentes.push({ echeance: t + ms, resoudre });
        planifier();
      }),
  };
}

/** Un faux web : adresse → réponse ; « reseau » simule un serveur injoignable ; 404 par défaut. */
function fauxWeb(routes, horloge) {
  const appels = [];
  const fetch = async (url, init) => {
    appels.push({ url, t: horloge.maintenant(), ua: init.headers["User-Agent"], redirect: init.redirect });
    const r = routes[url];
    if (r === undefined) return new Response("<p>introuvable</p>", { status: 404, headers: { "content-type": "text/html" } });
    if (r === "reseau") throw new TypeError("fetch failed");
    if (typeof r === "function") return r(url, init);
    if (r.redirection) return new Response(null, { status: 301, headers: { location: r.redirection } });
    return new Response(r.corps ?? "", { status: r.statut ?? 200, headers: { "content-type": r.type ?? "text/html; charset=utf-8" } });
  };
  return { fetch, appels };
}

function page(titre, corps, liens = []) {
  const menu = liens.map(([href, texte]) => `<a href="${href}">${texte}</a>`).join(" ");
  return { corps: `<html><head><title>${titre}</title></head><body><nav>${menu}</nav><main>${corps}</main></body></html>` };
}

const texte = (corps) => ({ corps, type: "text/plain" });

/** Un faux DNS : chaque nom mène à une adresse de documentation (publique pour le contrôle), sauf les pièges donnés. */
function fauxDns(pieges = {}) {
  const appels = [];
  const resoudre = async (hote) => {
    appels.push(hote);
    if (pieges[hote] instanceof Error) throw pieges[hote];
    return [{ address: pieges[hote] ?? "203.0.113.10", family: String(pieges[hote] ?? "").includes(":") ? 6 : 4 }];
  };
  return { resoudre, appels };
}

function contexte(fetch, horloge, plus = {}) {
  return creerContexte({ userAgent: UA, motsIndices: INDICES, fetch, horloge, resoudre: fauxDns().resoudre, ...plus });
}

function ecartsMin(appels, hote) {
  const temps = appels.filter((a) => new URL(a.url).hostname.replace(/^www\./, "") === hote).map((a) => a.t);
  let min = Infinity;
  for (let i = 1; i < temps.length; i++) min = Math.min(min, temps[i] - temps[i - 1]);
  return { min, nombre: temps.length };
}

const S1 = "https://atelier-demo-01.example.org";
const SITE_1 = {
  [`${S1}/robots.txt`]: texte("User-agent: *\nDisallow: /prive/\n"),
  [`${S1}/`]: page("Atelier Démo 01", "<p>Paysagiste fictif.</p>", [
    ["/realisations", "Nos réalisations"],
    ["/realisations/bassin-naturel", "Bassin naturel"],
    ["/realisations/jardin-sec", "Jardin sec"],
    ["/a-propos", "À propos"],
    ["/equipe", "Notre équipe"],
    ["/contact", "Contact"],
    ["/prive/chantiers", "Nos chantiers secrets"],
    ["/mentions-legales", "Mentions légales"],
    ["/cgv", "CGV"],
    ["/photos/terrasse.jpg", "Photo"],
    ["/en/home", "English"],
    ["https://example.net/ailleurs", "Ailleurs"],
    ["/blog/article-1", "Un article"],
  ]),
  [`${S1}/realisations`]: page("Réalisations", "<p>Nos jardins.</p>", [
    ["/realisations/potager-urbain", "Potager urbain"],
    ["/realisations/jardin-sec", "Jardin sec"],
  ]),
  [`${S1}/realisations/bassin-naturel`]: page("Bassin naturel", "<p>Création d'un bassin naturel à Vienne en 2019.</p>"),
  [`${S1}/realisations/potager-urbain`]: page("Potager urbain", "<p>Un potager en carrés sur un toit de Bron.</p>"),
  [`${S1}/realisations/jardin-sec`]: page("Jardin sec", "<p>Jardin sec et graminées.</p>"),
  [`${S1}/a-propos`]: page("À propos", "<p>Entreprise familiale fondée en 2009.</p>"),
  [`${S1}/equipe`]: page("Équipe", "<p>Trois jardiniers.</p>"),
  [`${S1}/contact`]: page("Contact", "<p>Écrivez-nous.</p>"),
  [`${S1}/prive/chantiers`]: page("Privé", "<p>Ne doit jamais être lu.</p>"),
};

test("accueil puis pages probables : 6 pages au plus, la page de réalisations ouvre ses fiches, robots.txt respecté", async () => {
  const horloge = horlogeVirtuelle();
  const web = fauxWeb(SITE_1, horloge);
  const r = await crawlerSite({ id: "f1", site: `${S1}/` }, contexte(web.fetch, horloge));
  assert.equal(r.erreur, undefined);
  assert.deepEqual(
    web.appels.map((a) => a.url.replace(S1, "")),
    ["/robots.txt", "/", "/realisations/bassin-naturel", "/realisations", "/realisations/potager-urbain", "/realisations/jardin-sec", "/a-propos"],
  );
  assert.equal(r.pages.length, 6);
  assert.equal(r.compteurs.refusRobots, 1);
  for (const jamais of ["/prive/chantiers", "/mentions-legales", "/cgv", "/photos/terrasse.jpg", "/en/home", "/blog/article-1"]) {
    assert.ok(!web.appels.some((a) => a.url === `${S1}${jamais}`), `ne devait pas être lu : ${jamais}`);
  }
  assert.ok(!web.appels.some((a) => a.url.startsWith("https://example.net")));
  assert.ok(web.appels.every((a) => a.ua === UA && a.redirect === "manual"));
  const bassin = r.pages.find((p) => p.url.endsWith("/bassin-naturel"));
  assert.ok(bassin.texte.includes("Création d'un bassin naturel à Vienne en 2019."));
  assert.equal(bassin.lu_le, new Date(web.appels[2].t).toISOString());
});

test("cadence : une requête par seconde au plus sur le domaine", async () => {
  const horloge = horlogeVirtuelle();
  const web = fauxWeb(SITE_1, horloge);
  await crawlerSite({ id: "f1", site: `${S1}/` }, contexte(web.fetch, horloge));
  const { min, nombre } = ecartsMin(web.appels, "atelier-demo-01.example.org");
  assert.equal(nombre, 7);
  assert.ok(min >= 1000, `écart minimal ${min} ms`);
});

test("cadence partagée : deux fiches du même domaine lues en parallèle restent à 1 requête par seconde", async () => {
  const horloge = horlogeVirtuelle();
  const S = "https://atelier-demo-02.example.org";
  const routes = {
    [`${S}/robots.txt`]: texte(""),
    [`${S}/`]: page("Accueil", "<p>Site fictif.</p>", [["/realisations", "Réalisations"]]),
    [`${S}/agence-2`]: page("Agence 2", "<p>Seconde agence fictive.</p>", [["/realisations", "Réalisations"]]),
    [`${S}/realisations`]: page("Réalisations", "<p>Un bassin.</p>"),
    "https://atelier-demo-03.example.org/robots.txt": texte(""),
    "https://atelier-demo-03.example.org/": page("Accueil 3", "<p>Autre site fictif.</p>"),
  };
  const web = fauxWeb(routes, horloge);
  const dossier = mkdtempSync(join(tmpdir(), "accroches-crawl-"));
  try {
    const bilan = await crawler(
      [
        { id: "a", site: `${S}/` },
        { id: "b", site: `${S}/agence-2` },
        { id: "c", site: "https://atelier-demo-03.example.org/" },
      ],
      contexte(web.fetch, horloge),
      { sortie: join(dossier, "crawl.jsonl"), paralleles: 3 },
    );
    assert.equal(bilan.lus, 3);
    const { min, nombre } = ecartsMin(web.appels, "atelier-demo-02.example.org");
    assert.ok(nombre >= 5);
    assert.ok(min >= 1000, `écart minimal ${min} ms`);
    // Un autre domaine n'attend pas son tour derrière le premier.
    const premier3 = web.appels.find((a) => a.url.startsWith("https://atelier-demo-03")).t;
    assert.equal(premier3, horloge.debut);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("robots.txt d'un hôte partagé par plusieurs fiches : lu une seule fois par passage", async () => {
  const horloge = horlogeVirtuelle();
  const S = "https://atelier-demo-13.example.org";
  const routes = {
    [`${S}/robots.txt`]: texte("User-agent: *\nDisallow: /prive\n"),
    [`${S}/agence-a`]: page("Agence A", "<p>Fictive.</p>"),
    [`${S}/agence-b`]: page("Agence B", "<p>Fictive.</p>"),
  };
  const web = fauxWeb(routes, horloge);
  const ctx = contexte(web.fetch, horloge);
  await crawlerSite({ id: "a", site: `${S}/agence-a` }, ctx);
  await crawlerSite({ id: "b", site: `${S}/agence-b` }, ctx);
  assert.equal(web.appels.filter((a) => a.url.endsWith("/robots.txt")).length, 1);
});

test("robots.txt : le groupe de notre robot l'emporte sur « * » (ici « * » ferme tout, notre groupe ferme /equipe)", async () => {
  const horloge = horlogeVirtuelle();
  const routes = {
    ...SITE_1,
    [`${S1}/robots.txt`]: texte("User-agent: *\nDisallow: /\n\nUser-agent: AtelierDemoBot\nDisallow: /equipe\n"),
  };
  const web = fauxWeb(routes, horloge);
  const r = await crawlerSite({ id: "f1", site: `${S1}/` }, contexte(web.fetch, horloge, { maxPages: 6 }));
  assert.equal(r.erreur, undefined);
  assert.equal(r.robots.groupe, "specifique");
  assert.ok(!web.appels.some((a) => a.url === `${S1}/equipe`));
  assert.ok(web.appels.some((a) => a.url === `${S1}/prive/chantiers`), "notre groupe n'interdit pas /prive/");
});

test("robots.txt qui ferme tout à notre robot : rien d'autre n'est lu", async () => {
  const horloge = horlogeVirtuelle();
  const web = fauxWeb({ ...SITE_1, [`${S1}/robots.txt`]: texte("User-agent: AtelierDemoBot\nDisallow: /\n") }, horloge);
  const r = await crawlerSite({ id: "f1", site: `${S1}/` }, contexte(web.fetch, horloge));
  assert.equal(r.erreur, "robots_interdit");
  assert.equal(web.appels.length, 1);
});

test("robots.txt en panne (5xx) : site laissé de côté ; absent (404) : tout est permis", async () => {
  const horloge = horlogeVirtuelle();
  const panne = fauxWeb({ ...SITE_1, [`${S1}/robots.txt`]: { statut: 503, corps: "panne" } }, horloge);
  const r1 = await crawlerSite({ id: "f1", site: `${S1}/` }, contexte(panne.fetch, horloge));
  assert.equal(r1.erreur, "robots_indisponible");
  assert.equal(panne.appels.length, 1);

  const routes = { ...SITE_1 };
  delete routes[`${S1}/robots.txt`];
  const absent = fauxWeb(routes, horloge);
  const r2 = await crawlerSite({ id: "f1", site: `${S1}/` }, contexte(absent.fetch, horloge));
  assert.equal(r2.erreur, undefined);
  assert.equal(r2.robots.etat, "absent");
  assert.ok(absent.appels.some((a) => a.url === `${S1}/prive/chantiers`));
});

test("Crawl-delay de robots.txt : les requêtes s'espacent d'autant (3 s ici)", async () => {
  const horloge = horlogeVirtuelle();
  const web = fauxWeb({ ...SITE_1, [`${S1}/robots.txt`]: texte("User-agent: *\nCrawl-delay: 3\n") }, horloge);
  await crawlerSite({ id: "f1", site: `${S1}/` }, contexte(web.fetch, horloge));
  const { min } = ecartsMin(web.appels, "atelier-demo-01.example.org");
  assert.ok(min >= 3000, `écart minimal ${min} ms`);
});

test("HTTPS d'abord, HTTP si le site ne répond pas en HTTPS", async () => {
  const horloge = horlogeVirtuelle();
  const S = "atelier-demo-06.example.org";
  const web = fauxWeb(
    {
      [`https://${S}/robots.txt`]: "reseau",
      [`https://${S}/`]: "reseau",
      [`http://${S}/robots.txt`]: texte(""),
      [`http://${S}/`]: page("Accueil", "<p>Site seulement en HTTP.</p>"),
    },
    horloge,
  );
  const r = await crawlerSite({ id: "f6", site: `http://${S}/` }, contexte(web.fetch, horloge));
  assert.equal(r.erreur, undefined);
  assert.equal(web.appels[0].url, `https://${S}/robots.txt`);
  assert.equal(r.origine, `http://${S}`);
  assert.ok(r.pages[0].url.startsWith("http://"));
});

test("délai d'attente : une page qui ne répond pas est abandonnée", async () => {
  const horloge = horlogeVirtuelle();
  const S = "https://atelier-demo-07.example.org";
  const bloque = (url, init) =>
    new Promise((_, rejeter) => init.signal.addEventListener("abort", () => rejeter(new DOMException("arrêt", "AbortError"))));
  const web = fauxWeb({ [`${S}/robots.txt`]: texte(""), [`${S}/`]: bloque }, horloge);
  const r = await crawlerSite({ id: "f7", site: `${S}/` }, contexte(web.fetch, horloge, { delaiMs: 40 }));
  assert.equal(r.erreur, "accueil_delai");
});

test("1 Mo au plus par page : la lecture s'arrête et la page est marquée tronquée", async () => {
  const horloge = horlogeVirtuelle();
  const S = "https://atelier-demo-08.example.org";
  let tires = 0;
  const lourde = () =>
    new Response(
      new ReadableStream({
        pull(c) {
          if (tires >= 3_000_000) return c.close();
          const morceau = new TextEncoder().encode(`<p>${"a".repeat(65_000)} jardin.</p>\n`);
          tires += morceau.length;
          c.enqueue(morceau);
        },
      }),
      { headers: { "content-type": "text/html" } },
    );
  const web = fauxWeb({ [`${S}/robots.txt`]: texte(""), [`${S}/`]: lourde }, horloge);
  const r = await crawlerSite({ id: "f8", site: `${S}/` }, contexte(web.fetch, horloge));
  assert.equal(r.erreur, undefined);
  assert.equal(r.pages[0].tronquee, true);
  assert.ok(tires < 1_300_000, `octets tirés : ${tires}`);
  assert.ok(r.pages[0].texte.length <= 15_000);
});

test("l'accueil qui redirige vers « www » : le robots.txt de la nouvelle origine est lu et respecté", async () => {
  const horloge = horlogeVirtuelle();
  const S = "atelier-demo-09.example.org";
  const web = fauxWeb(
    {
      [`https://${S}/robots.txt`]: { statut: 404 },
      [`https://${S}/`]: { redirection: `https://www.${S}/` },
      [`https://www.${S}/robots.txt`]: texte("User-agent: *\nDisallow: /a-propos\n"),
      [`https://www.${S}/`]: page("Accueil", "<p>Site fictif.</p>", [["/a-propos", "À propos"], ["/realisations", "Réalisations"]]),
      [`https://www.${S}/realisations`]: page("Réalisations", "<p>Une terrasse.</p>"),
    },
    horloge,
  );
  const r = await crawlerSite({ id: "f9", site: `https://${S}/` }, contexte(web.fetch, horloge));
  assert.equal(r.origine, `https://www.${S}`);
  assert.ok(web.appels.some((a) => a.url === `https://www.${S}/robots.txt`));
  assert.ok(!web.appels.some((a) => a.url.endsWith("/a-propos")));
  assert.deepEqual(
    r.pages.map((p) => p.url),
    [`https://www.${S}/`, `https://www.${S}/realisations`],
  );
});

test("adresses non publiques (IP, localhost, réseau local), réseaux sociaux et annuaires : refusés sans aucune requête", async () => {
  const horloge = horlogeVirtuelle();
  const web = fauxWeb({}, horloge);
  for (const site of ["http://127.0.0.1:8080/", "http://localhost/", "https://intranet.local/", "http://10.0.0.1/", "pas une adresse"]) {
    const r = await crawlerSite({ id: "x", site }, contexte(web.fetch, horloge));
    assert.equal(r.erreur, "adresse_invalide", site);
  }
  assert.equal(web.appels.length, 0);
  // Une redirection (robots.txt ou accueil) vers une adresse interne n'est jamais suivie.
  const S = "https://atelier-demo-12.example.org";
  const piege = fauxWeb({ [`${S}/robots.txt`]: { redirection: "http://127.0.0.1/robots.txt" } }, horloge);
  assert.equal((await crawlerSite({ id: "x", site: `${S}/` }, contexte(piege.fetch, horloge))).erreur, "robots_indisponible");
  const piege2 = fauxWeb({ [`${S}/robots.txt`]: texte(""), [`${S}/`]: { redirection: "http://192.168.1.10/" } }, horloge);
  assert.equal((await crawlerSite({ id: "x", site: `${S}/` }, contexte(piege2.fetch, horloge))).erreur, "accueil_hors_site");
  assert.ok(![...piege.appels, ...piege2.appels].some((a) => /127\.0\.0\.1|192\.168/.test(a.url)));
  // Un réseau social, un annuaire ou une carte n'est pas le site de l'entreprise : jamais lu (jamais LinkedIn).
  for (const site of ["https://www.linkedin.com/company/atelier-demo", "https://fr-fr.facebook.com/atelierdemo", "https://www.pagesjaunes.fr/pros/0", "https://maps.app.goo.gl/x", "https://www.google.com/maps/place/x"]) {
    assert.equal((await crawlerSite({ id: "x", site }, contexte(web.fetch, horloge))).erreur, "site_hors_perimetre", site);
  }
  assert.equal(web.appels.length, 0);
  assert.ok(!hoteExclu("sites.google.com") && !hoteExclu("atelier-demo.example.org") && hoteExclu("lnkd.in"));
  assert.ok(lienExclu("https://example.org/politique-de-confidentialite"));
  assert.ok(lienExclu("https://example.org/wp-login.php"));
  assert.ok(!lienExclu("https://example.org/nos-realisations"));
});

test("reprise : un second passage ne relit aucun site ; --refaire-erreurs relit seulement ceux en erreur", async () => {
  const horloge = horlogeVirtuelle();
  const dossier = mkdtempSync(join(tmpdir(), "accroches-reprise-"));
  const S2 = "https://atelier-demo-10.example.org";
  const routes = { ...SITE_1, [`${S2}/robots.txt`]: { statut: 503 } };
  const journal = [];
  const options = (web) => ({ fetch: web.fetch, horloge, resoudre: fauxDns().resoudre, journal: (l) => journal.push(l) });
  const argv = ["--dossier", dossier, "--config", fileURLToPath(new URL("config/niche.exemple.json", RACINE))];
  try {
    writeFileSync(join(dossier, "a-crawler.json"), JSON.stringify([
      { id: "f1", entreprise: "Atelier Démo 01", site: `${S1}/` },
      { id: "f2", entreprise: "Atelier Démo 10", site: `${S2}/` },
    ]));
    const premier = fauxWeb(routes, horloge);
    assert.equal(await principal(argv, options(premier)), 0);
    assert.ok(premier.appels.length > 2);
    const lignes = () => readFileSync(join(dossier, "crawl.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lignes().length, 2);

    const second = fauxWeb(routes, horloge);
    assert.equal(await principal(argv, options(second)), 0);
    assert.equal(second.appels.length, 0);
    assert.equal(lignes().length, 2);

    const troisieme = fauxWeb(routes, horloge);
    assert.equal(await principal([...argv, "--refaire-erreurs"], options(troisieme)), 0);
    assert.ok(troisieme.appels.every((a) => a.url.startsWith(S2)));
    assert.equal(lignes().length, 3);
    // La console : des compteurs, jamais une adresse ni un nom.
    assert.ok(journal.every((l) => !/example\.org|Atelier Démo/.test(l)), journal.join("\n"));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("DNS : un nom public qui mène à une adresse interne n'est jamais lu (le site, ni une redirection de l'accueil)", async () => {
  const horloge = horlogeVirtuelle();
  const S = "atelier-demo-14.example.org";
  const piege = fauxDns({ [S]: "127.0.0.1" });
  const web = fauxWeb({ [`https://${S}/robots.txt`]: texte(""), [`https://${S}/`]: page("Accueil", "<p>Fictif.</p>") }, horloge);
  const r = await crawlerSite({ id: "x", site: `https://${S}/` }, contexte(web.fetch, horloge, { resoudre: piege.resoudre }));
  assert.equal(r.erreur, "adresse_non_publique");
  assert.equal(web.appels.length, 0, "aucune requête");
  assert.deepEqual(piege.appels, [S], "un nom n'est résolu qu'une fois");

  const R = "atelier-demo-15.example.org";
  const interne = "interne-demo.example.org";
  const dns = fauxDns({ [interne]: "10.0.0.5" });
  const redirige = fauxWeb(
    {
      [`https://${R}/robots.txt`]: texte(""),
      [`https://${R}/`]: { redirection: `https://${interne}/` },
      [`https://${interne}/robots.txt`]: texte(""),
      [`https://${interne}/`]: page("Interne", "<p>Ne doit jamais être lu.</p>"),
    },
    horloge,
  );
  const r2 = await crawlerSite({ id: "y", site: `https://${R}/` }, contexte(redirige.fetch, horloge, { resoudre: dns.resoudre }));
  assert.ok(r2.erreur, "accueil non lu");
  assert.ok(!redirige.appels.some((a) => a.url.includes(interne)), "aucune requête vers l'hôte interne");

  const perdu = fauxDns({ [S]: new Error("ENOTFOUND") });
  const r3 = await crawlerSite({ id: "z", site: `https://${S}/` }, contexte(web.fetch, horloge, { resoudre: perdu.resoudre }));
  assert.equal(r3.erreur, "adresse_non_publique", "un nom qui ne se résout pas : rien n'est demandé");
  assert.equal(web.appels.length, 0);
});

test("adresses IP : publiques seulement (bouclage, privé, lien local, CGNAT, ULA, IPv4 dans IPv6, NAT64, 6to4 refusés)", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::", "::1", "fe80::1", "fd00::1", "fc00::5", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "pas une adresse", ""]) {
    assert.equal(ipPublique(ip), false, ip);
  }
  for (const ip of ["203.0.113.10", "198.51.100.7", "172.32.0.1", "100.128.0.1", "2001:db8::1", "::ffff:203.0.113.10"]) {
    assert.equal(ipPublique(ip), true, ip);
  }
});

test("ports 80 et 443 seulement ; robots.txt redirigé vers un réseau social, ou en 429 : site laissé de côté sans le suivre", async () => {
  const horloge = horlogeVirtuelle();
  const vide = fauxWeb({}, horloge);
  for (const site of ["https://atelier-demo-16.example.org:8443/", "http://atelier-demo-16.example.org:22/"]) {
    assert.equal((await crawlerSite({ id: "p", site }, contexte(vide.fetch, horloge))).erreur, "adresse_invalide", site);
  }
  assert.equal(vide.appels.length, 0);

  const S = "https://atelier-demo-17.example.org";
  const versReseau = fauxWeb({ [`${S}/robots.txt`]: { redirection: "https://www.linkedin.com/robots.txt" }, [`${S}/`]: page("A", "<p>x</p>") }, horloge);
  assert.equal((await crawlerSite({ id: "l", site: `${S}/` }, contexte(versReseau.fetch, horloge))).erreur, "robots_indisponible");
  assert.ok(!versReseau.appels.some((a) => a.url.includes("linkedin")), "jamais une requête vers LinkedIn");
  assert.equal(versReseau.appels.length, 1);

  const tropVite = fauxWeb({ [`${S}/robots.txt`]: { statut: 429, corps: "attendez" }, [`${S}/`]: page("A", "<p>x</p>") }, horloge);
  assert.equal((await crawlerSite({ id: "t", site: `${S}/` }, contexte(tropVite.fetch, horloge))).erreur, "robots_indisponible");
  assert.equal(tropVite.appels.length, 1, "un robots.txt en 429 ferme le site");

  for (const site of ["https://instagr.am/atelierdemo", "https://fb.watch/x", "https://m.me/atelierdemo", "https://t.co/x"]) {
    assert.equal((await crawlerSite({ id: "s", site }, contexte(vide.fetch, horloge))).erreur, "site_hors_perimetre", site);
  }
  assert.equal(vide.appels.length, 0);
});
