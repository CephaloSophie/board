import { useMemo, useState, type ReactNode } from 'react';
import type { HistoryEntry, TaxonomyItem } from '../../types';
import { fmtDate } from '../../utils/format';
import { fmtDayLabel, fmtTime, localDayKey } from '../../utils/dates';
import { FIELD_ICONS, FIELD_LABELS, HISTORY_GROUPS, labelForValue } from '../../utils/historyFormat';
import Avatar from '../common/Avatar';

const TEXT_FIELDS = new Set(['title', 'description', 'instructions', 'acceptance']);

// Task timeline: every tracked change, comment event and move, grouped by day and filterable.
export default function HistoryList({
  history,
  taxonomies,
  userName,
}: {
  history: HistoryEntry[];
  taxonomies: TaxonomyItem[] | undefined;
  userName?: (id: string) => string | undefined;
}) {
  const [group, setGroup] = useState('all');
  const counts = useMemo(
    () => new Map(HISTORY_GROUPS.map((g) => [g.key, g.fields ? history.filter((h) => g.fields!.includes(h.field)).length : history.length])),
    [history]
  );
  const days = useMemo(() => {
    const fields = HISTORY_GROUPS.find((g) => g.key === group)?.fields;
    const sorted = history.filter((h) => !fields || fields.includes(h.field)).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const map = new Map<string, HistoryEntry[]>();
    for (const h of sorted) {
      const key = localDayKey(h.at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(h);
    }
    return [...map.entries()];
  }, [history, group]);

  return (
    <div className="history">
      <div className="filter-chips">
        {HISTORY_GROUPS.filter((g) => g.key === 'all' || counts.get(g.key)).map((g) => (
          <button key={g.key} className={`filter-chip${group === g.key ? ' on' : ''}`} onClick={() => setGroup(g.key)}>
            {g.label} <span>{counts.get(g.key)}</span>
          </button>
        ))}
      </div>
      {days.length === 0 && <div className="text-muted small-text">Aucun historique.</div>}
      {days.map(([day, entries]) => (
        <div key={day} className="timeline-day">
          <div className="timeline-day__label">{fmtDayLabel(entries[0].at)}</div>
          {entries.map((h) => (
            <HistoryRow key={h._id} entry={h} taxonomies={taxonomies} userName={userName} />
          ))}
        </div>
      ))}
    </div>
  );
}

function HistoryRow({
  entry: h,
  taxonomies,
  userName,
}: {
  entry: HistoryEntry;
  taxonomies: TaxonomyItem[] | undefined;
  userName?: (id: string) => string | undefined;
}) {
  const by = typeof h.by === 'object' && h.by ? h.by : null;
  const name = by?.displayName || h.byLabel || 'système';
  const label = FIELD_LABELS[h.field] || h.field;
  let body: ReactNode;
  if (h.field === 'created') {
    body = (
      <>
        a créé la tâche{h.to ? <> en <b>{labelForValue('status', h.to, taxonomies)}</b></> : null}
      </>
    );
  } else if (h.field === 'comment') {
    body = (
      <>
        {(h.note || 'Commentaire').replace(/\.$/, '').toLowerCase()}
        {(h.to || h.from) && <q className="timeline__quote">{String(h.to || h.from)}</q>}
      </>
    );
  } else if (TEXT_FIELDS.has(h.field)) {
    body = (
      <>
        a modifié <b>{label}</b>
        {h.to ? <q className="timeline__quote">{String(h.to)}</q> : <span className="text-muted"> (vidé)</span>}
      </>
    );
  } else {
    body = (
      <>
        a changé <b>{label}</b> : <span className="timeline__from">{labelForValue(h.field, h.from, taxonomies, userName)}</span> →{' '}
        <span className="timeline__to">{labelForValue(h.field, h.to, taxonomies, userName)}</span>
      </>
    );
  }
  const showNote = h.note && h.field !== 'comment' && h.field !== 'created';
  return (
    <div className="timeline__row">
      <span className="timeline__icon" title={label}>
        {FIELD_ICONS[h.field] || '•'}
      </span>
      <Avatar name={name} color={by?.color || '#6b7280'} size="sm" />
      <div className="timeline__text">
        <b>{name}</b> {body}
        {showNote && <span className="timeline__note"> — {h.note}</span>}
      </div>
      <span className="timeline__time" title={fmtDate(h.at)}>
        {fmtTime(h.at)}
      </span>
    </div>
  );
}
