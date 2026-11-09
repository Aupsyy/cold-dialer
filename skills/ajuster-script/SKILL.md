---
name: ajuster-script
description: Lit avec l'utilisateur les retours du marché de la page /retours (7 ou 30 jours, objections les plus fréquentes, issues, verdicts de l'accroche, intérêt moyen, tags, citations, douleurs) et propose UN changement du script dans config/niche.json (nouvelle réponse ou relance d'objection, nouvelle objection, variante d'ouverture ou de question), conforme au schéma et aux garde-fous, testé par npm test et commité sur une branche que l'utilisateur relit et fusionne lui-même. À utiliser quand l'utilisateur dit « ajuste le script », « que disent les prospects », « ils me disent tous qu'ils n'ont pas le temps », « améliore la réponse à cette objection », « fais le point sur les retours ». Pas pour débriefer un appel (skill debrief), ni pour changer l'offre ou la cible en profondeur (skill installer, questions 2 à 4).
---

# Ajuster le script d'après les retours du marché

## But

Faire évoluer le script d'appel à partir de ce que les prospects disent vraiment (les débriefs et les retours notés au Poste), un
changement à la fois, sans jamais promettre d'effet. La config `config/niche.json` est la seule source du script : le changement passe
par elle, par `npm test` (schéma et garde-fous), par une branche git, puis par la relecture et la fusion de l'utilisateur.

## Entrées

- **La page `/retours`** de l'application, ouverte par l'utilisateur (un gestionnaire y voit toute l'équipe et peut filtrer par
  appelant ; un appelant ne voit que ses retours), sur **7 ou 30 jours** : les compteurs (retours, avec le décideur, rendez-vous,
  intérêt moyen), les objections les plus fréquentes, les issues des appels, les verdicts de l'accroche, les tags fréquents, les
  citations et douleurs récentes. Aucun script ne lit ces agrégats : l'utilisateur te les donne (copie ou résumé).
- `config/niche.json` : `objections` (code, libellé, réponse, relance), `script` (ouverture, permission, questions, pitch, close,
  messagerie, crochets, ton, vouvoiement), `offre` (pour rester fidèle à ce qui est vendu).
- Le schéma et les garde-fous : `config/schema.ts` et `config/garde-fous.ts` (lus, jamais modifiés).

## Étapes

1. **Lire les retours.** Demande à l'utilisateur d'ouvrir `/retours` (7 jours, ou `?periode=30` pour 30 jours) et de te donner les
   compteurs et les libellés : objections et leur nombre, issues, verdicts, tags. S'il colle des citations ou des douleurs, qu'il
   retire le nom de l'entreprise et la date : elles servent à comprendre les mots du prospect, elles ne vont dans aucun fichier.
2. **Juger s'il y a de quoi conclure.** Peu de retours sur la période, ou une objection vue une ou deux fois : dis-le, propose
   d'attendre la période suivante, et ne change rien. Une objection notée « Autre objection (texte libre) » qui revient souvent est une
   candidate pour une nouvelle objection de la liste.
