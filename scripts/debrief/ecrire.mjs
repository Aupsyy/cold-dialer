// Écrit le débrief d'un appel dans la base, à partir du JSON préparé par Claude Code (schéma et règles : docs/debrief.md).
//
//   node scripts/debrief/ecrire.mjs <debrief.json>             ESSAI (par défaut) : tout est joué dans une transaction ANNULÉE (la base
//                                                              contrôle tout : RLS, contraintes, déclencheurs) ; rien n'est écrit
//   node scripts/debrief/ecrire.mjs <debrief.json> --ecrire    écrit, en une transaction (tout ou rien)
//
// Options :
//   --appelant <e-mail ou id>   le compte qui a passé l'appel ; obligatoire si l'équipe a plusieurs comptes. Le script écrit SOUS SON
//                               IDENTITÉ : un appelant ne touche que ses fiches et les fiches non attribuées, comme dans l'application.
//   --issue                     enregistre aussi l'issue comme le Poste (fonction enregistrer_issue : statut, tentatives, rappel) ; à
//                               utiliser seulement si l'issue n'a pas déjà été notée au Poste. Jamais « rdv_fixe » : le rendez-vous se
//                               pose au Poste ou dans l'agenda. « ne_plus_contacter » est TOUJOURS enregistrée ainsi, même sans --issue
//                               (si la fiche n'y est pas déjà) : c'est elle qui inscrit la fiche sur la liste d'opposition.
//   --sans-transcription        ne garde pas la transcription (seulement ce qui en est extrait).
//
// Ce qui est écrit (une transaction) : une ligne debriefs (l'extraction ; la transcription seulement si permis), une ligne
// retours_marche (objection, verdict de l'accroche, intérêt, tags, citation), une note datée « clé : valeur » au journal de la fiche
// (ou l'issue, avec --issue), les champs VIDES de la fiche (jamais un champ rempli). Lié à un appel en base (appel.externe_id), le
// débrief ne garde la transcription que si l'appel est conservable (enregistrement activé et annonce lue ou jouée) : la base le vérifie
// (déclencheur debriefs_verifier_appel) ; le script le voit avant et écrit alors le débrief sans transcription, en le disant.
//
// Console : des compteurs et des codes seulement (jamais un nom, un numéro, une citation ni l'URL de la base). Codes de sortie : 0 essai
// ou écriture réussis, 1 JSON invalide ou erreur, 2 arrêt (fiche ou compte à préciser).
// Connexion : SUPABASE_DB_URL (lue dans .env.local si elle n'est pas dans l'environnement).

import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  annulerTransaction,
  chargerConfig,
  chargerEnvLocal,
  codeErreur,
  connecterComme,
  ouvrirConnexion,
  ouvrirTransaction,
  resoudreAppelant,
  validerTransaction,
} from "./base.mjs";
import {
  BORNES,
  composerNote,
  dansUnDepot,
  extractionPourBase,
  ligneRetour,
  lireTranscriptionAppel,
  majFiche,
  rechercherFiche,
  transcriptionEnTexte,
  validerDebrief,
  verifierCitations,
  verifierIssue,
  vide,
} from "./lib.mjs";

/**
 * Le débrief, de bout en bout, sur un client pg déjà connecté. `ecrire` faux : essai (tout est annulé). `imbriquee` : un point de
 * sauvegarde au lieu d'une transaction (tests, dans une transaction déjà ouverte). Renvoie un compte rendu en compteurs.
 */
