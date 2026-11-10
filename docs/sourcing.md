# Sourcing de leads

Trouver les entreprises à appeler, les compléter (téléphone, site, e-mail public, signaux publics du registre et du site), les
noter pour savoir qui appeler en premier, puis les importer dans le Poste d'appels sans doublon ni personne qui a demandé à ne plus être appelée. Tout se lit dans `config/niche.json` : codes NAF,
départements, mots du nom, grille de score, débuts d'adresse e-mail préférés, identité du robot (`marque.userAgent`).

Les scripts sont dans `scripts/sourcing/` et se lancent depuis la racine du dépôt avec Node 22.18 ou plus récent. Ils
n'affichent jamais une donnée de prospect : seulement des compteurs. Tout ce qu'ils écrivent va dans `donnees/`, que git ignore.

## Le parcours

### En France

```bash
# 1. Le registre SIRENE (API publique, gratuite, sans clé)
node scripts/sourcing/sirene.mjs fetch --essai      # le volume annoncé et la durée, rien n'est gardé
node scripts/sourcing/sirene.mjs fetch              # la récolte, en cache dans donnees/cache/sirene/ (reprise automatique)
node scripts/sourcing/sirene.mjs build              # donnees/sirene-AAAA-MM-JJ.csv (filtré, sans doublon, premier score)

# 2. Facultatif et désactivé par défaut : Google par son API officielle (lire « Google (API officielle Places) » plus bas)
node scripts/sourcing/places.mjs enrichir donnees/sirene-AAAA-MM-JJ.csv --essai
node scripts/sourcing/places.mjs enrichir donnees/sirene-AAAA-MM-JJ.csv --limite 20
node scripts/sourcing/appariement.mjs donnees/sirene-AAAA-MM-JJ.csv donnees/places-enrichir-AAAA-MM-JJ.csv

# 3. L'enrichissement : registre public (chiffre d'affaires, effectif, employeur, état) et site de chaque entreprise (pixel
#    publicitaire, balise Google Ads, prise de rendez-vous, agence créditée) ; la même lecture du site donne l'e-mail publié
node scripts/sourcing/enrichir.mjs donnees/sirene-AAAA-MM-JJ-apparie.csv --essai
node scripts/sourcing/enrichir.mjs donnees/sirene-AAAA-MM-JJ-apparie.csv

# 4. Le score définitif (avec le site, l'e-mail, les avis et les signaux trouvés entre-temps)
node scripts/sourcing/score.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi.csv

# 5. L'import : d'abord en simulation (par défaut), puis pour de bon
node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi-score.csv
node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi-score.csv --appliquer
```

Chaque étape écrit un nouveau fichier à côté de celui qu'elle lit (suffixe `-apparie`, `-enrichi`, `-emails`, `-score`) et ne touche
jamais au fichier d'entrée. `--sortie <fichier.csv>` choisit un autre nom. Si tu ne veux que les e-mails, `emails.mjs` reste
disponible ; `enrichir.mjs` fait la même chose avec le même respect des sites, en lisant le site une seule fois pour l'e-mail et les
signaux : inutile de lancer les deux.

**Le registre SIRENE ne donne ni téléphone ni site.** Sans Google, trois façons de compléter :

- ton propre fichier (un annuaire professionnel, l'export de ton CRM, une liste achetée à un fournisseur qui garantit son origine) :
  `appariement.mjs <base.csv> <ton-fichier.csv>` rapproche chaque ligne de ton fichier de l'entreprise du registre (nom, commune,
  code postal, téléphone) et ajoute le téléphone et le site quand ils manquent ; chaque ligne de ton fichier doit porter sa date de
  lecture (colonne `source_date`), sinon elle n'apporte rien ;
- l'appelant cherche le numéro au moment d'appeler (le nom, la commune et le dirigeant sont sur la fiche) ;
- importer quand même : les fiches sans numéro entrent dans la base (`--exiger-telephone` les écarte).

Sans Google, le parcours le plus court est donc :

```bash
node scripts/sourcing/sirene.mjs fetch
node scripts/sourcing/sirene.mjs build --limite 500

# sans autre fichier : le score du build suffit
node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ.csv                     # puis la même commande avec --appliquer

# avec ton fichier de contacts (téléphones, sites) :
node scripts/sourcing/appariement.mjs donnees/sirene-AAAA-MM-JJ.csv donnees/mon-annuaire.csv
node scripts/sourcing/enrichir.mjs donnees/sirene-AAAA-MM-JJ-apparie.csv
node scripts/sourcing/score.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi.csv
node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi-score.csv  # puis --appliquer
```

### Hors de France (Belgique, Suisse, Canada…)

Le registre SIRENE ne couvre que les entreprises françaises. Deux voies :

