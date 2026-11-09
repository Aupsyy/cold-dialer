# Agenda : Calendly, iClosed, Google Agenda ou agenda interne

Au téléphone, on ne vend que le rendez-vous. Ce document dit comment les rendez-vous arrivent dans l'application, ce que tu fais toi-même
dans chaque outil, les variables à poser (par leur **nom** : tu colles les valeurs toi-même dans Vercel, jamais dans un fichier du dépôt ni
dans une conversation) et les limites de chaque outil.

L'outil se choisit dans `config/niche.json`, partie `agenda` :

| Clé | Rôle |
|---|---|
| `fournisseur` | `calendly`, `iclosed`, `google` ou `aucun` (agenda interne) |
| `lienReservation` | le lien **public** de ta page de réservation (`https://…`) ; obligatoire pour Calendly et iClosed |
| `prefill` | `true` : le lien ouvert depuis le Poste est pré-rempli avec la fiche (nom, e-mail, identifiant de la fiche) |
| `champLead` | `utm_content` : le paramètre qui porte l'identifiant de la fiche dans le lien |

## En bref

| Outil | Comment les rendez-vous arrivent | Ce qu'il faut | Limites principales |
|---|---|---|---|
| **Calendly** | webhook signé, à chaque réservation, annulation ou no-show | offre **payante** de Calendly ; `CALENDLY_WEBHOOK_SIGNING_KEY` (32 caractères au moins) | offre gratuite : lien seul, puis « RDV pris » au Poste |
| **iClosed** | webhook, à chaque réservation, report ou annulation | webhooks activés dans iClosed ; `ICLOSED_WEBHOOK_SECRET` | renvoie un événement pendant 24 h (géré) ; ses issues n'apportent pas l'identifiant du rendez-vous |
| **Google Agenda** | synchronisation planifiée (cron de Vercel) qui **lit** l'agenda | une application OAuth Google ; `GOOGLE_*`, `CRON_SECRET` | application en mode « Testing » : jeton expiré au bout de 7 jours ; une synchronisation par jour sur l'offre Hobby ; un événement sans fiche n'est pas gardé |
| **Aucun** | rendez-vous pris au Poste ou ajoutés dans l'écran Agenda | rien | pas de réservation en ligne |

Dans tous les cas, chaque closer peut s'abonner à **son flux ICS** pour voir ses rendez-vous dans Google Agenda, Apple Calendrier ou Outlook
(voir plus bas).

**Rien n'est jamais envoyé au prospect par l'application** : ni e-mail, ni invitation. Les confirmations et rappels sont ceux de ton outil
de réservation.

## Ce que fait l'application

1. **Le lien de réservation** (Poste) : le lien public, pré-rempli si `prefill` vaut `true`. On n'y met que ce que la fiche contient vraiment
   (jamais le nom de l'entreprise à la place d'un nom de personne, jamais un numéro deviné). Il s'ouvre dans un nouvel onglet.
2. **Les événements** (réservé, déplacé, annulé, issue) sont ramenés à une même forme puis écrits par la base (fonction `evenement_agenda`,
   clé service). Chaque événement a une clé d'idempotence, notée au journal des intégrations (purgé à 90 jours) : une même clé reçue
   deux fois n'est traitée qu'une fois. Pour Google et iClosed, la clé porte la version de l'événement (Google : son horodatage de
   modification, `updated` ; iClosed : son horodatage de modification s'il est envoyé, sinon la minute de réception) : un aller-retour
   (un créneau, un autre, puis le premier) est traité à chaque fois. Un événement qui ne change rien au rendez-vous (même créneau, même
   fiche, même lien) donne `rdv_inchange` : ni le statut de la fiche ni son journal ne bougent.
