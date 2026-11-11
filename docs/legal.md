# Le cadre légal : sources, RGPD, enregistrement, Bloctel

Ce document dit ce que l'outil fait pour rester dans les règles de la prospection téléphonique entre professionnels en France, et ce qui
reste à la charge de l'équipe qui l'installe. **Ce n'est pas un avis juridique** : les règles changent, chaque activité a ses
particularités ; en cas de doute, fais relire ta pratique par un juriste ou consulte la CNIL.

L'outil organise le travail de l'appelant. Il ne rend pas une prospection légale à lui seul : c'est l'équipe qui choisit qui elle appelle,
ce qu'elle dit et ce qu'elle garde.

## 1. Des sources publiques, et seulement elles

| Source | Ce qui est pris | Les règles |
|---|---|---|
| Le registre SIRENE (API Recherche Entreprises, publique et sans clé) | nom, enseigne, SIREN, SIRET du siège, NAF, catégorie juridique, date de création, tranche d'effectif, commune, code postal, département ; du dirigeant : prénom, nom et qualité seulement | ni date de naissance, ni nationalité, ni adresse ; les entreprises en **diffusion partielle** sont écartées dès la récolte (voir plus bas) |
| Le site de l'entreprise | l'e-mail **publié** par l'entreprise (avec la page et la date), les lignes utiles à une accroche, la présence d'un pixel publicitaire, d'une balise Google Ads, d'un outil de rendez-vous, d'une agence créditée (`enrichir.mjs`) | robots.txt lu et respecté, une requête par seconde au plus par domaine, un robot qui se présente (`marque.userAgent`), aucun e-mail deviné ni construit |
| Google, par l'API officielle Places | téléphone, site, note et nombre d'avis d'une fiche, et son `place_id` | **désactivé par défaut** (`sources.places.actif: false`) : clé, quota et facturation de l'équipe ; voir plus bas |
| Le registre public, pour l'enrichissement (`enrichir.mjs`) | chiffre d'affaires publié, effectif, employeur ou non, état (active ou cessée), date de création | mêmes règles que le registre SIRENE ; une entreprise en diffusion partielle n'est jamais gardée |
| Ton propre fichier (annuaire, export de CRM, liste d'un fournisseur) | ce qu'il contient, au format de `docs/sourcing.md` | seulement si l'équipe connaît et garde son origine (colonne `source`, et sa date) |

**La non-diffusion.** Une personne qui dirige une entreprise individuelle peut demander à l'INSEE que ses données ne servent pas à la
prospection (statut de diffusion partielle). `scripts/sourcing/sirene.mjs` écarte ces entreprises dès la récolte : rien d'elles n'est
gardé, même dans le cache.

**Google Places et la conservation du contenu.** L'outil lit Google par l'API officielle Places (New), jamais avec un robot,, avec la clé et la facturation de l'équipe, dans le cadre des conditions de Google Maps Platform. Ces conditions
**limitent la conservation du contenu** de Places : l'identifiant `place_id` peut être gardé, mais le reste (téléphone, site, note,
nombre d'avis…) doit être rafraîchi ou supprimé sous 30 jours. Lis les conditions officielles (https://cloud.google.com/maps-platform/terms),
en particulier les règles de mise en cache et de stockage du contenu de Google, et fais-les relire si l'enjeu le demande : elles
changent, et ce document ne les remplace pas.

Ce que fait `places.mjs` : il ne demande à Google que les champs utiles ; il garde dans le CSV le `place_id`, un lien bâti sur ce
`place_id` et la **date de lecture** (`source_date`) ; son état de reprise (`donnees/cache/places-*.json`) ne contient que la
progression, aucun contenu de Google, et n'est pas repris au-delà de 30 jours ; à la fin de chaque exécution il rappelle que le contenu
lu est à rafraîchir ou à supprimer sous 30 jours. Ce qu'il ne fait pas : supprimer à ta place les fichiers de `donnees/` ni les
champs déjà importés dans la base. Respecter le délai (relire la fiche par son `place_id` avec `places.mjs enrichir`, ou supprimer le
contenu) reste le travail de l'équipe.

**Pas de LinkedIn.** Ni par script, ni par extension de navigateur, ni à la main pour remplir les fiches en masse : ses conditions
d'utilisation l'interdisent. Les scripts d'accroches refusent aussi de lire un réseau social, un annuaire ou une carte : seulement le
site de l'entreprise.

## 2. Le RGPD en prospection B2B

Une fiche porte des données personnelles : le nom du dirigeant, un numéro de portable, un e-mail nominatif. Appeler un professionnel
pour lui proposer un service en rapport avec son activité peut reposer sur l'**intérêt légitime** de l'équipe, à condition de
l'informer, de lui laisser un moyen simple de refuser, et de ne garder que ce qui sert. Voici ce que l'outil prévoit pour chacun de ces
points.

### Informer : d'où viennent ses coordonnées

- La personne doit savoir, au plus tard au premier contact, d'où viennent ses coordonnées et qu'elle peut refuser d'être rappelée.
  Le Poste affiche la phrase d'origine (`legal.phraseSource`) et la phrase d'opposition (`legal.phraseOpposition`) sous « Comment
  avez-vous mon numéro ? », à côté de la réponse du script. Dis-les dès que la question vient ; ne la laisse jamais sans réponse.
- **Les phrases doivent rester vraies.** Dans l'exemple, la réponse du script (`script.ouverture.commentAvezVousMonNumero`) et
  `legal.phraseSource` parlent du registre public des entreprises et du site de l'entreprise : le parcours par défaut (registre SIRENE,
  Google Places désactivé). Si tes numéros viennent aussi de Google Places, d'un annuaire ou de ton propre fichier, réécris les deux dans
  `config/niche.json`, puis `npm test`.
