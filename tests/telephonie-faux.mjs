// Les faux objets des tests de téléphonie (pas un fichier de test : il est importé par tests/telephonie-*.test.mjs) : une fausse base
// (evenement_appel idempotent, état de récupération, enregistrement et transcription), un faux fetch, un faux navigateur (fenêtre,
// document, éléments, MutationObserver, iframe et ses messages). Aucune donnée réelle : identifiants inventés, numéros de la plage
// réservée à la fiction (01 99 00, 06 39 98), e-mails en example.com.

export const WS = "0f0e0d0c-0000-4000-8000-000000000001";
export const ID_APPEL = "0a0b0c0d-0000-4000-8000-000000000009";
export const LEAD = "0a0b0c0d-0000-4000-8000-000000000002";
export const APPELANT = "0a0b0c0d-0000-4000-8000-000000000003";
export const EMAIL = "appelant.demo@example.com";
export const NUMERO_FIXE = "+33199000101";
export const NUMERO_MOBILE = "+33639980102";

/** Les variables de la base (fausses valeurs, à faible entropie). */
export const ENV_BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://projet-test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "cle-service-de-test",
};

export const octets = (o) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));

/**
 * Une fausse base. evenement_appel : une ligne par (fournisseur, externeId), « nouveau » la première fois seulement ; conserver : ce
 * que la base répond pour conserverAudio ; refuserAudio : enregistrement_appel refuse ; erreur : chaque appel échoue.
 */
export function fausseBase({ conserver = true, refuserAudio = false, erreur = null, maintenant = () => Date.parse("2026-11-09T10:00:00Z") } = {}) {
  const appels = new Map();
  const rpcs = [];
  const rpc = async (fonction, args) => {
    rpcs.push({ fonction, args: structuredClone(args) });
    if (erreur) return { data: null, error: erreur };
    const cle = (f, x) => `${f}:${x}`;
    if (fonction === "evenement_appel") {
      const e = args.p_evenement;
      const k = cle(e.fournisseur, e.externeId);
      const nouveau = !appels.has(k);
      if (nouveau) appels.set(k, { chemin: null, transcription: null, resume: null, tentatives: 0, derniere: null, evenements: 0 });
      appels.get(k).evenements += 1;
      return { data: { id: ID_APPEL, workspaceId: WS, leadId: LEAD, appelantId: APPELANT, nouveau, conserverAudio: conserver }, error: null };
    }
    const a = appels.get(cle(args.p_fournisseur, args.p_externe_id));
    if (fonction === "etat_recuperation_appel") {
      if (!a) return { data: { existe: false }, error: null };
      if (args.p_compter) {
        a.tentatives += 1;
        a.derniere = new Date(maintenant()).toISOString();
      }
      return {
        data: {
          existe: true,
          workspaceId: WS,
          conserverAudio: conserver,
          aEnregistrement: a.chemin !== null,
          aTranscription: a.transcription !== null || a.resume !== null,
          tentatives: a.tentatives,
          derniereTentative: a.derniere,
        },
        error: null,
      };
    }
    if (fonction === "enregistrement_appel") {
      if (!a) return { data: { garde: false, raison: "appel_inconnu" }, error: null };
      if (refuserAudio || !conserver) return { data: { garde: false, raison: "enregistrement_non_autorise" }, error: null };
      a.chemin = args.p_chemin;
      return { data: { garde: true, raison: null }, error: null };
    }
    if (fonction === "transcription_appel") {
      if (!a) return { data: { garde: false, raison: "appel_inconnu", lignes: 0 }, error: null };
      if (!conserver) return { data: { garde: false, raison: "enregistrement_non_autorise", lignes: 0 }, error: null };
      if (args.p_lignes.length > 0) a.transcription = args.p_lignes;
      if (args.p_resume) a.resume = args.p_resume;
      return { data: { garde: true, raison: null, lignes: args.p_lignes.length }, error: null };
    }
    return { data: null, error: { code: "PGRST202" } };
  };
  /** Ajoute un appel déjà connu (reprise différée). */
  const ajouter = (fournisseur, externeId, champs = {}) =>
    appels.set(cle2(fournisseur, externeId), { chemin: null, transcription: null, resume: null, tentatives: 0, derniere: null, evenements: 1, ...champs });
  const cle2 = (f, x) => `${f}:${x}`;
  return { rpc, rpcs, appels, ajouter, fonctions: () => rpcs.map((r) => r.fonction) };
}

