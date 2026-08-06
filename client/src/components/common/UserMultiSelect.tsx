import type { PublicUser, UserRef } from '../../types';
import Avatar from './Avatar';

// Toggleable chip list of users — used to pick event participants.
export default function UserMultiSelect({
  users,
  selectedIds,
  onToggle,
}: {
  users: PublicUser[] | undefined;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="multi-select-chips">
      {(users || []).map((u) => {
        const active = selectedIds.includes(u.id);
        return (
          <span key={u.id} className={`pick-chip ${active ? 'active' : ''}`} onClick={() => onToggle(u.id)}>
            <Avatar name={u.displayName} color={u.color} size="sm" />
            {u.displayName}
          </span>
        );
      })}
      {(!users || users.length === 0) && <span className="text-muted" style={{ fontSize: 12 }}>Aucun utilisateur.</span>}
    </div>
  );
}

export function idOf(ref: UserRef | string | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'object' ? ref._id : ref;
}
