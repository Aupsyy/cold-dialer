# Débrief d'un appel : du transcript à la fiche

Après un appel, Claude Code (skill `debrief`) lit la transcription, en extrait ce que le prospect a dit dans un fichier JSON au format
ci-dessous, puis `scripts/debrief/ecrire.mjs` le contrôle (essai, par défaut) et l'écrit dans la base. Il n'y a **aucune clé d'API d'IA**
dans l'application : l'extraction, c'est Claude Code ; les scripts ne font que la tuyauterie, sous l'identité du compte qui a appelé.

Les exemples de ce document sont **fictifs** (la niche d'exemple « paysagistes » de `config/niche.exemple.json`, l'entreprise
« Atelier Démo 07 », des numéros de la plage réservée à la fiction 01 99 00 xx xx).

## Les règles

1. **Rien d'inventé.** Ce que le prospect n'a pas dit reste vide : `null`, `""` ou `[]`. Un intérêt (`interet`) ne se note que s'il se
   voit clairement. Un résumé (`resume`) reformule, il n'ajoute rien.
2. **Citations mot pour mot.** Chaque citation est copiée telle quelle depuis ce que le **prospect** a dit, sans guillemets (le script les
   retire), 300 caractères au plus. Quand la transcription est là (dans le JSON ou en base), le script vérifie que chaque citation s'y
   trouve : seules la casse, les espaces, les apostrophes et les guillemets peuvent différer. Une phrase de l'appelant est refusée.
3. **Codes contraints.** Issues, objections et champs de découverte viennent de `config/niche.json` ; une clé ou un code inconnu est refusé
   (le message donne la liste des codes permis, jamais la valeur fautive).
4. **Essai d'abord.** Sans `--ecrire`, le script joue tout dans une transaction **annulée** : la base contrôle tout (droits, RLS,
   contraintes, déclencheurs) et rien n'est écrit. On ne lance l'écriture qu'après un essai sans erreur.
5. **Aucune donnée qui traîne.** Le transcript et le JSON vivent dans le scratchpad de Claude Code, puis sont supprimés : les scripts
   refusent d'écrire un transcript dans un dossier qui est dans un dépôt git, et `ecrire.mjs` refuse un JSON de débrief posé dans un
   dépôt git, sans le lire. La console ne montre que des compteurs, des codes et des identifiants ; jamais un nom, un numéro, une
   citation ni l'adresse de la base. Rien n'est jamais envoyé au prospect.

## Les sources de la transcription

| Source | Comment la lire | `source` |
| --- | --- | --- |
| Collée par l'utilisateur | Claude Code l'écrit dans un fichier du scratchpad | `colle` |
| Fichier (export texte) | lu tel quel depuis le scratchpad | `fichier` |
| Appel déjà transcrit en base (webhook Onoff, Aircall…) | `node scripts/debrief/lire-appel.mjs --liste`, puis `--externe-id <id> <scratchpad>` | `appel` (avec `appel.externe_id`) |
| App Notes du Mac (macOS seulement) | `node scripts/debrief/notes-mac.mjs --liste`, puis `--derniere <scratchpad>` ou `--rang <n> <scratchpad>` (ou `--presse-papiers <scratchpad>` si la transcription n'est que dans l'audio : « Copier la transcription » dans Notes) | `notes_mac` |

## Les commandes, dans l'ordre

```bash
# 1. La transcription, dans le scratchpad (selon la source, voir le tableau)
node scripts/debrief/lire-appel.mjs --liste                                  # appels transcrits récents : date, durée, externe_id…
node scripts/debrief/lire-appel.mjs --externe-id <id> <scratchpad>           # écrit <scratchpad>/appel-<fournisseur>-<id>.txt
node scripts/debrief/notes-mac.mjs --liste                                   # macOS : les dernières notes (rang, date, taille)
node scripts/debrief/notes-mac.mjs --derniere <scratchpad>                   # macOS : le texte de la note la plus récente

# 2. Claude Code écrit <scratchpad>/debrief.json (schéma ci-dessous)

# 3. Essai (par défaut) : tout est contrôlé puis annulé
node scripts/debrief/ecrire.mjs <scratchpad>/debrief.json --appelant <e-mail du compte>

# 4. Écriture (une transaction : tout ou rien)
node scripts/debrief/ecrire.mjs <scratchpad>/debrief.json --appelant <e-mail du compte> --ecrire

# 5. Supprimer le transcript et le JSON du scratchpad
```

Options de `ecrire.mjs` :

