// Le contrôle anti-invention d'une accroche (module pur : ni fichier, ni réseau). Règle d'or : rien d'inventé. Une accroche signalée
// est VIDÉE par valide.mjs, jamais corrigée.
//
// Une accroche passe si :
//   - c'est UNE phrase propre : majuscule au début, . ? ou ! à la fin, de 15 à 30 mots, config.accroche.longueurMax caractères au plus,
//     sans tiret long ni emoji ;
//   - elle ne contient ni promesse ni chiffre de résultat (motifs de config/garde-fous.ts, plus « garanti », « résultats », « + 30 % »,
//     « 10 demandes »…), ni flatterie vide (« magnifique », « superbe »…), ni mot de config.accroche.interdits ;
//   - sa source désigne une page lue par le crawl pour CETTE fiche, et son extrait (12 à 300 caractères) figure sur cette page ;
//   - chaque nom propre, lieu, année, nombre et mot rare (tout mot hors des mots courants de la formule) figure dans le texte compacté
//     du site, sans tenir compte des accents ni de la casse (le pluriel et le féminin sont tolérés pour les mots rares) ;
//   - elle cite au moins un tel élément, et l'extrait contient au moins l'un d'eux (la source prouve bien ce qui est dit) ;
//   - un superlatif ou un rang (« le plus », « premier », « dernier », « seul »…) figure dans l'extrait lui-même.

import { CHIFFRES_DE_RESULTAT, FLATTERIES, MOTS_COURANTS, PREPOSITIONS_DE_LIEU, PROMESSES_DE_BASE, SUPERLATIFS } from "./mots.mjs";
import { contientPassage, memeFamille, mots, normaliser, pourComparer } from "./texte.mjs";

export const MOTS_MIN = 15;
export const MOTS_MAX = 30;
export const EXTRAIT_MIN = 12;
export const EXTRAIT_MAX = 300;

/** Les libellés des motifs, pour les rapports (des codes stables dans les fichiers, des mots clairs pour l'humain). */
export const LIBELLES_MOTIFS = {
  format: "réponse mal formée",
  longueur: "longueur hors bornes",
  phrase: "pas une phrase unique et propre",
  tiret: "tiret long",
  promesse: "promesse ou chiffre de résultat",
  flatterie: "flatterie vide",
  interdit: "mot interdit par la configuration",
  source: "source manquante",
  source_hors_crawl: "page source non lue par le crawl pour cette fiche",
  extrait: "extrait trop court ou trop long",
  extrait_absent: "extrait introuvable sur la page source",
  extrait_sans_rapport: "l'extrait ne contient pas l'élément cité",
  lieu_absent: "lieu absent du site",
  nom_propre_absent: "nom propre absent du site",
  annee_absente: "année absente du site",
  nombre_absent: "nombre absent du site",
  mot_absent: "mot absent du site",
  aucun_element: "aucun élément vérifiable",
  superlatif_absent: "superlatif ou rang absent de l'extrait",
  revue: "vidée à la relecture humaine",
};

/** Les règles tirées de la config (longueur, mots interdits) et les motifs de promesse de config/garde-fous.ts. */
export function preparerRegles(niche, promesses = []) {
  return {
    motsMin: MOTS_MIN,
    motsMax: MOTS_MAX,
    caracteresMax: niche.accroche.longueurMax,
    interdits: [...new Set(niche.accroche.interdits.map((m) => pourComparer(m)).filter(Boolean))],
    promesses: [...promesses],
  };
}

