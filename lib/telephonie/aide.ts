// Les textes d'aide de chaque fournisseur de téléphonie, à afficher dans le Poste (la ligne sous « Appeler », les pannes connues) et
// dans les réglages (installation, webhook, variables, limites). Module PUR, sans marque d'aucun projet : le même texte pour toutes les
// équipes. Les variables sont données par leur NOM, jamais une valeur ; l'adresse du webhook par son chemin (le domaine est celui de
// l'instance). Le détail, avec les captures, est dans docs/telephonie.md.

import { PARAMETRE_SECRET_RINGOVER } from "./ringover";
import type { FournisseurTelephonie } from "./types";

export interface PanneConnue {
  symptome: string;
  remede: string;
}

export interface AideWebhook {
  /** Le chemin à coller après le domaine de l'instance (https://<ton-domaine><chemin>). */
  chemin: string;
  variables: readonly string[];
  variablesFacultatives: readonly string[];
  notes: readonly string[];
}

export interface AideTelephonie {
  fournisseur: FournisseurTelephonie;
  titre: string;
  experimental: boolean;
  /** La ligne d'aide sous le bouton « Appeler ». */
  poste: string;
  /** Ce que chaque appelant fait une fois, sur son ordinateur. */
  installationAppelant: readonly string[];
  /** Ce qu'un gestionnaire fait une fois (console du fournisseur, variables dans Vercel). */
  installationGestionnaire: readonly string[];
  /** À vérifier avant la première session d'appels. */
  verifications: readonly string[];
  pannes: readonly PanneConnue[];
  webhook: AideWebhook | null;
  limites: readonly string[];
}

/** Le chemin du webhook d'un fournisseur (à coller après https://<ton-domaine>). */
export function cheminWebhook(f: FournisseurTelephonie): string {
  return `/api/telephonie/${f}/webhook`;
}

const ANNONCE =
  "Enregistrement : rien n'est gardé (ni audio, ni transcription) tant qu'un gestionnaire n'a pas activé l'enregistrement complet dans les réglages ET que l'annonce n'a pas été lue au prospect pendant l'appel (bouton « Annonce lue » du Poste).";

const MICRO_PERMISSIONS =
  "La Permissions-Policy du site est calculée au build d'après telephonie.fournisseur (config/niche.json) : après un changement de fournisseur, il faut redéployer.";