- `--appelant <e-mail ou id>` : le compte qui a passé l'appel (son e-mail de connexion ou son e-mail chez le fournisseur de téléphonie).
  Obligatoire si l'équipe a plusieurs comptes. Le script écrit **sous son identité** : un appelant ne touche que ses fiches et les fiches
  non attribuées, exactement comme dans l'application.
- `--issue` : enregistre aussi l'issue comme le Poste (fonction `enregistrer_issue` : statut de la fiche, tentatives, rappel, liste
  d'opposition pour `ne_plus_contacter`). Seulement si l'issue n'a pas déjà été notée au Poste. Jamais `rdv_fixe` : un rendez-vous se
  pose au Poste ou dans l'agenda, qui créent le créneau. `ne_plus_contacter` est toujours enregistrée ainsi, même sans `--issue` (sauf
  si la fiche est déjà « ne plus contacter ») : c'est `enregistrer_issue` qui inscrit la fiche sur la liste d'opposition.
- `--sans-transcription` : ne garde pas la transcription, seulement ce qui en est extrait.

Connexion : `SUPABASE_DB_URL`, lue dans `.env.local` si elle n'est pas dans l'environnement ; elle n'est jamais affichée. Vers une base
distante, le certificat est vérifié si `SUPABASE_DB_CA` est posée (`docs/installation.md`, étape 2.3).
Codes de sortie : `0` essai ou écriture réussis, `1` JSON refusé, fichier posé dans un dépôt git ou erreur de la base (code SQL
seulement), `2` arrêt (fiche, appel ou compte à préciser).

## Le schéma du JSON

```json
{
  "version": 1,
  "creer_si_absent": false,
  "source": "colle",
  "lead": { "id": null, "telephone": "01 99 00 00 07", "entreprise": "Atelier Démo 07", "ville": null, "dirigeant": null },
  "appel": { "debut": "2026-11-09T15:20:00+01:00", "duree_s": 312, "externe_id": null, "fournisseur": null },
  "transcription": [
    { "locuteur": "appelant", "texte": "Bonjour, je vous appelle au sujet des demandes de devis de votre entreprise." },
    { "locuteur": "prospect", "texte": "Ah oui. Les plateformes m'envoient des demandes à quarante kilomètres, je ne peux pas suivre." },
    { "locuteur": "appelant", "texte": "Et aujourd'hui, vos clients arrivent surtout comment ?" },
    { "locuteur": "prospect", "texte": "Surtout le bouche-à-oreille, et un peu les plateformes. Je n'ai pas le temps cette semaine, rappelez-moi jeudi." }
  ],
  "extraction": {
    "resume": "Gérant joint, intéressé par des demandes plus proches ; à rappeler jeudi.",
    "issue": "a_rappeler",
    "objection": "pas-le-temps",
    "objection_texte": null,
    "interet": 2,
    "decideur_joint": true,
    "douleurs": ["Demandes trop loin de sa zone"],
    "croyances": [],
    "citations": ["Les plateformes m'envoient des demandes à quarante kilomètres, je ne peux pas suivre."],
    "prochaine_etape": { "type": "rappel", "date": "2026-11-12T10:00:00+01:00", "detail": null },
    "tags": ["plateformes", "distance"],
    "source_clients": "Bouche-à-oreille, un peu les plateformes",
    "chantiers_voulus": "",
    "frein_principal": "",
    "zone": null,
    "capacite": null
  },
  "verdict_accroche": "utile"
}
```

Un appel déjà en base (reçu du fournisseur de téléphonie) : `appel.externe_id` le désigne, `lead` peut rester `null` (la fiche est celle
de l'appel), `transcription` peut rester `[]` (le script reprend celle de l'appel, et y vérifie les citations).

```json
{
  "lead": null,
  "appel": { "externe_id": "appel-demo-42", "fournisseur": "onoff" },
  "transcription": [],
  "extraction": { "issue": "pas_interesse", "objection": "assez-de-travail", "interet": 0, "decideur_joint": true,
                  "douleurs": [], "citations": [], "tags": ["saison"], "zone": "Une vingtaine de kilomètres" },
  "verdict_accroche": "neutre"
}
```

### Champ par champ

