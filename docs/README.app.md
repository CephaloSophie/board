# Guide de l'application — Kýdos Board

Application de gestion de tâches façon Jira (single page app), sauvegarde
MongoDB. Ce document décrit **l'usage** de l'application, écran par écran.

## Connexion

- Écran de connexion : identifiant + mot de passe.
- Comptes créés par le seed :
  - `ameur` — super admin — mot de passe `@bloardKydos`
  - `hamido` — super admin — mot de passe `@bloardKydos`
- Le super admin crée ensuite les comptes développeurs (Administration → Utilisateurs).

## Navigation

Bandeau du haut (visible une fois dans un projet) :

- **Sélecteur de projet** — changer de projet.
- **Board** — le tableau des tâches.
- **Rituels** — l'espace des événements agiles.
- **Administration** — taxonomies, sprints, durée, utilisateurs, projet.
- **Thèmes** — Sombre (défaut), Claire, Ubuntu, Mac.
- **Compte** — nom, rôle, déconnexion.

## Le Board

Trois affichages, sélectionnables en haut à droite :

1. **Board** — mini-kanban par groupe (voir « Regrouper par »).
2. **Jira** — un kanban simple par statut.
3. **Liste** — tableau triable par colonne.

### Regrouper par

Un menu **« Regrouper par »** (Sprint par défaut) réorganise les 3 vues par
la dimension choisie : sprint, version, catégorie, techno, domaine, type,
priorité, statut ou assigné. Chaque groupe devient son **propre mini-board**
avec ses colonnes de statut. Une **barre latérale** liste les groupes (avec
compteurs et badge de statut pour les sprints) et met en avant le **sprint
courant** (★). Cliquer un groupe fait défiler jusqu'à lui.

### Statistiques par groupe

Chaque groupe affiche : nombre de tâches, points totaux, estimation en
heures, points **à faire / en cours / terminés**, et le nombre de tâches
**sans assigné** — utile pour le PO / scrum master.

### Filtres et recherche

- Filtres **multi-sélection** combinables sur chaque dimension (statut,
  priorité, type, catégorie, techno, version, sprint, domaine, assigné).
- Les longues listes (versions, sprints) défilent dans une zone de 300 px
  max avec un dégradé en haut/bas.
- **Recherche** libre : id, titre, mots-clés du contenu.

### Glisser-déposer

On déplace une carte d'une colonne de statut à une autre (par ex. *À faire →
Testée*). Le changement est enregistré et **journalisé** dans l'historique.

## Une tâche

Ouvrable en **popup** (clic sur la carte) ou sur une **page dédiée**
(`/projects/:clé/tasks/:id`). Mise en page façon Jira :

- **Colonne gauche (métadonnées)** : assigné (+ bouton « M'assigner »),
  sprint (avec boutons **← Précédent / Suivant →**), statut, priorité,
  version, type, catégorie, techno, domaine, points, estimation, durée,
  rapporteur.
- **Colonne droite** : description, instructions, critères d'acceptation
  (éditables), **commentaires**, **historique** complet des modifications.
- Bouton **⊕ Rituel** pour rattacher la tâche à un événement.

### Créer une tâche

Bouton **« + Nouvelle tâche »**. La nouvelle tâche est pré-remplie avec le
**sprint courant** et la **version courante** du projet.

## Rituels & événements

Espace dédié (menu **Rituels**) pour les cérémonies agiles :

- Types par défaut : **Refinement, Grooming, Point technique, Point
  architecture, Préparation démo, Rétrospective**.
- Chaque type n'affiche **que ses sections utiles** (ex. Point architecture →
  champs ADR ; Préparation démo → ordre de passage).
- Un événement est **rattachable à un sprint** (ou non), avec **participants**
  et **tâches liées**.
- Filtres par sprint et par type.
- Créer via **« + Nouvel événement »** (sélecteur visuel de type).

### Ajouter une tâche à un événement

Une icône **⊕** sur chaque carte de tâche (et le bouton dans le détail)
ouvre un popup : rattacher la tâche à un événement existant, ou en créer un
à la volée.

## Administration (super admin)

Menu **Administration**, colonne de gauche :

- **Taxonomies** — pour chaque dimension (statuts, priorités, types,
  catégories, technos, domaines, versions, sprints, types d'événement) :
  ajouter / modifier / **archiver** / supprimer. Un élément archivé reste lié
  à ses tâches mais disparaît des listes déroulantes. Les sprints ont statut
  + dates + objectif ; les types d'événement ont icône + sections.
- **Utilisateurs** — créer des comptes, changer les rôles, désactiver.
- **Projet** — nom, éditeur, version courante, **durée de sprint** (jours /
  semaines, défaut 1 semaine, n'affecte que les futurs sprints), **sprint
  courant**.

## Créer un nouveau projet

Depuis l'écran **Projets** (super admin) : bouton « + Nouveau projet ». Le
projet reçoit automatiquement un jeu de taxonomies par défaut, prêtes à être
adaptées.
