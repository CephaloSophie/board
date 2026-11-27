# Fonctionnalités de Kýdos Board

État au 24/11/2026 (Lot 1 + planification, traçabilité, collaboration et BOARD-001 : sous-tâches, recette, merge requests). Specs de référence : `docs/product/PM_ANALYSIS.md` (chef de
projet) et `docs/product/SCRUM_JIRA_IMPORT_SPEC.md` (Scrum Master / import Jira).

## 1. Board et tâches

- **3 vues** : Board (mini-boards par groupe), Jira (kanban par statut), Liste (tableau triable).
- **Regroupement** par sprint, version, catégorie, techno, domaine, type, priorité, statut, assigné,
  **tâche parente (module / package / epic)** ou aucun ; barre latérale des groupes, statistiques par groupe (points à faire / en cours /
  terminés selon la **catégorie** du statut).
- **Glisser-déposer** (historisé, membres et administrateurs) : **toutes les colonnes du workflow**
  sont affichées, même vides (option « Tous les statuts »), et une carte peut être déposée dans un
  **autre groupe** : le champ regroupé change avec le statut (sprint, version, assigné, priorité,
  type, catégorie…). Option « Groupes vides » : sprints à venir, versions non publiées, membres et
  backlog restent visibles comme cibles (repliés en zone de dépôt, dépliables).
- **Hauteur de ligne constante** : chaque groupe (sprint, version…) a la même hauteur (Compacte,
  Normale, Grande, Très grande ou Auto) et **chaque colonne de statut défile séparément** ; le bord
  inférieur d'une ligne se glisse pour ajuster la hauteur de toutes les lignes (double-clic : valeur
  par défaut). Préférence mémorisée dans le navigateur. **Défilement enchaîné** : la molette fait
  défiler la colonne survolée tant qu'elle a de la marge, puis, arrivée en haut / en bas (ou si la
  colonne ne défile pas), continue sur le board : on passe d'un sprint / d'une version à l'autre sans
  sortir le curseur des colonnes (défilement horizontal, Maj+molette et zoom inchangés).
- **Cartes** : tâche parente (`↥ KB-12`), avancement des sous-tâches (`⊟ 2/5`), critères validés
  (`☑ 3/7`), merge request (état le plus avancé).
- **Tâche** : titre, description, instructions, critères d'acceptation, statut, priorité, type,
  catégorie, techno, domaine, version, sprint, **étiquettes**, **tâche parente**, **échéance**,
  points, estimation, durée réelle, assigné, rapporteur, commentaires, historique complet.
- **Texte riche** (description et commentaires) : gras, italique, souligné, barré, surligné,
  couleurs, titres, listes, cases à cocher, citations, code, tableaux, liens, **images** (bouton,
  copier-coller ou glisser), `@mentions` avec auto-complétion, clés de tâche liées (`KB-12`),
  aperçu. Rendu sûr (aucun HTML brut).
- **Sous-tâches** (module, package, story → tâches livrables) : tâche parente choisie par recherche
  (clé ou titre), hiérarchie validée (parent existant, pas de boucle, 12 niveaux max), fil d'Ariane des
  ancêtres, avancement consolidé (tâches et points), création rapide d'une sous-tâche qui hérite du
  sprint / version / catégorie / techno / domaine / priorité du parent, rattachement d'une tâche
  existante, détachement ; la suppression d'un parent détache ses sous-tâches. Chaque lien est tracé
  dans l'historique **des deux tâches** et notifié aux responsables du parent.
- **Critères d'acceptation (recette)** : liste ordonnée par priorité (**glisser-déposer** ou ↑ / ↓),
  texte riche (listes, liens, images), **case à cocher qui barre le cas validé** (qui / quand),
  modification en place (double-clic), filtres Tous / À valider / Validés, barre d'avancement,
  **discussion par critère** (commentaires avec images, liens et `@mentions`). **Coller une liste**
  (Word, Google Docs, Jira, e-mail) la découpe en cas séparés : puces, numéros, `AC1:`, cases
  `[ ]` / `[x]` / ✓, scénarios Gherkin (Scénario / Étant donné / Quand / Alors), paragraphes, ou
  **expression régulière** libre (préréglages : point-virgule, fin de phrase, numéros…), avec aperçu
  modifiable avant ajout. Notification quand tous les critères sont validés.
- **Merge requests** : le développeur colle le lien (GitLab, GitHub, Bitbucket, Azure DevOps,
  Gitea) ; dépôt et numéro reconnus, titre optionnel, état brouillon / ouverte / fusionnée / fermée,
  plusieurs MR par tâche, recherche par URL ; ajout et fusion notifiés, tout est historisé.
- **Popup de création** : éditeur riche (comme les commentaires), **modèles** (User story, Bug,
  Technique, Module / package — avec critères de départ), critères d'acceptation, merge requests,
  tâche parente, **brouillon enregistré automatiquement** (restauré à la réouverture), « Créer et en
  ajouter une autre » (garde sprint, version, parent), Ctrl+Entrée, Échap.
- **Collage stylé** dans tous les éditeurs : le HTML copié depuis Word, Google Docs, Confluence ou
  une page web devient du Markdown (titres, gras, italique, souligné, barré, listes imbriquées, cases
  à cocher, liens, images distantes, tableaux, code, citations) ; Ctrl+Maj+V colle le texte brut.
- Dates dérivées : `resolvedAt` (entrée dans un statut « terminé »), `statusChangedAt`.
- Popup ou page dédiée `/projects/:key/tasks/:taskId`, décalage sprint précédent / suivant, copie du
  lien, navigation parent / sous-tâche dans la popup (avec retour), Échap pour fermer.
