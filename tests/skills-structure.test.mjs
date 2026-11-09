// Les skills Claude Code (skills/*/SKILL.md) et les docs d'installation tiennent leurs promesses :
//   - chaque SKILL.md a son en-tête (name = nom du dossier, description), son titre et les six sections, dans l'ordre ;
//   - toute commande « node scripts/… » citée (skills, README, docs d'installation et légales) désigne un fichier qui existe, et chaque
//     option qu'on lui donne est acceptée par ce script : elle figure dans sa sortie --aide ou dans son code (le script et ses modules
//     locaux) ; une option citée seule (en prose ou dans un bout de code) appartient à un script cité dans le même skill (pour une
//     doc : à un script du dépôt), ou à l'un des outils externes de l'installation (vercel, gh, supabase, npm, node) ;
//   - « npm run <x> » : une entrée de package.json ; un chemin du dépôt cité (scripts/…, docs/…, config/…) existe ;
//   - jamais une commande qui ouvre un fichier .env, jamais un tiret cadratin ; skills/README.md est là.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("../", import.meta.url));
const lire = (chemin) => readFileSync(join(RACINE, chemin), "utf8");

export const SKILLS = ["installer", "sourcer-leads", "accroches", "debrief", "ajuster-script"];
export const SECTIONS = ["But", "Entrées", "Étapes", "Garde-fous", "Sortie", "Pièges connus"];
/** Les fichiers dont les commandes sont vérifiées, en plus des SKILL.md. */
const DOCS = ["skills/README.md", "README.md", "README.en.md", "docs/installation.md", "docs/legal.md", "CONTRIBUTING.md", "SECURITY.md"];

/**
 * Les options des outils externes que les docs ont le droit de citer (vérifiées sur vercel 62 et gh, ou documentées par Supabase et
 * Node) : elles ne sont pas celles d'un script du dépôt.
 */
export const OPTIONS_EXTERNES = new Set([
  "--prod", // vercel deploy --prod
  "--yes", // vercel link --yes
  "--project", // vercel link --project
  "--private", // gh repo create --private
  "--template", // gh repo create --template
  "--clone", // gh repo create --clone
  "--project-ref", // supabase link --project-ref
  "--env-file", // node --env-file=…
  "--no-save", // npm install --no-save (docs/sourcing.md, Playwright)
]);

const OUTILS_EXTERNES = /^(?:vercel|gh|supabase|npm|npx|git|rm|ln|cd|cp|mv|mkdir|ls|read|unset|export|curl|open|cat|echo|printf|brew|pbcopy|claude)\b/;

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture des fichiers Markdown
// ---------------------------------------------------------------------------------------------------------------------------------