| Champ | Contenu | Règle |
| --- | --- | --- |
| `version` | `1` | facultatif |
| `creer_si_absent` | `true` : crée la fiche si aucune ne correspond | exige `lead.entreprise` ; jamais pour un numéro de la liste d'opposition |
| `source` | `colle`, `fichier`, `appel`, `notes_mac` | par défaut `appel` si `appel.externe_id`, sinon `colle` ; `appel` exige `appel.externe_id` |
| `lead.id` | l'identifiant (uuid) de la fiche | s'il est donné, seul critère (pas de repli) |
| `lead.telephone` | le numéro tel que dit ou noté | rapproché par ses 9 derniers chiffres (téléphone et mobile) |
| `lead.entreprise` | le nom de l'entreprise | casse, accents et ponctuation ignorés ; 200 caractères au plus |
| `lead.ville`, `lead.dirigeant` | ce qui a été appris | ne remplissent la fiche que si ces champs y sont vides |
| `appel.debut` | début de l'appel, ISO 8601 **avec fuseau** | obligatoire sans `externe_id` ; jamais dans le futur |
| `appel.duree_s` | durée en secondes | entier de 0 à 86400, ou `null` |
| `appel.externe_id` | l'identifiant de l'appel chez le fournisseur | lettres, chiffres, `_ . : -`, 80 au plus |
| `appel.fournisseur` | `onoff`, `aircall`, `ringover`, `softphone`, `telephone` | par défaut celui de `config.telephonie` |
| `transcription[]` | `{ "locuteur": "appelant" ou "prospect", "texte": "…" }`, dans l'ordre | 4000 caractères par énoncé, 5000 énoncés, 200 000 caractères au total |
| `extraction.issue` | **obligatoire** : un code de `config.issues` | exemple : `pas_repondu`, `messagerie`, `standard`, `a_rappeler`, `rdv_fixe`, `pas_interesse`, `hors_cible`, `ne_plus_contacter`, `sous_contrat` |
| `extraction.objection` | un code de `config.objections`, `libre`, ou `null` | exemple : `pas-le-temps`, `assez-de-travail`, `deja-une-agence`, `envoyez-un-mail`, `combien-ca-coute`, `plateformes-suffisent`, `libre` |
| `extraction.objection_texte` | l'objection dans ses mots (utile avec `libre`) | 400 caractères au plus ; exige `objection` |
| `extraction.interet` | intérêt de 0 (aucun) à 3 (fort) | entier, ou `null` s'il ne se voit pas clairement |
| `extraction.decideur_joint` | le décideur était-il au bout du fil | `true`, `false` ou `null` |
| `extraction.resume` | deux ou trois phrases | 600 caractères au plus |
| `extraction.douleurs[]` | ce qui lui coûte, la principale d'abord | 10 au plus, 400 caractères chacune |
| `extraction.croyances[]` | ce qu'il croit vrai sur son marché | 10 au plus, 300 caractères chacune |
| `extraction.citations[]` | ses phrases, **mot pour mot**, la plus parlante d'abord | 10 au plus, 300 caractères chacune, vérifiées dans la transcription |
| `extraction.prochaine_etape` | `{ "type", "date", "detail" }` ou `null` | `type` : `rdv`, `rappel`, `mail`, `aucune`, `autre` ; un `rappel` a une `date` (ISO avec fuseau) ; `detail` 300 caractères |
| `extraction.tags[]` | des codes courts | minuscules, chiffres, `-` ou `_`, 40 caractères ; 10 au plus, 400 caractères au total |
| `extraction.<champ>` | une réponse de découverte, dans ses mots | les `id` de `config.debrief.champs`, puis ceux de `config.script.questions` ; texte de 600 caractères au plus, `""` ou `null` si non dit |
| `verdict_accroche` | comment l'accroche a été reçue | `utile`, `neutre`, `contre-productive` ou `null` |

Les champs de découverte de la niche d'exemple : `source_clients` (D'où viennent ses clients aujourd'hui ?), `chantiers_voulus`,
`frein_principal`, `zone` (config.debrief.champs), puis `capacite` (une question du script). Un champ de la config ne peut pas porter un
nom réservé du débrief (`issue`, `tags`, `citations`…) : le script le signale.

Le verdict de l'accroche est gardé en base sous un autre nom : `utile` devient `accroche`, `neutre` reste `neutre`,
`contre-productive` devient `rejet` (colonne `retours_marche.accroche_verdict`). La page `/retours` affiche « Utile », « Neutre »,
« Contre-productive ».

## Ce que le script écrit (une transaction)

