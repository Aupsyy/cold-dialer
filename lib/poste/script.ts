// Le script de l'appel, rempli pour une fiche. TOUT ce qui est dit au prospect vient de config/niche.json (script, objections, phrase
// prix, textes légaux) : ici, seulement les crochets remplis avec la fiche, la personne qui appelle et l'heure. Module PUR.
//
// Les crochets connus (CROCHETS_CONNUS de config/schema.ts) : [prénom], [nom] (du dirigeant), [entreprise], [ville], [métier], [ton prénom]
// (la personne qui appelle), [équipe] (config.marque.nomEquipe), [deux créneaux] (lib/poste/creneaux.ts).
// Valeur inconnue : [entreprise] devient « votre entreprise » (ou « ton entreprise » au tutoiement), [ville] disparaît avec sa préposition
// (« à [ville] », « sur [ville] »), [métier] prend le premier métier de la cible, [prénom] et [nom] disparaissent (« Bonjour [prénom], »
// devient « Bonjour, ») ; [ton prénom] inconnu reste affiché tel quel, en évidence : c'est à la personne qui appelle de le dire.

export const CROCHETS = ["[prénom]", "[nom]", "[entreprise]", "[ville]", "[métier]", "[ton prénom]", "[équipe]", "[deux créneaux]"] as const;
export type Crochet = (typeof CROCHETS)[number];

export interface ContexteScript {
  prenom: string | null;
  nom: string | null;
  entreprise: string | null;
  ville: string | null;
  metier: string | null;
  tonPrenom: string | null;
  equipe: string;
  /** « demain à 10 h ou jeudi à 14 h 30 », ou null si aucun créneau n'est libre. */
  deuxCreneaux: string | null;
  vouvoiement: boolean;
}

export interface Segment {
  texte: string;
  /** Le crochet que ce morceau remplace (mis en évidence à l'écran). */
  crochet?: Crochet;
  /** Vrai si la valeur manquait : le morceau est un repli neutre ou le crochet lui-même. */
  manquant?: boolean;
}

const RE_CROCHET = /\[(?:prénom|nom|entreprise|ville|métier|ton prénom|équipe|deux créneaux)\]/gu;
const PREPOSITION_VILLE = /(?:\s(?:à|a|sur|de|du|dans|près de|vers|en))\s*$/u;

const net = (v: string | null | undefined): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

function valeur(crochet: Crochet, ctx: ContexteScript): { texte: string; manquant: boolean } {
  const votre = ctx.vouvoiement ? "votre" : "ton";
  const connu = (v: string | null | undefined, repli: string) => {
    const t = net(v);
    return t ? { texte: t, manquant: false } : { texte: repli, manquant: true };
  };
  switch (crochet) {
    case "[prénom]":
      return connu(ctx.prenom, "");
    case "[nom]":
      return connu(ctx.nom, "");
    case "[entreprise]":
      return connu(ctx.entreprise, `${votre} entreprise`);
    case "[ville]":
      return connu(ctx.ville, "");
    case "[métier]": {
      const r = connu(ctx.metier, `${votre} métier`);
      return r.manquant ? r : { texte: r.texte.toLowerCase(), manquant: false };
    }
    case "[ton prénom]":
      return connu(ctx.tonPrenom, "[ton prénom]");
    case "[équipe]":
      return connu(ctx.equipe, "");
    case "[deux créneaux]":
      return connu(ctx.deuxCreneaux, "[deux créneaux]");
  }
}

/** Le texte découpé en morceaux : le texte de la config, et chaque crochet remplacé par sa valeur (à mettre en évidence). */
export function segmentsScript(texte: string, ctx: ContexteScript): Segment[] {
  const segments: Segment[] = [];
  let reste = 0;
  for (const m of texte.matchAll(RE_CROCHET)) {
    const crochet = m[0] as Crochet;
    const debut = m.index ?? 0;
    let avant = texte.slice(reste, debut);
    const v = valeur(crochet, ctx);
    if (v.texte === "") {
      // Une valeur vide emporte sa préposition (« à [ville] ») et l'espace qui la précède (« Bonjour [prénom], » : « Bonjour, »).
      if (crochet === "[ville]") avant = avant.replace(PREPOSITION_VILLE, "");
      avant = avant.replace(/\s+$/u, "");
    }
    if (avant) segments.push({ texte: avant });
    segments.push(v.manquant ? { texte: v.texte, crochet, manquant: true } : { texte: v.texte, crochet });
    reste = debut + m[0].length;
    if (v.texte === "") {
      // Pas d'espace avant une virgule, un point ou une parenthèse après un crochet retiré (les deux-points gardent leur espace).
      const espaces = /^\s+(?=[,.)]|$)/u.exec(texte.slice(reste));
      if (espaces) reste += espaces[0].length;
    }
  }
  const fin = texte.slice(reste);
  if (fin) segments.push({ texte: fin });
  return segments;
}

