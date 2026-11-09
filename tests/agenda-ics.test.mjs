// Le flux ICS (lib/agenda/ics.ts, lib/agenda/flux.ts) : fichier iCalendar valide sur un jeu fictif, échappement, lignes pliées à 75
// octets, UID stables, jeton inconnu → 404, cache court, aucun jeton au journal. Tout est inventé.
import assert from "node:assert/strict";
import { test } from "node:test";
import { repondreFlux } from "../lib/agenda/flux.ts";
import { dateIcs, echapperIcs, evenementsDepuisFlux, genererIcs, jetonDepuisSegment, nomCalendrier, plierLigne, statutIcs } from "../lib/agenda/ics.ts";

const JETON = "ab".repeat(32);
const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://projet-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle-service-inventee" };
const GENERE = Date.parse("2026-11-09T07:00:00Z");

// La forme de la réponse de agenda_flux(p_jeton) (migration 0001), avec des valeurs inventées.
const FLUX = {
  closer: { id: "a1000000-0000-4000-8000-000000000001", nom: "Camille Démo" },
  genereLe: "2026-11-09T07:00:00Z",
  rendezVous: [
    {
      id: "d0000000-0000-4000-8000-000000000001", leadId: "ca100000-0000-4000-8000-000000000001", entreprise: "Atelier Démo 01; Paysage, Jardins \\ Cie",
      debut: "2026-11-10T09:00:00+00:00", fin: "2026-11-10T09:20:00+00:00", statut: "pris", canal: "visio", lienVisio: "https://visio.example.org/abc-defg-hij",
      creeLe: "2026-11-05T10:00:00+00:00", majLe: "2026-11-06T10:00:00+00:00",
    },
    {
      id: "d0000000-0000-4000-8000-000000000002", leadId: null, entreprise: null, debut: "2026-11-11T14:00:00+00:00", fin: "2026-11-11T14:30:00+00:00",
      statut: "annule", canal: "telephone", lienVisio: null, creeLe: "2026-11-05T10:00:00+00:00", majLe: "2026-11-05T10:00:00+00:00",
    },
    { id: "pas-un-uuid", debut: "2026-11-12T09:00:00Z", fin: "2026-11-12T09:30:00Z", statut: "pris" },
  ],
};

const OPTIONS_FLUX = { base: "https://app.example.org/", nomRdv: "Diagnostic offert" };

function ics(flux = FLUX) {
  return genererIcs(evenementsDepuisFlux(flux, OPTIONS_FLUX), { nom: nomCalendrier(flux, "Poste d'appels"), fuseau: "Europe/Paris", genereLe: GENERE });
}

/** Les lignes logiques d'un .ics (lignes pliées recollées). */
function deplier(texte) {
  return texte.replace(/\r\n /g, "").split("\r\n").filter((l) => l !== "");
}

