// Les règles du contrôle de publication (scripts/test-publication.mjs), en fonctions PURES pour être testées une à une
// (tests/publication-regles.test.mjs : un « canari » par règle). Aucune lecture de fichier ici : le script lit, ces fonctions jugent.
//
// Ce que le dépôt public ne doit jamais contenir :
//   - une donnée de personne : e-mail hors des domaines réservés aux exemples, numéro de téléphone français hors des plages fictives de
//     l'ARCEP, SIREN ou SIRET valide (clé de Luhn), même écrits avec des espaces ;
//   - un chemin absolu d'une machine (/Users/…, /home/…, C:\Users\…) ;
//   - un secret évident, ou une adresse de base avec son mot de passe ;
//   - un fichier de données, d'audio, d'archive ou d'export (CSV, JSONL, MP3, PDF, VCF…), même vide ;
//   - un des « termes interdits » du mainteneur (liste fournie hors du dépôt), dans un fichier, un chemin ou l'historique git.

/** Les plages de numéros réservées à la fiction par l'ARCEP (après le 0 : 01 99 00, 02 61 91, 03 53 01, 04 65 71, 05 36 49, 06 39 98). */
export const PLAGES_FICTIVES_FR = ["19900", "26191", "35301", "46571", "53649", "63998"];

/** Les domaines d'e-mail permis : réservés aux exemples (RFC 2606 et 6761) ou sans boîte réelle. */
export const DOMAINES_EMAIL_PERMIS = /(^|\.)example\.(com|org|net|fr)$|\.example$|\.test$|\.invalid$|\.localhost$|^users\.noreply\.github\.com$/i;

export const SECRETS = [
  ["clé privée", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["jeton JWT", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["clé Stripe", /\b[sr]k_(live|test)_[A-Za-z0-9]{10,}/],
  ["clé Supabase", /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["jeton Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["clé Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["clé Anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["clé d'accès AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["URL de base avec mot de passe", /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s]{3,}@(?!127\.0\.0\.1|localhost)/],
];

/** Les fichiers refusés quel que soit leur contenu : données, exports, audio, vidéo, archives, documents. */
export const EXTENSIONS_REFUSEES =
  /\.(csv|tsv|jsonl|ndjson|xlsx|xls|ods|sqlite|sqlite3|db|parquet|vcf|mp3|wav|m4a|ogg|oga|webm|aac|amr|flac|mp4|mov|avi|pdf|zip|gz|tgz|tar|7z|rar|bz2|xz)$/i;
/** Les images et polices sont permises et ne sont pas lues. */
export const EXTENSIONS_BINAIRES_PERMISES = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf)$/i;
/** Le JSON ne sert qu'à la configuration du projet. */
export const JSON_PERMIS = new Set(["package.json", "package-lock.json", "tsconfig.json", "vercel.json", "config/niche.json", "config/niche.exemple.json"]);

/** Ce que .gitignore doit couvrir : données, secrets, caches, audio, exports, transcriptions, dossiers d'outils. */
export const IGNORES_ATTENDUS = [
  "donnees/", "*.csv", ".env*", "cache/", "scratchpad/",
  "*.mp3", "*.wav", "*.m4a", "*.ogg", "*.webm", "*.aac", "*.amr",
  "*.vcf", "*.xlsx", "*.xls", "*.ods", "*.tsv", "*.jsonl",
  "transcript*", ".claude/", ".playwright-mcp/", "test-results/", "playwright-report/",
];

/** Vrai si la suite de chiffres (9 ou 14) passe la clé de Luhn : un SIREN ou un SIRET réel. */
export function luhn(chiffres) {
  if (!/^\d+$/.test(chiffres)) return false;
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let c = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) c = c * 2 > 9 ? c * 2 - 9 : c * 2;
    somme += c;
  }
  return somme % 10 === 0;
}

/** Les SIREN (9 chiffres) et SIRET (14) valides par Luhn, écrits d'un bloc ou par groupes séparés d'espaces ou de points. */
export function sirensReels(texte) {
  const trouves = [];
  for (const m of texte.matchAll(/(?<![\d+.-])(\d{3}[ .]?\d{3}[ .]?\d{3}(?:[ .]?\d{5})?)(?![\d.-]?\d)/g)) {
    const chiffres = m[1].replace(/[ .]/g, "");
    if ((chiffres.length === 9 || chiffres.length === 14) && !/^0+$/.test(chiffres) && luhn(chiffres)) trouves.push(m[1]);
  }
  return trouves;
}

/** Les numéros français (0X XX XX XX XX ou +33 X XX XX XX XX) hors des plages fictives de l'ARCEP. */
export function telephonesFrReels(texte) {
  const trouves = [];
  // Pas collé à une lettre, un chiffre ou un tiret : « jeton-de-test-0123456789 » n'est pas un numéro. Un numéro « à zéros » (cinq zéros de
  // suite, comme 04 70 00 00 01 pour un format étranger écrit en national) est tenu pour fictif.
  for (const m of texte.matchAll(/(?<![\w+.-])(?:\+33[ .-]?|0)([1-9])(?:[ .-]?(\d{2})){4}(?![\w-])/g)) {
    const chiffres = m[0].replace(/^\+33/, "0").replace(/[ .-]/g, "");
    if (!PLAGES_FICTIVES_FR.includes(chiffres.slice(1, 6)) && !/0{5}/.test(chiffres.slice(1))) trouves.push(m[0]);
  }
  return trouves;
}

/** Les e-mails dont le domaine n'est pas réservé aux exemples. */
export function emailsReels(texte) {
  const trouves = [];
  // Le domaine finit par des lettres : « utilisateur@127.0.0.1 » (une adresse de base) n'est pas un e-mail.
  // Un nom de fichier (« logo@2x.png ») n'est pas un e-mail : les extensions de fichiers ne sont pas des domaines.
  for (const m of texte.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?!(?:png|jpe?g|gif|svg|webp|ico|js|mjs|ts|tsx|css|json|md|txt|html)\b)[A-Za-z]{2,})(?![A-Za-z0-9-])/g)) {
    if (!DOMAINES_EMAIL_PERMIS.test(m[1])) trouves.push(m[0]);
  }
  return trouves;
}

