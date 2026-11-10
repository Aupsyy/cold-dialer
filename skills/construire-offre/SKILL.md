---
name: construire-offre
description: Aide l'utilisateur à construire son offre avant d'appeler : pose une à une les questions de docs/offre.md (à qui, quel problème, quel résultat visé sans promesse, quel mécanisme, quelle preuve honnête, quel prix, quel premier pas à l'appel), refuse poliment toute promesse de résultat et propose une formulation honnête, écrit le bloc offre de config/niche.json, puis propose un premier script et des objections tirés de docs/scripts-de-base.md, lance npm test, montre le diff et attend l'accord avant de commiter sur une branche. À utiliser quand l'utilisateur dit « construis mon offre », « je ne sais pas quoi proposer », « aide-moi à écrire mon offre », « écris-moi un premier script », « reformule mon offre ». Pas pour choisir la niche (skill choisir-niche), ni pour faire évoluer un script déjà en service (skill ajuster-script), ni pour l'installation (skill installer).
---

# Construire son offre avant d'appeler

## But

Faire passer l'utilisateur d'une idée vague à une offre claire, écrite dans `config/niche.json` (bloc `offre`), puis à un premier
script d'appel court et à quelques objections prêtes. Tu poses les questions, tu reformules, tu proposes des formulations ; l'utilisateur
décide de chaque mot. L'offre ne contient aucune promesse de résultat, aucun chiffre de résultat, aucune rareté inventée : l'outil
organise le travail, le résultat dépend de l'offre et de l'appelant.

## Entrées

- Les réponses de l'utilisateur aux sept étapes de `docs/offre.md` (une par message).
- `docs/offre.md` (la méthode, la fiche d'offre, trois exemples fictifs) et `docs/scripts-de-base.md` (les phrases de départ et où elles
  se rangent) : à lire avant de poser la première question.
- `config/niche.json` (ou `config/niche.exemple.json` si l'installation n'a pas encore écrit le sien) : la forme exacte, les blocs
  `offre`, `cible`, `script`, `objections`.
- Le schéma et les garde-fous : `config/schema.ts` et `config/garde-fous.ts` (lus, jamais modifiés).

## Étapes

1. **Vérifier le point de départ.** Si l'utilisateur n'a pas encore choisi à qui il s'adresse (métier, taille, décideur), arrête-toi : le
   skill `choisir-niche` sert à cela ; reviens ici une fois la cible choisie. Sinon, résume en une phrase ce que tu as compris de sa cible
   et demande confirmation.
2. **Poser les questions de `docs/offre.md`, une par message**, dans cet ordre : à qui (`offre.pourQui`), le problème
   (`offre.probleme`), le résultat visé (`offre.promesse`), le mécanisme (`offre.mecanisme`), la preuve honnête, le prix et les
   modalités, le premier pas (`offre.rdv` : nom, durée de 20, 30 ou 45 minutes, canal visio, téléphone ou sur place). Pour chaque
   réponse :
   - **reformule** en une phrase et demande « c'est bien ça ? » ;
   - s'il hésite, propose deux ou trois formulations et un exemple fictif tiré de `docs/offre.md`, jamais un faux cas client ;
   - si la réponse est trop large (« les entreprises », « tout le monde »), pose une question pour resserrer ;
   - si le problème semble être un problème du prospect supposé sans que l'utilisateur l'ait vérifié, dis-le et propose de le vérifier
     par une question du script.
3. **Refuser poliment toute promesse de résultat** (chiffre, pourcentage, délai, « garanti », « assuré », « sans risque », « plus de
   clients à coup sûr », « complet en quelques semaines »). Ne dis jamais « c'est interdit » sans proposer : explique en une phrase que
   personne ne maîtrise le marché de son client et que la config refuse ces mots, puis propose la formulation honnête (un verbe
   d'action de sa part : rendre visible, mettre en place, organiser, vérifier, relancer ; ce que le travail vise, pas ce qu'il assure).
   Même chose pour une preuve inventée, un faux témoignage, un prix barré fictif, une rareté (« plus que deux places ») ou une pression
   (« il faut décider maintenant ») : refuse, et propose la version vraie (« je démarre, voici comment je travaille »).
4. **Le sujet de la garantie.** S'il veut en proposer une, dis seulement qu'une garantie est un engagement juridique à faire relire par
   un professionnel du droit, que les mots « garanti » et « sans risque » sont refusés dans ce qui est dit au prospect, et qu'il vaut mieux
   ne pas en parler au téléphone. N'en rédige aucune.
5. **Le prix.** Le vrai prix reste à l'utilisateur : il ne va pas dans la config. Écris avec lui une `offre.phrasePrix` honnête (le prix
   dépend de quelque chose de réel, on le voit au rendez-vous). Si le prix ne dépend de rien, propose une phrase qui donne le point de
   départ, sans chiffre de résultat.
6. **Montrer la fiche complète** (les sept cases, une phrase chacune) et obtenir l'accord. Puis **écrire le bloc `offre`** dans
   `config/niche.json` : `nom`, `pourQui`, `probleme`, `mecanisme`, `promesse`, `objectifAppel` (toujours `"rdv"`), `rdv` (`nom`,
   `dureeMin`, `canal`), `phrasePrix`. Si le métier ou la taille de la cible changent, propose aussi la mise à jour de `cible` et dis
   que les codes NAF et la grille de score se voient avec le skill `installer` ou `sourcer-leads`.
