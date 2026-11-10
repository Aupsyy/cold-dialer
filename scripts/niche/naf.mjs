// Propose des codes NAF (rév. 2) à partir de mots, pour une niche qui n'est pas dans les niches prêtes. Sans réseau : une petite table
// embarquée des codes les plus utiles en prospection B2B locale. La table n'est pas la nomenclature complète : un code qui n'y est pas
// peut exister ; vérifie toujours sur le site de l'INSEE (nomenclature NAF rév. 2) et avec `node scripts/sourcing/sirene.mjs fetch --essai`.
//
// Usage : node scripts/niche/naf.mjs <mots...> [--max N]      ex. : node scripts/niche/naf.mjs piscine
//         node scripts/niche/naf.mjs --tous                    la table entière

import { fileURLToPath } from "node:url";
import { ErreurNiche, lireArguments } from "./lib.mjs";

/** [code, libellé officiel (abrégé si très long), mots proches]. */
export const TABLE_NAF = [
  // Construction et second œuvre
  ["41.20A", "Construction de maisons individuelles", "constructeur maison pavillon"],
  ["41.20B", "Construction d'autres bâtiments", "promoteur bâtiment construction"],
  ["43.12A", "Travaux de terrassement courants et travaux préparatoires", "terrassement vrd"],
  ["43.21A", "Travaux d'installation électrique dans tous locaux", "électricien électricité photovoltaïque solaire panneaux domotique"],
  ["43.22A", "Travaux d'installation d'eau et de gaz en tous locaux", "plombier plomberie gaz sanitaire"],
  ["43.22B", "Travaux d'installation d'équipements thermiques et de climatisation", "chauffagiste chauffage pompe à chaleur climatisation chaudière"],
  ["43.29A", "Travaux d'isolation", "isolation combles thermique rénovation énergétique"],
  ["43.29B", "Autres travaux d'installation n.c.a.", "installation ascenseur store"],
  ["43.31Z", "Travaux de plâtrerie", "plâtrier plâtre cloisons"],
  ["43.32A", "Travaux de menuiserie bois et PVC", "menuisier menuiserie fenêtres portes escalier bois pvc"],
  ["43.32B", "Travaux de menuiserie métallique et serrurerie", "serrurier serrurerie métallerie fermetures"],
  ["43.32C", "Agencement de lieux de vente", "agenceur agencement magasin commerce"],
  ["43.33Z", "Travaux de revêtement des sols et des murs", "carreleur carrelage sol parquet revêtement"],
  ["43.34Z", "Travaux de peinture et vitrerie", "peintre peinture vitrier vitrerie"],
  ["43.39Z", "Autres travaux de finition", "finition travaux"],
  ["43.91A", "Travaux de charpente", "charpentier charpente"],
  ["43.91B", "Travaux de couverture par éléments", "couvreur couverture toiture zingueur"],
  ["43.99A", "Travaux d'étanchéification", "étanchéité étanchéification toiture terrasse"],
  ["43.99B", "Travaux de montage de structures métalliques", "structure métallique charpente métallique"],
  ["43.99C", "Travaux de maçonnerie générale et gros œuvre de bâtiment", "maçon maçonnerie gros œuvre"],
  ["43.99D", "Autres travaux spécialisés de construction", "piscine piscinier spa travaux spécialisés façade ravalement échafaudage"],
  ["16.23Z", "Fabrication de charpentes et d'autres menuiseries", "menuiserie fabrication charpente escalier atelier bois"],
  ["31.02Z", "Fabrication de meubles de cuisine", "cuisine cuisiniste meubles de cuisine"],
  ["31.01Z", "Fabrication de meubles de bureau et de magasin", "mobilier bureau magasin"],
  ["47.59A", "Commerce de détail de meubles", "meubles mobilier cuisiniste magasin de meubles"],
  ["47.59B", "Commerce de détail d'autres équipements du foyer", "équipement maison électroménager"],
  // Extérieur, entretien, sécurité
  ["81.30Z", "Services d'aménagement paysager", "paysagiste jardin jardinier espaces verts élagage"],
  ["81.21Z", "Nettoyage courant des bâtiments", "nettoyage ménage entretien locaux"],
  ["81.22Z", "Autres activités de nettoyage des bâtiments et nettoyage industriel", "nettoyage industriel vitres"],
  ["80.10Z", "Activités de sécurité privée", "sécurité gardiennage surveillance"],
  ["71.12B", "Ingénierie, études techniques", "bureau d'études ingénierie ingénieur"],
  ["71.20B", "Analyses, essais et inspections techniques", "diagnostic contrôle inspection essais"],
  // Automobile
  ["45.11Z", "Commerce de voitures et de véhicules automobiles légers", "concession voiture véhicules occasion"],
  ["45.20A", "Entretien et réparation de véhicules automobiles légers", "garage garagiste mécanique réparation auto"],
  ["45.20B", "Entretien et réparation d'autres véhicules automobiles", "poids lourds camions réparation"],
  ["45.32Z", "Commerce de détail d'équipements automobiles", "pneus pièces auto équipement"],
  ["71.20A", "Contrôle technique automobile", "contrôle technique centre auto"],
  ["85.53Z", "Enseignement de la conduite", "auto-école conduite permis"],
  // Commerces, restauration, hébergement
  ["10.71C", "Boulangerie et boulangerie-pâtisserie", "boulanger boulangerie pâtissier"],
  ["47.76Z", "Commerce de détail de fleurs, plantes, graines, engrais, animaux", "fleuriste jardinerie animalerie"],
  ["56.10A", "Restauration traditionnelle", "restaurant restaurateur"],
  ["56.21Z", "Services des traiteurs", "traiteur réception mariage événement buffet"],
  ["56.30Z", "Débits de boissons", "bar café brasserie"],
  ["55.10Z", "Hôtels et hébergement similaire", "hôtel hébergement"],
  ["82.30Z", "Organisation de foires, salons professionnels et congrès", "événementiel salon congrès organisation événement"],
  ["74.20Z", "Activités photographiques", "photographe photo mariage"],
  // Beauté, bien-être, sport
  ["96.02A", "Coiffure", "coiffeur salon de coiffure"],
  ["96.02B", "Soins de beauté", "esthéticienne institut beauté"],
  ["96.04Z", "Entretien corporel", "spa massage bien-être institut"],
  ["93.13Z", "Activités des centres de culture physique", "salle de sport fitness coaching"],
  // Santé
  ["86.21Z", "Activité des médecins généralistes", "médecin généraliste cabinet médical"],
  ["86.22C", "Autres activités des médecins spécialistes", "médecin spécialiste cabinet"],
  ["86.23Z", "Pratique dentaire", "dentiste dentaire chirurgien-dentiste orthodontiste cabinet dentaire"],
  ["86.90D", "Activités des infirmiers et des sages-femmes", "infirmier infirmière sage-femme"],
  ["86.90E", "Activités des professionnels de la rééducation, de l'appareillage et des pédicures-podologues", "kinésithérapeute kiné podologue rééducation"],
  ["75.00Z", "Activités vétérinaires", "vétérinaire clinique vétérinaire"],
  ["47.73Z", "Commerce de détail de produits pharmaceutiques en magasin spécialisé", "pharmacie pharmacien"],
  // Services aux entreprises et aux particuliers
  ["69.10Z", "Activités juridiques", "avocat notaire juriste cabinet juridique"],
  ["69.20Z", "Activités comptables", "expert-comptable comptable comptabilité cabinet comptable paie"],
  ["68.31Z", "Agences immobilières", "agence immobilière immobilier transaction agent immobilier"],
  ["68.32A", "Administration d'immeubles et autres biens immobiliers", "syndic gestion locative copropriété administrateur de biens"],
  ["66.22Z", "Activités des agents et courtiers d'assurances", "assurance courtier assureur agent général"],
  ["66.19B", "Autres activités auxiliaires de services financiers", "courtier crédit conseil en gestion de patrimoine financement"],
  ["70.22Z", "Conseil pour les affaires et autres conseils de gestion", "conseil consultant gestion formation conseil aux entreprises"],
  ["73.11Z", "Activités des agences de publicité", "agence publicité communication marketing"],
  ["62.01Z", "Programmation informatique", "développeur logiciel application web informatique"],
  ["62.02A", "Conseil en systèmes et logiciels informatiques", "informatique conseil système infogérance"],
  ["85.59A", "Formation continue d'adultes", "formation organisme de formation formateur"],
  ["78.20Z", "Activités des agences de travail temporaire", "intérim travail temporaire recrutement"],
  ["49.32Z", "Transport de voyageurs par taxis", "taxi vtc"],
  ["49.41A", "Transports routiers de fret interurbains", "transport routier fret camion livraison"],
  ["52.29A", "Messagerie, fret express", "messagerie coursier livraison express"],
];

