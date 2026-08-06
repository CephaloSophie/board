import { useState } from 'react';
import type { TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useCreateEvent } from '../../api/events';
import { eventTypeMeta } from './eventConfig';

export default function NewEventModal({
  projectKey,
  taxonomies,
  defaultType,
  defaultSprint,
  onClose,
  onCreated,
}: {
  projectKey: string;
  taxonomies: TaxonomyItem[] | undefined;
  defaultType?: string;
  defaultSprint?: string | null;
  onClose: () => void;
  onCreated: (eventId: string) => void;
}) {
  const createEvent = useCreateEvent(projectKey);
  const types = taxonomiesByKind(taxonomies, 'eventType');
  const sprints = taxonomiesByKind(taxonomies, 'sprint');
  const [type, setType] = useState(defaultType || types[0]?.key || '');
  const [title, setTitle] = useState('');
  const [sprint, setSprint] = useState(defaultSprint || '');
  const [scheduledAt, setScheduledAt] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!type || !title.trim()) {
      setErr('Le type et le titre sont requis.');
      return;
    }
    setErr(null);
    try {
      const { event } = await createEvent.mutateAsync({
        type,
        title: title.trim(),
        sprint: sprint || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        status: 'draft',
      });
      onCreated(event._id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors de la création.');
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Nouvel événement</h3>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>

        <div className="event-section" style={{ marginTop: 4 }}>
          <h4>Type</h4>
          <div className="event-type-picker">
            {types.map((t) => {
              const m = eventTypeMeta(taxonomies, t.key);
              return (
                <div
                  key={t.key}
                  className={`event-type-option ${type === t.key ? 'active' : ''}`}
                  onClick={() => setType(t.key)}
                  style={type === t.key ? { borderColor: m.color } : undefined}
                >
                  <div className="ico">{m.icon}</div>
                  <div className="lbl">{m.label}</div>
                  <div className="feats">{m.features.length} sections</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label>Titre</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Refinement sprint 12.4" />
        </div>

        <div className="field-grid">
          <div className="field">
            <label>Sprint rattaché</label>
            <select value={sprint} onChange={(e) => setSprint(e.target.value)}>
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
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
        </div>

        {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{err}</div>}

        <button className="btn primary" style={{ marginTop: 14 }} onClick={submit} disabled={createEvent.isPending}>
          {createEvent.isPending ? 'Création…' : "Créer l'événement"}
        </button>
      </div>
    </div>
  );
}
