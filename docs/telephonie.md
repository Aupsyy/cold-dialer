# Téléphonie

Le Poste appelle avec l'outil de ton équipe : **Onoff**, **Aircall**, **Ringover** (expérimental), un **softphone** (Zoiper, 3CX,
Teams…) ou simplement ton **téléphone**. Le choix se fait dans `config/niche.json` :

```json
"telephonie": { "fournisseur": "onoff", "mode": "extension", "copierNumero": true, "enregistrement": false }
```

| Fournisseur | `mode` | Comment on appelle | Webhook (les appels arrivent dans les fiches) | Enregistrement |
|---|---|---|---|---|
| `onoff` | `extension` | l'extension Chrome Onoff Click2Call ouvre son cadran, numéro tapé | oui (plans Advanced et Max) | oui |
| `aircall` | `iframe` | le téléphone Aircall est dans le Poste | oui | oui |
| `ringover` | `iframe` | le téléphone Ringover est dans le Poste (**expérimental**) | oui | oui |
| `softphone` | `lien` | lien `tel:`, `callto:` ou `sip:` (`schemaLien`) vers ton logiciel | non | non |
| `telephone` | `lien` | lien `tel:` sur téléphone, numéro copié sur ordinateur | non | non |

Après un changement de fournisseur, **redéploie** : l'en-tête `Permissions-Policy` (qui donne le micro au téléphone du fournisseur) est
calculé au build.

Les variables d'environnement sont données ici par leur **nom**. Tu colles toi-même leurs valeurs dans Vercel (Settings › Environment
Variables), puis tu redéploies. Ne les écris jamais dans le dépôt, dans un message ou dans une capture. `/api/sante` dit seulement si
elles sont présentes (`variables.telephonie`).

---

## L'enregistrement des appels : la règle

Enregistrer une conversation sans prévenir la personne est interdit (article 226-1 du Code pénal ; recommandations de la CNIL). Le Poste
ne garde donc **rien** (ni audio, ni transcription, ni résumé) tant que deux conditions ne sont pas réunies :

1. un gestionnaire a activé l'**enregistrement complet** dans les réglages de l'équipe, après avoir lu le cadre légal (la base exige la
   date de cette lecture) ;
2. pour **cet appel**, l'annonce (`legal.annonceEnregistrement` de la config) a été lue au prospect et cochée « lue » au Poste par
   **l'appelant de cet appel**, pendant l'appel : la case ne se coche qu'entre « Appeler » et « Raccroché » (ou la fin signalée par le
   téléphone intégré), et une annonce cochée après la fin de l'appel ne compte pas.

C'est la base qui décide (fonction `evenement_appel`, réponse `conserverAudio`) : si l'une des conditions manque, l'audio n'est même pas
téléchargé, et un audio refusé après coup est effacé du stockage. Le statut et la durée de l'appel, eux, sont toujours gardés. La base
rattache l'annonce à l'appel du même appelant, sur la même fiche, qui couvre l'heure de la coche (de 30 secondes avant son début jusqu'à
sa fin) : il lui faut donc l'appelant (son e-mail chez le fournisseur), le début de l'appel et sa fin (ou sa durée). Un fournisseur qui
n'envoie ni l'heure de fin ni la durée ne garde aucun audio.

Le prospect peut demander l'arrêt de l'enregistrement à tout moment : arrête-le dans l'outil de téléphonie. Les audios sont dans un
espace de stockage privé ; seuls les gestionnaires et l'appelant de l'appel peuvent les écouter. Ils suivent la durée de conservation
de la config (`legal.conservationMois`).

---

## Onoff Business (extension Chrome)

Onoff n'a **pas d'API pour lancer un appel**. Le Poste passe par l'extension Chrome officielle **Onoff Business Click2Call** : elle ne
prend pas les liens `tel:` ; elle repère les numéros affichés dans la page, les surligne, et un clic sur un numéro surligné ouvre son
cadran, numéro déjà tapé. Le bouton « Appeler » du Poste relaie ce clic. Si l'extension n'a pas surligné le numéro, le numéro est
**copié** (tu le colles dans le cadran Onoff).

### Ce que chaque appelant fait (une fois, dans Chrome)

