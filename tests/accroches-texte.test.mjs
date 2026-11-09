// Accroches, le texte : HTML → texte propre (scripts, styles, menus, pieds de page retirés ; entités décodées ; espaces normalisés),
// normalisation (accents, casse, apostrophes), familles de mots, phrases. Tout est fictif.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyserHtml,
  balisesOuvrantes,
  contientPassage,
  decouperPhrases,
  decoderEntites,
  elementsFermes,
  memeFamille,
  mots,
  normaliser,
  remplacerBalises,
} from "../scripts/accroches/lib/texte.mjs";

const PAGE = `<!doctype html><html><head><title>Atelier Démo 01 &ndash; Paysagiste à Vienne</title>
<meta name="description" content="Création de jardins &amp; terrasses en bois.">
<style>.bandeau { color: red }</style><script>var cache = "ne doit jamais sortir";</script></head>
<body><nav><a href="/realisations">Nos réalisations</a> <a href="/a-propos/">À propos</a></nav>
<header><h1>Atelier Démo 01</h1></header>
<main><h2 class="titre">Nos   jardins</h2>
<p>Entreprise fondée en 2009,&nbsp;spécialisée dans les <strong>bassins naturels</strong>.</p>
<p>Terrasse en bois réalisée à Bron.<br>Massif de graminées.</p>
<!-- un commentaire caché --><noscript>Activez JavaScript</noscript>
<ul><li>Élagage</li><li>Entretien à l&#39;année</li></ul>
<form><label>Votre e-mail</label><button>Envoyer</button></form></main>
<footer>Tous droits réservés. <a href="/mentions-legales">Mentions légales</a></footer>
<a href="mailto:contact@example.com">Écrire</a><a href="tel:+33199000001">Appeler</a><a href="https://example.net/ailleurs#haut">Ailleurs</a>
<a href="javascript:void(0)">Rien</a></body></html>`;

test("HTML → texte : scripts, styles, menu, pied de page, formulaire et commentaires retirés", () => {
  const p = analyserHtml(PAGE, "https://atelier-demo-01.example.org/");
  for (const absent of ["ne doit jamais sortir", "color", "Nos réalisations", "Tous droits réservés", "commentaire caché", "Activez", "Envoyer", "Votre e-mail"]) {
    assert.ok(!p.texte.includes(absent), `ne devrait pas rester : ${absent}`);
  }
});

test("HTML → texte : entités décodées, espaces normalisés, un bloc par ligne", () => {
  const p = analyserHtml(PAGE, "https://atelier-demo-01.example.org/");
  assert.equal(p.titre, "Atelier Démo 01 – Paysagiste à Vienne");
  assert.equal(p.description, "Création de jardins & terrasses en bois.");
  const lignes = p.texte.split("\n");
  assert.ok(lignes.includes("Entreprise fondée en 2009, spécialisée dans les bassins naturels."), p.texte);
  assert.ok(lignes.includes("Terrasse en bois réalisée à Bron."));
  assert.ok(lignes.includes("Massif de graminées."));
  assert.ok(lignes.includes("Entretien à l'année"));
  assert.ok(lignes.includes("Nos jardins"));
  assert.ok(!/ {2}|\t| /.test(p.texte));
  assert.deepEqual(p.titres, ["Atelier Démo 01", "Nos jardins"]);
});

test("HTML → liens : ceux du menu compris, adresses absolues sans ancre, jamais mailto, tel ni javascript", () => {
  const p = analyserHtml(PAGE, "https://atelier-demo-01.example.org/");
  const urls = p.liens.map((l) => l.url);
  assert.ok(urls.includes("https://atelier-demo-01.example.org/realisations"));
  assert.ok(urls.includes("https://atelier-demo-01.example.org/a-propos/"));
  assert.ok(urls.includes("https://atelier-demo-01.example.org/mentions-legales"));
  assert.ok(urls.includes("https://example.net/ailleurs"));
  assert.ok(!urls.some((u) => /^(mailto|tel|javascript):/.test(u)));
  assert.equal(p.liens.find((l) => l.url.endsWith("/realisations")).texte, "Nos réalisations");
});

test("HTML → texte : une page tronquée (script jamais fermé) ne laisse pas passer le script", () => {
  const p = analyserHtml("<p>Jardin de ville à Bron.</p><script>var x = 'reste du script coupé", "https://example.org/");
  assert.equal(p.texte, "Jardin de ville à Bron.");
  const q = analyserHtml("<nav><a href='/projets'>Projets</a><p>Un menu jamais fermé, le texte reste.</p>", "https://example.org/");
  assert.ok(q.texte.includes("Un menu jamais fermé, le texte reste."));
});

