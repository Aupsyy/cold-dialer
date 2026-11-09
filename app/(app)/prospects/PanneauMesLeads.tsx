"use client";

// « Mes leads » : prendre d'un coup des fiches libres (tier, départements, ville) et rendre celles que je n'ai jamais appelées. Utilisé par la
// liste des prospects et par le Poste quand la file est vide.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { prendreMesLeads, rendreMesLeads, type EtatMesLeads } from "@/app/_actions/mes-leads";
import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";
import { NOMBRES_PRISE } from "@/lib/poste/mes-leads";

export function PanneauMesLeads({ etat }: { etat: EtatMesLeads | null }) {
  const router = useRouter();
  const [nombre, setNombre] = useState<number>(25);
  const [tiers, setTiers] = useState<("A" | "B" | "C")[]>([]);
  const [departements, setDepartements] = useState("");
  const [ville, setVille] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ton: "ok" | "erreur"; texte: string } | null>(null);

  async function prendre() {
    setEnCours(true);
    setMessage(null);
    try {
      const r = await prendreMesLeads({ nombre, tiers, departements, ville });
      if (!r.ok) setMessage({ ton: "erreur", texte: r.error });
      else {
        const { attribuees, demandees } = r.data;
        setMessage({
          ton: "ok",
          texte:
            attribuees === 0
              ? "Aucune fiche libre ne correspond à ces filtres."
              : `${attribuees} fiche${attribuees > 1 ? "s" : ""} à ton nom${attribuees < demandees ? ` (sur ${demandees} demandées : il n'y en avait pas plus de libres)` : ""}.`,
        });
        router.refresh();
      }
    } catch {
      setMessage({ ton: "erreur", texte: "Connexion impossible : réessaie dans un instant." });
    }
    setEnCours(false);
  }

  async function rendre() {
    setEnCours(true);
    setMessage(null);
    try {
      const r = await rendreMesLeads();
      if (!r.ok) setMessage({ ton: "erreur", texte: r.error });
      else {
        setMessage({ ton: "ok", texte: `${r.data.rendues} fiche${r.data.rendues > 1 ? "s" : ""} rendue${r.data.rendues > 1 ? "s" : ""} à la file commune.` });
        router.refresh();
      }
    } catch {
      setMessage({ ton: "erreur", texte: "Connexion impossible : réessaie dans un instant." });
    }
    setEnCours(false);
  }

  return (
    <div className="space-y-3">
      {etat ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          À ton nom : <strong className="text-stone-900 dark:text-stone-100">{etat.mesFiches}</strong> fiche{etat.mesFiches > 1 ? "s" : ""} dans la file
          (dont {etat.jamaisAppelees} jamais appelée{etat.jamaisAppelees > 1 ? "s" : ""}) · libres : {etat.libres}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-xs font-medium">Combien</span>
          <select value={nombre} onChange={(e) => setNombre(Number(e.target.value))} className={CLASSES_CHAMP}>
            {NOMBRES_PRISE.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Tier</legend>
          <div className="flex gap-1">
            {(["A", "B", "C"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tiers.includes(t)}
                onClick={() => setTiers((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                className={classesBouton(tiers.includes(t) ? "principal" : "secondaire", "sm")}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="space-y-1">
          <span className="block text-xs font-medium">Départements</span>
          <input value={departements} onChange={(e) => setDepartements(e.target.value)} placeholder="69, 38" className={`${CLASSES_CHAMP} w-28`} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium">Ville</span>
          <input value={ville} onChange={(e) => setVille(e.target.value)} placeholder="Lyon" className={`${CLASSES_CHAMP} w-36`} />
        </label>
        <button type="button" onClick={() => void prendre()} disabled={enCours} className={classesBouton("principal")}>
          Prendre ces fiches
        </button>
        <button type="button" onClick={() => void rendre()} disabled={enCours} className={classesBouton("discret", "sm")}>
          Rendre mes fiches jamais appelées
        </button>
      </div>
      {message ? (
        <p role={message.ton === "erreur" ? "alert" : "status"} className={`text-sm ${message.ton === "erreur" ? "text-red-800 dark:text-red-200" : "text-emerald-800 dark:text-emerald-200"}`}>
          {message.texte}
        </p>
      ) : null}
    </div>
  );
}
