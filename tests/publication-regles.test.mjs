// Un « canari » par règle du contrôle de publication (scripts/lib/publication-regles.mjs) : une fuite synthétique est vue, un texte
// propre passe. Les exemples ci-dessous sont inventés et s'écrivent de façon à ne pas être pris pour une vraie donnée.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROCESSUS_INTERNE,
  cheminsAbsolus,
  emailsReels,
  ignoresManquants,
  luhn,
  problemesDeChemin,
  problemesDeLigne,
  sansEmpreintes,
  sirensReels,
  telephonesFrReels,
} from "../scripts/lib/publication-regles.mjs";

/** Un SIREN qui passe la clé de Luhn, construit ici pour ne pas en écrire un dans le dépôt. */
function sirenValide() {
  for (let n = 100000001; n < 100000100; n++) if (luhn(String(n))) return String(n);
  throw new Error("aucun");
}

test("SIREN et SIRET : valide par Luhn vu, d'un bloc ou avec des espaces ; invalide, zéros et numéro de téléphone ignorés", () => {
  const s = sirenValide();
  assert.deepEqual(sirensReels(`siren ${s} ici`), [s]);
  assert.equal(sirensReels(`${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}`).length, 1);
  assert.deepEqual(sirensReels("000000001 000000002"), []);
  assert.deepEqual(sirensReels("+33199000101"), []);
  assert.deepEqual(sirensReels("id 1793879564321 ms"), []);
});

test("téléphones français : hors plages fictives vu ; plages ARCEP permises ; étrangers non concernés", () => {
  const faux = (p) => p.join(" ");
  assert.equal(telephonesFrReels(`appelle le ${faux(["06", "12", "34", "56", "78"])}`).length, 1);
  assert.equal(telephonesFrReels(`+33 ${faux(["7", "12", "34", "56", "78"])}`).length, 1);
  assert.deepEqual(telephonesFrReels("01 99 00 12 34, 06 39 98 00 01, +33199000101, +33639980001, 02 61 91 00 00"), []);
  assert.deepEqual(telephonesFrReels("+32 2 000 00 01"), []);
  assert.deepEqual(telephonesFrReels("jeton-de-test-0123456789 et 0470 00 00 01 (format national belge, à zéros)"), [], "jeton et numéro à zéros");
});

test("e-mails : domaine réel vu ; example.*, .example, .test, .invalid, noreply GitHub permis", () => {
  assert.equal(emailsReels(`écris à ${["paul.dupont", "fournisseur-reel.com"].join("@")}`).length, 1);
  assert.deepEqual(emailsReels("postgresql://postgres:postgres@127.0.0.1:54322/postgres"), [], "une adresse de base n'est pas un e-mail");
  assert.deepEqual(emailsReels("contact@example.com, a@messagerie.example, b@equipe.test, c@x.invalid, 1+x@users.noreply.github.com"), []);
  assert.deepEqual(emailsReels("<img src=\"logo@2x.png\">"), [], "un nom de fichier");
});

test("chemins absolus : /Users, /home, C:\\Users vus ; ~ et chemins relatifs permis", () => {
  const chemin = (p) => p.join("/");
  assert.equal(cheminsAbsolus(`lu dans ${chemin(["", "Users", "quelquun", "Documents"])}`).length, 1);
  assert.equal(cheminsAbsolus(chemin(["", "home", "jean", "x"])).length, 1);
  assert.equal(cheminsAbsolus(["C:", "Users", "jean", "x"].join("\\")).length, 1);
  assert.deepEqual(cheminsAbsolus("~/Claude/dossier et ./scripts/x et /usr/local/bin"), []);
});

test("secrets : clé Anthropic, AWS, adresse de base avec mot de passe (hors locale)", () => {
  const regles = (t) => problemesDeLigne(t, null).map(([r]) => r);
  assert.ok(regles(`cle = "sk-ant-${"a".repeat(24)}"`).some((r) => r.includes("Anthropic")));
  assert.ok(regles(["AKIA", "ABCDEFGHIJKLMNOP"].join("")).some((r) => r.includes("AWS")));
  assert.ok(regles(["mongodb:/", "u:motdepasse@serveur.example", "x"].join("/")).some((r) => r.includes("mot de passe")));
  assert.deepEqual(regles("postgresql://postgres@127.0.0.1:54322/postgres"), []);
});

test("termes interdits : vus dans une ligne et dans un chemin, par numéro seulement", () => {
  const termes = [/tartempion/i, /soci[ée]t[ée] bidule/i];
  assert.deepEqual(problemesDeLigne("Ancien nom : Tartempion", termes), [["terme interdit", "n°1 de la liste"]]);
  assert.deepEqual(problemesDeChemin("docs/societe-bidule.md", termes), []);
  assert.deepEqual(problemesDeChemin("docs/tartempion.md", termes), [["terme interdit dans le nom du fichier", "n°1 de la liste"]]);
  assert.deepEqual(problemesDeLigne("rien à voir", termes), []);
});

test("chemins : données, audio, archives, exports et JSON hors configuration refusés ; images et sources permises", () => {
  for (const f of ["donnees/x.csv", "a/b.jsonl", "audio/appel.mp3", "x.pdf", "x.zip", "contacts.vcf", "export.xlsx", "tests/fixture.json", "config/niches/sous/dossier.json", "config/niches/Majuscule.json", ".env.local"]) {
    assert.ok(problemesDeChemin(f, null).length > 0, f);
  }
  for (const f of ["app/icon.svg", "docs/capture.png", "lib/x.ts", "config/niche.json", "config/niches/paysagistes.json", "package.json", ".env.example"]) {
    assert.deepEqual(problemesDeChemin(f, null), [], f);
  }
});

test(".gitignore : les entrées attendues ; le verrou npm sans ses empreintes", () => {
  assert.ok(ignoresManquants("node_modules\n").includes("*.mp3"));
  assert.deepEqual(ignoresManquants(["donnees/", "*.csv", ".env*", "cache/", "scratchpad/", "*.mp3", "*.wav", "*.m4a", "*.ogg", "*.webm", "*.aac", "*.amr", "*.vcf", "*.xlsx", "*.xls", "*.ods", "*.tsv", "*.jsonl", "transcript*", ".claude/", ".playwright-mcp/", "test-results/", "playwright-report/"].join("\n")), []);
  assert.equal(sansEmpreintes('"integrity": "sha512-abc"'), '"integrity": ""');
});

test("processus interne : « lot L3 », « orchestrateur », « CONTRAT GELÉ » vus ; « lotissement » et « L3 » seuls permis", () => {
  for (const x of ["livré au lot L3", "sur demande à l'orchestrateur", "CONTRAT GELÉ", "voir le plan, section 7"]) assert.ok(PROCESSUS_INTERNE.test(x), x);
  for (const x of ["un lotissement", "la vitamine L3", "le plan de la ville"]) assert.ok(!PROCESSUS_INTERNE.test(x), x);
  assert.ok(problemesDeLigne("fini au lot L2", null).some(([regle]) => regle.includes("processus")));
});
