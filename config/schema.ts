// Le schéma de config/niche.json : la SEULE vérité sur la forme de la configuration d'une niche.
//
// config/niche.json est écrit par le skill d'installation (du JSON, sans exécuter de code). Il est validé ici, puis par
// config/garde-fous.ts (aucune promesse de résultat, aucune clé), par config/charger.ts : au build (next.config.ts) et par npm test.
// Objets stricts : une clé inconnue (une faute de frappe) est refusée.
//
// Imports RELATIFS seulement : next.config.ts lit ce fichier au build, où l'alias « @/ » n'existe pas.

import { z } from "zod";
import { CANAUX_RDV, FOURNISSEURS_AGENDA } from "../lib/agenda/types";
import {
  FOURNISSEURS_AVEC_ENREGISTREMENT,
  FOURNISSEURS_TELEPHONIE,
  MODES_PAR_FOURNISSEUR,
  MODES_TELEPHONIE,
  SCHEMAS_LIEN,
} from "../lib/telephonie/types";

export const VERSION_CONFIG = 1;

/** Les issues que tout script propose : le Poste et la base (enregistrer_issue) en dépendent. */
export const ISSUES_SOCLE = [
  "pas_repondu",
  "messagerie",
  "standard",
  "a_rappeler",
  "rdv_fixe",
  "pas_interesse",
  "hors_cible",
  "ne_plus_contacter",
] as const;
export type IssueSocle = (typeof ISSUES_SOCLE)[number];

/** Les issues du socle qui sortent la fiche de la file (final: true). Les autres l'y laissent (final: false). */
export const ISSUES_SOCLE_FINALES: readonly IssueSocle[] = ["rdv_fixe", "pas_interesse", "hors_cible", "ne_plus_contacter"];

/** Les crochets que le Poste sait remplir. « [deux créneaux] » : les deux créneaux proposés au close. */
export const CROCHETS_CONNUS = [
  "[prénom]",
  "[nom]",
  "[entreprise]",
  "[ville]",
  "[métier]",
  "[ton prénom]",
  "[équipe]",
  "[deux créneaux]",
] as const;

export const TONS_SCRIPT = ["direct_sec", "curiosite_doux", "expert_pose", "chaleureux"] as const;

/** Les clés que le débrief écrit lui-même (scripts/debrief/lib.mjs) : un champ de découverte ou une question ne peut pas les porter. */
export const IDS_RESERVES_DEBRIEF = [
  "resume",
  "issue",
  "objection",
  "objection_texte",
  "interet",
  "decideur_joint",
  "douleurs",
  "croyances",
  "citations",
  "prochaine_etape",
  "tags",
  "urgent",
] as const;

export const TYPES_CRITERE_SCORE = [
  "forme_juridique",
  "effectif",
  "anciennete",
  "ville",
  "naf",
  "mot_nom",
  "note_google",
  "a_site",
  "a_email",
] as const;

/** Indicatif attendu pour les pays connus (les autres pays sont libres). */
export const INDICATIFS_CONNUS: Readonly<Record<string, string>> = { FR: "+33", BE: "+32", CH: "+41", CA: "+1", LU: "+352", MC: "+377" };

// ---------------------------------------------------------------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------------------------------------------------------------

const texte = (max: number) => z.string().trim().min(1).max(max);
const textes = (maxElements: number, maxLongueur: number) => z.array(texte(maxLongueur)).max(maxElements);
const identifiant = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "identifiant en minuscules et tirets bas (ex. source_clients)");
const codeIssue = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "code en minuscules et tirets bas (ex. pas_repondu)");
const codeObjection = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "code en minuscules et tirets (ex. pas-le-temps)");
const codeNaf = z.string().regex(/^\d{2}\.\d{2}[A-Z]$/, "code NAF au format 81.30Z");
const departement = z.string().regex(/^(0[1-9]|[1-8]\d|9[0-5]|2A|2B|97[1-6])$/, "département (01 à 95, 2A, 2B, 971 à 976)");
const fuseau = z.string().refine((f) => {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: f });
    return true;
  } catch {
    return false;
  }
}, "fuseau horaire inconnu (ex. Europe/Paris)");