export async function traiterDebrief({
  client,
  entree,
  niche,
  appelant = null,
  ecrire = false,
  avecIssue = false,
  sansTranscription = false,
  imbriquee = false,
  maintenant = Date.now(),
}) {
  const v = validerDebrief(entree, niche, { maintenant });
  if (!v.ok) return { statut: "invalide", erreurs: v.erreurs, avertissements: v.avertissements };
  const d = v.donnees;
  const avertissements = [...v.avertissements];
  if (avecIssue) {
    const erreurs = verifierIssue(d, niche, maintenant);
    if (erreurs.length > 0) return { statut: "invalide", erreurs, avertissements };
  }

  // 1. Avec la connexion du script : le compte de l'appelant, puis l'appel en base s'il est désigné.
  const compte = await resoudreAppelant(client, appelant);
  if (!compte.ok) return { statut: "arret", raison: compte.raison, comptes: compte.n, avertissements };
  const profil = compte.profil;
  let appel = null;
  if (d.appel.externeId) {
    const lignes = (
      await client.query(
        `select a.id, a.lead_id, a.debut, a.created_at, a.duree_s, a.transcription, public.appel_conservable(a.id) as conservable
           from public.appels a where a.workspace_id = $1 and a.fournisseur = $2 and a.externe_id = $3`,
        [profil.workspace_id, d.appel.fournisseur, d.appel.externeId],
      )
    ).rows;
    if (lignes.length !== 1) return { statut: "arret", raison: "appel introuvable dans l'équipe (fournisseur et externe_id)", avertissements };
    appel = lignes[0];
  }

  // 2. Sous l'identité de l'appelant, dans une transaction.
  const requete = async (sql, params = []) => (await client.query(sql, params)).rows;
  await ouvrirTransaction(client, imbriquee);
  try {
    await connecterComme(client, profil.id);
    const arreter = async (resultat) => {
      await annulerTransaction(client, imbriquee);
      return { ...resultat, avertissements };
    };

    if (appel && (await requete("select id from public.appels where id = $1", [appel.id])).length !== 1) {
      return arreter({ statut: "arret", raison: "appel non visible pour ce compte (un appelant ne voit que ses appels)" });
    }

    // La fiche.
    let leadId = null;
    let par = null;
    const leadDonne = Boolean(d.lead.id || d.lead.telephone || d.lead.entreprise);
    if (!leadDonne) {
      if (!appel?.lead_id) return arreter({ statut: "arret", raison: "l'appel n'est rattaché à aucune fiche : donne lead.id, lead.telephone ou lead.entreprise" });
      if ((await requete("select id from public.leads where id = $1", [appel.lead_id])).length !== 1) {
        return arreter({ statut: "arret", raison: "la fiche de l'appel n'est pas visible pour ce compte" });
      }
      leadId = appel.lead_id;
      par = "appel";
    } else {
      const r = await rechercherFiche(requete, d.lead);
      if (r.etat === "trouvee") {
        leadId = r.id;
        par = r.par;
      } else if (r.etat === "plusieurs") {
        return arreter({ statut: "arret", raison: `plusieurs fiches correspondent (par ${r.par}) : mets lead.id`, candidats: r.candidats, total: r.total });
      } else if (d.creerSiAbsent) {
        const oppose = (await requete("select public.lead_en_opposition($1, null, null, $2, null) as oppose", [d.lead.telephone ?? null, d.lead.entreprise ?? null]))[0]?.oppose;
        if (oppose) return arreter({ statut: "arret", raison: "ce numéro ou cette entreprise est sur la liste d'opposition : aucune fiche n'est créée" });
        const creee = await requete(
          `insert into public.leads (entreprise, telephone, ville, dirigeant, sources)
           values ($1, $2, $3, $4, $5::jsonb) returning id`,
          [
            d.lead.entreprise,
            d.lead.e164 ?? d.lead.telephone,
            d.lead.ville,
            d.lead.dirigeant,
            JSON.stringify([{ type: "debrief", le: new Date(maintenant).toISOString().slice(0, 10) }]),
          ],
        );
        leadId = creee[0].id;
        par = "creee";
      } else {
        return arreter({
          statut: "arret",
          raison: `aucune fiche trouvée (par ${r.par}) : mets lead.id, ou "creer_si_absent": true pour la créer`,
          candidats: r.candidats,
          total: r.total ?? 0,
        });
      }
      if (appel?.lead_id && appel.lead_id !== leadId) {
        return arreter({ statut: "arret", raison: "l'appel est rattaché à une autre fiche que celle du JSON" });
      }
    }

    const fiche = (await requete("select id, statut, objection, dirigeant, ville, qualification from public.leads where id = $1 for update", [leadId]))[0];
    if (!fiche) return arreter({ statut: "arret", raison: "fiche non visible pour ce compte" });
    if (fiche.statut === "ne_plus_contacter") avertissements.push("fiche sur la liste d'opposition : elle ne sera plus appelée");
    // « Ne plus contacter » dit pendant l'appel : une note ne verrouille rien ; l'issue passe donc TOUJOURS par enregistrer_issue (statut
    // et liste d'opposition), même sans --issue, sauf si la fiche y est déjà.
    const issueDOffice = !avecIssue && d.extraction.issue === "ne_plus_contacter" && fiche.statut !== "ne_plus_contacter";
    const issueEnBase = avecIssue || issueDOffice;
    if (issueDOffice) avertissements.push("issue « ne plus contacter » enregistrée d'office comme au Poste (liste d'opposition), même sans --issue");

    // La transcription : celle du JSON, sinon celle de l'appel en base ; gardée seulement si permis.
    let lignes = d.transcription;
    let origine = "json";
    if (lignes.length === 0 && appel) {
      lignes = lireTranscriptionAppel(appel.transcription);
      origine = "appel";
      if (d.extraction.citations.length > 0) {
        if (lignes.length === 0) {
          avertissements.push("extraction.citations : non vérifiées (aucune transcription)");
        } else {
          const { introuvables, deLAppelant } = verifierCitations(d.extraction.citations, lignes);
          const erreurs = [
            ...introuvables.map((i) => `extraction.citations[${i}] : introuvable mot pour mot dans la transcription de l'appel`),
            ...deLAppelant.map((i) => `extraction.citations[${i}] : phrase de l'appelant : une citation vient du prospect`),
          ];
          if (erreurs.length > 0) {
            await annulerTransaction(client, imbriquee);
            return { statut: "invalide", erreurs, avertissements };
          }
        }
      }
    }
    const texte = transcriptionEnTexte(lignes);
    let gardee = lignes.length > 0;
    let raison = lignes.length === 0 ? "aucune" : null;
    if (gardee && sansTranscription) [gardee, raison] = [false, "option --sans-transcription"];
    else if (gardee && appel && !appel.conservable) [gardee, raison] = [false, "appel non conservable (enregistrement désactivé ou annonce non lue)"];
    else if (gardee && texte.length > BORNES.transcription) [gardee, raison] = [false, "trop longue pour la base"];

    // Le débrief.
    const dureeS = d.appel.dureeS ?? appel?.duree_s ?? null;
    const appelLe = d.appel.debut ?? new Date(appel?.debut ?? appel?.created_at ?? maintenant).toISOString();
    const extraction = extractionPourBase(d, { lignesTranscription: lignes.length, dureeS });
    const debrief = (
      await requete(
        `insert into public.debriefs (lead_id, appel_id, source, transcription, extraction, mots_cles, appel_le)
         values ($1, $2, $3, $4, $5::jsonb, $6::text[], $7) returning id`,
        [leadId, appel?.id ?? null, d.source, gardee ? texte : null, JSON.stringify(extraction), d.extraction.tags, appelLe],
      )
    )[0];

    // Le retour du marché.
    const r = ligneRetour(d, { leadId, debriefId: debrief.id, appelLe });
    const retour = (
      await requete(
        `insert into public.retours_marche (lead_id, debrief_id, appel_le, issue, douleur, objection_code, objection_texte,
                                            accroche_verdict, interet, decideur_joint, citation, tags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[]) returning id`,
        [r.lead_id, r.debrief_id, r.appel_le, r.issue, r.douleur, r.objection_code, r.objection_texte, r.accroche_verdict, r.interet, r.decideur_joint, r.citation, r.tags],
      )
    )[0];

    // La note datée (ou l'issue, comme le Poste) et les champs vides de la fiche.
    const note = composerNote(d, niche, { debut: appelLe });
    const { maj, remplis, dejaRemplis } = majFiche(fiche, d, { objection: !issueEnBase });
    let issue = { enregistree: false };
    if (issueEnBase) {
      const config = niche.issues.find((i) => i.code === d.extraction.issue);
      const objectionPourFiche = d.extraction.objection && vide(fiche.objection) ? d.extraction.objection : null;
      if (d.extraction.objection) (objectionPourFiche ? remplis : dejaRemplis).push("objection");
      const pe = d.extraction.prochaineEtape;
      const rappel = !config?.final && pe?.type === "rappel" ? pe.date : null;
      const details = { final: config?.final === true, tentativesMax: niche.tentativesMax };
      if (dureeS !== null) details.duree_s = dureeS;
      if (objectionPourFiche) details.objection = objectionPourFiche;
      const res = (await requete("select public.enregistrer_issue($1, $2, $3, $4, $5::jsonb) as r", [leadId, d.extraction.issue, note, rappel, JSON.stringify(details)]))[0];
      issue = { enregistree: true, statut: res?.r?.statut ?? null };
    } else {
      await requete("insert into public.lead_activities (lead_id, type, note, duree_s) values ($1, 'note', $2, $3)", [leadId, note, dureeS]);
    }
    const colonnes = Object.keys(maj);
    if (colonnes.length > 0) {
      await requete(
        `update public.leads set ${colonnes.map((c, i) => `${c} = $${i + 2}${c === "qualification" ? "::jsonb" : ""}`).join(", ")} where id = $1`,
        [leadId, ...colonnes.map((c) => (c === "qualification" ? JSON.stringify(maj[c]) : maj[c]))],
      );
    }

    const compteRendu = {
      statut: ecrire ? "ecrit" : "essai",
      avertissements,
      fiche: { id: leadId, par, remplis, dejaRemplis },
      debrief: {
        id: debrief.id,
        source: d.source,
        appelLie: Boolean(appel),
        transcription: { gardee, lignes: lignes.length, origine, raison },
        champs: Object.keys(d.extraction.champs).length,
        douleurs: d.extraction.douleurs.length,
        croyances: d.extraction.croyances.length,
        citations: d.extraction.citations.length,
        tags: d.extraction.tags.length,
      },
      retour: {
        id: retour.id,
        issue: r.issue,
        objection: r.objection_code,
        verdict: d.verdict,
        verdictBase: r.accroche_verdict,
        interet: r.interet,
        decideur: r.decideur_joint,
      },
      journal: { type: issueEnBase ? "appel" : "note", caracteres: note.length },
      issue,
    };
    if (ecrire) await validerTransaction(client, imbriquee);
    else await annulerTransaction(client, imbriquee);
    return compteRendu;
  } catch (e) {
    await annulerTransaction(client, imbriquee).catch(() => {});
    return { statut: "erreur", erreur: codeErreur(e), code: e?.code ?? null, avertissements };
  }
}