export function texteDesSegments(segments: readonly Segment[]): string {
  return segments
    .map((s) => s.texte)
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Le texte rempli, prêt à être dit. */
export function remplirScript(texte: string, ctx: ContexteScript): string {
  return texteDesSegments(segmentsScript(texte, ctx));
}

/** Les crochets restés sans valeur dans un texte (dans l'ordre, sans doublon). */
export function crochetsManquants(texte: string, ctx: ContexteScript): Crochet[] {
  const vus: Crochet[] = [];
  for (const s of segmentsScript(texte, ctx)) if (s.manquant && s.crochet && !vus.includes(s.crochet)) vus.push(s.crochet);
  return vus;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Les noms
// ---------------------------------------------------------------------------------------------------------------------------------

/** « JEAN-MARC » -> « Jean-Marc », « d'ARCY » -> « D'Arcy ». */
export function titreNom(brut: string): string {
  return brut.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

const CIVILITE = /^(m|mr|mme|mlle|madame|monsieur|mademoiselle|dr|me)\.?$/i;

function motsDuNom(nom: string | null | undefined): string[] {
  const mots = (nom ?? "").trim().split(/\s+/).filter(Boolean);
  while (mots.length > 1 && CIVILITE.test(mots[0] as string)) mots.shift();
  return mots;
}

/** Le prénom du dirigeant : le premier mot de « Prénom NOM » (civilité retirée). */
export function prenomDirigeant(dirigeant: string | null | undefined): string | null {
  const mots = motsDuNom(dirigeant);
  return mots.length > 0 ? titreNom(mots[0] as string) : null;
}

/** Le nom du dirigeant : ce qui suit le prénom. */
export function nomDirigeant(dirigeant: string | null | undefined): string | null {
  const mots = motsDuNom(dirigeant);
  return mots.length > 1 ? titreNom(mots.slice(1).join(" ")) : null;
}

/** Le prénom de la personne qui appelle (profiles.nom) : le premier mot de son nom. */
export function premierPrenom(nomComplet: string | null | undefined): string | null {
  const mots = (nomComplet ?? "").trim().split(/\s+/).filter(Boolean);
  return mots.length > 0 ? titreNom(mots[0] as string) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Le script complet d'une fiche
// ---------------------------------------------------------------------------------------------------------------------------------

/** Ce que le Poste lit de config/niche.json pour le script (une partie de Niche, que le chargeur a déjà validée). */
export interface ConfigScript {
  script: {
    vouvoiement: boolean;
    ouverture: { portable: string; standard: string; commentAvezVousMonNumero: string };
    permission?: string;
    questions: readonly { id: string; texte: string; but: string }[];
    pitch: string;
    close: string;
    messagerie: string;
  };
  objections: readonly { code: string; libelle: string; reponse: string; relance?: string }[];
  offre: { phrasePrix: string };
  legal: { annonceEnregistrement: string; phraseOpposition: string; phraseSource: string };
}

export interface ScriptRempli {
  /** L'annonce d'enregistrement, seulement si l'équipe enregistre ses appels (reglages.enregistrement_complet). */
  annonce: string | null;
  ouverture: { portable: Segment[]; standard: Segment[] };
  commentAvezVousMonNumero: Segment[];
  phraseSource: string;
  phraseOpposition: string;
  permission: Segment[] | null;
  questions: { id: string; texte: Segment[]; but: string }[];
  pitch: Segment[];
  close: Segment[];
  messagerie: Segment[];
  objections: { code: string; libelle: string; reponse: Segment[]; relance: Segment[] | null }[];
  phrasePrix: Segment[];
  /** Les crochets restés sans valeur, dans tout le script. */
  manquants: Crochet[];
}

export function remplirLeScript(config: ConfigScript, ctx: ContexteScript, o: { enregistrement: boolean }): ScriptRempli {
  const s = (t: string) => segmentsScript(t, ctx);
  const textes: string[] = [];
  const garder = (t: string) => {
    textes.push(t);
    return s(t);
  };
  const rempli: Omit<ScriptRempli, "manquants"> = {
    annonce: o.enregistrement ? config.legal.annonceEnregistrement : null,
    ouverture: { portable: garder(config.script.ouverture.portable), standard: garder(config.script.ouverture.standard) },
    commentAvezVousMonNumero: garder(config.script.ouverture.commentAvezVousMonNumero),
    phraseSource: config.legal.phraseSource,
    phraseOpposition: config.legal.phraseOpposition,
    permission: config.script.permission ? garder(config.script.permission) : null,
    questions: config.script.questions.map((q) => ({ id: q.id, texte: garder(q.texte), but: q.but })),
    pitch: garder(config.script.pitch),
    close: garder(config.script.close),
    messagerie: garder(config.script.messagerie),
    objections: config.objections.map((o2) => ({
      code: o2.code,
      libelle: o2.libelle,
      reponse: garder(o2.reponse),
      relance: o2.relance ? garder(o2.relance) : null,
    })),
    phrasePrix: garder(config.offre.phrasePrix),
  };
  const manquants: Crochet[] = [];
  for (const t of textes) for (const c of crochetsManquants(t, ctx)) if (!manquants.includes(c)) manquants.push(c);
  return { ...rempli, manquants };
}
