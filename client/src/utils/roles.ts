import type { Role, TeamRole } from '../types';

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super admin',
  project_manager: 'Chef de projet',
  product_owner: 'Product Owner',
  scrum_master: 'Scrum Master',
  team_lead: "Chef d'équipe",
  developer: 'Développeur',
  qa: 'QA / Testeur',
};

export const ROLE_ORDER: Role[] = [
  'superadmin',
  'project_manager',
  'product_owner',
  'scrum_master',
  'team_lead',
  'developer',
  'qa',
];

// Roles allowed to manage projects, taxonomies and teams (mirrors the server
// MANAGER_ROLES). User administration stays superadmin-only.
const MANAGER_ROLES: Role[] = ['superadmin', 'project_manager', 'scrum_master', 'product_owner', 'team_lead'];

export function isManager(role: Role | undefined): boolean {
  return !!role && MANAGER_ROLES.includes(role);
}

export function isSuperadmin(role: Role | undefined): boolean {
  return role === 'superadmin';
}

export function roleLabel(role: Role | string | undefined): string {
  return (role && ROLE_LABELS[role as Role]) || String(role || '');
}

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  lead: "Chef d'équipe",
  developer: 'Développeur',
  qa: 'QA',
  po: 'Product Owner',
  sm: 'Scrum Master',
  designer: 'Designer',
  stakeholder: 'Partie prenante',
};

export const TEAM_ROLE_ORDER: TeamRole[] = ['lead', 'po', 'sm', 'developer', 'qa', 'designer', 'stakeholder'];
