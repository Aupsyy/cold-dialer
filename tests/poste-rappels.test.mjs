// Le rappel automatique au créneau alterné, les raccourcis de rappel, les tentatives (lib/poste/rappels.ts) et les deux créneaux de
// rendez-vous (lib/poste/creneaux.ts) : autour des week-ends, des jours fériés, du changement d'heure et du fuseau.
import assert from "node:assert/strict";
import { test } from "node:test";
import { creneauAlterne, etatTentatives, raccourcisRappel, rappelAutomatique } from "../lib/poste/rappels.ts";
import { creneauxRdv, deuxCreneaux } from "../lib/poste/creneaux.ts";

const FR = { fuseau: "Europe/Paris", pays: "FR" };
const iso = (t) => new Date(t).toISOString();
const a = (s) => Date.parse(s);

test("créneau alterné : un appel du matin est rappelé l'après-midi du prochain jour ouvré", () => {
  const r = creneauAlterne(a("2026-11-09T09:00:00Z"), FR); // lundi 10 h
  assert.equal(iso(r.t), "2026-11-10T15:00:00.000Z"); // mardi 16 h
  assert.equal(r.libelle, "Demain 16 h");
  assert.equal(r.moment, "apres_midi");
});

test("créneau alterné : un appel de l'après-midi est rappelé le matin du prochain jour ouvré", () => {
  const r = creneauAlterne(a("2026-11-09T14:00:00Z"), FR); // lundi 15 h
  assert.equal(iso(r.t), "2026-11-10T08:30:00.000Z"); // mardi 9 h 30
  assert.equal(r.libelle, "Demain 9 h 30");
  assert.equal(r.moment, "matin");
});

test("créneau alterné : 12 h 59 est encore le matin, 13 h l'après-midi", () => {
  assert.equal(creneauAlterne(a("2026-11-09T11:59:00Z"), FR).moment, "apres_midi", "12 h 59 à Paris : matin, rappel l'après-midi");
  assert.equal(creneauAlterne(a("2026-11-09T12:00:00Z"), FR).moment, "matin", "13 h à Paris : après-midi, rappel le matin");
});

test("créneau alterné : jamais un week-end ni un jour férié", () => {
  assert.equal(iso(creneauAlterne(a("2026-11-10T09:00:00Z"), FR).t), "2026-11-12T15:00:00.000Z", "mardi matin -> jeudi (11 novembre férié)");
  assert.equal(creneauAlterne(a("2026-11-10T09:00:00Z"), FR).libelle, "Jeudi 16 h");
  assert.equal(iso(creneauAlterne(a("2026-11-13T10:00:00Z"), FR).t), "2026-11-16T15:00:00.000Z", "vendredi matin -> lundi après-midi");
  assert.equal(creneauAlterne(a("2026-11-13T10:00:00Z"), FR).libelle, "Lundi 16 h");
  assert.equal(iso(creneauAlterne(a("2026-11-13T16:30:00Z"), FR).t), "2026-11-16T08:30:00.000Z", "vendredi soir -> lundi matin");
  assert.equal(iso(creneauAlterne(a("2026-11-14T09:00:00Z"), FR).t), "2026-11-16T15:00:00.000Z", "samedi matin -> lundi après-midi");
  assert.equal(iso(creneauAlterne(a("2026-11-15T19:00:00Z"), FR).t), "2026-11-16T08:30:00.000Z", "dimanche soir -> lundi matin");
  assert.equal(iso(creneauAlterne(a("2026-12-24T14:00:00Z"), FR).t), "2026-12-28T08:30:00.000Z", "veille de Noël -> lundi 28");
});

test("créneau alterné : le changement d'heure et le fuseau de la config", () => {
  assert.equal(iso(creneauAlterne(a("2026-03-27T10:00:00Z"), FR).t), "2026-03-30T14:00:00.000Z", "lundi 16 h, déjà à l'heure d'été");
  // 15 h UTC : 10 h à Toronto (le matin) mais 16 h à Paris (l'après-midi) : le fuseau décide.
  const toronto = creneauAlterne(a("2026-11-09T15:00:00Z"), { fuseau: "America/Toronto", pays: "CA" });
  assert.equal(iso(toronto.t), "2026-11-10T21:00:00.000Z", "mardi 16 h à Toronto");
  assert.equal(iso(creneauAlterne(a("2026-11-09T15:00:00Z"), FR).t), "2026-11-10T08:30:00.000Z", "mardi 9 h 30 à Paris");
  // Les jours fériés suivent le pays : le 21 juillet est férié en Belgique, pas en France.
  const be = creneauAlterne(a("2026-07-20T08:00:00Z"), { fuseau: "Europe/Brussels", pays: "BE" });
  assert.equal(iso(be.t), "2026-07-22T14:00:00.000Z");
  assert.equal(iso(creneauAlterne(a("2026-07-20T08:00:00Z"), FR).t), "2026-07-21T14:00:00.000Z");
});

