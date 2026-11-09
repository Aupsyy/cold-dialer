// La reprise différée (lib/telephonie/recuperation.ts) : le secret de la tâche planifiée (Bearer CRON_SECRET, temps constant), le
// choix des appels (20 tentatives au plus, une par minute), la reprise d'un appel (rien si non conservable ou complet, une tentative
// comptée par la base, puis l'API du fournisseur), et un passage borné (pause entre deux appels, budget, compteurs sans identifiant).
import assert from "node:assert/strict";
import { test } from "node:test";
import { recuperateurOnoff } from "../lib/telephonie/onoff.ts";
import {
  BUDGET_PASSAGE_MS,
  LOT_TRAITEMENT,
  MAX_TENTATIVES,
  PAUSE_ENTRE_APPELS_MS,
  RECUPERATEURS,
  autoriseCron,
  recupererAppel,
  recupererEnAttente,
  selectionnerAppels,
  variablesRepriseManquantes,
} from "../lib/telephonie/recuperation.ts";
import { ENV_BASE, WS, dependances, fausseBase, fauxFetch, journalPropre, reponseAudio, reponseJson, routesStockage } from "./telephonie-faux.mjs";

const CRON = "secret-cron-de-test-0123456789";
const ENV = { ...ENV_BASE, ONOFF_API_KEY: "cle-api-onoff-de-test", CRON_SECRET: CRON };
const MAINTENANT = Date.parse("2026-11-09T10:00:00Z");
const URL_AUDIO = "https://stockage.example.org/audio/demo.mp4?signature=inventee";

test("autoriseCron : exactement « Bearer <CRON_SECRET> » ; un secret absent ou de moins de 16 caractères refuse tout", () => {
  assert.equal(autoriseCron(`Bearer ${CRON}`, ENV), true);
  for (const e of [null, "", CRON, `Bearer ${CRON}x`, `bearer ${CRON}`, `Bearer  ${CRON}`]) assert.equal(autoriseCron(e, ENV), false, String(e));
  assert.equal(autoriseCron("Bearer court", { CRON_SECRET: "court" }), false);
  assert.equal(autoriseCron("Bearer ", {}), false);
});

test("les fournisseurs repris : Onoff et Aircall (par leur API) ; ni Ringover, ni le softphone, ni le téléphone", () => {
  assert.deepEqual(Object.keys(RECUPERATEURS).sort(), ["aircall", "onoff"]);
  assert.deepEqual(variablesRepriseManquantes(recuperateurOnoff, ENV_BASE), ["ONOFF_API_KEY"]);
  assert.deepEqual(variablesRepriseManquantes(RECUPERATEURS.aircall, ENV_BASE), ["AIRCALL_API_ID", "AIRCALL_API_TOKEN"]);
});

test("le choix des appels : plafond de tentatives, une minute entre deux, lignes illisibles écartées, un lot borné", () => {
  const ligne = (x) => ({ externe_id: "demo-1", workspace_id: WS, tentatives: 0, derniere_tentative: null, ...x });
  const choisis = selectionnerAppels(
    [
      ligne({}),
      ligne({ externe_id: "demo-2", derniere_tentative: "2026-11-09T09:59:30Z" }),
      ligne({ externe_id: "demo-3", derniere_tentative: "2026-11-09T09:58:00Z", tentatives: 3 }),
      ligne({ externe_id: "demo-4", tentatives: MAX_TENTATIVES }),
      ligne({ externe_id: "pas valable !" }),
      ligne({ workspace_id: null }),
      "n'importe quoi",
    ],
    MAINTENANT,
  );
  assert.deepEqual(choisis.map((a) => a.externeId), ["demo-1", "demo-3"]);
  const beaucoup = Array.from({ length: 30 }, (_, i) => ligne({ externe_id: `demo-${i}` }));
  assert.equal(selectionnerAppels(beaucoup, MAINTENANT).length, LOT_TRAITEMENT);
});

test("reprendre un appel : une tentative comptée par la base, l'URL par l'API, l'audio déposé, puis la transcription", async () => {
  const base = fausseBase({ maintenant: () => MAINTENANT });
  base.ajouter("onoff", "demo-1");
  const { f, vus } = fauxFetch([
    ["/recording", () => reponseJson({ url: URL_AUDIO })],
    ["stockage.example.org", () => reponseAudio(16, "video/mp4")],
    ["/logs", () => reponseJson({ callTranscription: { summarization: "Rappel jeudi.", diarization: [] } })],
    ...routesStockage(),
  ]);
  const x = dependances({ base, fetchImpl: f, env: ENV, debut: MAINTENANT });
  const codes = await recupererAppel("onoff", { externeId: "demo-1", workspaceId: WS, tentatives: 0, derniereTentative: null }, recuperateurOnoff, x.d);
  assert.deepEqual(codes, ["audio_garde", "transcription_gardee"]);
  const etats = base.rpcs.filter((r) => r.fonction === "etat_recuperation_appel").map((r) => r.args.p_compter);
  assert.deepEqual(etats, [false, true], "l'état, puis une tentative comptée");
  assert.equal(base.appels.get("onoff:demo-1").tentatives, 1);
  assert.equal(x.depots[0].chemin, `${WS}/onoff/demo-1.mp4`);
  assert.ok(vus.some((v) => v.url.endsWith("/api/v1/calls/demo-1/recording")));
});

