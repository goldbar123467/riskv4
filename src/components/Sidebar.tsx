'use client';

// Sidebar — phase, roster, hand, dice, controls.

import type {
  Action,
  GameState,
  Legality,
  Player,
  PlayerColor,
} from '@/game/types';
import { RESOURCES, playerVP } from '@/game/types';

type BuildMode = 'road' | 'settlement' | 'city' | 'knight' | null;

const PLAYER_FILL: Record<PlayerColor, string> = {
  amber: '#d97706',
  crimson: '#dc2626',
  sapphire: '#2563eb',
  emerald: '#059669',
};

const PHASE_LABELS: Record<string, string> = {
  SETUP_1_SETTLEMENT: 'Place Settlement',
  SETUP_1_ROAD: 'Place Road',
  SETUP_2_SETTLEMENT: 'Place Settlement',
  SETUP_2_ROAD: 'Place Road',
  ROLL: 'Roll Dice',
  DISCARD: 'Discard',
  MOVE_ROBBER: 'Move Robber',
  STEAL: 'Steal',
  ACTION: 'Your Turn',
  ROAD_BUILDING_1: 'Road Building',
  ROAD_BUILDING_2: 'Road Building',
  GAME_OVER: 'Game Over',
};

const MOOD_GLYPH: Record<string, string> = {
  serene: '~',
  content: '·',
  confident: '^',
  ascendant: '↑',
  anxious: '?',
  thwarted: '×',
  furious: '!',
  triumphant: '★',
};

export interface SidebarProps {
  readonly state: GameState;
  readonly humanId: number;
  readonly buildMode: BuildMode;
  readonly setBuildMode: (m: BuildMode) => void;
  readonly canDo: (a: Action) => Legality;
  readonly dispatch: (a: Action) => void;
  readonly onNewGame: () => void;
  readonly onSave: () => void;
  readonly onOpenBankTrade: () => void;
  readonly onOpenDevPlay: () => void;
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const {
    state, humanId, buildMode, setBuildMode,
    canDo, dispatch, onNewGame, onSave,
    onOpenBankTrade, onOpenDevPlay,
  } = props;

  const human = state.players[humanId];
  const active = state.players[state.currentPlayer];
  const isHumanTurn = state.currentPlayer === humanId;
  const phaseLabel = PHASE_LABELS[state.phase] ?? state.phase;
  const help = phaseHelp(state, humanId);

