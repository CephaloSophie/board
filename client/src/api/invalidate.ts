import { useQueryClient } from '@tanstack/react-query';

// Everything derived from a project's tasks/taxonomies. Lifecycle actions
// (sprint start/close, release, imports…) touch many of them at once.
const PROJECT_SCOPED_KEYS = [
  'project',
  'project-stats',
  'project-overview',
  'tasks',
  'task',
  'taxonomies',
  'sprints',
  'versions',
  'members',
  'events',
  'filters',
  'analytics',
  'labels',
];

export function useInvalidateProject(projectKey: string | undefined) {
  const qc = useQueryClient();
  return () => {
    for (const key of PROJECT_SCOPED_KEYS) qc.invalidateQueries({ queryKey: [key, projectKey] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };
}