const USAGE = [
  "Usage : node scripts/niche/naf.mjs <mots...> [--max N]     ex. : node scripts/niche/naf.mjs piscine",
  "        node scripts/niche/naf.mjs --tous                   la table entière",
  "  Propose des codes NAF rév. 2 d'après des mots (table embarquée, sans réseau). Vérifie le code choisi sur le site de l'INSEE puis",
  "  avec node scripts/sourcing/sirene.mjs fetch --essai (le volume d'entreprises).",
].join("\n");

const sansAccent = (t) =>
  String(t).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/[^a-z0-9]+/g, " ").trim();

/** Radical approximatif : « piscines » et « piscine » se rejoignent (pluriels, féminins simples). */
const radical = (m) => {
  const r = m.replace(/(es|s|x|e)$/, "");
  return r.length >= 3 ? r : m;
};

/** Les codes qui correspondent aux mots, du meilleur au moins bon : [{ code, libelle, score }]. */
export function chercherNaf(mots, { max = 8 } = {}) {
  const voulus = sansAccent(Array.isArray(mots) ? mots.join(" ") : mots).split(" ").filter((m) => m.length >= 3).map(radical).filter((m) => m.length >= 3);
  if (voulus.length === 0) return [];
  const resultats = [];
  for (const [code, libelle, proches] of TABLE_NAF) {
    const motsLibelle = sansAccent(libelle).split(" ").map(radical);
    const motsProches = sansAccent(proches).split(" ").map(radical);
    let score = 0;
    for (const v of voulus) {
      if (motsProches.includes(v)) score += 3;
      else if (motsLibelle.includes(v)) score += 2;
      else if (v.length >= 4 && motsProches.some((m) => m.length >= 4 && (m.startsWith(v) || v.startsWith(m)))) score += 1;
    }
    if (score > 0) resultats.push({ code, libelle, score });
  }
  return resultats.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, max);
}