  return (
    <div id="sidebar">
      <div id="game-title">CATAN</div>

      <div className="panel-section">
        <div className="turn-info">
          <span className="swatch" style={{ background: PLAYER_FILL[active!.color] }} />
          <span style={{ fontWeight: 600 }}>{active!.name}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
            T{state.turn}
          </span>
        </div>
        <div className="phase-label" style={{ marginTop: 10, color: isHumanTurn ? 'var(--amber)' : 'var(--text-1)' }}>
          {phaseLabel}
        </div>
        <div className="phase-help">{help}</div>
      </div>

      {state.dice && (
        <div className="panel-section">
          <div className="dice-row">
            <div className="die">{state.dice.a}</div>
            <div className="die">{state.dice.b}</div>
            <div className="die" style={{ borderStyle: 'dashed' }}>{state.dice.sum}</div>
          </div>
        </div>
      )}

      <div className="panel-section">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {state.players.map(p => (
            <RosterRow key={p.id} state={state} player={p} active={p.id === state.currentPlayer} />
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Your hand</div>
        <div>
          {RESOURCES.map(r => (
            <span key={r} className={`card-chip ${r}`}>
              <span className="dot" />
              {r} <span style={{ color: 'var(--amber)' }}>{human!.hand[r]}</span>
            </span>
          ))}
        </div>
        {human!.devCards.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Dev cards</div>
            <div>
              {human!.devCards.map((d, i) => (
                <span key={i} className="card-chip" style={{ borderColor: d.played ? 'rgba(255,255,255,0.08)' : 'var(--amber)' }}>
                  {devLabel(d.kind)}{d.played ? ' ·' : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="panel-section">
        <Controls
          state={state}
          isHumanTurn={isHumanTurn}
          buildMode={buildMode}
          setBuildMode={setBuildMode}
          canDo={canDo}
          dispatch={dispatch}
          onOpenBankTrade={onOpenBankTrade}
          onOpenDevPlay={onOpenDevPlay}
        />
      </div>

      <div id="log-section" className="panel-section" style={{ flex: 1, overflow: 'hidden' }}>
        <LogInline state={state} />
      </div>

      <div className="panel-section">
        <button className="btn secondary" onClick={onSave}>Save</button>
        <button className="btn" onClick={onNewGame}>New Game</button>
      </div>
    </div>
  );
}

function phaseHelp(state: GameState, humanId: number): string {
  const isHuman = state.currentPlayer === humanId;
  if (state.winner !== null) return 'The game has ended.';
  switch (state.phase) {
    case 'SETUP_1_SETTLEMENT':
    case 'SETUP_2_SETTLEMENT':
      return isHuman ? 'Click a highlighted vertex.' : 'Opponent is placing.';
    case 'SETUP_1_ROAD':
    case 'SETUP_2_ROAD':
      return isHuman ? 'Click a highlighted edge.' : 'Opponent is placing.';
    case 'ROLL':
      return isHuman ? 'Roll to begin your turn.' : 'Opponent about to roll.';
    case 'DISCARD': {
      const mine = state.pendingDiscards.find(d => d.playerId === humanId);
      if (mine) return `Discard ${mine.count} cards.`;
      return 'Opponents are discarding.';
    }
    case 'MOVE_ROBBER':
      return isHuman ? 'Click a tile to move the robber.' : 'Opponent moves the robber.';
    case 'STEAL':
      return 'Choosing a victim.';
    case 'ACTION':
      return isHuman ? 'Build, trade, or end turn.' : 'Opponent is acting.';
    case 'ROAD_BUILDING_1':
    case 'ROAD_BUILDING_2':
      return isHuman ? 'Place a free road.' : 'Opponent building roads.';
    case 'GAME_OVER':
      return 'The game has ended.';
    default:
      return '';
  }
}

function devLabel(kind: string): string {
  switch (kind) {
    case 'knight': return 'Knight';
    case 'victoryPoint': return 'VP';
    case 'roadBuilding': return 'Road Bldg';
    case 'monopoly': return 'Monopoly';
    case 'yearOfPlenty': return 'Yr Plenty';
    default: return kind;
  }
}

function RosterRow(props: { state: GameState; player: Player; active: boolean }): JSX.Element {
  const { state, player, active } = props;
  const vpFull = playerVP(state, player);
  // Hide private VP-cards for AIs (public VP only).
  const hiddenVP = player.isAI ? player.devCards.filter(d => d.kind === 'victoryPoint' && !d.played).length : 0;
  const vp = vpFull - hiddenVP;
  const cards = player.hand.wood + player.hand.brick + player.hand.wheat + player.hand.sheep + player.hand.ore;
  const mood = MOOD_GLYPH[player.mood] ?? '·';
  return (
    <div className={`roster-row${active ? ' active' : ''}`}>
      <span className="swatch" style={{ background: PLAYER_FILL[player.color] }} />
      <span className="name">{player.name}</span>
      <span className="vp">{vp}</span>
      <span className="cards">{cards}c</span>
      <span className="mood-chip" title={player.mood} style={{ color: 'var(--amber)' }}>{mood}</span>
    </div>
  );
}

function Controls(props: {
  state: GameState;
  isHumanTurn: boolean;
  buildMode: BuildMode;
  setBuildMode: (m: BuildMode) => void;
  canDo: (a: Action) => Legality;
  dispatch: (a: Action) => void;
  onOpenBankTrade: () => void;
  onOpenDevPlay: () => void;
}): JSX.Element {
  const { state, isHumanTurn, buildMode, setBuildMode, canDo, dispatch, onOpenBankTrade, onOpenDevPlay } = props;
  const phase = state.phase;

  if (phase.startsWith('SETUP_')) {
    return <div className="phase-help">Click the board to place.</div>;
  }

  if (phase === 'ROLL' && isHumanTurn) {
    const legal = canDo({ kind: 'ROLL' });
    return <button className="btn full" disabled={!legal.ok} onClick={() => dispatch({ kind: 'ROLL' })}>Roll dice</button>;
  }

  if (phase === 'MOVE_ROBBER' && isHumanTurn) {
    return <div className="phase-help">Click a tile to place the robber.</div>;
  }

  if ((phase === 'ROAD_BUILDING_1' || phase === 'ROAD_BUILDING_2') && isHumanTurn) {
    return <div className="phase-help">Click an edge for your free road.</div>;
  }

  if (phase === 'ACTION' && isHumanTurn) {
    const me = state.players[state.currentPlayer]!;
    const canPayRoad = me.hand.wood >= 1 && me.hand.brick >= 1;
    const canPaySettlement = me.hand.wood >= 1 && me.hand.brick >= 1 && me.hand.wheat >= 1 && me.hand.sheep >= 1;
    const canPayCity = me.hand.wheat >= 2 && me.hand.ore >= 3;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <button
          className={`btn${buildMode === 'road' ? '' : ' secondary'}`}
          disabled={!canPayRoad}
          onClick={() => setBuildMode(buildMode === 'road' ? null : 'road')}
        >Build Road</button>
        <button
          className={`btn${buildMode === 'settlement' ? '' : ' secondary'}`}
          disabled={!canPaySettlement}
          onClick={() => setBuildMode(buildMode === 'settlement' ? null : 'settlement')}
        >Build Settlement</button>
        <button
          className={`btn${buildMode === 'city' ? '' : ' secondary'}`}
          disabled={!canPayCity}
          onClick={() => setBuildMode(buildMode === 'city' ? null : 'city')}
        >Build City</button>
        <button
          className="btn secondary"
          disabled={!canDo({ kind: 'BUY_DEV_CARD' }).ok}
          onClick={() => dispatch({ kind: 'BUY_DEV_CARD' })}
        >Buy Dev Card</button>
        <button className="btn secondary" onClick={onOpenBankTrade}>Bank Trade…</button>
        <button className="btn secondary" onClick={onOpenDevPlay}>Play Dev…</button>
        <button
          className="btn danger"
          disabled={!canDo({ kind: 'END_TURN' }).ok}
          onClick={() => { setBuildMode(null); dispatch({ kind: 'END_TURN' }); }}
        >End Turn</button>
      </div>
    );
  }

  return <div className="phase-help">Waiting…</div>;
}

// Small inline log — shown in the sidebar flex area.
function LogInline(props: { state: GameState }): JSX.Element {
  const { state } = props;
  const recent = state.log.slice().reverse().slice(0, 60);
  return (
    <>
      <div className="section-title" style={{ fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>Log</div>
      <div id="log-list" style={{ flex: 1, overflowY: 'auto' }}>
        {recent.map(entry => {
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
    </>
  );
}