const points = z.number().int().min(-100).max(100);
const critere = <T extends (typeof TYPES_CRITERE_SCORE)[number], R extends z.ZodType>(type: T, regle: R) =>
  z.strictObject({ id: identifiant, type: z.literal(type), regle, points });

const critereScore = z.discriminatedUnion("type", [
  critere("forme_juridique", z.strictObject({ inclure: textes(30, 60).optional(), exclure: textes(30, 60).optional() })),
  critere("effectif", z.strictObject({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() })),
  critere("anciennete", z.strictObject({ minAns: z.number().min(0).max(200).optional(), maxAns: z.number().min(0).max(200).optional() })),
  critere("ville", z.strictObject({ inclure: textes(300, 80).min(1) })),
  critere("naf", z.strictObject({ inclure: z.array(codeNaf).min(1).max(50) })),
  critere("mot_nom", z.strictObject({ mots: textes(50, 40).min(1) })),
  critere("note_google", z.strictObject({ min: z.number().min(0).max(5), avisMin: z.number().int().min(0).optional() })),
  critere("a_site", z.strictObject({})),
  critere("a_email", z.strictObject({})),
]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Le schéma
// ---------------------------------------------------------------------------------------------------------------------------------

const objetNiche = z.strictObject({
  version: z.literal(VERSION_CONFIG),
  marque: z.strictObject({
    nomProduit: texte(60),
    nomEquipe: texte(60),
    /** « NomBot/1.0 », éventuellement suivi de « (+https://…) » : l'identité du robot qui lit les sites (accroches). */
    userAgent: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9._-]{1,39}\/\d+(\.\d+){0,2}( \(\+https:\/\/[^\s()]{4,200}\))?$/, "format « NomBot/1.0 (+https://…) »"),
    couleur: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "couleur au format #RRGGBB")
      .optional(),
  }),
  pays: z.strictObject({
    code: z.string().regex(/^[A-Z]{2}$/, "code pays en deux lettres (FR, BE, CH, CA…)"),
    fuseau,
    indicatif: z.string().regex(/^\+[1-9]\d{0,3}$/, "indicatif au format +33"),
    langue: z.literal("fr"),
  }),
  offre: z.strictObject({
    nom: texte(120),
    pourQui: texte(300),
    probleme: texte(600),
    mecanisme: texte(600),
    /** Sans aucun chiffre de résultat : voir config/garde-fous.ts. */
    promesse: texte(400),
    /** Au téléphone, on ne vend QUE le rendez-vous. */
    objectifAppel: z.literal("rdv"),
    rdv: z.strictObject({
      nom: texte(80),
      dureeMin: z.union([z.literal(20), z.literal(30), z.literal(45)]),
      canal: z.enum(CANAUX_RDV),
    }),
    /** L'esquive du prix : « le prix dépend de… on le voit ensemble ». */
    phrasePrix: texte(400),
  }),
  cible: z.strictObject({
    description: texte(400),
    metiers: textes(30, 80).min(1),
    tailleMin: z.number().int().min(0).optional(),
    tailleMax: z.number().int().min(0).optional(),
    decideur: texte(80),
    exclusions: textes(30, 200),
  }),
  script: z.strictObject({
    ton: z.enum(TONS_SCRIPT),
    vouvoiement: z.boolean(),
    ouverture: z.strictObject({
      portable: texte(600),
      standard: texte(600),
      commentAvezVousMonNumero: texte(600),
    }),
    permission: texte(400).optional(),
    questions: z
      .array(z.strictObject({ id: identifiant, texte: texte(300), but: texte(200) }))
      .min(3)
      .max(6),
    pitch: texte(1200),
    /** Doit contenir « [deux créneaux] ». */
    close: texte(600),
    messagerie: texte(600),
    crochets: z.array(z.string().regex(/^\[[^[\]]{1,30}\]$/, "crochet au format [mot]")).max(12),
  }),
  objections: z
    .array(
      z.strictObject({
        code: codeObjection,
        libelle: texte(120),
        reponse: texte(1200),
        relance: texte(600).optional(),
      }),
    )
    .min(1)
    .max(20),
  issues: z
    .array(
      z.strictObject({
        code: codeIssue,
        libelle: texte(60),
        touche: z
          .string()
          .regex(/^[a-z0-9]$/, "une seule lettre minuscule ou un chiffre")
          .optional(),
        rappelAuto: z.literal("creneau_alterne").nullable().optional(),
        final: z.boolean(),
        exigeRappel: z.boolean().optional(),
        gabaritNote: textes(10, 40).optional(),
      }),
    )
    .min(ISSUES_SOCLE.length)
    .max(20),
  tentativesMax: z.number().int().min(1).max(10),
  score: z.strictObject({
    criteres: z.array(critereScore).max(30),
    seuils: z.strictObject({ A: z.number().int().min(1).max(100), B: z.number().int().min(0).max(99) }),
    plafond: z.literal(100),
  }),
  sources: z.strictObject({
    sirene: z
      .strictObject({
        naf: z.array(codeNaf).min(1).max(30),
        departements: z.union([z.literal("tous"), z.array(departement).min(1).max(110)]),
        motsNomInclure: textes(50, 40).optional(),
        motsNomExclure: textes(50, 40).optional(),
        exclureEI: z.boolean().optional(),
        etatAdministratif: z.literal("A"),
      })
      .optional(),
    /** Livré désactivé (risque au regard des conditions de Google) : voir docs/sourcing.md. */
    maps: z
      .strictObject({
        actif: z.boolean(),
        motsCles: textes(20, 80),
        villes: textes(300, 80),
        max: z.number().int().min(1).max(2000),
      })
      .optional(),
    motsVidesAppariement: textes(100, 40),
    prefixesEmail: z.array(z.string().regex(/^[a-z0-9._-]{1,30}$/, "début d'adresse en minuscules (ex. contact)")).max(30),
  }),
  accroche: z.strictObject({
    actif: z.boolean(),
    exemples: z.array(texte(300)).length(3),
    motsIndices: textes(80, 40),
    interdits: textes(80, 60),
    longueurMax: z.number().int().min(40).max(160),
  }),
  debrief: z.strictObject({
    champs: z
      .array(z.strictObject({ id: identifiant, question: texte(200) }))
      .min(1)
      .max(12),
  }),
  telephonie: z.strictObject({
    fournisseur: z.enum(FOURNISSEURS_TELEPHONIE),
    mode: z.enum(MODES_TELEPHONIE),
    schemaLien: z.enum(SCHEMAS_LIEN).optional(),
    copierNumero: z.boolean(),
    enregistrement: z.boolean(),
  }),
  agenda: z.strictObject({
    fournisseur: z.enum(FOURNISSEURS_AGENDA),
    lienReservation: z
      .url({ protocol: /^https$/, error: "lien public en https://" })
      .max(500)
      .optional(),
    prefill: z.boolean(),
    champLead: z.literal("utm_content"),
  }),
  legal: z.strictObject({
    responsable: texte(120),
    contactRGPD: z.email({ error: "e-mail public valide" }).max(254),
    annonceEnregistrement: texte(500),
    phraseOpposition: texte(500),
    phraseSource: texte(500),
    conservationMois: z.number().int().min(1).max(36),
  }),
});

