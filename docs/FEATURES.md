# Fonctionnalités de Kýdos Board

État au 15/09/2026 (Lot 1 + planification, traçabilité et collaboration). Specs de référence : `docs/product/PM_ANALYSIS.md` (chef de
projet) et `docs/product/SCRUM_JIRA_IMPORT_SPEC.md` (Scrum Master / import Jira).

## 1. Board et tâches

- **3 vues** : Board (mini-boards par groupe), Jira (kanban par statut), Liste (tableau triable).
- **Regroupement** par sprint, version, catégorie, techno, domaine, type, priorité, statut, assigné
  ou aucun ; barre latérale des groupes, statistiques par groupe (points à faire / en cours /
  terminés selon la **catégorie** du statut).
- **Glisser-déposer** (historisé, membres et administrateurs) : **toutes les colonnes du workflow**
  sont affichées, même vides (option « Tous les statuts »), et une carte peut être déposée dans un
  **autre groupe** : le champ regroupé change avec le statut (sprint, version, assigné, priorité,
  type, catégorie…). Option « Groupes vides » : sprints à venir, versions non publiées, membres et
  backlog restent visibles comme cibles (repliés en zone de dépôt, dépliables).
- **Tâche** : titre, description, instructions, critères d'acceptation, statut, priorité, type,
  catégorie, techno, domaine, version, sprint, **étiquettes**, **tâche parente**, **échéance**,
  points, estimation, durée réelle, assigné, rapporteur, commentaires, historique complet.
- **Texte riche** (description et commentaires) : gras, italique, souligné, barré, surligné,
  couleurs, titres, listes, cases à cocher, citations, code, tableaux, liens, **images** (bouton,
  copier-coller ou glisser), `@mentions` avec auto-complétion, clés de tâche liées (`KB-12`),
  aperçu. Rendu sûr (aucun HTML brut).
- Dates dérivées : `resolvedAt` (entrée dans un statut « terminé »), `statusChangedAt`.
- Popup ou page dédiée `/projects/:key/tasks/:taskId`, décalage sprint précédent / suivant.
- Tâches importées : clé Jira d'origine (lien), assigné d'origine conservé si non rapproché,
  commentaires signés « Jira ».

## 2. Filtres et filtres enregistrés

- Barre compacte : recherche + une liste déroulante multi-sélection par dimension (avec recherche
  interne), **Avancement** (à faire / en cours / terminé) et **Étiquettes**.
- **Valeurs dynamiques** : `Moi`, `Sprint courant`, `Sprints non terminés`, `Backlog (sans sprint)`,
  `Version courante`, `Versions non publiées` — résolues côté serveur à chaque requête.
- **Tout l'état du board est dans l'URL** (vue, regroupement, tri, filtres, recherche) : chaque vue
  se partage par lien.
