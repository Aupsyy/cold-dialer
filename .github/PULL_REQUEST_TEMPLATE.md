## Ce qui change et pourquoi

Deux phrases, et l'issue liée (`#…`) pour tout changement de fond.

## Vérifications

- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` et `npm run build` sont verts.
- [ ] Si la base change : `npm run test:sql` et `npm run test:base` sont verts sur une base locale ; une nouvelle table a sa RLS et
      son test SQL (`begin;` … `rollback;`).
- [ ] Aucune donnée réelle, aucun secret (des noms de variables seulement), aucune promesse de résultat.
- [ ] Le contrôle de publication (`npm run test:publication`) est vert et n'a pas été modifié.
- [ ] La documentation suit si un comportement change (`docs/`, `README.md`, `.env.example`, `config/niche.exemple.json`).
