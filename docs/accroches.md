# Les accroches : la première phrase de l'appel, tirée du site du prospect

Une accroche est UNE phrase que l'appelant dit en ouvrant l'appel, pour montrer qu'il a vraiment regardé le site de l'entreprise :
elle cite un élément vérifiable de ce site (un projet, un lieu, une spécialité, une date de création), puis pose une question ouverte.
Le Poste l'affiche en haut de la fiche, avec le lien de la page d'où elle vient.

> Exemple fictif (niche d'exemple, paysagistes) : « J'ai vu sur votre site le bassin naturel réalisé à Vienne en 2019 : c'est ce type
> de chantier que vous voulez développer ? »

**Règle d'or : rien d'inventé.** Chaque mot précis de l'accroche (lieu, nom, année, nombre, matériau, spécialité) doit figurer sur le
site. Une accroche signalée par le contrôle est **vidée, jamais corrigée** : une accroche vide ne gêne personne, une accroche fausse
grille l'appel.

L'application n'a aucune clé d'IA : les scripts lisent les sites, préparent des lots, contrôlent et écrivent en base ; c'est Claude Code
(le skill `accroches`) qui écrit les phrases, lot par lot, en suivant la consigne.

## Le parcours

Toutes les commandes se lancent à la racine du dépôt. Les fichiers de travail vont dans `donnees/accroches/` (ignoré par git).

| Étape | Commande | Lit | Écrit |
|---|---|---|---|
| 1. Fiches à traiter | `node scripts/accroches/export.mjs` | la base (lecture seule) | `a-crawler.json` |
| 2. Lecture des sites | `node scripts/accroches/crawl.mjs` | `a-crawler.json` | `crawl.jsonl` |
| 3. Lignes utiles | `node scripts/accroches/compact.mjs` | `crawl.jsonl` | `compact.jsonl` |
| 4. Lots pour Claude | `node scripts/accroches/lots.mjs` | `compact.jsonl` | `lots/lot-001.md`… |
| 5. Écriture des accroches | Claude, lot par lot, selon la consigne | `lots/lot-001.md` | `reponses/lot-001.json` |
| 6. Contrôle anti-invention | `node scripts/accroches/valide.mjs` | réponses, crawl, compact | `validees.json`, `rapport-validation.md` |
| 7. Relecture humaine | `node scripts/accroches/revue.mjs` | `validees.json` | `revue.md` |
| 8. Écriture en base, essai | `node scripts/accroches/ecrire.mjs` | `validees.json`, `crawl.jsonl`, `compact.jsonl` | rien (des compteurs) |
| 9. Écriture en base | `node scripts/accroches/ecrire.mjs --appliquer` | `validees.json`, `crawl.jsonl`, `compact.jsonl` | la base, en une transaction |
| 10. Ménage, après l'écriture | `rm -r donnees/accroches` | | |

Chaque script affiche seulement des compteurs, jamais un nom, une adresse ni un texte de site. `--aide` donne ses options.

1. **export** garde les fiches qui ont un site et pas encore d'accroche, au statut « à appeler » ou « à rappeler », hors liste
   d'opposition, les mieux notées d'abord. Options : `--tiers A,B`, `--limite N`, `--tous-statuts` (tous sauf « ne plus contacter »).
   On peut aussi écrire `a-crawler.json` à la main : `[{ "id": "…", "entreprise": "…", "site": "https://…" }]`.
2. **crawl** lit chaque site (voir « Respect des sites » plus bas). Il reprend où il s'est arrêté : un site déjà lu n'est jamais relu.
   Options : `--limite N` (pour un essai), `--paralleles N` (4 par défaut, 16 au plus), `--refaire-erreurs`.
3. **compact** garde, mot pour mot, les titres et les phrases utiles de chaque site : celles qui contiennent un mot indice, un lieu,
   une année ou un nom propre (et, en dernier, les autres phrases des pages internes), dans la limite de 2 000 caractères par site
   (`--max-caracteres N`). Il écarte le bruit (cookies, droits réservés…) et toute ligne qui porte un e-mail, un numéro de téléphone
   ou un identifiant légal : Claude n'en a pas besoin.
4. **lots** découpe en lots de 50 fiches (`--taille N`), chaque lot avec la consigne remplie en tête et le nom du fichier de réponse à
   écrire. Les fiches déjà répondues ne sont pas remises dans un lot ; les lots sans réponse sont refaits.
5. **Claude** lit un lot et écrit son fichier de réponse (format ci-dessous). Il ne fait rien d'autre : pas de recherche web, pas
   d'autre page, pas de base.
6. **valide** relit chaque accroche mot à mot (voir « Ce que vérifie le contrôle »). `validees.json` garde, pour chaque fiche
   répondue, l'accroche retenue avec sa source datée, ou l'accroche vidée avec ses motifs.
7. **revue** écrit `revue.md` : chaque accroche retenue, l'extrait du site qui la prouve et la page, puis les accroches vidées et
   pourquoi. Une accroche qui ne convient pas se vide : `node scripts/accroches/revue.mjs --vider <id>[,<id>…]`. On ne la réécrit pas.
8. **ecrire** rejoue d'abord le contrôle anti-invention de `valide.mjs` sur chaque accroche, contre `crawl.jsonl` et `compact.jsonl` :
   une entrée de `validees.json` modifiée après coup (à la main, ou par un agent trompé par le texte d'un site) n'est écrite que si le
   site prouve encore ce qu'elle dit. Garde donc ces deux fichiers jusqu'à l'écriture. Puis il confronte les accroches à la base et
   affiche : à écrire, déjà remplies, inconnues, écartées (« ne plus contacter »), refusées (mal formées, contrôle rejoué en échec, ou
   source hors du site de la fiche). Rien n'est écrit sans `--appliquer`.
9. **ecrire --appliquer** écrit, dans UNE transaction, seulement sur les fiches dont l'accroche est vide : `leads.accroche`,
   `leads.accroche_source` (la page) et une entrée datée dans `leads.sources` : `{ "type": "accroche", "url": …, "extrait": …, "le":
   "AAAA-MM-JJ" }` (d'où vient l'information, et quand elle a été lue). Rejouer ne change rien : une accroche n'est jamais écrasée.
10. **Ménage** : une fois les accroches écrites, les textes des sites ne servent plus. Supprime `donnees/accroches/`, pas avant :
    l'écriture relit `crawl.jsonl` et `compact.jsonl`.

`export.mjs` et `ecrire.mjs` lisent l'adresse de la base dans `SUPABASE_DB_URL` (environnement ou `.env.local`) ; elle n'est jamais
affichée. Vers une base distante, ils vérifient le certificat si `SUPABASE_DB_CA` est posée (`docs/installation.md`, étape 2.3) ; sans
elle, ils le disent. Si la base a plusieurs équipes, ils exigent `--workspace <uuid>` (sinon, la seule équipe). Les autres scripts ne
touchent pas la base. Tous prennent `--config <fichier>` (une autre config que `config/niche.json` ; sauf `revue.mjs`) et
`--dossier <chemin>` (un autre dossier de travail que `donnees/accroches/` ; sauf `consigne.mjs`).

## Le format des réponses

Un fichier par lot, `donnees/accroches/reponses/lot-001.json` : un tableau JSON, une entrée par fiche, dans l'ordre du lot.

```json
[
  {
    "id": "identifiant de la fiche",
    "accroche": "La phrase.",
    "source": { "url": "adresse de la page lue", "extrait": "passage du site recopié mot pour mot (12 à 300 caractères)" }
  },
  { "id": "identifiant d'une fiche sans élément précis", "accroche": "", "source": null }
]
```

## Ce que vérifie le contrôle (valide.mjs)

Une accroche est retenue seulement si :

- c'est UNE phrase propre : majuscule au début, point, point d'interrogation ou d'exclamation à la fin, de 15 à 30 mots,
  `accroche.longueurMax` caractères au plus (160 au maximum), sans tiret long ni emoji ;
- elle ne contient **aucune promesse ni chiffre de résultat** : les motifs des garde-fous de la config (`config/garde-fous.ts`), plus
  « garanti », « assuré », « résultats », « rentable », « doubler », « + 30 % », « 10 demandes », « 5 clients par mois »… ;
- elle ne contient **aucune flatterie vide** (« magnifique », « superbe », « incroyable », « bravo »…) ni aucun mot de
  `accroche.interdits` ;
- sa **source** désigne une page lue par le crawl pour CETTE fiche, et l'**extrait** figure sur cette page (sans tenir compte des
  accents, de la casse ni de la ponctuation) ;
- chaque **nom propre, lieu, année, nombre et mot rare** figure dans le texte compacté du site (celui que Claude a lu). « Mot rare » :
  tout mot hors des mots courants d'une formule d'accroche (« j'ai vu sur votre site », « c'est ce type de chantier que vous voulez
  développer ? »). Le pluriel et le féminin sont tolérés pour les mots rares, pas pour les noms propres ni les nombres ;
- elle cite au moins un tel élément, et l'extrait contient au moins l'un d'eux (la source prouve bien ce qui est dit) ;
- un superlatif ou un rang (« le plus », « plus grand », « premier », « dernier », « seul », « unique »…) n'y figure que si l'extrait
  le dit lui-même.

Les motifs (dans `validees.json` et le rapport) : `format` (réponse mal formée), `longueur`, `phrase`, `tiret`, `promesse`, `flatterie`,
`interdit`, `source`, `source_hors_crawl`, `extrait`, `extrait_absent`, `extrait_sans_rapport`, `lieu_absent`, `nom_propre_absent`,
`annee_absente`, `nombre_absent`, `mot_absent`, `aucun_element`, `superlatif_absent`, `revue` (vidée à la relecture).

Le contrôle est lexical : il vérifie que les mots sont sur le site, pas que la phrase dit vrai. Une phrase peut assembler des mots
vrais en une idée fausse : la relecture humaine de `revue.md` reste indispensable avant `--appliquer`.

## Respect des sites

- **Sources publiques seulement** : le site de l'entreprise, rien d'autre. Jamais LinkedIn, jamais un réseau social, jamais une page
  derrière un compte. Une fiche dont le « site » est en fait un réseau social, un annuaire, une carte ou une plateforme d'avis
  (LinkedIn, Facebook, Instagram, Pages Jaunes, Google Maps…) n'est pas lue du tout : `site_hors_perimetre`, aucune requête. Rien
  n'est jamais envoyé à un prospect.
- **robots.txt lu et respecté** avant toute page : le groupe de notre robot s'il existe, sinon le groupe `*` ; la règle la plus
  longue gagne, `Allow` gagne à égalité ; `*` et `$` compris. robots.txt absent (4xx, sauf 429) : tout est permis. Trop de
  requêtes (429) ou serveur en panne (5xx) : le site est fermé (`robots_indisponible`) ; injoignable : il est laissé de côté. Un
  robots.txt trop lourd à suivre (plus de 500 règles, ou 20 000 caractères de motifs, pour notre robot) ferme tout le site.
- **Notre robot se présente** : le User-Agent est `config.marque.userAgent` (par exemple `AtelierDemoBot/1.0 (+https://…)`), avec une
  page qui explique qui lit et comment demander l'arrêt. C'est son nom (avant le `/`) que les sites citent dans robots.txt.
- **Une requête par seconde au plus par domaine**, même quand plusieurs sites sont lus en parallèle ; un `Crawl-delay` plus long est
  respecté (au-delà de 60 secondes, le site est laissé de côté).
- **Peu de pages** : l'accueil, puis 5 pages internes probables au plus (réalisations, projets, à propos, équipe, contact, et les pages
  qui contiennent un mot indice) ; 6 pages par site au maximum. Jamais les pages légales, de compte, de panier, de recherche, ni les
  versions en langue étrangère, ni les fichiers (images, PDF…).
