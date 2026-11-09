"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ONGLETS, ongletActif } from "./navigation";

export function NavPrincipale() {
  const chemin = usePathname();
  return (
    <nav aria-label="Navigation principale" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {ONGLETS.map((o) => {
          const actif = ongletActif(chemin, o.href);
          return (
            <li key={o.href}>
              <Link
                href={o.href}
                aria-current={actif ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  actif
                    ? "bg-accent text-white"
                    : "text-stone-700 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800"
                }`}
              >
                {o.libelle}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
