---
name: debrief
description: Après un appel de prospection, lit la transcription (collée, fichier, appel déjà transcrit en base par le fournisseur de téléphonie, ou app Notes du Mac), en extrait ce que le prospect a dit selon docs/debrief.md et les codes de config/niche.json (issue, objection, intérêt, douleurs, citations mot pour mot, prochaine étape, champs de découverte), l'écrit en base par scripts/debrief/ecrire.mjs en essai d'abord, puis rend compte en 5 lignes. À utiliser quand l'utilisateur dit « débrief », « débriefe l'appel », « débrief de l'appel avec Atelier Démo 07 », « range la transcription », « remplis la fiche après l'appel ». Pas pour poser un rendez-vous (le Poste ou l'agenda le font), ni pour changer le script (skill ajuster-script).
---

# Débriefer un appel : de la transcription à la fiche

## But

Chaque appel nourrit la base : la fiche du prospect reçoit ce qu'il a dit (sans rien inventer), la page `/retours` et le skill
`ajuster-script` reçoivent un retour du marché. Il n'y a aucune clé d'IA dans l'application : l'extraction, c'est toi (Claude Code) ;
les scripts ne font que la tuyauterie, sous l'identité du compte qui a appelé.

## Entrées

- La transcription, de l'une de ces quatre sources :
  - **collée** dans la conversation par l'utilisateur ;
  - **un fichier** (export texte de son outil) ;
  - **un appel déjà transcrit en base**, reçu par le webhook du fournisseur de téléphonie (Onoff, Aircall…) ;
  - **l'app Notes du Mac** (macOS seulement : l'app Téléphone y range la transcription d'un appel enregistré).
- Ce que l'utilisateur précise pour retrouver la fiche : le nom de l'entreprise, le numéro appelé, ou l'identifiant de la fiche.
- Le compte qui a appelé (son e-mail de connexion, ou son e-mail chez le fournisseur de téléphonie), obligatoire si l'équipe a
  plusieurs comptes.
- Le schéma et les règles : `docs/debrief.md` ; les codes permis : `config/niche.json` (`issues`, `objections`, `debrief.champs`,
  `script.questions`). Lis-les à la première utilisation de la session.
- La base : `SUPABASE_DB_URL` dans `.env.local` (posée par l'utilisateur, avec `SUPABASE_DB_CA` pour une base distante), lue par
  les scripts seuls ; tu ne l'ouvres jamais.

## Étapes

Dossier de travail : le **scratchpad** de ta session (hors de tout dépôt ; les scripts refusent un dossier suivi par git).
`<scratchpad>` ci-dessous désigne son chemin complet.

1. **La transcription dans le scratchpad**, selon la source :
   - collée : écris-la telle quelle dans `<scratchpad>/transcription.txt` ;
   - fichier : copie-le dans le scratchpad ;
   - appel en base : `node scripts/debrief/lire-appel.mjs --liste` (date, durée, statut, fournisseur, `externe_id`, conservable ;
     `--jours N`, `--appelant <e-mail ou id>`), puis `node scripts/debrief/lire-appel.mjs --externe-id <id> <scratchpad>` (avec
     `--fournisseur <f>` si besoin). Refusé si l'appel n'est pas conservable : passe alors par une autre source ou débriefe sans
     transcription ;
   - Notes du Mac : `node scripts/debrief/notes-mac.mjs --liste` (rang, date, taille, « appel ? » ; `--n 5`), puis
     `node scripts/debrief/notes-mac.mjs --derniere <scratchpad>` ou `node scripts/debrief/notes-mac.mjs --rang <n> <scratchpad>`.
     Si la note n'a presque pas de texte (transcription seulement dans l'audio) : demande à l'utilisateur, dans Notes, « Copier la
     transcription », puis `node scripts/debrief/notes-mac.mjs --presse-papiers <scratchpad>`.
2. **Relis** `docs/debrief.md` et les codes de `config/niche.json` si ce n'est pas fait.
3. **Écris `<scratchpad>/debrief.json`** selon le schéma de `docs/debrief.md` :
   - `source` (`colle`, `fichier`, `appel`, `notes_mac`) ; `lead` (ce qui retrouve la fiche) ou `appel.externe_id` pour un appel en
     base ; `appel.debut` en ISO 8601 **avec fuseau** (sans `externe_id`) ;
   - `transcription` : les énoncés `{"locuteur": "appelant" | "prospect", "texte": "…"}`, dans l'ordre (`[]` pour un appel en base :
     le script reprend la sienne) ;
   - `extraction` : `issue` (obligatoire), `objection` et `objection_texte`, `interet` (0 à 3, seulement s'il se voit clairement),
     `decideur_joint`, `resume`, `douleurs`, `croyances`, `citations`, `prochaine_etape`, `tags`, et les champs de découverte de la
     config ; ce qui n'a pas été dit reste vide (`null`, `""`, `[]`) ;
   - `verdict_accroche` : `utile`, `neutre`, `contre-productive` ou `null`.
4. **L'essai** (tout est contrôlé par la base, puis annulé) :

   ```bash
   node scripts/debrief/ecrire.mjs <scratchpad>/debrief.json --appelant <e-mail ou id>
   ```

   - JSON refusé (code 1) : corrige-le (le message donne les codes permis, jamais la valeur fautive), relance l'essai ;
   - **plusieurs fiches** (code 2) : montre à l'utilisateur les candidates (identifiant, statut, jour de la dernière activité), mets le
     bon `lead.id`, relance ;
   - **aucune fiche** (code 2) : mets `lead.id` s'il le connaît, ou `"creer_si_absent": true` seulement s'il confirme que la fiche
     n'existe pas.
5. **L'issue** : demande à l'utilisateur si l'issue de cet appel est déjà notée au Poste. Sinon, ajoute `--issue` (elle est alors
   enregistrée comme au Poste : statut, tentatives, rappel, opposition pour `ne_plus_contacter`). Jamais pour un rendez-vous : `rdv_fixe`
   est refusé avec `--issue`, le rendez-vous se pose au Poste ou dans l'agenda. « Ne plus contacter » est toujours enregistrée par
   `enregistrer_issue` (statut et liste d'opposition), même sans `--issue`, sauf si la fiche l'est déjà : dis-le à l'utilisateur.
6. **L'écriture** (une transaction : tout ou rien), après un essai sans erreur :

   ```bash
   node scripts/debrief/ecrire.mjs <scratchpad>/debrief.json --appelant <e-mail ou id> --ecrire
   ```

   avec `--issue` si l'étape 5 l'a décidé, et `--sans-transcription` si l'utilisateur ne veut garder que l'extraction.
7. **Le compte rendu en 5 lignes** :
   1. Fiche : trouvée par … (identifiant, téléphone, nom) ou créée ;
   2. Douleur principale : … (ou « aucune dite ») ;
   3. Objection : son libellé, ou « aucune » ;
   4. Citation : « … » (la plus parlante) ;
   5. Prochaine étape : … (un rendez-vous : « pose-le au Poste ou dans l'agenda »).
   Dis aussi si la transcription n'a pas été gardée (appel non conservable) et quels champs de la fiche étaient déjà remplis.
8. **Le ménage** : supprime la transcription et `debrief.json` du scratchpad.

## Garde-fous

- **Rien d'inventé** : ce que le prospect n'a pas dit reste vide ; un intérêt ne se note que s'il se voit ; un résumé reformule sans
  ajouter.
- **Citations mot pour mot**, copiées de ce que le **prospect** a dit (jamais une phrase de l'appelant), 300 caractères au plus ; le
  script les vérifie dans la transcription.
- **Codes de la config seulement** ; ne modifie jamais la config pour faire passer un débrief.
- **Essai d'abord**, `--ecrire` ensuite ; `--issue` seulement si l'issue n'est pas déjà notée au Poste.
- La transcription et le JSON ne vivent que dans le scratchpad, puis sont supprimés : jamais dans un dépôt, un commit, un rapport ou
  un fichier partagé. Jamais ouvrir `.env*` ni afficher l'adresse de la base.
- Rien n'est envoyé au prospect : ni message, ni e-mail.

## Sortie

- En base (une transaction) : une ligne `debriefs` (l'extraction, la transcription seulement si elle peut être gardée), une ligne
  `retours_marche` (issue, douleur principale, objection, verdict de l'accroche, intérêt, décideur joint, citation, tags), une note
  datée au journal de la fiche (« Débrief de l'appel du … »), et les champs **vides** de la fiche remplis (réponses de découverte dans
  `qualification`, objection, dirigeant, ville) ; un champ déjà rempli n'est jamais écrasé.
- Visible dans le bloc « Appels transcrits » de la fiche et dans la page `/retours` ; le verdict de l'accroche y apparaît comme
  « Utile », « Neutre » ou « Contre-productive ».
- Le compte rendu en 5 lignes. Codes de sortie du script : `0` essai ou écriture réussis, `1` JSON refusé ou erreur de la base (code
  SQL seulement), `2` arrêt (fiche, appel ou compte à préciser).

## Pièges connus

- **Appel non conservable** (enregistrement complet désactivé, ou annonce non lue pour cet appel) : la base refuse un débrief lié à cet
  appel qui porterait une transcription (erreur `42501`). Le script le voit avant et écrit le débrief **sans** transcription, en le
  disant ; `lire-appel.mjs` refuse aussi de sortir sa transcription.
- `appel.debut` sans fuseau, ou dans le futur : refusé. Un texte trop long est refusé, jamais coupé (bornes dans `docs/debrief.md`).
- Si le JSON désigne une autre fiche que celle de l'appel en base, le script s'arrête : garde `lead` à `null` pour un appel en base.
- `notes-mac.mjs` ne marche que sur macOS ; macOS demande une fois l'autorisation d'accès à Notes. Ailleurs : la transcription collée.
- Un `debrief.json` posé dans un dépôt git est refusé sans être lu (code 1) : écris-le dans le scratchpad.
- Les scripts du débrief n'ont pas d'aide intégrée : lancés sans argument valable, ils affichent leur usage (code 1).
- Un champ de découverte ne peut pas porter un nom réservé du débrief (`issue`, `tags`, `citations`…) : le schéma de la config le
  refuse.