- **Filtres enregistrés** : privés ou partagés, favoris (raccourcis dans la barre), un filtre
  **par défaut** par utilisateur et par projet (appliqué à l'ouverture du board), indicateur
  « modifié », enregistrer / enregistrer sous / renommer / supprimer / dupliquer (API).
- Un filtre enregistré sert aussi de source aux widgets de dashboard et à l'export CSV.

## 3. Dashboards

- Plusieurs dashboards par projet, **privés ou partagés**, favoris, dashboard par défaut, duplication.
- **Modèles** : Sprint en cours, Product Owner, Développeur, Vide.
- **Grille 12 colonnes** : déplacer (glisser l'en-tête), redimensionner (coin ◢), collisions et
  tassement automatiques, affichage en une colonne sur mobile.
- **Filtre global** du dashboard, combiné (ET) avec la source de chaque widget : filtre global,
  filtre enregistré ou critères personnalisés.
- **Widgets** : Indicateur, Répartition (barres, barres horizontales, donut, tableau, empilement par
  une 2e dimension), Tableau croisé, Burndown / burnup, Vélocité, Charge par assigné (avec
  capacité), Liste de tâches, Activité récente, Résumé de sprint (avec rituels), Note.
- Lien « ↗ » depuis chaque widget vers le board filtré à l'identique.
- **Burndown reconstruit depuis l'historique** des tâches (ajouts / retraits en cours de sprint,
  ré-estimations), ligne idéale, avertissement si l'historique importé est incomplet.
- Concurrence optimiste : un enregistrement sur une version périmée propose recharger ou copier.
- Graphiques SVG maison, aucune dépendance ajoutée.

## 4. Sprints et versions

- Cycle de vie : **brouillon → prêt → actif → terminé** (réouverture possible), un seul sprint actif.
- **Démarrer** : dates, objectif, instantané de l'engagement (points et tâches).
- **Clôturer** : aperçu terminé / non terminé, choix des tâches à garder, **report** vers un sprint
  existant, un nouveau sprint ou le backlog (historisé), démarrage immédiat du sprint suivant,
  **rétrospective pré-remplie** (rituel avec tâches reportées et participants), rapport figé
  (engagé, livré, reporté) qui alimente la vélocité.
- Création enchaînée selon la cadence du projet.
- **Versions** : dates de début / sortie, publication (déplacement des tâches ouvertes vers une
  autre version, nouvelle version courante), dépublication, avancement par version.

## 5. Planification et traçabilité (`/projects/:key/planning`, `/projects/:key/activity`)

- **Cockpit** : sprint courant (choix du sprint courant sans le démarrer, démarrer / clôturer sur
  place, avancement, J-x, engagement), version courante (changement, avancement, sortie prévue),
  sprint précédent (engagé / livré / reporté).
- **Reste à faire du sprint précédent** : tâches restées dans le sprint clôturé et tâches reportées
  encore ouvertes (avec leur emplacement actuel) ; décalage de la sélection ou de tout vers un sprint.
- **Tableau de planification** par sprint ou par version : backlog + sprints actif / prêts /
  brouillons (option terminés), glisser-déposer d'une tâche ou de toute la sélection, barre d'actions
  groupées (sprint, version, assigné, statut), recherche, filtre assigné, masquage des terminées.
- **Journal d'activité** du projet : chaque action (création, statut, réassignation, décalage de
  sprint ou de version, points, estimation, contenu, commentaires, réactions, cycle de vie des
  sprints et versions, sprint / version courants, imports et annulations) avec auteur et date ;
  filtres par membre, type, modification, sprint, version, période, tâche et texte ; partage par
  URL ; raccourcis « Aujourd'hui », « 7 derniers jours », « Mes actions », « Décalages ».
- **Historique de la tâche** : chronologie par jour, filtrable (statut, assignation, sprint &
  version, points & temps, contenu, commentaires), avec les noms des personnes.

## 6. Collaboration et notifications

- **Commentaires en fil** (un niveau de réponses), modification / suppression (auteur ou admin),
  **réactions** emoji par utilisateur (👍 👎 ❤️ 🎉 😄 😕 🚀 👀 ✅ 🔥), mentions et images.
