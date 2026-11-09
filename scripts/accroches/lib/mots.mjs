// Les listes de mots des accroches, toutes NORMALISÉES (minuscules, sans accents : voir lib/texte.mjs, normaliser).
// Les listes propres à une niche viennent de la config : config.accroche.motsIndices (ce qu'on cherche sur les sites) et
// config.accroche.interdits (ce qu'une accroche ne dit jamais), qui s'AJOUTENT à celles-ci.

/** Mots qui signalent une phrase utile sur un site (compact.mjs), quelle que soit la niche. Comparés par famille de mots. */
export const INDICES_PAR_DEFAUT = [
  "projet", "realisation", "realise", "realisee", "chantier", "renovation", "renove", "renovee", "creation", "concu", "conception",
  "amenagement", "amenage", "construction", "construit", "restauration", "restaure", "agence", "atelier", "entreprise", "societe",
  "equipe", "collaborateurs", "fonde", "fondee", "fondateur", "fondatrice", "creee", "depuis", "specialise", "specialisee",
  "specialiste", "specialite", "savoir faire", "experience", "expertise", "famille", "familiale", "generation", "artisan", "artisanale",
  "passion", "passionne", "intervenons", "intervient", "intervention", "secteur", "region", "departement", "label", "labellise",
  "certifie", "certification", "qualifie", "qualification", "agree", "membre", "trophee", "concours", "reference", "portfolio",
];

/**
 * Les mots courants d'une accroche : ils n'ont pas à figurer sur le site (articles, pronoms, verbes et noms de la formule : « j'ai vu
 * sur votre site », « c'est le type de chantier que vous voulez développer ? »). Tout autre mot de l'accroche (lieu, nom, matériau,
 * spécialité, nombre, année…) DOIT figurer dans le texte compacté du site. Les adjectifs qui affirment un fait (taille, nouveauté,
 * rang, quantité : grand, petit, nouveau, dernier, récent, principal, plusieurs, nombreux, régulier…) n'en font PAS partie : ils
 * doivent être sur le site, comme le reste.
 */
export const MOTS_COURANTS = new Set(
  `
  le la les l un une des du de d au aux a en dans sur sous pour par avec sans chez vers entre contre parmi selon et ou ni mais donc or
  car que qu qui quoi dont ce cet cette ces c ca cela ceci celui celle ceux celles se s son sa ses leur leurs votre vos notre nos mon ma
  mes ton ta tes il ils elle elles on nous vous je j me m te t lui y ne n pas plus moins tres bien aussi encore deja toujours souvent
  parfois jamais ici tout tous toute toutes autre autres meme memes quel quelle quels quelles comme si alors ainsi puis ensuite aujourd
  hui maintenant bientot tant tellement trop peu beaucoup assez vraiment surtout notamment davantage plutot environ presque seulement
  uniquement egalement certainement particulierement precisement visiblement apparemment clairement justement comment pourquoi combien
  quand est es sont sommes etes etait etaient ete etre ai as avons avez ont avait avaient avoir eu aurait auriez aura aurez serait
  seriez sera serez fait faire faites font fais faisons faut faudrait peut peux pouvez pourriez pouvait voulez veux voudriez vouliez
  voulu souhaitez souhaiteriez souhaite aimez aimeriez aimerais aime aimer adore apprecie appreciez vu voir vois voit voyez regarde
  regarder lu lire parcouru decouvert decouvrir remarque remarquer repere note noter trouve trouver retrouve semble semblez parait
  imagine pense crois suppose dit dire dites parle parler appelle appeler demande demander propose proposez proposer proposes proposee
  realise realisee realises realisees realisez realiser developpe developper developpez travaille travaillez travailler intervenez
  intervenir montre montrez montrent presente presentez mettez mettre mis cherchez chercher recevez recevoir acceptez prenez prendre
  pris occupez consacrez arrete attire frappe marque plu plait interesse interessez correspond represente fonde fondee cree creee
  site sites page pages rubrique section photo photos image images galerie realisation realisations projet projets chantier chantiers
  travail travaux activite activites metier metiers entreprise equipe type types genre part partie place priorite coeur specialite
  specialites savoir domaine domaines client clients demande demandes sujet question exemple facon maniere moment temps fois jour
  jours an ans depuis secteur zone coin offre offres service services prestation prestations intervention interventions mission
  missions chose choses cas idee envie besoin besoins choix cote suite important importante importants importantes beau bel belle
  beaux belles joli jolie jolis jolies divers diverses different differents differente differentes vrai vraie interessant
  interessante interessants interessantes oui non bonjour apres avant pendant lors via autant ensemble enfin sincerement franchement
  simplement directement rapidement actuellement plaisir curiosite curieux devine consulte visite tombe suis etais donne donner permet
  internet web connais connaissez echanger discuter minute minutes
`
    .split(/\s+/)
    .filter(Boolean),
);

