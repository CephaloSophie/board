export type Role = 'superadmin' | 'developer';

export interface PublicUser {
  id: string;
  username: string;
  email?: string;
  displayName: string;
  role: Role;
  color: string;
  active: boolean;
  createdAt?: string;
}

export type ProjectRole = 'admin' | 'member' | 'viewer';
export type ProjectAccess = 'open' | 'members';
export type StatusCategory = 'todo' | 'inprogress' | 'done';

export interface ProjectMember {
  _id?: string;
  user: string;
  role: ProjectRole;
  addedAt?: string;
}

export interface Project {
  _id: string;
  key: string;
  name: string;
  vendor?: string;
  description?: string;
  owner?: string;
  currentVersion: string;
  complexityScale?: string;
  sprintDurationValue: number;
  sprintDurationUnit: 'days' | 'weeks';
  currentSprint: string | null;
  access: ProjectAccess;
  members: ProjectMember[];
  timezone: string;
  workingDays: number[];
  estimation: { unit: 'points' | 'hours'; scale: number[] };
  defaults: { status?: string; type?: string; priority?: string };
  archived: boolean;
  archivedAt?: string;
  myRole?: ProjectRole | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStats {
  total: number;
  done: number;
  inProgress: number;
  bugs: number;
  openBugs: number;
  totalPoints: number;
  donePoints: number;
}

export interface ProjectOverview {
  taskCount: number;
  openCount: number;
  memberCount: number;
  sprintCount: number;
  activeSprint: { key: string; label: string; meta?: SprintMeta } | null;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface MemberRow {
  user: PublicUser;
  role: ProjectRole;
  listed: boolean;
  isOwner: boolean;
  isSuperadmin: boolean;
  addedAt: string | null;
  openTaskCount: number;
}

export type SprintStatus = 'draft' | 'ready' | 'active' | 'finished';

export interface SprintReport {
  committedPoints: number;
  committedCount: number;
  completedPoints: number;
  completedCount: number;
  carriedOverTaskIds: string[];
  carriedOverPoints?: number;
  carriedTo: string | null;
  keptTaskIds: string[];
  source: 'lifecycle' | 'import' | 'computed';
}

export interface SprintMeta {
  status?: SprintStatus;
  startDate?: string;
  endDate?: string;
  goal?: string;
  linkedVersion?: string;
  startedAt?: string;
  startSnapshot?: { at: string; committedPoints: number; committedCount: number; taskIds: string[] };
  closedAt?: string;
  reopenedAt?: string;
  report?: SprintReport;
}

export type SprintRow = Omit<TaxonomyItem, 'meta'> & {
  status: SprintStatus;
  meta: SprintMeta;
  stats: { taskCount: number; points: number; doneCount: number; donePoints: number };
};

export interface VersionMeta {
  status?: 'released' | 'unreleased';
  startDate?: string;
  releaseDate?: string;
  releasedAt?: string;
  description?: string;
}

export type VersionRow = Omit<TaxonomyItem, 'meta'> & {
  status: 'released' | 'unreleased';
  meta: VersionMeta;
  stats: { taskCount: number; points: number; doneCount: number };
};

export interface ClosePreview {
  sprint: SprintRow;
  done: { count: number; points: number };
  notDone: { _id: string; taskId: string; title: string; status: string; complexity: number; assignee?: UserRef | null }[];
  targets: { key: string; label: string; status: SprintStatus; startDate?: string; endDate?: string }[];
}

export type TaxonomyKind =
  | 'status'
  | 'priority'
  | 'area'
  | 'type'
  | 'techno'
  | 'category'
  | 'version'
  | 'sprint'
  | 'eventType';

export type EventFeature =
  | 'participants'
  | 'backlog'
  | 'estimation'
  | 'agenda'
  | 'decisions'
  | 'actions'
  | 'adr'
  | 'demo'
  | 'notes';

export interface EventTypeMeta {
  icon?: string;
  features?: EventFeature[];
}

export type EventStatus = 'draft' | 'scheduled' | 'done' | 'cancelled';

export interface EventTaskLink {
  _id: string;
  task: { _id: string; taskId: string; title: string; status: string; priority?: string; complexity?: number } | string;
  taskId?: string;
  note?: string;
  outcome?: string;
  presenter?: UserRef | null;
  order: number;
}

export interface ActionItem {
  _id: string;
  text: string;
  assignee?: UserRef | string | null;
  done: boolean;
}

export interface ProjectEvent {
  _id: string;
  project: string;
  type: string;
  title: string;
  status: EventStatus;
  sprint: string | null;
  scheduledAt: string | null;
  durationMin: number;
  participants: UserRef[];
  tasks: EventTaskLink[];
  agenda: string;
  notes: string;
  decisions: string[];
  actionItems: ActionItem[];
  adr: { context: string; decision: string; alternatives: string; consequences: string };
  createdBy?: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaxonomyItem {
  _id: string;
  project: string;
  kind: TaxonomyKind;
  key: string;
  label: string;
  color?: string;
  description?: string;
  order: number;
  meta?: Record<string, unknown>;
  archived: boolean;
}

export interface UserRef {
  _id: string;
  username: string;
  displayName: string;
  color: string;
}

export interface Comment {
  _id: string;
  author: UserRef | string | null;
  authorLabel?: string;
  text: string;
  createdAt: string;
  editedAt?: string;
}

export interface HistoryEntry {
  _id: string;
  at: string;
  by?: UserRef | string;
  byLabel?: string;
  field: string;
  from: unknown;
  to: unknown;
  note?: string;
}

export interface Task {
  _id: string;
  project: string;
  taskId: string;
  title: string;
  description: string;
  area?: string;
  module?: string;
  type?: string;
  status: string;
  priority?: string;
  version?: string;
  sprint?: string | null;
  techno?: string;
  category?: string;
  estimate?: string;
  duration?: string;
  complexity: number;
  spec?: string;
  instructions: string[];
  acceptance: string[];
  assignee?: UserRef | null;
  reporter?: UserRef | null;
  labels: string[];
  parent?: string | null;
  dueDate?: string | null;
  resolvedAt?: string | null;
  statusChangedAt?: string | null;
  external?: { source?: string; key?: string; id?: string; url?: string; assigneeName?: string; reporterName?: string };
  comments: Comment[];
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type Theme = 'dark' | 'light' | 'ubuntu' | 'mac';
export type BoardView = 'grouped' | 'list' | 'jira';

export interface TaskFilters {
  status: string[];
  priority: string[];
  type: string[];
  category: string[];
  techno: string[];
  version: string[];
  sprint: string[];
  area: string[];
  assignee: string[];
  labels: string[];
  statusCategory: string[];
  search: string;
}

export type MultiFilterField = Exclude<keyof TaskFilters, 'search'>;

export interface BoardSort {
  key: string;
  dir: 1 | -1;
}

export type SavedFilterVisibility = 'private' | 'shared';

// A named board configuration saved by a user (see server SavedFilter).
export interface SavedFilter {
  _id: string;
  project: string;
  owner: UserRef;
  name: string;
  description: string;
  filters: Partial<TaskFilters>;
  view: BoardView;
  groupBy: string;
  sort: BoardSort;
  visibility: SavedFilterVisibility;
  isOwner: boolean;
  isStarred: boolean;
  isDefault: boolean;
  starCount: number;
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_FILTERS: TaskFilters = {
  status: [],
  priority: [],
  type: [],
  category: [],
  techno: [],
  version: [],
  sprint: [],
  area: [],
  assignee: [],
  labels: [],
  statusCategory: [],
  search: '',
};