const oui = (b) => (b ? "oui" : "non");

/**
 * Le fichier du débrief (une transcription, des citations) : refusé s'il est introuvable ou posé dans un dépôt git (un transcript n'entre
 * jamais dans un dépôt : il se prépare dans le scratchpad de Claude Code). null s'il peut être lu.
 */
export function refusFichierDebrief(chemin) {
  let reel;
  try {
    reel = realpathSync(resolve(chemin));
  } catch {
    return "le fichier est introuvable";
  }
  return dansUnDepot(dirname(reel)) ? "le fichier est dans un dépôt git : déplace-le hors du dépôt (le scratchpad de Claude Code), puis relance" : null;
}

/** Le compte rendu en lignes de console : des compteurs, des codes de la config et des identifiants ; jamais une valeur du débrief. */
export function lignesCompteRendu(r) {
  const l = [];
  for (const a of r.avertissements ?? []) l.push(`attention : ${a}`);
  if (r.statut === "invalide") {
    l.push(`JSON REFUSÉ (${r.erreurs.length} problème${r.erreurs.length > 1 ? "s" : ""}) : rien n'est écrit.`);
    for (const e of r.erreurs) l.push(`  - ${e}`);
    return l;
  }
  if (r.statut === "arret") {
    l.push(`ARRÊT : ${r.raison}. Rien n'est écrit.`);
    if (r.comptes) l.push(`  comptes trouvés : ${r.comptes}`);
    if (r.candidats) {
      l.push(`  fiches candidates : ${r.total ?? r.candidats.length}${r.candidats.length < (r.total ?? 0) ? ` (les ${r.candidats.length} premières)` : ""}`);
      for (const c of r.candidats) l.push(`  ${c.id}  statut ${c.statut ?? "?"}  dernière activité ${c.derniere ?? "aucune"}`);
    }
    return l;
  }
  if (r.statut === "erreur") {
    l.push(`ERREUR : rien n'est écrit (${r.erreur}).`);
    return l;
  }
  const t = r.debrief.transcription;
  const parFiche = { id: "par son id", telephone: "par téléphone", entreprise: "par nom d'entreprise", appel: "par l'appel", creee: "créée" }[r.fiche.par];
  l.push(r.statut === "essai" ? "ESSAI : tout a été contrôlé par la base puis ANNULÉ. Rien n'est écrit." : "ÉCRIT (une transaction).");
  l.push(r.fiche.par === "creee" && r.statut === "essai" ? "  fiche          : nouvelle fiche (serait créée)" : `  fiche          : ${r.fiche.id} (${parFiche})`);
  l.push(
    `  débrief        : source ${r.debrief.source}${r.debrief.appelLie ? ", lié à l'appel en base" : ""} ; ` +
      `transcription ${t.gardee ? `gardée (${t.lignes} énoncés${t.origine === "appel" ? ", celle de l'appel" : ""})` : `non gardée (${t.raison})`} ; ` +
      `${r.debrief.champs} champ(s), ${r.debrief.douleurs} douleur(s), ${r.debrief.croyances} croyance(s), ${r.debrief.citations} citation(s), ${r.debrief.tags} tag(s)`,
  );
  l.push(
    `  retour marché  : issue ${r.retour.issue} ; objection ${r.retour.objection ?? "aucune"} ; verdict de l'accroche ${r.retour.verdict ? `${r.retour.verdict} (« ${r.retour.verdictBase} » en base)` : "aucun"} ; ` +
      `intérêt ${r.retour.interet === null ? "non noté" : `${r.retour.interet}/3`} ; décideur joint ${oui(r.retour.decideur)}`,
  );
  l.push(`  journal        : ${r.journal.type === "appel" ? "issue enregistrée comme au Poste" : "note datée"} (${r.journal.caracteres} caractères)`);
  if (r.issue.enregistree) l.push(`  issue          : statut de la fiche après l'appel : ${r.issue.statut}`);
  else l.push("  issue          : non enregistrée (ajoute --issue si elle n'a pas été notée au Poste)");
  l.push(
    `  fiche, champs  : ${r.fiche.remplis.length} rempli(s)${r.fiche.remplis.length ? ` (${r.fiche.remplis.join(", ")})` : ""}, ` +
      `${r.fiche.dejaRemplis.length} déjà rempli(s), laissé(s) tel(s) quel(s)${r.fiche.dejaRemplis.length ? ` (${r.fiche.dejaRemplis.join(", ")})` : ""}`,
  );
  if (r.statut === "ecrit") l.push(`  identifiants   : débrief ${r.debrief.id}, retour ${r.retour.id}`);
  else l.push("Relance avec --ecrire pour écrire.");
  return l;
}

