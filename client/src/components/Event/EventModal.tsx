import { useEvent } from '../../api/events';
import { useTaxonomies } from '../../api/taxonomies';
import EventDetail from './EventDetail';

export default function EventModal({
  projectKey,
  eventId,
  onClose,
}: {
  projectKey: string;
  eventId: string;
  onClose: () => void;
}) {
  const { data: event, isLoading } = useEvent(projectKey, eventId);
  const { data: taxonomies } = useTaxonomies(projectKey);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        {isLoading || !event ? (
          <div className="loadbox">Chargement…</div>
        ) : (
          <EventDetail projectKey={projectKey} event={event} taxonomies={taxonomies} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
