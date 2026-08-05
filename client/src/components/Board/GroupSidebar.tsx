import type { TaskGroup } from './groupUtils';
import { SPRINT_STATUS_META } from '../Admin/TaxonomyAdmin';
import type { SprintStatus } from '../../types';

// Left-hand list of every group present in the current filtered set.
// Clicking a group scrolls the main area to its block; a "Tout" pseudo-item
// scrolls back to the top of the stack.
export default function GroupSidebar({
  title,
  groups,
  activeKey,
  onSelect,
  currentSprintKey,
}: {
  title: string;
  groups: TaskGroup[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  currentSprintKey?: string | null;
}) {
  return (
    <aside className="groups-sidebar">
      <div className="groups-sidebar__title">{title}</div>
      <div
        className={`groups-sidebar__item${activeKey === null ? ' active' : ''}`}
        onClick={() => onSelect('__top__')}
      >
        <span className="dot" style={{ background: 'var(--soft)' }} />
        <span>Tous les groupes</span>
        <span className="count">{groups.reduce((a, g) => a + g.tasks.length, 0)}</span>
      </div>
      {groups.map((g) => {
        const status = g.sublabel as SprintStatus | undefined;
        const statusMeta = status ? SPRINT_STATUS_META[status] : undefined;
        const isCurrent = currentSprintKey && g.key === currentSprintKey;
        return (
          <div
            key={g.key}
            className={`groups-sidebar__item${activeKey === g.key ? ' active' : ''}`}
            onClick={() => onSelect(g.key)}
            title={isCurrent ? 'Sprint courant' : undefined}
          >
            <span className="dot" style={{ background: g.color || 'var(--soft)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {g.label}
              {isCurrent && ' ★'}
            </span>
            {statusMeta && (
              <span className="sprint-tag" style={{ background: `${statusMeta.color}33`, color: statusMeta.color }}>
                {statusMeta.label}
              </span>
            )}
            <span className="count">{g.tasks.length}</span>
          </div>
        );
      })}
    </aside>
  );
}