test("reprendre un appel : rien si la base ne le dit pas conservable, s'il est complet, au plafond, ou tenté il y a moins d'une minute", async () => {
  const { f, vus } = fauxFetch([]);
  const cas = [
    [fausseBase({ conserver: false }), {}, ["audio_ignore"]],
    [fausseBase(), { chemin: `${WS}/onoff/demo-1.mp4`, resume: "Déjà là." }, ["deja_complet"]],
    [fausseBase(), { tentatives: MAX_TENTATIVES }, ["trop_de_tentatives"]],
    [fausseBase(), { derniere: "2026-11-09T09:59:30Z" }, ["trop_tot"]],
  ];
  for (const [base, champs, attendu] of cas) {
    base.ajouter("onoff", "demo-1", champs);
    const x = dependances({ base, fetchImpl: f, env: ENV, debut: MAINTENANT });
    assert.deepEqual(await recupererAppel("onoff", { externeId: "demo-1", workspaceId: WS, tentatives: 0, derniereTentative: null }, recuperateurOnoff, x.d), attendu);
    assert.ok(!base.rpcs.some((r) => r.args.p_compter === true), "aucune tentative comptée");
  }
  const inconnu = fausseBase();
  const x = dependances({ base: inconnu, fetchImpl: f, env: ENV });
  assert.deepEqual(await recupererAppel("onoff", { externeId: "demo-9", workspaceId: WS, tentatives: 0, derniereTentative: null }, recuperateurOnoff, x.d), ["appel_inconnu"]);
  assert.equal(vus.length, 0, "aucun appel à l'API");
});

test("un passage : une pause entre deux appels, des compteurs sans identifiant, l'audio pas encore prêt est compté", async () => {
  const base = fausseBase({ maintenant: () => MAINTENANT });
  for (const id of ["demo-1", "demo-2", "demo-3"]) base.ajouter("onoff", id);
  const { f } = fauxFetch([
    [/demo-1\/recording$/, () => reponseJson({ url: URL_AUDIO })],
    [/demo-[23]\/recording$/, () => reponseJson({ error: "not_found" }, 404)],
    ["stockage.example.org", () => reponseAudio(16, "video/mp4")],
    ["/logs", () => reponseJson({}, 404)],
    ...routesStockage(),
  ]);
  const x = dependances({ base, fetchImpl: f, env: ENV, debut: MAINTENANT });
  const lignes = ["demo-1", "demo-2", "demo-3"].map((id) => ({ externe_id: id, workspace_id: WS, tentatives: 0, derniere_tentative: null }));
  const bilan = await recupererEnAttente("onoff", recuperateurOnoff, lignes, x.d);
  assert.equal(bilan.examines, 3);
  assert.equal(bilan.audios, 1);
  assert.deepEqual(bilan.codes, { audio_garde: 1, enregistrement_pas_pret: 2, transcription_pas_prete: 3 });
  assert.deepEqual(x.attentes, [PAUSE_ENTRE_APPELS_MS, PAUSE_ENTRE_APPELS_MS]);
  journalPropre(assert, x.journal, ["demo-1", "demo-2", WS, "cle-api-onoff-de-test"]);
});

test("un passage s'arrête quand son budget est dépassé (la reprise suivante fera le reste)", async () => {
  const base = fausseBase({ maintenant: () => MAINTENANT });
  for (const id of ["demo-1", "demo-2"]) base.ajouter("onoff", id);
  const x = dependances({ base, fetchImpl: fauxFetch([]).f, env: ENV, debut: MAINTENANT });
  const lent = { ...recuperateurOnoff, urlEnregistrement: async () => (x.avancer(BUDGET_PASSAGE_MS + 1), { code: "enregistrement_pas_pret" }), transcription: undefined };
  const lignes = ["demo-1", "demo-2"].map((id) => ({ externe_id: id, workspace_id: WS, tentatives: 0, derniere_tentative: null }));
  const bilan = await recupererEnAttente("onoff", lent, lignes, x.d);
  assert.equal(bilan.examines, 1);
});
