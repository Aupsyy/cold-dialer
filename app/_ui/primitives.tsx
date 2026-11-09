// Les briques d'interface partagées : carte, champ, avis, lien. Sobres, lisibles au téléphone, en mode clair et sombre.

import Link from "next/link";
import type { ReactNode } from "react";

export function Carte({ titre, sousTitre, children }: { titre: string; sousTitre?: string; children: ReactNode }) {
  return (
    <section className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h1 className="text-xl font-semibold tracking-tight">{titre}</h1>
      {sousTitre ? <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{sousTitre}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function Champ({
  libelle,
  name,
  type = "text",
  autoComplete,
  requis = false,
  valeurParDefaut,
  aide,
  minLength,
  maxLength,
}: {
  libelle: string;
  name: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  requis?: boolean;
  valeurParDefaut?: string;
  aide?: string;
  minLength?: number;
  maxLength?: number;
}) {
  const id = `champ-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {libelle}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={requis}
        defaultValue={valeurParDefaut}
        minLength={minLength}
        maxLength={maxLength}
        aria-describedby={aide ? `${id}-aide` : undefined}
        className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-accent dark:border-stone-700 dark:bg-stone-950"
      />
      {aide ? (
        <p id={`${id}-aide`} className="text-xs text-stone-500 dark:text-stone-400">
          {aide}
        </p>
      ) : null}
    </div>
  );
}

export function Avis({ ton, children }: { ton: "ok" | "erreur" | "info"; children: ReactNode }) {
  const couleurs = {
    ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
    erreur: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
    info: "border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100",
  }[ton];
  return (
    <p role={ton === "erreur" ? "alert" : "status"} className={`mb-4 rounded-lg border px-3 py-2 text-sm ${couleurs}`}>
      {children}
    </p>
  );
}

export function LienTexte({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-accent underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
