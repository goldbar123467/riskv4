'use client';

// Board — SVG hex board. Stateless; all interaction goes through onAction.

import { useMemo } from 'react';
import type {
  Action,
  EdgeId,
  GameState,
  PlayerColor,
  TileId,
  VertexId,
} from '@/game/types';

type BuildMode = 'road' | 'settlement' | 'city' | 'knight' | null;

export interface BoardProps {
  readonly state: GameState;
  readonly buildMode: BuildMode;
  readonly onTileClick: (tile: TileId) => void;
  readonly onVertexClick: (vertex: VertexId) => void;
  readonly onEdgeClick: (edge: EdgeId) => void;
  readonly canDo: (a: Action) => { ok: boolean; reason?: string };
}

const TERRAIN_FILL: Record<string, string> = {
  wood: '#166534',
  brick: '#b45309',
  wheat: '#ca8a04',
  sheep: '#84cc16',
  ore: '#64748b',
  desert: '#78716c',
};

const PLAYER_FILL: Record<PlayerColor, string> = {
  amber: '#d97706',
  crimson: '#dc2626',
  sapphire: '#2563eb',
  emerald: '#059669',
};

export function Board(props: BoardProps): JSX.Element {
  const { state, buildMode, onTileClick, onVertexClick, onEdgeClick, canDo } = props;
  const { board } = state;

  // Compute viewBox from vertex extents with padding.
  const view = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of board.vertexOrder) {
      const v = board.vertices[id];
      if (!v) continue;
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    if (!isFinite(minX)) { minX = -6; minY = -6; maxX = 6; maxY = 6; }
    const pad = 1.2;
    const x = minX - pad;
    const y = minY - pad;
    const w = (maxX - minX) + pad * 2;
    const h = (maxY - minY) + pad * 2;
    return `${x} ${y} ${w} ${h}`;
  }, [board]);

  // Tile polygon points — take the six vertex positions of each tile.
  const tilePoints = (tileId: TileId): string => {
    const t = board.tiles[tileId];
    if (!t) return '';
    const pts: string[] = [];
    for (const vId of t.vertices) {
      const v = board.vertices[vId];
      if (!v) continue;
      pts.push(`${v.x.toFixed(3)},${v.y.toFixed(3)}`);
    }
    return pts.join(' ');
  };

  const tileCenter = (tileId: TileId): { x: number; y: number } => {
    const t = board.tiles[tileId];
    if (!t) return { x: 0, y: 0 };
    let x = 0, y = 0, n = 0;
    for (const vId of t.vertices) {
      const v = board.vertices[vId];
      if (!v) continue;
      x += v.x; y += v.y; n += 1;
    }
    return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
  };

  const phase = state.phase;

  // What kind of interaction is live right now?
  const vertexActive =
    phase === 'SETUP_1_SETTLEMENT' || phase === 'SETUP_2_SETTLEMENT' ||
    (phase === 'ACTION' && (buildMode === 'settlement' || buildMode === 'city'));
  const edgeActive =
    phase === 'SETUP_1_ROAD' || phase === 'SETUP_2_ROAD' ||
    phase === 'ROAD_BUILDING_1' || phase === 'ROAD_BUILDING_2' ||
    (phase === 'ACTION' && buildMode === 'road');
  const tileActive =
    phase === 'MOVE_ROBBER' || (phase === 'ACTION' && buildMode === 'knight');

  // Pre-compute legality for each potential target (only if mode is live).
  const vertexLegal = (vId: VertexId): boolean => {
    if (!vertexActive) return false;
    if (phase === 'SETUP_1_SETTLEMENT' || phase === 'SETUP_2_SETTLEMENT') {
      return canDo({ kind: 'BUILD_SETTLEMENT', vertex: vId }).ok;
    }
    if (buildMode === 'settlement') return canDo({ kind: 'BUILD_SETTLEMENT', vertex: vId }).ok;
    if (buildMode === 'city') return canDo({ kind: 'BUILD_CITY', vertex: vId }).ok;
    return false;
  };
  const edgeLegal = (eId: EdgeId): boolean => {
    if (!edgeActive) return false;
    return canDo({ kind: 'BUILD_ROAD', edge: eId }).ok;
  };
  const tileLegal = (tId: TileId): boolean => {
    if (!tileActive) return false;
    if (phase === 'MOVE_ROBBER') return canDo({ kind: 'MOVE_ROBBER', tile: tId, victim: null }).ok;
    if (buildMode === 'knight') return canDo({ kind: 'PLAY_KNIGHT', tile: tId, victim: null }).ok;
    return false;
  };

  return (
    <svg id="map-svg" viewBox={view} preserveAspectRatio="xMidYMid meet">
      {/* Tiles */}
      <g>
        {board.tileOrder.map(tId => {
          const t = board.tiles[tId];
          if (!t) return null;
          const robbed = state.robberTile === tId;
          const fill = TERRAIN_FILL[t.terrain] ?? '#333';
          return (
            <polygon
              key={`tile-${tId}`}
              className={`tile-poly${robbed ? ' robbed' : ''}`}
              points={tilePoints(tId)}
              fill={fill}
            />
          );
        })}
      </g>

      {/* Number tokens */}
      <g>
        {board.tileOrder.map(tId => {
          const t = board.tiles[tId];
          if (!t || t.number === null) return null;
          const c = tileCenter(tId);
          const hot = t.number === 6 || t.number === 8;
          return (
            <g key={`num-${tId}`}>
              <circle cx={c.x} cy={c.y} r={0.32} fill="rgba(245, 235, 215, 0.92)" stroke="rgba(0,0,0,0.4)" strokeWidth={0.03} />
              <text x={c.x} y={c.y} className={`hex-label${hot ? ' red' : ''}`} style={{ fontSize: '0.42px', fill: hot ? '#b91c1c' : '#0a1628', stroke: 'none' }}>
                {t.number}
              </text>
            </g>
          );
        })}
      </g>

      {/* Ports */}
      <g>
        {board.ports.map((p, i) => {
          const va = board.vertices[p.vertices[0]];
          const vb = board.vertices[p.vertices[1]];
          if (!va || !vb) return null;
          const mx = (va.x + vb.x) / 2;
          const my = (va.y + vb.y) / 2;
          const label = p.kind === 'generic' ? '3:1' : `2:1 ${shortRes(p.kind)}`;
          return (
            <g key={`port-${i}`}>
              <line x1={va.x} y1={va.y} x2={mx} y2={my} stroke="rgba(217,119,6,0.5)" strokeWidth={0.04} strokeDasharray="0.1 0.1" />
              <line x1={vb.x} y1={vb.y} x2={mx} y2={my} stroke="rgba(217,119,6,0.5)" strokeWidth={0.04} strokeDasharray="0.1 0.1" />
              <circle className="port-dot" cx={mx} cy={my} r={0.2} />
              <text className="port-label" x={mx} y={my + 0.02} style={{ fontSize: '0.18px' }}>{label}</text>
            </g>
          );
        })}
      </g>

      {/* Tile click hit-areas (robber / knight) */}
      {tileActive && (
        <g>
          {board.tileOrder.map(tId => {
            const legal = tileLegal(tId);
            return (
              <polygon
                key={`tileClick-${tId}`}
                className="tile-click"
                points={tilePoints(tId)}
                onClick={legal ? () => onTileClick(tId) : undefined}
                style={legal ? { fill: 'rgba(217,119,6,0.12)' } : undefined}
              />
            );
          })}
        </g>
      )}

      {/* Edges (roads) — render all committed roads */}
      <g>
        {board.edgeOrder.map(eId => {
          const owner = state.roads[eId];
          if (owner === undefined || owner === null) return null;
          const e = board.edges[eId];
          if (!e) return null;
          const a = board.vertices[e.a];
          const b = board.vertices[e.b];
          if (!a || !b) return null;
          const color = PLAYER_FILL[state.players[owner]!.color];
          return (
            <line
              key={`road-${eId}`}
              className="edge-road"
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={color}
            />
          );
        })}
      </g>

      {/* Edge hit-areas (for building roads) */}
      {edgeActive && (
        <g>
          {board.edgeOrder.map(eId => {
            const e = board.edges[eId];
            if (!e) return null;
            const a = board.vertices[e.a];
            const b = board.vertices[e.b];
            if (!a || !b) return null;
            const legal = edgeLegal(eId);
            return (
              <line
                key={`edgeHit-${eId}`}
                className={`edge-hit${legal ? ' clickable' : ''}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                strokeWidth={0.22}
                stroke={legal ? 'rgba(217,119,6,0.25)' : 'transparent'}
                onClick={legal ? () => onEdgeClick(eId) : undefined}
              />
            );
          })}
        </g>
      )}

      {/* Vertex pieces (settlements + cities) */}
      <g>
        {board.vertexOrder.map(vId => {
          const piece = state.pieces[vId];
          if (!piece) return null;
          const v = board.vertices[vId];
          if (!v) return null;
          const color = PLAYER_FILL[state.players[piece.owner]!.color];
          if (piece.kind === 'settlement') {
            const s = 0.26;
            return (
              <rect
                key={`piece-${vId}`}
                className="vertex-marker"
                x={v.x - s / 2} y={v.y - s / 2} width={s} height={s}
                fill={color} rx={0.03}
              />
            );
          }
          const s = 0.36;
          return (
            <rect
              key={`piece-${vId}`}
              className="vertex-marker"
              x={v.x - s / 2} y={v.y - s / 2} width={s} height={s}
              fill={color} stroke="#fff" strokeWidth={0.04} rx={0.04}
            />
          );
        })}
      </g>

      {/* Vertex hit-areas */}
      {vertexActive && (
        <g>
          {board.vertexOrder.map(vId => {
            const v = board.vertices[vId];
            if (!v) return null;
            const legal = vertexLegal(vId);
            return (
              <circle
                key={`vHit-${vId}`}
                className={`vertex-hit${legal ? ' clickable' : ''}`}
                cx={v.x} cy={v.y} r={0.28}
                fill={legal ? 'rgba(217,119,6,0.3)' : 'transparent'}
                onClick={legal ? () => onVertexClick(vId) : undefined}
              />
            );
          })}
        </g>
      )}

      {/* Robber */}
      <g>
        {(() => {
          const t = board.tiles[state.robberTile];
          if (!t) return null;
          const c = tileCenter(state.robberTile);
          return (
            <circle
              key="robber"
              className="robber"
              cx={c.x} cy={c.y - 0.55} r={0.22}
            />
          );
        })()}
      </g>
    </svg>
  );
}

function shortRes(kind: string): string {
  if (kind === 'generic') return '';
  return kind.slice(0, 2).toUpperCase();
}
