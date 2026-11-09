// Un texte du script : le texte de la config, et chaque crochet rempli mis en évidence (une valeur inconnue, en orange : à dire soi-même).

import type { Segment } from "@/lib/poste/script";

export function Segments({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (!s.crochet) return <span key={i}>{s.texte}</span>;
        if (s.texte === "") return null;
        return (
          <mark
            key={i}
            title={s.manquant ? `${s.crochet} : inconnu sur cette fiche` : s.crochet}
            className={
              s.manquant
                ? "rounded bg-amber-100 px-0.5 text-amber-950 dark:bg-amber-900/60 dark:text-amber-100"
                : "rounded bg-accent/15 px-0.5 font-medium text-inherit"
            }
          >
            {s.texte}
          </mark>
        );
      })}
    </>
  );
}
