"use client";

// L'équipe (gestionnaires) : chaque compte, son e-mail, son rôle et son e-mail chez le fournisseur de téléphonie. Le propriétaire change
// les rôles et retire un compte (jamais le sien : la base le refuse aussi, l'équipe garde toujours un propriétaire). Un retrait et un
// changement qui touche au rôle de propriétaire se confirment.

import { useState } from "react";
import { CLASSES_CHAMP, Pastille, classesBouton } from "@/app/_ui/elements";
import { LIBELLES_ROLE, ROLES, estRole, type Role } from "@/lib/roles";
import { changerRole, definirEmailTelephonie, retirerMembre } from "../actions";
import { MessageGeste, soumettre, useGeste } from "./geste";

export interface MembreVue {
  id: string;
  nom: string;
  email: string | null;
  role: Role;
  emailTelephonie: string | null;
  estMoi: boolean;
}

interface Outil {
  nom: string;
  aWebhook: boolean;
}

function confirmationRole(m: MembreVue, nouveau: Role): string | null {
  if (nouveau === "proprietaire") {
    return `${m.nom} deviendra propriétaire : il pourra changer les rôles, retirer quelqu'un (toi compris) et effacer des fiches. Continuer ?`;
  }
  if (m.role === "proprietaire") return `${m.nom} ne sera plus propriétaire. Continuer ?`;
  return null;
}

function LigneMembre({ m, proprietaire, outil }: { m: MembreVue; proprietaire: boolean; outil: Outil }) {
  const { enCours, message, lancer } = useGeste();
  const [role, setRole] = useState<Role>(m.role);

  function choisirRole(valeur: string) {
    if (!estRole(valeur) || valeur === m.role) return;
    const question = confirmationRole(m, valeur);
    if (question && !window.confirm(question)) {
      setRole(m.role);
      return;
    }
    setRole(valeur);
    lancer(() => changerRole({ membreId: m.id, role: valeur }), () => `Rôle changé : ${LIBELLES_ROLE[valeur].toLowerCase()}.`, {
      siEchec: () => setRole(m.role),
    });
  }

  function retirer() {
    const question = `Retirer ${m.nom} de l'équipe ? Son compte de connexion reste, sans plus aucun accès ; ses fiches reviennent dans la file commune. Pour revenir, il lui faudra une nouvelle invitation.`;
    if (!window.confirm(question)) return;
    lancer(() => retirerMembre({ membreId: m.id }), () => null);
  }

  function poserEmail(formData: FormData) {
    const email = String(formData.get("email") ?? "");
    lancer(
      () => definirEmailTelephonie({ membreId: m.id, email }),
      () => (email.trim() ? `E-mail chez ${outil.nom} enregistré.` : `E-mail chez ${outil.nom} effacé : le compte est reconnu par son e-mail de connexion.`),
    );
  }

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">
            {m.nom} {m.estMoi ? <Pastille ton="accent">toi</Pastille> : null}
          </p>
          <p className="text-sm break-words text-stone-600 dark:text-stone-400">{m.email ?? "E-mail inconnu"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {proprietaire && !m.estMoi ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Rôle de {m.nom}</span>
              <select disabled={enCours} value={role} onChange={(e) => choisirRole(e.target.value)} className={`${CLASSES_CHAMP} py-1.5 text-sm`}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {LIBELLES_ROLE[r]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Pastille ton={m.role === "proprietaire" ? "accent" : "neutre"}>{LIBELLES_ROLE[m.role]}</Pastille>
          )}
          {proprietaire && !m.estMoi ? (
            <button type="button" disabled={enCours} onClick={retirer} className={classesBouton("danger", "sm")}>
              Retirer
            </button>
          ) : null}
        </div>
      </div>
      {outil.aWebhook ? (
        <form onSubmit={soumettre(poserEmail)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1">
            <label htmlFor={`tel-${m.id}`} className="block text-xs font-medium text-stone-600 dark:text-stone-400">
              E-mail chez {outil.nom} (vide : le même que l&apos;e-mail de connexion)
            </label>
            <input
              id={`tel-${m.id}`}
              name="email"
              type="email"
              maxLength={254}
              defaultValue={m.emailTelephonie ?? ""}
              autoComplete="off"
              className={`${CLASSES_CHAMP} py-1.5 text-sm`}
            />
          </div>
          <button type="submit" disabled={enCours} className={classesBouton("secondaire", "sm")}>
            Enregistrer
          </button>
        </form>
      ) : null}
      <MessageGeste message={message} />
    </li>
  );
}

export function Equipe({ membres, proprietaire, outil }: { membres: readonly MembreVue[]; proprietaire: boolean; outil: Outil }) {
  return (
    <div className="space-y-3">
      {outil.aWebhook ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Chaque appel arrive de {outil.nom} avec l&apos;e-mail de l&apos;appelant chez {outil.nom} : c&apos;est ainsi qu&apos;il lui est attribué (et
          que son annonce d&apos;enregistrement couvre son appel). Si cet e-mail n&apos;est pas son e-mail de connexion, renseigne-le ici, sinon
          l&apos;appel n&apos;est rattaché à personne. Un même e-mail ne peut désigner qu&apos;un seul compte.
        </p>
      ) : null}
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {membres.map((m) => (
          <LigneMembre key={m.id} m={m} proprietaire={proprietaire} outil={outil} />
        ))}
      </ul>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        {proprietaire
          ? "Tu ne peux ni changer ton propre rôle ni te retirer : l'équipe garde toujours un propriétaire. Un compte retiré garde son accès de connexion, sans plus rien voir ; tu peux le supprimer dans Supabase (Authentication, Users)."
          : "Seul le propriétaire change les rôles et retire un compte."}
      </p>
    </div>
  );
}
