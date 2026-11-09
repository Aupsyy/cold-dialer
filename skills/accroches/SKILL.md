---
name: accroches
description: Écrit l'accroche de chaque fiche (la première phrase de l'appel, qui cite un élément vérifiable du site de l'entreprise) en suivant la consigne de skills/accroches/consigne.md remplie depuis config/niche.json, après la lecture respectueuse des sites (robots.txt, une requête par seconde), puis la contrôle mot à mot, la fait relire et l'écrit en base en essai d'abord. À utiliser quand l'utilisateur dit « écris les accroches », « prépare les premières phrases », « personnalise les appels », « lance les accroches sur les fiches A ». Pas pour trouver des fiches (skill sourcer-leads), ni pour réécrire le script d'appel (skill ajuster-script).
---

# Écrire les accroches des fiches

## But

Donner à l'appelant, en haut de chaque fiche, UNE phrase qui prouve qu'il a regardé le site de l'entreprise : elle cite un élément
vérifiable (un projet, un lieu, une spécialité, une date de création) puis ouvre la conversation. Les scripts lisent les sites,
préparent des lots, contrôlent et écrivent en base ; toi (Claude Code), tu écris les phrases, lot par lot, sans rien inventer.

## Entrées

- `config/niche.json`, bloc `accroche` : `actif` (doit valoir `true`), `motsIndices`, `interdits`, `longueurMax`, `exemples` ; et
  `marque.userAgent` (le nom du robot qui lit les sites, avec une adresse où un webmestre peut joindre l'équipe), la cible, l'offre et
  le ton, qui remplissent la consigne.
- La consigne : le modèle `skills/accroches/consigne.md`, rempli par les scripts. Pour la voir remplie :
  `node scripts/accroches/consigne.mjs`.
- La base : `SUPABASE_DB_URL` dans `.env.local` (posée par l'utilisateur, avec `SUPABASE_DB_CA` pour une base distante), lue par
  `export.mjs` et `ecrire.mjs` seulement ; tu ne l'ouvres jamais.
- La référence : `docs/accroches.md` (parcours, format des réponses, ce que vérifie le contrôle). Lis-la à la première utilisation.

## Étapes

Toutes les commandes se lancent à la racine du dépôt. Les fichiers de travail vont dans `donnees/accroches/` (ignoré par git).

1. **Les fiches à traiter** (lecture seule en base) : celles qui ont un site et pas encore d'accroche, à appeler ou à rappeler, hors
   liste d'opposition, les mieux notées d'abord.

   ```bash
   node scripts/accroches/export.mjs                  # ou --tiers A,B, --limite N, --tous-statuts
   ```

   Si la base a plusieurs équipes, `export.mjs` et `ecrire.mjs` exigent `--workspace <uuid>` (sinon, la seule équipe).

2. **La lecture des sites**, d'abord un essai, puis le reste (long, relançable : un site déjà lu n'est jamais relu) :

   ```bash
   node scripts/accroches/crawl.mjs --limite 5
   node scripts/accroches/crawl.mjs                   # --paralleles N (4 par défaut, 16 au plus), --refaire-erreurs
   ```

   Lis les compteurs d'erreurs avec l'utilisateur (`site_hors_perimetre`, `robots_interdit`, `site_injoignable`…) avant de continuer.
3. **Les lignes utiles**, puis **les lots** :

   ```bash
   node scripts/accroches/compact.mjs                 # 2 000 caractères par site au plus (--max-caracteres N)
   node scripts/accroches/lots.mjs                    # lots de 50 fiches ; --taille 30 si un lot est trop long à lire d'une traite
   ```

4. **Écrire les accroches, un lot à la fois.** Pour chaque `donnees/accroches/lots/lot-NNN.md` :
   - lis le lot **en entier** (la consigne remplie est en tête, puis chaque fiche avec ses pages et ses lignes recopiées) ;
   - écris le fichier de réponse nommé dans le lot, `donnees/accroches/reponses/lot-NNN.json` : un tableau, une entrée par fiche, dans
     l'ordre du lot, `{"id": "…", "accroche": "La phrase.", "source": {"url": "page lue", "extrait": "passage recopié mot pour mot"}}`,
     ou `{"id": "…", "accroche": "", "source": null}` quand le site n'offre aucun élément précis ;
   - une phrase de 15 à 30 mots, `accroche.longueurMax` caractères au plus, qui cite UN élément des lignes de CETTE fiche, écrit de la
     même façon, puis pose de préférence une question ouverte ;
   - tu peux confier chaque lot à un sous-agent : il ne lit que son lot, ne fait aucune recherche web, n'ouvre aucune autre page ni la
     base, et n'écrit que son fichier de réponse.
5. **Le contrôle anti-invention** :

   ```bash
   node scripts/accroches/valide.mjs                  # validees.json et rapport-validation.md
   ```

   S'il reste des fiches sans réponse, relance `node scripts/accroches/lots.mjs` (seuls les lots sans réponse sont refaits) et
   reviens à l'étape 4.
6. **La relecture humaine** :

   ```bash
   node scripts/accroches/revue.mjs                   # écrit donnees/accroches/revue.md
   ```

   Demande à l'utilisateur d'ouvrir `donnees/accroches/revue.md` dans son éditeur (accroche, extrait qui la prouve, page source ; puis
   les accroches vidées et pourquoi). Chaque accroche qu'il refuse se vide, sans être réécrite :
   `node scripts/accroches/revue.mjs --vider <id>[,<id>…]`.
7. **L'écriture en base, en essai d'abord** :

   ```bash
   node scripts/accroches/ecrire.mjs                  # essai : à écrire, déjà remplies, inconnues, écartées, refusées
   ```

   Il rejoue d'abord le contrôle anti-invention sur chaque accroche, contre `crawl.jsonl` et `compact.jsonl` : une entrée de
   `validees.json` modifiée après coup est refusée si le site ne la prouve plus. Montre les compteurs et demande un accord
   **explicite**. Seulement alors : `node scripts/accroches/ecrire.mjs --appliquer` (une transaction ; seulement les fiches dont
   l'accroche est vide).
8. **Le ménage** : une fois les accroches écrites, les textes des sites ne servent plus. Avec l'accord de l'utilisateur :
   `rm -r donnees/accroches`. Jamais avant l'écriture : `ecrire.mjs` relit `crawl.jsonl` et `compact.jsonl`.

## Garde-fous

- **Rien d'inventé.** Chaque nom propre, lieu, année, nombre ou mot précis de l'accroche figure dans les lignes de la fiche. Sans
  élément précis : une accroche vide. Une accroche vide ne gêne personne ; une accroche fausse grille l'appel.
- **Une accroche signalée par le contrôle est vidée, jamais corrigée « pour passer ».** Jamais d'ajout ni de retouche à la main dans
  `validees.json` : seul `valide.mjs` l'écrit, seul `revue.mjs --vider` le vide.
- **Pas de recherche web**, pas d'autre page que celles du crawl, **jamais LinkedIn** ni un réseau social, un annuaire ou une carte.
- Aucune promesse, aucun chiffre de résultat, aucune flatterie (« magnifique », « incroyable »…), aucun mot de `accroche.interdits`.
- **Des compteurs seulement dans la conversation** : ni nom d'entreprise, ni texte de site, ni accroche recopiée (l'utilisateur lit
  `revue.md` dans son éditeur).
- Pour changer les mots indices ou interdits : `config/niche.json`, puis `npm test`. Le modèle `skills/accroches/consigne.md` se
  réécrit avec ses crochets seulement (un crochet inconnu arrête tout).
- Ne supprime ni `crawl.jsonl` ni `compact.jsonl` avant l'écriture en base : elle rejoue le contrôle contre eux.
- Essai d'abord, `--appliquer` seulement sur accord explicite. Jamais ouvrir `.env*`. Rien n'est envoyé aux entreprises.

## Sortie

- En base, après `--appliquer` : `leads.accroche`, `leads.accroche_source` (la page) et une source datée
  `{"type": "accroche", "url": …, "extrait": …, "le": "AAAA-MM-JJ"}` dans `leads.sources`, seulement sur les fiches sans accroche
  (rejouer n'écrit rien de plus). Le Poste l'affiche en haut de la fiche, avec le lien de la page.
- Le compte rendu, en compteurs : fiches exportées, sites lus et en erreur, accroches écrites, vidées par le contrôle, vidées à la
  relecture, écrites en base.

## Pièges connus

- Le contrôle est **lexical** : il vérifie que les mots sont sur le site, pas que la phrase dit vrai. Une phrase peut assembler des
  mots vrais en une idée fausse : la relecture humaine de `revue.md` est obligatoire avant `--appliquer`.
- Faux refus du contrôle des promesses : « doubl » refuse aussi « double » (un « garage double »), et un nombre suivi de « chantiers »
  ou de « clients » est lu comme un chiffre de résultat, même s'il vient du site. Ne tords pas la phrase : laisse l'accroche vide ou
  choisis un autre élément du site.
- Un superlatif ou un rang (« le plus », « premier », « seul »…) absent de l'extrait fait vider l'accroche (`superlatif_absent`) :
  choisis un extrait qui le contient, ou ne le dis pas.
- Un site construit entièrement en JavaScript ne donne pas de texte : pas d'accroche (c'est voulu). Les PDF et les images ne sont pas
  lus : un projet montré seulement en photo ne peut pas être cité.
- La lecture réelle des sites n'est pas jouée par les tests automatiques (faux web) : toujours un premier passage avec `--limite 5`.
- `accroche.actif` à `false` : `export.mjs` et `crawl.mjs` refusent de tourner.
- Un lot trop long à lire d'une traite : refais les lots avec `--taille 30`, plutôt que de survoler.
