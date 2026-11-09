// Contrôles statiques des actions serveur et des écrans du Poste et des prospects (sans base) : chaque action passe par run() (connexion, rôle, erreurs
// attrapées), aucune n'écrit l'issue autrement que par enregistrer_issue, aucune ne touche à la table appels ni à la clé service, aucun
// journal ne porte de donnée, aucun adaptateur de téléphonie ou d'agenda précis n'est importé, rien n'exporte de fichier.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RACINE, lire } from "./aides.mjs";

const racine = fileURLToPath(RACINE);

function fichiers(dossier, extensions = /\.(ts|tsx)$/) {
  const sortie = [];
  const parcourir = (rel) => {
    for (const nom of readdirSync(join(racine, rel))) {
      const r = `${rel}/${nom}`;
      if (statSync(join(racine, r)).isDirectory()) parcourir(r);
      else if (extensions.test(nom)) sortie.push(r);
    }
  };
  parcourir(dossier);
  return sortie.sort();
}

const ACTIONS = fichiers("app/_actions");
const POSTE = [...fichiers("app/(app)/poste"), ...fichiers("app/(app)/prospects")];
const LIB = fichiers("lib/poste");

test("les actions du lot : issue, fiche, file, filtres, mes-leads", () => {
  assert.deepEqual(ACTIONS, ["app/_actions/fiche.ts", "app/_actions/file.ts", "app/_actions/filtres.ts", "app/_actions/issue.ts", "app/_actions/mes-leads.ts"]);
});

test("chaque fichier d'actions est « use server » et n'exporte que des fonctions asynchrones qui passent par run()", () => {
  for (const f of ACTIONS) {
    const t = lire(f);
    assert.match(t.trimStart(), /^"use server";/, `${f} : « use server » en tête`);
    for (const m of t.matchAll(/^export\s+(?!async function|interface|type)(\S+)/gm)) assert.fail(`${f} : export interdit dans un fichier « use server » (${m[1]})`);
    const fonctions = [...t.matchAll(/^export async function (\w+)[\s\S]*?^}/gm)];
    assert.ok(fonctions.length > 0, f);
    for (const [corps, nom] of fonctions) assert.match(corps, /return run\(/, `${f} : ${nom} doit passer par run()`);
  }
});