7. **Proposer un premier script** à partir de `docs/scripts-de-base.md`, adapté à son offre, au vouvoiement (ou au ton choisi dans
   `script.ton`) et avec les seuls crochets connus (`[prénom]`, `[nom]`, `[entreprise]`, `[ville]`, `[métier]`, `[ton prénom]`,
   `[équipe]`, `[deux créneaux]`) : `script.ouverture` (portable, standard, « Comment avez-vous mon numéro ? » vrai pour ses sources),
   `script.permission`, de trois à six `script.questions` (`id` en minuscules et tirets bas, `texte`, `but`), `script.pitch`,
   `script.close` (avec `[deux créneaux]`), `script.messagerie`, et `script.crochets` (tous ceux utilisés). Puis cinq à dix `objections`
   (`code` en minuscules et tirets, `libelle`, `reponse` d'une phrase honnête, `relance` si utile), jamais plus de vingt, sans « libre ».
   Fais valider chaque phrase à voix haute : si l'utilisateur ne la dirait pas, on la réécrit.
8. **Tester** : `npm test`. Un refus du schéma ou des garde-fous se corrige en **reformulant** avec l'utilisateur (surtout une promesse),
   jamais en modifiant `config/schema.ts`, `config/garde-fous.ts` ni un test.
9. **Montrer le diff et attendre l'accord explicite.** `git diff config/niche.json` ; n'écris ou ne commite rien de plus tant que
   l'utilisateur n'a pas dit oui. S'il veut changer un mot, reprends à l'étape 8.
10. **Commiter sur une branche**, comme `ajuster-script` :

    ```bash
    git switch -c construire-offre-AAAA-MM-JJ
    git add config/niche.json
    git commit -m "Offre et premier script : première version"
    ```

    La relecture et la fusion sont à l'utilisateur ; la config est lue au build, donc un redéploiement est nécessaire pour que le Poste
    l'affiche. Pour la suite, une fois les premiers appels passés : le skill `ajuster-script` lit les retours du marché et change une
    phrase à la fois.

## Garde-fous

- **Aucune promesse de résultat**, ni dans la config (le garde-fou refuse « garanti », « assuré », « doubler », « sans risque », un
  nombre de clients ou de rendez-vous, un pourcentage, un délai promis), ni dans ce que tu dis à l'utilisateur : tu ne promets jamais
  qu'une offre ou un script fera plus de rendez-vous.
- **Rien d'inventé** : pas de témoignage, de note, de nom de client, de chiffre de marché, de rareté, de prix barré, de pression. Une
  preuve honnête est une méthode, un parcours, un travail préalable visible ou un cas réel raconté avec l'accord de la personne.
- **Au téléphone, on ne vend que le rendez-vous** : `offre.objectifAppel` vaut toujours `rdv`.
- **Droit français** : pas de pratique commerciale trompeuse. Une garantie est un engagement juridique à faire relire par un
  professionnel du droit ; ni toi ni la config n'en rédigent.
- **Aucune donnée de prospect** dans la config ni dans un commit : ni nom d'entreprise réelle, ni prénom, ni citation recopiée.
  Les exemples utilisés en démonstration restent ceux, fictifs, de `docs/offre.md`.
- Aucun texte de la config ne contient d'URL (sauf `agenda.lienReservation`), d'e-mail (sauf `legal.contactRGPD`), de tiret cadratin,
  ni les mots « token » ou « secret ».
- **Ne jamais renommer** un `code` d'objection ou d'issue, ni un `id` de question déjà en service : les retours et les débriefs y sont
  attachés.
- Une branche, jamais de push, de fusion ni de déploiement à la place de l'utilisateur. Jamais ouvrir `.env*`. Rien n'est envoyé aux
  prospects.

## Sortie

- Un commit sur la branche `construire-offre-AAAA-MM-JJ` qui ne touche que `config/niche.json`, avec `npm test` vert.
- Un court compte rendu : la fiche d'offre en sept phrases, ce qui a été reformulé et pourquoi (surtout les promesses refusées), le
  script et les objections proposés, ce qui reste à faire (relire, fusionner, redéployer, passer à `ajuster-script` après les premiers
  appels).

## Pièges connus

- Les garde-fous sont **lexicaux** : « rassuré » contient « assuré », « double » contient « doubl », un nombre suivi de « clients », de
  « chantiers » ou de « rendez-vous » est lu comme un chiffre de résultat, « en trois mois » comme un délai promis. Reformule plutôt
  que de forcer.
- Un crochet non déclaré dans `script.crochets`, inconnu du Poste, ou un close sans `[deux créneaux]`, fait échouer `npm test` : c'est
  voulu. N'invente pas un crochet pour insérer un sujet (`[sujet]`) : écris le sujet dans la phrase.
- Les longueurs de la config sont bornées (le problème et le mécanisme : 600 caractères ; la promesse et la phrase de prix : 400 ;
  de trois à six questions ; vingt objections au plus). Une case qui déborde est souvent une case pas claire.
- `offre.phrasePrix` n'est honnête que si le prix dépend réellement de quelque chose que l'utilisateur doit regarder ; sinon,
  propose-lui de dire le point de départ.
- Un utilisateur débutant écrit vite « on garantit… » ou « résultats assurés » par réflexe : explique sans moraliser, et donne tout de
  suite la formulation de remplacement.
- Le Poste lit la config au build : le script d'un appelant qui a gardé la page ouverte reste l'ancien jusqu'au rechargement après le
  déploiement.
