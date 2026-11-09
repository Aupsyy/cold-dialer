# Sécurité

## Signaler une faille

Passe par le **signalement privé de GitHub** (« Private vulnerability reporting ») : onglet **Security** du dépôt, puis **Report a
vulnerability**. Le signalement reste privé entre toi et les mainteneurs jusqu'à la publication d'un correctif. Il n'y a pas d'adresse
e-mail de sécurité : n'ouvre pas d'issue publique, et ne publie aucun détail (ni preuve de concept, ni message sur un réseau social)
avant le correctif.

Dans ton signalement :

- ce que tu as trouvé, la version (le commit) et les étapes pour le reproduire sur une instance **de test** ;
- l'impact que tu vois (qui peut lire ou écrire quoi) ;
- **aucune donnée réelle** : ni fiche de prospect, ni numéro, ni e-mail, ni secret, ni adresse d'une instance en service. Utilise les
  données fictives du dépôt (`supabase/seed-demo.sql`) et des secrets tirés pour l'occasion.

Délai **indicatif**, sans engagement : un accusé de réception visé sous 7 jours, puis un point sur l'analyse et le correctif. Une faille
grave passe avant tout le reste.

## Ce qui est dans le périmètre

- **Les webhooks** (`/api/telephonie/<fournisseur>/webhook`, `/api/agenda/<fournisseur>/webhook`) : contournement de l'authentification
  (jeton, secret, signature Calendly, comparaison en temps constant), rejeu qui écrit deux fois, corps qui fait écrire hors de l'équipe.
- **Les tâches planifiées** (`/api/telephonie/recuperation`, `/api/agenda/google/sync`) : appel sans `CRON_SECRET`.
- **La base** : une règle d'accès (RLS) qui laisse un rôle (`appelant`, `membre`, `proprietaire`) lire ou modifier ce qu'il ne doit pas ;
  une fonction `SECURITY DEFINER` détournable ; une inscription sans invitation valide ; l'enregistrement d'un appel gardé sans
  l'annonce.
- **Les secrets et les journaux** : une valeur de secret, une donnée de prospect ou un message d'erreur détaillé qui sort dans une
  réponse, un journal de Vercel, la sortie d'un script ou le navigateur ; la clé service atteignable côté navigateur.
- **Les scripts** (`scripts/`) : un script qui affiche une donnée ou un secret, écrit sans `--appliquer`, ou lit une adresse interne
  (le crawl des sites refuse les adresses IP et les hôtes du réseau local).
- **Le flux ICS** (`/api/agenda/ics/<jeton>`) : un flux lisible sans son jeton, ou qui sort un e-mail ou un numéro.

## Ce qui n'est pas une faille du projet

- La configuration de l'instance par son équipe : une clé service collée dans une variable `NEXT_PUBLIC_…`, un secret partagé dans une
  capture ou un message, un `.env.local` envoyé dans un dépôt, un mot de passe faible, une invitation transmise à la mauvaise personne.
- Les réglages des services : la protection des déploiements de Vercel, l'accès au projet Vercel ou Supabase donné à trop de monde, un
  projet Supabase mis en pause.
- Les failles d'un fournisseur tiers (Onoff, Aircall, Ringover, Calendly, iClosed, Google, Supabase, Vercel) : signale-les chez lui.
- Les limites déjà écrites dans le README et la documentation (par exemple : le secret d'iClosed et de Ringover est dans l'adresse du
  webhook, donc visible dans les journaux de requêtes de Vercel).

Une erreur de configuration que la documentation explique mal reste utile à signaler : ouvre alors une issue ordinaire, sans aucune
donnée réelle.