test("l'issue n'est écrite que par enregistrer_issue ; jamais la table appels ; jamais la clé service", () => {
  const tout = ACTIONS.map((f) => [f, lire(f)]);
  for (const [f, t] of tout) {
    assert.doesNotMatch(t, /\.update\(\{[^}]*\b(statut|rappel_le|tentatives|derniere_issue|last_activity_at)\b/, `${f} : statut ou rappel écrits hors enregistrer_issue`);
    assert.doesNotMatch(t, /\.from\("appels"\)/, `${f} : la table appels n'est écrite que par les webhooks (clé service)`);
    assert.doesNotMatch(t, /type:\s*"appel"/, `${f} : une activité « appel » ne s'écrit que par enregistrer_issue`);
    assert.doesNotMatch(t, /supabase\/service|SERVICE_ROLE|rpcService|clientService/, `${f} : pas de clé service dans les actions du Poste`);
  }
  assert.match(lire("app/_actions/issue.ts"), /executerIssue/);
  assert.match(lire("lib/poste/saisie-issue.ts"), /d\.rpc\("enregistrer_issue"/);
  for (const f of [...POSTE, ...LIB]) assert.doesNotMatch(lire(f), /supabase\/service|SERVICE_ROLE/, f);
});

test("aucun journal ne porte de donnée : pas de console dans les actions ; dans lib/poste, un seul journal, en codes", () => {
  for (const f of [...ACTIONS, ...POSTE]) assert.doesNotMatch(lire(f), /console\./, `${f} : journaliser par echecBase (codes seulement)`);
  const avecConsole = LIB.filter((f) => /console\./.test(lire(f)));
  assert.deepEqual(avecConsole, ["lib/poste/resultat.ts"]);
  const appels = [...lire("lib/poste/resultat.ts").matchAll(/console\.\w+\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(appels, ["`[poste] ${code}`"]);
});

test("lib/poste reste PUR et importable par le navigateur : ni Node, ni Next, ni server-only", () => {
  for (const f of LIB) {
    const t = lire(f);
    assert.doesNotMatch(t, /from "node:|from "next\/|server-only|^"use (client|server)"/m, f);
  }
});

test("code générique : aucun adaptateur de téléphonie ou d'agenda précis n'est importé (seulement les registres et les types)", () => {
  for (const f of [...POSTE, ...LIB, ...ACTIONS]) {
    for (const m of lire(f).matchAll(/from "@\/lib\/(telephonie|agenda)\/([\w-]+)"/g)) {
      assert.ok(["registre", "types"].includes(m[2]), `${f} : import d'un adaptateur précis (${m[1]}/${m[2]})`);
    }
  }
  assert.match(lire("app/(app)/poste/Poste.tsx"), /adaptateurTelephonie\(fournisseur\)/);
  assert.match(lire("app/(app)/poste/page.tsx"), /adaptateurAgenda\(niche\.agenda\.fournisseur\)/);
});

test("aucun export de fichier (CSV ou autre) dans les prospects ni le Poste", () => {
  for (const f of [...POSTE, ...ACTIONS]) assert.doesNotMatch(lire(f), /text\/csv|\.csv\b|new Blob|download=/i, f);
});

test("le slot <FicheBlocs leadId=…/> de L0 est placé dans la fiche prospect, après les sections du lot", () => {
  const fiche = lire("app/(app)/prospects/[id]/page.tsx");
  assert.match(fiche, /<FicheBlocs leadId=\{f\.id\} \/>/);
  assert.ok(fiche.indexOf("<FicheBlocs leadId") > fiche.indexOf(`titre="Chronologie"`), "après la chronologie");
});

test("tout ce qui est dit au prospect vient de la config : aucun texte de script écrit en dur dans le Poste", () => {
  const ecran = POSTE.map((f) => lire(f)).join("\n");
  for (const motif of [/Je vous appelle/i, /je suis bien avec/i, /Bonjour \[/i, /lequel vous arrange/i]) assert.doesNotMatch(ecran, motif);
});

test("téléphonie : un seul élément dédié, préparé une fois par le Poste, avec ses attributs data-* et l'écoute des événements", async () => {
  const poste = lire("app/(app)/poste/Poste.tsx");
  for (const attribut of ['"data-numero"', '"data-schema-lien"', '"data-copier-numero"']) assert.ok(poste.includes(attribut), attribut);
  assert.match(poste, /adaptateur\.client\.preparer\(el\)/);
  assert.match(poste, /EVENEMENT_ETAT_TELEPHONE/);
  assert.match(poste, /<AppelFiche\s+key=\{appel\.fiche\.id\}/, "seule la fiche est remontée à chaque changement, pas le téléphone");
  assert.doesNotMatch(lire("app/(app)/poste/AppelFiche.tsx"), /preparer\(/, "la fiche ne prépare jamais le téléphone");
  assert.match(lire("app/(app)/poste/AppelFiche.tsx"), /EVENEMENT_APPEL_TELEPHONE/);
  // Les noms des événements sont ceux de la téléphonie (lib/telephonie/navigateur.ts) : une seule vérité.
  const appel = await import("../lib/poste/appel.ts");
  const navigateur = await import("../lib/telephonie/navigateur.ts");
  assert.equal(appel.EVENEMENT_ETAT_TELEPHONE, navigateur.EVENEMENT_ETAT);
  assert.equal(appel.EVENEMENT_APPEL_TELEPHONE, navigateur.EVENEMENT_APPEL);
  assert.equal(navigateur.EVENEMENT_ETAT, "telephonie:etat");
  assert.equal(navigateur.EVENEMENT_APPEL, "telephonie:appel");
});

test("rendez-vous reçus automatiquement : le Poste suit la règle de l'agenda (Google compris), jamais une règle à lui", () => {
  const page = lire("app/(app)/poste/page.tsx");
  assert.match(page, /rdvRecusAutomatiquement\(niche\.agenda\.fournisseur, process\.env\)/);
  assert.doesNotMatch(page, /rdvRecusParWebhook/);
  assert.doesNotMatch(lire("lib/poste/rdv.ts"), /export function rdvRecusParWebhook/, "une seule règle : lib/agenda/registre.ts");
});