/** Un faux fetch : routes = [[motif (texte contenu dans l'URL, ou RegExp), (url, init) => Response]] ; sinon 404. */
export function fauxFetch(routes = []) {
  const vus = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    vus.push({ url: u, methode: init.method ?? "GET", init });
    for (const [motif, reponse] of routes) {
      if (typeof motif === "string" ? u.includes(motif) : motif.test(u)) return reponse(u, init);
    }
    return new Response("{}", { status: 404 });
  };
  return { f, vus };
}

export const reponseJson = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
export const reponseAudio = (taille = 8, type = "audio/mpeg", entetes = {}) =>
  new Response(new Uint8Array(taille).fill(7), { status: 200, headers: { "content-type": type, "content-length": String(taille), ...entetes } });
/** Le bucket : dépôt et effacement acceptés (les appels sont gardés dans vus). */
export const routesStockage = () => [["/storage/v1/object/enregistrements", () => reponseJson([{ name: "x" }])]];

/** Les dépendances de apres() : le dépôt est enregistré (et peut échouer), l'attente est immédiate (et comptée). */
export function dependances({ base, fetchImpl = fauxFetch().f, env = ENV_BASE, depotOk = true, debut = Date.parse("2026-11-09T10:00:00Z") } = {}) {
  const depots = [];
  const journal = [];
  const attentes = [];
  let horloge = debut;
  const d = {
    env,
    base: () => base.rpc,
    journal: (code, grave = false) => journal.push({ code, grave }),
    fetch: fetchImpl,
    deposer: async (chemin, o, mime) => {
      depots.push({ chemin, taille: o.byteLength, mime });
      return depotOk ? { ok: true } : { ok: false, code: "stockage_403" };
    },
    maintenant: () => horloge,
    attendre: async (ms) => {
      attentes.push(ms);
      horloge += ms;
    },
  };
  return { d, depots, journal, attentes, avancer: (ms) => (horloge += ms) };
}