3. **Le rapprochement avec une fiche**, dans cet ordre :
   1. le rendez-vous est déjà lié à une fiche ;
   2. l'identifiant de la fiche glissé dans le lien (`utm_content`) ;
   3. l'e-mail de l'invité ;
   4. le téléphone (les 9 derniers chiffres) ;
   5. sinon, pour Calendly et iClosed, le rendez-vous est gardé **« à vérifier »** : il apparaît en tête de l'écran Agenda, où tu le
      rattaches à la bonne fiche (recherche par entreprise, e-mail ou téléphone). Si ce n'est pas un rendez-vous de prospection, un
      propriétaire ou un membre le retire (« Ce n'est pas un prospect : retirer »). Google, qui lit tout un agenda, ne garde pas un
      événement sans fiche : ni rendez-vous « à vérifier », ni nom, e-mail ou numéro d'un tiers en base.
4. **La fiche suit son rendez-vous** : réservé ou déplacé, elle passe « RDV fixé » ; annulé, reporté ou no-show, elle revient « à rappeler »
   (rappel tout de suite) si elle n'a plus d'autre rendez-vous actif. Au Poste, une fiche qui a un rendez-vous à venir (pris ou
   confirmé) reste « RDV fixé » sur un « pas répondu », une messagerie, un standard ou un rappel : elle ne revient pas dans la file et
   ne compte pas de tentative de plus ; pour la rouvrir, on annule ou on reporte d'abord le rendez-vous. Une fiche sur la liste
   d'opposition ne bouge jamais.
5. **Le closer** est retrouvé par son e-mail chez l'outil (le même e-mail que son compte dans l'application) ; sinon c'est le propriétaire de
   l'équipe.

## Calendly

### Ce que tu fais toi-même

Les webhooks de Calendly demandent une **offre payante** (Standard ou plus) et se créent **par l'API** de Calendly (il n'y a pas d'écran
pour ça). Compte dix minutes.

