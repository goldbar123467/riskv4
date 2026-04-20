'use client';

// Modals — blocking UI for decisions the engine needs from the human.

import { useMemo, useState } from 'react';
import type {
  Action,
  GameState,
  Legality,
  PlayerColor,
  PlayerId,
  Resource,
} from '@/game/types';
import { RESOURCES, handTotal } from '@/game/types';

const PLAYER_FILL: Record<PlayerColor, string> = {
  amber: '#d97706',
  crimson: '#dc2626',
  sapphire: '#2563eb',
  emerald: '#059669',
};

// ----- Shared -----

function Backdrop(props: { children: React.ReactNode }): JSX.Element {
  return <div className="modal-backdrop"><div className="modal">{props.children}</div></div>;
}

// ===== Discard =====

export interface DiscardModalProps {
  readonly state: GameState;
  readonly playerId: PlayerId;
  readonly required: number;
  readonly onConfirm: (cards: Partial<Record<Resource, number>>) => void;
}

export function DiscardModal(props: DiscardModalProps): JSX.Element {
  const { state, playerId, required, onConfirm } = props;
  const player = state.players[playerId]!;
  const [sel, setSel] = useState<Record<Resource, number>>({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
  const selectedTotal = RESOURCES.reduce((n, r) => n + sel[r], 0);
  const bump = (r: Resource, d: number): void => {
    setSel(s => {
      const next = Math.max(0, Math.min(player.hand[r], s[r] + d));
      return { ...s, [r]: next };
    });
  };

  return (
    <Backdrop>
      <h2>Discard</h2>
      <div className="subtext">Rolled 7. Discard {required} of your {handTotal(player.hand)} cards.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {RESOURCES.map(r => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`card-chip ${r}`}><span className="dot" />{r}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{player.hand[r]}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="btn secondary" onClick={() => bump(r, -1)} disabled={sel[r] === 0}>−</button>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)', minWidth: 22, textAlign: 'center' }}>{sel[r]}</span>
              <button className="btn secondary" onClick={() => bump(r, +1)} disabled={sel[r] >= player.hand[r]}>+</button>
            </span>
          </div>
        ))}
      </div>
      <div className="modal-buttons">
        <button
          className="btn"
          disabled={selectedTotal !== required}
          onClick={() => onConfirm(sel)}
        >
          Confirm ({selectedTotal}/{required})
        </button>
      </div>
    </Backdrop>
  );
}

// ===== Steal victim =====

export interface StealVictimModalProps {
  readonly state: GameState;
  readonly candidates: readonly PlayerId[];
  readonly tile: string;
  readonly onPick: (victim: PlayerId | null) => void;
}

export function StealVictimModal(props: StealVictimModalProps): JSX.Element {
  const { state, candidates, onPick } = props;
  return (
    <Backdrop>
      <h2>Steal</h2>
      <div className="subtext">Choose a rival to steal a random card from.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {candidates.map(id => {
          const p = state.players[id]!;
          return (
            <button key={id} className="btn" onClick={() => onPick(id)} style={{ background: PLAYER_FILL[p.color] }}>
              {p.name}
            </button>
          );
        })}
        <button className="btn secondary" onClick={() => onPick(null)}>No one</button>
      </div>
    </Backdrop>
  );
}

// ===== Monopoly =====

export interface MonopolyModalProps {
  readonly onPick: (r: Resource) => void;
  readonly onCancel: () => void;
}

export function MonopolyModal(props: MonopolyModalProps): JSX.Element {
  const { onPick, onCancel } = props;
  return (
    <Backdrop>
      <h2>Monopoly</h2>
      <div className="subtext">Name a resource. All rivals give you every one they hold.</div>
      <div>
        {RESOURCES.map(r => (
          <span key={r} className={`card-chip selectable ${r}`} onClick={() => onPick(r)}>
            <span className="dot" /> {r}
          </span>
        ))}
      </div>
      <div className="modal-buttons">
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </Backdrop>
  );
}

// ===== Year of Plenty =====