1. Installe l'extension **Onoff Business Click2Call** depuis le Chrome Web Store, puis épingle-la (icône puzzle, punaise).
2. Clique sur l'icône Onoff, connecte-toi avec ton compte Onoff Business et choisis ta ligne d'appel.
3. Laisse **« Mise en surbrillance des numéros »** activée, et **« Mode application de bureau »** éteint pour appeler depuis Chrome.
4. Ouvre le Poste : l'extension ne doit pas être désactivée sur ce site.
5. Premier appel : Chrome demande l'accès au micro ; accepte.
6. Essai : ouvre une fiche, attends que le numéro soit surligné (moins d'une seconde), clique « Appeler » : le cadran s'ouvre, bouton vert.

### Ce que le gestionnaire fait (une fois)

Le webhook d'appel est réservé aux plans Onoff **Advanced** et **Max** (console B2B Onoff, menu Integrations › Webhook).

1. Tire un jeton au hasard (32 caractères ou plus ; 16 au minimum) et pose-le dans Vercel : `ONOFF_WEBHOOK_TOKEN`. **Redéploie.**
   Fais-le **avant** l'étape 2 : à la création de l'intégration, Onoff envoie aussitôt un appel d'essai ; si le jeton n'est pas encore
   déployé, l'intégration passe en « échec ».
2. Console Onoff › Integrations › Webhook › **Call** :
   - **Url** : `https://<ton-domaine>/api/telephonie/onoff/webhook`
   - **Api key** : la même valeur que `ONOFF_WEBHOOK_TOKEN` (Onoff l'envoie dans l'en-tête `X-API-KEY` de chaque appel).
   - **Integrate** : le statut doit passer à « Integrated ».
3. Si l'équipe enregistre : active l'enregistrement des appels dans la console Onoff (et la transcription si ton plan la propose).
4. Facultatif, conseillé si l'équipe enregistre : une clé d'API Onoff (Integrations › API keys) dans `ONOFF_API_KEY`. Elle sert à
   reprendre l'audio quand il n'est pas encore prêt et à lire la transcription (voir « La reprise différée »).
5. Chaque appelant a **le même e-mail** dans Onoff et dans l'application ; sinon un gestionnaire renseigne son e-mail Onoff dans les
   réglages de l'équipe. C'est ainsi qu'un appel est attribué à son appelant (et qu'une annonce lue au Poste couvre son appel).

Variables : `ONOFF_WEBHOOK_TOKEN` (obligatoire pour le webhook), `ONOFF_API_KEY` (facultative).

### Pièges connus

- **« Ce site restreint notre extension »** : l'en-tête `Permissions-Policy` ne donne pas le micro à l'extension. Vérifie
  `telephonie.fournisseur = "onoff"`, puis redéploie. L'application autorise `chrome-extension://jbfkkljambdhjlkcfkcbpjfkkamkccfm`
  (l'identifiant public de l'extension).
- **Le numéro n'est pas surligné** juste après l'ouverture de la fiche : l'extension met environ une demi-seconde. Le Poste attend
  600 ms au plus, puis copie le numéro. Si cela dure : extension déconnectée, en pause sur ce site, ou surbrillance éteinte.
- **3 appareils au plus** par compte Onoff : au-delà, l'extension se met en pause (« Vous avez déjà 3 appareils connectés »).
- **« Veuillez d'abord compléter vos actions d'appel en attente »** : ferme l'écran de fin de l'appel précédent dans le cadran.
- **Sur iPhone**, un lien `tel:` partirait sur la carte SIM, pas sur la ligne Onoff : le Poste copie seulement le numéro, à coller dans
  l'app Onoff.
- **Délais d'Onoff** : il coupe l'attente de la réponse au bout de **10 secondes** et réessaie **4 fois**, puis jette l'événement. Le
  Poste répond tout de suite et fait le reste (audio, transcription) après la réponse.