- **Léger** : 10 secondes d'attente au plus, 1 Mo au plus par page (au-delà, la lecture s'arrête), HTTPS d'abord puis HTTP, aucun
  JavaScript exécuté, aucune image téléchargée, robots.txt lu une fois par hôte et par passage. Les adresses IP, `localhost`, les
  noms de réseau local et les ports autres que 80 et 443 sont refusés (`adresse_invalide`), et un nom qui mène par le DNS à une
  adresse non publique (réseau local, bouclage) n'est jamais demandé (`adresse_non_publique`) : ces contrôles précèdent chaque
  requête, redirections comprises.

Les erreurs de crawl (compteurs en fin de passage) : `adresse_invalide`, `site_hors_perimetre`, `adresse_non_publique`,
`site_injoignable`, `robots_interdit`, `robots_indisponible`, `robots_delai_trop_long`, `accueil_…` (accueil illisible : `delai`,
`reseau`, `http_404`, `type`, `hors_site`, `adresse_non_publique`…). `--refaire-erreurs` les relit au passage suivant.

## Régler la niche (config/niche.json)

Le bloc `accroche` de la config :

| Champ | Rôle |
|---|---|
| `actif` | `false` : export et crawl refusent de tourner. |
| `motsIndices` | Les mots de la niche qui signalent une page ou une phrase utile (exemple : terrasse, bassin, potager). Ils s'ajoutent à la liste de base (projet, réalisation, chantier, rénovation, agence, fondé, équipe, depuis, spécialisé…). |
| `interdits` | Les mots qu'une accroche ne dit jamais, en plus des promesses et flatteries de base. |
| `longueurMax` | La longueur maximale d'une accroche, en caractères (160 au plus). |
| `exemples` | Trois accroches d'exemple, fictives, qui donnent le ton (contrôlées par les garde-fous de la config). |

