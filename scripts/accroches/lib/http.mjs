// Lire une adresse : délai d'attente de 10 s (lecture du corps comprise), 1 Mo au plus (au-delà, la page est tronquée et le
// téléchargement arrêté), redirections rendues à l'appelant (qui vérifie qu'elles restent sur le site et dans robots.txt), jeu de
// caractères respecté (UTF-8, ou ISO-8859-1 / Windows-1252 des sites anciens). fetch est injectable (tests sans réseau).

export const DELAI_MS = 10_000;
export const TAILLE_MAX = 1_000_000;
export const TYPES_HTML = /^(text\/html|application\/xhtml\+xml)\b/i;

async function abandonner(reponse) {
  try {
    await reponse.body?.cancel();
  } catch {
    // déjà fermé
  }
}

async function lireCorps(reponse, tailleMax) {
  const lecteur = reponse.body?.getReader?.();
  if (!lecteur) {
    const tout = new Uint8Array(await reponse.arrayBuffer());
    return { octets: tout.subarray(0, tailleMax), tronque: tout.length > tailleMax };
  }
  const morceaux = [];
  let total = 0;
  let tronque = false;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    if (total + value.length > tailleMax) {
      morceaux.push(value.subarray(0, tailleMax - total));
      total = tailleMax;
      tronque = true;
      await lecteur.cancel().catch(() => {});
      break;
    }
    morceaux.push(value);
    total += value.length;
  }
  const octets = new Uint8Array(total);
  let position = 0;
  for (const m of morceaux) {
    octets.set(m, position);
    position += m.length;
  }
  return { octets, tronque };
}

function decoderOctets(octets, typeContenu) {
  let jeu = /charset\s*=\s*["']?([\w-]+)/i.exec(typeContenu ?? "")?.[1];
  if (!jeu) {
    const tete = new TextDecoder("windows-1252").decode(octets.subarray(0, 4096));
    jeu = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(tete)?.[1];
  }
  try {
    return new TextDecoder(jeu || "utf-8").decode(octets);
  } catch {
    return new TextDecoder("utf-8").decode(octets);
  }
}

/**
 * @returns {Promise<{ statut: number, texte?: string, tronque?: boolean, redirection?: string | null, erreur?: string }>}
 *   statut 0 : pas de réponse (erreur « reseau » ou « delai ») ; 3xx : redirection (adresse absolue, ou null) ; erreur « type » : ce
 *   n'est pas une page HTML.
 */
export async function telecharger(url, { fetch: lire = globalThis.fetch, userAgent, delaiMs = DELAI_MS, tailleMax = TAILLE_MAX, types = TYPES_HTML } = {}) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);
  try {
    const reponse = await lire(url, {
      method: "GET",
      redirect: "manual",
      signal: controleur.signal,
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
      },
    });
    const statut = reponse.status;
    if (statut >= 300 && statut < 400) {
      const location = reponse.headers.get("location");
      await abandonner(reponse);
      let redirection = null;
      try {
        redirection = location ? new URL(location, url).href : null;
      } catch {
        redirection = null;
      }
      return { statut, redirection };
    }
    if (statut < 200 || statut >= 300) {
      await abandonner(reponse);
      return { statut, erreur: `http_${statut}` };
    }
    const type = reponse.headers.get("content-type") ?? "";
    if (types && type && !types.test(type.trim())) {
      await abandonner(reponse);
      return { statut, erreur: "type" };
    }
    const { octets, tronque } = await lireCorps(reponse, tailleMax);
    return { statut, texte: decoderOctets(octets, type), tronque };
  } catch {
    return { statut: 0, erreur: controleur.signal.aborted ? "delai" : "reseau" };
  } finally {
    clearTimeout(minuteur);
  }
}