- **Avec l'enregistrement activé**, Onoff envoie l'événement `RECORDING` (avec le lien de l'audio) **à la place** de `CDR`. L'audio
  arrive **5 à 8 minutes** après la fin de l'appel.
- **Pare-feu** (rare) : les appels d'Onoff viennent de `46.137.171.21`, `52.50.239.4` et `54.220.111.56`. L'application ne filtre pas
  par adresse IP : le jeton suffit.
- La fiche est retrouvée par les **9 derniers chiffres** du numéro appelé ; un numéro national (`01…`) est lu avec l'indicatif du pays
  de la config (`pays.indicatif`).

---

## Aircall (téléphone dans le Poste)

Le téléphone Aircall s'affiche dans le Poste (une fenêtre intégrée de `workspace.aircall.io`). Chaque appelant s'y connecte avec ses
identifiants Aircall ; le Poste ne voit aucun mot de passe. « Appeler » compose ensuite le numéro de la fiche.

### Ce que chaque appelant fait

1. Ouvre le Poste et connecte-toi dans le téléphone Aircall. **Il faut le refaire à chaque session** (la session ne survit pas à la
   fermeture de l'onglet).
2. Premier appel : le navigateur demande l'accès au micro ; accepte.
3. Safari : si le téléphone ne se connecte pas, décoche « Empêcher le suivi intersite » (Réglages › Confidentialité).

### Ce que le gestionnaire fait

1. Il faut un **numéro actif** dans le compte Aircall. La validation d'un numéro français peut prendre **plusieurs jours** : anticipe.
2. Aircall › Integrations & API › **Webhooks** : crée un webhook vers `https://<ton-domaine>/api/telephonie/aircall/webhook` avec les
   événements `call.created`, `call.answered`, `call.hungup`, `call.ended`, `call.comm_assets_generated`, `transcription.created`.
3. Aircall affiche alors **son** jeton de webhook : colle-le dans `AIRCALL_WEBHOOK_TOKEN`, puis redéploie **tout de suite** (Aircall
   désactive un webhook qui échoue plusieurs fois de suite ; réactive-le dans Aircall si besoin).
4. Facultatif : une clé d'API (Integrations & API › API keys) : `AIRCALL_API_ID` et `AIRCALL_API_TOKEN`. Elle sert à lire la
   transcription (option d'intelligence artificielle d'Aircall) et à reprendre un audio manqué.
5. Chaque appelant a le même e-mail dans Aircall et dans l'application (sinon un gestionnaire renseigne son e-mail Aircall).

Variables : `AIRCALL_WEBHOOK_TOKEN` (obligatoire pour le webhook), `AIRCALL_API_ID` et `AIRCALL_API_TOKEN` (facultatives).

### Pièges connus

- Le jeton voyage **dans le corps** de chaque événement (champ `token`), pas dans un en-tête.
- Micro refusé dans le téléphone : autorise le micro pour le site ; sinon vérifie `telephonie.fournisseur = "aircall"` et redéploie
  (l'application autorise `https://workspace.aircall.io` et `https://phone.aircall.io`).
- « Un appel est déjà en cours dans Aircall » : termine-le dans le téléphone, puis relance.

---

## Ringover (expérimental)

**Jamais testé sur un vrai compte.** Écrit d'après la documentation publique de Ringover et ses dépôts publics (le SDK du téléphone
embarqué et les exemples de webhooks). Si tu l'essaies, note ce qui diffère.

Ringover offre trois chemins : son téléphone embarqué, son extension Chrome, son API de rappel. Le Poste utilise le **téléphone
embarqué** (`mode: "iframe"`, fenêtre intégrée de `https://app.ringover.com`) : il est documenté et public, il ne demande aucune clé
côté serveur pour appeler (l'appelant se connecte dans la fenêtre), et aucune route du Poste ne peut lancer un appel toute seule.
L'extension ne documente pas son fonctionnement ; l'API de rappel demanderait une clé d'écriture sur le serveur et fait d'abord sonner
le téléphone de l'appelant. Les modes `extension` et `api` ne sont donc pas livrés.

### Ce que chaque appelant fait

1. Ouvre le Poste et connecte-toi dans le téléphone Ringover (tes identifiants Ringover).
2. Premier appel : le navigateur demande l'accès au micro ; accepte.
3. Safari : décoche « Empêcher le suivi intersite » (Réglages › Confidentialité) ; c'est une consigne de Ringover pour son téléphone
   intégré.

### Ce que le gestionnaire fait

1. Tire un secret au hasard (32 caractères ou plus ; 24 au minimum), pose-le dans `RINGOVER_WEBHOOK_SECRET`, redéploie.
2. Dashboard Ringover › Développeur › **Webhooks** : colle l'adresse
   `https://<ton-domaine>/api/telephonie/ringover/webhook?secret=<la valeur de RINGOVER_WEBHOOK_SECRET>`
   dans les événements d'appel (appels décrochés, terminés, manqués) et dans « enregistrement disponible ».
3. Si l'équipe enregistre : active l'enregistrement des appels chez Ringover.
4. Chaque appelant a le même e-mail dans Ringover et dans l'application.

Variable : `RINGOVER_WEBHOOK_SECRET`.

### Pourquoi le secret est dans l'adresse

Les exemples publics de Ringover ne s'accordent pas sur la signature de ses webhooks (un jeton signé dans un en-tête pour l'un, une
empreinte du corps dans un autre en-tête pour l'autre). Le Poste ne dépend donc pas d'une signature non confirmée : le secret est dans
l'adresse, comparé en temps constant. Conséquence : il apparaît dans l'adresse des requêtes reçues ; ne partage pas les journaux de
Vercel. Un 401 dans les journaux veut dire que l'adresse collée chez Ringover n'a pas le bon secret.

### Limites

- Pas de reprise de l'audio par l'API : l'audio vient du lien de l'événement « enregistrement disponible » (ou « appel terminé »).
- « Appel terminé » ne dit pas si le prospect a décroché : active aussi « appels décrochés » pour que le statut passe à « répondu ».

---

## Softphone (Zoiper, 3CX, Teams…)

« Appeler » ouvre un lien `tel:`, `callto:` ou `sip:` (`telephonie.schemaLien`, `tel` par défaut) et copie le numéro. Ton système envoie
le lien à l'application choisie :

- **macOS** : pour `tel:`, ouvre FaceTime › Réglages › Général et choisis ton softphone comme application par défaut pour les appels
  (il doit être installé). Pour `callto:` et `sip:`, c'est le softphone qui se déclare lui-même (une option de ses réglages du type
  « ouvrir les liens d'appel »).
- **Windows 11** : Paramètres › Applications › Applications par défaut › « Choisir les valeurs par défaut par type de lien » (Windows 10 :
  « par protocole ») : TEL, CALLTO ou SIP vers ton softphone.
- Au premier clic, le navigateur demande d'ouvrir l'application : coche « Toujours autoriser » pour ce site.

Aucun webhook : la durée se saisit au Poste (ou au chronomètre du Poste). Pas d'enregistrement.

## Téléphone

Sur un téléphone, « Appeler » ouvre le composeur. Sur un ordinateur, le numéro est copié et affiché en grand (format +33…) : compose-le
sur ton téléphone. Aucun webhook, pas d'enregistrement.

---

## La reprise différée (tâche planifiée)

L'audio d'Onoff arrive 5 à 8 minutes après l'appel, et une transcription peut arriver plus tard encore. Le webhook répond en moins de
10 secondes et sa suite ne peut pas attendre si longtemps. Ce qui manque est repris par
`GET /api/telephonie/recuperation`, par l'API du fournisseur (`ONOFF_API_KEY` ; `AIRCALL_API_ID` et `AIRCALL_API_TOKEN`) :

- seulement les appels que la base dit conservables (enregistrement complet **et** annonce lue pour cet appel) ;
- **20 tentatives au plus** par appel (comptées par la base), **une par minute** au plus, pendant **48 heures** ;
- quelques appels par passage, avec une pause entre deux (l'API d'Onoff accepte 2 requêtes par seconde) ;
- rien à faire pour Ringover, le softphone et le téléphone (réponse 200, « rien »).

La route exige l'en-tête `Authorization: Bearer <CRON_SECRET>` (16 caractères au moins, comparé en temps constant) : pose `CRON_SECRET`
dans Vercel. **Vercel Cron** ajoute cet en-tête tout seul, avec l'entrée suivante de `vercel.json` :

```json
"crons": [{ "path": "/api/telephonie/recuperation", "schedule": "17 6 * * *" }]
```

- **Offre Hobby** : une tâche **une fois par jour** au plus (une expression plus fréquente fait **échouer le déploiement**). C'est le
  réglage livré : un filet de sécurité quotidien.
- **Offre Pro** : remplace l'horaire par `* * * * *` (chaque minute) pour reprendre l'audio dans les minutes qui suivent l'appel.
- Sans Pro, un service de tâches planifiées externe peut appeler la même adresse chaque minute avec l'en-tête
  `Authorization: Bearer <CRON_SECRET>` (le secret est alors confié à ce service : choisis-en un de confiance).

---

## Les réponses des webhooks

`POST https://<ton-domaine>/api/telephonie/<fournisseur>/webhook`. Seul le fournisseur choisi dans la config répond. Les journaux de
Vercel ne portent que des codes (jamais un numéro, un e-mail, une adresse ni un secret).

| Code | Quand | Le fournisseur |
|---|---|---|
| 200 | reçu (corps `{ ok: true, evenements: n }`) ; ou ignoré (`ignore: true` : essai d'Onoff, événement non suivi, sans identifiant) | ne réessaie pas |
| 400 | le corps n'est pas du JSON en UTF-8 | |
| 401 | jeton ou secret faux ou absent | |
| 404 | fournisseur inconnu, sans webhook, ou autre que celui de la config | |
| 405 | autre méthode que POST | |
| 413 | corps de plus de 256 Ko | |
| 500 | la base a refusé l'événement (code seulement) | réessaie |
| 503 | variable absente, secret trop court, base non configurée : rien n'est lu | réessaie |

L'ordre des contrôles : fournisseur (404), configuration (503, sans lire le corps), taille (413), JSON (400 : le jeton d'Aircall est
dans le corps, il faut donc le lire avant de le vérifier), authenticité (401). Rejouer le même événement ne crée rien : la base retrouve
l'appel par (fournisseur, identifiant) et le complète sans rien effacer ; un statut « inconnu » n'écrase jamais un statut connu, un
événement sans données d'appel (une transcription prête, un enregistrement disponible) ne change pas la direction déjà connue, et un
audio déjà rangé n'est pas retéléchargé.

---

## Pour les développeurs

Le contrat est `lib/telephonie/types.ts`, partagé avec le reste de l'application : le changer passe d'abord par une issue
(`CONTRIBUTING.md`). Tout ce dossier est importé par le navigateur, par `next.config.ts` (au build) et par les routes : aucun module
Node, aucun accès au DOM au chargement, imports relatifs.

| Fichier | Rôle |
|---|---|
| `registre.ts` | `adaptateurTelephonie(id)`, `originesMicro(id)`, `REGISTRE_TELEPHONIE` |
| `onoff.ts`, `aircall.ts`, `ringover.ts`, `softphone.ts`, `telephone.ts` | un adaptateur par fournisseur (client navigateur, webhook) |
| `navigateur.ts` | événements DOM du Poste, options `data-*`, montage d'une iframe avec filtre des messages |
| `e164.ts` | `normaliserE164(saisie, indicatif)`, `estE164`, `formaterNumero`, `neufDerniersChiffres` |
| `aide.ts` | `aideTelephonie(id)` : textes du Poste et des réglages, pannes connues |
| `reception.ts` | la chaîne du webhook (pure, testée) ; la route ne fait que brancher les dépendances |
| `audio.ts`, `stockage.ts` | téléchargement borné, dépôt et effacement dans le bucket, `enregistrement_appel`, `transcription_appel` |
| `recuperation.ts` | la reprise différée (pure, testée) |
| `outils.ts` | lecture tolérante des corps, JSON (grands entiers gardés en texte), secrets |

### Le Poste : brancher le téléphone

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { adaptateurTelephonie } from "@/lib/telephonie/registre";
import { EVENEMENT_APPEL, EVENEMENT_ETAT, type SignalAppel } from "@/lib/telephonie/navigateur";
import { aideTelephonie } from "@/lib/telephonie/aide";
import type { EtatTelephone, FournisseurTelephonie, SchemaLien } from "@/lib/telephonie/types";

export function Telephone(props: {
  fournisseur: FournisseurTelephonie; // config.telephonie.fournisseur (passé par un composant serveur)
  schemaLien: SchemaLien;             // config.telephonie.schemaLien ?? "tel"
  copierNumero: boolean;              // config.telephonie.copierNumero
  numeros: string[];                  // les numéros de la fiche ouverte, déjà en E.164
  leadId: string;
}) {
  const adaptateur = adaptateurTelephonie(props.fournisseur);
  const ref = useRef<HTMLDivElement>(null);
  const [etat, setEtat] = useState<EtatTelephone>("attente");

  useEffect(() => {
    const el = ref.current;
    if (!el || !adaptateur) return;
    const surEtat = (e: Event) => setEtat((e as CustomEvent<EtatTelephone>).detail);
    const surAppel = (e: Event) => {
      const s = (e as CustomEvent<SignalAppel>).detail; // sonne, décroché, terminé (dureeS) : démarrer ou arrêter le chrono
      void s;
    };
    el.addEventListener(EVENEMENT_ETAT, surEtat);
    el.addEventListener(EVENEMENT_APPEL, surAppel);
    const demonter = adaptateur.client.preparer(el);
    setEtat(adaptateur.client.etat());
    return () => {
      demonter();
      el.removeEventListener(EVENEMENT_ETAT, surEtat);
      el.removeEventListener(EVENEMENT_APPEL, surAppel);
    };
  }, [adaptateur]);

  async function appeler(e164: string) {
    if (!adaptateur) return;
    const r = await adaptateur.client.appeler(e164, { leadId: props.leadId }); // "lance" | "repli_tel" | "copie" (ou une Error lisible)
    void r; // "copie" : afficher « Numéro copié » ; démarrer le chrono du Poste si besoin
  }

  return (
    <div>
      {/* Un élément DÉDIÉ à l'adaptateur : il y monte l'iframe (Aircall, Ringover) ou y affiche les numéros (Onoff). */}
      <div
        ref={ref}
        data-numero={props.numeros.join(" ")}
        data-schema-lien={props.schemaLien}
        data-copier-numero={props.copierNumero ? "1" : "0"}
      />
      <button type="button" onClick={() => appeler(props.numeros[0])}>Appeler</button>
      <p>{adaptateur ? aideTelephonie(adaptateur.id).poste : null}</p>
    </div>
  );
}
```

Règles :

- **Un élément dédié**, monté une fois (pas une clé React qui change à chaque fiche) : l'iframe d'Aircall ou de Ringover doit survivre
  au passage d'une fiche à l'autre (sinon l'appelant devrait se reconnecter, et un appel en cours serait coupé). Ne mets rien dedans :
  l'adaptateur en est le seul maître. Prévois sa taille selon `mode` : environ 376 × 600 pixels pour une iframe, une ligne pour Onoff.
- **`data-numero`** : les numéros de la fiche ouverte (E.164, séparés par une espace, trois au plus). L'adaptateur Onoff les affiche
  dans l'élément pour que l'extension les surligne ; il suit leurs changements tout seul. Les autres adaptateurs l'ignorent.
- **`appeler()`** prend un numéro E.164 (`normaliserE164(saisie, config.pays.indicatif)`) ; un numéro illisible lève une erreur au
  message lisible, à afficher telle quelle. `"copie"` veut dire « le numéro est dans le presse-papiers » ; `"repli_tel"`, « un lien
  d'appel a été ouvert » ; `"lance"`, « le téléphone du fournisseur compose ».
- **`etat()`** : `"pret"`, `"attente"` (connexion dans l'iframe, extension pas encore passée) ou `"indisponible"` (extension absente,
  téléphone mobile pour Onoff). L'événement `telephonie:etat` prévient à chaque changement.
- **`telephonie:appel`** (téléphones en iframe) : `{ etat: "sonne" | "decroche" | "termine", direction, dureeS, externeId, leadId }`,
  pour démarrer le chronomètre et reprendre la durée dans l'issue. Le webhook reste la source de vérité en base.
- **Onoff** : si le numéro est affiché DANS le bouton « Appeler », un clic direct de l'utilisateur sur le numéro surligné n'est pas
  relayé une seconde fois (l'adaptateur le détecte) ; un élément à côté du bouton est plus simple.
- **Annonce d'enregistrement** : quand `telephonie.enregistrement` est vrai et l'enregistrement complet activé, le Poste affiche
  `legal.annonceEnregistrement` et, une fois lue, écrit l'activité « annonce » de la fiche pendant l'appel (la base l'associe à cet appel).

### Ajouter un fournisseur

1. Un fichier `lib/telephonie/<fournisseur>.ts` qui exporte un `AdaptateurTelephonie` : `client` (préparer, état, appeler),
   `originesMicro` (`https://hote` ou `chrome-extension://<32 lettres>`), et si le fournisseur envoie des webhooks : `variables` (noms),
   `verifier` (temps constant ou Web Crypto), `lire` (vers `EvenementAppel`), `apres` (audio, transcription : réutilise `audio.ts`).
2. Le ranger dans `registre.ts`, ajouter ses textes dans `aide.ts`, ses tests dans `tests/telephonie-<fournisseur>.test.mjs`.
3. Le fournisseur doit déjà figurer dans `FOURNISSEURS_TELEPHONIE` (contrat partagé) et dans la contrainte SQL de la table `appels` :
   sinon, c'est un changement du contrat et de la migration, à discuter d'abord dans une issue (`CONTRIBUTING.md`).
