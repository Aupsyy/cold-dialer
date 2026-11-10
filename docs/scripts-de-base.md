# Scripts d'appel de départ

Des phrases prêtes à dire à voix haute pour un appel à froid court, à ajuster à ton offre (`docs/offre.md`) puis à ranger dans
`config/niche.json`. Elles sont écrites au **vouvoiement**, en phrases courtes, avec les crochets que le Poste remplit tout seul pour
chaque fiche.

**La convention de ce document.** Tout ce qui est dit au prospect est dans un bloc de citation (les lignes qui commencent par `>`).
Tout le reste (explications, conseils) est pour toi et ne se dit pas. Un test (`tests/docs-offre-scripts.test.mjs`) vérifie que chaque
phrase citée passe les garde-fous de la config : aucune promesse de résultat, aucun chiffre de résultat, aucun délai promis.

**Les crochets.** `[prénom]` (celui de la personne appelée), `[nom]`, `[entreprise]`, `[ville]`, `[métier]`, `[ton prénom]` (le tien),
`[équipe]` (ta structure) et `[deux créneaux]` (les deux créneaux de rendez-vous que le Poste propose). Chaque crochet utilisé doit
être listé dans `script.crochets`.

Ces scripts sont des points de départ : lis-les à voix haute, change tout ce qui sonne faux dans ta bouche, et garde ce qui est vrai
pour ton offre. Ne dis jamais une phrase que tu ne pourrais pas justifier.

## La structure d'un appel à froid court

Un appel à froid dure en général une à deux minutes. Cinq temps, dans cet ordre :

1. **L'ouverture franche** : qui tu es, qui tu appelles, sans détour ni faux prétexte.
2. **La permission** : tu demandes le droit de continuer, et tu laisses la personne dire non.
3. **La raison de l'appel** : une ou deux phrases sur le problème que tu règles et sur ce que tu fais, sans promesse.
4. **Deux questions** : pour vérifier que le problème existe chez elle, et l'écouter plus que tu ne parles.
5. **La proposition de rendez-vous** : un seul pas, avec deux créneaux précis.

### 1. L'ouverture (trois variantes)

**Variante directe.** On dit tout de suite qui on est et pourquoi on appelle.

> Bonjour [prénom], [ton prénom] de [équipe]. Je vous appelle au sujet de [entreprise] : je suis bien avec la personne qui s'occupe des
> décisions pour [métier] à [ville] ?

**Variante avec permission.** On commence par demander le droit de parler.

> Bonjour [prénom], [ton prénom] de [équipe]. Je ne vous connais pas et je vous appelle sans prévenir : avez-vous une minute pour que je
> vous dise pourquoi ?

**Variante « appel de prospection assumé ».** On reconnaît que c'est un appel commercial, ce qui désarme souvent la méfiance.

> Bonjour [prénom], [ton prénom] de [équipe]. Je vous préviens, c'est un appel de prospection : vous pouvez me dire non tout de suite,
> mais je vous explique en deux phrases pourquoi j'appelle [entreprise].

Rangement dans la config : la variante choisie va dans `script.ouverture.portable` (quand tu as directement la personne). La version
pour le standard va dans `script.ouverture.standard` (voir « Le barrage du standard »). La réponse à « Comment avez-vous mon numéro ? »
va dans `script.ouverture.commentAvezVousMonNumero` ; elle doit rester vraie : dis d'où viennent vraiment tes coordonnées (voir
`docs/legal.md`).

> J'ai trouvé votre entreprise dans le registre public des entreprises, et ce numéro sur votre site. Si vous préférez que je ne vous
> rappelle plus, je le note tout de suite.

### 2. La permission

Une phrase qui demande l'accord de continuer. Elle va dans `script.permission` (facultative).

> Je vous explique en une minute pourquoi j'appelle, et vous me dites si ça vous parle ou non. Ça vous va ?

### 3. La raison de l'appel

