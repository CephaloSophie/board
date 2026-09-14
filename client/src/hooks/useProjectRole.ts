import { useProject } from '../api/projects';

// Effective role of the current user on a project (computed server-side).
export function useProjectRole(projectKey: string | undefined) {
  const { data: project, isLoading } = useProject(projectKey);
  const role = project?.myRole ?? null;
  return {
    project,
    isLoading,
    role,
    isAdmin: role === 'admin',
    canWrite: (role === 'admin' || role === 'member') && !project?.archived,
    isViewer: role === 'viewer',
    isArchived: !!project?.archived,
  };
}