function lireArguments(argv) {
  const args = { fichier: null, ecrire: false, essai: false, avecIssue: false, sansTranscription: false, appelant: null, inconnus: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ecrire") args.ecrire = true;
    else if (a === "--essai") args.essai = true;
    else if (a === "--issue") args.avecIssue = true;
    else if (a === "--sans-transcription") args.sansTranscription = true;
    else if (a === "--appelant") args.appelant = argv[++i] ?? null;
    else if (a.startsWith("--")) args.inconnus.push(a);
    else if (!args.fichier) args.fichier = a;
    else args.inconnus.push("(fichier en trop)");
  }
  return args;
}

async function main() {
  const args = lireArguments(process.argv.slice(2));
  const usage = "Usage : node scripts/debrief/ecrire.mjs <debrief.json> [--ecrire] [--appelant <e-mail ou id>] [--issue] [--sans-transcription]   (sans --ecrire : essai, rien n'est écrit)";
  if (!args.fichier || args.inconnus.length > 0 || (args.ecrire && args.essai)) {
    console.error(args.inconnus.length ? `Option inconnue : ${args.inconnus.join(", ")}` : usage);
    if (args.inconnus.length) console.error(usage);
    process.exitCode = 1;
    return;
  }
  const refus = refusFichierDebrief(args.fichier);
  if (refus) {
    console.error(`ERREUR : ${refus}. Rien n'est lu.`);
    process.exitCode = 1;
    return;
  }
  let entree;
  try {
    entree = JSON.parse(readFileSync(args.fichier, "utf8"));
  } catch {
    console.error("ERREUR : le fichier est illisible ou n'est pas du JSON (voir docs/debrief.md).");
    process.exitCode = 1;
    return;
  }
  let niche;
  try {
    niche = await chargerConfig();
  } catch {
    console.error("ERREUR : config/niche.json invalide (lance npm test pour voir les problèmes).");
    process.exitCode = 1;
    return;
  }
  chargerEnvLocal();
  const connexion = await ouvrirConnexion();
  if (!connexion.ok) {
    console.error(`ERREUR : ${connexion.raison}.`);
    process.exitCode = 1;
    return;
  }
  try {
    const r = await traiterDebrief({
      client: connexion.client,
      entree,
      niche,
      appelant: args.appelant,
      ecrire: args.ecrire,
      avecIssue: args.avecIssue,
      sansTranscription: args.sansTranscription,
    });
    const lignes = lignesCompteRendu(r);
    const sortie = r.statut === "essai" || r.statut === "ecrit" ? console.log : console.error;
    for (const ligne of lignes) sortie(ligne);
    process.exitCode = r.statut === "arret" ? 2 : r.statut === "invalide" || r.statut === "erreur" ? 1 : 0;
  } finally {
    await connexion.client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