test("rappel automatique : seulement pour une issue « creneau_alterne »", () => {
  const maintenant = a("2026-11-09T09:00:00Z");
  assert.equal(iso(rappelAutomatique({ rappelAuto: "creneau_alterne" }, maintenant, FR).t), "2026-11-10T15:00:00.000Z");
  assert.equal(rappelAutomatique({ rappelAuto: null }, maintenant, FR), null);
  assert.equal(rappelAutomatique({}, maintenant, FR), null);
});

test("raccourcis de rappel : dans 1 h, cet après-midi, le prochain jour ouvré, dans une semaine", () => {
  const lundi = raccourcisRappel(a("2026-11-09T09:02:00Z"), FR);
  assert.deepEqual(lundi.map((r) => r.id), ["1h", "apres-midi", "matin-suivant", "apres-midi-suivant", "semaine"]);
  assert.equal(iso(lundi[0].t), "2026-11-09T10:05:00.000Z", "arrondi à 5 minutes");
  assert.equal(lundi[2].libelle, "Demain 9 h 30");
  assert.equal(iso(lundi[4].t), "2026-11-16T08:30:00.000Z");
  const samedi = raccourcisRappel(a("2026-11-14T09:00:00Z"), FR);
  assert.ok(!samedi.some((r) => r.id === "apres-midi"), "pas « cet après-midi » un samedi");
  const tard = raccourcisRappel(a("2026-11-09T14:45:00Z"), FR);
  assert.ok(!tard.some((r) => r.id === "apres-midi"), "moins de 30 minutes avant 16 h");
});

test("tentatives : la dernière est annoncée, la limite dépassée aussi", () => {
  assert.deepEqual(etatTentatives(1, 4), { deja: 1, tentative: 2, max: 4, derniere: false, depassee: false, texte: "Tentative 2 sur 4" });
  assert.equal(etatTentatives(3, 4).texte, "Tentative 4 sur 4, la dernière");
  assert.ok(etatTentatives(3, 4).derniere);
  assert.equal(etatTentatives(4, 4).texte, "4 tentatives déjà : la limite est de 4");
  assert.equal(etatTentatives(Number.NaN, 4).tentative, 1);
});

test("deux créneaux de rendez-vous : jours ouvrés, deux jours, deux moments", () => {
  const lundi = a("2026-11-09T10:00:00Z");
  const d = deuxCreneaux(lundi, FR, { dureeMin: 20 });
  assert.equal(d.texte, "demain à 10 h ou jeudi à 14 h 30", "mercredi 11 novembre férié : sauté");
  assert.equal(iso(d.premier.debut), "2026-11-10T09:00:00.000Z");
  assert.equal(iso(d.premier.fin), "2026-11-10T09:20:00.000Z");
  const vendredi = deuxCreneaux(a("2026-11-13T10:00:00Z"), FR, { dureeMin: 30 });
  assert.equal(vendredi.texte, "lundi à 10 h ou mardi à 14 h 30");
  const occupe = deuxCreneaux(lundi, FR, { dureeMin: 20, occupes: [{ debut: a("2026-11-10T08:45:00Z"), fin: a("2026-11-10T09:15:00Z") }] });
  assert.equal(occupe.texte, "demain à 14 h 30 ou jeudi à 10 h", "un rendez-vous déjà pris n'est pas reproposé");
  assert.ok(creneauxRdv(lundi, FR, { dureeMin: 20 }).every((c) => c.debut > lundi));
  const plein = deuxCreneaux(lundi, FR, { dureeMin: 20, occupes: [{ debut: lundi, fin: lundi + 60 * 86_400_000 }] });
  assert.equal(plein, null, "rien de libre : pas de créneau inventé");
});
