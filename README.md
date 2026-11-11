# cold-dialer
[![CI](https://github.com/Aupsyy/cold-dialer/actions/workflows/ci.yml/badge.svg)](https://github.com/Aupsyy/cold-dialer/actions/workflows/ci.yml)

Un poste d'appels de prospection B2B, open source, que chaque équipe règle pour SA niche : la file d'appels, le script, l'issue de
chaque appel au clavier, les rappels, les rendez-vous ; en amont, la liste des entreprises à appeler et une première phrase tirée de
leur site ; en aval, le débrief de l'appel et les retours du marché. Next.js 15 et Supabase, hébergeable dans l'Union européenne
(régions Supabase et Vercel à choisir), licence MIT.

*Captures d'écran à venir.*

[English version](README.en.md)

## Démarrer

**Tu débutes ?** Copie le modèle (étape 1), ouvre ton dépôt dans Claude Code et colle ceci :

```text
Lis skills/demarrer/SKILL.md et suis-le avec moi, une question à la fois : je débute dans la prospection téléphonique.
```

Il t'emmène dans l'ordre : ta niche (dix niches prêtes ou la tienne), ton offre, ton script, l'installation, les entreprises à
appeler, puis ton premier bloc d'appels.

1. **Copie le modèle** sur ton compte GitHub, en dépôt privé : bouton « Use this template » sur
   https://github.com/Aupsyy/cold-dialer, ou `gh repo create <nom> --private --template Aupsyy/cold-dialer --clone`.
2. **Installe** : avec Claude Code, le skill `installer` (dans `skills/`) pose les questions et lance les commandes ; à la main,
   `docs/installation.md` déroule Supabase, Vercel, la téléphonie, l'agenda et l'équipe, pas à pas.
3. **Règle ta niche** dans `config/niche.json` (ton offre, ta cible, ton script, tes objections, tes issues, tes outils) en partant de
   `config/niche.exemple.json` : `npm test` dit ce qui manque et refuse toute promesse de résultat.

Une question : les [discussions](https://github.com/Aupsyy/cold-dialer/discussions). Un bug ou une idée : une
[issue](https://github.com/Aupsyy/cold-dialer/issues/new/choose). Une faille : `SECURITY.md`, jamais une issue publique.

## Ce que c'est

- Un outil de travail pour qui appelle des entreprises afin de décrocher un rendez-vous : un écran (le Poste) qui enchaîne les fiches,
  affiche le script rempli pour chaque prospect, lance l'appel avec l'outil de téléphonie de l'équipe et note l'issue en une touche.
- Une instance par équipe, installée sur TES comptes (GitHub, Supabase, Vercel) : tes fiches restent dans ta base.
- Tout le métier tient dans un fichier, `config/niche.json` : l'offre, la cible, le script, les objections, les issues, la grille de
  score, les outils, les textes légaux. Il est validé au build ; un exemple fictif complet est dans `config/niche.exemple.json`.

## Pour qui

- Les agences de prospection, les indépendants et les équipes commerciales qui appellent des ENTREPRISES, en français (France,
  Belgique, Suisse, Canada…).
- Qui utilise Claude Code : l'installation et les tâches de lecture (accroches, débriefs) passent par des skills.

## Ce que ça n'est pas

- **Aucune garantie de rendez-vous ni de chiffre.** L'outil organise le travail ; le résultat dépend de l'offre et de l'appelant. La
  config refuse d'ailleurs toute promesse de résultat dans ce qui est dit au prospect (garde-fou joué au build).
- Pas un automate : rien n'est jamais envoyé seul à un prospect (ni appel, ni SMS, ni e-mail).
- Pas un outil pour appeler des particuliers, ni pour collecter des données sur LinkedIn.
- Pas un CRM complet : des fiches, des notes, des rappels et des rendez-vous, sans export de masse.

## Les quatre blocs

| Bloc | Ce qu'il fait | Documentation |
|---|---|---|
| **Poste d'appels** | file priorisée (score, rappels dus), fiche, script avec les crochets remplis, issues au clavier, rappels, annonce d'enregistrement, appel par l'outil de l'équipe, rendez-vous ; liste et fiche des prospects | `docs/telephonie.md`, `docs/agenda.md` |
| **Sourcing** | registre SIRENE (API publique, sans clé), Google par l'API officielle Places (en option, avec ta clé), e-mails publiés et signaux des sites, données publiques du registre, score, import en simulation puis pour de bon, liste STOP et opposition | `docs/sourcing.md` |
| **Accroches** | une première phrase d'appel tirée du site public de l'entreprise : lecture respectueuse (robots.txt, une requête par seconde par domaine), écriture par Claude Code, contrôle anti-invention, relecture humaine | `docs/accroches.md` |
| **Débrief et retours du marché** | la transcription d'un appel devient une extraction (douleurs, objection, citations mot pour mot, prochaine étape) écrite dans la fiche ; la page Retours agrège objections, issues, verdicts d'accroche et citations sur 7 ou 30 jours | `docs/debrief.md` |

L'agenda (Calendly, iClosed, Google Agenda ou agenda interne, avec un flux ICS par personne) relie les rendez-vous aux fiches.

En option, une **session commune** : ton Poste envoie ses seuls compteurs (appels, conversations, rendez-vous) à un classement partagé entre équipes, rien d'autre ; éteinte par défaut, et on la rejoint d'un clic en collant son lien dans l'écran Réglages (`docs/concours.md`).

## L'écran Réglages

- **Pour tous** : son profil (son nom, son e-mail chez l'outil de téléphonie) et l'aide de ses outils ; un appelant n'y voit que cela.
- **Pour le propriétaire et les membres** : l'équipe (l'e-mail de chacun chez l'outil de téléphonie ; les rôles et le retrait d'un
  compte, réservés au propriétaire), les invitations par un lien montré une seule fois et valable 14 jours, le plafond de tentatives
  (aligné sur `tentativesMax` de la config) et l'objectif d'appels du jour, l'enregistrement des appels avec son cadre légal, le RGPD
  (les textes légaux de la config, la purge des fiches inactives) et les variables manquantes des outils (des noms, jamais une valeur).
- **L'effacement d'une fiche** à la demande d'une personne : « Effacer cette fiche », en bas de la fiche, pour le propriétaire.

## Architecture

Une application Next.js 15 (App Router) déployée sur Vercel, avec ses fonctions en région Paris (`cdg1`). Une base Supabase (région
Paris dans le guide d'installation), deux migrations (`supabase/migrations/`, dans l'ordre), la RLS sur chaque table et une équipe
par instance. Tout le métier dans `config/niche.json`, validé par `config/schema.ts` et `config/garde-fous.ts` au build et par
`npm test` ; aucune clé d'IA dans l'application : l'extraction (accroches, débriefs) est faite par Claude Code, et les scripts ne font
que la tuyauterie.

## Installation

- **Guidée par Claude Code** : le skill `installer` pose six séries de questions (l'équipe, l'offre, la cible, le script, les outils,
  le légal), écrit `config/niche.json`, crée la base et le projet Vercel, pose les secrets des webhooks sans les afficher, déploie,
  vérifie et crée le compte propriétaire. Compte une dizaine de minutes de questions et de commandes une fois les comptes créés ; les
  consoles des fournisseurs (téléphonie, agenda) sont à part.
- **À la main** : `docs/installation.md`, le même parcours pas à pas.
- Il faut : Node.js 22.18 ou plus récent, git, un compte GitHub, Supabase et Vercel, et celui de ton outil de téléphonie.
- Les scripts d'installation : `node scripts/install/secrets.mjs` (les secrets des webhooks, posés dans Vercel, jamais affichés),
  `node scripts/install/verifier.mjs https://<ton-domaine>` (santé, webhooks, en-têtes), `node scripts/install/equipe.mjs` (le compte
  propriétaire ; ensuite l'équipe se gère dans l'écran Réglages), `node scripts/install/seed-demo.mjs` (40 fiches 100 % fictives, en
  simulation d'abord).
- L'entretien : `node scripts/maintenance/purger.mjs` (la purge RGPD, en simulation d'abord), la même que le bouton « Purger les fiches
  inactives » de l'écran Réglages.

## Les huit skills

| Skill | Pour |
|---|---|
| `demarrer` | le parcours complet pour un débutant, de la niche au premier bloc d'appels |
| `choisir-niche` | choisir sa niche par un questionnaire : dix niches prêtes dans `config/niches/`, ou une niche sur mesure |
| `construire-offre` | écrire son offre, son premier script et ses objections (`docs/offre.md`, `docs/scripts-de-base.md`) |
| `installer` | installer et configurer l'instance pour une niche, de zéro au compte propriétaire |
| `sourcer-leads` | trouver les entreprises (SIRENE, Google Places si activé, ton fichier), les compléter, les noter, les importer en simulation puis pour de bon |
| `accroches` | lire les sites, écrire les accroches par lots, les contrôler, les faire relire, les écrire en base |
| `debrief` | transformer la transcription d'un appel en fiche à jour, avec un compte rendu en cinq lignes |
| `ajuster-script` | lire les retours du marché et proposer une modification de `config/niche.json` sur une branche, à relire |

Ils sont dans `skills/` ; `skills/README.md` dit comment les brancher dans Claude Code.

## Téléphonie

| Outil | `mode` | Comment on appelle | Les appels arrivent dans les fiches (webhook) | Enregistrement |
|---|---|---|---|---|
| Onoff Business | `extension` | l'extension Chrome Onoff Click2Call ouvre son cadran, numéro tapé | oui (plans Advanced et Max) | oui, sous conditions |
| Aircall | `iframe` | le téléphone Aircall est dans le Poste | oui | oui, sous conditions |
| Ringover, **expérimental** | `iframe` | le téléphone Ringover est dans le Poste ; **jamais testé sur un vrai compte** | oui | oui, sous conditions |
| Softphone (Zoiper, 3CX, Teams…) | `lien` | un lien `tel:`, `callto:` ou `sip:` vers ton logiciel | non | non |
| Téléphone | `lien` | lien `tel:` sur un téléphone, numéro copié sur un ordinateur | non | non |

Les conditions de l'enregistrement : l'équipe l'a activé après avoir lu le cadre légal, ET l'annonce a été lue au prospect pour cet
appel, cochée au Poste pendant l'appel ; sinon ni audio ni transcription ne sont gardés. Détail : `docs/telephonie.md`.

## Agenda

| Outil | Comment les rendez-vous arrivent | À savoir |
|---|---|---|
| Calendly | webhook signé (clé de 32 caractères au moins) | les webhooks demandent une offre payante ; en gratuit, le lien seul puis « RDV pris » au Poste |
| iClosed | webhook (secret partagé, dans l'adresse ou l'en-tête `X-Webhook-Secret`) | ses issues n'apportent pas l'identifiant du rendez-vous : à noter dans l'écran Agenda |
| Google Agenda | synchronisation planifiée, en lecture seule | application OAuth à publier « In production » : en « Testing », le jeton expire au bout de 7 jours ; un événement qui ne se rattache à aucune fiche n'est pas gardé |
| Aucun (agenda interne) | rendez-vous pris au Poste ou dans l'écran Agenda | pas de réservation en ligne |

Chaque personne peut s'abonner à son flux ICS (Google Agenda, Apple Calendrier, Outlook). Détail : `docs/agenda.md`.

## Légal, en résumé

- Sources publiques seulement (registre SIRENE en respectant la non-diffusion, sites des entreprises, API officielle Google Places si l'équipe
  l'active avec sa propre clé) ; jamais LinkedIn.
- B2B sur l'intérêt légitime : l'origine des coordonnées est dite au téléphone, chaque fiche garde ses sources datées, « Ne plus
  contacter » alimente une liste d'opposition (SIREN, numéros ; sans SIREN, nom et code postal) qui bloque tout réimport, les fiches
  sans contact se purgent.
- Enregistrement seulement avec l'annonce lue pour CET appel (article 226-1 du Code pénal, recommandations de la CNIL).
- Bloctel protège les consommateurs, pas la prospection entre professionnels (avec deux nuances) ; l'outil ne sert jamais à appeler
  des particuliers.
- Le détail, et ce que ce document n'est pas (un avis juridique) : `docs/legal.md`.

## Hébergement

- **Vercel** : l'offre Hobby est réservée à un usage personnel et non commercial ; une agence prend l'offre Pro. Sur Hobby, une tâche
  planifiée tourne une fois par jour au plus. Fonctions en région Paris (`vercel.json`).
- **Supabase** : projet en région Paris (eu-west-3). L'offre gratuite met le projet en pause après 7 jours sans activité.
- Hébergeable dans l'Union européenne : les régions de Supabase et de Vercel se choisissent à l'installation (Paris dans ce guide) ;
  aucun service d'IA tiers n'est appelé par l'application.

## Limites connues

- iClosed : ses issues (« Outcome added ») arrivent sans l'identifiant du rendez-vous et sont ignorées ; tenu ou no-show se note dans
  l'écran Agenda.
- Agenda : un « réservé » renvoyé tard par l'outil, après une annulation, remet le rendez-vous en « pris ».
- Google Agenda : un événement qui ne se rattache à aucune fiche (identifiant dans la description, e-mail ou téléphone annoncé d'une
  fiche) n'est pas gardé : pas de rendez-vous « à vérifier » venu de Google.
- Opposition : pour une fiche sans SIREN, la clé nom + code postal est prudente : elle bloque aussi une autre entreprise au même nom
  (casse, accents et ponctuation ignorés) et au même code postal, et passe une telle fiche en « ne plus contacter ».
- Téléphones : deux normalisations E.164 voisines, la fonction SQL `normaliser_e164` (suivie par les scripts d'import) et
  `lib/telephonie/e164.ts` (l'application) ; hors de France, un numéro mal formé peut être lu par l'une et refusé par l'autre. Le
  rapprochement d'une fiche se fait sur les 9 derniers chiffres.
- Le téléchargement des audios (côté serveur) refuse une adresse IP écrite et un nom interne, mais ne contrôle pas l'adresse que donne
  le DNS (le « DNS rebinding » n'est pas couvert) ; l'adresse vient du fournisseur (webhook authentifié, ou son API pour la reprise
  différée). La lecture des sites (accroches, e-mails) contrôle le DNS avant chaque requête, pas au moment même de la connexion.
- Accroches : un site construit entièrement en JavaScript ne donne pas de texte, donc pas d'accroche ; le contrôle anti-invention est
  lexical (les mots sont sur le site, pas forcément l'idée) : la relecture humaine reste obligatoire.
- L'API Recherche Entreprises (SIRENE) et l'API Google Places sont testées avec de fausses réponses ; le registre a été essayé en réel sur un petit volume (récolte et enrichissement), Google Places jamais : commence par un essai et lis les compteurs.
- Ringover n'a jamais été testé sur un vrai compte.
- La purge RGPD n'est pas planifiée d'office (aucune tâche planifiée de l'application ne la lance) : lance-la une fois par mois, bouton
  « Purger les fiches inactives » de l'écran Réglages ou `node scripts/maintenance/purger.mjs` (`docs/legal.md`).
- L'écran Réglages est testé (logique, requêtes simulées, écritures rejouées sous la RLS) mais n'a pas encore été parcouru sur une vraie
  instance ; la recherche des audios restés sans appel suit l'API Storage de Supabase sans avoir été essayée en réel.
- Pas encore de captures d'écran.

## Développer

```bash
npm ci
npm run lint
npx tsc --noEmit
npm test              # tests node, garde-fous de la config, contrôle de publication
supabase start        # une base locale (Docker), puis SUPABASE_DB_URL de cette base dans .env.local
npm run test:sql      # un test SQL par table, chacun annulé à la fin
npm run test:base     # les tests node qui ont besoin de la base
npm run build
```

`npm test` joue aussi `scripts/test-publication.mjs` : aucun secret, aucune donnée de personne (e-mails et numéros hors des exemples
réservés), aucun fichier de données ni chemin de machine dans le dépôt ; le détail est dans `CONTRIBUTING.md`.

## Contribuer

Voir `CONTRIBUTING.md` : une branche, `npm test` vert, aucune donnée réelle dans les tests, en français.

## Licence

MIT : voir `LICENSE`.

## Sécurité

Une faille ? Ne l'ouvre pas en public : voir `SECURITY.md` (signalement privé par GitHub).
