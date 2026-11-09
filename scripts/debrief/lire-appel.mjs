// La transcription d'un appel déjà en base (reçue du fournisseur de téléphonie par webhook : Onoff, Aircall…), pour le débrief : Claude
// Code la lit dans un fichier HORS dépôt, écrit le JSON (docs/debrief.md, avec appel.externe_id), puis scripts/debrief/ecrire.mjs le range.
//
//   node scripts/debrief/lire-appel.mjs --liste [--jours 7] [--appelant <e-mail ou id>]
//       les 20 derniers appels transcrits que le compte peut voir : date, durée, statut, fournisseur, externe_id, fiche rattachée
//       (oui ou non), nombre d'énoncés, conservable (oui ou non). Jamais un nom ni un numéro.
//   node scripts/debrief/lire-appel.mjs --externe-id <id> [--fournisseur <f>] [--appelant <e-mail ou id>] <dossier hors dépôt>
//       écrit la transcription dans <dossier>/appel-<fournisseur>-<id>.txt (lisible par toi seul). Refusé si l'appel n'est plus
//       conservable (enregistrement désactivé depuis, ou annonce non lue) ou si le dossier est dans un dépôt git.
//
// Lecture sous l'identité du compte (RLS : un appelant ne voit que ses appels). Console : des compteurs et des codes seulement.
// Connexion : SUPABASE_DB_URL (lue dans .env.local si besoin), jamais affichée.

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { annulerTransaction, chargerEnvLocal, codeErreur, connecterComme, ouvrirConnexion, ouvrirTransaction, resoudreAppelant } from "./base.mjs";
import { FOURNISSEURS, dateLisible, dossierHorsDepot, lireTranscriptionAppel, transcriptionEnTexte } from "./lib.mjs";

const RE_EXTERNE = /^[A-Za-z0-9_.:-]{1,80}$/;
const STATUTS = { repondu: "répondu", sans_reponse: "sans réponse", occupe: "occupé", messagerie: "messagerie", faux_numero: "faux numéro", inconnu: "inconnu" };

function duree(s) {
  if (s === null || s === undefined) return "durée inconnue";
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Lit sous l'identité du compte, dans une transaction annulée (rien n'est jamais écrit ici). `imbriquee` : un point de sauvegarde. */
async function lireCommeLeCompte(client, uid, sql, params, imbriquee) {
  await ouvrirTransaction(client, imbriquee);
  try {
    await connecterComme(client, uid);
    return (await client.query(sql, params)).rows;
  } finally {
    await annulerTransaction(client, imbriquee);
  }
}

/** Les derniers appels transcrits visibles du compte. */
export async function listerAppels({ client, appelant = null, jours = 7, imbriquee = false }) {
  const compte = await resoudreAppelant(client, appelant);
  if (!compte.ok) return { ok: false, raison: compte.raison };
  const lignes = await lireCommeLeCompte(
    client,
    compte.profil.id,
    `select a.id, a.fournisseur, a.externe_id, coalesce(a.debut, a.created_at) as quand, a.duree_s, a.statut,
            a.lead_id is not null as a_fiche, jsonb_array_length(a.transcription) as lignes
       from public.appels a
      where a.created_at >= now() - make_interval(days => $1) and jsonb_array_length(a.transcription) > 0
      order by coalesce(a.debut, a.created_at) desc
      limit 20`,
    [jours],
    imbriquee,
  );
  const ids = lignes.map((l) => l.id);
  const conservables = new Map(
    (await client.query("select a.id, public.appel_conservable(a.id) as c from public.appels a where a.id = any($1::uuid[])", [ids])).rows.map((r) => [r.id, r.c]),
  );
  const fuseau = (await client.query("select fuseau from public.workspaces where id = $1", [compte.profil.workspace_id])).rows[0]?.fuseau ?? "Europe/Paris";
  return {
    ok: true,
    appels: lignes.map((l) => ({
      quand: dateLisible(l.quand, fuseau),
      duree: duree(l.duree_s),
      statut: STATUTS[l.statut] ?? l.statut,
      fournisseur: l.fournisseur,
      externeId: l.externe_id,
      aFiche: l.a_fiche,
      lignes: Number(l.lignes),
      conservable: conservables.get(l.id) === true,
    })),
  };
}

