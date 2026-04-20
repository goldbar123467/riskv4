'use client';

// Log — stand-alone scrolling action log. Used if layout needs it detached.

import { useEffect, useRef } from 'react';
import type { GameState, PlayerColor } from '@/game/types';

const PLAYER_FILL: Record<PlayerColor, string> = {
  amber: '#d97706',
  crimson: '#dc2626',
  sapphire: '#2563eb',
  emerald: '#059669',
};

export interface LogProps {
  readonly state: GameState;
}

export function Log(props: LogProps): JSX.Element {
  const { state } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const lastId = state.log.length > 0 ? state.log[state.log.length - 1]!.id : 0;

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [lastId]);

  const entries = state.log.slice().reverse();

  return (
    <div id="log-section" className="panel-section">
      <div style={{ fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>Log</div>
      <div id="log-list" ref={ref}>
        {entries.map(entry => {
          const p = entry.who !== null ? state.players[entry.who] : null;
          const color = p ? PLAYER_FILL[p.color] : 'var(--text-2)';
          return (
            <div key={entry.id} className="log-entry">
              <span className="t">T{entry.turn}</span>
              {p && <span className="who" style={{ color }}>{p.name}: </span>}
              <span>{entry.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
