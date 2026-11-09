// Accroches, robots.txt : le groupe de notre robot s'applique seul (sinon « * »), la règle la plus longue gagne, Allow gagne à égalité,
// « * » et « $ » compris, Crawl-delay lu. Le robot fictif s'appelle AtelierDemoBot (config/niche.exemple.json).
import assert from "node:assert/strict";
import { test } from "node:test";
import { jetonRobot } from "../scripts/accroches/lib/config.mjs";
import { MAX_CHEMIN, MAX_REGLES, analyserRobots, cheminAutorise, motifCorrespond, reglesPour } from "../scripts/accroches/lib/robots.mjs";
import { exemple } from "./aides.mjs";

const ROBOTS = `# Un robots.txt fictif
User-agent: *
Disallow: /prive/
Disallow: /*.pdf$
Allow: /prive/public

User-agent: AtelierDemoBot
User-agent: AutreBot/2.0
Disallow: /realisations/chantier-secret
Crawl-delay: 2
`;

test("le jeton de notre robot vient de config.marque.userAgent", () => {
  assert.equal(jetonRobot(exemple().marque.userAgent), "AtelierDemoBot");
});

test("un groupe pour notre robot : il s'applique SEUL (le groupe « * » ne compte plus)", () => {
  const r = reglesPour(analyserRobots(ROBOTS), "AtelierDemoBot");
  assert.equal(r.groupe, "specifique");
  assert.equal(r.delai, 2);
  assert.equal(cheminAutorise(r.regles, "/realisations/chantier-secret"), false);
  assert.equal(cheminAutorise(r.regles, "/realisations/chantier-secret/photos"), false);
  assert.equal(cheminAutorise(r.regles, "/realisations"), true);
  assert.equal(cheminAutorise(r.regles, "/prive/page"), true);
});

test("le jeton se compare sans casse, et un « User-agent: Robot/2.0 » vaut pour Robot", () => {
  assert.equal(reglesPour(analyserRobots("user-agent: atelierdemobot\ndisallow: /x"), "AtelierDemoBot").groupe, "specifique");
  assert.equal(reglesPour(analyserRobots(ROBOTS), "AutreBot").groupe, "specifique");
});

test("sans groupe pour notre robot : le groupe « * », la règle la plus longue gagne", () => {
  const r = reglesPour(analyserRobots(ROBOTS), "UnRobotInconnu");
  assert.equal(r.groupe, "general");
  assert.equal(cheminAutorise(r.regles, "/prive/page"), false);
  assert.equal(cheminAutorise(r.regles, "/prive/public/fiche"), true);
  assert.equal(cheminAutorise(r.regles, "/doc/plaquette.pdf"), false);
  assert.equal(cheminAutorise(r.regles, "/doc/plaquette.pdf?version=2"), true);
  assert.equal(cheminAutorise(r.regles, "/"), true);
});

test("Allow gagne à longueur égale ; « Disallow: » vide ne ferme rien ; robots.txt lui-même reste lisible", () => {
  assert.equal(cheminAutorise(reglesPour(analyserRobots("User-agent: *\nDisallow: /page\nAllow: /page"), "X").regles, "/page"), true);
  assert.equal(cheminAutorise(reglesPour(analyserRobots("User-agent: *\nDisallow:"), "X").regles, "/tout"), true);
  const tout = reglesPour(analyserRobots("User-agent: *\nDisallow: /"), "X").regles;
  assert.equal(cheminAutorise(tout, "/"), false);
  assert.equal(cheminAutorise(tout, "/robots.txt"), true);
});

test("aucun groupe applicable : tout est permis ; chemins encodés comparés décodés", () => {
  const r = reglesPour(analyserRobots("User-agent: AutreBot\nDisallow: /"), "AtelierDemoBot");
  assert.equal(r.groupe, "aucun");
  assert.equal(cheminAutorise(r.regles, "/n-importe-ou"), true);
  const accents = reglesPour(analyserRobots("User-agent: *\nDisallow: /réalisations/"), "X").regles;
  assert.equal(cheminAutorise(accents, "/r%C3%A9alisations/jardin"), false);
});

test("« * » et « $ » : la correspondance suit la norme (préfixe, suite quelconque, fin ancrée ; « $ » au milieu est un caractère)", () => {
  assert.equal(motifCorrespond("/fish", "/fish.html"), true);
  assert.equal(motifCorrespond("/fish", "/Fish.asp"), false, "sensible à la casse");
  assert.equal(motifCorrespond("/fish*", "/fishheads/yummy.html"), true);
  assert.equal(motifCorrespond("/*.php", "/filename.php"), true);
  assert.equal(motifCorrespond("/*.php", "/folder/filename.php?parameters"), true);
  assert.equal(motifCorrespond("/*.php$", "/filename.php?parameters"), false);
  assert.equal(motifCorrespond("/*.php$", "/folder/filename.php"), true);
  assert.equal(motifCorrespond("/fish*.php", "/fishheads/catfish.php?parameters"), true);
  assert.equal(motifCorrespond("/fish*.php", "/Fish.PHP"), false);
  assert.equal(motifCorrespond("/a$b", "/a$b/c"), true, "« $ » qui n'est pas en dernier : un caractère");
  assert.equal(motifCorrespond("/**a***b", "/xaxxb"), true, "étoiles consécutives");
  assert.equal(motifCorrespond("/$", "/"), true);
  assert.equal(motifCorrespond("/$", "/page"), false);
  assert.equal(motifCorrespond("*", ""), true);
});

test("robots.txt hostile : la correspondance reste linéaire (13 étoiles sur un chemin de 200 caractères, et le cas de la revue)", () => {
  const hostile = reglesPour(analyserRobots(`User-agent: *\nDisallow: /${"*a".repeat(13)}*b\n`), "AtelierDemoBot").regles;
  let debut = performance.now();
  assert.equal(cheminAutorise(hostile, `/${"a".repeat(199)}`), true);
  assert.equal(cheminAutorise(hostile, `/${"a".repeat(198)}b`), false);
  assert.ok(performance.now() - debut < 50, `13 étoiles : ${performance.now() - debut} ms`);
  const revue = reglesPour(analyserRobots("User-agent: *\nDisallow: /*a*a*a*a*a*a*a*a*a*a*b\n"), "AtelierDemoBot").regles;
  debut = performance.now();
  assert.equal(cheminAutorise(revue, `/${"a".repeat(39)}`), true);
  assert.equal(cheminAutorise(revue, `/${"a".repeat(38)}b`), false);
  assert.ok(performance.now() - debut < 50, `cas de la revue : ${performance.now() - debut} ms`);
});

test("robots.txt trop lourd (trop de règles pour notre robot) : tout est fermé ; un chemin démesuré n'est jamais lu", () => {
  const lignes = Array.from({ length: MAX_REGLES + 1 }, (_, i) => `Disallow: /prive-${i}`).join("\n");
  const lourd = reglesPour(analyserRobots(`User-agent: *\n${lignes}\n`), "AtelierDemoBot");
  assert.equal(cheminAutorise(lourd.regles, "/"), false);
  assert.equal(cheminAutorise(lourd.regles, "/robots.txt"), true);
  const leger = reglesPour(analyserRobots("User-agent: *\nDisallow: /prive\n"), "AtelierDemoBot").regles;
  assert.equal(cheminAutorise(leger, `/${"a".repeat(MAX_CHEMIN)}`), false);
  assert.equal(cheminAutorise(leger, `/${"a".repeat(100)}`), true);
});
