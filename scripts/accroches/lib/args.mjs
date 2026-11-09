// Lecture des options de la ligne de commande, commune aux scripts des accroches.
//   --drapeau          → true
//   --nom valeur       → "valeur"
//   --nom=valeur       → "valeur"
// Une option inconnue est refusée (une faute de frappe ne doit jamais passer pour « l'option par défaut », surtout pour --appliquer).

export class ErreurOptions extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurOptions";
  }
}

/**
 * @param {string[]} argv les arguments après le nom du script
 * @param {{ drapeaux?: string[], valeurs?: string[] }} attendu les noms permis (sans les deux tirets)
 * @returns {Record<string, string | boolean>}
 */
export function lireOptions(argv, { drapeaux = [], valeurs = [] } = {}) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const brut = argv[i];
    if (!brut.startsWith("--")) throw new ErreurOptions(`argument inattendu : ${brut} (les options commencent par --)`);
    const egal = brut.indexOf("=");
    const nom = egal === -1 ? brut.slice(2) : brut.slice(2, egal);
    if (drapeaux.includes(nom)) {
      if (egal !== -1) throw new ErreurOptions(`--${nom} ne prend pas de valeur`);
      options[nom] = true;
    } else if (valeurs.includes(nom)) {
      const valeur = egal === -1 ? argv[++i] : brut.slice(egal + 1);
      if (valeur === undefined || valeur === "" || (egal === -1 && valeur.startsWith("--"))) {
        throw new ErreurOptions(`--${nom} attend une valeur`);
      }
      options[nom] = valeur;
    } else {
      const permises = [...drapeaux, ...valeurs].map((n) => `--${n}`).join(", ") || "aucune";
      throw new ErreurOptions(`option inconnue : --${nom} (permises : ${permises})`);
    }
  }
  return options;
}

/** Un entier positif lu dans une option, borné ; la valeur par défaut si l'option est absente. */
export function entier(options, nom, { defaut, min = 1, max = Number.MAX_SAFE_INTEGER }) {
  if (options[nom] === undefined) return defaut;
  const n = Number(options[nom]);
  if (!Number.isInteger(n) || n < min || n > max) throw new ErreurOptions(`--${nom} : un entier de ${min} à ${max}`);
  return n;
}

/** Une liste séparée par des virgules (« A,B »), sans éléments vides. */
export function liste(options, nom) {
  if (options[nom] === undefined) return null;
  const elements = String(options[nom])
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (elements.length === 0) throw new ErreurOptions(`--${nom} : au moins une valeur`);
  return elements;
}
