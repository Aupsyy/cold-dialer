// La réception d'un webhook de téléphonie : POST /api/telephonie/<fournisseur>/webhook. Module PUR : la route
// (app/api/telephonie/[fournisseur]/webhook/route.ts) ne fait que brancher les vraies dépendances (variables, base, after()).
//
// Dans l'ordre, sans jamais lire plus que nécessaire :
//   1. fournisseur inconnu, sans webhook, ou autre que celui de config/niche.json : 404 ;
//   2. variable absente (celles de l'adaptateur et celles de la base) ou secret trop court : 503, sans lire le corps ;
//   3. corps de plus de 256 Ko (annoncé ou réel) : 413 ;
//   4. corps qui n'est pas du JSON en UTF-8 : 400 (le jeton d'Aircall est DANS le corps : il faut le lire avant de vérifier) ;
//   5. verifier() faux : 401 ;
//   6. lire() : aucun événement utile (l'essai d'Onoff à la création de l'intégration, un événement non suivi) : 200, rien d'écrit ;
//   7. chaque événement : evenement_appel(p_evenement) avec la clé service (idempotent : un renvoi met à jour la même ligne) ;
//      une erreur de la base : 500 (le fournisseur réessaie) ;
//   8. réponse 200 tout de suite ; apres() (audio, transcription) se fait APRÈS la réponse (after() de next/server).
// La base ne reçoit que les clés de CHAMPS_EVENEMENT_APPEL : jamais l'URL de l'audio. Le journal ne porte que des codes.

import { VARIABLES_BASE_SERVICE, variablesManquantes, type Env, type Journal, type Rpc, TAILLE_MAX_CORPS } from "../integrations/base";
import { lireResultatEvenement } from "./audio";
import { normaliserE164 } from "./e164";
import { analyserJson, codeSur, lireFluxBorne, secretsTropCourts } from "./outils";
import { adaptateurTelephonie } from "./registre";
import {
  CHAMPS_EVENEMENT_APPEL,
  FONCTIONS_SQL_TELEPHONIE,
  FOURNISSEURS_TELEPHONIE,
  type Dependances,
  type EvenementAppel,
  type FournisseurTelephonie,
  type RegistreTelephonie,
  type ResultatEvenementAppel,
} from "./types";

export interface DependancesReception {
  env: Env;
  /** Le fournisseur choisi dans config/niche.json : seul son webhook répond. */
  fournisseurActif: FournisseurTelephonie;
  /** L'indicatif du pays de l'instance (config.pays.indicatif) : un numéro national reçu devient international. */
  indicatif: string;
  base: () => Rpc;
  journal: Journal;
  /** Planifie une suite APRÈS la réponse (after() de next/server). */
  planifier: (suite: () => Promise<void>) => void;
  /** Les dépendances de apres(), créées seulement s'il y a une suite. */
  dependances: () => Dependances;
  registre?: RegistreTelephonie;
}

export interface ReponseWebhook {
  statut: number;
  corps: Record<string, unknown>;
}

/** L'événement tel que la base le lit : les clés de CHAMPS_EVENEMENT_APPEL seulement, le numéro en E.164 avec l'indicatif de l'instance. */
export function evenementPourBase(e: EvenementAppel, indicatif: string): Record<string, unknown> {
  const normalise: EvenementAppel = { ...e, numeroExterne: normaliserE164(e.numeroExterne, indicatif) };
  return Object.fromEntries(CHAMPS_EVENEMENT_APPEL.map((cle) => [cle, normalise[cle]]));
}

function fournisseurConnu(v: string): FournisseurTelephonie | null {
  return (FOURNISSEURS_TELEPHONIE as readonly string[]).includes(v) ? (v as FournisseurTelephonie) : null;
}