/** La clé d'une adresse de page (sans « www. », sans ancre, sans barre finale) : les mêmes règles que le crawl. */
export function clePage(url) {
  try {
    const u = new URL(String(url).trim());
    const chemin = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.port ? `:${u.port}` : ""}${chemin}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * Ce qu'on sait d'une fiche : les mots de son texte compacté (ce que Claude a lu) et ses pages lues (où chercher l'extrait).
 * @param {{ indices?: { texte: string }[] } | undefined} compact la ligne de compact.jsonl
 * @param {{ pages?: { url: string, titre?: string, description?: string, titres?: string[], texte?: string, lu_le?: string }[] } | undefined} crawl
 */
export function contexteFiche(compact, crawl) {
  const texteCompact = (compact?.indices ?? []).map((l) => l.texte).join("\n");
  const pages = new Map();
  for (const p of crawl?.pages ?? []) {
    const cle = clePage(p.url);
    if (cle && !pages.has(cle)) {
      pages.set(cle, { url: p.url, lu_le: p.lu_le, texte: [p.titre, p.description, ...(p.titres ?? []), p.texte].filter(Boolean).join("\n") });
    }
  }
  const motsSite = [...new Set(mots(texteCompact))];
  return { motsSite, ensembleSite: new Set(motsSite), pages };
}

function chiffres(mot) {
  return mot.replace(/\D/g, "");
}

function presentNombre(n, liste) {
  const c = chiffres(n);
  return liste.some((m) => /\d/.test(m) && chiffres(m) === c);
}

function presentNomPropre(n, ensemble) {
  return ensemble.has(n) || ensemble.has(`${n}s`) || (n.endsWith("s") && ensemble.has(n.slice(0, -1)));
}

function presentMot(n, liste, ensemble) {
  return ensemble.has(n) || liste.some((m) => !/\d/.test(m) && memeFamille(n, m));
}

/** Les éléments à vérifier d'une accroche : ses mots hors mots courants, classés (année, nombre, lieu, nom propre, mot). */
export function elementsAVerifier(accroche) {
  const jetons = String(accroche).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const elements = [];
  jetons.forEach((brut, i) => {
    const n = normaliser(brut);
    if (!n) return;
    if (/\d/.test(n)) {
      elements.push({ mot: n, type: /^(1[89]|20)\d\d$/.test(n) ? "annee" : "nombre" });
      return;
    }
    if (MOTS_COURANTS.has(n) || n.length < 3) return;
    if (i > 0 && /^\p{Lu}/u.test(brut)) {
      const lieu = PREPOSITIONS_DE_LIEU.has(normaliser(jetons[i - 1]));
      elements.push({ mot: n, type: lieu ? "lieu" : "nom_propre" });
      return;
    }
    elements.push({ mot: n, type: "mot" });
  });
  return elements;
}

function present(element, liste, ensemble) {
  if (element.type === "annee" || element.type === "nombre") return presentNombre(element.mot, liste);
  if (element.type === "lieu" || element.type === "nom_propre") return presentNomPropre(element.mot, ensemble);
  return presentMot(element.mot, liste, ensemble);
}

const CODE_ABSENT = { annee: "annee_absente", nombre: "nombre_absent", lieu: "lieu_absent", nom_propre: "nom_propre_absent", mot: "mot_absent" };

function contientMotOuSuite(listeMots, comparable, terme, { famille }) {
  if (terme.includes(" ")) return comparable.includes(` ${terme} `);
  return listeMots.some((m) => (famille ? memeFamille(m, terme) : m === terme));
}

/**
 * Vérifie une accroche non vide.
 * @param {{ accroche: string, source?: { url?: unknown, extrait?: unknown } | null }} reponse
 * @param {ReturnType<typeof contexteFiche>} ctx
 * @param {ReturnType<typeof preparerRegles>} regles
 * @returns {{ motifs: { code: string, detail?: string }[], page: { url: string, lu_le?: string } | null, extrait: string | null }}
 */
export function verifierAccroche(reponse, ctx, regles) {
  const motifs = [];
  const signaler = (code, detail) => {
    if (!motifs.some((m) => m.code === code && m.detail === detail)) motifs.push(detail ? { code, detail } : { code });
  };
  const accroche = String(reponse.accroche ?? "").trim();

  // 1) La forme : une phrase, bornée.
  const nombreMots = accroche.split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length;
  if (nombreMots < regles.motsMin || nombreMots > regles.motsMax) signaler("longueur", `${nombreMots} mots`);
  if (accroche.length > regles.caracteresMax) signaler("longueur", `${accroche.length} caractères`);
  if (!/^[«"“]?\s*\p{Lu}/u.test(accroche)) signaler("phrase", "majuscule");
  if (!/[.?!][»"”]?$/u.test(accroche)) signaler("phrase", "ponctuation finale");
  if (/[.?!…]\s+[«"“]?\p{Lu}/u.test(accroche.replace(/[.?!][»"”]?$/u, "")) || /\n/.test(accroche)) signaler("phrase", "plusieurs phrases");
  if (/\p{Extended_Pictographic}/u.test(accroche)) signaler("phrase", "emoji");
  if (/[—–]/u.test(accroche)) signaler("tiret");

  // 2) Ce qui ne se dit jamais.
  const listeMots = mots(accroche);
  const comparable = ` ${listeMots.join(" ")} `;
  if (regles.promesses.some((m) => new RegExp(m.source, m.flags.replace("g", "")).test(accroche))) signaler("promesse", "garde-fou de la config");
  if (CHIFFRES_DE_RESULTAT.some((m) => m.test(accroche))) signaler("promesse", "chiffre de résultat");
  const promesse = PROMESSES_DE_BASE.find((t) => contientMotOuSuite(listeMots, comparable, pourComparer(t), { famille: false }));
  if (promesse) signaler("promesse", promesse);
  const flatterie = FLATTERIES.find((t) => contientMotOuSuite(listeMots, comparable, t, { famille: false }));
  if (flatterie) signaler("flatterie", flatterie);
  const interdit = regles.interdits.find((t) => contientMotOuSuite(listeMots, comparable, t, { famille: true }));
  if (interdit) signaler("interdit", interdit);

  // 3) La source : une page lue pour cette fiche, et un extrait qui y figure.
  let page = null;
  let extrait = null;
  const source = reponse.source;
  if (!source || typeof source !== "object" || typeof source.url !== "string" || typeof source.extrait !== "string") {
    signaler("source");
  } else {
    extrait = source.extrait.trim();
    const cle = clePage(source.url);
    page = cle ? (ctx.pages.get(cle) ?? null) : null;
    if (!page) signaler("source_hors_crawl");
    if (extrait.length < EXTRAIT_MIN || extrait.length > EXTRAIT_MAX) signaler("extrait", `${extrait.length} caractères`);
    else if (page && !contientPassage(page.texte, extrait)) signaler("extrait_absent");
  }

  // 4) Rien d'inventé : chaque élément figure dans le texte compacté du site.
  const elements = elementsAVerifier(accroche);
  if (elements.length === 0) signaler("aucun_element");
  for (const e of elements) {
    if (!present(e, ctx.motsSite, ctx.ensembleSite)) signaler(CODE_ABSENT[e.type], e.mot);
  }
  if (elements.length > 0 && extrait && page && !motifs.some((m) => m.code === "extrait_absent" || m.code === "extrait")) {
    const motsExtrait = [...new Set(mots(extrait))];
    const ensembleExtrait = new Set(motsExtrait);
    if (!elements.some((e) => present(e, motsExtrait, ensembleExtrait))) signaler("extrait_sans_rapport");
  }

  // 5) Un superlatif ou un rang ne se dit que si l'extrait le dit (« le plus grand », « votre premier chantier »).
  const motsDeLExtrait = extrait ? mots(extrait) : [];
  const extraitComparable = ` ${motsDeLExtrait.join(" ")} `;
  for (const s of SUPERLATIFS) {
    if (contientMotOuSuite(listeMots, comparable, s, { famille: false }) && !contientMotOuSuite(motsDeLExtrait, extraitComparable, s, { famille: false })) {
      signaler("superlatif_absent", s);
    }
  }

  return { motifs, page, extrait };
}

/** La date (AAAA-MM-JJ) d'un instant, dans le fuseau de l'équipe. */
export function dateDansFuseau(instant, fuseau) {
  const d = instant ? new Date(instant) : new Date();
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parties.year}-${parties.month}-${parties.day}`;
}

/**
 * Valide toutes les réponses. Chaque fiche répondue sort UNE fois : accroche retenue (avec sa source datée), ou vidée (avec ses motifs
 * et le texte refusé, pour la relecture), ou sans accroche (Claude n'a rien trouvé de précis).
 * @param {unknown[]} reponses les entrées des fichiers de réponses, dans l'ordre des lots
 * @param {{ compacts: Map<string, any>, crawls: Map<string, any>, regles: ReturnType<typeof preparerRegles>, fuseau: string }} donnees
 */
export function validerReponses(reponses, { compacts, crawls, regles, fuseau }) {
  const validees = [];
  const compteurs = { lues: 0, retenues: 0, videes: 0, sansAccroche: 0, inconnues: 0, doublons: 0, malFormees: 0, motifs: {} };
  const vus = new Set();
  for (const r of reponses) {
    compteurs.lues++;
    if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.id !== "string") {
      compteurs.malFormees++;
      continue;
    }
    const id = r.id.trim();
    if (!crawls.has(id)) {
      compteurs.inconnues++;
      continue;
    }
    if (vus.has(id)) {
      compteurs.doublons++;
      continue;
    }
    vus.add(id);
    const crawl = crawls.get(id);
    if (r.accroche !== undefined && r.accroche !== null && typeof r.accroche !== "string") {
      validees.push({ id, accroche: "", source: null, motifs: [{ code: "format" }] });
      compteurs.videes++;
      compteurs.motifs.format = (compteurs.motifs.format ?? 0) + 1;
      continue;
    }
    const accroche = typeof r.accroche === "string" ? r.accroche.trim() : "";
    if (!accroche) {
      validees.push({ id, accroche: "", source: null, motifs: [] });
      compteurs.sansAccroche++;
      continue;
    }
    const { motifs, page, extrait } = verifierAccroche({ accroche, source: r.source }, contexteFiche(compacts.get(id), crawl), regles);
    if (motifs.length > 0) {
      validees.push({ id, accroche: "", source: null, motifs, refusee: accroche });
      compteurs.videes++;
      for (const code of new Set(motifs.map((m) => m.code))) compteurs.motifs[code] = (compteurs.motifs[code] ?? 0) + 1;
      continue;
    }
    validees.push({
      id,
      accroche,
      source: { url: page.url, extrait, le: dateDansFuseau(page.lu_le, fuseau) },
      site: crawl.site,
      ...(crawl.origine ? { origine: crawl.origine } : {}),
      motifs: [],
    });
    compteurs.retenues++;
  }
  return { validees, compteurs };
}