- `legal.responsable` (qui est responsable du traitement) et `legal.contactRGPD` (l'adresse publique où exercer ses droits) se donnent
  à qui les demande.

### Tracer : des sources datées sur chaque fiche

Chaque fiche garde la liste de ses **sources datées** (colonne `sources` de la table `leads`) : d'où vient la fiche, d'où viennent son
téléphone, son site, son e-mail, son accroche, et quand chaque donnée a été lue (le type de source, son détail, son adresse s'il y en a
une, la date). Une fiche créée à la main exige sa source ; une modification à la main du dirigeant, d'un numéro ou de l'e-mail laisse
une trace datée « saisie manuelle ». La fiche les affiche dans « Sources des coordonnées ».

### S'opposer : « Ne plus contacter »

- L'issue `ne_plus_contacter` (une touche au Poste) inscrit la fiche sur la **liste d'opposition** de l'équipe (table `opposition` : son
  SIREN et ses numéros). La fiche est verrouillée : son statut ne quitte plus « ne plus contacter », ses identifiants ne se modifient
  plus, et la base refuse tout nouvel appel noté sur elle.
- Une fiche sans SIREN entre sur la liste d'opposition avec son nom et son code postal : sa recréation ou son réimport, même sans
  numéro, est refusé. Cette clé est prudente : une autre entreprise au même nom (casse, accents et ponctuation ignorés) et au même code
  postal est bloquée elle aussi (une telle fiche déjà en base passe en « ne plus contacter »).
- **Aucun réimport.** `scripts/sourcing/importer.mjs` écarte toute ligne dont le SIREN, un numéro, ou le nom et le code postal sont sur
  la liste, et la base refuse de recréer la fiche avec un autre statut. Les scripts d'accroches ne l'exportent pas et n'y écrivent rien.
