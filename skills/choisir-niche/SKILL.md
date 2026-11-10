---
name: choisir-niche
description: Aide quelqu'un qui débute dans la prospection téléphonique à choisir sa niche, puis règle tout de suite le sourcing et le score dans config/niche.json. Sept questions simples, une à la fois (ce qu'il vend, son expérience du téléphone, un métier qu'il connaît, sa zone, la taille d'entreprise, le nombre d'appels par jour, niche prête ou libre), puis deux ou trois niches prêtes proposées avec leurs raisons, ou une niche libre construite avec les codes NAF, un essai, l'accord de l'utilisateur, l'écriture validée par le schéma et les garde-fous, et l'annonce du volume d'entreprises. À utiliser quand l'utilisateur dit « je ne sais pas quelle niche prendre », « choisis ma niche », « quelle cible appeler », « je débute en prospection », « change ma niche », « ajoute le département 69 », même sans le mot « skill ». Pas pour importer les fiches (sourcer-leads), ni pour installer l'outil (installer), ni pour écrire l'offre (construire-offre).
---

# Choisir sa niche et régler le sourcing

## But

Passer de « je ne sais pas qui appeler » à un `config/niche.json` valide dont la cible, les codes NAF, les mots-clés, la grille de score,
les questions de découverte, les objections et les exemples d'accroche sont ceux d'un métier précis. Tu poses sept questions courtes, tu
proposes deux ou trois niches avec des raisons honnêtes, tu montres ce qui changerait, tu écris seulement après l'accord de l'utilisateur,
puis tu lui annonces le nombre d'entreprises à appeler. Tu ne promets ni rendez-vous ni revenu : une niche bien choisie facilite le travail,
elle ne garantit rien.

## Entrées

- Les réponses de l'utilisateur au questionnaire de l'étape 1.
- Les niches prêtes : `config/niches/` (un fichier `<code>.json` par métier) et leur table `config/niches/README.md`, ou
  `node scripts/niche/lister.mjs`.
- `config/niche.json` s'il existe : ce que l'utilisateur a déjà rempli (marque, offre, téléphonie, agenda, légal) n'est jamais écrasé.
  Sans lui, ou s'il est encore l'exemple fourni avec le dépôt, la fusion part de `config/niche.exemple.json`.
- Pour une niche libre : `node scripts/niche/naf.mjs <mots>` (une table embarquée de codes NAF rév. 2, sans réseau).
- La référence du sourcing : `docs/sourcing.md`.

## Étapes

### 1. Le questionnaire : une question par message

Langage simple, une question à la fois, et attends la réponse avant la suivante. Si l'utilisateur ne sait pas, propose deux exemples. Après
chaque réponse, reformule en une phrase.

1. **Ce qu'il vend** (ou veut vendre) et à quel prix à peu près : un service, un abonnement, un travail ponctuel ? un petit prix, un prix
   moyen, un gros prix ? C'est ce qui dit quelle taille de client peut payer.
2. **Son expérience du téléphone** : jamais appelé, un peu, à l'aise ? Un débutant gagne à viser des interlocuteurs qui décrochent
   facilement et qui n'ont pas de standard.
3. **Un métier qu'il connaît de l'intérieur** : ancien emploi, famille, clients, passion. Parler la langue du métier compte plus que
   n'importe quel critère.
4. **Sa zone** : quels départements (ou « toute la France »). Un code postal ou une grande ville se traduit en département.
5. **La taille d'entreprise qu'il peut servir** : seuls, petites équipes, équipes plus structurées.
6. **Combien d'appels par jour** il vise (ordre de grandeur, ce qu'il peut tenir sans s'épuiser).
7. **Niche prête ou niche libre** : choisir dans une liste prête à l'emploi, ou décrire sa propre cible.

### 2. Proposer deux ou trois niches prêtes

Lis `config/niches/README.md`, croise les réponses avec les quatre critères ci-dessous, et propose **deux ou trois** niches, chacune avec
sa raison en une ou deux phrases. Ce sont des jugements, pas des mesures : dis-le, et n'invente aucun chiffre.

