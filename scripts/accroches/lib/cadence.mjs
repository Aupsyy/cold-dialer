// La cadence : une requête par seconde au plus par domaine (le domaine sans « www. »), partagée par tous les sites lus en parallèle.
// Un Crawl-delay plus long, lu dans robots.txt, ralentit ce domaine. L'horloge est injectable : les tests n'attendent pas vraiment.

export const INTERVALLE_MS = 1000;

export function horlogeReelle() {
  return {
    maintenant: () => Date.now(),
    attendre: (ms) => new Promise((resoudre) => setTimeout(resoudre, ms)),
  };
}

/** Le domaine d'une adresse, pour la cadence : « www.example.org » et « example.org » partagent leur tour. */
export function domaine(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

export function creerCadence({ intervalleMs = INTERVALLE_MS, horloge = horlogeReelle() } = {}) {
  const prochains = new Map();
  const intervalles = new Map();
  const intervalle = (d) => intervalles.get(d) ?? intervalleMs;
  return {
    /** Réserve le prochain créneau du domaine (les appels concurrents passent l'un après l'autre), puis attend qu'il arrive. */
    async attendreTour(d) {
      const maintenant = horloge.maintenant();
      const creneau = Math.max(maintenant, prochains.get(d) ?? -Infinity);
      prochains.set(d, creneau + intervalle(d));
      if (creneau > maintenant) await horloge.attendre(creneau - maintenant);
    },
    /** Espace davantage les requêtes d'un domaine (jamais moins que l'intervalle de base). */
    ralentir(d, ms) {
      const ancien = intervalle(d);
      const nouveau = Math.max(intervalleMs, ms);
      if (nouveau <= ancien) return;
      intervalles.set(d, nouveau);
      if (prochains.has(d)) prochains.set(d, prochains.get(d) - ancien + nouveau);
    },
  };
}
