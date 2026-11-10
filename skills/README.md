# Les skills Claude Code

Huit skills accompagnent le dépôt. Un skill est un dossier avec un fichier `SKILL.md` : des consignes que Claude Code suit quand ta
demande correspond à sa description. Ils lancent les scripts du dépôt (`node scripts/…`), toujours en essai avant d'écrire en base, et
ne montrent que des compteurs.

| Skill | Ce qu'il fait |
|---|---|
| `demarrer` | Le parcours complet pour un débutant : il regarde où tu en es et t'emmène d'un skill à l'autre, de la niche au premier bloc d'appels. |
| `choisir-niche` | Sept questions, puis deux ou trois niches proposées parmi dix niches prêtes (`config/niches/`) ou une niche sur mesure ; règle la cible, les codes du registre et la grille de score. |
| `construire-offre` | Remplit la fiche d'offre (`docs/offre.md`), écrit le bloc `offre` de la config, puis un premier script et des objections (`docs/scripts-de-base.md`). |
| `installer` | Pose les questions (toi, l'offre, la cible, le script, les outils, le légal), écrit `config/niche.json` et guide l'installation complète (GitHub, Supabase, Vercel, secrets, vérification, compte propriétaire). |
| `sourcer-leads` | Trouve les entreprises de la cible dans des sources publiques, les complète, les note, puis les importe dans le Poste (simulation d'abord). |
| `accroches` | Écrit la première phrase de l'appel de chaque fiche, tirée du site de l'entreprise, contrôlée mot à mot puis relue avant l'écriture en base. |
| `debrief` | Après un appel, range ce que le prospect a dit (transcription, objection, citations, prochaine étape) dans sa fiche, et rend compte en 5 lignes. |
| `ajuster-script` | Lit les retours du marché (page `/retours`) et propose un changement du script dans `config/niche.json`, testé et commité sur une branche. |

## Les rendre visibles dans Claude Code

Claude Code lit les skills dans deux endroits : `~/.claude/skills/` (pour toutes tes sessions) et `.claude/skills/` à la racine d'un
projet (seulement dans ce projet). Il les charge au démarrage d'une session.

**L'installateur** sert avant que ton propre dépôt existe : lie-le pour toutes tes sessions, depuis une copie locale du dépôt modèle.

```bash
mkdir -p ~/.claude/skills
ln -s "<chemin du dépôt modèle>/skills/installer" ~/.claude/skills/installer
```

**Les sept autres skills** ne servent que dans ton dépôt (ils lancent ses scripts depuis sa racine) : lie-les dans son
`.claude/skills/`, une fois l'installation faite. Depuis la racine de ton dépôt :

```bash
mkdir -p .claude/skills
for s in demarrer choisir-niche construire-offre sourcer-leads accroches debrief ajuster-script; do ln -s "../../skills/$s" ".claude/skills/$s"; done
```

Le lien est relatif : il suit le dépôt si tu le déplaces. Pour qu'ils servent aussi ailleurs, lie-les plutôt dans `~/.claude/skills/`
avec leur chemin complet, comme l'installateur.

**Sans lien symbolique** (Windows, ou par préférence) : copie les dossiers (`cp -r skills/debrief .claude/skills/debrief`, ou par
l'explorateur de fichiers). Une copie ne suit pas les mises à jour du dépôt : recopie-la après une mise à jour.

**Un nom déjà pris** : si un skill du même nom existe déjà dans `~/.claude/skills/`, garde celui du dépôt dans le `.claude/skills/` du
projet plutôt que de remplacer l'autre.

Le dossier `skills/accroches/` contient aussi `consigne.md`, le modèle de consigne que les scripts remplissent depuis la config : il
doit rester à côté de son `SKILL.md` (le lien vers le dossier l'emporte avec lui).

## Les règles communes

- **Aucune clé ne passe par la conversation.** Les skills ne demandent, ne lisent, n'affichent ni n'écrivent jamais une clé, un jeton
  ou un mot de passe ; ils n'ouvrent jamais `.env*`. Les valeurs se collent par toi dans le tableau de bord de Vercel ou dans
  `.env.local`, ou sont posées par `scripts/install/secrets.mjs` sans être affichées. Aucune clé d'API d'IA n'est nécessaire : c'est
  Claude Code qui écrit les accroches et les débriefs.
- **Essai d'abord** : tout ce qui écrit en base passe par une simulation, puis attend ton accord explicite.
- **Des compteurs seulement** : aucune donnée de prospect dans la conversation au-delà de ce que le skill annonce, ni dans un commit,
  un rapport ou un fichier partagé.
- **Rien n'est envoyé aux prospects** : ni e-mail, ni SMS, ni appel automatique.
- **Aucune promesse de résultat** : ni dans la config, ni dans ce que disent les skills.