export async function recevoirWebhookTelephonie(fournisseurBrut: string, req: Request, d: DependancesReception): Promise<ReponseWebhook> {
  const refus = (statut: number, code: string, prefixe = "telephonie"): ReponseWebhook => {
    d.journal(`${prefixe}:${code} (${statut})`, statut >= 500);
    return { statut, corps: { ok: false, code } };
  };

  // 1. Le fournisseur.
  const id = fournisseurConnu(fournisseurBrut);
  const adaptateur = id ? adaptateurTelephonie(id, d.registre) : null;
  const webhook = adaptateur?.webhook;
  if (!id || id !== d.fournisseurActif || !webhook) return refus(404, "fournisseur_inconnu");

  // 2. La configuration, avant de lire quoi que ce soit.
  const manquantes = variablesManquantes(d.env, [...webhook.variables, ...VARIABLES_BASE_SERVICE]);
  if (manquantes.length > 0) {
    d.journal(`${id}:non_configure:${manquantes.join(",")} (503)`, true);
    return { statut: 503, corps: { ok: false, code: "non_configure" } };
  }
  const courts = secretsTropCourts(d.env, webhook.variables);
  if (courts.length > 0) {
    d.journal(`${id}:secret_trop_court:${courts.join(",")} (503)`, true);
    return { statut: 503, corps: { ok: false, code: "secret_trop_court" } };
  }

  // 3. La taille.
  const annonce = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(annonce) && annonce > TAILLE_MAX_CORPS) return refus(413, "trop_gros", id);
  const corps = await lireFluxBorne(req.body, TAILLE_MAX_CORPS);
  if (corps === "trop_gros") return refus(413, "trop_gros", id);
  if (corps === "illisible") return refus(400, "corps_illisible", id);

  // 4. Le JSON.
  const json = analyserJson(corps);
  if (json === undefined) return refus(400, "corps_illisible", id);

  // 5. L'authenticité.
  let authentique = false;
  try {
    authentique = await webhook.verifier(req, corps, d.env);
  } catch {
    authentique = false;
  }
  if (!authentique) return refus(401, "refuse", id);

  // 6. La lecture.
  let evenements: EvenementAppel[] = [];
  try {
    evenements = webhook.lire(json);
  } catch {
    evenements = [];
  }
  if (evenements.length === 0) {
    d.journal(`${id}:ignore (200)`);
    return { statut: 200, corps: { ok: true, ignore: true } };
  }

  // 7. Une écriture par événement.
  let rpc: Rpc;
  try {
    rpc = d.base();
  } catch {
    return refus(503, "base_non_configuree", id);
  }
  const suites: [EvenementAppel, ResultatEvenementAppel][] = [];
  for (const e of evenements) {
    const pourBase = evenementPourBase(e, d.indicatif);
    let resultat: ResultatEvenementAppel | null;
    try {
      const r = await rpc(FONCTIONS_SQL_TELEPHONIE.evenement, { p_evenement: pourBase });
      if (r.error) return refus(500, `base_${codeSur(r.error.code, "erreur")}`, id);
      resultat = lireResultatEvenement(r.data);
    } catch {
      return refus(500, "base_injoignable", id);
    }
    if (!resultat) {
      d.journal(`${id}:resultat_illisible (200)`, true);
      continue;
    }
    d.journal(
      `${id}:${e.statut}:${resultat.nouveau ? "nouveau" : "connu"}:${resultat.leadId ? "fiche" : "sans_fiche"}:${
        resultat.appelantId ? "appelant" : "sans_appelant"
      }:${resultat.conserverAudio ? "audio_permis" : "audio_non"} (200)`,
    );
    suites.push([{ ...e, numeroExterne: pourBase.numeroExterne as string | null }, resultat]);
  }

  // 8. La suite, après la réponse.
  const apres = webhook.apres;
  if (apres && suites.length > 0) {
    d.planifier(async () => {
      let dependances: Dependances;
      try {
        dependances = d.dependances();
      } catch {
        d.journal(`${id}:suite_non_configuree`, true);
        return;
      }
      for (const [e, r] of suites) {
        try {
          await apres(e, r, dependances);
        } catch {
          d.journal(`${id}:suite_erreur`, true);
        }
      }
    });
  }
  return { statut: 200, corps: { ok: true, evenements: suites.length } };
}

/** Le journal des routes serveur : une ligne par code, rien d'autre (jamais un numéro, un e-mail, une URL ni un secret). */
export const journalServeur: Journal = (code, grave = false) => {
  if (grave) console.error(`[telephonie] ${code}`);
  else console.log(`[telephonie] ${code}`);
};
