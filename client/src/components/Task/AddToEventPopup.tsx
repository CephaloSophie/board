import { useMemo, useState } from 'react';
import type { Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useEvents, useCreateEvent, useLinkTaskToEvent } from '../../api/events';
import { eventTypeMeta } from '../Event/eventConfig';
import { fmtDate } from '../../utils/format';

/**
 * Quick popup opened from a task: link it to an existing event (any type —
 * refinement, grooming, technical point…) or create one on the fly and link
 * it in a single step.
 */
export default function AddToEventPopup({
  projectKey,
  task,
  taxonomies,
  onClose,
}: {
  projectKey: string;
  task: Task;
  taxonomies: TaxonomyItem[] | undefined;
  onClose: () => void;
}) {
  const { data: events } = useEvents(projectKey, {});
  const createEvent = useCreateEvent(projectKey);
  const linkTask = useLinkTaskToEvent(projectKey);
  const types = taxonomiesByKind(taxonomies, 'eventType');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [newType, setNewType] = useState(types[0]?.key || '');
  const [newTitle, setNewTitle] = useState('');

  // Which events already contain this task, so we can show it as "déjà ajouté".
  const linkedEventIds = useMemo(() => {
    const set = new Set<string>();
    (events || []).forEach((ev) => {
      if (ev.tasks.some((l) => (typeof l.task === 'object' ? l.task._id : l.task) === task._id || l.taskId === task.taskId)) {
        set.add(ev._id);
      }
    });
    return set;
  }, [events, task]);

  async function linkExisting(eventId: string) {
    setErr(null);
    setBusy(true);
    try {
      await linkTask.mutateAsync({ eventId, taskId: task.taskId });
      setMsg('Tâche ajoutée à l\'événement.');
      setTimeout(onClose, 700);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  async function createAndLink() {
    if (!newType || !newTitle.trim()) {
      setErr('Type et titre requis.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const { event } = await createEvent.mutateAsync({
        type: newType,
        title: newTitle.trim(),
        sprint: task.sprint || null,
        status: 'draft',
      });
      await linkTask.mutateAsync({ eventId: event._id, taskId: task.taskId });
      setMsg('Événement créé et tâche ajoutée.');
      setTimeout(onClose, 700);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <div>
            <div className="m-id">{task.taskId}</div>
            <h3 style={{ fontSize: 16 }}>Ajouter à un rituel / événement</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>

        <div className="view-switcher" style={{ width: 'fit-content', marginBottom: 12 }}>
          <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>
            Existant
          </button>
          <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>
            Nouveau
          </button>
        </div>

        {mode === 'existing' && (
          <div className="event-quick-list">
            {(events || []).map((ev) => {
              const m = eventTypeMeta(taxonomies, ev.type);
              const already = linkedEventIds.has(ev._id);
              return (
                <div
                  className="event-quick-item"
                  key={ev._id}
                  onClick={() => !already && !busy && linkExisting(ev._id)}
                  style={already ? { opacity: 0.5, cursor: 'default' } : undefined}
                >
                  <span style={{ fontSize: 16 }}>{m.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{ev.title}</div>
                    <div className="text-muted" style={{ fontSize: 10.5 }}>
                      {m.label}
                      {ev.scheduledAt ? ` · ${fmtDate(ev.scheduledAt)}` : ''}
                    </div>
                  </div>
                  {already ? <span className="tag">déjà ajouté</span> : <span className="icon-btn">⊕</span>}
                </div>
              );
            })}
            {(events || []).length === 0 && (
              <div className="text-muted" style={{ fontSize: 12 }}>Aucun événement. Créez-en un via l'onglet « Nouveau ».</div>
            )}
          </div>
        )}

        {mode === 'new' && (
          <div className="stack">
            <div className="event-type-picker">
              {types.map((t) => {
                const m = eventTypeMeta(taxonomies, t.key);
                return (
                  <div
                    key={t.key}
                    className={`event-type-option ${newType === t.key ? 'active' : ''}`}
                    onClick={() => setNewType(t.key)}
                  >
                    <div className="ico">{m.icon}</div>
                    <div className="lbl">{m.label}</div>
                  </div>
                );
              })}
            </div>
            <div className="field">
              <label>Titre</label>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Refinement…" />
            </div>
            <button className="btn primary" onClick={createAndLink} disabled={busy}>
              Créer &amp; ajouter la tâche
            </button>
          </div>
        )}

        {msg && <div style={{ color: 'var(--success)', fontSize: 12, marginTop: 8 }}>{msg}</div>}
        {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}