1. Dans Calendly : **Integrations & apps › API and webhooks**, crée un **jeton d'accès personnel**. Garde-le pour toi.
2. Tire une **clé de signature** aléatoire de **32 caractères au moins** (`scripts/install/secrets.mjs`, lancé par le skill
   d'installation, en tire une de 43) et colle-la dans Vercel (**Settings › Environment Variables**) sous le nom
   `CALENDLY_WEBHOOK_SIGNING_KEY`. Redéploie. Une clé plus courte fait refuser chaque envoi de Calendly (401).
3. Dans ton terminal (le jeton et la clé sont lus sans s'afficher ni rester dans l'historique) :

   ```bash
   read -rs CALENDLY_TOKEN     # colle le jeton d'accès, puis Entrée
   read -rs CLE_SIGNATURE      # colle la même clé que CALENDLY_WEBHOOK_SIGNING_KEY, puis Entrée
   # Ton identifiant d'utilisateur et celui de ton organisation (resource.uri et resource.current_organization) :
   curl -s https://api.calendly.com/users/me -H "Authorization: Bearer $CALENDLY_TOKEN"
   # L'abonnement (remplace les trois valeurs entre chevrons) :
   curl -s -X POST https://api.calendly.com/webhook_subscriptions \
     -H "Authorization: Bearer $CALENDLY_TOKEN" -H "Content-Type: application/json" \
     -d '{"url":"https://<ton-domaine>/api/agenda/calendly/webhook",
          "events":["invitee.created","invitee.canceled","invitee_no_show.created"],
          "organization":"<uri de l organisation>","user":"<uri de l utilisateur>","scope":"user",
          "signing_key":"'"$CLE_SIGNATURE"'"}'
   unset CALENDLY_TOKEN CLE_SIGNATURE
   ```

   Pour recevoir les rendez-vous de toute l'organisation (plusieurs closers), un administrateur Calendly met `"scope":"organization"` et
   retire la ligne `user`.
4. Dans `config/niche.json` : `"fournisseur": "calendly"`, `lienReservation` = le lien public de ton type d'événement, `prefill: true`.

### Ce que l'application lit

| Événement Calendly | Effet |
|---|---|
| `invitee.created` | rendez-vous réservé (déplacé s'il vient d'un report) |
| `invitee.canceled` | rendez-vous annulé |
| `invitee_no_show.created` | issue « no-show » |

La signature (`Calendly-Webhook-Signature: t=…,v1=…`, HMAC-SHA256 de `t.<corps>`) est vérifiée en temps constant, et l'horodatage doit être à
**3 minutes** au plus de l'horloge du serveur ; sinon la requête est refusée (401). Une clé de moins de 32 caractères est refusée de la
même façon : elle se casserait hors ligne à partir d'une seule requête signée.

### Lien pré-rempli

`name` (le dirigeant de la fiche), `email`, `utm_content` (l'identifiant de la fiche, renvoyé par Calendly dans chaque webhook).

### Limites

- **Offre gratuite** : pas de webhook. Le Poste ouvre le lien, puis l'appelant clique **« RDV pris »** pour noter le rendez-vous.
- Un **report** crée un nouvel événement chez Calendly : l'application annule l'ancien rendez-vous et crée le nouveau (l'historique reste
  juste).
- Les événements de **groupe** (plusieurs invités sur un même créneau) ne sont pas gérés : un rendez-vous = un événement Calendly.
- Retirer une marque de no-show dans Calendly (`invitee_no_show.deleted`) n'est pas relu : corrige le statut dans l'écran Agenda.

## iClosed

### Ce que tu fais toi-même

1. Les webhooks d'iClosed sont (à la date de rédaction) en **bêta**, sur les offres Business et Enterprise, et réservés aux Super Admin. S'ils
   n'apparaissent pas dans tes réglages, demande à iClosed de les activer.
2. Tire un **secret** de 24 caractères au moins (le skill d'installation le fait pour toi) et colle-le dans Vercel sous le nom
   `ICLOSED_WEBHOOK_SECRET`. Redéploie.
3. Dans iClosed : **Settings › Developer › Webhooks**, ajoute un webhook avec l'adresse
   `https://<ton-domaine>/api/agenda/iclosed/webhook?secret=<le secret>` et coche **Call booked**, **Call rescheduled**, **Call cancelled**
   (et, si tu veux, **Call outcome added** : voir les limites).
4. Dans `config/niche.json` : `"fournisseur": "iclosed"`, `lienReservation` = le lien public de ta page de réservation, `prefill: true`.

### Ce que l'application lit

iClosed envoie un **tableau** d'événements (`hookType`) : « Call booked » (réservé), « Call rescheduled » (déplacé), « Call canceled »
(annulé). Il ne signe pas ses envois de façon documentée : la route vérifie le **secret partagé** de l'adresse (`?secret=`), comparé en temps
constant. Les outils qui savent poser un en-tête (Zapier, Make, n8n) peuvent l'envoyer dans l'en-tête `X-Webhook-Secret` à la place.

iClosed **renvoie un événement pendant 24 heures** tant qu'il n'a pas eu de réponse. La clé de chaque événement porte sa version : son
horodatage de modification s'il est envoyé (Zapier, Make), sinon la minute de réception (l'envoi natif n'en porte pas). Un renvoi dans la
même minute est reconnu comme un doublon ; un renvoi plus tardif est rejoué, sans effet sur la fiche si rien n'a changé (`rdv_inchange`) ;
un vrai aller-retour (réservé, annulé, puis réservé de nouveau) n'est jamais pris pour un doublon.

Les heures envoyées **sans décalage** (iClosed le fait parfois) sont lues dans le fuseau de l'événement, sinon dans celui de l'équipe
(`pays.fuseau`).

### Lien pré-rempli

`iclosedName` (le dirigeant), `iclosedEmail`, `iclosedPhone` (seulement au format international, `+33…`), `utm_content`. **Attention** :
iClosed crée le contact dès que la page pré-remplie s'ouvre ; n'ouvre le lien que pour une vraie réservation. iClosed refuse d'être affiché
dans une autre page : le lien s'ouvre dans un nouvel onglet.

### Limites

- **Les issues** (« Call outcome added ») n'apportent pas l'identifiant du rendez-vous : l'application ne peut pas les rattacher de façon sûre
  et les ignore. Note « tenu » ou « no-show » dans l'écran Agenda (un clic). Si tu passes par Zapier ou Make, ajoute le champ `event.uuid` du
  rendez-vous sous le nom `callId` : l'issue est alors appliquée (no-show, sinon tenu).
- iClosed écrit déjà le rendez-vous dans ton Google Agenda : l'application **n'écrit jamais dans Google**. Ne t'abonne pas au flux ICS dans
  ce même agenda, sinon chaque rendez-vous apparaîtrait deux fois.
- Le secret est dans l'adresse parce que l'écran d'iClosed ne prend qu'une adresse, sans en-tête : c'est une contrainte du fournisseur.
  Il apparaît donc dans les journaux de requêtes de Vercel : garde l'accès au projet Vercel restreint, et change le secret au moindre
  doute (nouveau secret dans Vercel et dans iClosed). Un outil qui sait poser un en-tête (Zapier, Make, n8n) l'envoie dans
  `X-Webhook-Secret`, hors de l'adresse.

## Google Agenda

L'application **lit** un agenda Google (jamais elle n'y écrit) et en ramène les rendez-vous de prospection. Il n'y a pas de webhook : une
tâche planifiée appelle `https://<ton-domaine>/api/agenda/google/sync`.

### Ce que tu fais toi-même

1. Dans **Google Cloud Console** : crée un projet, puis active **Google Calendar API**.
2. **Écran de consentement OAuth** : type **Interne** si tu as Google Workspace (le plus simple), sinon **Externe**. Ajoute la portée
   `https://www.googleapis.com/auth/calendar.events.readonly` (lecture seule, suffisante) ou `…/calendar.events`.
3. **Publie l'application** (bouton « Publier l'application », état **« In production »**). **Piège** : tant qu'elle reste en mode
   **« Testing »**, le jeton de rafraîchissement **expire au bout de 7 jours** et la synchronisation s'arrête (journal :
   `agenda:google:jeton_refuse`). En type Externe sans vérification, Google affiche « application non validée » au moment de donner ton
   accord : clique « Paramètres avancés » puis continue (c'est ta propre application).
4. **Identifiants › Créer des identifiants › ID client OAuth**, type **Application Web**, avec l'URI de redirection
   `https://developers.google.com/oauthplayground`. Colle l'ID et le secret dans Vercel : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
5. Le **jeton de rafraîchissement**, avec OAuth 2.0 Playground (`https://developers.google.com/oauthplayground`) : roue dentée › « Use your own
   OAuth credentials » (ton ID et ton secret) ; choisis la portée de l'étape 2 ; « Authorize APIs » avec le compte Google de l'agenda ;
   « Exchange authorization code for tokens » ; colle le **refresh token** dans Vercel sous le nom `GOOGLE_REFRESH_TOKEN`.
6. **L'agenda lu** : crée de préférence un agenda dédié aux rendez-vous de prospection (celui où ta page de réservation Google écrit) et mets
   son identifiant (Paramètres de l'agenda › « Intégrer l'agenda ») dans `GOOGLE_CALENDAR_ID`. Sans cette variable, l'agenda principal
   (`primary`) est lu.
7. **La tâche planifiée** : un secret long et aléatoire dans `CRON_SECRET` (16 caractères au moins), et l'entrée suivante dans `vercel.json`
   (Vercel envoie lui-même `Authorization: Bearer <CRON_SECRET>`) :

   ```json
   "crons": [{ "path": "/api/agenda/google/sync", "schedule": "0 5 * * *" }]
   ```

   L'heure est en UTC (5 h UTC : 6 h ou 7 h à Paris). L'offre Hobby de Vercel n'autorise qu'un passage par jour ; sur l'offre Pro, tu peux
   écrire par exemple `"*/15 * * * *"` (toutes les 15 minutes).
8. Dans `config/niche.json` : `"fournisseur": "google"` ; `lienReservation` (facultatif) = le lien de ta page de réservation Google (elle ne
   se pré-remplit pas).

### Ce que l'application lit

À chaque passage : les événements **à venir** (de maintenant à 60 jours), instances des événements récurrents comprises, événements
supprimés compris (ils annulent le rendez-vous). Un événement devient un rendez-vous s'il a une heure (pas une journée entière), s'il est un
événement ordinaire (ni absence, ni temps de concentration) et s'il porte l'identifiant d'une fiche dans sa description (`utm_content=<id>`
ou un lien `…/prospects/<id>`) ou au moins un **invité extérieur** à l'équipe (un compte de l'équipe, ou une adresse du même domaine privé
que l'hôte, n'en est pas un). Le téléphone n'est lu dans la description que s'il est annoncé (« Téléphone : … »).

