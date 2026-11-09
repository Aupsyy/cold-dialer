// Le débrief d'exemple des tests (niche fictive « paysagistes » de config/niche.exemple.json) : un dialogue INVENTÉ, un numéro de la plage
// réservée à la fiction (01 99 00), une entreprise « Atelier Démo ». Aucune donnée réelle.

/** Un débrief complet et valide ; `x` modifie l'extraction, `r` la racine. */
export function debrief(x = {}, r = {}) {
  return {
    version: 1,
    lead: { telephone: "01 99 00 00 07", entreprise: "Atelier Démo 07" },
    appel: { debut: "2026-11-09T15:20:00+01:00", duree_s: 312 },
    source: "colle",
    transcription: [
      { locuteur: "appelant", texte: "Bonjour, je vous appelle au sujet des demandes de devis de votre entreprise." },
      { locuteur: "prospect", texte: "Ah oui. Les plateformes m’envoient des demandes à quarante kilomètres, je ne peux pas suivre." },
      { locuteur: "appelant", texte: "Et aujourd'hui, vos clients arrivent surtout comment ?" },
      { locuteur: "prospect", texte: "Surtout le bouche-à-oreille, et un peu les plateformes. Je n'ai pas le temps cette semaine, rappelez-moi jeudi." },
    ],
    extraction: {
      resume: "Gérant joint, intéressé par des demandes plus proches ; à rappeler jeudi.",
      issue: "a_rappeler",
      objection: "pas-le-temps",
      objection_texte: null,
      interet: 2,
      decideur_joint: true,
      douleurs: ["Demandes trop loin de sa zone"],
      croyances: [],
      citations: ["Les plateformes m'envoient des demandes à quarante kilomètres, je ne peux pas suivre."],
      prochaine_etape: { type: "rappel", date: "2026-11-12T10:00:00+01:00", detail: null },
      tags: ["plateformes", "Distance"],
      source_clients: "Bouche-à-oreille, un peu les plateformes",
      chantiers_voulus: "",
      zone: null,
      ...x,
    },
    verdict_accroche: "utile",
    ...r,
  };
}