/** Les mots qui suivent une préposition de lieu : « à Vienne », « en Isère », « près de Bron ». */
export const PREPOSITIONS_DE_LIEU = new Set(["a", "au", "aux", "en", "sur", "vers", "pres", "proche", "autour", "dans", "cote"]);

/** Promesses : jamais dans une accroche (s'ajoute aux motifs de config/garde-fous.ts). Mots exacts ou suites de mots. */
export const PROMESSES_DE_BASE = [
  "garanti", "garantie", "garanties", "garantis", "garantir", "garantit", "garantissons", "garantissent", "assure", "assuree", "assures",
  "assurees", "resultat", "resultats", "rentable", "rentables", "rentabilite", "rentabiliser", "chiffre d affaires", "booster", "boostez",
  "booste", "exploser", "explosez", "doubler", "doublez", "tripler", "triplez", "multiplier", "multipliez", "succes", "sans risque",
  "numero un", "numero 1", "n 1", "leader", "leaders", "meilleur", "meilleure", "meilleurs", "meilleures", "100 %",
];

/** Flatteries vides : jamais dans une accroche, même si le site les emploie. */
export const FLATTERIES = [
  "magnifique", "magnifiques", "superbe", "superbes", "sublime", "sublimes", "splendide", "splendides", "incroyable", "incroyables",
  "exceptionnel", "exceptionnelle", "exceptionnels", "exceptionnelles", "extraordinaire", "extraordinaires", "remarquable",
  "remarquables", "impressionnant", "impressionnante", "impressionnants", "impressionnantes", "genial", "geniale", "geniaux", "geniales",
  "fantastique", "fantastiques", "merveilleux", "merveilleuse", "merveilleuses", "parfait", "parfaite", "parfaits", "parfaites", "bravo",
  "felicitations", "felicitation", "epoustouflant", "epoustouflante", "bluffant", "bluffante", "top", "canon", "wow", "waouh",
  "sensationnel", "sensationnelle", "prodigieux", "admirable", "admirables",
];

/** Chiffres de résultat (sur le texte brut) : « + 30 % », « 500 € », « 3x », « 10 demandes », « 5 clients par mois »… */
export const CHIFFRES_DE_RESULTAT = [
  /\+\s*\d/u,
  /\d+(?:[.,]\d+)?\s*(?:%|€|k€|euros?(?![\p{L}])|x(?![\p{L}\d])|fois(?![\p{L}]))/iu,
  /\d+\s*(?:demandes?|devis|clients?|contrats?|ventes?|appels?|rdv|rendez-vous|leads?|prospects?|chantiers?)(?![\p{L}])/iu,
  /\d+\s+(?:[\p{L}'’-]+\s+){0,2}par\s+(?:jour|semaine|mois|an|année)(?![\p{L}])/iu,
];

/**
 * Superlatifs et rangs : une accroche qui les emploie (« le plus grand », « votre premier chantier », « votre dernier bassin ») ne passe
 * que si l'EXTRAIT de la page les contient aussi (mots exacts ou suites de mots) : c'est l'affirmation la plus facile à inventer.
 */
export const SUPERLATIFS = [
  "le plus", "la plus", "les plus", "plus grand", "plus grande", "plus grands", "plus grandes", "premier", "premiere", "premiers",
  "premieres", "dernier", "derniere", "derniers", "dernieres", "seul", "seule", "seuls", "seules", "unique", "uniques",
];
