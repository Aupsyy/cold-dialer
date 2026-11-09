// Contrôles statiques de l'écran Réglages (sans base, sans navigateur) : la page n'est plus « à venir » ; chaque action passe par run() ;
// chaque geste qui efface ou retire se confirme ; aucun texte (de la config ou d'ailleurs) n'est rendu en HTML brut ; le navigateur ne
// charge ni la clé service ni le stockage ; les journaux ne portent que des codes ; lib/reglages reste pur ; le pied de page montre le
// contact RGPD ; « Effacer cette fiche » est réservé au propriétaire ; les docs ne disent plus que tout cela se fait en SQL.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RACINE, lire } from "./aides.mjs";

const racine = fileURLToPath(RACINE);

function fichiers(dossier) {
  const sortie = [];
  const parcourir = (rel) => {
    for (const nom of readdirSync(join(racine, rel))) {
      const r = `${rel}/${nom}`;
      if (statSync(join(racine, r)).isDirectory()) parcourir(r);
      else if (/\.(ts|tsx)$/.test(nom)) sortie.push(r);
    }
  };
  parcourir(dossier);
  return sortie.sort();
}

const ECRAN = fichiers("app/(app)/reglages");
const COMPOSANTS = ECRAN.filter((f) => f.includes("/_composants/"));
const LIB = fichiers("lib/reglages");
const ACTIONS = "app/(app)/reglages/actions.ts";

test("la page Réglages est un vrai écran : plus d'EcranAVenir, les sections de l'équipe réservées aux gestionnaires", () => {
  const page = lire("app/(app)/reglages/page.tsx");
  assert.doesNotMatch(page, /EcranAVenir|arrive bientôt/);
  for (const section of ["Mon profil", "Aide de mes outils", "Équipe", "Invitations", "Appels : plafond et objectif", "Enregistrement des appels", "RGPD"]) {
    assert.ok(page.includes(`titre="${section}"`), `section ${section}`);
  }
  assert.ok(page.indexOf("{gestionnaire ? (") < page.indexOf('titre="Équipe"'), "l'équipe et la suite sous la condition gestionnaire");
  assert.ok(page.indexOf('titre="Aide de mes outils"') < page.indexOf("{gestionnaire ? ("), "l'appelant voit son profil et l'aide de son outil");
  assert.match(page, /export const maxDuration = 60;/, "la purge efface des audios : plus de temps que par défaut");
  assert.match(page, /vueAide\(niche, process\.env\)/, "des noms de variables, lus côté serveur");
});

test("chaque action est « use server », n'exporte que des fonctions asynchrones, et chacune passe par run()", () => {
  const t = lire(ACTIONS);
  assert.match(t.trimStart(), /^"use server";/);
  for (const m of t.matchAll(/^export\s+(?!async function|interface|type)(\S+)/gm)) assert.fail(`export interdit dans un fichier « use server » (${m[1]})`);
  const fonctions = [...t.matchAll(/^export async function (\w+)[\s\S]*?^}/gm)];
  assert.ok(fonctions.length >= 14, "les gestes de l'écran");
  for (const [corps, nom] of fonctions) assert.match(corps, /return run\(/, `${nom} doit passer par run()`);
  const besoin = (nom) => new RegExp(`export async function ${nom}[\\s\\S]*?return run\\("[\\w.]+", "(\\w+)"`).exec(t)?.[1];
  for (const nom of ["changerRole", "retirerMembre", "effacerFiche"]) assert.equal(besoin(nom), "proprietaire", nom);
  for (const nom of ["definirEmailTelephonie", "creerInvitation", "revoquerInvitation", "activerEnregistrement", "desactiverEnregistrement", "alignerTentatives", "modifierObjectif", "compterPurge", "purgerMaintenant"]) {
    assert.equal(besoin(nom), "gestionnaire", nom);
  }
  for (const nom of ["chargerReglages", "modifierMonNom"]) assert.equal(besoin(nom), "equipe", nom);
});

test("la clé service ne sert qu'à la purge et à l'effacement des appels, après le contrôle du rôle ; jamais dans le navigateur", () => {
  const t = lire(ACTIONS);
  const usages = [...t.matchAll(/^export async function (\w+)[\s\S]*?^}/gm)].filter(([corps]) => /clientService\(\)/.test(corps)).map((m) => m[1]);
  assert.deepEqual(usages.sort(), ["compterPurge", "effacerFiche", "purgerMaintenant"], "compterPurge dit seulement si la clé est là");
  assert.doesNotMatch(t.match(/export async function compterPurge[\s\S]*?^}/m)[0], /service\.|\.rpc\(/, "le comptage reste sous la RLS");
  for (const f of COMPOSANTS) {
    const c = lire(f);
    assert.match(c.trimStart(), /^"use client";/, `${f} : composant client`);
    assert.doesNotMatch(c, /supabase\/service|telephonie\/stockage|SERVICE_ROLE_KEY"|process\.env/, `${f} : rien du serveur dans le navigateur`);
    for (const m of c.matchAll(/^import (?!type )[^;]*from "@\/lib\/reglages\/(\w+)"/gm)) {
      assert.equal(m[1], "libelles", `${f} : lib/reglages/${m[1]} ne s'importe dans le navigateur qu'en type (seul libelles.ts, sans import, y va)`);
    }
  }
});

