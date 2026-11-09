// Les trois rôles d'une équipe. Une équipe par instance ; chaque compte appartient à une seule équipe (profiles.workspace_id).
//   - proprietaire : tout, dont l'équipe, les invitations et les réglages ;
//   - membre : tout sauf changer les rôles, retirer quelqu'un ou effacer une fiche ;
//   - appelant : le Poste, ses fiches et les fiches non attribuées de la file ; ni réglages, ni invitations.

export const ROLES = ["proprietaire", "membre", "appelant"] as const;
export type Role = (typeof ROLES)[number];

export const LIBELLES_ROLE: Readonly<Record<Role, string>> = {
  proprietaire: "Propriétaire",
  membre: "Membre",
  appelant: "Appelant",
};

export function estRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Propriétaire ou membre : ceux qui gèrent les réglages et les invitations. */
export function estGestionnaire(role: Role | null): boolean {
  return role === "proprietaire" || role === "membre";
}