export const AIDES_TELEPHONIE: Readonly<Record<FournisseurTelephonie, AideTelephonie>> = {
  onoff: {
    fournisseur: "onoff",
    titre: "Onoff Business (extension Chrome)",
    experimental: false,
    poste:
      "Avec l'extension Chrome Onoff connectée, « Appeler » ouvre le cadran Onoff, numéro déjà tapé : appuie sur le bouton vert. Sinon le numéro est copié : colle-le dans Onoff. Sur téléphone, colle-le dans l'app Onoff.",
    installationAppelant: [
      "Installe l'extension Chrome « Onoff Business Click2Call » depuis le Chrome Web Store, puis épingle-la (icône puzzle, punaise).",
      "Clique sur l'icône Onoff, connecte-toi avec ton compte Onoff Business et choisis ta ligne d'appel.",
      "Dans l'extension, laisse « Mise en surbrillance des numéros » activée, et « Mode application de bureau » éteint pour appeler depuis Chrome.",
      "Ouvre le Poste : l'extension ne doit pas être désactivée sur ce site (option « Désactiver l'extension sur ce site web » éteinte).",
      "Premier appel : Chrome demande l'accès au micro ; accepte.",
    ],
    installationGestionnaire: [
      "Le webhook d'appel est réservé aux plans Onoff Advanced et Max (console B2B Onoff, menu Integrations › Webhook, webhook « Call »).",
      "AVANT de créer l'intégration : pose ONOFF_WEBHOOK_TOKEN (16 caractères au moins, tiré au hasard) dans Vercel et redéploie. Onoff envoie un appel d'essai dès la création : si le jeton n'est pas encore déployé, l'intégration passe en « échec ».",
      `Dans Onoff : Url = https://<ton-domaine>${cheminWebhook("onoff")} ; Api key = la même valeur que ONOFF_WEBHOOK_TOKEN (Onoff l'envoie dans l'en-tête X-API-KEY).`,
      "Facultatif : une clé d'API Onoff (Integrations › API keys) dans ONOFF_API_KEY, pour reprendre l'audio et lire la transcription par l'API.",
      "Chaque appelant a le même e-mail dans Onoff et dans l'application (sinon un gestionnaire renseigne son e-mail Onoff dans les réglages de l'équipe) : c'est ainsi qu'un appel lui est attribué.",
    ],
    verifications: [
      "À l'ouverture d'une fiche, le numéro est surligné par Onoff en moins d'une seconde.",
      "Le test du webhook : l'intégration est « Integrated » dans la console Onoff, et /api/sante dit variables.telephonie = true.",
    ],
    pannes: [
      {
        symptome: "« Ce site restreint notre extension »",
        remede: `Le site ne donne pas le micro à l'extension (Permissions-Policy). Vérifie que telephonie.fournisseur vaut « onoff », puis redéploie. ${MICRO_PERMISSIONS}`,
      },
      {
        symptome: "Le numéro n'est pas surligné, « Appeler » copie seulement le numéro",
        remede:
          "La fiche vient de s'ouvrir : attends une demi-seconde. Sinon l'extension est déconnectée, en pause sur ce site, ou la surbrillance est éteinte. En attendant, colle le numéro (déjà copié) dans le cadran Onoff.",
      },
      {
        symptome: "« Vous avez déjà 3 appareils connectés à votre compte »",
        remede: "Onoff accepte 3 appareils au plus : l'extension se met en pause. Déconnecte un appareil comme elle le propose.",
      },
      {
        symptome: "« Veuillez d'abord compléter vos actions d'appel en attente »",
        remede: "Le cadran attend que tu fermes l'écran de fin de l'appel précédent.",
      },
      {
        symptome: "Sur iPhone, le bouton n'appelle pas avec la ligne Onoff",
        remede: "Un lien tel: partirait sur la carte SIM de l'iPhone, pas sur Onoff : le Poste copie seulement le numéro. Colle-le dans l'app Onoff.",
      },
      {
        symptome: "L'intégration du webhook est en « échec »",
        remede:
          "Le jeton n'était pas déployé au moment de l'essai (ou faute de copie). Pose ONOFF_WEBHOOK_TOKEN, redéploie, puis recrée l'intégration avec la même valeur.",
      },
    ],
    webhook: {
      chemin: cheminWebhook("onoff"),
      variables: ["ONOFF_WEBHOOK_TOKEN"],
      variablesFacultatives: ["ONOFF_API_KEY"],
      notes: [
        "Onoff coupe au bout de 10 secondes et réessaie 4 fois, puis jette l'événement : l'application répond tout de suite et fait le reste après la réponse.",
        "Avec l'enregistrement activé chez Onoff, l'événement « RECORDING » remplace « CDR » et porte le lien de l'audio ; l'audio arrive 5 à 8 minutes après la fin de l'appel.",
        "Ce qui manque (audio pas prêt, transcription) est repris par /api/telephonie/recuperation : 20 essais au plus par appel, un par minute au plus, pendant 48 heures (ONOFF_API_KEY nécessaire).",
        "Pare-feu : les appels d'Onoff viennent de 46.137.171.21, 52.50.239.4 et 54.220.111.56. L'application ne filtre pas par adresse IP : le jeton suffit.",
        ANNONCE,
      ],
    },
    limites: [
      "Onoff n'a pas d'API pour lancer un appel : sur ordinateur, l'extension Chrome est indispensable.",
      "La fiche est retrouvée par les 9 derniers chiffres du numéro appelé ; l'appelant par son e-mail Onoff.",
    ],
  },

  aircall: {
    fournisseur: "aircall",
    titre: "Aircall (téléphone dans le Poste)",
    experimental: false,
    poste:
      "Connecte-toi à Aircall dans le téléphone du Poste (tes identifiants Aircall, à chaque session). Ensuite « Appeler » compose le numéro de la fiche.",
    installationAppelant: [
      "Ouvre le Poste et connecte-toi dans le téléphone Aircall affiché (tes identifiants Aircall) ; il faut le refaire à chaque session.",
      "Premier appel : le navigateur demande l'accès au micro pour Aircall ; accepte.",
      "Safari : si le téléphone ne se connecte pas, décoche « Empêcher le suivi intersite » (Réglages › Confidentialité) : le téléphone a besoin de ses cookies dans le cadre.",
    ],
    installationGestionnaire: [
      "Il faut un numéro actif dans le compte Aircall. La validation d'un numéro français peut prendre plusieurs jours : prévois-la avant la première session.",
      `Aircall › Integrations & API › Webhooks : crée un webhook vers https://<ton-domaine>${cheminWebhook("aircall")} avec les événements call.created, call.answered, call.hungup, call.ended, call.comm_assets_generated et transcription.created.`,
      "Aircall affiche alors le jeton du webhook : colle-le dans AIRCALL_WEBHOOK_TOKEN (Vercel), puis redéploie tout de suite.",
      "Facultatif : une clé d'API (Integrations & API › API keys) : AIRCALL_API_ID et AIRCALL_API_TOKEN, pour lire la transcription et reprendre l'audio.",
      "Chaque appelant a le même e-mail dans Aircall et dans l'application (sinon un gestionnaire renseigne son e-mail Aircall dans les réglages de l'équipe).",
    ],
    verifications: [
      "L'état du téléphone passe à « prêt » après ta connexion dans le Poste.",
      "/api/sante dit variables.telephonie = true.",
    ],
    pannes: [
      {
        symptome: "« Le téléphone Aircall n'est pas prêt »",
        remede: "Connecte-toi dans le téléphone du Poste ; la session ne survit pas à la fermeture de l'onglet. Le numéro est copié en attendant.",
      },
      {
        symptome: "« Un appel est déjà en cours dans Aircall »",
        remede: "Termine l'appel en cours dans le téléphone, puis relance.",
      },
      {
        symptome: "Le micro est refusé dans le téléphone Aircall",
        remede: `Autorise le micro pour le site dans le navigateur. Sinon la Permissions-Policy ne l'accorde pas à Aircall : vérifie que telephonie.fournisseur vaut « aircall », puis redéploie. ${MICRO_PERMISSIONS}`,
      },
      {
        symptome: "Les appels n'arrivent plus dans les fiches",
        remede:
          "Aircall désactive un webhook après plusieurs échecs d'affilée (par exemple si AIRCALL_WEBHOOK_TOKEN n'était pas encore déployé) : réactive-le dans Aircall une fois la variable en place.",
      },
    ],
    webhook: {
      chemin: cheminWebhook("aircall"),
      variables: ["AIRCALL_WEBHOOK_TOKEN"],
      variablesFacultatives: ["AIRCALL_API_ID", "AIRCALL_API_TOKEN"],
      notes: [
        "Le jeton voyage dans le corps de chaque événement (champ token) : l'application le compare en temps constant à AIRCALL_WEBHOOK_TOKEN.",
        "L'audio est téléchargé quand Aircall annonce l'enregistrement (call.ended ou call.comm_assets_generated) ; la transcription, quand Aircall annonce transcription.created (option payante chez Aircall).",
        ANNONCE,
      ],
    },
    limites: [
      "Il faut se connecter dans le téléphone du Poste à chaque session.",
      "La transcription dépend de l'offre Aircall (option d'intelligence artificielle).",
    ],
  },

  ringover: {
    fournisseur: "ringover",
    titre: "Ringover (téléphone dans le Poste, expérimental)",
    experimental: true,
    poste:
      "Connecte-toi à Ringover dans le téléphone du Poste. Ensuite « Appeler » compose le numéro de la fiche. Intégration expérimentale : signale tout écart.",
    installationAppelant: [
      "Ouvre le Poste et connecte-toi dans le téléphone Ringover affiché (tes identifiants Ringover).",
      "Premier appel : le navigateur demande l'accès au micro pour Ringover ; accepte.",
      "Safari : décoche « Empêcher le suivi intersite » (Réglages › Confidentialité), sinon le téléphone ne peut pas parler à la page (consigne de Ringover).",
    ],
    installationGestionnaire: [
      `Pose RINGOVER_WEBHOOK_SECRET (24 caractères au moins, tiré au hasard) dans Vercel et redéploie. L'adresse du webhook la contient : https://<ton-domaine>${cheminWebhook("ringover")}?${PARAMETRE_SECRET_RINGOVER}=<la valeur>.`,
      "Dashboard Ringover › Développeur › Webhooks : colle cette adresse dans les événements d'appel (appels décrochés, appels terminés, appels manqués) et dans « enregistrement disponible ».",
      "Active l'enregistrement des appels chez Ringover si l'équipe enregistre (et l'annonce, voir plus bas).",
      "Chaque appelant a le même e-mail dans Ringover et dans l'application.",
    ],
    verifications: [
      "L'état du téléphone passe à « prêt » après ta connexion dans le Poste.",
      "Un appel d'essai vers ton propre numéro apparaît dans la fiche (s'il a une fiche) quelques secondes après la fin.",
    ],
    pannes: [
      {
        symptome: "Le téléphone Ringover reste « en attente »",
        remede: "Connecte-toi dans le téléphone du Poste. Sous Safari, décoche « Empêcher le suivi intersite ».",
      },
      {
        symptome: "Le micro est refusé dans le téléphone Ringover",
        remede: `Autorise le micro pour le site. Sinon vérifie que telephonie.fournisseur vaut « ringover », puis redéploie. ${MICRO_PERMISSIONS}`,
      },
      {
        symptome: "Les appels n'arrivent pas dans les fiches (401 dans les journaux)",
        remede: `L'adresse collée dans Ringover n'a pas le bon ?${PARAMETRE_SECRET_RINGOVER}= : recopie-la avec la valeur exacte de RINGOVER_WEBHOOK_SECRET.`,
      },
    ],
    webhook: {
      chemin: `${cheminWebhook("ringover")}?${PARAMETRE_SECRET_RINGOVER}=<RINGOVER_WEBHOOK_SECRET>`,
      variables: ["RINGOVER_WEBHOOK_SECRET"],
      variablesFacultatives: [],
      notes: [
        "Les exemples publics de Ringover ne s'accordent pas sur la signature de leurs webhooks : le secret est donc dans l'adresse, comparé en temps constant. Il apparaît dans l'adresse des requêtes : ne partage pas les journaux de Vercel.",
        "L'audio est téléchargé quand Ringover envoie « enregistrement disponible » (ou le lien dans « appel terminé ») ; il n'y a pas de reprise par l'API.",
        ANNONCE,
      ],
    },
    limites: [
      "Expérimental : écrit d'après la documentation publique de Ringover, jamais testé sur un vrai compte.",
      "Seul le mode « iframe » est livré (téléphone embarqué) ; l'extension Chrome et l'API de rappel ne le sont pas.",
    ],
  },

  softphone: {
    fournisseur: "softphone",
    titre: "Softphone (Zoiper, 3CX, Teams…)",
    experimental: false,
    poste: "« Appeler » ouvre ton softphone (lien tel:, callto: ou sip:) et copie le numéro. Note l'issue de l'appel au Poste.",
    installationAppelant: [
      "macOS : pour les liens tel:, ouvre FaceTime › Réglages › Général et choisis ton softphone comme application par défaut pour les appels (il doit être installé). Pour callto: et sip:, c'est le softphone qui se déclare lui-même (une option du type « ouvrir les liens d'appel » dans ses réglages).",
      "Windows 11 : Paramètres › Applications › Applications par défaut › « Choisir les valeurs par défaut par type de lien » (Windows 10 : « par protocole ») : TEL, CALLTO ou SIP vers ton softphone.",
      "Au premier clic, le navigateur demande d'ouvrir l'application : coche « Toujours autoriser » pour ce site.",
    ],
    installationGestionnaire: [
      "Choisis le lien dans config/niche.json : telephonie.schemaLien = « tel » (le plus courant), « callto » ou « sip », selon ce que le softphone de l'équipe sait ouvrir.",
    ],
    verifications: ["Un clic sur « Appeler » ouvre le softphone avec le numéro, sans fenêtre de choix."],
    pannes: [
      {
        symptome: "Une fenêtre « Choisir une application » ou FaceTime s'ouvre",
        remede: "L'application par défaut des liens d'appel n'est pas ton softphone : règle-la (voir l'installation). Le numéro est copié en attendant.",
      },
      {
        symptome: "Rien ne s'ouvre",
        remede: "Aucune application ne prend ce type de lien : essaie un autre schemaLien, ou colle le numéro (copié) dans le softphone.",
      },
    ],
    webhook: null,
    limites: ["Aucun webhook : la durée de l'appel se saisit au Poste (ou au chronomètre du Poste) ; pas d'enregistrement."],
  },

  telephone: {
    fournisseur: "telephone",
    titre: "Téléphone (lien tel: et copie)",
    experimental: false,
    poste: "Sur téléphone, « Appeler » ouvre le composeur. Sur ordinateur, le numéro est copié : compose-le sur ton téléphone.",
    installationAppelant: ["Rien à installer."],
    installationGestionnaire: ["Rien à configurer."],
    verifications: ["Le numéro de la fiche s'affiche en grand, au format international (+33…)."],
    pannes: [
      {
        symptome: "Le numéro n'est pas copié",
        remede: "Le navigateur refuse le presse-papiers (site non sécurisé ou permission refusée) : recopie le numéro affiché.",
      },
    ],
    webhook: null,
    limites: ["Aucun webhook : la durée de l'appel se saisit au Poste (ou au chronomètre du Poste) ; pas d'enregistrement."],
  },
};

export function aideTelephonie(f: FournisseurTelephonie): AideTelephonie {
  return AIDES_TELEPHONIE[f];
}