Le problème, puis ce que tu fais, sans résultat promis. Elle va dans `script.pitch`. Exemple avec l'offre fictive d'entretien de
bureaux (A de `docs/offre.md`) :

> J'appelle des cabinets de [ville] pour une raison précise : un prestataire de ménage qui change d'équipe ou oublie des passages.
> Nous mettons en place un planning écrit avec une équipe attitrée. Je ne sais pas si c'est votre cas, c'est justement ce que je voulais
> vous demander.

### 4. Deux questions

Une pour vérifier le problème, une pour mesurer s'il compte. Elles vont dans `script.questions` (de trois à six au total ; chacune a un
`id` en minuscules avec tirets bas, le `texte` dit à voix haute et un `but` pour toi). Écoute la réponse, ne coupe pas, et reformule.

> Aujourd'hui, comment se passe le ménage de vos locaux : qui s'en occupe, et à quelle fréquence ?

> Et quand un passage est oublié, qu'est-ce que ça vous coûte, en temps ou en énervement ?

Ces deux questions suivent l'exemple fictif d'entretien de bureaux : remplace-les par celles de TON sujet. Évite d'inventer un crochet
(`[sujet]`) : un crochet inconnu du Poste est refusé par `npm test`.

### 5. La proposition de rendez-vous avec deux créneaux

Un seul pas : un rendez-vous court, au nom et à la durée annoncés dans l'offre (`offre.rdv`). Deux créneaux précis, jamais « quand vous
voulez ». Elle va dans `script.close`, qui doit contenir `[deux créneaux]`.

> Le plus simple serait d'en parler vingt minutes en visio, calendrier sous les yeux. Je peux vous proposer [deux créneaux] : lequel
> vous arrange le mieux ?

## Le barrage du standard

Une secrétaire ou un standard n'est pas un obstacle : c'est quelqu'un qui fait son travail. Reste poli, dis la vérité, demande
seulement la bonne personne. Cette phrase va dans `script.ouverture.standard`.

> Bonjour, [ton prénom] de [équipe]. Pourrais-je parler à la personne qui s'occupe de [métier] chez [entreprise], s'il vous plaît ?

Si on te demande « C'est à quel sujet ? » :

> C'est pour un échange professionnel sur l'organisation de [entreprise]. Je préfère l'expliquer directement à la personne concernée.

Si la personne n'est pas là, demande quand la joindre plutôt que de laisser un message flou :

> Pas de souci. Quel serait le meilleur moment pour la joindre, aujourd'hui ou un autre jour ?

Au Poste, l'issue se note « Standard ou barrage » (touche `3` dans l'exemple) avec le meilleur moment : le rappel est reprogrammé à un
autre créneau. Ne mens jamais pour passer (« c'est personnel », « elle m'attend ») et ne donne pas de détail de l'offre au standard.

## La messagerie

**Quand laisser un message.** Un message court, une fois, au premier ou au deuxième essai, quand tu as un nom et une raison claire de
rappeler. **Quand ne pas en laisser :** quand tu as déjà laissé un message sur cette fiche, quand la messagerie ne donne pas le nom de
l'entreprise (tu ne sais pas où tu tombes), ou quand c'est un numéro personnel. Un message ne vend rien : il dit qui tu es et que tu
rappelleras. Cette phrase va dans `script.messagerie`.

> Bonjour [prénom], [ton prénom] de [équipe]. Je vous appelais au sujet de [entreprise], à [ville]. Je vous rappelle dans les
> prochains jours. Bonne journée.

Au Poste, l'issue se note « Messagerie » (touche `2` dans l'exemple). Ne laisse pas de numéro à rappeler si tu n'as pas la disponibilité
pour décrocher : promettre un rappel et ne pas le faire coûte plus cher que de ne rien dire.

## Dix objections courantes