export interface YearOfPlentyModalProps {
  readonly onPick: (a: Resource, b: Resource) => void;
  readonly onCancel: () => void;
}

export function YearOfPlentyModal(props: YearOfPlentyModalProps): JSX.Element {
  const { onPick, onCancel } = props;
  const [a, setA] = useState<Resource | null>(null);
  const [b, setB] = useState<Resource | null>(null);
  return (
    <Backdrop>
      <h2>Year of Plenty</h2>
      <div className="subtext">Take two resources from the bank.</div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>First</div>
        <div style={{ marginBottom: 8 }}>
          {RESOURCES.map(r => (
            <span key={r} className={`card-chip selectable ${r}`} style={a === r ? { background: 'rgba(217,119,6,0.2)', borderColor: 'var(--amber)' } : undefined} onClick={() => setA(r)}>
              <span className="dot" /> {r}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Second</div>
        <div>
          {RESOURCES.map(r => (
            <span key={r} className={`card-chip selectable ${r}`} style={b === r ? { background: 'rgba(217,119,6,0.2)', borderColor: 'var(--amber)' } : undefined} onClick={() => setB(r)}>
              <span className="dot" /> {r}
            </span>
          ))}
        </div>
      </div>
      <div className="modal-buttons">
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={!a || !b} onClick={() => { if (a && b) onPick(a, b); }}>Take</button>
      </div>
    </Backdrop>
  );
}

// ===== Bank trade =====

export interface BankTradeModalProps {
  readonly state: GameState;
  readonly humanId: PlayerId;
  readonly canDo: (a: Action) => Legality;
  readonly onConfirm: (give: Resource, getR: Resource) => void;
  readonly onCancel: () => void;
}

export function BankTradeModal(props: BankTradeModalProps): JSX.Element {
  const { state, humanId, canDo, onConfirm, onCancel } = props;
  const human = state.players[humanId]!;
  const ratios = useMemo(() => computeRatios(state, humanId), [state, humanId]);
  const [give, setGive] = useState<Resource | null>(null);
  const [getR, setGetR] = useState<Resource | null>(null);

  const ok = give !== null && getR !== null && give !== getR && canDo({ kind: 'TRADE_BANK', give, getR }).ok;

  return (
    <Backdrop>
      <h2>Bank Trade</h2>
      <div className="subtext">Give {give ? ratios[give] : '?'} for 1. Ports reduce the ratio.</div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Give</div>
        <div style={{ marginBottom: 8 }}>
          {RESOURCES.map(r => (
            <span
              key={r}
              className={`card-chip selectable ${r}`}
              style={give === r ? { background: 'rgba(217,119,6,0.2)', borderColor: 'var(--amber)' } : undefined}
              onClick={() => setGive(r)}
            >
              <span className="dot" /> {r} <span style={{ color: 'var(--text-2)' }}>{ratios[r]}:1</span> <span style={{ color: 'var(--amber)' }}>{human.hand[r]}</span>
            </span>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Get</div>
        <div>
          {RESOURCES.map(r => (
            <span
              key={r}
              className={`card-chip selectable ${r}`}
              style={getR === r ? { background: 'rgba(217,119,6,0.2)', borderColor: 'var(--amber)' } : undefined}
              onClick={() => setGetR(r)}
            >
              <span className="dot" /> {r}
            </span>
          ))}
        </div>
      </div>
      <div className="modal-buttons">
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={!ok} onClick={() => { if (give && getR) onConfirm(give, getR); }}>Trade</button>
      </div>
    </Backdrop>
  );
}

function computeRatios(state: GameState, playerId: PlayerId): Record<Resource, number> {
  const base: Record<Resource, number> = { wood: 4, brick: 4, wheat: 4, sheep: 4, ore: 4 };
  const owned = new Set<string>();
  for (const vId of Object.keys(state.pieces)) {
    const piece = state.pieces[vId];
    if (piece && piece.owner === playerId) owned.add(vId);
  }
  for (const port of state.board.ports) {
    const touches = port.vertices.some(v => owned.has(v));
    if (!touches) continue;
    if (port.kind === 'generic') {
      for (const r of RESOURCES) base[r] = Math.min(base[r], 3);
    } else {
      base[port.kind] = Math.min(base[port.kind], 2);
    }
  }
  return base;
}

// ===== Dev card play =====

export interface DevCardModalProps {
  readonly state: GameState;
  readonly humanId: PlayerId;
  readonly canDo: (a: Action) => Legality;
  readonly onPlayKnight: () => void;
  readonly onPlayRoadBuilding: () => void;
  readonly onPlayMonopoly: () => void;
  readonly onPlayYearOfPlenty: () => void;
  readonly onCancel: () => void;
}

export function DevCardModal(props: DevCardModalProps): JSX.Element {
  const { state, humanId, canDo, onPlayKnight, onPlayRoadBuilding, onPlayMonopoly, onPlayYearOfPlenty, onCancel } = props;
  const human = state.players[humanId]!;

  // Group unplayed, non-VP dev cards; dev can't be played on the turn it was bought.
  const playable = human.devCards.filter(d => !d.played && d.kind !== 'victoryPoint' && d.boughtOnTurn < state.turn);
  const counts = { knight: 0, roadBuilding: 0, monopoly: 0, yearOfPlenty: 0 };
  for (const d of playable) counts[d.kind as keyof typeof counts] += 1;

  const canKnight = counts.knight > 0 && canDo({ kind: 'PLAY_KNIGHT', tile: state.robberTile, victim: null }).ok;
  const canRB = counts.roadBuilding > 0 && canDo({ kind: 'PLAY_ROAD_BUILDING' }).ok;
  const canMonopoly = counts.monopoly > 0 && canDo({ kind: 'PLAY_MONOPOLY', resource: 'wood' }).ok;
  const canYoP = counts.yearOfPlenty > 0 && canDo({ kind: 'PLAY_YEAR_OF_PLENTY', resources: ['wood', 'wood'] }).ok;

  return (
    <Backdrop>
      <h2>Play Dev Card</h2>
      <div className="subtext">One per turn. Victory cards play themselves.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label={`Knight × ${counts.knight}`} hint="Move robber, steal." onClick={onPlayKnight} disabled={!canKnight} />
        <Row label={`Road Building × ${counts.roadBuilding}`} hint="Two free roads." onClick={onPlayRoadBuilding} disabled={!canRB} />
        <Row label={`Monopoly × ${counts.monopoly}`} hint="Take all of one resource." onClick={onPlayMonopoly} disabled={!canMonopoly} />
        <Row label={`Year of Plenty × ${counts.yearOfPlenty}`} hint="Take two from bank." onClick={onPlayYearOfPlenty} disabled={!canYoP} />
      </div>
      <div className="modal-buttons">
        <button className="btn secondary" onClick={onCancel}>Close</button>
      </div>
    </Backdrop>
  );
}

function Row(props: { label: string; hint: string; onClick: () => void; disabled: boolean }): JSX.Element {
  const { label, hint, onClick, disabled } = props;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{hint}</div>
      </div>
      <button className="btn" disabled={disabled} onClick={onClick}>Play</button>
    </div>
  );
}

// ===== Victory =====

export interface VictoryOverlayProps {
  readonly state: GameState;
  readonly winner: PlayerId;
  readonly onNewGame: () => void;
}

export function VictoryOverlay(props: VictoryOverlayProps): JSX.Element {
  const { state, winner, onNewGame } = props;
  const p = state.players[winner]!;
  return (
    <div id="victory-overlay">
      <div id="victory-panel">
        <div className="crown">Crowned</div>
        <div className="winner-color" style={{ background: PLAYER_FILL[p.color], color: PLAYER_FILL[p.color] }} />
        <h1>Hegemony Achieved</h1>
        <div className="meta">{p.name} · Turn {state.turn}</div>
        <button className="btn" onClick={onNewGame}>New Game</button>
      </div>
    </div>
  );
}