/** Le texte découpé en morceaux de code (lignes des blocs, contenus des `…`) et en prose (le reste). */
export function morceaux(md) {
  const code = [];
  const prose = [];
  let dansBloc = false;
  for (const ligne of md.split("\n")) {
    if (/^\s*```/.test(ligne)) {
      dansBloc = !dansBloc;
      continue;
    }
    if (dansBloc) {
      code.push(ligne.replace(/(^|\s)#(?!!).*$/, "$1"));
      continue;
    }
    let reste = ligne;
    for (const m of ligne.matchAll(/`([^`]+)`/g)) code.push(m[1]);
    reste = reste.replace(/`[^`]+`/g, " ");
    prose.push(reste);
  }
  return { code, prose: prose.join("\n") };
}

/** Les commandes d'un morceau de code, séparées par ; && || | et les retours à la ligne. */
const commandes = (morceau) => morceau.split(/;|&&|\|\||\|/).map((c) => c.trim()).filter(Boolean);

/** Les commandes « node scripts/… » d'un fichier : { script, options } (les options qui suivent le chemin du script). */
export function commandesNode(md) {
  const trouvees = [];
  const seules = [];
  const npmRun = [];
  for (const morceau of morceaux(md).code) {
    for (const c of commandes(morceau)) {
      const m = /(?:^|\s)node\s+(?:--[a-z-]+(?:=\S+)?\s+)*(scripts\/[\w./-]+\.mjs)\b(.*)$/.exec(c);
      if (m) {
        trouvees.push({ script: m[1], options: [...m[2].matchAll(/(?:^|\s)(--[a-z][a-z0-9-]*)/g)].map((o) => o[1]) });
        continue;
      }
      const r = /^npm\s+run\s+(\S+)/.exec(c);
      if (r) npmRun.push(r[1]);
      if (OUTILS_EXTERNES.test(c) || /^node\s/.test(c)) continue;
      for (const o of c.matchAll(/(?:^|[\s[(])(--[a-z][a-z0-9-]*)/g)) seules.push(o[1]);
    }
  }
  for (const o of morceaux(md).prose.matchAll(/(?:^|[\s(«])(--[a-z][a-z0-9-]*)/g)) seules.push(o[1]);
  return { trouvees, seules, npmRun };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ce qu'un script accepte
// ---------------------------------------------------------------------------------------------------------------------------------

/** Le script et ses modules locaux (imports relatifs en .mjs, de proche en proche). */
function sourcesDuScript(script) {
  const vus = new Set();
  const pile = [join(RACINE, script)];
  while (pile.length > 0) {
    const f = pile.pop();
    if (vus.has(f) || !existsSync(f)) continue;
    vus.add(f);
    const texte = readFileSync(f, "utf8");
    for (const m of texte.matchAll(/(?:from\s+|import\(\s*)["'](\.{1,2}\/[^"']+\.mjs)["']/g)) pile.push(resolve(dirname(f), m[1]));
  }
  return [...vus];
}

const cacheOptions = new Map();

/** Les options qu'un script accepte : celles de sa sortie --aide, et celles écrites dans son code. */
export function optionsAcceptees(script) {
  if (cacheOptions.has(script)) return cacheOptions.get(script);
  const options = new Set();
  const env = { ...process.env };
  delete env.SUPABASE_DB_URL;
  const aide = spawnSync(process.execPath, [script, "--aide"], { cwd: RACINE, encoding: "utf8", timeout: 60_000, env });
  for (const m of `${aide.stdout ?? ""}\n${aide.stderr ?? ""}`.matchAll(/--[a-z][a-z0-9-]*/g)) options.add(m[0]);
  for (const f of sourcesDuScript(script)) {
    const texte = readFileSync(f, "utf8");
    for (const m of texte.matchAll(/["'`](--[a-z][a-z0-9-]*)/g)) options.add(m[1]);
    for (const m of texte.matchAll(/--[a-z][a-z0-9-]*/g)) options.add(m[0]);
    for (const m of texte.matchAll(/(?:drapeaux|valeurs)\s*:\s*\[([^\]]*)\]/g)) {
      for (const n of m[1].matchAll(/["']([a-z][a-z0-9-]*)["']/g)) options.add(`--${n[1]}`);
    }
  }
  cacheOptions.set(script, options);
  return options;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les tests
// ---------------------------------------------------------------------------------------------------------------------------------

const fichiersVerifies = () => [...SKILLS.map((s) => `skills/${s}/SKILL.md`), ...DOCS].filter((f) => existsSync(join(RACINE, f)));

/** Les options de tous les scripts lançables du dépôt (scripts/<dossier>/<script>.mjs). */
function optionsDeTousLesScripts() {
  const toutes = new Set();
  for (const dossier of ["sourcing", "accroches", "debrief", "install"]) {
    for (const nom of readdirSync(join(RACINE, "scripts", dossier))) {
      if (nom.endsWith(".mjs")) for (const o of optionsAcceptees(`scripts/${dossier}/${nom}`)) toutes.add(o);
    }
  }
  return toutes;
}

test("les cinq skills et skills/README.md sont là ; le README des skills dit comment les lier, sans clé", () => {
  for (const s of SKILLS) assert.ok(existsSync(join(RACINE, "skills", s, "SKILL.md")), `skills/${s}/SKILL.md manquant`);
  const presents = readdirSync(join(RACINE, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual(presents.sort(), [...SKILLS].sort(), "un dossier de skills en trop ou en moins");
  const readme = lire("skills/README.md");
  assert.match(readme, /ln -s /, "skills/README.md : comment lier un skill (ln -s)");
  assert.match(readme, /\.claude\/skills/, "skills/README.md : où Claude Code lit les skills");
  for (const s of SKILLS) assert.ok(readme.includes(s), `skills/README.md ne cite pas ${s}`);
});

test("chaque SKILL.md : en-tête name et description, un titre, les six sections dans l'ordre", () => {
  for (const s of SKILLS) {
    const md = lire(`skills/${s}/SKILL.md`);
    const entete = /^---\n([\s\S]*?)\n---\n/.exec(md);
    assert.ok(entete, `${s} : l'en-tête (entre deux lignes ---) doit ouvrir le fichier`);
    const champs = Object.fromEntries(
      entete[1].split("\n").map((l) => /^([a-z_-]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
    );
    assert.equal(champs.name, s, `${s} : name doit être le nom du dossier`);
    assert.match(champs.name, /^[a-z0-9-]{1,64}$/);
    assert.ok(champs.description && champs.description.length >= 80, `${s} : description trop courte (quand l'utiliser ?)`);
    assert.ok(champs.description.length <= 1024, `${s} : description de plus de 1024 caractères`);
    const corps = md.slice(entete[0].length);
    const horsBlocs = corps.split(/^```.*$/m).filter((_, i) => i % 2 === 0).join("\n");
    assert.match(horsBlocs, /^# \S/m, `${s} : un titre « # … »`);
    const sections = [...horsBlocs.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
    assert.deepEqual(sections, SECTIONS, `${s} : les sections doivent être exactement ${SECTIONS.join(", ")}`);
  }
});

test("chaque commande « node scripts/… » citée existe et chacune de ses options est acceptée par le script", () => {
  const problemes = [];
  let vues = 0;
  for (const f of fichiersVerifies()) {
    const { trouvees, seules, npmRun } = commandesNode(lire(f));
    const permisesIci = new Set(OPTIONS_EXTERNES);
    for (const { script, options } of trouvees) {
      vues++;
      if (!existsSync(join(RACINE, script))) {
        problemes.push(`${f} : ${script} n'existe pas`);
        continue;
      }
      const acceptees = optionsAcceptees(script);
      for (const o of acceptees) permisesIci.add(o);
      for (const o of options) if (!acceptees.has(o)) problemes.push(`${f} : ${script} n'accepte pas ${o}`);
    }
    // Un skill ne cite une option seule que si l'un de SES scripts la prend ; une doc, si l'un des scripts du dépôt la prend.
    const permises = f.endsWith("SKILL.md") ? permisesIci : new Set([...permisesIci, ...optionsDeTousLesScripts()]);
    for (const o of seules) if (!permises.has(o)) problemes.push(`${f} : l'option ${o} n'appartient à aucun script ${f.endsWith("SKILL.md") ? "cité dans ce skill" : "du dépôt"}`);
    const scriptsNpm = JSON.parse(lire("package.json")).scripts;
    for (const n of npmRun) if (!Object.hasOwn(scriptsNpm, n)) problemes.push(`${f} : « npm run ${n} » n'existe pas dans package.json`);
  }
  assert.ok(vues >= 20, `trop peu de commandes trouvées (${vues}) : la lecture des fichiers a-t-elle changé ?`);
  assert.deepEqual(problemes, []);
});

test("chaque chemin du dépôt cité existe", () => {
  const problemes = [];
  for (const f of fichiersVerifies()) {
    const md = lire(f);
    for (const m of md.matchAll(/(?<![\w/.<-])((?:scripts|docs|config|supabase|skills|lib|tests)\/[A-Za-z0-9_./-]+\.(?:mjs|md|json|sql|ts|tsx|toml))/g)) {
      const chemin = m[1];
      if (/AAAA|NNN|\bxx\b/.test(chemin)) continue;
      if (!existsSync(join(RACINE, chemin))) problemes.push(`${f} : ${chemin} introuvable`);
    }
  }
  assert.deepEqual(problemes, []);
});

test("jamais une commande qui ouvre un fichier .env ; jamais de tiret cadratin", () => {
  for (const f of fichiersVerifies()) {
    const md = lire(f);
    for (const morceau of morceaux(md).code) {
      for (const c of commandes(morceau)) {
        assert.doesNotMatch(c, /^(?:cat|less|more|head|tail|grep|sed|awk|source|\.|open|code|nano|vim?)\s.*\.env/, `${f} : ${c}`);
      }
    }
    assert.ok(!md.includes("—"), `${f} : tiret cadratin`);
  }
});

test("la lecture des commandes : options d'un script, options seules, npm run", () => {
  const md = [
    "Lance `node scripts/sourcing/importer.mjs donnees/x.csv --limite 5`, puis avec `--appliquer`.",
    "```bash",
    "node scripts/install/secrets.mjs --copier CRON_SECRET   # copie --pas-une-option",
    "npm run test:sql && vercel deploy --prod",
    "```",
    "Sans --essai, rien.",
  ].join("\n");
  const r = commandesNode(md);
  assert.deepEqual(r.trouvees, [
    { script: "scripts/sourcing/importer.mjs", options: ["--limite"] },
    { script: "scripts/install/secrets.mjs", options: ["--copier"] },
  ]);
  assert.deepEqual(r.seules.sort(), ["--appliquer", "--essai"]);
  assert.deepEqual(r.npmRun, ["test:sql"]);
  assert.ok(optionsAcceptees("scripts/accroches/revue.mjs").has("--vider"), "les options des accroches sont lues dans drapeaux/valeurs");
  assert.ok(optionsAcceptees("scripts/debrief/ecrire.mjs").has("--sans-transcription"), "les options du débrief sont lues dans le code");
  assert.ok(!optionsAcceptees("scripts/install/seed-demo.mjs").has("--copier"));
  assert.ok(relative(RACINE, join(RACINE, "skills")) === "skills");
});
