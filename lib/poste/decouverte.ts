// Les réponses de découverte d'une fiche : les champs du débrief (config.debrief.champs) puis les questions du script (config.script.questions),
// même id : le champ du débrief l'emporte (la règle du débrief, scripts/debrief). Elles vivent à plat dans leads.qualification[<id>], écrites
// par le débrief seulement quand elles sont vides. Le Poste les montre sous la question du script ; la fiche les liste. Module PUR.

export interface ChampDecouverte {
  id: string;
  question: string;
}

export interface ReponseDecouverte extends ChampDecouverte {
  /** La réponse notée, ou null si elle ne l'est pas encore. */
  valeur: string | null;
}

export function champsDecouverte(n: {
  debrief: { champs: readonly { id: string; question: string }[] };
  script: { questions: readonly { id: string; texte: string }[] };
}): ChampDecouverte[] {
  const champs: ChampDecouverte[] = n.debrief.champs.map((c) => ({ id: c.id, question: c.question }));
  for (const q of n.script.questions) if (!champs.some((c) => c.id === q.id)) champs.push({ id: q.id, question: q.texte });
  return champs;
}

function valeurLisible(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "oui" : "non";
  return null;
}

/** Les réponses de la fiche pour ces champs (qualification lue prudemment : une valeur qui n'est pas un texte simple est ignorée). */
export function reponsesDecouverte(qualification: unknown, champs: readonly ChampDecouverte[]): ReponseDecouverte[] {
  const q = qualification !== null && typeof qualification === "object" && !Array.isArray(qualification) ? (qualification as Record<string, unknown>) : {};
  return champs.map((c) => ({ ...c, valeur: Object.hasOwn(q, c.id) ? valeurLisible(q[c.id]) : null }));
}