Le rapprochement avec une fiche suit l'ordre décrit plus haut (identifiant, e-mail, téléphone). Un événement qui ne se rattache à aucune
fiche n'est pas gardé : ni rendez-vous « à vérifier », ni nom, e-mail ou numéro d'un tiers en base. Pour qu'il entre dans l'application,
ajoute l'identifiant de la fiche dans sa description : la modification en fait une nouvelle version, reprise au passage suivant.

Chaque version d'un événement (son horodatage de modification, `updated`) n'est traitée qu'une fois : relue à chaque passage, elle est
reconnue. Toute modification dans Google (créneau, invité, description, lien, ou un retour en arrière) donne une nouvelle version, traitée
de nouveau ; si le rendez-vous n'en change pas (une réponse de l'invité, un titre retouché), la base note `rdv_inchange` et la fiche ne
bouge pas. Au plus 300 rendez-vous nouveaux ou modifiés par passage (le reste au suivant).

### Limites

- Mode « Testing » : **7 jours** de validité du jeton (voir l'étape 3).
- Une synchronisation par jour sur l'offre Hobby de Vercel : un rendez-vous pris le matin arrive le lendemain matin.
- Lis de préférence un agenda dédié : sur un agenda principal, chaque réunion avec un invité extérieur est lue, et devient un rendez-vous
  dès que l'invité a l'e-mail d'une fiche (ou que la description annonce le téléphone d'une fiche).