- **ton propre CSV** au format décrit plus bas (colonnes `entreprise`, `telephone`, `ville`, `source`… ; le SIREN est facultatif),
  puis `enrichir.mjs` (ou `emails.mjs`), `score.mjs` et `importer.mjs` comme ci-dessus ;
- **Google Places en mode découverte**, si tu l'as activé : `places.mjs chercher` cherche chaque mot-clé de `sources.places.motsCles`
  dans chaque ville de `sources.places.villes`, jusqu'à `sources.places.max` fiches, et écrit un CSV déjà au format d'import.

Les numéros sont mis au format international (E.164) d'après `pays.code` : le format national est compris pour la France, la
Belgique, la Suisse, le Luxembourg, Monaco et le Canada ; pour un autre pays, écris les numéros au format international (`+34…`).

## Les étapes une par une

Options communes : `--config <fichier>` (une autre config que `config/niche.json`), `--essai` (rien n'est écrit ; pour l'import,
c'est déjà le comportement par défaut), `--aide`. `sirene.mjs`, `places.mjs`, `enrichir.mjs` et `emails.mjs` acceptent aussi `--dossier <chemin>`
(un autre dossier que `donnees/` pour leurs fichiers et leur cache) ; les autres écrivent à côté du fichier qu'ils lisent.

### `sirene.mjs fetch` puis `build`

- **fetch** interroge l'[API Recherche Entreprises](https://recherche-entreprises.api.gouv.fr) pour chaque code NAF de
  `sources.sirene.naf` et chaque département de `sources.sirene.departements` (ou toute la France avec `"tous"`), entreprises actives
  seulement (`etatAdministratif: "A"`). Les réponses vont dans `donnees/cache/sirene/`. Une recherche finie n'est jamais rejouée ;
  une recherche interrompue reprend à sa page suivante ; une recherche en échec est retentée au fetch suivant. L'API ne rend pas plus
  de 10 000 résultats par recherche : au-delà, la recherche est découpée (la France en départements, un département en codes
  postaux). `--limite N` s'arrête après N entreprises (pour un essai), `--essai` annonce le volume et la durée sans rien garder.
- **build** relit le cache et garde les entreprises :
  - actives, de l'un des codes NAF, dont le **siège** est dans l'un des départements ;
  - sans les entrepreneurs individuels si `sources.sirene.exclureEI` vaut `true` ;
  - dont le nom (ou l'enseigne) contient un mot de `motsNomInclure` s'il y en a, et aucun mot de `motsNomExclure` (accents et casse
    ignorés, en début de mot : « holding » écarte « Holdings Démo ») ;
  - dont la tranche d'effectif salarié, quand elle est connue, n'est pas entièrement hors de `cible.tailleMin` et
    `cible.tailleMax` (`--toutes-tailles` désactive ce filtre ; un effectif inconnu est toujours gardé).

  Puis il retire les doublons (même SIREN), calcule un premier score (sans téléphone, site ni avis à ce stade), trie du meilleur au
  moins bon et écrit `donnees/sirene-AAAA-MM-JJ.csv`. `--limite N` ne garde que les N meilleurs scores : pratique pour ne passer que
  les meilleures fiches à Google ou à l'enrichissement.

Le texte de `cible.exclusions` (« réseaux franchisés nationaux »…) n'est pas appliqué par le script : il sert au script d'appel et
au skill. Ce qui se vérifie dans le registre l'est.

Du registre, on garde : nom, enseigne, SIREN, SIRET du siège, NAF, catégorie juridique, date de création, tranche d'effectif,
commune, code postal, département, et le dirigeant à appeler (prénom et nom du président, du gérant ou du directeur général). Ni
date de naissance, ni nationalité, ni adresse.

### `places.mjs` (facultatif, désactivé par défaut)

Voir la section « Google (API officielle Places) ». Deux modes :

- `places.mjs enrichir <base.csv>` : pour chaque entreprise qui n'a pas encore téléphone et site, cherche « nom commune » et garde
  jusqu'à 3 fiches, marquées `siren_recherche` ; `appariement.mjs` choisit ensuite la bonne, ou aucune ;
- `places.mjs chercher` : découverte par mots-clés et villes (config `sources.places`).

`--essai` annonce le nombre de recherches et d'appels sans rien envoyer à Google (la clé n'est même pas lue) ; `--limite N` borne
le nombre de recherches ; `--max-appels N` borne le nombre de requêtes envoyées à Google (20 par défaut) : l'exécution s'arrête
proprement quand il est atteint et le nombre d'appels consommés est toujours affiché. Reprise : `donnees/cache/places-<mode>.json`
(la progression seulement ; supprime-le pour repartir de zéro ; un état de plus de 30 jours n'est pas repris).

### `enrichir.mjs <entree.csv>`

Deux lectures publiques, pour décider qui appeler en premier. Elles écrivent des colonnes que `score.mjs` sait lire :

- **le registre public** (API Recherche Entreprises, sans clé, 150 ms entre deux requêtes) pour chaque ligne qui a un SIREN :
  `chiffre_affaires` (euros, dernier exercice publié) et `ca_annee`, `employeur` (`oui` ou `non`), `etat_registre` (`A` active, `C`
  cessée), `registre_date` ; `effectif` et `date_creation` si elles étaient vides. Beaucoup de petites entreprises ne publient pas
  leurs comptes : la colonne reste alors vide, ce qui ne fait ni gagner ni perdre de points. Une entreprise non diffusible
  (diffusion partielle) n'est jamais gardée ;
- **le site de l'entreprise**, lu avec les mêmes règles que `emails.mjs` (robots.txt, une requête par seconde par domaine, 4 pages
  au plus, `marque.userAgent`, jamais un réseau social ni une adresse non publique) : `site_joignable` (`oui` : lu ; `non` : n'a pas
  répondu ; vide : pas lu, par exemple interdit par robots.txt), `signaux_site` (les signaux vus, séparés par des virgules) et
  `signaux_date`. Les signaux : `pixel_meta` (un pixel publicitaire de Meta), `balise_google_ads` (une balise de conversion ou de
  remarketing, pas Google Analytics), `prise_rdv` (un outil de réservation en ligne), `agence_creditee` (une agence créditée en pied
  de page). **Une seule lecture du site sert aussi à l'e-mail** : `email`, `email_source` et `email_date` sont remplis comme avec
  `emails.mjs` (jamais deviné, jamais celui d'un autre domaine) quand l'e-mail était vide.

Une case déjà remplie n'est jamais remplacée. Une ligne déjà enrichie est sautée (`registre_date`, `signaux_date`), sauf avec
`--refaire`. `donnees/cache/enrichir-registre.jsonl` (par SIREN) et `enrichir-sites.jsonl` (par domaine) gardent chaque lecture : une
relance ne relit rien (supprime-les pour tout relire). Options : `--limite N` (N SIREN et N sites), `--paralleles N` (sites lus en même
temps, 4 par défaut, 8 au plus), `--sans-registre`, `--sans-site`, `--refaire`, `--essai` (compteurs seulement, aucune requête).
Lance **`score.mjs` après** : c'est lui qui applique ces colonnes. Elles ne sont pas importées en base (l'import les ignore) ; seul le
score les utilise.

### `appariement.mjs <base.csv> <fiches.csv>`

Rapproche des fiches (Google Places, ou n'importe quel fichier avec `entreprise`, `ville`, `code_postal`, `telephone`, `site`, `source` et
`source_date`) des entreprises de la base. Règle : **jamais un mauvais téléphone plutôt que pas de téléphone**.

| Fiabilité | Quand |
|---|---|
| `telephone` | le même numéro des deux côtés (9 derniers chiffres) |
| `zone+nom` | au moins un mot distinctif en commun et le même code postal ou la même commune ; au seul niveau du département, les mêmes mots des deux côtés |
| `zone seule` | seulement pour une fiche cherchée pour cette entreprise : son nom n'a aucun mot distinctif, une seule fiche, même code postal |

Les mots distinctifs d'un nom : sans accents, casse ni ponctuation, sans formes juridiques (SARL, SAS…), sans petits mots, et sans
les mots de `sources.motsVidesAppariement` (les mots du métier : « jardin », « paysage »…, qui ne distinguent pas une entreprise
d'une autre). Une fiche dont le numéro diffère de celui déjà connu est écartée. Une fiche disputée par deux entreprises va à la
plus sûre ; à égalité, à aucune. Le téléphone, le site, la note et le nombre d'avis s'ajoutent seulement quand la base ne les a
pas, avec leur provenance (`coordonnees_source`, `coordonnees_url`, `coordonnees_date`, `coordonnees_fiabilite`) et la liste des
champs qu'elle couvre (`coordonnees_champs`).

**Rien n'entre sans sa source datée** : une fiche sans `source_date` (AAAA-MM-JJ) n'apporte rien, et une ligne de la base qui a déjà
la provenance d'une autre fiche (un appariement précédent) ne reçoit rien d'une nouvelle : une seule provenance par ligne, jamais
écrasée. Le rapport compte ces deux cas.

Un nom de famille partagé par deux entreprises de la même commune peut encore tromper : le script d'appel le vérifie dès
l'ouverture (« je suis bien chez … ? »).

### `emails.mjs <entree.csv>`

(`enrichir.mjs` fait la même lecture et y ajoute les signaux du site et du registre ; lance l'un ou l'autre.) Cherche l'e-mail **publié** par chaque entreprise sur son propre site, pour les lignes qui ont un site et pas d'e-mail :

- la page d'accueil, puis au plus 3 pages liées depuis l'accueil (contact, mentions légales, à propos) ;
- robots.txt lu et respecté ; une requête par seconde au plus par domaine (plus lent si robots.txt le demande) ; le robot se
  présente avec `marque.userAgent` ;
- aucune requête vers un autre domaine que celui du site, un réseau social, un annuaire, une carte, une adresse IP ou un port autre
  que 80 et 443, contrôlée avant chaque requête et à chaque redirection (5 au plus) : un tel site n'est pas lu (compteur « hors
  périmètre »), une redirection vers un autre domaine n'est pas suivie, et un nom qui mène par le DNS à une adresse non publique
  (réseau local, bouclage) n'est jamais demandé ;
- gardées : les adresses du domaine du site (ou de l'un de ses sous-domaines), et une adresse de messagerie grand public (gmail.com,
  orange.fr…) publiée sur le site ; jamais l'adresse d'un autre domaine (l'agence qui a fait le site, un partenaire), ni celle du
  domaine parent du site (pour un site en sous-domaine d'une plateforme, l'adresse de la plateforme) ; jamais une adresse de service
  (ne-pas-répondre, webmaster, RGPD, ressources humaines, comptabilité, presse…) ;
- une adresse masquée simplement (« contact [at] domaine [dot] fr », « (at) », « arobase ») est acceptée seulement si son domaine
  est celui du site ; une adresse cachée par un script n'est pas décodée ;
- entre plusieurs adresses trouvées, les débuts d'adresse de `sources.prefixesEmail` passent devant, dans leur ordre ;
- **rien n'est deviné** : aucune adresse n'est construite (`contact@` + domaine) si elle n'est pas écrite sur le site ;
- chaque e-mail garde sa page (`email_source`) et sa date (`email_date`).

`--paralleles N` lit N sites en même temps (4 par défaut, 8 au plus ; toujours une requête par seconde par domaine).
`donnees/cache/emails.jsonl` garde le résultat de chaque domaine : une relance ne relit pas un site déjà lu (supprime le fichier
pour tout relire). `--essai` lit 5 sites au plus et n'écrit rien.

### `score.mjs <entree.csv>`

Calcule `score` (0 à 100), `tier` (A, B, C) et `score_detail` (les critères retenus) avec la grille de la config. Voir « La
grille de score ». `--essai` affiche la répartition sans rien écrire. Le tier reste A, B ou C : l'ordre d'appel vient du tier puis du
score. `score_detail` (les critères retenus, par identifiant) reste dans le CSV : l'import n'a pas de champ libre pour le porter, il
n'est donc pas écrit sur la fiche.

### `importer.mjs <fichier.csv>`

**Simulation par défaut** : tout est joué dans une transaction annulée à la fin. Rien n'est gardé, mais les compteurs sont exacts
(la base a vérifié chaque fiche). `--appliquer` rejoue la même chose et valide : tout ou rien.

Pour chaque ligne, dans cet ordre :

1. **lecture** : `entreprise` obligatoire, avec au moins un identifiant (SIREN, téléphone ou mobile) ; un SIREN illisible rejette
   la ligne ; un numéro illisible est ignoré (la ligne reste si elle a un autre identifiant) ;
2. **liste STOP** : `donnees/stop.csv` s'il existe, ou `--stop <fichier>` ; colonnes `siren` (ou `siret`) et/ou `telephone` ; ces
   entreprises ne sont jamais importées. Un fichier STOP sans ces colonnes est refusé : une liste STOP n'est jamais ignorée en
   silence ;
3. **doublons dans le fichier** : même SIREN, puis même numéro (9 derniers chiffres) ; la première ligne l'emporte ;
4. **opposition** : écartée si son SIREN, l'un de ses numéros, ou son nom et son code postal sont sur la liste d'opposition de
   l'équipe (table `opposition`, fonction `identifiants_en_opposition` ; le nom et le code postal sont la clé d'une fiche opposée
   sans SIREN, comparée sans casse, accents ni ponctuation), ou si la fiche existante est en « ne plus contacter ». Cette clé est
   prudente : une autre entreprise au même nom et au même code postal est écartée elle aussi ;
5. **déjà en base** (même SIREN, sinon même numéro sans SIREN contradictoire) : les champs **vides** de la fiche sont complétés,
   jamais remplacés ; le statut, l'attribution, les notes et les rappels ne bougent pas ; les sources datées s'ajoutent. Une fiche
   dont les sources datées dépasseraient 20 n'est pas complétée (jamais une coordonnée sans sa source). Un numéro déjà porté par une
   fiche d'un autre SIREN : la ligne est écartée ;
6. sinon, **une nouvelle fiche** (statut « à appeler »), avec ses sources datées, son score et son tier.

Enfin une ligne dans la table `imports` : des compteurs seulement (lues, insérées, mises à jour, doublons, exclues pour opposition
ou STOP, rejetées). En simulation, cette ligne est annulée avec le reste.

Options : `--workspace <uuid>` (obligatoire si la base a plusieurs équipes ; sinon, la seule équipe de l'instance), `--source
sirene|maps|csv|manuel` (l'origine notée au journal ; sinon déduite de la colonne `source`, ou `csv` ; `maps` est le type de source
que la base connaît pour une fiche Google, y compris lue par l'API Places), `--metier <texte>` (le
métier des fiches qui n'en ont pas), `--limite N` (les N premières lignes, pour un essai), `--exiger-telephone` (écarte les
fiches sans aucun numéro).

Connexion : `SUPABASE_DB_URL` (variable d'environnement, sinon lue dans `.env.local` à la racine). Sa valeur n'est jamais
affichée ; une erreur de base n'affiche que son code. Vers une base distante, le certificat est vérifié si `SUPABASE_DB_CA` est
posée (le certificat racine de la base, dans `.env.local` : `docs/installation.md`, étape 2.3) ; sans elle, l'import le dit.

## Le CSV d'import

Pour qui apporte son propre fichier (Belgique, Suisse, Canada, un annuaire, un export de CRM). UTF-8 (avec ou sans BOM), séparateur
virgule ou point-virgule (détecté), une ligne d'en-tête. Les en-têtes sont lus sans accents ni casse (« Code postal » vaut
`code_postal`) ; plusieurs noms sont acceptés pour une même colonne. Les colonnes inconnues sont ignorées à l'import (et gardées
par les autres étapes).

| Colonne | Autres noms acceptés | Contenu | |
|---|---|---|---|
| `entreprise` | nom, raison_sociale, denomination, societe | le nom de l'entreprise | **obligatoire** |
| `siren` | n_siren | 9 chiffres (France) | au moins un des trois : siren, telephone, mobile |
| `telephone` | tel, telephone_fixe, phone | format national du pays de la config, ou international (+…) | |
| `mobile` | portable, telephone_mobile | idem | |
| `enseigne` | | le nom commercial, ajouté entre parenthèses au nom s'il diffère | |
| `siret` | siret_siege | 14 chiffres qui commencent par le SIREN | |
| `email` | e_mail, mail, courriel | un e-mail **publié** par l'entreprise | |
| `email_source`, `email_date` | | la page où il est publié, la date (AAAA-MM-JJ) | recommandé avec `email` |
| `site` | site_web, url | l'adresse du site | |
| `ville`, `code_postal`, `departement` | commune, cp | en France, le département se déduit du code postal | |
| `naf` | code_naf, ape | « 81.30Z » | |
| `forme_juridique`, `categorie_juridique` | forme ; nature_juridique | un libellé (« SARL ») ; un code de l'INSEE (« 5499 ») | |
| `effectif` | effectifs | un nombre (« 12 »), une tranche (« 6 à 9 salariés », « 6-9 ») | |
| `tranche_effectif` | | un code de tranche de l'INSEE (« 03 »), lu si le fichier n'a pas de colonne `effectif` | |
| `date_creation` | | AAAA-MM-JJ ou JJ/MM/AAAA | |
| `dirigeant` | gerant | « Prénom Nom » | |
| `metier` | | le métier (sinon `--metier`) | |
| `note_google`, `nb_avis` | note ; nb_avis_google, avis | 0 à 5 ; un entier | |
| `place_id` | | l'identifiant d'une fiche Google (écrit par `places.mjs`) : le seul contenu de Google qui se garde | |
| `chiffre_affaires`, `ca_annee`, `employeur`, `etat_registre`, `registre_date` | | écrites par `enrichir.mjs` : euros, année, `oui` ou `non`, `A` ou `C`, date de lecture | lues par `score.mjs` |
| `site_joignable`, `signaux_site`, `signaux_date` | | écrites par `enrichir.mjs` : `oui` ou `non`, les signaux vus, date de lecture | lues par `score.mjs` |
| `source` | | `sirene`, `maps`, `site`, `manuel`, ou le nom de l'annuaire en clair | **recommandé** (RGPD) |
| `source_url`, `source_date` | | l'adresse de la source ; la date de collecte, AAAA-MM-JJ (sinon : la date de l'import) | recommandé ; `source_date` obligatoire pour `appariement.mjs` |
| `coordonnees_source`, `coordonnees_url`, `coordonnees_date`, `coordonnees_champs` | | d'où viennent le téléphone et le site, et ce que cette provenance couvre (écrites par `appariement.mjs`) | |
| `score` | | 0 à 100 ; sinon calculé avec la grille de la config | |

Le `tier` est toujours déduit du score et des seuils de la config. Exemple minimal :

```csv
entreprise;telephone;ville;code_postal;source;source_date
Atelier Démo 01;01 99 00 00 01;Lyon;69003;Annuaire démo des paysagistes;2026-11-02
Atelier Démo 02;06 39 98 00 02;Bron;69500;Annuaire démo des paysagistes;2026-11-02
```

Chaque fiche importée garde ses **sources datées** (colonne `sources` de la table `leads`) :
`[{ "type": "sirene", "detail": "registre SIRENE (API Recherche Entreprises)", "url": "…", "le": "2026-11-01" }, …]`, avec une
entrée pour l'origine de la fiche, une pour ses coordonnées si elles viennent d'ailleurs, une pour son e-mail. Types : `sirene`,
`maps`, `site`, `manuel`, `fichier` (un fichier apporté par l'équipe, décrit dans `detail`).

## La grille de score

Elle vit dans `config/niche.json`, rubrique `score`. Chaque critère vrai pour une fiche rapporte ses points (un malus est permis :
points négatifs) ; la somme est bornée entre 0 et 100. Tier A à partir de `seuils.A`, B à partir de `seuils.B`, C sinon. Une
donnée absente ne rapporte rien.

| Type | Règle | Vrai quand |
|---|---|---|
| `forme_juridique` | `{ "inclure": [...], "exclure": [...] }` | la forme est dans `inclure` (et pas dans `exclure`) ; codes de l'INSEE exacts (« 5499 ») ou débuts (« 54 » : toutes les SARL), ou libellés en mot entier (« SAS » ne trouve pas « SASU ») ; `exclure` seul : la forme est connue et hors de la liste |
| `effectif` | `{ "min": 3, "max": 20 }` | l'effectif salarié tient entièrement entre min et max (« 20 à 49 salariés » dépasse 20) |
| `anciennete` | `{ "minAns": 2, "maxAns": 15 }` | l'âge de l'entreprise, en années, entre les bornes (comprises) |
| `ville` | `{ "inclure": ["Lyon", "75"] }` | la commune (accents, casse, « St » et « Saint » ignorés ; « Lyon » trouve « Lyon 3e Arrondissement ») ou un début de code postal (« 75 », « 690 ») ; « 2A », « 2B » pour la Corse |
| `naf` | `{ "inclure": ["81.30Z"] }` | le code NAF |
| `mot_nom` | `{ "mots": ["paysag"] }` | un mot ou un début de mot dans le nom ou l'enseigne |
| `note_google` | `{ "min": 4, "avisMin": 10 }` | une note d'au moins min, et au moins avisMin avis |
| `a_site`, `a_email` | `{}` | la fiche a un site, un e-mail |
| `chiffre_affaires` | `{ "min": 150000, "max": 2000000 }` | le chiffre d'affaires publié au registre (euros, `enrichir.mjs`) est entre min et max, bornes comprises |
| `employeur` | `{}` ou `{ "valeur": false }` | le registre dit que l'entreprise emploie des salariés (ou, avec `false`, n'en emploie pas) |
| `signal_site` | `{ "presents": ["prise_rdv"], "absents": ["pixel_meta", "balise_google_ads"] }` | tous les signaux de `presents` sont vus sur le site, aucun de ceux de `absents` ne l'est ; signaux : `site_joignable`, `pixel_meta`, `balise_google_ads`, `prise_rdv`, `agence_creditee` |

**Les trois derniers critères (donnés par `enrichir.mjs`) sont facultatifs** : une grille qui ne les emploie pas marche comme avant.
Une fiche sans la donnée (chiffre d'affaires non publié, site pas lu ou interdit aux robots, SIREN inconnu) **ne gagne ni ne perd de
points** : même un malus ne la touche pas. **Une entreprise que le registre dit cessée est écartée** (score 0, tier C, `cessee` dans
`score_detail`) sans rien déclarer dans la grille.

Par exemple, pour viser les sociétés de 1 à 9 salariés installées depuis 2 à 15 ans dans les grandes villes, avec un malus pour
les entreprises créées il y a moins d'un an :

```json
"score": {
  "criteres": [
    { "id": "societe", "type": "forme_juridique", "regle": { "inclure": ["54", "57"] }, "points": 25 },
    { "id": "taille", "type": "effectif", "regle": { "min": 1, "max": 9 }, "points": 25 },
    { "id": "installee", "type": "anciennete", "regle": { "minAns": 2, "maxAns": 15 }, "points": 20 },
    { "id": "grande_ville", "type": "ville", "regle": { "inclure": ["75", "92", "93", "94", "Lyon", "Marseille", "Bordeaux"] }, "points": 15 },
    { "id": "naf_cible", "type": "naf", "regle": { "inclure": ["81.30Z"] }, "points": 15 },
    { "id": "toute_recente", "type": "anciennete", "regle": { "maxAns": 1 }, "points": -15 }
  ],
  "seuils": { "A": 70, "B": 45 },
  "plafond": 100
}
```

Pour changer la grille : modifie `config/niche.json`, puis `npm test` (le schéma refuse un type inconnu, un identifiant en double, un
seuil A sous le seuil B), puis `score.mjs` sur ton fichier, en `--essai` d'abord pour voir la nouvelle répartition. Le score déjà
en base n'est pas recalculé par un nouvel import (seuls les champs vides sont complétés).

## Cadences et respect des sites

| Source | Cadence | Autres règles |
|---|---|---|
| API Recherche Entreprises | 150 ms entre deux requêtes (6,7 par seconde, sous la limite de 7 de l'API) | nouvelles tentatives espacées si l'API répond 429 ou une erreur serveur (Retry-After respecté) |
| Sites des entreprises (`emails.mjs`, `enrichir.mjs`) | une requête par seconde au plus par domaine (plus lent si robots.txt le demande) | robots.txt respecté ; 4 pages au plus par site ; 10 secondes d'attente au plus par page ; User-Agent `marque.userAgent` |
| Google Places (si activé) | une requête à la fois, 400 ms avant chaque page suivante | `--max-appels` (20 par défaut) ; 3 essais au plus en cas de panne passagère, aucun si la clé est refusée |

`marque.userAgent` dit qui lit le site (« NomBot/1.0 (+https://…) ») : mets une adresse où un webmestre peut te joindre.

## Google (API officielle Places)

**Désactivé par défaut** : `places.mjs` s'arrête avec une explication tant que `sources.places.actif` vaut `false`. Il passe par
l'API officielle Places (New) de Google Maps Platform (Text Search) : une requête HTTPS par page de résultats, avec une clé qui est
la tienne, dans ton propre projet Google Cloud, sous tes propres limites de dépense. Aucun navigateur n'est piloté.

Mise en place (c'est toi qui la fais ; ne colle jamais la clé dans une conversation ni dans le dépôt) :

1. créer un projet Google Cloud (https://console.cloud.google.com) et y lier la facturation (Google l'exige pour Places) ;
2. activer **Places API (New)** pour ce projet (« API et services », « Bibliothèque ») ;
3. créer une clé d'API (« Identifiants ») et la **restreindre à cette seule API** (« Restrictions relatives aux API » : Places API
   (New)) ;
4. fixer un **quota par jour** pour cette API (« Quotas et limites système ») : c'est le plafond que Google applique lui-même, en plus
   de `--max-appels` ;
5. créer une **alerte de budget** (« Facturation », « Budgets et alertes ») avec un montant bas, pour être prévenu avant de dépenser
   plus que prévu ;
6. coller la clé dans `.env.local` à la racine du dépôt, sur une ligne : `GOOGLE_PLACES_API_KEY=…` (ce fichier n'est jamais versionné ;
   le script ne l'affiche jamais) ;
7. dans `config/niche.json`, `sources.places` : `"actif": true`, avec `motsCles`, `villes` et `max` ;
8. lancer d'abord `--essai` (nombre de recherches et d'appels, sans rien envoyer), puis une petite `--limite`.

Le **coût** se lit sur la page de tarifs de Google Maps Platform (https://mapsplatform.google.com/pricing/) : il dépend des champs
demandés (le téléphone, le site et la note sont facturés à un tarif supérieur aux champs de base) et d'un éventuel crédit mensuel
de Google. Chaque requête envoyée est un « appel » (une page de 20 fiches au plus) ; `--max-appels` (20 par défaut) plafonne chaque
exécution et le rapport affiche le nombre d'appels consommés. Vérifie le tarif en vigueur avant de lancer une grosse recherche.

**Ce que le script garde** : le `place_id` (l'identifiant de la fiche), un lien Google Maps bâti sur ce `place_id`, et la date de
lecture (`source_date`). Le téléphone, le site, la note et le nombre d'avis sont lus à cette date ; les conditions de Google limitent
leur conservation (`docs/legal.md`, « Google Places et la conservation du contenu »).

## Le légal

- **Sources publiques seulement** : le registre SIRENE, les sites des entreprises, les fiches Google lues par l'API officielle si
  l'équipe l'a choisi, ou un fichier dont l'équipe connaît et garde l'origine (colonne `source`).
- **Pas de LinkedIn**, ni par script ni par extension de navigateur : ses conditions d'utilisation l'interdisent.
- **Non-diffusion** : une personne qui dirige une entreprise individuelle peut demander à l'INSEE que ses données ne servent pas à
  la prospection (statut de diffusion partielle). Ces entreprises sont écartées dès la récolte : rien d'elles n'est gardé, même
  dans le cache. Des dirigeants, seuls le prénom, le nom et la qualité sont gardés.
- **Aucun e-mail deviné** : seulement les adresses publiées par l'entreprise, avec la page et la date où elles ont été lues. Aucun
  e-mail n'est envoyé par l'outil.
- **L'origine des coordonnées** : chaque fiche garde ses sources datées, et l'appelant la donne au téléphone avec la réponse du
  script (`script.ouverture.commentAvezVousMonNumero`) et la phrase de `legal.phraseSource` (« Vos coordonnées professionnelles
  viennent de sources publiques : le registre public des entreprises et le site internet de votre entreprise. »). Si tu utilises
  Google Places, un annuaire ou ton propre fichier, adapte ces deux phrases pour qu'elles restent vraies.
- **Opposition** : « Ne plus contacter » au Poste inscrit la fiche sur la liste d'opposition de l'équipe (table `opposition` : son
  SIREN et ses numéros, ou, sans SIREN, son nom et son code postal) ; l'import ne la réimporte jamais, et l'application ne la rouvre
  jamais. La liste STOP (`donnees/stop.csv`) est un garde-fou local de
  plus (clients, partenaires…), qui n'écrit rien en base ; une demande d'opposition se note au Poste.
- **Bloctel** (liste d'opposition au démarchage téléphonique, Code de la consommation, articles L223-1 et suivants) protège les
  consommateurs : il ne s'applique pas à la prospection entre professionnels. Deux nuances : un entrepreneur individuel joint sur
  son numéro personnel reste une personne ; appelle-le pour son activité professionnelle seulement, et respecte tout refus. Et les
  règles du démarchage des particuliers se durcissent : cet outil ne sert jamais à appeler des particuliers.
- **Conservation** : la base sait purger les fiches sans contact depuis `legal.conservationMois` mois, 36 au plus (fonction
  `purger_fiches_inactives`) ; un import ne compte pas comme un contact.

## Le dossier `donnees/`

Tout ce que les scripts écrivent va dans `donnees/` (ou le dossier de `--dossier`) : les CSV de chaque étape, le cache de l'API
(`donnees/cache/sirene/`), celui des e-mails (`donnees/cache/emails.jsonl`), la progression de Google Places (`donnees/cache/places-*.json`), les lectures de l'enrichissement (`donnees/cache/enrichir-*.jsonl`) et la
liste STOP (`donnees/stop.csv`). `.gitignore` exclut `donnees/`, `*.csv` et `cache/` : ces fichiers contiennent des données de
prospection et ne doivent jamais entrer dans le dépôt. Garde-les sur ta machine, ne les partage pas, et supprime le cache quand la
campagne est importée (`rm -r donnees/cache`).

## Dépannage

| Message | Que faire |
|---|---|
| « config/niche.json invalide » | corrige la config (la liste des problèmes suit), puis `npm test` |
| « Le cache est vide pour cette config » | lance `sirene.mjs fetch` avant `build` (le cache dépend des NAF et départements de la config) |
| « Recherches en échec » | relance la même commande : elles sont retentées, le reste n'est pas rejoué |
| « Le fichier n'est pas en UTF-8 » | réenregistre le fichier au format « CSV UTF-8 » |
| « Cette base a plusieurs équipes » | ajoute `--workspace <identifiant>` |
| « Import annulé (ROLLBACK), rien n'a été écrit (code …) » | rien n'a été écrit ; le code est celui de PostgreSQL (23514 : une valeur refusée par la base) |
| « La liste STOP n'a ni colonne siren ni colonne telephone » | corrige l'en-tête de `donnees/stop.csv` |
| « Google Places est désactivé » | normal : lis la section « Google (API officielle Places) » avant de l'activer |
| « La clé GOOGLE_PLACES_API_KEY est introuvable » | colle-la dans `.env.local` (une ligne `GOOGLE_PLACES_API_KEY=…`) |
| « Google refuse la requête (code http_403) » | Places API (New) n'est pas activée, la facturation n'est pas liée au projet, ou la clé est restreinte à une autre API |
| « plafond de N appels atteint » | normal : relance la même commande pour reprendre, ou monte `--max-appels` |
| « sources.maps n'existe plus » | dans `config/niche.json`, renomme la clé `maps` en `places` (mêmes champs) |
