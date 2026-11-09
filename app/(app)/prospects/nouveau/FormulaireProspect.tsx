"use client";

// La saisie manuelle d'un prospect : l'entreprise, au moins un numéro, et la SOURCE des coordonnées (obligatoire, datée du jour : RGPD).
// Tout est revérifié par le serveur (lib/poste/prospect.ts) ; un doublon (même SIREN ou même numéro) ou une fiche de la liste d'opposition
// est refusé par la base.

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { creerProspect } from "@/app/_actions/fiche";
import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";
import { TYPES_SOURCE } from "@/lib/poste/sources";

function Champ({ libelle, name, type = "text", aide, ...reste }: { libelle: string; name: string; type?: string; aide?: string; required?: boolean; inputMode?: "tel" | "email" | "url" | "numeric"; autoComplete?: string; list?: string; maxLength?: number; placeholder?: string; defaultValue?: string }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">
        {libelle}
        {reste.required ? <span className="text-red-700"> *</span> : null}
      </span>
      <input name={name} type={type} className={CLASSES_CHAMP} {...reste} />
      {aide ? <span className="block text-xs text-stone-500 dark:text-stone-400">{aide}</span> : null}
    </label>
  );
}

export function FormulaireProspect({ metiers, attribuerParDefaut }: { metiers: readonly string[]; attribuerParDefaut: boolean }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enCours) return;
    const fd = new FormData(e.currentTarget);
    const v = (cle: string) => String(fd.get(cle) ?? "");
    setEnCours(true);
    setErreur(null);
    try {
      const r = await creerProspect({
        entreprise: v("entreprise"),
        dirigeant: v("dirigeant"),
        telephone: v("telephone"),
        mobile: v("mobile"),
        email: v("email"),
        site: v("site"),
        siren: v("siren"),
        ville: v("ville"),
        cp: v("cp"),
        metier: v("metier"),
        notes: v("notes"),
        attribuer: fd.get("attribuer") === "1",
        source: { type: v("source_type"), url: v("source_url"), precision: v("source_precision") },
      });
      if (r.ok) {
        router.push(`/prospects/${r.data.id}`);
        return;
      }
      setErreur(r.error);
    } catch {
      setErreur("Connexion impossible : rien n'est perdu, réessaie dans un instant.");
    }
    setEnCours(false);
  }

  return (
    <form onSubmit={(e) => void envoyer(e)} className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">L&apos;entreprise</legend>
        <Champ libelle="Nom de l'entreprise" name="entreprise" required maxLength={200} autoComplete="off" />
        <Champ libelle="Dirigeant (prénom puis nom)" name="dirigeant" maxLength={160} autoComplete="off" />
        <Champ libelle="Téléphone" name="telephone" type="tel" inputMode="tel" aide="Au moins un numéro : téléphone ou mobile." autoComplete="off" />
        <Champ libelle="Mobile" name="mobile" type="tel" inputMode="tel" autoComplete="off" />
        <Champ libelle="E-mail" name="email" type="email" inputMode="email" maxLength={254} autoComplete="off" />
        <Champ libelle="Site" name="site" inputMode="url" placeholder="https://…" maxLength={500} autoComplete="off" />
        <Champ libelle="SIREN" name="siren" inputMode="numeric" maxLength={11} autoComplete="off" />
        <Champ libelle="Métier" name="metier" list="metiers-niche" maxLength={80} autoComplete="off" />
        <datalist id="metiers-niche">
          {metiers.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Champ libelle="Ville" name="ville" maxLength={120} autoComplete="off" />
        <Champ libelle="Code postal" name="cp" maxLength={10} autoComplete="off" />
        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-sm font-medium">Note</span>
          <textarea name="notes" rows={3} maxLength={5000} className={CLASSES_CHAMP} />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-stone-200 p-4 sm:grid-cols-2 dark:border-stone-800">
        <legend className="px-1 text-sm font-semibold">D&apos;où viennent ces coordonnées ? (obligatoire)</legend>
        <p className="text-sm text-stone-600 sm:col-span-2 dark:text-stone-400">
          Une source publique, datée du jour : c&apos;est ce que tu répondras si le prospect demande comment tu as eu son numéro. Jamais
          LinkedIn.
        </p>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">
            Source <span className="text-red-700">*</span>
          </span>
          <select name="source_type" required defaultValue="" className={CLASSES_CHAMP}>
            <option value="" disabled>
              Choisis la source
            </option>
            {TYPES_SOURCE.map((t) => (
              <option key={t.code} value={t.code}>
                {t.libelle}
              </option>
            ))}
          </select>
        </label>
        <Champ libelle="Lien de la source (facultatif)" name="source_url" inputMode="url" placeholder="https://…" maxLength={500} autoComplete="off" />
        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-sm font-medium">Précision (obligatoire pour « autre »)</span>
          <input name="source_precision" maxLength={200} className={CLASSES_CHAMP} autoComplete="off" />
        </label>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="attribuer" value="1" defaultChecked={attribuerParDefaut} />
        Me l&apos;attribuer (elle entre dans ma file)
      </label>

      {erreur ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {erreur}
        </p>
      ) : null}
      <button type="submit" disabled={enCours} aria-busy={enCours} className={classesBouton("principal", "lg")}>
        {enCours ? "Enregistrement…" : "Enregistrer le prospect"}
      </button>
    </form>
  );
}