type ObjetNiche = z.infer<typeof objetNiche>;
type Contexte = z.RefinementCtx<ObjetNiche>;

function signaler(ctx: Contexte, chemin: (string | number)[], message: string): void {
  ctx.addIssue({ code: "custom", path: chemin, message });
}

function doublons(valeurs: readonly string[]): string[] {
  const vus = new Set<string>();
  const doubles = new Set<string>();
  for (const v of valeurs) (vus.has(v) ? doubles : vus).add(v);
  return [...doubles];
}

/** Les textes du script où l'on peut placer des crochets, avec leur chemin. */
function textesAvecCrochets(n: ObjetNiche): [string, string][] {
  const t: [string, string][] = [
    ["script.ouverture.portable", n.script.ouverture.portable],
    ["script.ouverture.standard", n.script.ouverture.standard],
    ["script.ouverture.commentAvezVousMonNumero", n.script.ouverture.commentAvezVousMonNumero],
    ["script.pitch", n.script.pitch],
    ["script.close", n.script.close],
    ["script.messagerie", n.script.messagerie],
  ];
  if (n.script.permission) t.push(["script.permission", n.script.permission]);
  n.script.questions.forEach((q, i) => t.push([`script.questions.${i}.texte`, q.texte]));
  n.objections.forEach((o, i) => {
    t.push([`objections.${i}.reponse`, o.reponse]);
    if (o.relance) t.push([`objections.${i}.relance`, o.relance]);
  });
  return t;
}