Chaque réponse tient en une phrase et reste honnête : elle écoute, puis propose le seul pas prévu (le rendez-vous). La **sortie
propre** est la même partout : si c'est non après la réponse, tu remercies et tu raccroches, sans insister une deuxième fois.

Rangement dans la config : chaque objection est un élément de `objections` avec un `code` (minuscules et tirets, par exemple
`pas-le-temps`), un `libelle` (la phrase du prospect, telle qu'elle s'affiche au Poste), une `reponse` (la phrase ci-dessous) et une
`relance` facultative (ce que tu dis si la personne hésite encore). La config accepte jusqu'à vingt objections ; « libre » existe
déjà. Ne renomme plus un `code` une fois qu'il sert : les retours déjà notés y sont attachés.

**1. « Je n'ai pas le temps » (`pas-le-temps`).**

> Je comprends, c'est pour ça que je ne vous retiens pas : on peut en parler vingt minutes à un moment qui vous arrange.

**2. « Envoyez-moi un mail » (`envoyez-un-mail`).**

> Avec plaisir, mais pour vous envoyer quelque chose d'utile plutôt qu'une brochure, quelle est votre priorité du moment ?

**3. « J'ai déjà quelqu'un pour ça » (`deja-un-prestataire`).**

> Très bien, je ne vous demande pas de changer : qu'est-ce qui vous plaît chez eux, et qu'est-ce que vous aimeriez avoir en plus ?

**4. « Ça ne m'intéresse pas » (`pas-interesse`).**

> Je comprends. Juste pour savoir si je dois vous rappeler un jour : c'est le sujet qui ne vous parle pas, ou le moment qui n'est pas bon ?

**5. « Combien ça coûte ? » (`combien-ca-coute`).**

> Ça dépend de votre situation, et je préfère ne pas vous donner un chiffre au hasard : c'est justement ce qu'on regarde ensemble au
> rendez-vous.

**6. « Comment avez-vous mon numéro ? » (`comment-mon-numero`).**

> Il est dans le registre public des entreprises et sur votre site ; et si vous préférez que je ne vous rappelle plus, je le note
> immédiatement.

**7. « Qu'est-ce que vous vendez exactement ? » (`cest-quoi`).**

> Je ne vends rien par téléphone : je propose un rendez-vous court pour regarder votre situation et vous dire honnêtement si je peux
> vous aider.

**8. « Je fais déjà ça moi-même » (`fait-en-interne`).**

> Très bien, vous connaissez donc le sujet : qu'est-ce qui vous prend le plus de temps aujourd'hui dans ce que vous faites vous-même ?

**9. « Il faut que j'en parle à mon associé » (`en-parler-associe`).**

> C'est normal : proposons un rendez-vous où il peut être présent aussi, ce sera plus simple pour tout le monde.

**10. « Rappelez-moi plus tard » (`rappeler-plus-tard`).**

> Avec plaisir : quel jour et quelle heure vous arrangeraient pour que je vous rappelle ?

**La sortie propre quand c'est non.** Une phrase, un remerciement, et tu notes l'issue « Pas intéressé » (avec la raison dans la note).

> Je comprends tout à fait, merci d'avoir pris le temps de me répondre. Je vous souhaite une bonne journée.

La **relance** de l'objection 1 est un exemple de ce que tu mets dans `relance` : elle sert quand la personne ne dit ni oui ni non.

> Je vous propose [deux créneaux] ; si aucun ne va, dites-moi celui qui vous arrange.

## Quand la personne demande à ne plus être appelée