/** Vérifie qu'aucune ligne du journal ne contient une donnée (numéro, e-mail, URL, secret, identifiant). */
export function journalPropre(assert, lignes, interdits) {
  const tout = lignes.map((l) => (typeof l === "string" ? l : l.code)).join("\n");
  for (const x of interdits) assert.ok(!tout.includes(x), `journal : « ${x} » ne doit pas y figurer`);
  assert.doesNotMatch(tout, /https?:\/\//, "journal : aucune URL");
  assert.doesNotMatch(tout, /@/, "journal : aucun e-mail");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Faux navigateur
// ---------------------------------------------------------------------------------------------------------------------------------

/** Un faux navigateur : fenêtre, document, éléments ; les MutationObserver sont prévenus (en différé) de chaque changement. */
export function fauxNavigateur({ mobile = false, pressePapiers = true } = {}) {
  const ecouteurs = new Map();
  const copies = [];
  const observateurs = new Set();
  let enAttente = false;
  const prevenir = () => {
    if (enAttente) return;
    enAttente = true;
    queueMicrotask(() => {
      enAttente = false;
      for (const o of observateurs) o.cb([], o);
    });
  };

  class FauxEvenement {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
      this.bubbles = init.bubbles ?? false;
      this.cancelable = init.cancelable ?? false;
      this.isTrusted = false;
    }
  }

  const fenetre = {
    navigator: {
      userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile" : "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      clipboard: pressePapiers
        ? {
            writeText: async (t) => {
              copies.push(t);
            },
          }
        : undefined,
    },
    location: { origin: "https://poste.example.org" },
    addEventListener(type, f) {
      if (!ecouteurs.has(type)) ecouteurs.set(type, new Set());
      ecouteurs.get(type).add(f);
    },
    removeEventListener(type, f) {
      ecouteurs.get(type)?.delete(f);
    },
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (id) => clearTimeout(id),
    CustomEvent: FauxEvenement,
    MouseEvent: FauxEvenement,
    MutationObserver: class {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {
        observateurs.add(this);
      }
      disconnect() {
        observateurs.delete(this);
      }
    },
  };

  const document = { defaultView: fenetre };

  class FauxElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.attributs = new Map();
      this.enfants = [];
      this.parent = null;
      this.texte = "";
      this.style = {};
      this.ownerDocument = document;
      this.evenements = [];
      this.ecouteurs = [];
      this.clics = 0;
      if (this.tagName === "IFRAME") {
        this.messages = [];
        this.contentWindow = { postMessage: (message, origine) => this.messages.push({ message, origine }) };
      }
    }
    setAttribute(n, v) {
      this.attributs.set(n, String(v));
      prevenir();
    }
    getAttribute(n) {
      return this.attributs.has(n) ? this.attributs.get(n) : null;
    }
    appendChild(e) {
      e.parent = this;
      this.enfants.push(e);
      prevenir();
      return e;
    }
    remove() {
      if (this.parent) this.parent.enfants = this.parent.enfants.filter((x) => x !== this);
      this.parent = null;
      prevenir();
    }
    get textContent() {
      return this.texte + this.enfants.map((e) => e.textContent).join("");
    }
    set textContent(v) {
      this.texte = String(v);
      this.enfants = [];
      prevenir();
    }
    descendants() {
      return this.enfants.flatMap((e) => [e, ...e.descendants()]);
    }
    correspond(selecteur) {
      if (selecteur.startsWith("[") && selecteur.endsWith("]")) return this.attributs.has(selecteur.slice(1, -1));
      return this.tagName === selecteur.toUpperCase();
    }
    querySelectorAll(selecteur) {
      return this.descendants().filter((e) => e.correspond(selecteur));
    }
    querySelector(selecteur) {
      return this.querySelectorAll(selecteur)[0] ?? null;
    }
    closest(selecteur) {
      if (this.correspond(selecteur)) return this;
      return this.parent ? this.parent.closest(selecteur) : null;
    }
    dispatchEvent(ev) {
      this.evenements.push(ev);
      return true;
    }
    addEventListener(type, f, capture) {
      this.ecouteurs.push({ type, f, capture });
    }
    removeEventListener(type, f) {
      this.ecouteurs = this.ecouteurs.filter((x) => !(x.type === type && x.f === f));
    }
    click() {
      this.clics += 1;
    }
  }

  document.createElement = (tag) => new FauxElement(tag);
  document.body = new FauxElement("body");

  return {
    fenetre,
    document,
    copies,
    /** Un élément du Poste, avec ses attributs data-*. */
    element(attributs = {}) {
      const el = new FauxElement("div");
      for (const [n, v] of Object.entries(attributs)) el.attributs.set(n, v);
      document.body.appendChild(el);
      return el;
    },
    /** Un message reçu par la fenêtre (comme postMessage d'une iframe). */
    emettre(origin, source, data) {
      for (const f of ecouteurs.get("message") ?? []) f({ origin, source, data });
    },
    nombreEcouteurs: (type) => ecouteurs.get(type)?.size ?? 0,
    /** Ce que fait l'extension Onoff : entoure le texte de chaque numéro affiché d'une balise <onoff-telecom-ce-phone-number>. */
    surlignerOnoff(el) {
      for (const span of el.querySelectorAll("[data-telephonie-numero]")) {
        if (span.querySelector("onoff-telecom-ce-phone-number")) continue;
        const balise = new FauxElement("onoff-telecom-ce-phone-number");
        balise.texte = span.texte;
        span.texte = "";
        span.appendChild(balise);
      }
    },
    /** Les événements DOM envoyés sur un élément, d'un type donné. */
    evenementsDe: (el, type) => el.evenements.filter((e) => e.type === type).map((e) => e.detail),
    attendre: (ms = 0) => new Promise((ok) => setTimeout(ok, ms)),
  };
}
