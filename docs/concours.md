# La session commune : un concours d'appels entre équipes (facultatif)

Une session commune met plusieurs équipes face à un même classement : qui passe le plus d'appels, a le plus de conversations, décroche
le plus de rendez-vous. Le Poste d'appels envoie ses compteurs à un service qui héberge la session ; rien d'autre ne part. Le module
est **éteint tant que tu ne le branches pas** : sans branchement (le clic dans Réglages, ou à défaut les trois variables `CONCOURS_*`), il ne fait rien.

## Ce qui part, et ce qui ne part pas

| Part | Ne part jamais |
|---|---|
| à chaque issue enregistrée, un seul mot : `sans_reponse`, `conversation` ou `rdv`, avec le jeton de ton équipe | un nom, un numéro, un e-mail, une note, une fiche, un SIREN, une date de rappel, une durée, l'identité de la personne qui appelle |
| au moment de rejoindre : le pseudo que tu choisis | le contenu de ta base, de ton script ou de ta configuration |

- Le service reconstruit tout seul tes compteurs (appels, conversations, rendez-vous) à partir de ces mots.
- Le jeton identifie ton instance : toutes les personnes qui appellent depuis elle comptent pour un seul participant.
- Les journaux de l'application ne reçoivent que des codes d'échec (`delai`, `reseau`, `http_429`…), jamais une adresse ni le jeton.
- L'encart « Session commune » de l'écran Réglages (visible de tous quand le module est actif) rappelle ce qui part et renvoie à la page
  publique de la session ; il sert aussi à rejoindre et à quitter (propriétaire et membres).

## Rejoindre, d'un clic

Il te faut le **lien public de la session**, donné par qui l'organise (il ressemble à `https://example.org/concours/ABCD1234`). Tu dois
être propriétaire ou membre de l'équipe (un appelant ne peut pas brancher l'équipe).

1. Ouvre **Réglages**, encart **Session commune**.
2. Colle le lien dans « Lien de la session ». Tu n'as que l'adresse du service et un code ? Mets l'adresse dans le premier champ et le code
   dans le second.
3. Choisis le **pseudo** de ton équipe : c'est le nom qui s'affiche au classement (40 caractères au plus).
4. Clique **Rejoindre**.

Le serveur vérifie le lien (https obligatoire), s'inscrit auprès du service, puis range le résultat dans ta base. Rien à poser chez ton
hébergeur, aucune ligne de commande, aucun redéploiement : tes compteurs partent dès l'appel suivant. L'encart affiche ensuite le titre de la
session, ton pseudo, un lien vers le classement et, si le service les rend, tes compteurs. Rejoindre une autre session remplace la
précédente.

- Cet écran demande la **migration 0002** (`supabase/migrations/0002_concours_branchement.sql`, voir `docs/installation.md`). Sans elle,
  l'encart te le dit et ne s'inscrit nulle part.
- Les messages d'erreur sont en français simple : session inconnue, fermée ou pleine, pseudo déjà pris ou refusé, service injoignable ou trop
  lent, lien non sécurisé.
- Où est le jeton ? Le service te rend un jeton qui identifie ton équipe. Il est rangé dans la table `concours_branchement` de ta base.
  **Aucun compte connecté ne peut le lire**, même le propriétaire : l'écran ne l'affiche jamais, et seul le serveur le lit (avec la clé
  service) pour envoyer les compteurs. Garde-le secret comme une clé : il ne faut jamais le coller dans un message.

### En secours : la ligne de commande

