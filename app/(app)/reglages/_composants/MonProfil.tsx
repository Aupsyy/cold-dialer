"use client";

// Mon profil : mon nom (modifiable : la RLS ne laisse changer que le sien), mon e-mail de connexion, mon rôle et, si l'outil d'appel
// envoie ses appels par webhook, mon e-mail chez ce fournisseur (posé par un gestionnaire : on ne le change pas soi-même).

import { CLASSES_CHAMP, classesBouton } from "@/app/_ui/elements";
import { modifierMonNom } from "../actions";
import { MessageGeste, soumettre, useGeste } from "./geste";

export interface ProfilVue {
  nom: string;
  email: string | null;
  role: string;
  droits: string;
  emailTelephonie: string | null;
}

export function MonProfil({ profil, outil }: { profil: ProfilVue; outil: { nom: string; aWebhook: boolean } }) {
  const { enCours, message, lancer } = useGeste();

  function enregistrer(formData: FormData) {
    const nom = String(formData.get("nom") ?? "");
    lancer(() => modifierMonNom({ nom }), () => "Nom enregistré.");
  }

  return (
    <div className="space-y-4">
      <form onSubmit={soumettre(enregistrer)} className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor="profil-nom" className="block text-sm font-medium">
            Prénom et nom
          </label>
          <input id="profil-nom" name="nom" required maxLength={120} defaultValue={profil.nom} autoComplete="name" className={CLASSES_CHAMP} />
        </div>
        <button type="submit" disabled={enCours} className={classesBouton("secondaire")}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>
      <MessageGeste message={message} />
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className="text-stone-500 dark:text-stone-400">E-mail de connexion</dt>
        <dd className="break-words">{profil.email ?? "Inconnu"}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Rôle</dt>
        <dd>
          <span className="font-medium">{profil.role}</span> : {profil.droits}.
        </dd>
        {outil.aWebhook ? (
          <>
            <dt className="text-stone-500 dark:text-stone-400">E-mail chez {outil.nom}</dt>
            <dd className="break-words">
              {profil.emailTelephonie ?? "Le même que ton e-mail de connexion"}
              <span className="block text-xs text-stone-500 dark:text-stone-400">
                Tes appels te sont attribués par cet e-mail. S&apos;il est différent chez {outil.nom}, un gestionnaire le renseigne ici.
              </span>
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
