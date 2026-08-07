import { useEffect, useRef, useState, useCallback } from 'react';
import { getToken } from './client';

export interface PresenceMember {
  id: string;
  displayName: string;
  color?: string;
  role?: string;
}

export interface PokerSession {
  active: boolean;
  taskId?: string | null;
  taskTitle?: string;
  deck?: string[];
  durationSec?: number;
  startedAt?: number;
  launcherId?: string;
  launcherName?: string;
  allowMode?: 'all' | 'group' | 'tag' | 'users';
  allowedUserIds?: string[] | null;
  voters?: string[];
  revealed?: boolean;
  myVote?: string | null;
  votes?: Record<string, string>;
  voterNames?: Record<string, string>;
  distribution?: Record<string, number>;
  suggestion?: number | null;
  agreement?: boolean;
}

export interface StartVoteArgs {
  taskId?: string | null;
  taskTitle?: string;
  deck: string[];
  durationSec: number;
  allow: { mode: 'all' | 'group' | 'tag' | 'users'; ids: string[] };
}

type Status = 'connecting' | 'open' | 'closed';

// WebSocket client for the realtime Planning Poker. Connects to /ws with the
// current JWT + event id, exposes presence + session state and the actions.
export function usePoker(eventId: string | undefined) {
  const [status, setStatus] = useState<Status>('connecting');
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [session, setSession] = useState<PokerSession>({ active: false });
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let closedByUs = false;

    function connect() {
      const token = getToken();
      if (!token) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}&event=${encodeURIComponent(eventId!)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => setStatus('open');
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'presence') setMembers(msg.members || []);
        else if (msg.type === 'session') {
          const { type, ...rest } = msg;
          setSession(rest as PokerSession);
        }
      };
      ws.onclose = () => {
        setStatus('closed');
        if (!closedByUs) {
          retryRef.current = setTimeout(connect, 2500); // auto-reconnect
        }
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closedByUs = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [eventId]);

  const sendMsg = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, []);

  const startVote = useCallback((args: StartVoteArgs) => sendMsg({ type: 'start', ...args }), [sendMsg]);
  const vote = useCallback((value: string) => sendMsg({ type: 'vote', value }), [sendMsg]);
  const unvote = useCallback(() => sendMsg({ type: 'unvote' }), [sendMsg]);
  const reveal = useCallback(() => sendMsg({ type: 'reveal' }), [sendMsg]);
  const cancel = useCallback(() => sendMsg({ type: 'cancel' }), [sendMsg]);
  const setEstimate = useCallback((taskId: string, value: number) => sendMsg({ type: 'estimate', taskId, value }), [sendMsg]);

  return { status, members, session, startVote, vote, unvote, reveal, cancel, setEstimate };
}
