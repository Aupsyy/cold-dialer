---
name: installer
description: Installe et configure le poste d'appels de prospection B2B (Next.js, Supabase, Vercel) pour la niche de l'utilisateur, de zéro jusqu'à l'instance en ligne. Six séries de questions (l'équipe, l'offre, la cible et la source, le script, les outils, le légal), config/niche.json écrit en JSON puis validé par npm test, base Supabase, projet Vercel, secrets des webhooks posés sans jamais être affichés, déploiement, vérification, compte propriétaire, démonstration fictive. À utiliser quand l'utilisateur dit « installe le poste d'appels », « configure l'outil pour ma niche », « je veux mon propre poste d'appels », « on met en place la prospection téléphonique », « refais la config », « je change d'outil d'appel ou d'agenda », même sans le mot « skill ». Pas pour importer des fiches (sourcer-leads), écrire des accroches (accroches), débriefer un appel (debrief) ni retoucher le script après des semaines d'appels (ajuster-script).
---

# Installer le poste d'appels pour une niche

## But

Mettre en ligne, en une session, une instance PRIVÉE du poste d'appels réglée pour la niche de l'utilisateur : son offre, sa cible, son
script, ses outils, ses textes légaux. Tu poses les questions, tu écris le JSON, tu lances les commandes et tu expliques chaque geste ;
l'utilisateur crée ses comptes, se connecte dans SON terminal et colle lui-même ses clés. Aucune clé ne passe par la conversation, rien
n'est envoyé à un prospect, et la configuration ne contient aucune promesse de résultat : l'outil organise le travail, le résultat
dépend de l'offre et de l'appelant.

## Entrées

- Les réponses de l'utilisateur aux six séries de questions (étape 1).
- Le dépôt modèle sur GitHub (`<propriétaire>/<dépôt-modèle>`), marqué « Template repository » (Settings › General du dépôt modèle) ;
  sinon un fork ou un clone.
- Ses comptes : GitHub, Supabase, Vercel ; selon ses choix, Onoff, Aircall ou Ringover, et Calendly, iClosed ou Google Cloud.
- À lire dans le dépôt avant d'écrire la config : `config/niche.exemple.json` (la forme complète, niche fictive), `config/schema.ts`
  (les règles), `config/garde-fous.ts` (ce qui est refusé), `docs/telephonie.md`, `docs/agenda.md`, `docs/sourcing.md`,
  `docs/legal.md` ; `docs/installation.md` décrit le même parcours, fait à la main.

## Étapes

### 1. Les questions : une série par message

Une série par message, avec des choix proposés et l'exemple fictif ci-dessous (une équipe « Atelier Démo » qui vend « Planning Démo »,
un planning en ligne pour les auto-écoles). Attends les réponses, reformule-les en une phrase, puis dis en une ligne dans quelles clés
de `config/niche.json` elles iront. Ne recopie jamais l'exemple tel quel : il montre la forme, pas le contenu de l'utilisateur.

