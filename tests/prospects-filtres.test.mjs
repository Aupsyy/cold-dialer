// Les filtres de la liste des prospects (lib/poste/filtres.ts), lus depuis l'adresse : une valeur inconnue est ignorée, jamais d'erreur.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILTRES_VIDES, adresseListe, bornesPage, filtresActifs, lireFiltresProspects, motifContient, nombrePages } from "../lib/poste/filtres.ts";

test("filtres lus et vérifiés", () => {
  assert.deepEqual(
    lireFiltresProspects({
      q: "  Atelier   Démo ",
      statut: "a_rappeler",
      tier: "B",
      ville: "Lyon",
      departement: "2a",
      email: "1",
      accroche: "oui",
      mes: "1",
      rappels: "dus",
      page: "3",
    }),
    {
      recherche: "Atelier Démo",
      statut: "a_rappeler",
      tier: "B",
      ville: "Lyon",
      departement: "2A",
      avecEmail: true,
      avecAccroche: true,
      mesLeads: true,
      rappels: "dus",
      tri: "rappel",
      page: 3,
    },
  );
});

test("valeurs inconnues ignorées, page bornée", () => {
  const f = lireFiltresProspects({ statut: "supprime", tier: "Z", departement: "999x", rappels: "hier", tri: "chaos", page: "-2", email: "peut-être" });
  assert.deepEqual(f, FILTRES_VIDES);
  assert.equal(lireFiltresProspects({ page: "1e9" }).page, 2000);
  assert.equal(lireFiltresProspects({ page: "2.5" }).page, 1);
  assert.equal(lireFiltresProspects({ statut: ["a_appeler", "clos"] }).statut, "a_appeler");
  assert.equal(lireFiltresProspects({ tier: "aucun" }).tier, "aucun");
  assert.equal(lireFiltresProspects({ q: "x".repeat(200) }).recherche.length, 80);
});

test("l'adresse d'une page garde les filtres, sans les valeurs par défaut", () => {
  const f = lireFiltresProspects({ statut: "a_appeler", mes: "1" });
  assert.equal(adresseListe(f), "/prospects?statut=a_appeler&mes=1");
  assert.equal(adresseListe(f, { page: 2 }), "/prospects?statut=a_appeler&mes=1&page=2");
  assert.equal(adresseListe(FILTRES_VIDES), "/prospects");
  assert.equal(adresseListe({ ...FILTRES_VIDES, tri: "nom", recherche: "a&b" }), "/prospects?q=a%26b&tri=nom");
  assert.equal(filtresActifs(f), 2);
  assert.equal(filtresActifs(FILTRES_VIDES), 0);
});

test("motif ILIKE : les jokers saisis sont échappés, l'étoile retirée", () => {
  assert.equal(motifContient("Démo"), "%Démo%");
  assert.equal(motifContient("100%_net"), "%100\\%\\_net%");
  assert.equal(motifContient("a\\b"), "%a\\\\b%");
  assert.equal(motifContient("a*b"), "%ab%");
});

test("pagination : 50 par page", () => {
  assert.deepEqual(bornesPage(1), { de: 0, a: 49 });
  assert.deepEqual(bornesPage(3), { de: 100, a: 149 });
  assert.deepEqual(bornesPage(0), { de: 0, a: 49 });
  assert.equal(nombrePages(0), 1);
  assert.equal(nombrePages(50), 1);
  assert.equal(nombrePages(51), 2);
});
