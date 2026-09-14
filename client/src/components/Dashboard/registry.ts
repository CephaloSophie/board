import type { WidgetType } from '../../api/dashboards';

export interface WidgetMeta {
  label: string;
  icon: string;
  description: string;
  size: [number, number];
  min: [number, number];
  usesTasks: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultConfig: Record<string, any>;
}

export const WIDGETS: Record<WidgetType, WidgetMeta> = {
  kpi: { label: 'Indicateur', icon: '🔢', description: 'Un chiffre clé : nombre de tâches, points, heures ou bugs ouverts.', size: [3, 2], min: [2, 2], usesTasks: true, defaultConfig: { metric: 'count', suffix: '' } },
  breakdown: {
    label: 'Répartition',
    icon: '📊',
    description: 'Tâches ou points par statut, avancement, assigné, sprint, étiquette… en barres, donut ou tableau.',
    size: [4, 4],
    min: [3, 3],
    usesTasks: true,
    defaultConfig: { groupBy: 'status', splitBy: null, metric: 'count', chart: 'bar', topN: 12 },
  },
  matrix: {
    label: 'Tableau croisé',
    icon: '🧮',
    description: 'Deux dimensions croisées (ex. assigné × avancement), avec intensité de couleur.',
    size: [6, 4],
    min: [4, 3],
    usesTasks: true,
    defaultConfig: { rows: 'assignee', cols: 'statusCategory', metric: 'count' },
  },
  sprintBurndown: {
    label: 'Burndown / burnup',
    icon: '📉',
    description: "Reste à faire jour par jour, ligne idéale et évolution du périmètre, reconstruits depuis l'historique.",
    size: [6, 4],
    min: [4, 3],
    usesTasks: false,
    defaultConfig: { sprint: '@current', unit: 'points', mode: 'burndown', showIdeal: true },
  },
  velocity: { label: 'Vélocité', icon: '🚀', description: 'Engagé vs livré sur les derniers sprints terminés, avec la moyenne.', size: [6, 4], min: [4, 3], usesTasks: false, defaultConfig: { last: 6, unit: 'points' } },
  workload: { label: 'Charge par assigné', icon: '👥', description: 'Points ou tâches par personne, empilés par avancement, avec capacité.', size: [4, 4], min: [3, 3], usesTasks: true, defaultConfig: { metric: 'points', capacityPerUser: null, includeUnassigned: true } },
  taskList: { label: 'Liste de tâches', icon: '📋', description: "Les tâches d'un filtre, triées ; clic pour ouvrir la tâche.", size: [6, 5], min: [4, 3], usesTasks: true, defaultConfig: { sort: 'updatedAt:desc', limit: 20 } },
  recentActivity: { label: 'Activité récente', icon: '🕒', description: 'Derniers changements (statut, assignation, sprint…) des tâches filtrées.', size: [4, 5], min: [3, 3], usesTasks: true, defaultConfig: { limit: 20 } },
  sprintSummary: { label: 'Résumé de sprint', icon: '🎯', description: 'Objectif, dates, jours restants, progression et rituels du sprint.', size: [4, 3], min: [3, 2], usesTasks: false, defaultConfig: { sprint: '@current' } },
  note: { label: 'Note', icon: '📝', description: "Texte libre : consignes, liens, définition of done…", size: [4, 2], min: [2, 1], usesTasks: false, defaultConfig: { text: '' } },
};

export const DIMENSION_LABELS: Record<string, string> = {
  status: 'Statut',
  statusCategory: 'Avancement',
  priority: 'Priorité',
  type: 'Type',
  category: 'Catégorie',
  techno: 'Techno',
  area: 'Domaine',
  version: 'Version',
  sprint: 'Sprint',
  assignee: 'Assigné',
  reporter: 'Rapporteur',
  labels: 'Étiquettes',
};

export const METRIC_LABELS: Record<string, string> = { count: 'Nombre de tâches', points: 'Points', hours: 'Heures', openBugs: 'Bugs ouverts' };

export const TEMPLATE_META: Record<string, { label: string; icon: string; description: string }> = {
  sprint: { label: 'Sprint en cours', icon: '🎯', description: 'Résumé, burndown, charge, avancement et bloquants du sprint courant.' },
  po: { label: 'Product Owner', icon: '📈', description: 'Indicateurs, vélocité, avancement des versions, types et activité.' },
  dev: { label: 'Développeur', icon: '🧑‍💻', description: 'Mes tâches ouvertes, mes points, le sprint et mon activité.' },
  blank: { label: 'Vide', icon: '⬜', description: 'Partir de zéro et composer ses widgets.' },
};
