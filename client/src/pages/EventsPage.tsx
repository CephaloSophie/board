import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useEvents } from '../api/events';
import { useTaxonomies, taxonomiesByKind } from '../api/taxonomies';
import { eventTypeMeta, EVENT_STATUS_META } from '../components/Event/eventConfig';
import NewEventModal from '../components/Event/NewEventModal';
import EventModal from '../components/Event/EventModal';
import Avatar from '../components/common/Avatar';
import { fmtDate } from '../utils/format';
import type { ProjectEvent } from '../types';

export default function EventsPage() {
  const { projectKey } = useParams();
  const { data: taxonomies } = useTaxonomies(projectKey);
  const [filterSprint, setFilterSprint] = useState('');
  const [filterType, setFilterType] = useState('');
  const { data: events, isLoading } = useEvents(projectKey, {
    sprint: filterSprint || undefined,
    type: filterType || undefined,
  });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!projectKey) return null;
  const sprints = taxonomiesByKind(taxonomies, 'sprint');
  const types = taxonomiesByKind(taxonomies, 'eventType');

  return (
    <div>
      <div className="page-toolbar">
        <h2 className="mt-0" style={{ marginRight: 'auto' }}>
          Rituels &amp; événements
        </h2>
        <div className="ctrl" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <label style={{ marginBottom: 0 }}>Sprint</label>
          <select value={filterSprint} onChange={(e) => setFilterSprint(e.target.value)}>
            <option value="">Tous</option>
            {sprints.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ctrl" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <label style={{ marginBottom: 0 }}>Type</label>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">Tous</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          + Nouvel événement
        </button>
      </div>

      {isLoading && <div className="loadbox">Chargement…</div>}

      <div className="event-grid">
        {events?.map((ev) => (
          <EventCard key={ev._id} event={ev} taxonomies={taxonomies} onOpen={() => setOpenId(ev._id)} />
        ))}
      </div>

      {!isLoading && events?.length === 0 && (
        <div className="empty">
          Aucun événement. Créez un refinement, un grooming, un point technique…
        </div>
      )}

      {creating && (
        <NewEventModal
          projectKey={projectKey}
          taxonomies={taxonomies}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      )}
      {openId && <EventModal projectKey={projectKey} eventId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function EventCard({
  event,
  taxonomies,
  onOpen,
}: {
  event: ProjectEvent;
  taxonomies: ReturnType<typeof useTaxonomies>['data'];
  onOpen: () => void;
}) {
  const type = eventTypeMeta(taxonomies, event.type);
  const statusMeta = EVENT_STATUS_META[event.status];
  const sprintLabel = event.sprint ? taxonomiesByKind(taxonomies, 'sprint').find((s) => s.key === event.sprint)?.label : null;
  return (
    <div className="event-card" style={{ borderLeftColor: type.color }} onClick={onOpen}>
      <div className="event-card__head">
        <span className="event-card__icon">{type.icon}</span>
        <span className="event-card__type">{type.label}</span>
        <span
          className="event-status"
          style={{ marginLeft: 'auto', background: `${statusMeta.color}22`, color: statusMeta.color }}
        >
          {statusMeta.label}
        </span>
      </div>
      <div className="event-card__title">{event.title}</div>
      <div className="event-card__meta">
        {sprintLabel && <span className="tag">{sprintLabel}</span>}
        {event.scheduledAt && <span className="tag dur">{fmtDate(event.scheduledAt)}</span>}
        {event.tasks.length > 0 && <span className="tag pts">{event.tasks.length} tâches</span>}
        <span className="event-avatars">
          {event.participants.slice(0, 5).map((p) => (
            <Avatar key={p._id} name={p.displayName} color={p.color} size="sm" />
          ))}
        </span>
      </div>
    </div>
  );
}
