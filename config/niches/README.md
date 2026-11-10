# Les niches prêtes

Dix métiers B2B français, locaux, joignables par téléphone, dont le dirigeant décide seul. Chaque fichier `<code>.json` de ce dossier est
un préréglage de la partie « marché » de `config/niche.json` : la cible, les codes NAF du registre SIRENE, les mots-clés Google, la grille de
score, les questions de découverte, les objections courantes, les exemples d'accroche et le débrief. Le préréglage ne contient pas ton offre,
ta marque, tes outils d'appel et d'agenda, ni ton texte légal : ce sont les tiens, tu les écris toi-même.

```bash
node scripts/niche/lister.mjs                                   # les niches prêtes
node scripts/niche/appliquer.mjs paysagistes --essai            # ce qui changerait, sans rien écrire
node scripts/niche/appliquer.mjs paysagistes --departements 69,38
node scripts/niche/naf.mjs piscine                              # pour une niche qui n'est pas dans la liste : des codes NAF
```

Le skill `choisir-niche` pose quelques questions, propose deux ou trois niches qui collent et fait ces commandes avec toi.

| Code | Métier | Codes NAF | Taille visée | Pourquoi cette niche se prête au téléphone |
|---|---|---|---|---|
| `agences-immobilieres` | Agences immobilières indépendantes | `68.31Z` | 2 à 15 salariés | Le dirigeant d'une agence indépendante répond au téléphone par réflexe, car chaque appel peut être un vendeur. Il vit du mandat de vente : il sait ce que lui coûte un mandat confié à un concurrent. |
| `cabinets-dentaires` | Cabinets dentaires | `86.23Z` | 2 à 20 salariés | Le chirurgien-dentiste titulaire dirige son cabinet et son équipe, donc décide seul. Ses patients choisissent souvent après une recherche locale. L'accès passe par l'assistante : l'appel doit être court, poli et préparé. |
| `cuisinistes` | Cuisinistes | `47.59A`, `31.02Z` | 2 à 15 salariés | Un projet de cuisine commence presque toujours par une recherche locale et un rendez-vous en magasin : le gérant sait ce que lui coûte un showroom vide. L'achat est réfléchi, donc le panier moyen supporte une prestation de visibilité. |
| `experts-comptables` | Cabinets d'expertise comptable | `69.20Z` | 3 à 25 salariés | L'associé dirigeant est joignable mais souvent filtré par un accueil : l'appel doit bien passer le standard. Le besoin de nouveaux clients est constant, et un client reste longtemps, ce qui justifie un investissement. |
| `garages-controle-technique` | Garages indépendants et centres de contrôle technique | `45.20A`, `71.20A` | 2 à 15 salariés | Le patron est dans l'atelier ou à l'accueil : un appel court avec une question concrète passe. Ses clients sont locaux et reviennent chaque année, donc la visibilité de proximité fait directement entrer des clients. |
| `menuisiers-agenceurs` | Menuisiers et agenceurs | `43.32A`, `43.32C`, `16.23Z` | 2 à 20 salariés | Le dirigeant est le plus souvent artisan et commercial : il décroche, parle de ses réalisations avec plaisir. Les projets sur mesure ont un panier suffisant et leur qualité se voit en photos sur le site. |
| `paysagistes` | Paysagistes | `81.30Z` | 2 à 20 salariés | Le gérant est souvent sur un chantier mais décroche, et la saison crée des creux qu'il veut combler ; le besoin se voit de l'extérieur (réalisations en ligne, fiche locale). |
| `pisciniers` | Pisciniers | `43.99D` | 2 à 20 salariés | Un projet de piscine est un gros achat, préparé longtemps à l'avance par une recherche locale et des devis comparés : être visible au bon moment compte. Le dirigeant est aussi le commercial et reste joignable. |
| `renovation-energetique` | Entreprises de rénovation énergétique | `43.29A`, `43.22B` | 3 à 30 salariés | Le dirigeant d'une entreprise d'isolation ou de chauffage est joignable, et le besoin de demandes qualifiées est ouvertement discuté dans le métier, où les clients comparent beaucoup. Le panier des chantiers est élevé. |
| `traiteurs-evenementiels` | Traiteurs événementiels | `56.21Z` | 2 à 20 salariés | Le dirigeant est aussi le chef commercial : il répond car chaque appel peut être un mariage ou un séminaire. La demande est visible en ligne (galeries, avis), et le panier moyen d'un événement est élevé. |

## Ce que ces préréglages ne disent pas

- **Aucun chiffre de marché** : ni nombre d'entreprises, ni taux de réponse, ni taux de rendez-vous. Pour le volume réel d'une niche dans ta
  zone, lance `node scripts/niche/volume.mjs <code>` (il appelle le registre public en mode essai).
- **Les codes NAF sont ceux de la nomenclature rév. 2 de l'INSEE**, mais un code ne dit pas tout : `47.59A` (commerce de détail de meubles)
  et `43.99D` (autres travaux spécialisés de construction) couvrent aussi d'autres métiers que les cuisinistes et les pisciniers ; le
  préréglage ajoute donc un filtre sur le nom de l'entreprise (`motsNomInclure`). `43.29A` et `43.22B` mêlent l'isolation, le chauffage
  et la climatisation. `45.20A` et `71.20A` rassemblent deux activités voisines (garage, contrôle technique). Contrôle toujours le volume
  annoncé avant de récolter.
- **Les codes de catégorie juridique** de la grille de score (`5485` et `5785` pour les sociétés d'exercice libéral) sont à vérifier dans la
  nomenclature de l'INSEE si tu changes la grille.
- **Les textes sont des exemples** de ce qu'on dit à un dirigeant du métier (vouvoiement, sans promesse de résultat ni chiffre, contrôlés par
  `config/garde-fous.ts`). Relis-les à voix haute, adapte-les à ton offre, puis lance `npm test`.
- **Ta niche n'est pas dans la liste ?** `node scripts/niche/naf.mjs <mots>` propose des codes NAF ; le skill `choisir-niche` en fait un
  préréglage sur mesure avec toi.
