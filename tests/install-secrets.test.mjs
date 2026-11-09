// L'installation, les secrets (scripts/install/secrets.mjs) : jetons tirés au hasard de la bonne longueur, jamais affichés ni passés
// en argument (l'entrée standard seulement), noms posés selon la config (et cohérents avec ce que l'application exige), --essai
// n'exécute rien, refus d'écraser sans --remplacer, copie dans le presse-papiers. Les commandes (vercel, pbcopy…) sont simulées.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { chargerNiche } from "../config/charger.ts";
import { LONGUEUR_MIN_CLE_CALENDLY } from "../lib/agenda/calendly.ts";
import { LONGUEUR_MIN_SECRET_ICLOSED } from "../lib/agenda/iclosed.ts";
import { variablesAgenda } from "../lib/agenda/registre.ts";
import { LONGUEURS_MIN_SECRETS } from "../lib/telephonie/outils.ts";
import { adaptateurTelephonie } from "../lib/telephonie/registre.ts";
import { MODES_PAR_FOURNISSEUR } from "../lib/telephonie/types.ts";
import { outilsPressePapiers } from "../scripts/install/lib.mjs";
import { besoinsSecrets, executerSecrets, nomsPresents, OCTETS_SECRET, tirerSecret } from "../scripts/install/secrets.mjs";
import { exemple, RACINE } from "./aides.mjs";

const RE_JETON = /^[A-Za-z0-9_-]{43}$/;

/** La niche d'exemple avec un autre fournisseur de téléphonie et d'agenda. */
function niche(telephonie, agenda) {
  const n = exemple();
  n.telephonie = { fournisseur: telephonie, mode: MODES_PAR_FOURNISSEUR[telephonie][0], copierNumero: true, enregistrement: false };
  if (telephonie === "softphone") n.telephonie.schemaLien = "sip";
  n.agenda = { fournisseur: agenda, prefill: false, champLead: "utm_content" };
  if (agenda === "calendly" || agenda === "iclosed") n.agenda.lienReservation = "https://example.org/reserver";
  return chargerNiche(n);
}

/**
 * Un faux lanceur de commandes : il garde chaque appel (commande, arguments, entrée standard) et répond selon `reponses`.
 * « vercel env ls » rend un tableau où figurent les noms de `presents`.
 */
function faux({ presents = [], echecs = {}, introuvable = false } = {}) {
  const appels = [];
  const executer = (commande, args, { entree } = {}) => {
    appels.push({ commande, args: [...args], entree: entree ?? "" });
    if (introuvable && commande === "vercel") return { code: 127, sortie: "", erreur: "", introuvable: true };
    const cle = `${commande} ${args.slice(0, 2).join(" ")}`;
    if (echecs[cle] !== undefined) return { code: echecs[cle], sortie: "", erreur: "refus", introuvable: false };
    if (cle === "vercel env ls") {
      const tableau = [" name                 value       environments   created", ...presents.map((p) => ` ${p}   Encrypted   Production   2d ago`)];
      return { code: 0, sortie: tableau.join("\n"), erreur: "Vercel CLI 62.2.0\n> Environment Variables found", introuvable: false };
    }
    return { code: 0, sortie: "", erreur: "", introuvable: false };
  };
  return { appels, executer };
}

const lie = () => true;
const nonLie = () => false;

function dependances(n, f, autres = {}) {
  return { niche: n, executer: f.executer, existe: lie, racine: "/depot", plateforme: "darwin", env: {}, ...autres };
}

/** Toutes les valeurs passées en entrée standard à « vercel env add ». */
const valeursPosees = (appels) => appels.filter((a) => a.commande === "vercel" && a.args[1] === "add").map((a) => a.entree);

test("un secret : 32 octets tirés au hasard, en base64url (43 caractères), jamais deux fois le même", () => {
  assert.equal(OCTETS_SECRET, 32);
  const vus = new Set();
  for (let i = 0; i < 50; i++) {
    const s = tirerSecret();
    assert.match(s, RE_JETON);
    vus.add(s);
  }
  assert.equal(vus.size, 50);
  // Assez long pour chaque règle de l'application.
  for (const min of [...Object.values(LONGUEURS_MIN_SECRETS), LONGUEUR_MIN_SECRET_ICLOSED]) assert.ok(43 >= min);
  // Le tirage passe bien par la source d'aléa donnée.
  let demande = 0;
  const s = tirerSecret((n) => {
    demande = n;
    return Buffer.alloc(n, 7);
  });
  assert.equal(demande, 32);
  assert.match(s, RE_JETON);
});