Le User-Agent du robot est `marque.userAgent`. La cible (`cible.description`, `cible.metiers`, `cible.decideur`), l'offre (`offre.nom`,
`offre.pourQui`, `offre.probleme`, `offre.promesse`) et le ton (`script.ton`, `script.vouvoiement`) remplissent la consigne.

**La consigne** est le modèle `skills/accroches/consigne.md`. Ses crochets (`[cible]`, `[métiers]`, `[offre]`, `[pour qui]`,
`[problème]`, `[promesse]`, `[ton]`, `[tutoiement ou vouvoiement]`, `[mots min]`, `[mots max]`, `[longueur max]`, `[mots indices]`,
`[mots interdits]`, `[exemples]`, `[équipe]`, `[décideur]`) sont remplis depuis la config. Pour la voir remplie :
`node scripts/accroches/consigne.mjs` (ou `--sortie donnees/accroches/consigne.md`). On peut réécrire le modèle librement, avec ces
crochets seulement : un crochet inconnu arrête tout, et `npm test` le vérifie.

## Données personnelles

- `donnees/` est ignoré par git : la liste des sites, les textes lus, les lots, les réponses et les accroches n'entrent jamais dans
  le dépôt. On supprime `donnees/accroches/` après l'écriture en base.
- Minimisation : seul le site de l'entreprise est lu ; les lignes qui portent un e-mail, un numéro de téléphone ou un identifiant légal
  sont retirées avant que Claude ne lise quoi que ce soit ; l'accroche ne parle que de l'entreprise et de son travail.
- Traçabilité : chaque accroche écrite garde sa page et sa date de lecture (`leads.sources`).
- Opposition : les fiches « ne plus contacter » et celles de la liste d'opposition ne sont ni exportées ni écrites.

## Tests

`npm test` joue `tests/accroches-*.test.mjs` sans réseau (un faux web et une horloge virtuelle remplacent fetch et le temps) : texte,
robots.txt, cadence, crawl, compactage, contrôle anti-invention, consigne, lots. Les tests de la base (`tests/accroches-base.test.mjs` :
export, essai, écriture, rejouer) se sautent sans base ; ils tournent avec `npm run test:base` (qui lit `.env.local`) quand
`SUPABASE_DB_URL` désigne une base locale (`supabase start`), chacun dans une transaction annulée à la fin.

## Limites connues

- Un site construit entièrement en JavaScript donne peu ou pas de texte : pas d'accroche (c'est voulu, rien n'est deviné).
- Les PDF et les images ne sont pas lus : un projet présenté seulement en photo ne peut pas être cité.
- Le contrôle est lexical (voir plus haut) : la relecture humaine reste obligatoire.
- La lecture réelle des sites n'est pas jouée par les tests automatiques (faux web) : faire un premier passage avec `--limite 5`.