/** Les chemins absolus d'une machine personnelle. */
export function cheminsAbsolus(texte) {
  return [...texte.matchAll(/(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[a-z][A-Za-z0-9._-]*|[A-Z]:\\Users\\[^\\\s"']+)/g)].map((m) => m[0]);
}

/** Les traces du processus de fabrication du dépôt (lots, orchestrateur, contrats gelés, renvois au plan) : rien à dire au lecteur public. */
export const PROCESSUS_INTERNE = /\blots? L[0-9]\b|orchestrateur|CONTRAT GELÉ|\bplan, section\b/iu;

/** Les constats sur une LIGNE de texte : [regle, detail]. `termes` : les expressions régulières du mainteneur, ou null. */
export function problemesDeLigne(texte, termes, options = {}) {
  const constats = [];
  if (termes) termes.forEach((re, k) => { if (re.test(texte)) constats.push(["terme interdit", `n°${k + 1} de la liste`]); });
  for (const [nom, motif] of SECRETS) if (motif.test(texte)) constats.push([`secret probable : ${nom}`, ""]);
  if (sirensReels(texte).length) constats.push(["numéro SIREN ou SIRET valide (réel ?)", ""]);
  if (telephonesFrReels(texte).length) constats.push(["numéro de téléphone hors des plages fictives (01 99 00, 02 61 91, 03 53 01, 04 65 71, 05 36 49, 06 39 98)", ""]);
  if (emailsReels(texte).length) constats.push(["adresse e-mail hors des domaines d'exemple (example.*, *.example, *.test, *.invalid)", ""]);
  if (!options.cheminsPermis && cheminsAbsolus(texte).length) constats.push(["chemin absolu d'une machine", ""]);
  if (!options.processusPermis && PROCESSUS_INTERNE.test(texte)) constats.push(["renvoi au processus de fabrication du dépôt (lot, orchestrateur, contrat gelé, plan)", ""]);
  return constats;
}

/** Les constats sur un CHEMIN de fichier du dépôt. */
export function problemesDeChemin(fichier, termes) {
  const constats = [];
  if (EXTENSIONS_REFUSEES.test(fichier)) constats.push(["fichier de données, d'audio, d'archive ou d'export interdit dans le dépôt", ""]);
  if (fichier.endsWith(".json") && !JSON_PERMIS.has(fichier)) constats.push(["JSON hors de la configuration du projet (données ?)", ""]);
  if (/(^|\/)\.env/.test(fichier) && fichier !== ".env.example") constats.push(["fichier .env suivi par git", ""]);
  if (termes) termes.forEach((re, k) => { if (re.test(fichier)) constats.push(["terme interdit dans le nom du fichier", `n°${k + 1} de la liste`]); });
  return constats;
}

/** Les entrées manquantes de .gitignore. */
export function ignoresManquants(contenuGitignore) {
  const lignes = contenuGitignore.split("\n").map((l) => l.trim());
  return IGNORES_ATTENDUS.filter((e) => !lignes.includes(e));
}

/** Le texte du verrou npm, sans les empreintes (du base64 : trois lettres y forment n'importe quel mot). */
export function sansEmpreintes(contenu) {
  return contenu.replace(/"integrity": "[^"]*"/g, '"integrity": ""');
}