- **Le décideur décroche-t-il ?** Un dirigeant qui répond lui-même (artisan, gérant d'une petite structure) se joint plus facilement
  qu'un associé derrière un accueil. Pour un débutant, mieux vaut des interlocuteurs directs.
- **Le panier permet-il de payer l'offre ?** Une offre chère se vend à un métier dont un client rapporte beaucoup ; une offre modeste
  peut viser un métier où l'on traite beaucoup de petits clients.
- **Y a-t-il assez d'entreprises dans la zone ?** Une niche très étroite dans un seul département peut être vide : le volume se mesure
  à l'étape 5, avant de s'engager.
- **Le besoin est-il visible de l'extérieur ?** Un site qui montre peu de réalisations, une fiche locale peu fournie, une prise de
  rendez-vous introuvable : ce sont des raisons d'appeler que l'accroche peut citer.

Termine par la question : « Laquelle te parle ? ». Si aucune ne convient, retourne à la question 3 ou passe à la niche libre.

### 3. Niche libre

Si l'utilisateur veut un métier qui n'est pas dans la liste :

1. `node scripts/niche/naf.mjs <mots du métier>` propose des codes NAF (table partielle, sans réseau). Choisis un à quatre codes avec lui,
   et dis ce qui est incertain : un code peut couvrir plusieurs métiers (le préréglage ajoute alors un filtre sur le nom de l'entreprise,
   `motsNomInclure`).
2. Fabrique un préréglage sur mesure : copie la niche prête la plus proche (`config/niches/<code>.json`) vers
   `config/niches/<ton-code>.json` (minuscules et tirets), puis réécris avec l'utilisateur, un bloc à la fois : le `code`, le `metier`, la
   `tailleVisee` et le `pourquoi` ; la `cible` ; `sources.sirene.naf` ; les mots du nom ; `google.motsCles` ; la grille `score` (le critère
   `naf` reprend les mêmes codes, `taille` la taille de l'étape 1) ; trois ou quatre `script.questions` de découverte propres au métier ;
   cinq ou six `objections` ; trois `accroche.exemples` de quinze à trente mots ; les `debrief.champs`.
3. Les textes dits au prospect : vouvoiement, courts, sans chiffre de résultat, sans « garanti », sans délai promis, sans marque ni nom de
   personne ou d'entreprise réelle. `[deux créneaux]` est le seul crochet utile dans une relance.

### 4. L'essai, l'accord, l'écriture

```bash
node scripts/niche/appliquer.mjs <code> --essai                          # ce qui changerait, rien n'est écrit
node scripts/niche/appliquer.mjs <code> --essai --departements 69,38     # avec les départements de l'utilisateur, ou « tous »
```

Montre le résumé (codes NAF, départements, cible, score, nombre de questions et d'objections) et demande un accord **explicite**. Seulement
alors, la même commande sans `--essai` : elle valide le résultat avec le schéma et les garde-fous avant d'écrire, garde l'ancienne config
dans `config/niche.json.avant`, et ne touche ni à `marque`, ni à `offre`, ni à `telephonie`, ni à `agenda`, ni à `legal`. Puis `npm test`.

Si la base était l'exemple, la commande le dit : l'offre, la marque, la téléphonie, l'agenda, le légal et les textes du script (ouverture,
pitch, close, messagerie) sont encore ceux de l'exemple. Dis-le clairement à l'utilisateur, et passe à l'étape 6.

### 5. Annoncer le volume

```bash
node scripts/sourcing/sirene.mjs fetch --essai      # le volume d'entreprises du registre public et la durée de récolte ; rien n'est gardé
```

Annonce le nombre d'entreprises trouvées et la durée. Trop peu : élargis les départements (`--departements`) ou un code NAF. Beaucoup trop :
resserre la zone ou la taille. Avant d'appliquer, `node scripts/niche/volume.mjs <code> --departements 69,38` donne le même volume pour
une niche prête sans toucher à `config/niche.json`.

### 6. La suite

- Passe la main au skill **`sourcer-leads`** : récolte du registre, enrichissement (téléphone, site, e-mail publié), score, puis import en
  simulation d'abord.
- Si l'offre n'est pas encore écrite (`offre.promesse`, `offre.mecanisme`, `offre.phrasePrix`, `offre.rdv`), propose le skill
  **`construire-offre`**, et les textes du script (ouverture, pitch, close, messagerie) avec lui.

## Garde-fous

- **Aucune promesse** de volume de rendez-vous, de chiffre d'affaires ou de résultat, dans la conversation comme dans la config : tes
  raisons sont des jugements, pas des mesures. `config/garde-fous.ts` refuse les promesses dans les textes dits au prospect.
- **Aucune clé, aucun mot de passe** dans la conversation. Tu n'ouvres jamais `.env*`.
- **Des compteurs seulement** : tu annonces des volumes et des répartitions, jamais le nom, le numéro ou l'e-mail d'une entreprise.
- **Pas de LinkedIn**, ni par script, ni par extension, ni à la main. Sources publiques seulement.
- **Appels vers des entreprises seulement** (prospection B2B) : jamais une liste de particuliers.
- **Rien n'est écrit sans accord explicite** : essai d'abord, puis écriture. Ce qui est déjà rempli (marque, offre, téléphonie, agenda,
  légal) n'est jamais écrasé.
- Google (`sources.places`, l'API officielle Places) reste désactivé tant que l'utilisateur n'a pas créé sa clé et choisi de l'activer lui-même (`docs/sourcing.md`, section Google).

## Sortie

- `config/niche.json` mis à jour (la partie « marché » seulement) et `config/niche.json.avant` (l'ancienne version, hors git).
- Pour une niche libre : un nouveau fichier `config/niches/<ton-code>.json`.
- Un compte rendu court : la niche choisie et pourquoi, les codes NAF et les départements, ce qui reste à écrire (offre, script), le volume
  d'entreprises annoncé et la durée de récolte, la prochaine étape (`sourcer-leads`).

## Pièges connus

- Un code NAF ne dit pas tout : `47.59A` couvre tous les magasins de meubles, `43.99D` des travaux très variés. Les niches prêtes ajoutent
  un filtre sur le nom ; vérifie le volume avant de récolter.
- Les départements viennent de la config actuelle si tu ne les donnes pas : demande-les à la question 4 et passe `--departements`.
- Une niche prête change les questions, les objections et le score, pas l'offre : si la base est l'exemple, le pitch parle encore de
  l'exemple. Relis `script.pitch`, `script.close` et `script.ouverture` avec l'utilisateur avant d'appeler.
- La table de `naf.mjs` est partielle. « Aucun code » ne veut pas dire que le métier n'existe pas : cherche le code dans la nomenclature
  de l'INSEE, puis vérifie-le par `node scripts/sourcing/sirene.mjs fetch --essai`.
- Une niche libre ajoutée dans `config/niches/` passe aussi par `npm test` : un texte avec un chiffre de résultat ou un tiret cadratin sera
  refusé, avec le chemin du texte fautif.
- Le registre ne donne ni téléphone ni site : voir `sourcer-leads` pour les compléter.
