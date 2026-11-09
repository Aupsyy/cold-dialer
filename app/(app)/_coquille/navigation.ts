// Les écrans de l'application, dans l'ordre de la barre de navigation. Module PUR.

export interface Onglet {
  href: string;
  libelle: string;
}

export const ONGLETS: readonly Onglet[] = [
  { href: "/poste", libelle: "Poste" },
  { href: "/prospects", libelle: "Prospects" },
  { href: "/agenda", libelle: "Agenda" },
  { href: "/retours", libelle: "Retours" },
  { href: "/reglages", libelle: "Réglages" },
];

export function ongletActif(chemin: string, href: string): boolean {
  return chemin === href || chemin.startsWith(`${href}/`);
}
