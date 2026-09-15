import { useMemo } from 'react';
import { useMembers } from '../api/members';
import type { PublicUser } from '../types';

// Project members indexed for rich text (@username → display name) and history (id → name).
export function useProjectPeople(projectKey: string | undefined) {
  const { data } = useMembers(projectKey);
  return useMemo(() => {
    const users: PublicUser[] = (data?.members || []).map((m) => m.user);
    const byUsername = new Map(users.map((u) => [u.username.toLowerCase(), u]));
    const byId = new Map(users.map((u) => [String(u.id), u]));
    return {
      users,
      byId,
      mentionLabel: (username: string) => byUsername.get(username.toLowerCase())?.displayName,
      userName: (id: string) => byId.get(String(id))?.displayName,
    };
  }, [data]);
}
