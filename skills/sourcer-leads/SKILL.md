---
name: sourcer-leads
description: Trouve les entreprises à appeler pour la niche de config/niche.json, depuis des sources publiques (registre SIRENE par l'API Recherche Entreprises, sites des entreprises, fichier de l'utilisateur, Google par l'API officielle Places seulement s'il l'a activé), les complète (téléphone, site, e-mail publié, chiffre d'affaires et état au registre, signaux publics du site), les note avec la grille de la config pour savoir qui appeler en premier, puis les importe dans le Poste en simulation d'abord, sans doublon ni personne en opposition, avec un rapport en compteurs. À utiliser quand l'utilisateur dit « trouve-moi des prospects », « source des leads », « importe ce fichier », « remplis la file d'appels », « lance le sourcing », « ajoute le département 38 ». Pas pour écrire les accroches (skill accroches), ni pour un débrief d'appel (skill debrief), ni pour installer l'outil (skill installer).
---

# Sourcer des leads et les importer dans le Poste

## But

Remplir la file d'appels avec des entreprises de la cible, trouvées dans des sources publiques, complétées sans rien deviner, notées
avec la grille de la config, puis importées sans doublon ni personne qui a demandé à ne plus être appelée. Les scripts font tout le
travail ; toi (Claude Code), tu choisis le parcours avec l'utilisateur, tu lances les commandes, tu lis les compteurs et tu les
expliques. Aucune donnée de prospect ne passe dans la conversation : des compteurs seulement.

## Entrées

- `config/niche.json` : `sources.sirene` (codes NAF, départements ou `"tous"`, mots du nom à inclure ou exclure, `exclureEI`),
  `cible.tailleMin` et `cible.tailleMax`, `sources.places` (Google par l'API officielle, désactivé par défaut), `sources.motsVidesAppariement`,
  `sources.prefixesEmail`, la grille `score`, `marque.userAgent` (l'identité du robot qui lit les sites), `legal.phraseSource`.
- Facultatif : le fichier de l'utilisateur (annuaire professionnel, export de son CRM, liste d'un fournisseur qui garantit son origine),
  qu'il dépose lui-même dans `donnees/`, avec l'origine (`source`) et la date de lecture (`source_date`, AAAA-MM-JJ) de chaque ligne.
  Hors de France, c'est la source principale (format : `docs/sourcing.md`, « Le CSV d'import »).
- Facultatif : la liste STOP `donnees/stop.csv` (colonnes `siren` et/ou `telephone` : clients, partenaires, refus anciens).
- Facultatif : `GOOGLE_PLACES_API_KEY`, que l'utilisateur crée et colle lui-même dans `.env.local` (jamais dans la conversation) pour
  `places.mjs`. Tu ne l'ouvres ni ne l'affiches jamais.