- Le statut reste « ne plus contacter » même sans identifiant sur la liste : aucun compte de l'application ne le change. Pour rouvrir
  une fiche opposée par erreur, dans Supabase › SQL Editor : retirer ses entrées de la liste, puis rouvrir la fiche (son identifiant est
  dans l'adresse de sa page, `/prospects/<id>`).

  ```sql
  delete from public.opposition o using public.leads l
   where l.id = '<id>' and o.workspace_id = l.workspace_id
     and (o.siren = l.siren or o.tel9 in (l.telephone_9, l.mobile_9) or o.cle = public.cle_entreprise(l.entreprise, l.cp));
  update public.leads set statut = 'a_appeler' where id = '<id>';
  ```

- La liste STOP locale (`donnees/stop.csv`) est un garde-fou de plus (clients, partenaires…) ; une demande d'opposition se note au
  Poste, pour qu'elle vive en base.

### Conserver : la purge des fiches inactives

- `legal.conservationMois` (36 au plus) fixe combien de temps une fiche sans contact est gardée. La fonction
  `purger_fiches_inactives(<mois>)` efface les fiches sans activité depuis cette durée (un import ne compte pas comme un contact ; une
  fiche qui a un rendez-vous à venir est gardée), avec leurs appels et leurs rendez-vous passés ; et, pour toute l'équipe, les appels,
  rendez-vous, débriefs et retours plus anciens que cette durée.
- **Elle n'est pas planifiée d'office** : aucune tâche planifiée de l'application ne l'appelle (celles de `vercel.json` ne servent qu'à
  l'agenda et à la reprise de l'audio). Lance-la au moins une fois par mois :
  - dans l'écran **Réglages › RGPD** (propriétaire ou membre) : « Compter ce que la purge effacerait » (un comptage sous tes droits, rien
    n'est écrit), puis « Purger les fiches inactives », après confirmation. C'est la purge complète : `purger_fiches_inactives` avec la
    durée de ta config (`legal.conservationMois`), l'effacement des audios des appels purgés dans le bucket privé « enregistrements »,
    `purger_integrations_evenements()`, puis la recherche des audios restés sans appel (une purge précédente qui n'a pas pu les
    effacer). Le résultat s'affiche en compteurs. Il faut `SUPABASE_SERVICE_ROLE_KEY` sur le serveur (ces deux fonctions sont réservées
    à la clé service ; l'écran contrôle d'abord ton rôle). Le temps d'une page est compté : les audios qui n'ont pas pu être effacés à
    temps sont retrouvés par la purge suivante ;
  - ou depuis ton ordinateur, ou une tâche planifiée hors de Vercel : `node scripts/maintenance/purger.mjs` (simulation : la purge jouée
    puis annulée, avec les compteurs exacts), puis `node scripts/maintenance/purger.mjs --appliquer`. Il se connecte par
    `SUPABASE_DB_URL` et efface les audios avec `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (de l'environnement ou de
    `.env.local`, jamais affichées) ; sans elles, il purge la base et dit combien d'audios restent à effacer : le bouton « Purger les
    fiches inactives » de l'écran Réglages les retrouve et les efface. Vers une base distante, son certificat est vérifié si
    `SUPABASE_DB_CA` est posée dans l'environnement (ce script ne la lit pas dans `.env.local` : `docs/installation.md`, étape 2.3).
- Lancée à la main dans Supabase › SQL Editor (`select public.purger_fiches_inactives(36);`) ou par l'extension pg_cron, la fonction
  purge la base mais pas le stockage : les audios qu'elle désigne (`enregistrementsAEffacer`) restent dans le bucket jusqu'à la prochaine
  purge lancée depuis l'écran Réglages.
- La même purge vide le journal des webhooks reçus (`purger_integrations_evenements()`, au-delà de 90 jours) ; il ne contient que des
  codes.
- La liste d'opposition, elle, n'est jamais purgée : c'est la donnée minimale qui permet de respecter un refus.

### Les droits des personnes : accès, rectification, effacement, opposition

Une demande arrive à `legal.contactRGPD`, ou au téléphone. Réponds dans les délais légaux, et note la demande (date, réponse).

- **Accès** (« quelles données avez-vous sur moi ? ») : retrouve la fiche dans l'écran **Prospects** (recherche par le nom de
  l'entreprise). Elle montre ses coordonnées, ses **sources datées**, sa **chronologie** (appels, issues, notes, rappels), ses
  rendez-vous et le bloc « Appels transcrits » (débriefs). Les audios éventuels sont dans le bucket privé « enregistrements » de
  Supabase. L'application n'exporte aucun fichier : la réponse s'écrit à partir de ces écrans. Pour retrouver une fiche par son
  numéro, dans Supabase › SQL Editor :

  ```sql
  select id, statut from public.leads where telephone_9 = public.tel9('<numéro>') or mobile_9 = public.tel9('<numéro>');
  ```

- **Rectification** : « Modifier les coordonnées » sur la fiche (dirigeant, numéros, e-mail), avec une trace datée dans ses sources.
- **Opposition** (« ne m'appelez plus ») : l'issue « Ne plus contacter » au Poste, tout de suite, pendant l'appel ou après.
- **Effacement** (« supprimez mes données ») : le propriétaire ouvre la fiche (écran Prospects) et clique « Effacer cette fiche », en
  bas de la page. Après confirmation, l'application efface les audios des appels de la fiche et de ceux reçus sans fiche à l'un de ses
  numéros, puis ces appels, ses rendez-vous, ses retours du marché, et enfin la fiche avec son journal et ses débriefs. Si un audio ne
  s'efface pas, elle s'arrête avant les appels : relance l'effacement. La case « Inscrire d'abord son SIREN et ses numéros sur la liste
  d'opposition », cochée par défaut, la garde hors de tout futur import (une fiche déjà « ne plus contacter » y est vérifiée d'office) ;
  la liste d'opposition n'est jamais purgée. Une fiche sans SIREN ni numéro lisible : l'écran n'inscrit rien et le dit ; notée « Ne plus
  contacter » au Poste, elle y a déjà son nom et son code postal. Il faut `SUPABASE_SERVICE_ROLE_KEY` sur le serveur si la fiche a des
  appels (un compte connecté ne peut pas effacer un appel ; l'écran refuse alors avant d'effacer quoi que ce soit). Les rendez-vous « à
  vérifier » arrivés de Calendly ou d'iClosed sans fiche se retirent dans l'écran Agenda.

  Sans l'application, la même chose dans Supabase › SQL Editor, avec l'identifiant de la fiche (il est dans l'adresse de sa page :
  `/prospects/<id>`). D'abord les audios à effacer dans Storage :

  ```sql
  select enregistrement_chemin from public.appels where lead_id = '<id>' and enregistrement_chemin is not null;
  ```

  puis, en une transaction :

  ```sql
  begin;
  delete from public.appels where lead_id = '<id>';
  delete from public.rendez_vous where lead_id = '<id>';
  delete from public.retours_marche where lead_id = '<id>';
  delete from public.leads where id = '<id>';  -- emporte aussi son journal (lead_activities) et ses débriefs
  commit;
  ```

  Les appels reçus de ton fournisseur de téléphonie sans fiche rattachée gardent le numéro appelé : cherche-les aussi par ce numéro
  (`numero_externe`). Si la personne refuse aussi d'être rappelée, garde son identifiant sur la liste d'opposition (inscris-le d'abord
  avec « Ne plus contacter ») : sans lui, un futur import la ferait revenir.

### Ce qui reste à ta charge

- Tenir le registre des traitements de ton équipe (la CNIL en propose un modèle) et y décrire cette prospection.
- Vérifier les conditions de traitement des données (DPA) de tes prestataires : Supabase (la base, en région Paris), Vercel (les
  fonctions, région Paris `cdg1`), ton fournisseur de téléphonie et ton outil d'agenda.
- Ne garder que ce qui sert : le dossier `donnees/` (CSV, cache, sites lus) reste sur ta machine, hors du dépôt, et se vide une fois
  l'import fait (`docs/sourcing.md`, `docs/accroches.md`).
- Les journaux de l'application ne portent que des codes (jamais un nom, un numéro, un e-mail ni un secret) : garde-les ainsi si tu
  modifies le code.

## 3. L'enregistrement des appels

Enregistrer une conversation sans prévenir la personne est interdit (**article 226-1 du Code pénal** ; recommandations de la CNIL).
L'application ne garde donc **rien** (ni audio, ni transcription, ni résumé venus du fournisseur) tant que deux conditions ne sont pas
réunies :

1. un gestionnaire a activé l'**enregistrement complet** de l'équipe (`reglages.enregistrement_complet`), après avoir lu ce cadre ; la
   base exige la date de cette lecture (`reglages.annonce_lue_le`) ;
2. **pour cet appel**, l'annonce (`legal.annonceEnregistrement`) a été lue au prospect et cochée « lue » au Poste par l'appelant de cet
   appel, pendant l'appel (aucun fournisseur livré ne signale aujourd'hui une annonce qu'il aurait jouée lui-même).

Si l'une manque, l'audio n'est même pas téléchargé, et un audio refusé après coup est effacé du stockage ; le statut et la durée de
l'appel sont gardés. C'est la base qui tranche (fonction `evenement_appel`), et un débrief lié à un appel non conservable ne peut pas
porter de transcription (refus `42501`).

- **L'activation** : dans l'écran **Réglages › Enregistrement des appels**, un gestionnaire lit le cadre légal affiché, coche « J'ai
  lu ce cadre et je l'accepte », puis « Activer l'enregistrement ». La base exige et date cette acceptation ; l'écran refuse tant que la
  config ne déclare pas `telephonie.enregistrement: true`. Pour arrêter : « Désactiver l'enregistrement », sans condition.
- Dès que l'enregistrement complet est activé, le Poste affiche l'annonce en tête de l'appel, avec la case à cocher une fois lue ; une
  issue où le prospect a décroché, notée sans l'annonce cochée, déclenche un avertissement (l'audio de cet appel ne sera pas gardé).
- La case ne se coche qu'entre « Appeler » et « Raccroché » (ou la fin signalée par le téléphone intégré au Poste). Une annonce cochée
  après la fin de l'appel ne compte pas : la base ne la rattache qu'à l'appel du même appelant, sur la même fiche, qui couvre l'heure de
  la coche (de 30 secondes avant son début jusqu'à sa fin). Un fournisseur qui n'envoie ni l'heure de fin ni la durée de l'appel ne
  garde aucun audio : sans fin connue, aucune annonce n'est rattachée.
- Dans `config/niche.json`, `telephonie.enregistrement: true` déclare que l'équipe enregistre ; le schéma le refuse avec le softphone
  et le téléphone, qui n'envoient pas d'audio. Active aussi l'enregistrement chez le fournisseur (Onoff, Aircall ou Ringover).
- La personne peut demander l'arrêt à tout moment : arrête l'enregistrement dans l'outil de téléphonie.
- Les audios vivent dans un espace de stockage privé ; seuls les gestionnaires et l'appelant de l'appel peuvent les écouter. Ils
  suivent la conservation de la config (`legal.conservationMois`), par la purge.
- Une transcription collée, un fichier ou une note du Mac (débrief sans appel en base) reste sous la responsabilité de l'équipe :
  l'appel ne s'enregistre qu'après l'avoir annoncé. `node scripts/debrief/ecrire.mjs <debrief.json> --sans-transcription` ne garde que
  ce qui en est extrait.

## 4. Bloctel

Bloctel, la liste d'opposition au démarchage téléphonique, protège les **consommateurs** (Code de la consommation, articles L223-1 et
suivants). Il ne s'applique pas à la prospection entre professionnels, celle que l'outil sert. Deux nuances :

- un entrepreneur individuel joint sur son numéro personnel reste une personne : appelle-le pour son activité professionnelle
  seulement, et respecte tout refus (« Ne plus contacter ») ;
- les règles du démarchage des particuliers se durcissent : cet outil ne sert **jamais** à appeler des particuliers.

## 5. Aucune promesse de résultat

Le schéma de la config refuse, dans tout ce qui est dit au prospect (promesse, pitch, close, réponses aux objections, ouverture,
questions, messagerie, phrase prix, exemples d'accroche) : un chiffre de résultat (« 30 clients », « +20 % », « 3x »), « garanti »,
« assuré », « doubler », « sans risque », un délai promis (« en 3 mois »). Le contrôle joue à chaque `npm test` et à chaque build : une
config qui promet ne se déploie pas. Le contrôle est lexical : il attrape les formules, pas toutes les idées ; la relecture humaine
reste nécessaire.

L'outil lui-même ne garantit ni rendez-vous ni chiffre : le résultat dépend de l'offre, de la cible et de l'appelant.

## 6. SMS et e-mails : hors de cette version

L'application n'envoie **rien** au prospect : ni SMS, ni e-mail, ni appel automatique, ni invitation. Les confirmations et rappels de
rendez-vous sont ceux de ton outil d'agenda (Calendly, iClosed, Google), sous tes propres réglages. Les skills Claude Code n'envoient
rien non plus : ils lisent, préparent et écrivent en base, après un essai et ton accord.

## 7. Flux sortants facultatifs

Une seule sortie de données existe en dehors de tes fournisseurs, et elle est **éteinte par défaut** : la session commune
(`docs/concours.md`). Si tu la branches, le serveur envoie au service de la session un mot par appel (`sans_reponse`, `conversation` ou
`rdv`) et ton pseudo ; jamais une donnée d'une fiche, d'un prospect ou d'une personne qui appelle. Si tes appelants doivent le savoir, dis-le
dans ta politique interne. Le jeton que te rend le service, qui identifie ton équipe auprès de lui, est rangé dans ta base Supabase (table
`concours_branchement`) : aucun compte connecté ne peut le lire, même le propriétaire ; seul le serveur le lit, avec la clé service, pour
envoyer les compteurs. Pour quitter la session, utilise « Quitter la session » dans Réglages (le jeton est effacé de ta base ; ton pseudo
reste au classement du service, que seul son organisateur peut effacer) ; si tu l'avais branchée par les variables `CONCOURS_*`, retire-les
aussi.