/** Écrit la transcription d'un appel dans un fichier hors dépôt ; renvoie le chemin et des compteurs. */
export async function exporterAppel({ client, appelant = null, fournisseur = null, externeId, dossier, imbriquee = false }) {
  if (!RE_EXTERNE.test(externeId ?? "")) return { ok: false, raison: "--externe-id : identifiant illisible" };
  if (fournisseur && !FOURNISSEURS.includes(fournisseur)) return { ok: false, raison: `--fournisseur : permis ${FOURNISSEURS.join(", ")}` };
  const sortie = dossierHorsDepot(dossier);
  if (!sortie.ok) return { ok: false, raison: sortie.raison };
  const compte = await resoudreAppelant(client, appelant);
  if (!compte.ok) return { ok: false, raison: compte.raison };
  const trouves = (
    await client.query(
      `select a.id, a.fournisseur, public.appel_conservable(a.id) as conservable from public.appels a
        where a.workspace_id = $1 and a.externe_id = $2 and ($3::text is null or a.fournisseur = $3)`,
      [compte.profil.workspace_id, externeId, fournisseur],
    )
  ).rows;
  if (trouves.length === 0) return { ok: false, raison: "appel introuvable dans l'équipe" };
  if (trouves.length > 1) return { ok: false, raison: "plusieurs fournisseurs pour cet identifiant : précise --fournisseur" };
  const appel = trouves[0];
  if (!appel.conservable) return { ok: false, raison: "appel non conservable (enregistrement désactivé ou annonce non lue) : sa transcription ne se lit pas" };
  const visibles = await lireCommeLeCompte(
    client,
    compte.profil.id,
    "select a.transcription, coalesce(a.debut, a.created_at) as quand, a.duree_s from public.appels a where a.id = $1",
    [appel.id],
    imbriquee,
  );
  if (visibles.length !== 1) return { ok: false, raison: "appel non visible pour ce compte (un appelant ne voit que ses appels)" };
  const lignes = lireTranscriptionAppel(visibles[0].transcription);
  if (lignes.length === 0) return { ok: false, raison: "cet appel n'a pas de transcription en base" };
  const entete = [
    `Fournisseur : ${appel.fournisseur}`,
    `Identifiant (appel.externe_id) : ${externeId}`,
    `Début : ${new Date(visibles[0].quand).toISOString()}`,
    `Durée (s) : ${visibles[0].duree_s ?? "inconnue"}`,
    "",
  ].join("\n");
  const chemin = join(sortie.dossier, `appel-${appel.fournisseur}-${externeId.replace(/[^A-Za-z0-9_.-]/g, "_")}.txt`);
  const contenu = `${entete}\n${transcriptionEnTexte(lignes)}\n`;
  writeFileSync(chemin, contenu, { encoding: "utf8", mode: 0o600 });
  chmodSync(chemin, 0o600);
  return { ok: true, chemin, lignes: lignes.length, caracteres: contenu.length };
}

function valeur(args, option) {
  const i = args.indexOf(option);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "Usage : node scripts/debrief/lire-appel.mjs --liste [--jours 7] [--appelant <e-mail ou id>]\n" +
    "        node scripts/debrief/lire-appel.mjs --externe-id <id> [--fournisseur <f>] [--appelant <e-mail ou id>] <dossier hors dépôt>";
  const liste = args.includes("--liste");
  const externeId = valeur(args, "--externe-id");
  if (liste === Boolean(externeId)) {
    console.error(usage);
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
  const client = connexion.client;
  try {
    const appelant = valeur(args, "--appelant");
    if (liste) {
      const jours = Math.min(90, Math.max(1, Number.parseInt(valeur(args, "--jours") ?? "7", 10) || 7));
      const r = await listerAppels({ client, appelant, jours });
      if (!r.ok) {
        console.error(`ARRÊT : ${r.raison}.`);
        process.exitCode = 2;
        return;
      }
      console.log(`${r.appels.length} appel(s) transcrit(s) sur ${jours} jour(s), du plus récent au plus ancien :`);
      r.appels.forEach((a, i) =>
        console.log(
          `${i + 1}. ${a.quand} · ${a.duree} · ${a.statut} · ${a.fournisseur} · externe_id ${a.externeId} · fiche ${a.aFiche ? "oui" : "non"} · ` +
            `${a.lignes} énoncés · conservable ${a.conservable ? "oui" : "non"}`,
        ),
      );
      return;
    }
    const options = new Set(["--externe-id", "--fournisseur", "--appelant"]);
    const dossier = args.filter((a, i) => !a.startsWith("--") && !options.has(args[i - 1])).pop();
    const r = await exporterAppel({ client, appelant, fournisseur: valeur(args, "--fournisseur"), externeId, dossier });
    if (!r.ok) {
      console.error(`ARRÊT : ${r.raison}.`);
      process.exitCode = 2;
      return;
    }
    console.log(r.chemin);
    console.log(`${r.lignes} énoncés, ${r.caracteres} caractères. Supprime ce fichier une fois le débrief écrit.`);
  } catch (e) {
    console.error(`ERREUR : ${codeErreur(e)}.`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
