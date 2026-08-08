import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from './client';
import { wsBase } from './wsBase';

export type RetroPhase = 'lobby' | 'rating' | 'ssc' | 'voting' | 'actions' | 'closing' | 'done';

export interface RetroSticky {
  id: string;
  author: string;
  column: 'start' | 'stop' | 'continue';
  text: string;
}

export interface RetroState {
  id?: string;
  sprint?: string;
  team?: { _id: string; name: string } | null;
  title?: string;
  facilitator?: string;
  phase?: RetroPhase;
  status?: string;
  invited?: { _id: string; displayName: string; color?: string; role?: string }[];
  absent?: string[];
  online?: string[];

  ratingRevealed?: boolean;
  myRating?: number | null;
  ratedBy?: string[];
  ratings?: { user: string; value: number }[];
  ratingAvg?: number;

  sscRevealed?: boolean;
  timerEndsAt?: string | null;
  speakerOrder?: string[];
  speakerIndex?: number;
  stickies?: RetroSticky[];
  stickyCounts?: Record<string, number>;

  votesConfig?: { perPerson: number; minPer: number; maxPer: number };
  myVotes?: { stickyId: string; points: number }[];
  votesRevealed?: boolean;
  voteScores?: Record<string, number>;

  actionItems?: { _id?: string; stickyId: string; text: string; fromUser?: string; score?: number; done?: boolean }[];

  retroRatingRevealed?: boolean;
  myRetroRating?: number | null;
  retroRatingAvg?: number;
}

type Status = 'connecting' | 'open' | 'closed';

export function useRetro(retroId: string | undefined) {
  const [status, setStatus] = useState<Status>('connecting');
  const [state, setState] = useState<RetroState>({});
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!retroId) return;
    let closedByUs = false;
    function connect() {
      const token = getToken();
      if (!token) return;
      const wsUrl = `${wsBase()}/wsretro?token=${encodeURIComponent(token)}&retro=${encodeURIComponent(retroId!)}`;
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
        if (msg.type === 'retro') setState(msg.retro || {});
      };
      ws.onclose = () => {
        setStatus('closed');
        if (!closedByUs) retryRef.current = setTimeout(connect, 2500);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      closedByUs = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [retroId]);

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, []);

  return { status, state, send };
}
