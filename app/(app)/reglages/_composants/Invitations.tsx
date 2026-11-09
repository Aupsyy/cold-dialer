"use client";

// Les invitations (gestionnaires) : en créer une (rôle, e-mail ou nom), dont le lien /signup?invitation=<jeton> est montré UNE seule
// fois, avec un bouton Copier ; la liste des invitations en attente, SANS leur jeton, avec leur date d'expiration ; les révoquer. Rien
// n'est envoyé à personne : le lien se transmet à la main. Il n'est jamais journalisé.

import { useRef, useState } from "react";
import { CLASSES_CHAMP, Pastille, classesBouton } from "@/app/_ui/elements";
import { lienInvitation } from "@/lib/reglages/libelles";
import { LIBELLES_ROLE, type Role } from "@/lib/roles";
import { creerInvitation, revoquerInvitation } from "../actions";
import { MessageGeste, soumettre, useGeste } from "./geste";

export interface InvitationVue {
  id: string;
  role: Role;
  pour: string;
  expiree: boolean;
  /** « expire le … » ou « expirée le … », à l'heure de l'équipe. */
  expiration: string;
}

function LigneInvitation({ inv }: { inv: InvitationVue }) {
  const { enCours, message, lancer } = useGeste();

  function revoquer() {
    const question = inv.expiree
      ? `Retirer l'invitation expirée (${inv.pour}) ?`
      : `Révoquer l'invitation de ${inv.pour} ? Le lien cessera de marcher tout de suite.`;
    if (!window.confirm(question)) return;
    lancer(() => revoquerInvitation({ invitationId: inv.id }), () => null);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium break-words">{inv.pour}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-stone-600 dark:text-stone-400">
          <Pastille>{LIBELLES_ROLE[inv.role]}</Pastille>
          {inv.expiree ? <Pastille ton="attention">Expirée</Pastille> : null}
          <span>{inv.expiration}</span>
        </p>
        <MessageGeste message={message} />
      </div>
      <button type="button" disabled={enCours} onClick={revoquer} className={classesBouton("danger", "sm")}>
        {inv.expiree ? "Retirer" : "Révoquer"}
      </button>
    </li>
  );
}

export function Invitations({
  invitations,
  roles,
  dureeJours,
}: {
  invitations: readonly InvitationVue[];
  roles: readonly Role[];
  dureeJours: number;
}) {
  const { enCours, message, setMessage, lancer } = useGeste();
  const [lien, setLien] = useState<string | null>(null);
  const formulaire = useRef<HTMLFormElement>(null);

  function creer(formData: FormData) {
    const saisie = {
      role: String(formData.get("role") ?? ""),
      email: String(formData.get("email") ?? ""),
      nom: String(formData.get("nom") ?? ""),
    };
    setLien(null);
    lancer(
      () => creerInvitation(saisie),
      (d) => {
        const l = lienInvitation(window.location.origin, d.jeton);
        setLien(l);
        formulaire.current?.reset();
        return l ? null : "Invitation créée, mais son lien n'a pas pu être construit sur cette adresse : révoque-la et recommence depuis l'adresse de l'instance.";
      },
    );
  }

  async function copier() {
    if (!lien) return;
    try {
      await navigator.clipboard.writeText(lien);
      setMessage({ ok: true, texte: "Lien copié." });
    } catch {
      setMessage({ ok: false, texte: "Copie impossible : sélectionne le lien et copie-le à la main." });
    }
  }

  return (
    <div className="space-y-5">
      <form ref={formulaire} onSubmit={soumettre(creer)} className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor="invitation-role" className="block text-sm font-medium">
            Rôle
          </label>
          <select id="invitation-role" name="role" defaultValue="appelant" className={CLASSES_CHAMP}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {LIBELLES_ROLE[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invitation-email" className="block text-sm font-medium">
            E-mail (facultatif)
          </label>
          <input id="invitation-email" name="email" type="email" maxLength={254} autoComplete="off" className={CLASSES_CHAMP} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invitation-nom" className="block text-sm font-medium">
            Nom (facultatif)
          </label>
          <input id="invitation-nom" name="nom" maxLength={120} autoComplete="off" className={CLASSES_CHAMP} />
        </div>
        <button type="submit" disabled={enCours} className={classesBouton("principal")}>
          {enCours ? "Création…" : "Créer le lien"}
        </button>
      </form>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Il faut l&apos;e-mail ou le nom. Avec un e-mail, seule cette adresse peut s&apos;inscrire ; sans, la personne choisit la sienne. Le lien
        vaut {dureeJours} jours et ne sert qu&apos;une fois.
      </p>

      {lien ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <label htmlFor="invitation-lien" className="block text-sm font-medium">
            Le lien d&apos;inscription (montré une seule fois)
          </label>
          <div className="flex gap-2">
            <input id="invitation-lien" readOnly value={lien} onFocus={(e) => e.currentTarget.select()} className={`${CLASSES_CHAMP} text-sm`} />
            <button type="button" onClick={copier} className={classesBouton("secondaire")}>
              Copier
            </button>
          </div>
          <p className="text-xs text-amber-900 dark:text-amber-100">
            Transmets-le toi-même à la personne : l&apos;application n&apos;envoie rien. Qui a ce lien peut créer un compte dans ton équipe : ne le
            publie nulle part. Perdu ? Révoque l&apos;invitation et crée-en une autre.
          </p>
          <button type="button" onClick={() => setLien(null)} className={classesBouton("discret", "sm")}>
            J&apos;ai transmis le lien : le masquer
          </button>
        </div>
      ) : null}
      <MessageGeste message={message} />

      <div>
        <h3 className="text-sm font-semibold">En attente</h3>
        {invitations.length === 0 ? (
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">Aucune invitation en attente.</p>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {invitations.map((inv) => (
              <LigneInvitation key={inv.id} inv={inv} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