3. **Choisir UN changement** avec l'utilisateur, le plus utile d'abord :
   - une meilleure réponse (`reponse`) ou une relance (`relance`) pour l'objection la plus fréquente ;
   - une nouvelle objection (`code` en minuscules et tirets, 2 à 40 caractères, `libelle`, `reponse`, `relance` facultative ; 20 au
     plus ; « libre » existe déjà, ne l'ajoute pas) ;
   - une variante de l'ouverture (`script.ouverture.portable` ou `standard`) ou d'une question (`script.questions`, de 3 à 6) : une
     seule version vit dans la config, la variante remplace l'ancienne et l'historique git garde celle d'avant.
4. **Écrire la proposition** dans `config/niche.json`, au ton de `script.ton` et selon `script.vouvoiement`, puis montre le diff :
   `git diff config/niche.json`. Respecte le schéma : objets stricts (aucune clé inventée), textes dans leurs longueurs, crochets connus
   et déclarés dans `script.crochets` (`[prénom]`, `[nom]`, `[entreprise]`, `[ville]`, `[métier]`, `[ton prénom]`, `[équipe]`,
   `[deux créneaux]`), le close avec `[deux créneaux]`.
5. **Tester** : `npm test`. Un refus du schéma ou des garde-fous se corrige en **reformulant** avec l'utilisateur (surtout une promesse),
   jamais en touchant `config/schema.ts`, `config/garde-fous.ts` ou un test.
6. **Commiter sur une branche**, une fois l'accord de l'utilisateur sur le texte :

   ```bash
   git switch -c ajuster-script-AAAA-MM-JJ
   git add config/niche.json
   git commit -m "Script : nouvelle réponse à l'objection « Je n'ai pas le temps »"
   ```

7. **La relecture et la fusion sont à l'utilisateur** : il relit le commit et le fusionne lui-même dans sa branche principale. Ensuite,
   le script n'apparaît au Poste qu'après un redéploiement (la config est lue au build) : `vercel deploy --prod`, ou le déploiement
   automatique si son projet Vercel suit le dépôt GitHub.
8. **Noter la date du changement** dans le message de commit (le nom de la branche la porte) : à la période suivante, on relit
   `/retours` pour voir ce que disent les prospects depuis, sans conclure trop vite.

## Garde-fous

- **Aucun chiffre de résultat, aucune promesse**, ni dans la config (le garde-fou refuse « garanti », « assuré », « doubler »,
  « sans risque », un nombre de clients ou de rendez-vous, un pourcentage, un délai promis), ni dans ce que tu dis à l'utilisateur : tu
  ne promets jamais qu'un changement fera plus de rendez-vous.
- **Aucune donnée de prospect dans la config ni dans un commit** : ni nom d'entreprise, ni prénom, ni citation recopiée telle quelle.
  `config/niche.json` est suivi par git ; une réponse d'objection se réécrit avec des mots génériques.
- Aucun texte de la config ne contient d'URL (sauf `agenda.lienReservation`), d'e-mail (sauf `legal.contactRGPD`), de tiret cadratin,
  ni les mots « token » ou « secret » (le garde-fou des clés les refuse partout).
- **Ne jamais renommer** un `code` d'objection ou d'issue, ni un `id` de question ou de champ de débrief : les retours, les débriefs et
  les réponses déjà en base y sont attachés. On change le libellé et le texte, pas le code.
- **Un changement à la fois**, sur une branche ; jamais de push, de fusion ni de déploiement à la place de l'utilisateur.
- Jamais ouvrir `.env*`. Rien n'est envoyé aux prospects.

## Sortie

- Un commit sur la branche `ajuster-script-AAAA-MM-JJ` qui ne touche que `config/niche.json`, avec `npm test` vert.
- Un court compte rendu : ce que disaient les retours (compteurs et libellés), le changement proposé et pourquoi, ce qui reste à faire
  (relire, fusionner, redéployer), et quand relire `/retours`.

## Pièges connus

- Les garde-fous sont **lexicaux** : « rassuré » contient « assuré », « double » contient « doubl », un nombre suivi de « chantiers »
  ou de « clients » est lu comme un chiffre de résultat, « secret » est pris pour une clé. Reformule plutôt que de forcer.
- Une citation copiée dans la config la ferait entrer dans git : relis le diff avant chaque commit.
- La page `/retours` montre une période glissante (7 ou 30 jours) : deux lectures à des jours différents ne portent pas sur les mêmes
  appels. Elle ne compte que les appels débriefés (skill `debrief`) ou notés dans « Noter un retour » en bas de la page ; une issue
  notée au Poste seule n'y entre pas. Peu de débriefs, peu de retours : encourage l'équipe à débriefer avant de conclure.
- Le script d'un appelant qui a gardé le Poste ouvert reste l'ancien jusqu'au rechargement de la page après le déploiement.
- Un crochet non déclaré dans `script.crochets`, ou un close sans `[deux créneaux]`, fait échouer `npm test` : c'est voulu.