- Tâches importées : clé Jira d'origine (lien), assigné d'origine conservé si non rapproché,
  commentaires signés « Jira ».

## 2. Filtres et filtres enregistrés

- Barre compacte : recherche + une liste déroulante multi-sélection par dimension (avec recherche
  interne), **Avancement** (à faire / en cours / terminé) et **Étiquettes**.
- **Valeurs dynamiques** : `Moi`, `Sprint courant`, `Sprints non terminés`, `Backlog (sans sprint)`,
  `Version courante`, `Versions non publiées` — résolues côté serveur à chaque requête.
- **Plage de groupes** (ligne sous les filtres, dès qu'un regroupement est actif) : pour un
  regroupement **ordonné** — **Sprint** (cycle de vie terminé → actif → prêt → brouillon, puis date de
  début), **Version** (numéro sémantique, `10.2.0` < `10.10.0`, les clés non numériques après, par
  date), **Priorité** et **Statut** (ordre de la taxonomie) — on choisit une **référence** (« Sprint
  actuel » / « Version actuelle », dynamique comme `@current`, ou une valeur précise) et un mode :
  « Tous les groupes » (défaut, comportement historique), « Référence et suivants », « Référence et
  précédents » ou « Autour de la référence ». **Max. précédents / Max. suivants** limitent le nombre
  de groupes de part et d'autre (vide = illimité ; ex. sprint actuel + 2 suivants). La plage se
  calcule sur toutes les valeurs de la dimension (y compris archivées), indépendamment des filtres.
  **Sauf statuts** : un groupe hors plage reste affiché s'il contient des tâches dans les statuts
  choisis, **avec uniquement ces tâches** (le « reste à faire » des anciens sprints), « dans les
  groupes » **précédents** (défaut), **suivants** ou **les deux** — par défaut les sprints à venir
  limités par « Max. suivants » ne réapparaissent donc pas à cause de leurs tâches à faire ; en pointillés
  avec un badge **« hors plage »** (nombre de tâches masquées en info-bulle, `↺` dans la barre
  latérale). Les valeurs inconnues de la taxonomie sont considérées hors plage. La case « Backlog
  (sans sprint) » / « Sans version » / « Non assigné »… masque ou affiche le groupe des tâches sans
  valeur (visible par défaut, aussi pour les regroupements non ordonnés). Pour une dimension sans
  ordre naturel (catégorie, techno, domaine, type, assigné, tâche parente), la plage est
  indisponible (message d'aide). Résumé : groupes masqués, tâches hors vue, groupes hors plage
  conservés ; référence introuvable → plage ignorée avec avertissement. S'applique aux vues Board,
  Jira et Liste ; changer de regroupement ramène la référence sur « actuel ».
- **Tout l'état du board est dans l'URL** (vue, regroupement, tri, filtres, recherche, plage de
  groupes : `range`, `rangeRef`, `rangeBefore`, `rangeAfter`, `rangeKeep`, `rangeKeepSide`, `rangeNone`) : chaque vue
  se partage par lien.
- **Filtres enregistrés** : privés ou partagés, favoris (raccourcis dans la barre), un filtre
  **par défaut** par utilisateur et par projet (appliqué à l'ouverture du board), indicateur
  « modifié », enregistrer / enregistrer sous / renommer / supprimer / dupliquer (API). La **plage de
  groupes** est enregistrée avec le filtre (`groupRange`) et restaurée à son application ; le
  remplacement d'une valeur de taxonomie met à jour la référence et les statuts d'exception.
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
- **Discussions enrichies** : **épingler** un commentaire (affiché en tête), **résoudre / rouvrir** une
  discussion (repliée sur une ligne une fois résolue), **citer** un commentaire, **lien direct** vers un
  commentaire, filtres Tous / Épinglés / Non résolus / Me concernant, ordre chronologique ou inverse
  (mémorisé), longues discussions repliées, **brouillon conservé** par tâche.
- **Notifications** (cloche dans l'en-tête) : mention, assignation, commentaire sur une tâche dont on
  est assigné ou rapporteur, réponse, réaction, changement de statut, tous les critères validés,
  merge request liée ou fusionnée, nouvelle sous-tâche. Jamais pour ses propres
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
| Critères d'acceptation | champ texte libre | liste priorisée, cochable, commentable, découpage automatique d'un collage |
| Sous-tâches | 1 niveau (sous-tâche) + epics | hiérarchie libre validée, avancement consolidé, board par module / package |
| Lien merge request | intégration dev (applications Git) | lien collé, forge reconnue, état et historique, sans configuration |
| Discussions | commentaires à plat | épinglage, résolution, citations, filtres, brouillons |
| Board à colonnes défilantes | hauteur libre | hauteur de ligne constante, défilement par statut enchaîné avec le board |
| Fenêtre de sprints / versions | filtre JQL manuel | sprint actuel ± N, reste à faire des anciens sprints conservé |

## 12. Limites connues et prochain lot

- Burndown des sprints passés approximatif quand l'historique importé ne contient pas les
  transitions (CSV) : avertissement affiché.
- Pas encore : transitions de workflow imposées et limites WIP, classement manuel du backlog,
  notifications en temps réel / e-mail (volontairement chargées au démarrage), pièces jointes non
  image, worklogs, synchronisation Jira par API, langage de requête textuel (JQL-like), import du
  bundle `kydos-project/1`.
