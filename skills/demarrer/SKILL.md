---
name: demarrer
description: Le parcours complet pour quelqu'un qui débute dans la prospection téléphonique B2B et vient de copier ce dépôt. Il regarde où en est la personne, puis l'emmène dans l'ordre à travers les autres skills (choisir sa niche, construire son offre et son script, installer l'outil, brancher ses clés, trouver et noter les entreprises, écrire les accroches) jusqu'à son premier bloc d'appels. À utiliser quand l'utilisateur dit « je débute », « par où je commence », « démarre avec moi », « lance le parcours complet », « je veux commencer à appeler », « installe-moi le dialer de zéro ». Pas pour une seule étape déjà identifiée (utilise alors le skill de cette étape).
---

# Démarrer : de zéro au premier bloc d'appels

## But

Emmener un débutant, une question à la fois, du dépôt tout juste copié à une file d'appels remplie et un script prêt à dire. Tu ne
refais pas le travail des autres skills : tu regardes où en est la personne, tu lui dis l'étape suivante et pourquoi, tu passes la main
au skill de l'étape, puis tu reprends. À chaque étape tu dis en une phrase ce qui vient d'être fait et ce qui reste.

## Entrées

- Le dépôt de l'utilisateur, copié depuis le modèle (en privé sur son compte GitHub), ouvert à sa racine.
- `config/niche.json` : encore l'exemple fictif tant que rien n'a été réglé.
- Les skills du dépôt, dans `skills/` : `choisir-niche`, `construire-offre`, `installer`, `sourcer-leads`, `accroches`, `debrief`,
  `ajuster-script`. S'ils ne sont pas visibles dans Claude Code, lis leur `SKILL.md` directement et suis-le ; `skills/README.md` dit
  comment les lier.
- Les documents de fond : `docs/offre.md`, `docs/scripts-de-base.md`, `docs/sourcing.md`, `docs/installation.md`, `docs/legal.md`.

## Étapes

Pose une question à la fois, en langage simple. Ne lance jamais deux étapes en même temps. Avant chaque étape, annonce sa durée en
ordre de grandeur (quelques minutes de questions, ou une attente pendant qu'un script tourne).

1. **Faire le point.** Demande à la personne ce qu'elle vend (ou veut vendre), si elle a déjà appelé des entreprises, et ce qu'elle a
   déjà : une niche, une offre écrite, les comptes (GitHub, Supabase, Vercel), un outil de téléphonie. Vérifie de ton côté : Node 22.18
   ou plus récent, `npm ci` fait, `npm test` vert (les tests tournent sur la niche d'exemple).
2. **La niche** : skill `choisir-niche`. Il pose sept questions, propose deux ou trois niches parmi les niches prêtes
   (`node scripts/niche/lister.mjs`) ou en fabrique une sur mesure, règle la cible, les codes du registre et la grille de score, et
   annonce le nombre d'entreprises de la zone.
3. **L'offre et le script** : skill `construire-offre`. Il remplit la fiche d'offre de `docs/offre.md`, écrit le bloc `offre` de la
   config, puis un premier script et des objections à partir de `docs/scripts-de-base.md`. Sans offre claire, on n'appelle pas : cette
   étape ne se saute pas.
4. **L'installation** : skill `installer`. La personne crée elle-même ses comptes et colle elle-même ses clés ; tu ne les vois jamais.
   À la fin : `node scripts/install/verifier.mjs` dit ce qui manque. Pour voir l'outil avant de tout brancher, les 40 fiches fictives
   de `node scripts/install/seed-demo.mjs` suffisent (simulation d'abord).
5. **Les clés facultatives.** Explique ce que chacune apporte, et laisse choisir : la téléphonie (`docs/telephonie.md`), l'agenda
   (`docs/agenda.md`), Google par l'API officielle Places (`docs/sourcing.md`, section Google : un compte Google Cloud avec facturation
   au nom de la personne, un quota par jour et une alerte de budget). Aucune n'est nécessaire pour commencer : le registre public est
   gratuit et sans clé, et un simple téléphone suffit.
6. **Les entreprises à appeler** : skill `sourcer-leads`. Récolte dans le registre, téléphones et sites, enrichissement
   (`node scripts/sourcing/enrichir.mjs`), score, puis import en simulation ; l'import réel seulement après l'accord explicite de la
   personne sur les compteurs. Commence petit (`--limite`) pour un premier essai.
7. **Les accroches** (facultatif pour un premier jour) : skill `accroches`, sur les fiches les mieux notées.
8. **Le premier bloc d'appels.** Relis avec la personne la section « tenir le rythme » de `docs/scripts-de-base.md` : la file prête
   avant de commencer, l'issue notée en une touche, pas de recherche entre deux appels, des séries courtes avec une pause. Rappelle la
   phrase d'origine des coordonnées et la demande de ne plus être appelé (`docs/legal.md`). Puis elle ouvre le Poste et appelle.
9. **Après les premiers appels** : skill `debrief` pour ranger ce que les prospects ont dit, puis, quand il y a assez de retours,
   skill `ajuster-script` pour faire évoluer le script.

Si la personne s'arrête en route, dis-lui à quelle étape reprendre : chaque étape laisse son résultat dans le dépôt (la config, les
fichiers de `donnees/`, la base).

## Garde-fous

- **Aucune promesse** : ni nombre de rendez-vous, ni revenu, ni délai. L'outil organise le travail ; le résultat dépend de l'offre et
  de la personne qui appelle.
- **Aucune clé dans la conversation.** Tu ne demandes, ne lis, n'affiches ni n'écris jamais une clé, un jeton ou un mot de passe ; tu
  n'ouvres jamais un fichier `.env`. La personne crée ses comptes et règle sa facturation elle-même.
- **Des entreprises seulement**, jamais des particuliers. Sources publiques seulement, jamais LinkedIn, jamais de lecture de Google
  Maps par un robot.
- **Simulation d'abord** pour tout ce qui écrit en base, puis accord explicite.
- **Des compteurs seulement** : aucune donnée de prospect dans la conversation, un commit ou un rapport.
- **Rien n'est envoyé aux prospects** par l'outil : ni e-mail, ni SMS, ni appel automatique.
- Ce dépôt ne remplace pas un conseil juridique : `docs/legal.md` résume le cadre, la personne reste responsable de sa prospection.

## Sortie

- `config/niche.json` réglé pour une niche et une offre, testé.
- L'instance installée (ou l'outil lancé en local), une file d'appels remplie de fiches notées.
- Un compte rendu court à chaque étape : ce qui est fait, ce qui reste, la prochaine action.

## Pièges connus

- Vouloir tout brancher avant d'appeler. Le chemin le plus court : niche, offre, script, registre, un téléphone. Le reste s'ajoute
  ensuite.
- Sauter l'offre pour aller « chercher des leads » : la file se remplit, mais l'appel n'a rien à proposer.
- Une niche trop large donne des milliers de fiches mal notées : mieux vaut un métier et deux ou trois départements pour commencer.
- Les sources n'ont pas été éprouvées sur tous les métiers : regarde toujours les compteurs d'un essai avant une récolte complète.
