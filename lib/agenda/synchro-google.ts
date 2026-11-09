// La route de synchronisation Google (/api/agenda/google/sync), testable sans réseau. Appelée par le cron de Vercel (GET avec
// « Authorization: Bearer <CRON_SECRET> » : Vercel l'envoie de lui-même quand la variable CRON_SECRET existe).
//   1. CRON_SECRET absent (ou de moins de 16 caractères)        → 503, rien n'est lu
//   2. en-tête absent ou faux                                   → 401
//   3. l'agenda configuré n'est pas Google                      → 200 { ok: true, actif: false } (le cron peut rester en place)
//   4. variable Google ou clé service manquante                 → 503
//   5. synchronisation : 200 avec des compteurs ; Google refuse ou ne répond pas → 502 ; base en erreur → 500
// Réponse et journal en compteurs et en codes seulement.

import { VARIABLES_BASE_SERVICE, valeurEnv, variablesManquantes } from "../integrations/base";
import { LONGUEUR_MIN_CRON, VARIABLE_CRON, VARIABLES_GOOGLE, cronAutorise, synchroniserGoogle, type DependancesSyncGoogle } from "./google";
import type { FournisseurAgenda } from "./types";
import type { ReponseAgenda } from "./webhook";

export interface DependancesRouteSyncGoogle extends DependancesSyncGoogle {
  /** config.agenda.fournisseur */
  fournisseurActif: FournisseurAgenda;
}

export async function recevoirSyncGoogle(req: Request, d: DependancesRouteSyncGoogle): Promise<ReponseAgenda> {
  if (valeurEnv(d.env, VARIABLE_CRON).length < LONGUEUR_MIN_CRON) {
    d.journal(`agenda:google:sync:non_configure:${VARIABLE_CRON} (503)`, true);
    return { statut: 503, corps: { ok: false, code: "non_configure" } };
  }
  if (!cronAutorise(req.headers.get("authorization"), d.env)) {
    d.journal("agenda:google:sync:refuse (401)", true);
    return { statut: 401, corps: { ok: false, code: "non_autorise" } };
  }
  if (d.fournisseurActif !== "google") return { statut: 200, corps: { ok: true, actif: false } };

  const manquantes = variablesManquantes(d.env, [...VARIABLES_GOOGLE, ...VARIABLES_BASE_SERVICE]);
  if (manquantes.length > 0) {
    d.journal(`agenda:google:sync:non_configure:${manquantes.join(",")} (503)`, true);
    return { statut: 503, corps: { ok: false, code: "non_configure" } };
  }

  const b = await synchroniserGoogle(d);
  const compteurs = {
    lus: b.lus,
    candidats: b.candidats,
    traites: b.traites,
    doublons: b.doublons,
    aVerifier: b.aVerifier,
    rejetes: b.rejetes,
    reportes: b.reportes,
  };
  if (b.raison) return { statut: b.raison === "non_configure" ? 503 : 502, corps: { ok: false, code: `google_${b.raison}`, ...compteurs } };
  if (!b.ok) return { statut: 500, corps: { ok: false, code: b.code ?? "base", ...compteurs } };
  d.journal(
    `agenda:google:sync:ok lus=${b.lus} candidats=${b.candidats} traites=${b.traites} doublons=${b.doublons} a_verifier=${b.aVerifier} rejetes=${b.rejetes} (200)`,
  );
  return { statut: 200, corps: { ok: true, actif: true, ...compteurs } };
}
