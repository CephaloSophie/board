# Kýdos Board — guide pour Claude Code

Application de gestion de projet agile façon Jira (SPA React + API Express/MongoDB) dont l'objectif
produit est d'**offrir plus que Jira** (import Jira, dashboards flexibles, filtres enregistrés,
admin projet complète, rituels agiles). Langue du produit et des échanges avec le propriétaire :
**français**. Code, identifiants et commentaires : anglais.

## Carte du dépôt

| Chemin | Rôle |
|---|---|
| `server/` | API Express 4 + Mongoose 8 (CommonJS). Voir `server/CLAUDE.md`. |
| `client/` | SPA React 18 + TS + Vite + react-query. Voir `client/CLAUDE.md`. |
| `docs/FEATURES.md` | Catalogue fonctionnel à jour (à maintenir à chaque fonctionnalité). |
| `docs/API.md` | Référence des routes, droits et codes d'erreur. |
| `docs/ARCHITECTURE.md` | Modèle de données et mécanismes transverses. |
| `docs/product/` | Specs : `PM_ANALYSIS.md` (roadmap, Lot 1/2/3, critères d'acceptation), `SCRUM_JIRA_IMPORT_SPEC.md` (formats Jira, mapping, Scrum). |
| `tasks.json` | Données d'origine du projet « Kýdos Belote » importées par le seed — pas le backlog de ce board. |

## Commandes

```bash
cd server && npm test                 # node:test sur base *_test (≈45 tests, ~20 s)
cd server && npm run migrate -- --dry-run   # puis npm run migrate (idempotent)
cd client && npx tsc -b && npm run build
```

## Règles importantes

- **Base réelle en local** : l'API :7002 du poste de dev utilise une base MongoDB avec les vraies
  données du projet KB. Jamais de seed `--overwrite`, de migration non demandée ni de test contre
  elle. Les tests utilisent `MONGODB_URI_TEST` et refusent une base sans `test` dans le nom. Pour
  tester l'interface, lancer une pile séparée (API sur un autre port + `VITE_API_PROXY_TARGET`).
- `node --watch` peut servir du code périmé après l'ajout de fichiers / de routes : redémarrer le
  processus (ne pas se fier au seul `/api/health`, vérifier la route concernée).
- Vérifier systématiquement : `npm test` (server) puis `npx tsc -b` (client).
- Pas de nouvelle dépendance lourde : graphiques SVG, CSV, grille de dashboard sont maison.
- Messages d'erreur API et libellés UI en français ; erreurs métier avec un `code` machine.
- Ne pas commiter sans demande explicite.

## Concepts métier clés

- **Projet** (`KB`) → tâches `KB-001` ; rôles projet `admin | member | viewer` (super admin et
  responsable = admin) ; accès `open | members` ; projet archivé = lecture seule (423).
- **Taxonomy** : collection unique des dimensions (`status, priority, type, category, techno, area,
  version, sprint, eventType`), référencées par **clé**. Statuts avec **catégorie**
  `todo | inprogress | done` (source de vérité de « terminé »).
- **Task** : modifications des champs suivis via `applyPatchWithHistory` (historique utilisé par
  burndowns / vélocité) ; `labels`, `parent`, `resolvedAt`, `external` (import Jira).
- **Sprint** : cycle draft → ready → active → finished géré uniquement par `/sprints` (un seul actif,
  instantané au démarrage, rapport à la clôture, rétrospective auto).
- **Filtres** : grammaire unique `compileTaskQuery` (jetons `@me`, `@current`, `@open`, `@none`,
  `@unreleased`, dates relatives) partagée par le board, les filtres enregistrés, les dashboards et l'export.
- **Dashboard** : widgets validés côté serveur (`dashboards/widgets.js`), données via `/analytics`.
- **Import Jira** : `import/jira/*` — plan complet en dry-run, écriture, idempotence, rollback.
- **Journal & notifications** : toute écriture métier passe par `logActivity` (`Activity`) et, si
  quelqu'un doit être prévenu, `notify` (`Notification`). Le client charge les notifications une seule
  fois au démarrage (pas de WebSocket / polling, choix du propriétaire).
- **Texte riche** : Markdown restreint (`RichText` / `RichTextEditor`), jamais de HTML brut ; images
  via `/attachments` → `/api/files/:publicId`.

## Prochaines étapes identifiées (Lot 2)

Transitions de workflow et WIP, classement manuel du backlog, widgets aging / CFD / créées vs
résolues, import du bundle `kydos-project/1`, pièces jointes non image. Voir `docs/FEATURES.md` §12.