test("ICS : un fichier valide (VCALENDAR, VEVENT, propriétés obligatoires, CRLF, lignes de 75 octets au plus)", () => {
  const texte = ics();
  assert.ok(texte.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:"));
  assert.ok(texte.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(texte), "chaque fin de ligne est CRLF");
  for (const ligne of texte.split("\r\n")) assert.ok(new TextEncoder().encode(ligne).byteLength <= 75, `ligne trop longue : ${ligne.slice(0, 30)}`);
  const lignes = deplier(texte);
  assert.equal(lignes.filter((l) => l === "BEGIN:VEVENT").length, 2, "la ligne illisible est ignorée");
  assert.equal(lignes.filter((l) => l === "END:VEVENT").length, 2);
  assert.equal(lignes.filter((l) => l === "BEGIN:VALARM").length, 1, "un rappel pour le rendez-vous actif, pas pour l'annulé");
  for (const prop of ["UID:", "DTSTAMP:", "DTSTART:", "DTEND:", "SUMMARY:", "STATUS:"]) {
    assert.equal(lignes.filter((l) => l.startsWith(prop)).length, 2, prop);
  }
  assert.ok(lignes.includes("DTSTART:20261110T090000Z"));
  assert.ok(lignes.includes("DTEND:20261110T092000Z"));
  assert.ok(lignes.includes("DTSTAMP:20261109T070000Z"));
  assert.ok(lignes.includes("STATUS:TENTATIVE"));
  assert.ok(lignes.includes("STATUS:CANCELLED"));
  assert.ok(lignes.includes("X-WR-CALNAME:Poste d'appels · Camille"));
  assert.ok(lignes.includes("X-WR-TIMEZONE:Europe/Paris"));
  assert.ok(lignes.includes("LOCATION:https://visio.example.org/abc-defg-hij"));
  assert.ok(lignes.includes("URL:https://app.example.org/prospects/ca100000-0000-4000-8000-000000000001"));
  assert.ok(lignes.includes("SUMMARY:Diagnostic offert"), "sans fiche : le nom du rendez-vous seul");
  assert.ok(!texte.includes("@example.com"), "jamais un e-mail");
});

test("ICS : échappement des caractères (; , \\ et sauts de ligne) et retrait des caractères de contrôle", () => {
  assert.equal(echapperIcs("a;b,c\\d\ne\r\nf\tg\u0007h"), "a\\;b\\,c\\\\d\\ne\\nfgh");
  const lignes = deplier(ics());
  assert.ok(lignes.includes("SUMMARY:Diagnostic offert · Atelier Démo 01\\; Paysage\\, Jardins \\\\ Cie"));
  assert.ok(lignes.some((l) => l.startsWith("DESCRIPTION:Visio : https://visio.example.org/abc-defg-hij\\nFiche : https://app.example.org/prospects/")));
  assert.ok(lignes.some((l) => l.startsWith("DESCRIPTION:Par téléphone.\\nStatut : annulé.")));
});

test("ICS : UID stables d'une génération à l'autre ; SEQUENCE croît avec les modifications", () => {
  const uid = (texte) => deplier(texte).filter((l) => l.startsWith("UID:"));
  const premier = uid(ics());
  assert.deepEqual(premier, ["UID:d0000000-0000-4000-8000-000000000001@cold-dialer", "UID:d0000000-0000-4000-8000-000000000002@cold-dialer"]);
  const modifie = structuredClone(FLUX);
  modifie.rendezVous[0].debut = "2026-11-10T10:00:00+00:00";
  modifie.rendezVous[0].fin = "2026-11-10T10:20:00+00:00";
  modifie.rendezVous[0].majLe = "2026-11-07T10:00:00+00:00";
  assert.deepEqual(uid(ics(modifie)), premier, "un déplacement garde l'UID : le client met à jour, sans doublon");
  const sequence = (texte) => Number(deplier(texte).find((l) => l.startsWith("SEQUENCE:")).slice(9));
  assert.ok(sequence(ics(modifie)) > sequence(ics()));
});

test("ICS : outils (dates, pliage UTF-8, statuts, jeton)", () => {
  assert.equal(dateIcs("2026-11-10T09:00:00.000Z"), "20261110T090000Z");
  assert.equal(dateIcs("2026-11-10T10:00:00+01:00"), "20261110T090000Z");
  assert.equal(dateIcs("pas une date"), null);
  const longue = `SUMMARY:${"é".repeat(80)}`;
  const pliee = plierLigne(longue);
  assert.ok(pliee.length > 1);
  for (const l of pliee) assert.ok(new TextEncoder().encode(l).byteLength <= 75);
  assert.equal(pliee.map((l, i) => (i === 0 ? l : l.slice(1))).join(""), longue, "aucun caractère coupé ni perdu");
  assert.deepEqual(["pris", "confirme", "tenu", "no_show", "annule", "reporte"].map(statutIcs), ["TENTATIVE", "CONFIRMED", "CONFIRMED", "CANCELLED", "CANCELLED", "CANCELLED"]);
  assert.equal(jetonDepuisSegment(JETON), JETON);
  assert.equal(jetonDepuisSegment(`${JETON}.ics`), JETON);
  assert.equal(jetonDepuisSegment(`${JETON.toUpperCase()}`), null);
  for (const mauvais of ["", "abc", `${JETON}0`, "../etc", "%E0%A4%A", null, 42]) assert.equal(jetonDepuisSegment(mauvais), null, String(mauvais));
});

function dependances(reponse = async () => ({ data: FLUX, error: null }), env = ENV) {
  const appels = [];
  const journal = [];
  return {
    appels,
    journal,
    d: {
      env,
      base: () => async (fonction, args) => {
        appels.push({ fonction, args });
        return reponse(args);
      },
      journal: (code, grave) => journal.push({ code, grave: Boolean(grave) }),
      origine: "https://app.example.org",
      fuseau: "Europe/Paris",
      nomRdv: "Diagnostic offert",
      nomProduit: "Poste d'appels",
      maintenant: () => GENERE,
    },
  };
}

test("ICS : la route (200 text/calendar en cache court et privé ; jeton mal formé ou inconnu → 404 ; base en panne → 502)", async () => {
  const x = dependances();
  const r = await repondreFlux(`${JETON}.ics`, x.d);
  assert.equal(r.statut, 200);
  assert.equal(r.entetes["Content-Type"], "text/calendar; charset=utf-8");
  assert.equal(r.entetes["Cache-Control"], "private, max-age=300");
  assert.ok(r.corps.startsWith("BEGIN:VCALENDAR"));
  assert.deepEqual(x.appels, [{ fonction: "agenda_flux", args: { p_jeton: JETON } }]);

  const inconnu = dependances(async () => ({ data: null, error: null }));
  assert.equal((await repondreFlux(JETON, inconnu.d)).statut, 404);
  const malForme = dependances();
  const r404 = await repondreFlux("pas-un-jeton", malForme.d);
  assert.equal(r404.statut, 404);
  assert.equal(r404.corps, (await repondreFlux(JETON, inconnu.d)).corps, "le même message : on ne dit pas si le jeton a existé");
  assert.equal(malForme.appels.length, 0, "un jeton mal formé ne va même pas en base");
  const panne = dependances(async () => ({ data: null, error: { code: "57014" } }));
  assert.equal((await repondreFlux(JETON, panne.d)).statut, 502);
  const sansCle = dependances(undefined, {});
  assert.equal((await repondreFlux(JETON, sansCle.d)).statut, 503);
  for (const j of [x, inconnu, malForme, panne, sansCle].flatMap((d) => d.journal)) assert.ok(!j.code.includes(JETON), "jamais le jeton au journal");
});