test("entités : nommées, numériques, anciennes pages Windows ; « R&D » reste tel quel", () => {
  assert.equal(decoderEntites("&eacute;&Eacute;&#233;&#xE9;&rsquo;&#146;&oelig;&ccedil;&Agrave;"), "éÉéé’’œçÀ");
  assert.equal(decoderEntites("R&D et AT&T"), "R&D et AT&T");
  assert.equal(decoderEntites("a &amp b &lt;c&gt;"), "a & b <c>");
  assert.equal(decoderEntites("x&inconnue;y"), "x y");
});

test("normalisation : sans accents ni casse, apostrophes et tirets unifiés", () => {
  assert.equal(normaliser("L’Été à Saint‑Étienne"), "l'ete a saint-etienne");
  assert.equal(normaliser("  Œuvre   COMPLÈTE "), "oeuvre complete");
  assert.deepEqual(mots("J’ai vu vos 3 bassins, à Vienne !"), ["j", "ai", "vu", "vos", "3", "bassins", "a", "vienne"]);
  assert.ok(contientPassage("Création d’un bassin naturel, à Vienne.", "creation d'un BASSIN naturel a vienne"));
  assert.ok(!contientPassage("Création d’un bassin naturel à Vienne.", "bassin naturel à Lyon"));
  assert.ok(!contientPassage("Un bassinet", "bassin"));
});

test("familles de mots : pluriel et féminin tolérés, pas les mots voisins", () => {
  for (const [a, b] of [["bassin", "bassins"], ["naturel", "naturelle"], ["graminee", "graminees"], ["bois", "bois"], ["toit", "toits"], ["jardin", "jardinier"]]) {
    assert.ok(memeFamille(a, b), `${a} / ${b}`);
  }
  for (const [a, b] of [["terrain", "terrasse"], ["parc", "parcours"], ["lyon", "lyonnais"], ["mur", "muret"]]) {
    assert.ok(!memeFamille(a, b), `${a} / ${b}`);
  }
});

test("phrases : coupées après . ! ? suivis d'une majuscule, et à chaque ligne", () => {
  assert.deepEqual(decouperPhrases("Première phrase. Deuxième phrase ! Troisième ?\nLigne deux, sans point\nVers 2009. 3 jardins"), [
    "Première phrase.",
    "Deuxième phrase !",
    "Troisième ?",
    "Ligne deux, sans point",
    "Vers 2009.",
    "3 jardins",
  ]);
});

/** Un générateur pseudo-aléatoire reproductible (les mêmes cas à chaque passage). */
function hasard(graine) {
  let x = graine;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

test("lecture linéaire : les mêmes résultats que les anciennes expressions régulières, sur 3 000 bouts de HTML tirés au hasard", () => {
  const tirer = hasard(42);
  const briques = ["<", ">", "a", "h1", "h2", "/", " ", "x", "</a>", "</h1>", "<a ", "<h1>", "<a href=1>", "</h2 >", "<meta", "<base"];
  for (let n = 0; n < 3000; n++) {
    let html = "";
    const longueur = 1 + Math.floor(tirer() * 14);
    for (let i = 0; i < longueur; i++) html += briques[Math.floor(tirer() * briques.length)];
    assert.equal(remplacerBalises(html, " "), html.replace(/<[^>]*>/g, " "), html);
    const liens = [...html.matchAll(/<a\b([^>]*)>([\s\S]{0,8}?)<\/a\s*>/gi)].map((m) => [m[1], m[2]]);
    assert.deepEqual(elementsFermes(html, ["a"], { max: 8 }).map((e) => [e.attributs, e.contenu]), liens, html);
    const titres = [...html.matchAll(/<(h1|h2)\b([^>]*)>([\s\S]{0,8}?)<\/\1\s*>/gi)].map((m) => [m[1].toLowerCase(), m[3]]);
    assert.deepEqual(elementsFermes(html, ["h1", "h2"], { max: 8 }).map((e) => [e.nom, e.contenu]), titres, html);
    assert.deepEqual(balisesOuvrantes(html, "meta"), html.match(/<meta\b[^>]*>/gi) ?? [], html);
  }
});

test("lecture linéaire : une page hostile de 1 Mo (« < », liens, titres ou <title> jamais fermés) se lit en quelques millisecondes", () => {
  for (const brique of ["<", "<a", '<a href="/x">', "<h1>", "<title>", "<meta", "<p", "<!--", "<script>", "<a><h1>"]) {
    const page = brique.repeat(Math.floor(1_000_000 / brique.length));
    const debut = performance.now();
    analyserHtml(page, "https://atelier-demo-01.example.org/");
    const duree = performance.now() - debut;
    assert.ok(duree < 1500, `${brique} : ${Math.round(duree)} ms`);
  }
});
