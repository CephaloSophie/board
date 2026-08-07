export type Role =
  | 'superadmin'
  | 'project_manager'
  | 'product_owner'
  | 'scrum_master'
  | 'team_lead'
  | 'developer'
  | 'qa';

export type TeamRole = 'lead' | 'developer' | 'qa' | 'po' | 'sm' | 'designer' | 'stakeholder';

export interface TeamMember {
  user: UserRef | string;
  teamRole: TeamRole;
  capacityPoints: number;
}

export interface Team {
  _id: string;
  project: string;
  name: string;
  color: string;
  description: string;
  capacityPoints: number;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
}

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
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SprintStatus = 'draft' | 'ready' | 'active' | 'finished';

export interface SprintMeta {
  status?: SprintStatus;
  startDate?: string;
  endDate?: string;
  goal?: string;
  linkedVersion?: string;
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
  | 'poker'
  | 'agenda'
  | 'decisions'
  | 'actions'
  | 'adr'
  | 'demo'
  | 'notes';

export type GroupKind = 'group' | 'tag';

export interface UserGroup {
  _id: string;
  project: string;
  name: string;
  kind: GroupKind;
  color: string;
  members: UserRef[];
  createdAt: string;
  updatedAt: string;
}

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
  author: UserRef | string;
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
  team?: { _id: string; name: string; color?: string } | null;
  comments: Comment[];
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type Theme = 'dark' | 'light' | 'ubuntu' | 'mac';
export type BoardView = 'grouped' | 'list' | 'jira' | 'planning';

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
  search: string;
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
  search: '',
};
