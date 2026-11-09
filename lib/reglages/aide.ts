// L'aide des outils dans l'écran Réglages : pour l'outil de téléphonie de la configuration, la ligne d'aide du Poste, les pannes connues
// et l'installation de l'appelant (lib/telephonie/aide.ts) ; pour l'agenda, le mode (les rendez-vous arrivent-ils tout seuls ?) ; et,
// pour les gestionnaires, les variables qui manquent sur le serveur, par leur NOM seulement (jamais une valeur, jamais leur longueur).
// Module PUR : l'environnement est passé en argument ; testé par tests/reglages-logique.test.mjs.

import { adaptateurAgenda, rdvRecusAutomatiquement, variablesAgenda } from "@/lib/agenda/registre";
import type { FournisseurAgenda } from "@/lib/agenda/types";
import { valeurEnv, variablesManquantes, type Env } from "@/lib/integrations/base";
import { aideTelephonie, type PanneConnue } from "@/lib/telephonie/aide";
import type { FournisseurTelephonie } from "@/lib/telephonie/types";

export const VARIABLE_CLE_SERVICE = "SUPABASE_SERVICE_ROLE_KEY";
export const DOC_TELEPHONIE = "docs/telephonie.md";
export const DOC_AGENDA = "docs/agenda.md";

export interface AideTelephonieVue {
  titre: string;
  experimental: boolean;
  poste: string;
  pannes: readonly PanneConnue[];
  installationAppelant: readonly string[];
  /** L'outil envoie ses appels par webhook (Onoff, Aircall, Ringover) : l'e-mail de téléphonie de chacun compte. */
  aWebhook: boolean;
  variablesManquantes: string[];
  variablesFacultativesAbsentes: string[];
}

export interface AideAgendaVue {
  libelle: string;
  automatique: boolean;
  mode: string;
  variablesManquantes: string[];
}

export interface VueAide {
  telephonie: AideTelephonieVue;
  agenda: AideAgendaVue;
  cleServicePresente: boolean;
}

function modeAgenda(fournisseur: FournisseurAgenda, libelle: string, automatique: boolean): string {
  if (fournisseur === "aucun") {
    return "Agenda interne : un rendez-vous se pose au Poste (« RDV pris ») ou dans l'écran Agenda ; chacun peut s'abonner à son flux ICS depuis l'écran Agenda.";
  }
  if (automatique) {
    return fournisseur === "google"
      ? `Les rendez-vous de ${libelle} arrivent tout seuls, par une synchronisation planifiée (lecture seule).`
      : `Les rendez-vous pris dans ${libelle} arrivent tout seuls dans les fiches et l'écran Agenda (webhook).`;
  }
  return `${libelle} n'envoie pas encore ses rendez-vous ici (il manque des variables sur le serveur) : en attendant, note « RDV pris » au Poste.`;
}

/** L'aide de l'outil de téléphonie et de l'agenda de la configuration, avec les NOMS des variables qui manquent dans `env`. */
export function vueAide(
  n: { telephonie: { fournisseur: FournisseurTelephonie }; agenda: { fournisseur: FournisseurAgenda } },
  env: Env,
): VueAide {
  const t = aideTelephonie(n.telephonie.fournisseur);
  const cleServicePresente = valeurEnv(env, VARIABLE_CLE_SERVICE) !== "";
  const telephonie: AideTelephonieVue = {
    titre: t.titre,
    experimental: t.experimental,
    poste: t.poste,
    pannes: t.pannes,
    installationAppelant: t.installationAppelant,
    aWebhook: t.webhook !== null,
    variablesManquantes: t.webhook ? variablesManquantes(env, [...t.webhook.variables, VARIABLE_CLE_SERVICE]) : [],
    variablesFacultativesAbsentes: t.webhook ? variablesManquantes(env, t.webhook.variablesFacultatives) : [],
  };

  const fournisseur = n.agenda.fournisseur;
  const libelle = adaptateurAgenda(fournisseur)?.libelle ?? "L'agenda";
  const automatique = rdvRecusAutomatiquement(fournisseur, env);
  const requises = fournisseur === "aucun" ? [] : [...variablesAgenda(fournisseur), VARIABLE_CLE_SERVICE];
  const agenda: AideAgendaVue = {
    libelle,
    automatique,
    mode: modeAgenda(fournisseur, libelle, automatique),
    variablesManquantes: variablesManquantes(env, [...new Set(requises)]),
  };
  return { telephonie, agenda, cleServicePresente };
}