test("l'effacement ne relit pas la page (sinon Next.js rend la fiche effacée en 404) ; les formulaires gardent la saisie refusée", () => {
  const t = lire(ACTIONS);
  const effacer = t.match(/export async function effacerFiche[\s\S]*?^}/m)[0];
  assert.doesNotMatch(effacer, /revalidatePath\(/);
  assert.ok(effacer.indexOf("effacerDuStockage(") < effacer.indexOf('.from("appels").delete()'), "les audios avant les appels");
  for (const f of COMPOSANTS) assert.doesNotMatch(lire(f), /<form action=/, `${f} : onSubmit={soumettre(…)}, React viderait le formulaire`);
});

test("chaque geste qui retire ou efface se confirme (window.confirm) avant d'appeler l'action", () => {
  const destructifs = { retirerMembre: "Equipe.tsx", revoquerInvitation: "Invitations.tsx", purgerMaintenant: "Purge.tsx", effacerFiche: "EffacerFiche.tsx" };
  for (const [action, fichier] of Object.entries(destructifs)) {
    const c = lire(`app/(app)/reglages/_composants/${fichier}`);
    const appels = [...c.matchAll(new RegExp(`\\b${action}\\(`, "g"))].map((m) => m.index);
    assert.ok(appels.length > 0, `${fichier} : appelle ${action}`);
    for (const i of appels) {
      const debut = c.lastIndexOf("function ", i);
      assert.ok(c.slice(debut, i).includes("window.confirm("), `${fichier} : ${action} sans confirmation`);
    }
  }
});

test("aucun texte rendu en HTML brut ; aucun journal dans les composants ; les journaux des actions portent des codes", () => {
  for (const f of [...ECRAN, "app/(app)/layout.tsx", "app/(app)/prospects/[id]/page.tsx"]) {
    assert.doesNotMatch(lire(f), /dangerouslySetInnerHTML|innerHTML/, `${f} : pas de HTML brut`);
  }
  for (const f of COMPOSANTS) assert.doesNotMatch(lire(f), /console\./, `${f} : pas de journal dans le navigateur`);
  const t = lire(ACTIONS);
  const consoles = [...t.matchAll(/console\.\w+\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(consoles, ["`[reglages] ${code}`"], "un seul journal, en codes");
  assert.doesNotMatch(t, /journal\([^)]*(jeton|email|chemin|nom)\b/, "jamais une donnée dans le journal");
  assert.match(lire("app/(app)/reglages/_composants/Invitations.tsx"), /lienInvitation\(window\.location\.origin, d\.jeton\)/, "le lien est construit dans le navigateur, montré une fois");
});

test("lib/reglages reste PUR : ni Node, ni Next, ni server-only ; les textes n'ont ni tiret cadratin ni promesse", () => {
  for (const f of LIB) {
    const t = lire(f);
    assert.doesNotMatch(t, /from "node:|from "next\/|server-only|^"use (client|server)"/m, f);
    assert.ok(!t.includes("—"), `${f} : tiret cadratin`);
    assert.doesNotMatch(t, /\bgaranti(?:e|es|s)?\b|\bassurée?s?\b|sans risque/i, `${f} : aucune promesse de résultat`);
  }
  assert.doesNotMatch(lire("lib/reglages/libelles.ts"), /^import /m, "libelles.ts : aucun import (chargé par le navigateur)");
});

test("le pied de page montre l'équipe et le contact RGPD de la config ; « Effacer cette fiche » est réservé au propriétaire", () => {
  const coquille = lire("app/(app)/layout.tsx");
  assert.match(coquille, /<footer[\s\S]*niche\.marque\.nomEquipe[\s\S]*niche\.legal\.contactRGPD[\s\S]*<\/footer>/);
  const fiche = lire("app/(app)/prospects/[id]/page.tsx");
  assert.match(fiche, /\{ctx\?\.role === "proprietaire" \? <EffacerFiche leadId=\{f\.id\} entreprise=\{f\.entreprise\} opposee=\{opposition\} \/> : null\}/);
  assert.ok(fiche.indexOf("<EffacerFiche") > fiche.indexOf("<FicheBlocs leadId"), "après les blocs de la fiche");
});

test("les docs ne disent plus que l'écran Réglages est à venir, ni que l'enregistrement, l'effacement et la purge se font en SQL", () => {
  const docs = ["README.md", "docs/installation.md", "docs/legal.md", "skills/installer/SKILL.md"].map((f) => [f, lire(f)]);
  for (const [f, t] of docs) {
    for (const motif of [/Réglages est (encore )?à venir/i, /écran Réglages, qui (gérera|fera)/i, /aucun écran ne le fait/i, /tant que l'écran Réglages n'existe pas/i, /En attendant l'écran Réglages/i]) {
      assert.doesNotMatch(t, motif, `${f} : ${motif}`);
    }
  }
  const legal = lire("docs/legal.md");
  assert.match(legal, /scripts\/maintenance\/purger\.mjs/);
  assert.match(legal, /Effacer cette fiche/);
  assert.match(lire("docs/installation.md"), /Réglages/);
});