**Série 1 : toi et l'équipe.**
- Le nom de l'équipe, dit au téléphone (`marque.nomEquipe`, le crochet `[équipe]`) ; le nom affiché de l'outil (`marque.nomProduit`,
  « Poste d'appels » par défaut) ; une couleur `#RRGGBB` (facultative).
- Le pays : FR, BE, CH, CA ou autre (`pays.code`, `pays.indicatif` : +33, +32, +41, +1 ; `pays.fuseau` : Europe/Paris, Europe/Brussels,
  Europe/Zurich, America/Toronto ; `pays.langue` reste « fr »). Hors de France, le registre SIRENE ne sert pas : un CSV, ou l'API Google Places.
- Seul ou en équipe : combien d'appelants (chacun recevra une invitation, étape 3.8).
- Une page web qui présente le robot qui lira les sites des prospects, pour `marque.userAgent` (« NomBot/1.0 (+https://…) »).
- Exemple : « Atelier Démo », « Poste d'appels », FR, Europe/Paris, deux appelants, `AtelierDemoBot/1.0 (+https://example.org/robot)`.

**Série 2 : l'offre.**
- Ce que tu vends (`offre.nom`), à qui (`offre.pourQui`), le problème réglé (`offre.probleme`), comment (`offre.mecanisme`), la promesse
  (`offre.promesse`), la phrase prix (`offre.phrasePrix` : le prix se voit au rendez-vous), le rendez-vous à décrocher (`offre.rdv` : un
  nom, une durée de 20, 30 ou 45 minutes, un canal `visio`, `telephone` ou `sur_place`). `offre.objectifAppel` vaut toujours « rdv » : au
  téléphone, on ne vend que le rendez-vous.
- La promesse : tu la REFORMULES pour dire ce que l'offre fait, sans chiffre de résultat (ni pourcentage, ni nombre de clients ou de
  rendez-vous), sans délai promis, sans « garanti », « assuré », « sans risque » ni « doubler ». Si l'utilisateur tient à un chiffre,
  explique le garde-fou (`config/garde-fous.ts`, joué au build) et propose deux reformulations.
- Exemple : nom « Planning Démo, le planning en ligne des auto-écoles (exemple fictif) » ; problème « Les leçons annulées la veille
  laissent des trous dans le planning des moniteurs, et l'accueil passe des heures au téléphone pour les remplir » ; mécanisme « Les
  élèves réservent et déplacent leurs leçons en ligne ; un créneau libéré est proposé aux élèves de la liste d'attente » ; promesse « Un
  planning que vos élèves gèrent eux-mêmes, et chaque créneau libéré proposé aux élèves qui attendent » ; phrase prix « Le tarif dépend du
  nombre de moniteurs : c'est ce qu'on regarde ensemble pendant la démonstration » ; rendez-vous « Démonstration du planning », 30 minutes,
  visio.

**Série 3 : la cible et la source.**
- Le ou les métiers (`cible.metiers`), une description (`cible.description`), la taille en salariés (`cible.tailleMin`, `cible.tailleMax`),
  le décideur à joindre (`cible.decideur`), les exclusions (`cible.exclusions`).
- Les codes NAF : tu les PROPOSES à partir du métier, l'utilisateur les valide sur la nomenclature de l'INSEE (`sources.sirene.naf`). Les
  départements, ou « tous » (`sources.sirene.departements`) ; les entrepreneurs individuels gardés ou non (`sources.sirene.exclureEI`) ;
  des mots du nom à inclure ou exclure.
- Google : non par défaut (`sources.places.actif: false`). C'est l'API officielle Places, avec une clé que l'équipe crée elle-même
  sur son compte Google Cloud (facturation à son nom, quota et alerte de budget à régler) : `docs/sourcing.md`, section Google.
  Jamais de lecture de Google Maps par un robot.
- Ou bien « j'ai déjà un CSV » (Belgique, Suisse, Canada, un annuaire, un export de CRM) : son format est dans `docs/sourcing.md`.
- Tu en tires aussi, et tu les montres : la grille de score (`score`, les types de critères de `docs/sourcing.md`, seuils A et B), les
  mots du métier (`sources.motsVidesAppariement`, `accroche.motsIndices`, `accroche.interdits`), les débuts d'e-mail préférés
  (`sources.prefixesEmail`), et les champs du débrief (`debrief.champs` : identifiants en minuscules, jamais `resume`, `issue`,
  `objection`, `objection_texte`, `interet`, `decideur_joint`, `douleurs`, `croyances`, `citations`, `prochaine_etape` ni `tags`).
- Exemple : métiers « auto-école », « école de conduite » ; de 1 à 20 salariés ; décideur « gérant » ; exclusions « Réseaux franchisés
  nationaux », « Entreprises en liquidation ou en sommeil » ; NAF proposé 85.53Z (enseignement de la conduite), à valider ;
  départements 31, 81 et 82 ; pas de Google ; champs du débrief `source_eleves`, `outil_planning`, `frein_principal`.

**Série 4 : le script.**
- Le ton (`script.ton`) : `direct_sec` (direct et sobre), `curiosite_doux` (curieux et doux), `expert_pose` (posé, quelqu'un qui connaît
  le métier) ou `chaleureux` (chaleureux et simple) ; le vouvoiement (`script.vouvoiement`).
- Tu proposes un BROUILLON complet à partir des séries 2 et 3 ; l'utilisateur le corrige phrase par phrase : l'ouverture
  (`script.ouverture.portable`, `.standard`, `.commentAvezVousMonNumero`), la permission (facultative), 3 à 6 questions de découverte
  (`script.questions` : `id`, `texte`, `but`), le pitch, le close (il contient `[deux créneaux]`), la messagerie, les 5 objections les
  plus fréquentes avec ses réponses (`objections` : `code` en minuscules et tirets, `libelle`, `reponse`, `relance` facultative), et
  trois exemples d'accroche fictifs qui donnent le ton (`accroche.exemples` : de 15 à 30 mots, `accroche.longueurMax` caractères au plus).
- La réponse à « Comment avez-vous mon numéro ? » (`script.ouverture.commentAvezVousMonNumero`) : celle de l'exemple vaut pour le
  parcours par défaut (le registre public des entreprises, puis le site de l'entreprise). Adapte cette phrase et `legal.phraseSource`
  aux sources réellement utilisées (un annuaire, son propre fichier, Google s'il l'active) : elles sont dites au prospect.
- Crochets que le Poste remplit : `[prénom]`, `[nom]`, `[entreprise]`, `[ville]`, `[métier]`, `[ton prénom]`, `[équipe]`,
  `[deux créneaux]` ; chacun de ceux utilisés est déclaré dans `script.crochets`.
- Puis les issues (`issues`) : les 8 du socle (`pas_repondu`, `messagerie`, `standard`, `a_rappeler` avec `exigeRappel: true`,
  `rdv_fixe`, `pas_interesse`, `hors_cible`, `ne_plus_contacter`, ces quatre dernières avec `final: true`), une touche chacune (un chiffre
  ou une lettre), et ses ajouts (exemple : `sous_contrat`, « Engagé ailleurs ») ; le nombre de tentatives avant « injoignable »
  (`tentativesMax`, de 1 à 10) ; l'objectif d'appels par jour et par appelant (il n'est pas dans la config : il va dans les réglages de
  l'équipe, étape 3.7).
- Exemple (ton `expert_pose`, vouvoiement) : ouverture portable « Bonjour [prénom], [ton prénom] de [équipe]. Je vous appelle au sujet du
  planning des leçons de [entreprise] : vous êtes bien le gérant ? » ; question `annulations` « Quand un élève annule la veille, que devient
  le créneau du moniteur ? » ; close « Le plus simple, c'est de vous le montrer en visio, planning sous les yeux. Je peux vous proposer
  [deux créneaux] : lequel vous arrange ? » ; objection `deja-un-logiciel` « On a déjà un logiciel », réponse « Très bien. Qu'est-ce qui
  vous manque quand un élève annule au dernier moment ? La démonstration peut servir de comparaison, sans rien changer à ce qui marche. »

**Série 5 : les outils.**
- « Tu appelles avec quoi ? » (`telephonie`) :

  | Réponse | `fournisseur` | `mode` | Webhook (les appels arrivent dans les fiches) |
  |---|---|---|---|
  | Onoff Business (extension Chrome) | `onoff` | `extension` | oui, sur les plans Advanced et Max |
  | Aircall (téléphone dans le Poste) | `aircall` | `iframe` | oui |
  | Ringover (téléphone dans le Poste), EXPÉRIMENTAL : jamais testé sur un vrai compte | `ringover` | `iframe` | oui |
  | Un softphone : lequel ? (Zoiper, 3CX, Teams…) | `softphone` | `lien`, avec `schemaLien` `tel`, `callto` ou `sip` | non |
  | Ton téléphone | `telephone` | `lien` | non |

  `copierNumero` reste vrai. Le détail de chaque outil est dans `docs/telephonie.md`.
- « Enregistres-tu les appels ? » (Onoff, Aircall ou Ringover seulement : `telephonie.enregistrement`). Si oui, l'annonce est obligatoire
  (article 226-1 du Code pénal, recommandations de la CNIL) et rien n'est gardé sans DEUX conditions : un gestionnaire a activé
  l'enregistrement complet de l'équipe après avoir lu le cadre légal (étape 3.9), et l'annonce (`legal.annonceEnregistrement`) a été lue
  au prospect et cochée « lue » au Poste pour CET appel, pendant l'appel (entre « Appeler » et « Raccroché »).
- L'agenda (`agenda.fournisseur`) : `calendly` (les webhooks demandent une offre payante de Calendly ; en gratuit, le lien seul puis le
  bouton « RDV pris » au Poste), `iclosed`, `google` (lecture d'un agenda Google ; l'application OAuth doit être publiée « In production » :
  en « Testing », le jeton expire au bout de 7 jours), ou `aucun` (agenda interne). Le lien PUBLIC de la page de réservation
  (`agenda.lienReservation`, en https, obligatoire pour Calendly et iClosed), le pré-remplissage (`agenda.prefill`) ; `agenda.champLead`
  vaut « utm_content ». Le détail est dans `docs/agenda.md`.
- Exemple : Aircall, sans enregistrement ; Calendly en offre payante, lien public de la page « Démonstration du planning ».

**Série 6 : le légal.** Montre d'abord les textes par défaut de `config/niche.exemple.json`, puis demande ce qui change.
- Le responsable (`legal.responsable` : la société, comme dans ses mentions légales) ; l'e-mail RGPD public (`legal.contactRGPD`, le seul
  e-mail permis dans la config) ; la durée de conservation des fiches sans contact (`legal.conservationMois`, 36 au plus).
- La phrase d'origine des coordonnées (`legal.phraseSource`), par défaut « Vos coordonnées professionnelles viennent de sources
  publiques : le registre public des entreprises et le site internet de votre entreprise. » : elle doit rester VRAIE pour les sources
  réellement utilisées, comme la réponse du script à « Comment avez-vous mon numéro ? » (un annuaire, un fichier, Google : adapter les
  deux).
- L'annonce d'enregistrement (`legal.annonceEnregistrement`), par défaut « Je vous préviens que cet appel est enregistré pour le suivi de
  notre échange. Vous pouvez me demander d'arrêter l'enregistrement à tout moment. »
- La phrase d'opposition (`legal.phraseOpposition`), par défaut « Si vous ne souhaitez plus être contacté, dites-le-moi : je le note tout
  de suite et nous ne vous rappellerons plus. » (l'issue « Ne plus contacter » inscrit la fiche sur la liste d'opposition).

Fin des questions : montre en entier les textes qui seront dits au prospect (ouvertures, questions, pitch, close, messagerie, réponses
aux objections, exemples d'accroche) et attends un « oui » avant d'écrire.

### 2. Les gestes de l'utilisateur (tu guides, il fait)

Donne-lui cette liste dès la fin des questions : certains comptes prennent du temps (la validation d'un numéro Aircall français prend
plusieurs jours).

- Créer ses comptes GitHub, Supabase et Vercel (et ceux de ses outils de téléphonie et d'agenda).
- Dans SON terminal, pas dans la conversation : `gh auth login`, `supabase login`, `vercel login`.
- Supabase : un projet en région Paris (eu-west-3), avec un mot de passe de base qu'il garde dans son gestionnaire de mots de passe.
  Il colle lui-même dans `.env.local`, à la racine du dépôt, la ligne `SUPABASE_DB_URL=` suivie de la chaîne de connexion « Session
  pooler » (bouton Connect du projet), mot de passe compris ; et, conseillée, la ligne `SUPABASE_DB_CA=` suivie du chemin du certificat
  racine de sa base (téléchargé depuis le tableau de bord de Supabase, réglages de la base, partie SSL) : sans elle, les scripts
  chiffrent la connexion sans vérifier le certificat, et le disent. Tu n'ouvres jamais ce fichier.
- Vercel (Settings › Environment Variables, environnement Production) : il colle lui-même `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (la clé publique « anon » ou « publishable ») et `SUPABASE_SERVICE_ROLE_KEY` (la clé secrète
  « service_role » ou « secret », jamais préfixée NEXT_PUBLIC_) ; et les variables que créent les fournisseurs : `AIRCALL_WEBHOOK_TOKEN`
  (affiché par Aircall à la création du webhook), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, et les facultatives
  `ONOFF_API_KEY`, `AIRCALL_API_ID`, `AIRCALL_API_TOKEN`, `GOOGLE_CALENDAR_ID`.
- Supabase › Authentication › URL Configuration, une fois l'adresse connue (étape 3.4) : Site URL `https://<ton-domaine>`, Redirect URLs
  `https://<ton-domaine>/auth/callback`. Les inscriptions restent ACTIVÉES : c'est la base qui refuse toute inscription sans invitation.
- Chez les fournisseurs : créer la clé d'API, coller l'adresse du webhook et le secret que `secrets.mjs` a posé dans son presse-papiers,
  installer et vérifier l'extension Onoff dans Chrome ; pour Calendly, l'abonnement se crée par l'API dans son terminal (`docs/agenda.md`).
- Le premier appel d'essai vers son propre numéro (étape 3.11).

### 3. Ce que tu fais, dans l'ordre

1. **Le dépôt.** `gh repo create <nom> --private --template <propriétaire>/<dépôt-modèle> --clone`, puis `cd <nom>` et `npm ci`. Si le
   dépôt modèle n'est pas marqué « Template repository », GitHub refuse : clone-le, crée un dépôt privé vide et pousses-y le clone (un
   fork d'un dépôt public resterait public).
2. **La config.** Écris `config/niche.json` en JSON seulement, en partant de la forme complète de `config/niche.exemple.json` et en
   remplaçant chaque valeur par les réponses (jamais de code exécuté pour le produire). Puis `npm test` : il valide le schéma et les
   garde-fous. En cas d'échec, lis chaque message (le chemin de la clé et la règle), reformule AVEC l'utilisateur (surtout la promesse),
   réécris, relance. Ne modifie jamais `config/schema.ts`, `config/garde-fous.ts` ni un test pour faire passer la config.
3. **La base.** Une fois le projet Supabase créé et `SUPABASE_DB_URL` collée par l'utilisateur : dans SON terminal,
   `supabase link --project-ref <ref>` (la CLI demande le mot de passe de la base : il le tape, rien ne passe par toi), puis
   `supabase db push` (la migration `supabase/migrations/0001_schema.sql`). Sans la CLI : il colle ce fichier dans Supabase › SQL Editor
   et le lance. Puis toi : `TEST_SQL_DISTANT=1 npm run test:sql`, SEULEMENT maintenant, sur la base neuve et vide (chaque test est
   annulé ; le lanceur refuse une base distante sans cette variable : il est fait pour une base de test, jamais pour une base qui a de
   vraies fiches).
4. **Le projet Vercel et le premier déploiement.** `vercel link --yes` (un nouveau projet, équipe par défaut ; pour choisir l'équipe ou un
   projet existant, l'utilisateur lance `vercel link` dans son terminal). Une fois les trois clés Supabase collées par lui dans Vercel :
   `npm run build`, puis `vercel deploy --prod`. L'adresse de production (`https://<ton-domaine>` : celle que donne Vercel, ou son propre
   domaine) sert à la suite ; l'utilisateur la met dans Supabase › Authentication › URL Configuration.
5. **Les secrets.** `node scripts/install/secrets.mjs --essai` : les NOMS qui seraient posés et ceux qu'il colle lui-même. Pour chaque
   secret à coller chez un fournisseur (`ONOFF_WEBHOOK_TOKEN`, `RINGOVER_WEBHOOK_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY`,
   `ICLOSED_WEBHOOK_SECRET`), un à la fois : `node scripts/install/secrets.mjs --copier <NOM>` (posé dans Vercel et copié dans son
   presse-papiers, jamais affiché), puis `vercel deploy --prod` (le secret doit être en ligne AVANT le premier envoi du fournisseur : Onoff
   envoie un essai dès la création de l'intégration), puis l'utilisateur colle aussitôt, sans rien copier d'autre entre-temps, l'adresse
   `https://<ton-domaine>/api/telephonie/<fournisseur>/webhook` ou `https://<ton-domaine>/api/agenda/<fournisseur>/webhook` et ce secret
   dans la console du fournisseur (Ringover et iClosed : au bout de l'adresse, après `?secret=` ; le détail dans `docs/telephonie.md` et
   `docs/agenda.md`). Enfin `node scripts/install/secrets.mjs` sans option pour le reste (`CRON_SECRET`, que Vercel envoie lui-même aux
   tâches planifiées), puis `vercel deploy --prod`. Un secret déjà présent dans Vercel n'est jamais relu : pour le recoller,
   `node scripts/install/secrets.mjs --remplacer --copier <NOM>`, redéploiement, nouveau collage.
6. **La vérification.** `node scripts/install/verifier.mjs https://<ton-domaine>` : `/api/sante`, un mauvais secret refusé par chaque
   webhook de la config, les tâches planifiées, les en-têtes de sécurité. Des lignes OK et À FAIRE, aucune valeur. Traite chaque À FAIRE
   (le plus souvent : une variable à coller puis `vercel deploy --prod`) et relance jusqu'au code 0.
7. **Le compte propriétaire.** Demande son e-mail et son nom, puis la simulation :
   `node scripts/install/equipe.mjs --proprietaire <e-mail> --nom "<Prénom Nom>" --domaine https://<ton-domaine> --objectif <N>`.
   Elle dit ce qui serait créé (l'équipe au nom de `marque.nomEquipe`, l'invitation du propriétaire valable 14 jours, les réglages :
   `tentatives_max` pris dans `tentativesMax`, et l'objectif d'appels par jour et par appelant). Après un « oui » explicite, la même
   commande avec `--appliquer` : le lien d'inscription est dans son presse-papiers, jamais affiché. Il l'ouvre dans son navigateur,
   remplit « Créer ton compte » (prénom et nom, l'e-mail de l'invitation, un mot de passe de 8 caractères au moins) ; si Supabase demande
   la confirmation de l'e-mail (le réglage par défaut), il clique le lien reçu, dans le même navigateur ; puis il se connecte sur `/login`.
8. **Les appelants.** Une fois le propriétaire connecté, l'équipe se gère dans l'écran Réglages : Invitations (le rôle, l'e-mail ou le
   nom, puis « Créer le lien », montré une seule fois avec un bouton Copier, valable 14 jours), puis les rôles, les retraits, l'e-mail
   de chacun chez l'outil d'appel, le plafond de tentatives et l'objectif du jour. `equipe.mjs` reste la voie en ligne de commande :
   `node scripts/install/equipe.mjs --inviter <e-mail> --role appelant --domaine https://<ton-domaine>` en simulation, puis avec
   `--appliquer` ; l'utilisateur transmet lui-même le lien à son appelant. `--role membre` pour quelqu'un qui gère l'équipe.
9. **L'enregistrement**, seulement si l'équipe enregistre : un gestionnaire lit le cadre légal (`docs/legal.md`), puis l'active LUI-MÊME
   dans l'écran Réglages (Enregistrement des appels : la case « J'ai lu ce cadre et je l'accepte », puis « Activer l'enregistrement ») ;
   la config doit déclarer `telephonie.enregistrement: true`. Tu ne le fais jamais à sa place : c'est son acceptation du cadre légal.
10. **La démonstration**, sur accord : `node scripts/install/seed-demo.mjs` (simulation : 40 fiches 100 % fictives, des compteurs), puis
    `node scripts/install/seed-demo.mjs --appliquer`. Pour la retirer plus tard : `node scripts/install/seed-demo.mjs --effacer`, puis
    `--effacer --appliquer`.
11. **L'appel d'essai.** Les numéros de la démonstration sont fictifs (01 99 00 xx xx) : l'utilisateur crée une fiche d'essai à son propre
    numéro (Prospects › « Saisir un prospect »), l'appelle par « Appeler depuis le Poste » sur la fiche, puis la classe « Hors cible ».
    Avec un webhook, les journaux de Vercel (Logs) montrent une ligne `[telephonie] <fournisseur>:…:fiche:appelant:… (200)` :
    `sans_fiche` veut dire numéro non retrouvé, `sans_appelant` un e-mail chez le fournisseur différent de celui du compte
    (`docs/telephonie.md`).
12. **Le premier import** : passe au skill `sourcer-leads`.
13. **La config dans son dépôt.** `git status` (aucun `.env*` ni `donnees/` : `.gitignore` les écarte), `git add config/niche.json`,
    `git commit -m "Configuration de la niche"`, `git push` vers SON dépôt privé.

## Garde-fous

- Ne jamais demander, lire, afficher ni écrire une clé, un jeton, un mot de passe, l'URL de la base ni un lien d'invitation. Si
  l'utilisateur en colle un dans la conversation : lui dire de le révoquer et d'en créer un autre (Supabase, Vercel, fournisseur), et
  ne pas s'en servir.
- Ne jamais ouvrir `.env*` (ni lecture, ni recherche, ni affichage) : la présence d'une variable se lit dans `/api/sante` ou par
  `verifier.mjs`, jamais sa valeur.
- Tout ce qui écrit en base passe d'abord en simulation et attend un « oui » explicite : `equipe.mjs`, `seed-demo.mjs`, et l'import du
  skill `sourcer-leads`.
- Aucune promesse de résultat dans la config ; jamais un garde-fou, le schéma ou un test modifié pour faire passer `npm test`.
- Rien n'est envoyé à un prospect : ni appel automatique, ni SMS, ni e-mail. Les liens d'invitation vont à l'équipe, par l'utilisateur.
- Sources publiques seulement, jamais LinkedIn ; Google reste désactivé tant que l'utilisateur n'a pas créé sa clé et choisi de l'activer.
- Hébergement dans l'Union européenne : le projet Supabase en région Paris (eu-west-3), les fonctions Vercel à Paris (`vercel.json`) ;
  c'est le choix des régions qui garde les données dans l'UE.
- Le dépôt créé reste PRIVÉ ; tu ne pousses que sur le dépôt de l'utilisateur, à sa demande, et jamais un fichier de `donnees/`.
- Les connexions (`gh auth login`, `supabase login`, `vercel login`) et `supabase link`, qui demande le mot de passe de la base, se font
  dans le terminal de l'utilisateur.

## Sortie

- L'instance en ligne à `https://<ton-domaine>`, et `verifier.mjs` en code 0 (sinon la liste des À FAIRE restants, chacun avec son geste).
- `config/niche.json` validé par `npm test` et commité dans le dépôt privé de l'utilisateur.
- Le compte propriétaire créé ; les invitations des appelants dans son presse-papiers, transmises par lui.
- Un compte rendu court : ce qui est fait, ce qui reste à l'utilisateur (consoles des fournisseurs, enregistrement, premier import,
  appel d'essai), sans aucune valeur.

## Pièges connus

- **Onoff** : le webhook est réservé aux plans Advanced et Max ; le jeton doit être DÉPLOYÉ avant de créer l'intégration, sinon elle
  passe en « échec » ; « Ce site restreint notre extension » : `telephonie.fournisseur` n'est pas `onoff` dans la version déployée,
  redéployer.
- **Aircall** : chaque appelant se connecte dans le téléphone du Poste à chaque session ; la validation d'un numéro français prend
  plusieurs jours ; c'est Aircall qui crée `AIRCALL_WEBHOOK_TOKEN` : le coller et redéployer tout de suite (Aircall désactive un webhook
  qui échoue).
- **Ringover** : expérimental, jamais testé sur un vrai compte ; le secret est au bout de l'adresse du webhook.
- **Calendly** : l'offre gratuite n'a pas de webhook (lien, puis « RDV pris » au Poste) ; la clé de signature fait 32 caractères au
  moins (`secrets.mjs` en tire 43) : une clé plus courte, collée à la main, fait refuser chaque envoi (401).
- **Google** : application OAuth en « Testing » = jeton expiré au bout de 7 jours ; la publier « In production ».
- **Vercel** : l'offre Hobby est réservée à un usage non commercial (une agence prend Pro) et n'y lance chaque tâche planifiée qu'une
  fois par jour ; la protection des déploiements répond 401 aux fournisseurs : brancher les webhooks sur le domaine de production ; les
  variables `NEXT_PUBLIC_*` sont figées au build et toute variable changée demande un redéploiement.
- **Supabase** : l'offre gratuite met le projet en pause après 7 jours sans activité ; le service d'e-mails par défaut a un petit quota
  (« Trop d'envois d'e-mails » : attendre, ou brancher un SMTP à soi) ; les inscriptions doivent rester activées ; sans
  `/auth/callback` dans les Redirect URLs, le lien de confirmation ne mène nulle part.
- **Invitation refusée** (lien expiré au bout de 14 jours, déjà utilisé, autre e-mail) : relancer `equipe.mjs --proprietaire` avec
  `--appliquer`, rejouable tant que personne n'a accepté ; chaque nouvel amorçage annule le lien précédent, et aucun lien d'amorçage
  ne sert une fois le propriétaire inscrit.
- **Deux plafonds de tentatives** : `tentativesMax` (la file du Poste) et `tentatives_max` (la base, « injoignable ») ; `equipe.mjs` les
  aligne, et tant qu'ils diffèrent, la base applique le plus bas des deux. Après un changement de `tentativesMax` : le bouton « Aligner
  sur la configuration » de l'écran Réglages, ou `node scripts/install/equipe.mjs --reglages`, puis la même avec `--appliquer`.
- **La purge RGPD n'est pas planifiée** (aucune tâche planifiée de l'application ne la lance) : dis à l'utilisateur de la lancer chaque
  mois, bouton « Purger les fiches inactives » de l'écran Réglages, ou `node scripts/maintenance/purger.mjs` puis la même avec
  `--appliquer`.
- **Faux refus des garde-fous** : « double » (motif « doubl »), « rassuré » (motif « assuré »), les mots « token » et « secret » partout
  dans la config, un tiret cadratin, une adresse web ou un e-mail hors des clés prévues, un chiffre suivi de « % », « € », « x »,
  « clients », « rdv », « prospects »… : reformuler, jamais contourner.
- **`npm test` échoue sur un test du dépôt sans rapport avec la config** : ne pas le « réparer » ; le signaler au dépôt modèle.
- **Le certificat de la base** : `equipe.mjs`, `seed-demo.mjs` et `purger.mjs` ne lisent dans `.env.local` que `SUPABASE_DB_URL`, pas
  `SUPABASE_DB_CA` (que l'import, les accroches, le débrief et `npm run test:sql` y lisent) : pour vérifier le certificat avec eux,
  préfixe leur commande par `SUPABASE_DB_CA=<chemin du certificat>` (un chemin, pas un secret). Sans elle, ils le disent.