- **Notifications** (cloche dans l'en-tête) : mention, assignation, commentaire sur une tâche dont on
  est assigné ou rapporteur, réponse, réaction, changement de statut. Jamais pour ses propres
  actions ; une seule notification par personne et par action. Chargées **une fois au chargement
  de l'application** (pas de WebSocket ni de polling), bouton « Actualiser », marquer lu / tout lu,
  effacer les lues ; un clic ouvre la tâche sur le commentaire concerné.

## 7. Rituels

Refinement, grooming, point technique, point architecture (ADR), préparation de démo,
rétrospective ; types configurables (icône, sections), participants, tâches liées, ordre du jour,
décisions, actions ; ajout rapide d'une tâche à un rituel depuis une carte.

## 8. Import Jira et export

- **Formats** : CSV Jira « Tous les champs » / « Champs actuels » (Cloud et Data Center, en-têtes
  répétés, séparateurs `,` `;`, dates `14/Sep/26 9:05 AM`, mois français, ISO), **JSON de l'API**
  (recherche de tickets, ADF), **JSON des sprints** d'un board, **JSON des versions**, **JSON
  « import de systèmes externes »** (`projects[].issues[]` + `links`, converti à la volée ou hors
  ligne via `npm run jira:convert -- fichier.json`). XML refusé avec message explicite.
- **Champs personnalisés** : numériques → story points ; texte → **catégorie / techno** au choix
  (valeurs créées automatiquement avec couleur). Format externe : « Effort » S/M/L → 2/5/8 points,
  champs absents de la description et liens entre tickets ajoutés à la description, date de
  création déduite d'une étiquette `…-AAAA-MM-JJ`.
- **Assistant en 4 étapes** : fichiers et options → correspondances pré-remplies et modifiables
  (statuts, priorités, types, personnes, états / dates des sprints, champ des story points) →
  **simulation obligatoire** (créations, mises à jour, clés conservées / renumérotées, valeurs
  créées, avertissements par ligne) → import et rapport.
- Clés `KB-123` conservées si le préfixe correspond au projet et l'identifiant est libre, sinon
  renumérotation ; le compteur du projet est ajusté.
- Sprints : état et dates Jira (JSON) ou **déduits** (CSV) ; rapport de vélocité calculé pour les
  sprints clos importés ; sprint actif Jira → sprint courant (si aucun sprint actif).
- Epics / sous-tâches → tâche parente ; composants → domaine ; estimations en secondes → `1j 2h` ;
  commentaires avec dates et auteurs ; dates de création / mise à jour / résolution d'origine.
- **Ré-import idempotent** (clé Jira) : aucun doublon, tâches inchangées ignorées (les modifications
  locales sont conservées tant que Jira ne change pas la tâche), une valeur modifiée dans Jira
  produit une entrée d'historique ; mode « créer seulement ».
- **Historique des imports** et **annulation du dernier import** (tâches créées non modifiées
  supprimées, valeurs restaurées, valeurs de taxonomie créées supprimées ou archivées).
- **Export** : projet complet en JSON (`kydos-project/1`, sans secrets) et tâches en **CSV
  compatible Jira** (filtre enregistré optionnel, séparateur `;` pour Excel FR), réimportable.

## 9. Administration du projet (`/projects/:key/settings/:onglet`)

| Onglet | Contenu |
|---|---|
| Général | Identité, aperçu chiffré, version courante, cadence, fuseau, jours ouvrés, échelle d'estimation, statut / type / priorité par défaut |
| Sprints & versions | Cycle de vie complet (§4) |
| Membres & rôles | Accès ouvert ou restreint, ajout de membres, rôles Administrateur / Membre / Lecteur, retrait avec désassignation |
| Workflow | Aperçu du flux, ordre, couleurs, **catégorie** de chaque statut, archivage, **supprimer et réaffecter** |
| Taxonomies | Priorités, types (drapeau « bug »), catégories, technos, domaines, types d'événement ; ordre, archivage, supprimer et réaffecter |
| Import / Export | §6 |
| Zone dangereuse | Transfert de responsabilité, archivage (lecture seule), suppression définitive (super admin, projet archivé, clé à retaper) |

**Rôles projet** : super admin et responsable = administrateurs ; lecteur = lecture seule (y compris
commentaires) ; membre = création / modification ; seule l'administration supprime des tâches.
Projet archivé : bandeau et écritures refusées (423), filtres et dashboards personnels toujours
utilisables.

## 10. Administration globale

`/admin/users` (super admin) : création, modification (nom, e-mail, couleur, rôle global),
réinitialisation du mot de passe, désactivation / réactivation.

## 11. Kýdos vs Jira

| Besoin | Jira | Kýdos |
|---|---|---|
| Rituels agiles (refinement, rétro, ADR, démo) | apps tierces / Confluence | natifs, liés aux sprints et tâches |
| Rétrospective à la clôture de sprint | non | créée automatiquement, pré-remplie |
| Dimensions libres (techno, domaine…) | champs personnalisés + schémas | taxonomies par projet |
| Regroupement multi-boards avec stats | swimlanes limitées | toute dimension, stats par groupe |
| Import depuis Jira | — | simulation, correspondances, idempotence, annulation |
| Filtres dynamiques (`@me`, sprint courant) | JQL | sélection en un clic, partage par URL |
| Dashboard | gadgets à colonnes fixes | grille libre, filtre global, lien vers le board |
| Burndown | rapport figé | reconstruit depuis l'historique, burnup, périmètre |
| Reste à faire du sprint précédent | rapport de sprint séparé | panneau dédié, décalage en un clic |
| Journal d'activité projet filtrable | non (historique par ticket) | par membre, sprint, version, période, type |
| Glisser-déposer entre sprints / assignés sur le board | backlog uniquement | toute dimension de regroupement |

## 12. Limites connues et prochain lot

- Burndown des sprints passés approximatif quand l'historique importé ne contient pas les
  transitions (CSV) : avertissement affiché.
- Pas encore : transitions de workflow imposées et limites WIP, classement manuel du backlog,
  notifications en temps réel / e-mail (volontairement chargées au démarrage), pièces jointes non
  image, worklogs, synchronisation Jira par API, langage de requête textuel (JQL-like), import du
  bundle `kydos-project/1`.