async function main() {
  const { options, positionnels } = lireArguments(process.argv.slice(2), { "--max": "entier", "--tous": "booleen" });
  if (options.aide || (!options.tous && positionnels.length === 0)) {
    console.log(USAGE);
    process.exitCode = options.aide ? 0 : 1;
    return;
  }
  if (options.tous) {
    for (const [code, libelle] of TABLE_NAF) console.log(`${code}  ${libelle}`);
    return;
  }
  const r = chercherNaf(positionnels, { max: Number.isInteger(options.max) && options.max > 0 ? options.max : 8 });
  if (r.length === 0) {
    console.log("Aucun code dans la table pour ces mots. Essaie un synonyme, le métier au singulier, ou cherche le code sur le site de l'INSEE (nomenclature NAF rév. 2).");
    process.exitCode = 1;
    return;
  }
  for (const x of r) console.log(`${x.code}  ${x.libelle}`);
  console.log("Table partielle : vérifie le code choisi (INSEE), puis le volume : node scripts/sourcing/sirene.mjs fetch --essai.");
}

// Lancé en ligne de commande seulement (les tests importent chercherNaf).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof ErreurNiche ? e.message : `erreur inattendue (code ${e?.code ?? "inconnu"})`);
    process.exitCode = 1;
  });
}