- Un rendez-vous pris dans Google sans rien qui le rattache à une fiche n'arrive pas dans l'application (pas de rendez-vous « à vérifier »
  venu de Google) : ajoute l'identifiant de la fiche dans sa description.
- Google est la source : un rendez-vous venu de Google se modifie ou s'annule **dans Google** (une modification dans Google remplace le
  créneau et remet un rendez-vous annulé dans l'application en « pris »).

## Agenda interne (« aucun ») et flux ICS

Sans outil de réservation, les rendez-vous sont pris au Poste (bouton « RDV pris ») ou ajoutés dans l'écran **Agenda** (« Nouveau
rendez-vous ») : jour et heure dans le fuseau de l'équipe ; la base refuse deux rendez-vous qui se chevauchent pour le même closer.

### Le flux ICS (tous les outils)

Dans l'écran **Agenda**, carte « Mes rendez-vous dans mon agenda » : **Créer mon lien**. L'adresse
(`https://<ton-domaine>/api/agenda/ics/<jeton>.ics`) n'est montrée **qu'une fois** : la base n'en garde qu'une empreinte. Ajoute-la dans
Google Agenda (« Autres agendas » › « + » › « À partir de l'URL »), Apple Calendrier (« Nouvel abonnement ») ou Outlook.

- **Google relit un flux abonné toutes les quelques heures** : ce n'est pas du temps réel (Apple et Outlook relisent plus souvent).
- Le flux contient tes rendez-vous de 30 jours avant à 90 jours après (500 au plus) : créneau, statut, canal, lien de visio, nom de
  l'entreprise et lien vers la fiche dans l'application. **Jamais un e-mail ni un numéro.**
- Qui a le lien voit ces rendez-vous : garde-le pour toi. **Recréer** un lien ou **Révoquer** coupe l'ancien tout de suite. Le jeton est
  dans l'adresse parce que les agendas ne s'abonnent qu'à une adresse : c'est une contrainte de ces outils.
- Un rendez-vous annulé, reporté ou no-show disparaît de l'agenda abonné (statut « annulé »).
- Ne t'abonne pas dans l'agenda où Calendly, iClosed ou Google écrivent déjà ces rendez-vous (doublons).

## Variables (noms seulement)

| Variable | Pour | Où |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | toutes les routes d'agenda (écriture par la clé service) | Vercel |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Calendly (32 caractères au moins) | Vercel, et dans l'abonnement Calendly |
| `ICLOSED_WEBHOOK_SECRET` | iClosed (24 caractères au moins) | Vercel, et au bout de l'adresse du webhook |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Google | Vercel |
| `GOOGLE_CALENDAR_ID` | Google (facultatif, `primary` par défaut) | Vercel |
| `CRON_SECRET` | la synchronisation Google (16 caractères au moins) | Vercel |

## Codes des réponses et du journal

Les routes ne répondent et ne journalisent que des **codes** (jamais un corps, un e-mail, un numéro, un identifiant ni un secret) :

| Réponse | Code | Que faire |
|---|---|---|
| 404 | `inconnu` | l'adresse ne correspond à aucun outil à webhook (`calendly`, `iclosed`) |
| 503 | `non_configure` | une variable manque (son **nom** est dans le journal) : pose-la dans Vercel et redéploie |
| 413 | `trop_gros` | envoi de plus de 256 Ko : ce n'est pas l'outil |
| 401 | `signature_refusee` | mauvaise clé ou mauvais secret, ou horloge décalée de plus de 3 minutes (Calendly) |
| 400 | `json_illisible` | le corps n'est pas du JSON |
| 200 | `ok recus=… traites=… doublons=… a_verifier=… rejetes=…` | tout va bien ; `a_verifier` : rendez-vous sans fiche retrouvée (Calendly, iClosed) |
| 500 | `arret:base` | la base n'a pas répondu : l'outil renverra l'événement, sans doublon |
| 502 | `google_jeton_refuse` | jeton Google expiré ou révoqué (mode « Testing » ?) : refais l'étape 5 de Google |
