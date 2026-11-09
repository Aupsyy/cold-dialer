// La réception d'un webhook d'agenda (route /api/agenda/<fournisseur>/webhook), testable sans réseau : la route ne fait que brancher
// process.env, la clé service et le journal de Vercel.
//
//   1. fournisseur inconnu ou sans webhook (google, aucun)  → 404
//   2. variable manquante (secret du fournisseur, clé service) → 503, sans lire le corps
//   3. corps de plus de TAILLE_MAX_CORPS                      → 413
//   4. verifier() faux (signature, secret)                    → 401
//   5. JSON illisible                                         → 400
//   6. lire() puis evenement_agenda(p_evenement) par événement (clé service) → 200 avec des compteurs ; une erreur passagère de la
//      base → 500 (le fournisseur renvoie ; l'idempotence de la base absorbe le renvoi).
// Le journal ne porte que des codes : ni corps, ni e-mail, ni numéro, ni identifiant, ni secret.

import { TAILLE_MAX_CORPS, VARIABLES_BASE_SERVICE, variablesManquantes, type Env, type Journal, type Rpc } from "../integrations/base";
import { appliquerEvenements } from "./appliquer";
import { REGISTRE_AGENDA, adaptateurAgenda } from "./registre";
import { FOURNISSEURS_AGENDA, type EvenementRdv, type FournisseurAgenda, type RegistreAgenda } from "./types";

export interface ReponseAgenda {
  statut: number;
  corps: Record<string, unknown>;
}

export interface DependancesWebhookAgenda {
  env: Env;
  /** Le client de la base (clé service), créé à la demande. */
  base: () => Rpc;
  journal: Journal;
  /** L'horloge en secondes (tolérance des signatures horodatées). */
  maintenantS: () => number;
  registre?: RegistreAgenda;
}

export const ENTETES_REPONSE_AGENDA = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

/** Le corps tel quel (une signature porte sur ses octets exacts), lu sans dépasser `max` octets. */
export async function lireCorpsBorne(req: Request, max: number = TAILLE_MAX_CORPS): Promise<Uint8Array | "trop_gros" | "illisible"> {
  const annonce = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(annonce) && annonce > max) return "trop_gros";
  if (!req.body) return new Uint8Array(0);
  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lecteur.cancel().catch(() => {});
        return "trop_gros";
      }
      morceaux.push(value);
    }
  } catch {
    return "illisible";
  }
  const corps = new Uint8Array(total);
  let position = 0;
  for (const m of morceaux) {
    corps.set(m, position);
    position += m.byteLength;
  }
  return corps;
}

function estFournisseur(v: string): v is FournisseurAgenda {
  return (FOURNISSEURS_AGENDA as readonly string[]).includes(v);
}

export async function recevoirWebhookAgenda(fournisseurBrut: string, req: Request, d: DependancesWebhookAgenda): Promise<ReponseAgenda> {
  const fournisseur = estFournisseur(fournisseurBrut) ? fournisseurBrut : null;
  const prefixe = `agenda:${fournisseur ?? "inconnu"}`;
  const refus = (statut: number, code: string): ReponseAgenda => {
    d.journal(`${prefixe}:${code} (${statut})`, statut >= 500 || statut === 401);
    return { statut, corps: { ok: false, code } };
  };

  // 1. Le fournisseur et son webhook.
  const webhook = fournisseur ? adaptateurAgenda(fournisseur, d.registre ?? REGISTRE_AGENDA)?.webhook : undefined;
  if (!webhook) return refus(404, "inconnu");

  // 2. La configuration, avant de lire quoi que ce soit (les NOMS seulement).
  const manquantes = variablesManquantes(d.env, [...webhook.variables, ...VARIABLES_BASE_SERVICE]);
  if (manquantes.length > 0) {
    d.journal(`${prefixe}:non_configure:${manquantes.join(",")} (503)`, true);
    return { statut: 503, corps: { ok: false, code: "non_configure" } };
  }

  // 3. Le corps, borné.
  const corps = await lireCorpsBorne(req);
  if (corps === "trop_gros") return refus(413, "trop_gros");
  if (corps === "illisible") return refus(400, "corps_illisible");

  // 4. L'authenticité.
  let authentique = false;
  try {
    authentique = await webhook.verifier(req, corps, d.env, d.maintenantS());
  } catch {
    authentique = false;
  }
  if (!authentique) return refus(401, "signature_refusee");

  // 5. Le JSON, puis les événements normalisés.
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(corps));
  } catch {
    return refus(400, "json_illisible");
  }
  let evenements: EvenementRdv[];
  try {
    evenements = webhook.lire(json);
  } catch {
    return refus(400, "evenement_illisible");
  }
  if (evenements.length === 0) {
    d.journal(`${prefixe}:rien_a_faire (200)`);
    return { statut: 200, corps: { ok: true, recus: 0, traites: 0, doublons: 0, aVerifier: 0, rejetes: 0 } };
  }

  // 6. La base, un événement après l'autre.
  let rpc: Rpc;
  try {
    rpc = d.base();
  } catch {
    return refus(503, "base_non_configuree");
  }
  const bilan = await appliquerEvenements(evenements, rpc, d.journal, prefixe);
  const compteurs = { recus: evenements.length, traites: bilan.traites, doublons: bilan.doublons, aVerifier: bilan.aVerifier, rejetes: bilan.rejetes };
  if (!bilan.ok) {
    d.journal(`${prefixe}:arret:${bilan.code ?? "base"} (500)`, true);
    return { statut: 500, corps: { ok: false, code: bilan.code ?? "base", ...compteurs } };
  }
  d.journal(
    `${prefixe}:ok recus=${compteurs.recus} traites=${compteurs.traites} doublons=${compteurs.doublons} a_verifier=${compteurs.aVerifier} rejetes=${compteurs.rejetes} (200)`,
  );
  return { statut: 200, corps: { ok: true, ...compteurs } };
}

/** La réponse HTTP (JSON, jamais mise en cache). */
export function reponseJson(r: ReponseAgenda): Response {
  return Response.json(r.corps, { status: r.statut, headers: ENTETES_REPONSE_AGENDA });
}
