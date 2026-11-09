# Contribuer

Merci de ton aide. Le projet est en français : le code, les commentaires, les messages, la documentation et les commits.
Le code de conduite est dans `CODE_OF_CONDUCT.md` ; les gabarits d'issue et de pull request (`.github/`) rappellent les règles ci-dessous.

## Le circuit

1. Une **issue** d'abord pour tout changement de fond : une migration, un contrat partagé (`config/schema.ts`, `lib/telephonie/types.ts`,
   `lib/agenda/types.ts`), un nouveau fournisseur, un nouvel écran. On s'accorde sur le besoin avant d'écrire le code.
2. Une **branche** par changement, à partir de `main`, puis une pull request courte qui dit ce qui change et pourquoi.
3. Avant de pousser, tout est vert :

   ```bash
   npm run lint
   npx tsc --noEmit
   npm test                 # les tests, puis le contrôle de publication (npm run test:publication)
   npm run build
   ```

   Et sur une base **locale** (`supabase start`, avec `SUPABASE_DB_URL` dans `.env.local` vers cette base locale) :

   ```bash
   npm run test:sql         # un test SQL par table, chacun annulé à la fin
   npm run test:base        # les tests node qui ont besoin de la base
   ```

## Les règles

- **Aucune donnée réelle**, nulle part : ni dans les tests, ni dans les exemples, ni dans les captures, ni dans une issue. Les exemples
  sont fictifs : « Atelier Démo 01 », numéros des plages réservées à la fiction (01 99 00 xx xx, 06 39 98 xx xx : la liste plus bas),
  e-mails en `@example.com`, sites en `example.org`, SIREN et SIRET invalides. Aucun fichier de données (CSV, JSONL…) dans le dépôt.
- **Aucun secret** : des noms de variables seulement (`.env.example`). Dans un test, un secret se tire au hasard au moment du test.
- **Le contrôle de publication** (`scripts/test-publication.mjs`, joué par `npm test` et la CI) doit rester vert. S'il signale
  quelque chose, corrige le texte ; ne modifie pas le contrôle.
- **Aucune promesse de résultat** dans la config d'exemple, les textes et la documentation.
- Une **migration** se joue avec son test SQL (`supabase/tests/<table>.sql`, qui commence par `begin;` et finit par `rollback;`) ; une
  nouvelle table a sa RLS et son test.
- Les journaux ne portent que des codes : jamais un nom, un numéro, un e-mail, une adresse ni un secret.
- Rien n'est envoyé automatiquement à un prospect.

Une faille de sécurité ne passe pas par une issue publique : voir `SECURITY.md`.

## Tests et configuration

Les tests node tournent toujours sur la niche d'exemple (`config/niche.exemple.json`) : le chargeur `scripts/charger-ts.mjs` remplace
`config/niche.json` au chargement. Ta vraie configuration est validée à part (schéma et garde-fous, par `npm test`) et par le build. Un
test qui dépend d'une valeur de configuration (fuseau, plafond de tentatives, fournisseur) s'écrit donc d'après l'exemple, jamais
d'après `config/niche.json`.

## Contrôle de publication et termes interdits

`npm test` joue `scripts/test-publication.mjs` ; ses règles sont dans `scripts/lib/publication-regles.mjs`, chacune testée par un
« canari » (`tests/publication-regles.test.mjs`). Sur chaque fichier suivi par git, et sur chaque nouveau fichier non ignoré, il
refuse :

- **une donnée de personne** : un e-mail hors des domaines réservés aux exemples (`example.com`, `example.org`, `example.net`,
  `example.fr`, et les domaines en `.example`, `.test`, `.invalid` ou `.localhost`) ; un numéro de téléphone français hors des
  plages réservées à la fiction par l'ARCEP : 01 99 00 xx xx, 02 61 91 xx xx, 03 53 01 xx xx, 04 65 71 xx xx, 05 36 49 xx xx et
  06 39 98 xx xx (un numéro qui compte cinq zéros de suite passe aussi pour fictif) ; un SIREN ou un SIRET valide (clé de Luhn), même
  écrit avec des espaces ou des points ;
- **un chemin absolu** d'une machine (le dossier personnel d'un compte, sous macOS, Linux ou Windows) ;
- **un renvoi au processus de fabrication du dépôt** (les numéros de lots de travail, un rôle d'orchestration, les contrats dits
  « gelés », les renvois aux sections d'un plan interne) : le lecteur public n'en a que faire ;
- **un secret évident** : clé privée, jeton JWT, clé Stripe, Supabase, GitHub, Slack, Google, Anthropic ou AWS, adresse de base avec
  son mot de passe (hors base locale) ;
- **un fichier de données, d'audio, de vidéo, d'archive ou d'export** (CSV, TSV, JSONL, XLSX, VCF, MP3, PDF, ZIP…), même vide ; du JSON
  hors de la configuration du projet ; un fichier binaire autre qu'une image ou une police ; un `.env` suivi, sauf `.env.example` (des
  noms, sans valeur) ;
- **un `.gitignore` incomplet** : il doit couvrir les données, les secrets, les caches, l'audio, les exports, les transcriptions et
  les dossiers d'outils ;
- **les « termes interdits » du mainteneur** (noms, marques et adresses du projet d'où vient ce code), dans un fichier, un nom de
  fichier ou l'historique git (messages, auteurs). Cette liste n'est pas dans le dépôt : elle révélerait ce qu'elle cache. Le
  mainteneur la fournit par `TERMES_INTERDITS` (une expression régulière par ligne ; en CI, un secret du dépôt) ou
  `TERMES_INTERDITS_FICHIER` (un fichier hors du dépôt), au besoin dans `.env.local`. Sans liste, le contrôle le dit et saute
  seulement cette partie : les autres vérifications restent bloquantes. Un contributeur n'a donc rien à configurer.

En cas d'échec, il donne le fichier, la ligne et la règle, jamais la valeur trouvée (pour un terme interdit : son numéro dans la
liste).