Toujours possible (par exemple sans la clé service, ou pour une instance qui n'a pas la migration 0002). Il te faut l'adresse du service et
le code de la session.

```bash
node scripts/concours/rejoindre.mjs --url https://concours.example.org --code ABCD1234 --pseudo "Équipe Soleil"
```

- `--essai` vérifie les trois réglages sans rien appeler ni écrire.
- Le script appelle le service, puis écrit lui-même `CONCOURS_URL`, `CONCOURS_CODE` et `CONCOURS_JETON` dans `.env.local` (ces trois
  lignes seulement : le reste du fichier est conservé). Le jeton ne s'affiche jamais ; `--copier-jeton` le met dans le presse-papiers.
- Une instance en ligne a besoin des trois mêmes variables chez ton hébergeur. Sur Vercel : Settings, Environment Variables, ajoute
  `CONCOURS_URL`, `CONCOURS_CODE` puis `CONCOURS_JETON` (en « Sensitive »), puis redéploie. `scripts/install/secrets.mjs` ne les pose
  pas : il ne tire au hasard que des secrets que tu inventes toi-même, alors que ces trois valeurs viennent du service.
- Si les deux méthodes sont présentes, **le branchement de la base passe avant les variables**.
- Voir le classement : `node scripts/concours/classement.mjs` (pseudos et compteurs).

## Quitter

Dans Réglages, encart Session commune, **Quitter la session** : le branchement est retiré de ta base (le jeton y est effacé) et plus rien
ne part. **Ton pseudo reste au classement du service** : seul l'organisateur peut l'effacer, demande-le-lui si besoin.

Si tu avais branché par les variables, retire aussi `CONCOURS_URL`, `CONCOURS_CODE` et `CONCOURS_JETON` de `.env.local` et de ton
hébergeur, puis redéploie (l'écran te prévient quand elles existent encore).

## Ce que vaut chaque issue

La traduction est dans `lib/concours/traduction.ts`. Chaque issue de `config/niche.json` peut porter un champ facultatif `concours` :

| Valeur | Sens |
|---|---|
| `sans_reponse` | personne n'a été joint (pas de réponse, messagerie, standard ou barrage) |
| `conversation` | un interlocuteur a parlé, sans rendez-vous |
| `rdv` | un rendez-vous est fixé |
| `ignorer` | l'issue n'est pas comptée |

Sans ce champ, le sens est déduit du code pour les issues du socle (`pas_repondu`, `messagerie`, `standard` : `sans_reponse` ;
`a_rappeler`, `pas_interesse`, `hors_cible`, `ne_plus_contacter` : `conversation` ; `rdv_fixe` : `rdv`). Une issue ajoutée par ta niche
n'est **pas comptée** tant que tu ne lui donnes pas une valeur : `config/niche.exemple.json` montre comment.

## Comment l'envoi est branché

L'action serveur qui enregistre l'issue (`app/_actions/issue.ts`, `enregistrerIssue`) planifie l'envoi **après** l'enregistrement réussi,
avec `after()` de Next.js : l'envoi part une fois la réponse rendue à l'appelant. Dans ce temps-là, le serveur lit la configuration : le
branchement rangé en base d'abord (`lib/concours/serveur.ts`), les variables `CONCOURS_*` ensuite, sinon rien ne part. L'envoi a un
délai de 3 secondes, avale toutes ses erreurs (qu'il compte par code) et ne peut donc ni retarder ni faire échouer l'appel. Un
`429 trop_vite` est retenté une fois après 2 secondes.

**Le début d'un appel.** Quand le bouton « Appeler » du Poste a lancé l'appel (l'outil l'a composé, ou le lien `tel:` est parti), le
Poste le signale au serveur, qui envoie `{ "jeton": "…", "debut": true }` au service, de la même façon (après la réponse, jamais
bloquant). C'est un signal de confort pour qu'un service chronomètre les appels : s'il ne le connaît pas et répond 400, rien ne casse et
rien n'est compté comme un échec. Il ne porte aucune donnée de fiche.

## Limites

- **Les corrections ne sont pas envoyées.** Le Poste n'a pas de geste pour corriger ou annuler une issue déjà enregistrée : l'événement
  `annuler` du contrat est implémenté dans `lib/concours/client.ts` mais aucun écran ne l'appelle. Une issue comptée à tort le reste.
- Un envoi perdu (service injoignable, délai dépassé, plafond atteint) n'est pas rejoué : le classement peut avoir un peu de retard sur
  la réalité. Les compteurs d'échecs ne vivent que le temps du processus du serveur.
- L'envoi est fait du serveur vers le service ; les deux se font confiance par le jeton seul. Garde-le secret, comme une clé.
- Le module ne protège pas contre la triche : le service ne voit que des mots, pas des appels.
- Le classement et la page publique sont ceux du service, pas de cette application.

## Le contrat du service (pour qui veut héberger une session)

Cette application ne contient pas le service. Voici ce qu'elle attend. Base : `{URL}/api/concours/{code}`, avec `code` de 4 à 12
caractères A-Z et 0-9. Les erreurs ont la forme `{ "erreur": "<code>" }`.

**`POST …/rejoindre`**, corps `{ "pseudo": "…", "source": "dialer" }`

- 200 : `{ "participant", "jeton", "pseudo" }`
- 404 `session_inconnue` ; 403 `session_fermee` ou `session_pleine` ; 409 `pseudo_pris` ; 400 `pseudo_invalide`

**`POST …/evenement`**, corps `{ "jeton": "…", "issue": "sans_reponse" | "conversation" | "rdv" }`, ou avec `"annuler": true`, ou
`{ "jeton": "…", "debut": true }` (un appel vient d'être lancé ; un service qui ne le connaît pas peut répondre 400, l'application s'en
accommode)

- 200 : `{ "appels", "conversations", "rdv" }`
- 401 `jeton_inconnu` ; 403 `session_fermee` ; 429 `trop_vite` (moins de 2 secondes depuis le dernier événement) ou `plafond` ;
  409 `rien_a_annuler`

**`GET …/classement`**

```json
{
  "session": { "titre": "…", "debut": "…", "fin": "…", "ouverte": true },
  "maintenant": "…",
  "participants": [{ "pseudo": "…", "appels": 0, "conversations": 0, "rdv": 0, "premier_appel": "…", "dernier_appel": "…", "source": "dialer" }]
}
```

La page publique attendue est `{URL}/concours/{code}`. Pour les essais, l'adresse du service (le lien collé dans Réglages, ou `CONCOURS_URL`) accepte `http://localhost` ; partout ailleurs, https
est obligatoire.
