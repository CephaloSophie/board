import { useMutation, useQuery } from '@tanstack/react-query';
import { get, post } from './client';
import { useInvalidateProject } from './invalidate';
import type { UserRef } from '../types';

export interface ImportFile {
  name: string;
  content: string;
}

export type MappingTarget = string | { create: { label?: string; key?: string; color?: string; category?: string; meta?: Record<string, unknown> } };

export interface ImportMapping {
  statuses: Record<string, MappingTarget>;
  priorities: Record<string, MappingTarget>;
  types: Record<string, MappingTarget>;
  people: Record<string, string | null>;
  sprints: Record<string, { state?: 'closed' | 'active' | 'future'; startDate?: string; endDate?: string; goal?: string }>;
  fields: { storyPoints: string | null; category?: string | null; techno?: string | null };
}

export interface ImportOptions {
  mode: 'upsert' | 'create';
  importComments: boolean;
  componentToArea: boolean;
  setCurrentSprint: boolean;
  extractAcceptance: boolean;
  hoursPerDay: number;
  timezone: string;
  site: string;
}

export interface ImportRow {
  row: number;
  externalKey: string | null;
  externalId: string | null;
  action: 'create' | 'update' | 'unchanged' | 'skip' | 'error';
  taskId: string | null;
  title?: string;
  errors: string[];
  warnings: string[];
}

export interface ImportCounts {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  warnings: number;
}

export interface ImportEntities {
  statuses: { name: string; category: 'todo' | 'inprogress' | 'done'; guessed: boolean; count: number; suggested: string | null; confidence: string }[];
  priorities: { name: string; count: number; suggested: string | null; confidence: string }[];
  types: { name: string; count: number; subtask: boolean | null; hierarchyLevel: number | null; suggested: string | null; confidence: string }[];
  people: { ref: string; displayName: string | null; email: string | null; roles: Record<string, number>; suggested: string | null; confidence: string }[];
  sprints: { name: string; jiraId: number | null; state: string | null; startDate: string | null; endDate: string | null; goal: string | null; count: number; existingKey: string | null }[];
  versions: { name: string; released: boolean | null; releaseDate: string | null; count: number; exists: boolean }[];
  components: { name: string; count: number }[];
  labels: { name: string; count: number }[];
  fields: {
    storyPoints: { candidates: string[]; suggested: string | null };
    textFields: { key: string; label: string; distinct: number }[];
    category?: { suggested: string | null };
    techno?: { suggested: string | null };
  };
}

export interface ImportResult {
  dryRun: boolean;
  jobId: string | null;
  status?: string;
  counts: ImportCounts;
  rows: ImportRow[];
  warnings: { code: string; message: string; count: number; rows: number[] }[];
  taxonomiesCreated: Record<string, string[]>;
  currentSprint: string | null;
  idPlan: { projectKey: string; kept: number; renumbered: number; reused: number; counterSeq: number };
  files: { name: string; format: string; variant?: string; rows?: number; size: number }[];
  entities: ImportEntities;
  mapping: ImportMapping;
}

export interface ImportJob {
  _id: string;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'rolledBack';
  createdBy?: UserRef;
  files: { name: string; format: string; rows?: number }[];
  counts: ImportCounts;
  error?: string;
  createdAt: string;
  finishedAt?: string;
  rollback?: { tasksDeleted: number; tasksKept: { taskId: string }[]; tasksRestored: number };
}

type Payload = { files: ImportFile[]; mapping?: Partial<ImportMapping>; options?: Partial<ImportOptions> };

export function useImportJobs(projectKey: string) {
  return useQuery({
    queryKey: ['imports', projectKey],
    queryFn: () => get<{ jobs: ImportJob[] }>(`/projects/${projectKey}/import/jobs`).then((r) => r.jobs),
  });
}

export function useImportMutations(projectKey: string) {
  const invalidate = useInvalidateProject(projectKey);
  const base = `/projects/${projectKey}/import`;
  return {
    analyze: useMutation({ mutationFn: (p: Payload) => post<ImportResult>(`${base}/jira/analyze`, p) }),
    simulate: useMutation({ mutationFn: (p: Payload) => post<ImportResult>(`${base}/jira`, { ...p, dryRun: true }) }),
    run: useMutation({ mutationFn: (p: Payload) => post<ImportResult>(`${base}/jira`, { ...p, dryRun: false }), onSuccess: invalidate }),
    rollback: useMutation({
      mutationFn: (jobId: string) =>
        post<{ report: { tasksDeleted: number; tasksKept: { taskId: string }[]; tasksRestored: number; taxonomiesDeleted: number; taxonomiesArchived: number } }>(
          `${base}/jobs/${jobId}/rollback`
        ),
      onSuccess: invalidate,
    }),
  };
}
