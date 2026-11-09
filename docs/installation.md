# Installer le poste d'appels, pas à pas

Ce document décrit l'installation complète À LA MAIN, sans Claude Code. Le skill `installer` (dans `skills/`) fait le même parcours en
posant les questions et en lançant les commandes ; les deux arrivent au même résultat. Le détail de chaque outil de téléphonie et
d'agenda est dans `docs/telephonie.md` et `docs/agenda.md` ; le cadre légal dans `docs/legal.md`.

Une règle pour tout le parcours : une clé, un jeton, un mot de passe ou l'adresse de ta base ne vont que dans le tableau de bord de
Vercel ou dans `.env.local` (sur ta machine, ignoré par git). Jamais dans un fichier du dépôt, un message, une capture ou un ticket.
`.env.example` donne les NOMS de toutes les variables.

## 0. Ce qu'il te faut

- Node.js 22.18 ou plus récent (https://nodejs.org), git, un terminal.
- Un compte GitHub (https://github.com), Supabase (https://supabase.com/dashboard) et Vercel (https://vercel.com).
- Les outils en ligne de commande, conseillés : GitHub CLI (https://cli.github.com), Supabase CLI (https://supabase.com/docs/guides/cli),
  Vercel CLI (https://vercel.com/docs/cli). Connecte-toi une fois dans ton terminal : `gh auth login`, `supabase login`, `vercel login`.
- Selon tes choix : un compte Onoff Business, Aircall ou Ringover ; Calendly, iClosed ou un projet Google Cloud. Anticipe : la validation
  d'un numéro français chez Aircall prend plusieurs jours.
- Google Chrome si l'équipe appelle avec Onoff (extension).

## 1. Le dépôt

Le dépôt modèle se copie en dépôt PRIVÉ, à toi :

- sur sa page GitHub, https://github.com/Aupsyy/cold-dialer : « Use this template » › « Create a new repository », visibilité Private ;
- ou dans ton terminal : `gh repo create <nom> --private --template Aupsyy/cold-dialer --clone`.

Si tu pars d'une autre copie du modèle (celle de ton agence, par exemple), remplace `Aupsyy/cold-dialer` par son nom : elle doit être
marquée « Template repository » (Settings › General) par son propriétaire. Sinon : clone-la, crée un dépôt privé vide
(https://github.com/new) et pousses-y le clone (un fork d'un dépôt public ne peut pas être privé).

Puis, dans le dossier du dépôt : `npm ci`.

## 2. Supabase

### 2.1 Le projet

https://supabase.com/dashboard › New project : un nom, un **mot de passe de base** (génère-le et garde-le dans ton gestionnaire de mots
de passe), la région **Paris (eu-west-3)** pour garder les données dans l'Union européenne. L'offre gratuite met le projet en pause
après 7 jours sans activité.

### 2.2 Le schéma (une seule migration)

Choisis UNE des deux voies et garde-la ensuite :

- avec la CLI : `supabase link --project-ref <ref>` (la référence du projet est dans son adresse sur le tableau de bord, ou dans Project
  Settings › General ; la CLI demande le mot de passe de la base), puis `supabase db push` ;
- sans la CLI : Supabase › SQL Editor › New query, colle TOUT le contenu de `supabase/migrations/0001_schema.sql`, puis Run. (La CLI
  garde un historique des migrations ; une migration collée à la main n'y figure pas.)

### 2.3 L'adresse de la base, en local seulement

Bouton **Connect** du projet › chaîne de connexion **Session pooler** (elle commence par `postgresql://`), avec le mot de passe de la
base à la place du mot de passe masqué. Ouvre (ou crée) avec ton éditeur le fichier `.env.local` à la racine du dépôt et ajoute une
ligne `SUPABASE_DB_URL=` suivie de cette chaîne. Elle sert aux scripts lancés depuis ta machine (`npm run test:sql`, import des fiches,
accroches, débriefs, `scripts/install/equipe.mjs`, `scripts/install/seed-demo.mjs`, `scripts/maintenance/purger.mjs`) ; elle ne va
JAMAIS sur Vercel ni dans git.

Le certificat de la base, conseillé : vers une base distante, ces scripts chiffrent la connexion, mais ne vérifient le certificat du
serveur que si `SUPABASE_DB_CA` désigne son certificat racine (le chemin du fichier, au format PEM, ou son texte), à télécharger depuis
le tableau de bord de Supabase (réglages de la base, partie SSL) ; sans elle, ils le disent à chaque connexion. Ajoute la ligne
`SUPABASE_DB_CA=` suivie de ce chemin dans `.env.local` : les scripts d'import, d'accroches et de débrief, et `npm run test:sql`, l'y
lisent. `scripts/install/equipe.mjs`, `scripts/install/seed-demo.mjs` et `scripts/maintenance/purger.mjs` ne lisent dans `.env.local`
que l'adresse de la base : pour eux, pose-la aussi dans le terminal (`export SUPABASE_DB_CA=<chemin du certificat>`). Elle ne sert
qu'aux scripts, jamais à Vercel.

Puis, sur cette base neuve et encore vide : `TEST_SQL_DISTANT=1 npm run test:sql` (un test SQL par table, chacun annulé à la fin). Le
lanceur refuse une base distante sans cette variable : il est fait pour une base de test, jamais pour une base qui a de vraies fiches ;
ne le rejoue plus une fois l'équipe au travail.

### 2.4 Les clés, pour Vercel

Supabase › Project Settings › API Keys (l'adresse du projet est dans Data API, et le bouton Connect montre aussi ces valeurs) :

| Dans Supabase | Variable (Vercel) |
|---|---|
| l'adresse du projet (Project URL) | `NEXT_PUBLIC_SUPABASE_URL` |
| la clé publique : « anon » ou « publishable » | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| la clé secrète : « service_role » ou « secret » | `SUPABASE_SERVICE_ROLE_KEY` (jamais préfixée `NEXT_PUBLIC_`) |

La clé publique est faite pour le navigateur : ce qui protège les données, c'est la RLS de la base. La clé secrète passe outre la RLS :
elle ne sert que côté serveur, aux routes (webhooks, `/api/sante`, aperçu d'une invitation) et, après le contrôle du rôle, à la purge
RGPD de l'écran Réglages et à l'effacement des appels d'une fiche (bouton « Effacer cette fiche », sur la fiche).

### 2.5 L'authentification (une fois l'adresse du site connue, étape 4.3)

- Authentication › URL Configuration : **Site URL** `https://<ton-domaine>` ; **Redirect URLs** : `https://<ton-domaine>/auth/callback`.
  Sans ces deux adresses, le lien de confirmation et celui du mot de passe oublié ne mènent nulle part.
- Authentication › Sign In / Providers (e-mail) : laisse les inscriptions **activées** (« Allow new users to sign up ») : c'est la base
  qui refuse toute inscription sans invitation valide (déclencheur `gerer_nouvel_utilisateur`) ; couper les inscriptions bloquerait
  aussi les invitations. Garde la confirmation de l'e-mail (le réglage par défaut).
- Le service d'e-mails par défaut de Supabase a un petit quota (« Trop d'envois d'e-mails ») : pour une équipe, branche ton propre
  serveur SMTP dans les réglages d'e-mails de l'authentification.

## 3. La configuration de ta niche

`config/niche.json` est la configuration de ton instance ; il arrive identique à `config/niche.exemple.json`, une niche fictive
(paysagistes) à remplacer entièrement. Les règles sont dans `config/schema.ts` (la forme) et `config/garde-fous.ts` (ce qui est refusé).

| Partie | Ce qu'elle contient | Pour en savoir plus |
|---|---|---|
| `marque` | nom de l'outil et de l'équipe, identité du robot qui lit les sites (`userAgent`), couleur | `docs/accroches.md` |
| `pays` | code, fuseau, indicatif ; langue « fr » | |
| `offre` | ce que tu vends, à qui, le problème, le mécanisme, la promesse, la phrase prix, le rendez-vous à décrocher | |
| `cible` | métiers, taille, décideur, exclusions | `docs/sourcing.md` |
| `script`, `objections` | ton, ouvertures, questions, pitch, close, messagerie, crochets ; objections et réponses | |
| `issues`, `tentativesMax` | les issues du Poste (les 8 du socle et tes ajouts), le nombre de tentatives | |
| `score`, `sources` | la grille de score, les codes NAF, départements, Maps, mots du métier | `docs/sourcing.md` |
| `accroche`, `debrief` | mots indices et interdits, exemples d'accroche ; champs de découverte du débrief | `docs/accroches.md`, `docs/debrief.md` |
| `telephonie`, `agenda` | l'outil d'appel et son mode, l'enregistrement ; l'outil d'agenda et le lien public de réservation | `docs/telephonie.md`, `docs/agenda.md` |
| `legal` | responsable, e-mail RGPD public, annonce d'enregistrement, phrases d'opposition et d'origine, conservation | `docs/legal.md` |

Ce qui est refusé, et arrête le build :

- toute promesse de résultat dans ce qui est dit au prospect : ni chiffre de résultat (pourcentage, nombre de clients ou de
  rendez-vous), ni délai promis, ni « garanti », « assuré », « sans risque », « doubler » ;
- un autre objectif d'appel que le rendez-vous (`offre.objectifAppel` vaut « rdv ») ; un close sans `[deux créneaux]` ; une issue du
  socle manquante ;
- un tiret cadratin ; une adresse web ailleurs que dans `agenda.lienReservation` et `marque.userAgent` ; un e-mail ailleurs que dans
  `legal.contactRGPD` ; tout ce qui ressemble à une clé (les mots « token » ou « secret » compris) ;
- un champ de débrief ou une question dont l'identifiant est réservé au débrief (`resume`, `issue`, `objection`, `tags`…).

Puis `npm test` : il valide la config (schéma et garde-fous) et joue les tests du dépôt. Corrige jusqu'au vert, puis
`git add config/niche.json`, `git commit -m "Configuration de la niche"` et `git push` vers ton dépôt privé.

## 4. Vercel

### 4.1 Le projet

https://vercel.com/new › importe ton dépôt GitHub (Next.js est reconnu), ou dans ton terminal `vercel link`. Lie de toute façon ton
dossier local au projet (`vercel link`) : `scripts/install/secrets.mjs` en a besoin. Offre : Hobby est réservée à un usage personnel
et non commercial ; une agence prend Pro. Les fonctions tournent à Paris (`cdg1`, dans `vercel.json`).

### 4.2 Les variables de Supabase

Settings › Environment Variables, environnement **Production** : les trois variables de l'étape 2.4. Les variables `NEXT_PUBLIC_*`
sont figées au build : toute variable ajoutée ou changée demande un redéploiement.

### 4.3 Le premier déploiement

`npm run build` (une vérification locale), puis `vercel deploy --prod` (ou le déploiement lancé par l'import GitHub). Note l'adresse de
production (Settings › Domains : celle que donne Vercel, ou ton propre domaine) : c'est `https://<ton-domaine>` dans la suite. Reviens
alors à l'étape 2.5.

La protection des déploiements de Vercel (Settings › Deployment Protection) répond 401 sur les adresses protégées : les fournisseurs
doivent appeler le domaine de production, sans protection.

### 4.4 Les secrets des webhooks et des tâches planifiées

Avec le script (conseillé) ; il ne montre jamais une valeur et ne la passe jamais en argument :

```bash
node scripts/install/secrets.mjs --essai            # les NOMS qui seraient posés, et ceux à coller toi-même ; rien n'est exécuté
node scripts/install/secrets.mjs --copier <NOM>     # pour chaque secret à coller chez un fournisseur : posé et copié dans le presse-papiers
vercel deploy --prod                                # le secret doit être en ligne avant le premier envoi du fournisseur
node scripts/install/secrets.mjs                    # le reste (CRON_SECRET), puis redéploie
```

Après chaque `--copier`, redéploie, puis colle le secret aussitôt dans la console du fournisseur (étape 7), sans rien copier d'autre
entre-temps. Un secret déjà présent dans Vercel n'est jamais relu : pour le recoller, `--remplacer --copier <NOM>` (nouvelle valeur),
redéploiement, nouveau collage. `--environnement preview` pose les secrets pour les déploiements de prévisualisation ;
`--config <fichier>` lit une autre config que `config/niche.json`.

À la main : Settings › Environment Variables › Add, environnement Production, une valeur longue et aléatoire tirée du générateur de ton
gestionnaire de mots de passe (32 caractères ou plus, lettres et chiffres), marquée « Sensitive » si Vercel le propose.

| Variable | Quand | Longueur | Où la coller ensuite |
|---|---|---|---|
| `ONOFF_WEBHOOK_TOKEN` | Onoff | 16 au moins (32 conseillés) | console Onoff, champ « Api key » du webhook |
| `RINGOVER_WEBHOOK_SECRET` | Ringover | 24 au moins | au bout de l'adresse du webhook, après `?secret=` |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Calendly | 32 au moins (plus courte, chaque envoi est refusé) | la `signing_key` de l'abonnement Calendly |
| `ICLOSED_WEBHOOK_SECRET` | iClosed | 24 au moins | au bout de l'adresse du webhook, après `?secret=` |
| `CRON_SECRET` | toujours | 16 au moins | nulle part : Vercel l'envoie lui-même aux tâches planifiées |

Celles que créent les fournisseurs, à coller toi-même : `AIRCALL_WEBHOOK_TOKEN` (affiché par Aircall à la création du webhook) ;
facultatives : `ONOFF_API_KEY`, `AIRCALL_API_ID`, `AIRCALL_API_TOKEN` (reprise de l'audio et des transcriptions) ; Google :
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, facultative `GOOGLE_CALENDAR_ID`.

### 4.5 Les tâches planifiées

`vercel.json` déclare deux tâches quotidiennes : la synchronisation de Google Agenda (`/api/agenda/google/sync`, 5 h UTC) et la reprise
de l'audio des appels (`/api/telephonie/recuperation`, 6 h 17 UTC). Elles tournent quelle que soit la config et exigent `CRON_SECRET`
(sinon elles répondent 503). L'offre Hobby n'accepte qu'un passage par jour ; sur Pro, la reprise peut tourner chaque minute
(`docs/telephonie.md`).

## 5. Vérifier

Ouvre `https://<ton-domaine>/api/sante` dans ton navigateur : des booléens seulement (200 si tout va bien, 503 sinon).

| Champ faux | Ce qu'il veut dire | Que faire |
|---|---|---|
| `base_joignable` | la base ne répond pas | vérifie `NEXT_PUBLIC_SUPABASE_URL` et les clés dans Vercel, et que le projet Supabase n'est pas en pause ; redéploie |
| `schema_a_jour` | la migration n'est pas passée, ou la clé secrète manque (elle seule lit la version du schéma) | étape 2.2 ; `SUPABASE_SERVICE_ROLE_KEY` |
| `config_valide` | `config/niche.json` est refusé | `npm test` en local, corrige, redéploie |
| `variables.supabase_url`, `supabase_cle_anon`, `supabase_cle_service` | une variable de Supabase manque | étape 4.2, puis redéploie |
| `variables.telephonie` | il manque le secret du webhook de ton outil d'appel | étape 4.4, puis redéploie |
| `variables.agenda` | il manque une variable de ton outil d'agenda (pour Google : OAuth et `CRON_SECRET`) | étape 4.4, puis redéploie |

Puis :

```bash
node scripts/install/verifier.mjs https://<ton-domaine>
```

Il relit `/api/sante`, envoie à chaque webhook de ta config un mauvais secret (refus 401 attendu ; 503 : la variable manque dans
Vercel), appelle les deux tâches planifiées avec un mauvais secret (401 attendu ; 503 : `CRON_SECRET` manque) et contrôle les
en-têtes de sécurité (`Permissions-Policy`, qui doit donner le micro à ton outil d'appel ; `X-Frame-Options` ; `X-Content-Type-Options`).
Il écrit des lignes « OK » et « À FAIRE », jamais une valeur ; code 0 si tout est OK. Avec `--env-file <fichier>` (des lignes NOM=valeur
avec les secrets des webhooks, dans un fichier hors du dépôt que tu supprimes ensuite), il vérifie aussi qu'un événement de test
correctement signé est accepté ; cet événement est d'un type que l'application ignore : rien n'est écrit en base.

## 6. Le compte propriétaire et l'équipe

Le compte propriétaire se crée par un script (ou par une requête SQL) : c'est le seul geste de l'équipe qui ne passe pas par
l'application. Ensuite, l'écran **Réglages** gère tout le reste : les invitations (le lien est montré une seule fois, avec un bouton
Copier), les rôles, le retrait d'un compte, l'e-mail de chacun chez l'outil de téléphonie, le plafond de tentatives, l'objectif du jour,
l'enregistrement des appels et la purge RGPD. Le script reste une voie en ligne de commande.

**Avec le script** (simulation d'abord, rien n'est gardé ni copié) :

```bash
node scripts/install/equipe.mjs --proprietaire <ton e-mail> --nom "<Prénom Nom>" --domaine https://<ton-domaine> --objectif <N>
node scripts/install/equipe.mjs --proprietaire <ton e-mail> --nom "<Prénom Nom>" --domaine https://<ton-domaine> --objectif <N> --appliquer
```

Il crée l'équipe (le nom `marque.nomEquipe`, le pays et le fuseau de ta config) et l'invitation de son propriétaire, valable 14 jours
(relancé avant l'inscription, il remplace le lien précédent, qui ne sert plus) ; il aligne aussi les réglages de l'équipe :
`tentatives_max` (le plafond de la base, « injoignable ») prend la valeur de `tentativesMax` (le plafond de la file du Poste), et
`--objectif` fixe l'objectif d'appels par jour et par appelant. Avec `--appliquer`, le lien d'inscription est copié dans ton
presse-papiers, jamais affiché. Tant que les deux plafonds diffèrent, la base applique le plus bas. Après un changement de
`tentativesMax` : le bouton « Aligner sur la configuration » de l'écran Réglages, ou `node scripts/install/equipe.mjs --reglages`, puis
la même commande avec `--appliquer`.

**À la main** (Supabase › SQL Editor) :

```sql
select public.amorcer_workspace('Nom de l''équipe', 'toi@example.com', 'Prénom Nom', 'Europe/Paris', 'FR');
update public.reglages set tentatives_max = <tentativesMax de ta config>, objectif_appels_jour = <N>;
```

Le résultat de la première ligne contient `jeton` : ouvre `https://<ton-domaine>/signup?invitation=<jeton>`. Ce jeton donne accès à ton
instance : ne le transmets à personne. `amorcer_workspace` se rejoue tant que personne n'a accepté l'invitation : chaque nouvel amorçage
annule le lien d'amorçage précédent, et aucun lien d'amorçage ne sert une fois le propriétaire inscrit (la fonction refuse alors une
équipe qui a déjà un propriétaire).

**L'inscription** : la page « Créer ton compte » montre le nom de l'équipe et le rôle ; saisis ton prénom et ton nom, l'e-mail de
l'invitation et un mot de passe de 8 caractères au moins. Si Supabase demande la confirmation de l'e-mail (le réglage par défaut),
clique le lien reçu en l'ouvrant dans le même navigateur (il revient sur `/auth/callback`), puis connecte-toi sur `/login`. Les
messages possibles : « Invitation refusée » (lien invalide, expiré, déjà utilisé ou prévu pour un autre e-mail : crée une nouvelle
invitation), « Trop d'envois d'e-mails » (le quota de Supabase : attends, ou branche ton SMTP), « Confirme d'abord ton e-mail ».

**Les autres comptes** : dans l'écran Réglages › Invitations (propriétaire ou membre ; seul le propriétaire invite un autre
propriétaire), choisis le rôle, l'e-mail ou le nom de la personne, puis « Créer le lien » : il est montré une seule fois, avec un bouton
Copier, et vaut 14 jours. Les invitations en attente s'y révoquent. En ligne de commande :

```bash
node scripts/install/equipe.mjs --inviter <e-mail> --role appelant --domaine https://<ton-domaine>              # simulation
node scripts/install/equipe.mjs --inviter <e-mail> --role appelant --domaine https://<ton-domaine> --appliquer  # lien copié
```

Transmets toi-même le lien à la personne. À la main, dans le SQL Editor (le résultat contient `jeton`, pour la même adresse
`/signup?invitation=<jeton>`) :

```sql
insert into public.invitations (workspace_id, role, email, nom_invite)
select id, 'appelant', 'appelant@example.com', 'Prénom' from public.workspaces
returning jeton;
```

Les rôles : `proprietaire` (tout, dont l'équipe, les invitations et les réglages), `membre` (tout sauf changer les rôles, retirer
quelqu'un ou effacer une fiche), `appelant` (le Poste, ses fiches et les fiches non attribuées de la file ; dans les Réglages, seulement
son profil et l'aide de ses outils).

## 7. Les fournisseurs

Après chaque fournisseur branché, relance `node scripts/install/verifier.mjs https://<ton-domaine>`.

**Téléphonie** (le détail, les pannes connues et la reprise de l'audio : `docs/telephonie.md`). Adresse des webhooks :
`https://<ton-domaine>/api/telephonie/<fournisseur>/webhook`.

- **Onoff Business** : chaque appelant installe l'extension « Onoff Business Click2Call »
  (https://chromewebstore.google.com/detail/jbfkkljambdhjlkcfkcbpjfkkamkccfm) et s'y connecte. Le webhook se crée depuis ton espace
  Onoff Business (Integrations › Webhook › Call ; plans Advanced et Max) : `ONOFF_WEBHOOK_TOKEN` doit être déployé AVANT, car Onoff
  envoie un essai dès la création de l'intégration.
- **Aircall** : https://dashboard.aircall.io › Integrations & API › Webhooks ; Aircall affiche son jeton : colle-le dans
  `AIRCALL_WEBHOOK_TOKEN` et redéploie aussitôt.
- **Ringover (expérimental, jamais testé sur un vrai compte)** : https://dashboard.ringover.com › Développeur › Webhooks, adresse suivie
  de `?secret=` et de la valeur de `RINGOVER_WEBHOOK_SECRET`.
- **Softphone, téléphone** : rien à brancher côté serveur.

**Agenda** (le détail : `docs/agenda.md`). Adresse des webhooks : `https://<ton-domaine>/api/agenda/<fournisseur>/webhook`.

- **Calendly** : un jeton d'accès personnel (https://calendly.com/integrations/api_webhooks), puis l'abonnement créé par l'API dans ton
  terminal, avec la clé de `CALENDLY_WEBHOOK_SIGNING_KEY` (commandes dans `docs/agenda.md`). Les webhooks demandent une offre payante.
- **iClosed** : https://app.iclosed.io › Settings › Developer › Webhooks, adresse suivie de `?secret=` et de la valeur de
  `ICLOSED_WEBHOOK_SECRET`.
- **Google Agenda** : https://console.cloud.google.com (projet, API Google Calendar, écran de consentement, identifiants OAuth), puis le
  jeton de rafraîchissement avec https://developers.google.com/oauthplayground. Publie l'application « In production » : en « Testing », le
  jeton expire au bout de 7 jours.
- **Aucun** : rien à brancher ; chaque personne peut s'abonner à son flux ICS depuis l'écran Agenda.

**L'appel d'essai** : crée une fiche à ton propre numéro (Prospects › « Saisir un prospect »), appelle-la par « Appeler depuis le
Poste » sur la fiche, note une issue (« Hors cible » une fois l'essai fini). Avec un webhook, les journaux de Vercel (Logs) montrent
une ligne `[telephonie] <fournisseur>:…:fiche:appelant:… (200)` ; `sans_fiche` : numéro non retrouvé ; `sans_appelant` : l'e-mail de
l'appelant chez le fournisseur n'est pas celui de son compte.

## 8. La démonstration (facultative)

```bash
node scripts/install/seed-demo.mjs               # simulation : ce qui serait ajouté, en compteurs
node scripts/install/seed-demo.mjs --appliquer   # 40 fiches 100 % fictives, dont une sur la liste d'opposition
```

Les fiches « Atelier Démo 01 » à « 40 » suivent la niche de l'exemple (paysagistes), avec des numéros de la plage réservée à la fiction
(01 99 00 xx xx) et des e-mails en `@example.com` : elles montrent le Poste, elles ne s'appellent pas. Le script refuse une base qui a
déjà de vraies fiches, ou sans équipe (`--forcer` passe outre). Pour retirer la démonstration :
`node scripts/install/seed-demo.mjs --effacer`, puis la même commande avec `--appliquer`.

## 9. Le premier import

Le parcours complet, avec ou sans Google Maps, avec ton propre fichier, et hors de France : `docs/sourcing.md`. Le plus court, en France :

```bash
node scripts/sourcing/sirene.mjs fetch --essai                               # le volume annoncé, rien n'est gardé
node scripts/sourcing/sirene.mjs fetch
node scripts/sourcing/sirene.mjs build --limite 500
node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ.csv              # simulation
node scripts/sourcing/importer.mjs donnees/sirene-AAAA-MM-JJ.csv --appliquer
```

Les fichiers restent dans `donnees/`, que git ignore. Ensuite, si tu veux une première phrase par prospect : `docs/accroches.md`.

## 10. L'enregistrement des appels (si l'équipe enregistre)

Lis d'abord `docs/legal.md`. Rien n'est gardé (ni audio, ni transcription) sans deux conditions : l'enregistrement complet activé pour
l'équipe, ET l'annonce lue au prospect, cochée au Poste pendant CET appel. Un gestionnaire active l'enregistrement complet lui-même,
dans l'écran Réglages › Enregistrement des appels : il lit le cadre légal, coche « J'ai lu ce cadre et je l'accepte », puis « Activer
l'enregistrement ». La base exige et date cette acceptation. L'écran refuse tant que la config ne déclare pas
`telephonie.enregistrement: true` (seuls Onoff, Aircall et Ringover envoient un enregistrement) ; active-le aussi chez ton fournisseur.
Pour arrêter : « Désactiver l'enregistrement ».

## 11. Après l'installation

- **La purge RGPD** n'est pas planifiée d'office (aucune tâche planifiée de l'application ne la lance) : une fois par mois, le bouton
  « Purger les fiches inactives » de l'écran Réglages (RGPD), ou `node scripts/maintenance/purger.mjs` (simulation) puis la même
  commande avec `--appliquer`, depuis ton ordinateur ou une tâche planifiée hors de Vercel (`docs/legal.md`).
- **Un changement d'outil d'appel** : modifie `telephonie` dans la config, `npm test`, les secrets du nouvel outil (étape 4.4), puis
  redéploie : l'en-tête qui donne le micro à l'outil est calculé au build.
- **Une base en pause** (offre gratuite de Supabase, 7 jours sans activité) : relance-la depuis le tableau de bord de Supabase.

## Liste de contrôle

- [ ] `npm test` vert avec ta config ; `config/niche.json` poussé dans ton dépôt privé (aucun `.env*`, aucun fichier de `donnees/`).
- [ ] Migration passée ; `TEST_SQL_DISTANT=1 npm run test:sql` vert sur la base neuve, encore vide.
- [ ] Les trois variables de Supabase dans Vercel ; un déploiement de production.
- [ ] Supabase : Site URL et `/auth/callback` ; inscriptions laissées activées.
- [ ] Les secrets posés (`scripts/install/secrets.mjs`), puis redéployé.
- [ ] `/api/sante` : `ok` vrai ; `scripts/install/verifier.mjs` : code 0.
- [ ] Le compte propriétaire créé et connecté ; les appelants invités.
- [ ] Les webhooks branchés chez les fournisseurs ; un appel d'essai vers ton propre numéro.
- [ ] L'enregistrement : activé dans l'écran Réglages après lecture du cadre légal (`docs/legal.md`), ou laissé éteint.
- [ ] Le premier import, en simulation puis avec `--appliquer`.
- [ ] La purge RGPD notée chaque mois dans ton agenda (« Purger les fiches inactives », écran Réglages), ou programmée avec le script.