| Où | Quoi |
| --- | --- |
| `debriefs` | une ligne : `source`, l'appel s'il est en base (`appel_id`), la date de l'appel, l'extraction complète (`extraction`, clés stables lues par le bloc « Appels transcrits » de la fiche), les tags en mots-clés, et la transcription en texte (« Appelant : … », « Prospect : … ») **seulement si elle peut être gardée** (voir plus bas) |
| `retours_marche` | une ligne liée au débrief : issue, la douleur principale, l'objection (code et mots), le verdict de l'accroche, l'intérêt, décideur joint, la citation principale, les tags. Elle nourrit la page `/retours` et le skill `ajuster-script` |
| `lead_activities` | une note datée au journal de la fiche, au gabarit « clé : valeur » (une ligne par information dite : issue, objection, intérêt, décideur, accroche, chaque champ de découverte, douleurs, croyances, citations, prochaine étape, résumé, tags), 5000 caractères au plus. Avec `--issue`, c'est l'activité « appel » de `enregistrer_issue` qui porte cette note |
| `leads` | **seulement les champs vides** : `qualification.<champ>` (clé = id du champ de découverte, comme les réponses aux questions du script), `objection`, `dirigeant`, `ville`. Un champ rempli n'est jamais écrasé ; le compte rendu dit lesquels ont été remplis et lesquels étaient déjà là |

Exemple de note datée (fictive) :

```text
Débrief de l'appel du 9 nov. 2026 à 15 h 20 (transcription collée)
Issue : À rappeler
Objection : Je n'ai pas le temps
Intérêt : 2/3
Décideur joint : oui
Accroche : utile
D'où viennent ses clients aujourd'hui : Bouche-à-oreille, un peu les plateformes
Douleurs : Demandes trop loin de sa zone
Citation : « Les plateformes m'envoient des demandes à quarante kilomètres, je ne peux pas suivre. »
Prochaine étape : rappel le 12 nov. 2026 à 10 h 00
Résumé : Gérant joint, intéressé par des demandes plus proches ; à rappeler jeudi.
Tags : plateformes, distance
```

Sans `--issue`, le statut ne bouge pas (l'issue est sans doute déjà notée au Poste), sauf « ne plus contacter », toujours enregistrée
comme au Poste (`enregistrer_issue`) ; l'issue reste dans le débrief et dans `retours_marche`.

## La fiche : comment elle est retrouvée

Parmi les fiches **visibles du compte** (RLS) : par `lead.id` (sans repli s'il est donné), sinon par le téléphone (9 derniers chiffres, sur
le téléphone et le mobile), sinon par le nom d'entreprise (casse, accents et ponctuation ignorés). Avec `appel.externe_id` et sans `lead`,
c'est la fiche de l'appel ; si le JSON désigne une autre fiche que celle de l'appel, le script s'arrête.

- **Plusieurs fiches** : arrêt (code 2) ; le script donne le nombre de candidates et, pour chacune, son identifiant, son statut et le jour de
  sa dernière activité (ni nom, ni ville, ni numéro). Mettre le bon `lead.id` et relancer.
- **Aucune fiche** : arrêt (code 2), avec les fiches au nom proche s'il y en a ; mettre `lead.id`, ou `"creer_si_absent": true` si
  l'utilisateur confirme que la fiche n'existe pas (la fiche créée porte la source datée `debrief`).

## Transcription : quand elle est gardée

- **Débrief lié à un appel en base** (`appel.externe_id`) : la transcription n'est gardée que si l'appel est **conservable**, c'est-à-dire
  si l'équipe a activé l'enregistrement complet (Réglages, avec l'annonce acceptée) **et** si l'annonce d'enregistrement a été lue au
  Poste ou jouée par le fournisseur pour CET appel. C'est la base qui le garantit : le déclencheur `debriefs_verifier_appel` refuse
  (erreur `42501`) tout débrief lié à un appel non conservable qui porte une transcription, même écrit à la main. Le script le voit avant
  (fonction `appel_conservable`) et écrit alors le débrief **sans** transcription, en le disant (« transcription non gardée : appel non
  conservable »). Le reste (extraction, retour du marché, note, fiche) est écrit normalement. `lire-appel.mjs` refuse aussi de sortir la
  transcription d'un appel devenu non conservable.
- **Transcription collée, fichier, Notes du Mac** (sans appel en base) : elle est gardée, sous la responsabilité de l'équipe. Un appel ne
  s'enregistre qu'après l'avoir annoncé au prospect (article 226-1 du Code pénal, recommandations de la CNIL). `--sans-transcription` ne
  garde que l'extraction.

## Bornes (celles de la base)

Un texte trop long est **refusé**, jamais coupé (une citation coupée ne serait plus mot pour mot) : citation 300 caractères, douleur et
objection 400, champ de découverte 600, résumé 600, détail de la prochaine étape 300, 10 tags (400 caractères au total), énoncé de
transcription 4000 caractères, 5000 énoncés, 200 000 caractères au total, note du journal 5000 caractères (elle, raccourcie d'un « … »).