function verifierCoherence(n: ObjetNiche, ctx: Contexte): void {
  // Issues : le socle au complet, des codes et des touches uniques, le sens du socle respecté.
  const codes = n.issues.map((i) => i.code);
  for (const c of ISSUES_SOCLE) {
    if (!codes.includes(c)) signaler(ctx, ["issues"], `issue du socle manquante : ${c}`);
  }
  for (const d of doublons(codes)) signaler(ctx, ["issues"], `code d'issue en double : ${d}`);
  for (const d of doublons(n.issues.flatMap((i) => (i.touche ? [i.touche] : [])))) {
    signaler(ctx, ["issues"], `touche en double : ${d}`);
  }
  n.issues.forEach((issue, i) => {
    if (!(ISSUES_SOCLE as readonly string[]).includes(issue.code)) return;
    const finale = ISSUES_SOCLE_FINALES.includes(issue.code as IssueSocle);
    if (issue.final !== finale) signaler(ctx, ["issues", i, "final"], `l'issue ${issue.code} doit avoir final: ${finale}`);
    if (issue.code === "a_rappeler" && issue.exigeRappel !== true) {
      signaler(ctx, ["issues", i, "exigeRappel"], "l'issue a_rappeler exige une date de rappel (exigeRappel: true)");
    }
  });

  // Codes et identifiants uniques.
  for (const d of doublons(n.objections.map((o) => o.code))) signaler(ctx, ["objections"], `code d'objection en double : ${d}`);
  for (const d of doublons(n.script.questions.map((q) => q.id))) signaler(ctx, ["script", "questions"], `question en double : ${d}`);
  for (const d of doublons(n.debrief.champs.map((c) => c.id))) signaler(ctx, ["debrief", "champs"], `champ en double : ${d}`);
  for (const d of doublons(n.score.criteres.map((c) => c.id))) signaler(ctx, ["score", "criteres"], `critère en double : ${d}`);

  // Bornes cohérentes.
  if (n.cible.tailleMin !== undefined && n.cible.tailleMax !== undefined && n.cible.tailleMin > n.cible.tailleMax) {
    signaler(ctx, ["cible", "tailleMin"], "tailleMin doit être inférieure ou égale à tailleMax");
  }
  if (n.score.seuils.A <= n.score.seuils.B) signaler(ctx, ["score", "seuils"], "le seuil A doit être au-dessus du seuil B");
  n.score.criteres.forEach((c, i) => {
    if (c.type === "forme_juridique" && !c.regle.inclure?.length && !c.regle.exclure?.length) {
      signaler(ctx, ["score", "criteres", i, "regle"], "forme_juridique : il faut une liste inclure ou exclure");
    }
    if (c.type === "effectif" && c.regle.min !== undefined && c.regle.max !== undefined && c.regle.min > c.regle.max) {
      signaler(ctx, ["score", "criteres", i, "regle"], "effectif : min doit être inférieur ou égal à max");
    }
    if (c.type === "anciennete" && c.regle.minAns !== undefined && c.regle.maxAns !== undefined && c.regle.minAns > c.regle.maxAns) {
      signaler(ctx, ["score", "criteres", i, "regle"], "anciennete : minAns doit être inférieur ou égal à maxAns");
    }
  });

  // Pays : l'indicatif des pays connus.
  const attendu = INDICATIFS_CONNUS[n.pays.code];
  if (attendu && n.pays.indicatif !== attendu) signaler(ctx, ["pays", "indicatif"], `indicatif attendu pour ${n.pays.code} : ${attendu}`);

  // Crochets : connus du Poste, déclarés, et « [deux créneaux] » dans le close.
  n.script.crochets.forEach((c, i) => {
    if (!(CROCHETS_CONNUS as readonly string[]).includes(c)) {
      signaler(ctx, ["script", "crochets", i], `crochet inconnu : ${c} (connus : ${CROCHETS_CONNUS.join(" ")})`);
    }
  });
  for (const [chemin, valeur] of textesAvecCrochets(n)) {
    for (const trouve of valeur.match(/\[[^[\]]*\]/g) ?? []) {
      if (!n.script.crochets.includes(trouve)) signaler(ctx, chemin.split("."), `crochet non déclaré dans script.crochets : ${trouve}`);
    }
  }
  if (!n.script.close.includes("[deux créneaux]")) signaler(ctx, ["script", "close"], "le close doit proposer [deux créneaux]");

  // Téléphonie : un mode possible pour ce fournisseur ; l'enregistrement seulement chez ceux qui l'envoient.
  if (!MODES_PAR_FOURNISSEUR[n.telephonie.fournisseur].includes(n.telephonie.mode)) {
    signaler(
      ctx,
      ["telephonie", "mode"],
      `mode ${n.telephonie.mode} impossible avec ${n.telephonie.fournisseur} (possibles : ${MODES_PAR_FOURNISSEUR[n.telephonie.fournisseur].join(", ")})`,
    );
  }
  if (n.telephonie.enregistrement && !FOURNISSEURS_AVEC_ENREGISTREMENT.includes(n.telephonie.fournisseur)) {
    signaler(ctx, ["telephonie", "enregistrement"], `${n.telephonie.fournisseur} n'envoie pas d'enregistrement : mets enregistrement à false`);
  }

  // Agenda : Calendly et iClosed passent par leur lien public.
  if ((n.agenda.fournisseur === "calendly" || n.agenda.fournisseur === "iclosed") && !n.agenda.lienReservation) {
    signaler(ctx, ["agenda", "lienReservation"], `${n.agenda.fournisseur} : le lien public de réservation est obligatoire`);
  }

  // Accroches : chaque exemple tient dans la longueur maximale.
  n.accroche.exemples.forEach((e, i) => {
    if (e.length > n.accroche.longueurMax) {
      signaler(ctx, ["accroche", "exemples", i], `exemple trop long (${e.length} > ${n.accroche.longueurMax} caractères)`);
    }
  });

  // Accroches : chaque exemple fait de 15 à 30 mots, comme celles que le contrôle anti-invention accepte (scripts/accroches/valide.mjs).
  n.accroche.exemples.forEach((e, i) => {
    const mots = e.split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length;
    if (mots < 15 || mots > 30) signaler(ctx, ["accroche", "exemples", i], `exemple de ${mots} mots (de 15 à 30 attendus)`);
  });

  // Débrief : un champ de découverte ou une question ne prend pas une clé que le débrief écrit lui-même.
  n.debrief.champs.forEach((c, i) => {
    if ((IDS_RESERVES_DEBRIEF as readonly string[]).includes(c.id)) signaler(ctx, ["debrief", "champs", i, "id"], `identifiant réservé au débrief : ${c.id}`);
  });
  n.script.questions.forEach((q, i) => {
    if ((IDS_RESERVES_DEBRIEF as readonly string[]).includes(q.id)) signaler(ctx, ["script", "questions", i, "id"], `identifiant réservé au débrief : ${q.id}`);
  });
}

export const schemaNiche = objetNiche.superRefine(verifierCoherence);

export type Niche = z.infer<typeof schemaNiche>;
export type Objection = Niche["objections"][number];
export type Issue = Niche["issues"][number];
export type CritereScore = Niche["score"]["criteres"][number];