C'est la seule demande à laquelle tu ne réponds jamais par une objection : **tu la respectes tout de suite, sans discuter ni demander
pourquoi**. Tu t'excuses, tu confirmes, tu notes l'issue « Ne plus contacter » au Poste (touche `8` dans l'exemple) : la fiche sort de la
file et le numéro est mémorisé pour qu'on ne l'importe plus. Le cadre légal (opposition, listes, durée de conservation) est dans
`docs/legal.md`.

> Bien sûr, je le note tout de suite et vous ne serez plus rappelé. Excusez-moi pour le dérangement, et bonne journée.

La phrase pour les questions d'origine des données (`legal.phraseSource`) et celle de l'opposition (`legal.phraseOpposition`) se règlent
dans le bloc `legal` de la config ; elles doivent rester vraies, c'est ton engagement envers la personne.

## Tenir le rythme

Un appel à froid n'est pas difficile à cause du script, mais de la répétition. Quelques habitudes qui aident, sans objectif chiffré à
atteindre :

- **Prépare la file AVANT de t'asseoir.** Les fiches à appeler, leur ordre, les rappels du jour sont prêts avant le premier appel : le
  Poste classe la file par score et par rappels dus, tu n'as qu'à enchaîner.
- **Note l'issue en une touche, tout de suite.** Pas de rédaction pendant que la personne parle ; une touche d'issue, une ligne de note
  si besoin, la fiche suivante. Les détails se complètent après la série, pas pendant.
- **Aucune recherche entre deux appels.** Pas de visite du site de l'entreprise, pas de lecture de ses avis : tout ce dont tu as besoin
  est dans la fiche (et l'accroche déjà préparée si tu en as). La recherche se fait avant, par lot, jamais entre deux sonneries.
- **Travaille par séries, avec une pause.** Une série d'appels d'un seul tenant, puis une vraie pause (debout, loin de l'écran), puis
  la suivante. Une voix fatiguée se remarque dès la première phrase ; arrête quand elle sonne mal.
- **Relis ton script à voix haute avant de commencer**, pas pendant : il doit être dans ta bouche, pas sous ton nez.
- **Débriefe à la fin**, pas au fil de l'eau : quelques minutes pour compléter les fiches et relever ce que les gens ont vraiment dit
  (skill `debrief`).

**Quoi mesurer.** Trois choses suffisent au début : le nombre d'appels passés, le nombre de vraies conversations (la personne
décisionnaire a répondu et t'a écouté) et le nombre de rendez-vous fixés. Compare-les à tes propres séries précédentes, pas à une
norme : aucun chiffre moyen ne vaut pour ta cible, ton offre et ton marché. Si les conversations sont rares, regarde la liste et les
horaires ; si elles sont nombreuses mais sans rendez-vous, regarde l'offre et la proposition de rendez-vous.

La page `/retours` et le skill `ajuster-script` servent à lire ce que disent les prospects et à changer UNE phrase du script à la fois.

## Où chaque morceau se range dans la config

| Ce que tu dis | Champ de `config/niche.json` |
|---|---|
| L'ouverture quand tu as la personne | `script.ouverture.portable` |
| L'ouverture au standard | `script.ouverture.standard` |
| « Comment avez-vous mon numéro ? » | `script.ouverture.commentAvezVousMonNumero` |
| La permission | `script.permission` |
| Les deux questions (puis d'autres, jusqu'à six) | `script.questions` : `id`, `texte`, `but` |
| La raison de l'appel | `script.pitch` |
| La proposition de rendez-vous | `script.close` (avec `[deux créneaux]`) |
| La messagerie | `script.messagerie` |
| Les crochets utilisés | `script.crochets` (tous ceux qui apparaissent dans les phrases) |
| Chaque objection, sa réponse et sa relance | `objections[]` : `code`, `libelle`, `reponse`, `relance` |
| La phrase d'esquive du prix | `offre.phrasePrix` (voir `docs/offre.md`) |
| L'issue « Ne plus contacter » | `issues` (`ne_plus_contacter`, déjà dans le socle) |

Le ton (`script.ton`) et le vouvoiement (`script.vouvoiement`) se règlent aussi dans le bloc `script`. Après chaque changement :
`npm test` (le schéma et les garde-fous tranchent). Avec Claude Code, le skill `construire-offre` écrit ce premier script à partir de
ton offre, et `ajuster-script` le fait évoluer ensuite.