- La base : `SUPABASE_DB_URL`, posée dans `.env.local` par l'utilisateur à l'installation (avec `SUPABASE_DB_CA` pour vérifier le
  certificat d'une base distante). Les scripts la lisent seuls ; tu ne l'ouvres jamais.
- La référence : `docs/sourcing.md` (parcours, colonnes, grille de score, cadences, dépannage). Lis-la à la première utilisation.

## Étapes

Toutes les commandes se lancent à la racine du dépôt (Node 22.18 ou plus récent). Chaque étape écrit un nouveau fichier à côté de
celui qu'elle lit (suffixes `-apparie`, `-enrichi`, `-emails`, `-score`) et ne touche jamais au fichier d'entrée. `AAAA-MM-JJ` : la date du
fichier écrit par `build`.

1. **Relire la cible avec l'utilisateur** : codes NAF, départements, tailles, mots exclus, grille de score. S'il change
   `config/niche.json`, lance `npm test` (le schéma refuse un code NAF mal écrit, un critère inconnu, un seuil A sous le seuil B).
2. **En France, le registre SIRENE** (API publique, sans clé) :

   ```bash
   node scripts/sourcing/sirene.mjs fetch --essai     # le volume annoncé et la durée ; rien n'est gardé
   node scripts/sourcing/sirene.mjs fetch             # la récolte, en cache dans donnees/cache/sirene/ (reprise automatique)
   ```

   Montre le volume et la durée annoncés avant de lancer la récolte. Relance `fetch` tant que le rapport n'annonce pas « Récolte
   complète » (code de sortie 1 s'il reste des recherches en échec : elles sont retentées, le reste n'est pas rejoué). Pour un premier
   essai, `--limite N` arrête la récolte après N entreprises.
3. **Le fichier de base** :

   ```bash
   node scripts/sourcing/sirene.mjs build             # donnees/sirene-AAAA-MM-JJ.csv : filtré, sans doublon, premier score
   ```

   `--limite N` ne garde que les N meilleures fiches (pratique avant Google ou l'enrichissement) ; `--toutes-tailles` retire le filtre
   d'effectif. Le texte de `cible.exclusions` n'est pas appliqué par le script : rappelle-le à l'appelant.
4. **Compléter téléphones et sites** (le registre n'en donne pas), au choix :
   - **le fichier de l'utilisateur** : vérifie seulement sa ligne d'en-tête (`head -1 donnees/<son-fichier>.csv`, jamais les lignes) :
     il faut la colonne `source_date` (la date de lecture de chaque ligne), sans laquelle rien n'est ajouté, et de préférence
     `source` ; puis `node scripts/sourcing/appariement.mjs donnees/sirene-AAAA-MM-JJ.csv donnees/<son-fichier>.csv`. Une ligne de
     la base ne reçoit qu'une provenance, jamais écrasée par un second appariement ;
   - **Google par l'API officielle Places**, seulement si l'utilisateur a créé sa clé et mis lui-même `sources.places.actif` à `true`
     (voir Garde-fous ; la mise en place est dans `docs/sourcing.md`, « Google (API officielle Places) ») :
     `node scripts/sourcing/places.mjs enrichir donnees/sirene-AAAA-MM-JJ.csv --essai` (nombre de recherches et d'appels, rien n'est
     envoyé), puis la même commande sans `--essai` avec `--limite N` d'abord ; `--max-appels N` plafonne les requêtes envoyées à
     Google (20 par défaut) et le rapport dit combien ont été consommées ; puis
     `node scripts/sourcing/appariement.mjs donnees/sirene-AAAA-MM-JJ.csv donnees/places-enrichir-AAAA-MM-JJ.csv` ;
   - **rien** : les fiches sans numéro s'importent quand même (l'appelant cherche le numéro au moment d'appeler), sauf avec
     `--exiger-telephone` à l'import.
5. **L'enrichissement** (registre public et site de chaque entreprise ; la même lecture du site donne l'e-mail publié) :

   ```bash
   node scripts/sourcing/enrichir.mjs donnees/sirene-AAAA-MM-JJ-apparie.csv --essai   # nombre de SIREN et de sites à lire, rien n'est envoyé
   node scripts/sourcing/enrichir.mjs donnees/sirene-AAAA-MM-JJ-apparie.csv --limite 50
   node scripts/sourcing/enrichir.mjs donnees/sirene-AAAA-MM-JJ-apparie.csv
   ```

   Il écrit `<entree>-enrichi.csv` : chiffre d'affaires publié, employeur, état (active ou cessée), et pour les sites lus : pixel
   publicitaire Meta, balise Google Ads, outil de rendez-vous, agence créditée, site joignable, e-mail publié. Rien n'est deviné ;
   une donnée absente reste vide et ne rapporte ni ne retire aucun point. `--paralleles N` lit N sites à la fois (4 par défaut, 8 au
   plus ; toujours une requête par seconde par domaine) ; `--sans-registre` ou `--sans-site` sautent une des deux lectures. Si
   l'utilisateur ne veut que les e-mails, `emails.mjs` reste disponible (même respect des sites) : ne lance pas les deux.
6. **Le score définitif**, APRÈS l'enrichissement, avec ce qui a été trouvé entre-temps. Si la grille n'a pas encore les critères
   `chiffre_affaires`, `employeur` ou `signal_site` (facultatifs, `docs/sourcing.md`, « La grille de score »), propose-les à
   l'utilisateur selon ce qu'il cherche (par exemple : un chiffre d'affaires publié d'au moins tant, ou aucune publicité vue) ; une
   entreprise cessée est écartée d'office :

   ```bash
   node scripts/sourcing/score.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi.csv --essai   # la répartition A, B, C
   node scripts/sourcing/score.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi.csv
   ```

7. **L'import, en simulation d'abord** (transaction annulée, compteurs exacts : la base a vérifié chaque fiche) :

   ```bash
   node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi-score.csv
   ```

   Montre les compteurs (lues, invalides, STOP, doublons, opposition, conflits, déjà en base, nouvelles fiches et leurs tiers) et
   demande un accord **explicite**. L'opposition compare le SIREN, les numéros, et la clé nom + code postal d'une fiche opposée sans
   SIREN : une clé prudente, qui écarte aussi un homonyme du même code postal. Seulement alors :

   ```bash
   node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ-apparie-enrichi-score.csv --appliquer
   ```

   Options utiles : `--stop <fichier.csv>` (une autre liste STOP que `donnees/stop.csv`), `--workspace <uuid>` (si la base a
   plusieurs équipes), `--source sirene|maps|csv|manuel` (l'origine notée au journal des imports), `--metier <texte>` (le métier des
   fiches qui n'en ont pas), `--limite N` (les N premières lignes, pour un essai), `--exiger-telephone`.
   Sans fichier de contacts, la sortie de `build` s'importe directement : `node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ.csv`.
8. **Hors de France** (Belgique, Suisse, Canada…) : le fichier de l'utilisateur au format de `docs/sourcing.md` (le SIREN y est
   facultatif), puis les étapes 5 à 7 ; ou, si Google Places est activé, la découverte par mots-clés et villes de la config :
   `node scripts/sourcing/places.mjs chercher --essai`, puis sans `--essai` (avec `--max-appels` si besoin), et `importer.mjs` sur le CSV écrit.
9. **La phrase d'origine** : si les coordonnées viennent aussi de Google Places, d'un annuaire ou du fichier de l'utilisateur, propose de
   réécrire `legal.phraseSource` et la réponse du script à « Comment avez-vous mon numéro ? »
   (`script.ouverture.commentAvezVousMonNumero`) pour qu'elles restent vraies, puis `npm test`.
10. **Le ménage**, avec l'accord de l'utilisateur, une fois l'import fait : `rm -r donnees/cache` (le cache de l'API, des sites et de
    Google Places). Les CSV restent dans `donnees/`, ignoré par git ; à supprimer quand ils ne servent plus.

## Garde-fous

- **Sources publiques seulement** : le registre, les sites des entreprises, le fichier dont l'utilisateur connaît l'origine. **Jamais
  LinkedIn**, ni par script, ni par extension, ni à la main.
- **Google** : seulement par l'API officielle Places, avec la clé de l'utilisateur, désactivée par défaut. Tu ne crées ni ne demandes
  jamais de clé dans la conversation (l'utilisateur la crée dans son projet Google Cloud et la colle dans `.env.local`), tu n'ouvres
  jamais `.env*`, tu n'actives `sources.places.actif` que s'il le demande, et tu ne lis jamais Google Maps avec un navigateur piloté.
  Tu rappelles le coût (à lire sur la page de tarifs de Google, sans l'inventer), le plafond `--max-appels`, le quota et l'alerte de
  budget à poser côté Google, et la règle de conservation : le `place_id` se garde, le reste du contenu de Google est à rafraîchir
  ou à supprimer sous 30 jours (`docs/legal.md`).
- **Rien de deviné** : aucun e-mail construit (`contact@` + domaine), aucun numéro supposé, aucun SIREN recopié d'ailleurs.
- **Simulation d'abord**, `--appliquer` seulement après l'accord explicite de l'utilisateur sur les compteurs de la simulation.
- **Aucune donnée de prospect dans la conversation, un commit ou un rapport** : des compteurs. Tu n'affiches jamais une ligne d'un
  CSV ; tu ne lis que des en-têtes. `donnees/` et les CSV ne vont jamais dans git (`.gitignore`, et le contrôle de publication les
  refuse).
- **Opposition respectée** : la liste STOP et la table `opposition` ne se contournent jamais (ni en éditant un fichier, ni en vidant
  la liste). Une demande d'opposition se note au Poste (« Ne plus contacter »).
- Jamais ouvrir `.env*`, jamais afficher ni écrire `SUPABASE_DB_URL`.
- Rien n'est envoyé aux entreprises : ni e-mail, ni SMS, ni appel automatique.

## Sortie

- Dans `donnees/` (hors git) : `sirene-AAAA-MM-JJ.csv` et ses suites (`-apparie`, `-enrichi`, `-emails`, `-score`), `places-*.csv` si Google Places est activé, le cache.
- En base, après `--appliquer` : les nouvelles fiches (statut « à appeler », score, tier, sources datées), les champs vides des fiches
  existantes complétés (jamais remplacés), une ligne dans `imports` (des compteurs).
- Le compte rendu à l'utilisateur, en compteurs seulement : entreprises récoltées et gardées après filtres, avec téléphone, site et
  e-mail, répartition A, B, C, puis l'import (nouvelles fiches, complétées, écartées par STOP ou opposition, conflits, rejetées).

## Pièges connus

- L'API Recherche Entreprises et l'API Google Places n'ont pas été testées en réel (les tests jouent un faux réseau) : commence par `--limite`
  et regarde les compteurs. Au-delà de 10 000 résultats par recherche, le script découpe (la France en départements, un département
  en codes postaux, jusqu'à 1 000 requêtes par département) : le volume annoncé par `fetch --essai` peut être long à récolter.
- « Le cache est vide pour cette config » : `sirene.mjs fetch` avant `build` (le cache dépend des NAF et départements de la config).
- « Cette base a plusieurs équipes » : `--workspace <uuid>` à l'import. « Le fichier n'est pas en UTF-8 » : réenregistrer le fichier
  au format « CSV UTF-8 ». « Import annulé (ROLLBACK) » : rien n'a été écrit ; le code est celui de PostgreSQL.
- Places : « Google refuse la requête (code http_403) » veut dire que Places API (New) n'est pas activée, que la facturation n'est pas
  liée, ou que la clé est restreinte à une autre API ; « plafond atteint » est normal (relancer la même commande reprend). « Google
  Places est désactivé » est normal tant que l'utilisateur ne l'a pas choisi. Une ancienne config avec `sources.maps` est refusée avec
  un message : renommer la clé en `places`.
- Un site qui n'a pas répondu a `site_joignable` à `non` ; un site interdit aux robots reste vide : dans les deux cas aucun signal
  n'est conclu (ni « pas de publicité » ni autre).
- Deux entreprises qui partagent un nom de famille dans la même commune peuvent tromper l'appariement : le script d'appel vérifie dès
  l'ouverture (« je suis bien chez … ? »).
- Le score d'une fiche déjà en base n'est pas recalculé par un nouvel import (seuls les champs vides sont complétés).
- Il n'y a pas d'entrée npm pour ces scripts : toujours `node scripts/sourcing/…`, avec Node 22.18 ou plus récent.