test("les noms tirés et ceux à coller dépendent de la config, et couvrent tout ce que l'application exige", () => {
  const cas = [
    ["onoff", "calendly", ["ONOFF_WEBHOOK_TOKEN", "CALENDLY_WEBHOOK_SIGNING_KEY", "CRON_SECRET"]],
    ["aircall", "google", ["CRON_SECRET"]],
    ["ringover", "iclosed", ["RINGOVER_WEBHOOK_SECRET", "ICLOSED_WEBHOOK_SECRET", "CRON_SECRET"]],
    ["softphone", "aucun", ["CRON_SECRET"]],
    ["telephone", "aucun", ["CRON_SECRET"]],
  ];
  for (const [tel, ag, attendus] of cas) {
    const { aTirer, aColler } = besoinsSecrets(niche(tel, ag));
    assert.deepEqual(aTirer.map((s) => s.nom), attendus, `${tel} + ${ag}`);
    const tous = new Set([...aTirer.map((s) => s.nom), ...aColler.filter((v) => !v.facultative).map((v) => v.nom)]);
    const exigees = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      ...(adaptateurTelephonie(tel)?.webhook?.variables ?? []),
      ...variablesAgenda(ag),
    ];
    for (const nom of exigees) assert.ok(tous.has(nom), `${tel} + ${ag} : ${nom} n'est ni tiré ni à coller`);
    // Aucun nom n'est à la fois tiré et à coller.
    for (const s of aTirer) assert.ok(!aColler.some((v) => v.nom === s.nom), s.nom);
    // Les longueurs minimales annoncées sont celles de l'application.
    for (const s of aTirer) {
      const min =
        s.nom === "ICLOSED_WEBHOOK_SECRET"
          ? LONGUEUR_MIN_SECRET_ICLOSED
          : s.nom === "CALENDLY_WEBHOOK_SIGNING_KEY"
            ? LONGUEUR_MIN_CLE_CALENDLY
            : (LONGUEURS_MIN_SECRETS[s.nom] ?? 16);
      assert.ok(s.min >= min, `${s.nom} : minimum ${s.min} < ${min}`);
    }
  }
  // Le jeton d'Aircall est créé par Aircall : jamais tiré par le script.
  assert.ok(besoinsSecrets(niche("aircall", "aucun")).aColler.some((v) => v.nom === "AIRCALL_WEBHOOK_TOKEN"));
});

