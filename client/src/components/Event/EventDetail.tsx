import { useEffect, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ActionItem, ProjectEvent, TaxonomyItem, EventStatus } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useUpdateEvent, useDeleteEvent, useUnlinkTaskFromEvent } from '../../api/events';
import { useUpdateTask } from '../../api/tasks';
import { useUsers } from '../../api/users';
import { eventTypeMeta, EVENT_STATUS_META } from './eventConfig';
import UserMultiSelect, { idOf } from '../common/UserMultiSelect';
import Avatar from '../common/Avatar';

const FIBO = [1, 2, 3, 5, 8, 13];

export default function EventDetail({
  projectKey,
  event,
  taxonomies,
  onClose,
}: {
  projectKey: string;
  event: ProjectEvent;
  taxonomies: TaxonomyItem[] | undefined;
  onClose?: () => void;
}) {
  const { data: users } = useUsers();
  const updateEvent = useUpdateEvent(projectKey);
  const deleteEvent = useDeleteEvent(projectKey);
  const unlink = useUnlinkTaskFromEvent(projectKey);
  const updateTask = useUpdateTask(projectKey);
  const qc = useQueryClient();
  const type = eventTypeMeta(taxonomies, event.type);
  const sprints = taxonomiesByKind(taxonomies, 'sprint');

  // Inline estimation from a refinement/grooming: set a task's points, then
  // refresh the event so the embedded snapshot shows the new value.
  function estimate(taskId: string, points: number) {
    updateTask.mutate(
      { taskId, data: { complexity: points } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['event', projectKey, event._id] });
          qc.invalidateQueries({ queryKey: ['events', projectKey] });
        },
      }
    );
  }

  const [title, setTitle] = useState(event.title);
  const [agenda, setAgenda] = useState(event.agenda);
  const [notes, setNotes] = useState(event.notes);
  const [decisions, setDecisions] = useState<string[]>(event.decisions);
  const [actions, setActions] = useState<ActionItem[]>(event.actionItems);
  const [adr, setAdr] = useState(event.adr);

  useEffect(() => {
    setTitle(event.title);
    setAgenda(event.agenda);
    setNotes(event.notes);
    setDecisions(event.decisions);
    setActions(event.actionItems);
    setAdr(event.adr);
  }, [event._id]);

  function patch(data: Partial<ProjectEvent>) {
    updateEvent.mutate({ id: event._id, data });
  }

  function toggleParticipant(id: string) {
    const current = event.participants.map((p) => p._id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    patch({ participants: next as unknown as ProjectEvent['participants'] });
  }

  const has = (f: string) => type.features.includes(f as never);

  const estimatedCount = event.tasks.filter((l) => (typeof l.task === 'object' ? l.task.complexity : 0)).length;
  const totalPoints = event.tasks.reduce((a, l) => a + (typeof l.task === 'object' ? l.task.complexity || 0 : 0), 0);

  return (
    <div style={{ ['--evt' as string]: type.color } as CSSProperties}>
      <div className="event-hero">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="event-hero__type">
            <span style={{ fontSize: 18 }}>{type.icon}</span> {type.label}
          </div>
          {onClose && (
            <button className="close-btn" onClick={onClose}>
              Fermer ✕
            </button>
          )}
        </div>
        <input
          className="event-hero__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== event.title && patch({ title })}
          placeholder="Titre de l'événement"
        />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="event-status" style={{ background: `${EVENT_STATUS_META[event.status].color}22`, color: EVENT_STATUS_META[event.status].color }}>
            {EVENT_STATUS_META[event.status].label}
          </span>
          {event.participants.length > 0 && (
            <span className="event-avatars">
              {event.participants.slice(0, 6).map((p) => (
                <Avatar key={p._id} name={p.displayName} color={p.color} size="sm" />
              ))}
            </span>
          )}
          {has('backlog') && event.tasks.length > 0 && (
            <span className="tag pts">{totalPoints} pts · {event.tasks.length} tâches</span>
          )}
        </div>
      </div>

      <div className="field-grid">
        <div className="field">
          <label>Statut</label>
          <select value={event.status} onChange={(e) => patch({ status: e.target.value as EventStatus })}>
            {Object.entries(EVENT_STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Sprint rattaché</label>
          <select value={event.sprint || ''} onChange={(e) => patch({ sprint: e.target.value || null })}>
            <option value="">— Aucun —</option>
            {sprints.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Date / heure</label>
          <input
            type="datetime-local"
            value={event.scheduledAt ? event.scheduledAt.slice(0, 16) : ''}
            onChange={(e) => patch({ scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
          />
        </div>
        <div className="field">
          <label>Durée (min)</label>
          <input
            type="number"
            min={0}
            defaultValue={event.durationMin}
            onBlur={(e) => patch({ durationMin: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      {has('participants') && (
        <div className="event-card-section">
          <h4>Participants</h4>
          <UserMultiSelect users={users} selectedIds={event.participants.map((p) => p._id)} onToggle={toggleParticipant} />
        </div>
      )}

      {has('backlog') && (
        <div className="event-card-section">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h4 style={{ margin: 0 }}>Backlog {has('estimation') ? 'à affiner / estimer' : 'lié'}</h4>
            {has('estimation') && event.tasks.length > 0 && (
              <span className="text-muted" style={{ fontSize: 11 }}>
                {estimatedCount}/{event.tasks.length} estimées · {totalPoints} pts
              </span>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            {event.tasks.map((link) => {
              const t = typeof link.task === 'object' ? link.task : null;
              const pts = t?.complexity || 0;
              if (!has('estimation')) {
                return (
                  <div className="linked-task" key={link._id}>
                    <span className="taskid">{t?.taskId || link.taskId}</span>
                    <span style={{ flex: 1, fontSize: 12.5 }}>{t?.title || '—'}</span>
                    {t?.complexity != null && <span className="tag pts">{pts} pts</span>}
                    <button className="btn danger small" onClick={() => unlink.mutate({ eventId: event._id, linkId: link._id })}>
                      Retirer
                    </button>
                  </div>
                );
              }
              return (
                <div className="est-task" key={link._id}>
                  <span className="est-task__id">{t?.taskId || link.taskId}</span>
                  <span className="est-task__title" title={t?.title}>{t?.title || '—'}</span>
                  <div className="row" style={{ gap: 3 }}>
                    {FIBO.map((n) => (
                      <button
                        key={n}
                        className={`btn small${pts === n ? ' primary' : ''}`}
                        style={{ padding: '3px 8px' }}
                        onClick={() => t && estimate(t.taskId, n)}
                        title={`${n} points`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <button className="icon-btn" title="Retirer" onClick={() => unlink.mutate({ eventId: event._id, linkId: link._id })}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          {event.tasks.length === 0 && (
            <div className="text-muted" style={{ fontSize: 12 }}>
              Aucune tâche liée. Utilisez l'icône ⊕ sur une carte de tâche pour l'ajouter ici.
            </div>
          )}
        </div>
      )}

      {has('agenda') && (
        <div className="event-card-section">
          <h4>Ordre du jour</h4>
          <textarea rows={4} value={agenda} onChange={(e) => setAgenda(e.target.value)} onBlur={() => agenda !== event.agenda && patch({ agenda })} style={{ width: '100%' }} />
        </div>
      )}

      {has('adr') && (
        <div className="event-card-section">
          <h4>Décision d'architecture (ADR)</h4>
          <div className="stack">
            {(['context', 'decision', 'alternatives', 'consequences'] as const).map((f) => (
              <div className="field" key={f}>
                <label>{{ context: 'Contexte', decision: 'Décision', alternatives: 'Alternatives', consequences: 'Conséquences' }[f]}</label>
                <textarea
                  rows={2}
                  value={adr[f]}
                  onChange={(e) => setAdr({ ...adr, [f]: e.target.value })}
                  onBlur={() => adr[f] !== event.adr[f] && patch({ adr })}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {has('demo') && (
        <div className="event-card-section">
          <h4>Ordre de passage démo</h4>
          {event.tasks
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((link, i) => {
              const t = typeof link.task === 'object' ? link.task : null;
              return (
                <div className="linked-task" key={link._id}>
                  <b style={{ width: 20 }}>{i + 1}.</b>
                  <span className="taskid">{t?.taskId || link.taskId}</span>
                  <span style={{ flex: 1, fontSize: 12.5 }}>{t?.title || '—'}</span>
                  {link.presenter && <Avatar name={link.presenter.displayName} color={link.presenter.color} size="sm" />}
                </div>
              );
            })}
          {event.tasks.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>Ajoutez des tâches à présenter via l'icône ⊕ sur les cartes.</div>}
        </div>
      )}

      {has('decisions') && (
        <div className="event-card-section">
          <h4>Décisions</h4>
          <ListEditor
            items={decisions}
            placeholder="Nouvelle décision…"
            onChange={(next) => {
              setDecisions(next);
              patch({ decisions: next });
            }}
          />
        </div>
      )}

      {has('actions') && (
        <div className="event-card-section">
          <h4>Actions à suivre</h4>
          <ActionEditor
            actions={actions}
            users={users}
            onChange={(next) => {
              setActions(next);
              patch({ actionItems: next });
            }}
          />
        </div>
      )}

      {has('notes') && (
        <div className="event-card-section">
          <h4>Notes</h4>
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== event.notes && patch({ notes })} style={{ width: '100%' }} />
        </div>
      )}

      <div className="event-card-section">
        <button
          className="btn danger small"
          onClick={() => {
            if (confirm('Supprimer cet événement ?')) deleteEvent.mutate(event._id, { onSuccess: onClose });
          }}
        >
          Supprimer l'événement
        </button>
      </div>
    </div>
  );
}

function ListEditor({ items, placeholder, onChange }: { items: string[]; placeholder: string; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      {items.map((it, i) => (
        <div className="list-editor-row" key={i}>
          <input value={it} onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))} />
          <button className="btn danger small" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="list-editor-row">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onChange([...items, draft.trim()]);
              setDraft('');
            }
          }}
        />
        <button
          className="btn small"
          onClick={() => {
            if (draft.trim()) {
              onChange([...items, draft.trim()]);
              setDraft('');
            }
          }}
        >
          + Ajouter
        </button>
      </div>
    </div>
  );
}

function ActionEditor({
  actions,
  users,
  onChange,
}: {
  actions: ActionItem[];
  users: ReturnType<typeof useUsers>['data'];
  onChange: (next: ActionItem[]) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      {actions.map((a, i) => (
        <div className="action-item" key={a._id || i}>
          <input type="checkbox" checked={a.done} onChange={(e) => onChange(actions.map((x, idx) => (idx === i ? { ...x, done: e.target.checked } : x)))} />
          <input
            style={{ flex: 1 }}
            value={a.text}
            onChange={(e) => onChange(actions.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)))}
          />
          <select
            value={idOf(a.assignee) || ''}
            onChange={(e) => onChange(actions.map((x, idx) => (idx === i ? { ...x, assignee: e.target.value || null } : x)))}
          >
            <option value="">Non assigné</option>
            {(users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <button className="btn danger small" onClick={() => onChange(actions.filter((_, idx) => idx !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="list-editor-row">
        <input
          value={draft}
          placeholder="Nouvelle action…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onChange([...actions, { _id: '', text: draft.trim(), done: false, assignee: null }]);
              setDraft('');
            }
          }}
        />
        <button
          className="btn small"
          onClick={() => {
            if (draft.trim()) {
              onChange([...actions, { _id: '', text: draft.trim(), done: false, assignee: null }]);
              setDraft('');
            }
          }}
        >
          + Ajouter
        </button>
      </div>
    </div>
  );
}
