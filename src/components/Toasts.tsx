'use client';

// Toasts — ephemeral announcements derived from the log's tail.

import { useEffect, useRef, useState } from 'react';
import type { GameState, LogEntry } from '@/game/types';

const LIFETIME_MS = 3000;
const MAX_ON_SCREEN = 4;

interface ToastItem {
  readonly key: number;
  readonly text: string;
}

export interface ToastsProps {
  readonly state: GameState;
}

export function Toasts(props: ToastsProps): JSX.Element {
  const { state } = props;
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const lastSeenRef = useRef<number>(-1);

  useEffect(() => {
    if (state.log.length === 0) {
      lastSeenRef.current = -1;
      return;
    }
    const newest = state.log[state.log.length - 1]!;
    if (lastSeenRef.current < 0) {
      lastSeenRef.current = newest.id;
      return;
    }
    // Collect any new entries since last render.
    const fresh: LogEntry[] = [];
    for (let i = state.log.length - 1; i >= 0; i--) {
      const e = state.log[i]!;
      if (e.id <= lastSeenRef.current) break;
      fresh.unshift(e);
    }
    lastSeenRef.current = newest.id;
    if (fresh.length === 0) return;
    const announce = fresh.filter(shouldAnnounce);
    if (announce.length === 0) return;
    setItems(prev => {
      const next = prev.slice();
      for (const e of announce) {
        next.push({ key: e.id, text: formatToast(e, state) });
      }
      return next.slice(-MAX_ON_SCREEN);
    });
  }, [state]);

  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map(it => setTimeout(() => {
      setItems(curr => curr.filter(x => x.key !== it.key));
    }, LIFETIME_MS));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [items]);

  return (
    <div id="toast-container">
      {items.map(it => (
        <div key={it.key} className="toast">{it.text}</div>
      ))}
    </div>
  );
}

function shouldAnnounce(e: LogEntry): boolean {
  return e.kind === 'roll' || e.kind === 'robber' || e.kind === 'victory' || e.kind === 'dev' || e.kind === 'build';
}

function formatToast(e: LogEntry, state: GameState): string {
  const who = e.who !== null ? state.players[e.who]?.name : null;
  if (who) return `${who} — ${e.text}`;
  return e.text;
}