test("--essai n'exécute rien et ne donne que des noms", () => {
  const f = faux();
  const r = executerSecrets({ essai: true }, dependances(niche("onoff", "iclosed"), f, { existe: nonLie }));
  assert.equal(r.code, 0);
  assert.equal(f.appels.length, 0, "aucune commande, pas même vercel env ls");
  const texte = r.lignes.join("\n");
  for (const nom of ["ONOFF_WEBHOOK_TOKEN", "ICLOSED_WEBHOOK_SECRET", "CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "ONOFF_API_KEY"]) {
    assert.ok(texte.includes(nom), nom);
  }
  assert.doesNotMatch(texte, /[A-Za-z0-9_-]{43}/, "aucune valeur");
});

test("pose : vercel env add <NOM> production --sensitive --yes, la valeur en entrée standard, jamais en argument ni à l'écran", () => {
  const f = faux({ presents: ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL"] });
  const r = executerSecrets({}, dependances(niche("onoff", "calendly"), f));
  assert.equal(r.code, 0, r.erreur ?? "");
  assert.deepEqual(f.appels[0], { commande: "vercel", args: ["env", "ls", "production"], entree: "" });
  const ajouts = f.appels.filter((a) => a.args[1] === "add");
  assert.deepEqual(
    ajouts.map((a) => a.args),
    [
      ["env", "add", "ONOFF_WEBHOOK_TOKEN", "production", "--sensitive", "--yes"],
      ["env", "add", "CALENDLY_WEBHOOK_SIGNING_KEY", "production", "--sensitive", "--yes"],
    ],
    "CRON_SECRET, déjà présente, n'est pas réécrite",
  );
  const valeurs = valeursPosees(f.appels);
  assert.equal(valeurs.length, 2);
  for (const v of valeurs) assert.match(v, RE_JETON);
  assert.notEqual(valeurs[0], valeurs[1]);
  const texte = [...r.lignes, r.erreur ?? ""].join("\n");
  for (const v of valeurs) {
    assert.ok(!texte.includes(v), "une valeur est affichée");
    for (const a of f.appels) assert.ok(!a.args.some((x) => x.includes(v)), "une valeur passe en argument");
  }
  assert.ok(f.appels.every((a) => !a.args.includes("--value")), "jamais --value");
  assert.match(texte, /CRON_SECRET : déjà dans Vercel \(production\), gardée/);
  assert.match(texte, /vercel deploy --prod/);
});

test("--remplacer : une nouvelle valeur, avec --force ; --environnement preview", () => {
  const f = faux({ presents: ["CRON_SECRET"] });
  const r = executerSecrets({ remplacer: true, environnement: "preview" }, dependances(niche("telephone", "aucun"), f));
  assert.equal(r.code, 0, r.erreur ?? "");
  assert.deepEqual(f.appels.map((a) => a.args), [
    ["env", "ls", "preview"],
    ["env", "add", "CRON_SECRET", "preview", "--sensitive", "--yes", "--force"],
  ]);
  assert.match(r.lignes.join("\n"), /CRON_SECRET : remplacée dans Vercel \(preview\)/);
  assert.equal(executerSecrets({ environnement: "development" }, dependances(niche("telephone", "aucun"), faux())).code, 1);
});

test("--copier : ce secret seulement, la même valeur va à Vercel et au presse-papiers, jamais à l'écran", () => {
  for (const [plateforme, env, outil] of [
    ["darwin", {}, "pbcopy"],
    ["win32", {}, "clip"],
    ["linux", {}, "xclip"],
    ["linux", { WAYLAND_DISPLAY: "wayland-0" }, "wl-copy"],
  ]) {
    const f = faux({ presents: [] });
    const r = executerSecrets({ copier: "RINGOVER_WEBHOOK_SECRET" }, dependances(niche("ringover", "iclosed"), f, { plateforme, env }));
    assert.equal(r.code, 0, r.erreur ?? "");
    const ajouts = f.appels.filter((a) => a.args[1] === "add");
    assert.equal(ajouts.length, 1, "un seul secret posé");
    assert.equal(ajouts[0].args[2], "RINGOVER_WEBHOOK_SECRET");
    const copie = f.appels.find((a) => a.commande === outil);
    assert.ok(copie, `${plateforme} : ${outil}`);
    assert.equal(copie.entree, ajouts[0].entree, "la valeur copiée est celle posée");
    assert.ok(!r.lignes.join("\n").includes(copie.entree));
    assert.ok(!copie.args.some((x) => x.includes(copie.entree)));
    assert.match(r.lignes.join("\n"), /copiée dans le presse-papiers \(jamais affichée\)/);
  }
});

test("refus d'écraser : --copier sur une variable déjà présente ne pose ni ne copie rien sans --remplacer", () => {
  const f = faux({ presents: ["ICLOSED_WEBHOOK_SECRET"] });
  const r = executerSecrets({ copier: "ICLOSED_WEBHOOK_SECRET" }, dependances(niche("telephone", "iclosed"), f));
  assert.equal(r.code, 1);
  assert.match(r.erreur, /--remplacer --copier ICLOSED_WEBHOOK_SECRET/);
  assert.equal(f.appels.filter((a) => a.args[1] === "add").length, 0);
  assert.equal(f.appels.filter((a) => a.commande !== "vercel").length, 0, "rien n'est copié");
  // Avec --remplacer : posée (--force) puis copiée.
  const g = faux({ presents: ["ICLOSED_WEBHOOK_SECRET"] });
  const s = executerSecrets({ copier: "ICLOSED_WEBHOOK_SECRET", remplacer: true }, dependances(niche("telephone", "iclosed"), g));
  assert.equal(s.code, 0, s.erreur ?? "");
  assert.ok(g.appels.some((a) => a.args.includes("--force")));
  assert.ok(g.appels.some((a) => a.commande === "pbcopy"));
});

test("les erreurs : nom inconnu, projet non lié, Vercel absent, commande refusée, copie impossible (sans jamais une valeur)", () => {
  const n = niche("onoff", "aucun");
  const inconnu = faux();
  const r1 = executerSecrets({ copier: "AIRCALL_WEBHOOK_TOKEN" }, dependances(n, inconnu));
  assert.equal(r1.code, 1);
  assert.match(r1.erreur, /possibles : ONOFF_WEBHOOK_TOKEN, CRON_SECRET/);
  assert.equal(inconnu.appels.length, 0);

  const f2 = faux();
  const r2 = executerSecrets({}, dependances(n, f2, { existe: nonLie }));
  assert.equal(r2.code, 1);
  assert.match(r2.erreur, /vercel link/);
  assert.equal(f2.appels.length, 0);

  const r3 = executerSecrets({}, dependances(n, faux({ introuvable: true })));
  assert.equal(r3.code, 1);
  assert.match(r3.erreur, /Vercel CLI introuvable/);

  const f4 = faux({ echecs: { "vercel env add": 1 } });
  const r4 = executerSecrets({}, dependances(n, f4));
  assert.equal(r4.code, 1);
  assert.match(r4.erreur, /ONOFF_WEBHOOK_TOKEN : « vercel env add » a échoué \(code 1\)/);
  for (const v of valeursPosees(f4.appels)) assert.ok(!r4.erreur.includes(v));

  const f5 = faux({ echecs: { "pbcopy ": 1 } });
  const r5 = executerSecrets({ copier: "ONOFF_WEBHOOK_TOKEN" }, dependances(n, f5));
  assert.equal(r5.code, 1);
  assert.match(r5.erreur, /la copie a échoué/);
  for (const v of valeursPosees(f5.appels)) assert.ok(!r5.erreur.includes(v) && !r5.lignes.join("").includes(v));
});

test("la liste de vercel env ls : seuls les noms attendus sont retenus, quel que soit le cadre du tableau", () => {
  const sortie = [
    "Vercel CLI 62.2.0",
    "> Environment Variables found for demo [120ms]",
    "",
    " name                  value        environments        created",
    " CRON_SECRET           Encrypted    Production          3d ago",
    "│ ONOFF_WEBHOOK_TOKEN │ Encrypted │ Production │ 1d ago │",
    " AUTRE_NOM             Encrypted    Production          1d ago",
    " CRON_SECRET_ANCIEN    Encrypted    Production          9d ago",
  ].join("\n");
  assert.deepEqual([...nomsPresents(sortie, ["CRON_SECRET", "ONOFF_WEBHOOK_TOKEN", "ICLOSED_WEBHOOK_SECRET"])].sort(), [
    "CRON_SECRET",
    "ONOFF_WEBHOOK_TOKEN",
  ]);
  assert.equal(nomsPresents("", ["CRON_SECRET"]).size, 0);
});

test("le presse-papiers : pbcopy (macOS), clip (Windows), wl-copy ou xclip (Linux)", () => {
  assert.deepEqual(outilsPressePapiers("darwin", {}).map(([o]) => o), ["pbcopy"]);
  assert.deepEqual(outilsPressePapiers("win32", {}).map(([o]) => o), ["clip"]);
  assert.deepEqual(outilsPressePapiers("linux", {}).map(([o]) => o), ["xclip", "wl-copy"]);
  assert.deepEqual(outilsPressePapiers("linux", { WAYLAND_DISPLAY: "w" }).map(([o]) => o), ["wl-copy", "xclip"]);
});

test("la ligne de commande : --aide, --essai sur la config du dépôt, option inconnue refusée", () => {
  const lancer = (...args) =>
    spawnSync(process.execPath, ["scripts/install/secrets.mjs", ...args], { cwd: new URL(".", RACINE), encoding: "utf8", timeout: 60_000 });
  const aide = lancer("--aide");
  assert.equal(aide.status, 0);
  for (const o of ["--essai", "--copier", "--remplacer", "--environnement", "--config"]) assert.ok(aide.stdout.includes(o), o);
  const essai = lancer("--essai");
  assert.equal(essai.status, 0, essai.stderr);
  assert.match(essai.stdout, /CRON_SECRET/);
  assert.doesNotMatch(essai.stdout, /[A-Za-z0-9_-]{43}/);
  const inconnue = lancer("--valeur", randomBytes(8).toString("hex"));
  assert.equal(inconnue.status, 1);
  assert.match(inconnue.stderr, /Option inconnue/);
});
