import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { SprintStatus, Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { metaOf } from '../../utils/format';
import { SPRINT_STATUS_META } from '../../utils/status';
import TaskCard from './TaskCard';
import GroupSidebar from './GroupSidebar';
import GroupStats from './GroupStats';
import { groupTasks, type GroupByKey, type TaskGroup } from './groupUtils';

// Where a card was dropped: the group it now belongs to (null when not grouped)
// and the status column (null = keep the status, e.g. dropped on an empty group).
export interface DropTarget {
  groupKey: string | null;
  status: string | null;
}

export interface BoardProps {
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
  onDrop: (task: Task, target: DropTarget) => void;
  groupBy: GroupByKey;
  currentSprintKey?: string | null;
  showEmptyColumns?: boolean;
  showEmptyGroups?: boolean;
  users?: { id: string; displayName: string; color?: string }[];
  variant?: 'grouped' | 'jira';
}

// Namespaced droppable id so the same status column repeated across groups
// stays uniquely identifiable to dnd-kit ("<groupKey>::<statusKey>").
const dropIdOf = (groupKey: string, status = '') => `${groupKey}::${status}`;
function parseDropId(id: string): { groupKey: string; status: string | null } {
  const i = id.lastIndexOf('::');
  return { groupKey: id.slice(0, i), status: id.slice(i + 2) || null };
}

function StatusColumn({
  dropId,
  status,
  tasks,
  taxonomies,
  onOpen,
}: {
  dropId: string;
  status: TaxonomyItem;
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const points = tasks.reduce((a, t) => a + (t.complexity || 0), 0);
  return (
    <div ref={setNodeRef} className={`col${isOver ? ' drag-over' : ''}${tasks.length ? '' : ' col--empty'}`}>
      <div className="col__head">
        <span className="col__dot" style={{ background: status.color }} />
        <span className="col__name" style={{ color: status.color }}>
          {status.label}
        </span>
        <span className="col__count">
          {tasks.length} · {points}pts
        </span>
      </div>
      {tasks.map((t) => (
        <TaskCard key={t.taskId} task={t} taxonomies={taxonomies} onOpen={onOpen} />
      ))}
      {tasks.length === 0 && <div className="empty">Déposer ici</div>}
    </div>
  );
}

function GroupDropStrip({ dropId, label }: { dropId: string; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <div ref={setNodeRef} className={`group-drop${isOver ? ' over' : ''}`}>
      {label}
    </div>
  );
}

/**
 * Kanban engine shared by the "Board" (grouped) and "Jira" views: one block per
 * group, one column per workflow status. Dropping a card on another column
 * changes its status; on another group it also changes the grouped field
 * (sprint, version, assignee, priority…).
 */
export default function GroupedBoard({
  tasks,
  taxonomies,
  onOpen,
  onDrop,
  groupBy,
  currentSprintKey,
  showEmptyColumns = true,
  showEmptyGroups = false,
  users,
  variant = 'grouped',
}: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  // Non-empty groups start expanded, empty ones collapsed to a drop strip.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const statuses = taxonomiesByKind(taxonomies, 'status');
  const containerRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    () => groupTasks(tasks, groupBy, taxonomies, { includeEmpty: showEmptyGroups && groupBy !== 'none', users }),
    [tasks, groupBy, taxonomies, showEmptyGroups, users]
  );

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    const task = active.data.current?.task as Task | undefined;
    if (!over || !task) return;
    const target = parseDropId(String(over.id));
    onDrop(task, { groupKey: groupBy === 'none' ? null : target.groupKey, status: target.status });
  }

  function toggleGroup(key: string) {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function scrollToGroup(key: string) {
    if (key === '__top__') {
      setActiveGroupKey(null);
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setActiveGroupKey(key);
    document.getElementById(`group-block-${cssId(key)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function columnsOf(group: TaskGroup): TaxonomyItem[] {
    // Grouped by status: each block is exactly its own status column.
    if (groupBy === 'status') return [metaOf(taxonomies, 'status', group.key)];
    const present = new Set(group.tasks.map((t) => t.status));
    const cols = showEmptyColumns ? [...statuses] : statuses.filter((s) => present.has(s.key));
    for (const key of present) {
      if (!cols.some((s) => s.key === key)) cols.push(metaOf(taxonomies, 'status', key));
    }
    return cols;
  }

  function renderGroup(group: TaskGroup) {
    const isCurrent = groupBy === 'sprint' && !!currentSprintKey && group.key === currentSprintKey;
    const empty = group.tasks.length === 0;
    const collapsed = groupBy !== 'none' && (empty ? !toggled.has(group.key) : toggled.has(group.key));
    const cols = columnsOf(group);
    const sprintStatus = groupBy === 'sprint' && group.sublabel ? SPRINT_STATUS_META[group.sublabel as SprintStatus] : undefined;
    const kanban = variant === 'jira' || showEmptyColumns;
    const byStatus = new Map<string, Task[]>();
    for (const t of group.tasks) {
      if (!byStatus.has(t.status)) byStatus.set(t.status, []);
      byStatus.get(t.status)!.push(t);
    }
    const sortTasks = (list: Task[]) =>
      variant === 'jira' ? list.slice().sort((a, b) => (a.priority || '').localeCompare(b.priority || '') || a.taskId.localeCompare(b.taskId)) : list;

    return (
      <section id={`group-block-${cssId(group.key)}`} className={`group-block${empty ? ' group-block--empty' : ''}`} key={group.key}>
        {groupBy !== 'none' && (
          <header className="group-block__head">
            <button className="icon-btn" onClick={() => toggleGroup(group.key)} title={collapsed ? 'Déplier' : 'Replier'}>
              {collapsed ? '▸' : '▾'}
            </button>
            <span className="group-block__title" style={group.color ? { color: group.color } : undefined}>
              {isCurrent && '★ '}
              {group.label}
            </span>
            {sprintStatus ? (
              <span className="sprint-tag" style={{ background: `${sprintStatus.color}33`, color: sprintStatus.color }}>
                {sprintStatus.label}
              </span>
            ) : (
              group.sublabel && <span className="group-block__sub">{group.sublabel}</span>
            )}
            <GroupStats tasks={group.tasks} taxonomies={taxonomies} />
          </header>
        )}
        {collapsed ? (
          <GroupDropStrip dropId={dropIdOf(group.key)} label={`${empty ? 'Aucune tâche · ' : ''}déposer une carte ici pour la déplacer vers « ${group.label} »`} />
        ) : (
          <div className="columns-scroll">
            <div
              className={`columns${kanban ? ' kanban' : ''}`}
              style={kanban ? { gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(220px, 1fr))` } : undefined}
            >
              {cols.map((s) => (
                <StatusColumn
                  key={s.key}
                  dropId={dropIdOf(group.key, s.key)}
                  status={s}
                  tasks={sortTasks(byStatus.get(s.key) || [])}
                  taxonomies={taxonomies}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  const body = (
    <>
      {groups.map(renderGroup)}
      {tasks.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
    </>
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveTask((e.active.data.current?.task as Task) || null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      {groupBy === 'none' ? (
        <main className="board-main" ref={containerRef}>
          {body}
        </main>
      ) : (
        <div className="grouped-layout" ref={containerRef}>
          <GroupSidebar
            title={sidebarTitle(groupBy)}
            groups={groups}
            activeKey={activeGroupKey}
            onSelect={scrollToGroup}
            currentSprintKey={currentSprintKey}
          />
          <div className="groups-main">{body}</div>
        </div>
      )}
      <DragOverlay>{activeTask && <TaskCard task={activeTask} taxonomies={taxonomies} onOpen={() => {}} />}</DragOverlay>
    </DndContext>
  );
}

function sidebarTitle(groupBy: GroupByKey): string {
  switch (groupBy) {
    case 'sprint': return 'Sprints';
    case 'version': return 'Versions';
    case 'category': return 'Catégories';
    case 'techno': return 'Technos';
    case 'area': return 'Domaines';
    case 'type': return 'Types';
    case 'priority': return 'Priorités';
    case 'status': return 'Statuts';
    case 'assignee': return 'Assignés';
    default: return 'Groupes';
  }
}

function cssId(v: string) {
  return v.replace(/[^a-zA-Z0-9_-]/g, '_');
}
