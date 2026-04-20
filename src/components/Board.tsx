'use client';

// Board — SVG hex board. Stateless; all interaction goes through onAction.
// Pointy-top hexes, axial coords from src/game/board.ts (unit radius = 1).

import { useMemo } from 'react';
import type {
  Action,
  EdgeId,
  GameState,
  PlayerColor,
  PortKind,
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
  wood: '#2f6b2b',
  brick: '#b45309',
  wheat: '#d6a41a',
  sheep: '#94c42a',
  ore: '#6b7280',
  desert: '#c9a566',
};

const TERRAIN_EDGE: Record<string, string> = {
  wood: '#13330f',
  brick: '#5a2a05',
  wheat: '#7a5a0a',
  sheep: '#4c6a10',
  ore: '#2f3640',
  desert: '#7a5a26',
};

const TERRAIN_GLYPH: Record<string, string> = {
  wood: '\u{1F332}',   // evergreen tree
  brick: '\u{1F9F1}',  // brick
  wheat: '\u{1F33E}',  // sheaf of rice
  sheep: '\u{1F411}',  // sheep
  ore: '\u26F0\uFE0F', // mountain
  desert: '\u{1F335}', // cactus
};

const PLAYER_FILL: Record<PlayerColor, string> = {
  amber: '#d97706',
  crimson: '#dc2626',
  sapphire: '#2563eb',
  emerald: '#059669',
};

// Probability dots a la standard Catan tokens:
// 2,12 → 1 dot; 3,11 → 2; 4,10 → 3; 5,9 → 4; 6,8 → 5.
function probDots(n: number): number {
  return 6 - Math.abs(7 - n);
}

function portLabel(kind: PortKind): string {
  if (kind === 'generic') return '3:1';
  const code =
    kind === 'wood' ? 'WO' :
    kind === 'brick' ? 'BR' :
    kind === 'wheat' ? 'WH' :
    kind === 'sheep' ? 'SH' :
    /* ore */          'OR';
  return `2:1 ${code}`;
}

export function Board(props: BoardProps): JSX.Element {
  const { state, buildMode, onTileClick, onVertexClick, onEdgeClick, canDo } = props;
  const { board } = state;

  // Pre-compute tile centers once.
  const tileCenter = useMemo(() => {
    const out: Record<TileId, { x: number; y: number }> = {};
    for (const tId of board.tileOrder) {
      const t = board.tiles[tId];
      if (!t) continue;
      let x = 0, y = 0, n = 0;
      for (const vId of t.vertices) {
        const v = board.vertices[vId];
        if (!v) continue;
        x += v.x; y += v.y; n += 1;
      }
      out[tId] = n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
    }
    return out;
  }, [board]);

  // viewBox — vertex extents plus ocean padding so ports sit inside.
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
    const pad = 2.2; // space for the sea + harbor markers
    return {
      x: minX - pad,
      y: minY - pad,
      w: (maxX - minX) + pad * 2,
      h: (maxY - minY) + pad * 2,
      str: `${minX - pad} ${minY - pad} ${(maxX - minX) + pad * 2} ${(maxY - minY) + pad * 2}`,
    };
  }, [board]);

  const tilePoints = (tId: TileId): string => {
    const t = board.tiles[tId];
    if (!t) return '';
    const pts: string[] = [];
    for (const vId of t.vertices) {
      const v = board.vertices[vId];
      if (!v) continue;
      pts.push(`${v.x.toFixed(3)},${v.y.toFixed(3)}`);
    }
    return pts.join(' ');
  };

  // Port harbor — offset outward from the edge midpoint into the sea.
  const portPlacement = (portIdx: number): {
    hx: number; hy: number;   // harbor marker position
    ax: { x: number; y: number }; bx: { x: number; y: number }; // vertex endpoints
    mx: number; my: number;   // edge midpoint
    lx: number; ly: number;   // label position (further out)
  } | null => {
    const p = board.ports[portIdx];
    if (!p) return null;
    const va = board.vertices[p.vertices[0]];
    const vb = board.vertices[p.vertices[1]];
    if (!va || !vb) return null;
    const mx = (va.x + vb.x) / 2;
    const my = (va.y + vb.y) / 2;

    // Find coastal tile for this port edge, offset away from its center.
    let cx = 0, cy = 0;
    for (const tId of board.tileOrder) {
      const t = board.tiles[tId];
      if (!t) continue;
      if (t.vertices.includes(p.vertices[0]) && t.vertices.includes(p.vertices[1])) {
        cx = tileCenter[tId]?.x ?? 0;
        cy = tileCenter[tId]?.y ?? 0;
        break;
      }
    }
    const dx = mx - cx, dy = my - cy;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const HARBOR_OFFSET = 0.85;
    const LABEL_OFFSET = 1.35;
    return {
      hx: mx + ux * HARBOR_OFFSET,
      hy: my + uy * HARBOR_OFFSET,
      ax: { x: va.x, y: va.y },
      bx: { x: vb.x, y: vb.y },
      mx, my,
      lx: mx + ux * LABEL_OFFSET,
      ly: my + uy * LABEL_OFFSET,
    };
  };

  const phase = state.phase;

  const vertexActive =
    phase === 'SETUP_1_SETTLEMENT' || phase === 'SETUP_2_SETTLEMENT' ||
    (phase === 'ACTION' && (buildMode === 'settlement' || buildMode === 'city'));
  const edgeActive =
    phase === 'SETUP_1_ROAD' || phase === 'SETUP_2_ROAD' ||
    phase === 'ROAD_BUILDING_1' || phase === 'ROAD_BUILDING_2' ||
    (phase === 'ACTION' && buildMode === 'road');
  const tileActive =
    phase === 'MOVE_ROBBER' || (phase === 'ACTION' && buildMode === 'knight');

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
    <svg id="map-svg" viewBox={view.str} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="ocean" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#143a5c" />
          <stop offset="100%" stopColor="#081a2e" />
        </radialGradient>
        <radialGradient id="tileShade" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.14)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.28)" />
        </radialGradient>
        <filter id="tokenShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.04" stdDeviation="0.05" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Ocean backdrop */}
      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#ocean)" />

      {/* Coastline halo — a soft amber glow under the island */}
      <g className="coast">
        {board.tileOrder.map(tId => (
          <polygon
            key={`coast-${tId}`}
            points={tilePoints(tId)}
            fill="rgba(217,119,6,0.18)"
            stroke="rgba(217,119,6,0.35)"
            strokeWidth={0.28}
            strokeLinejoin="round"
            paintOrder="stroke fill"
          />
        ))}
      </g>

      {/* Tiles */}
      <g>
        {board.tileOrder.map(tId => {
          const t = board.tiles[tId];
          if (!t) return null;
          const robbed = state.robberTile === tId;
          const fill = TERRAIN_FILL[t.terrain] ?? '#333';
          const edge = TERRAIN_EDGE[t.terrain] ?? '#000';
          return (
            <g key={`tile-${tId}`} className={`tile${robbed ? ' robbed' : ''}`}>
              <polygon
                className="tile-poly"
                points={tilePoints(tId)}
                fill={fill}
                stroke={edge}
                strokeWidth={0.04}
                strokeLinejoin="round"
              />
              <polygon
                className="tile-shade"
                points={tilePoints(tId)}
                fill="url(#tileShade)"
                stroke="none"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </g>

      {/* Terrain glyphs (subtle) */}
      <g className="terrain-glyphs">
        {board.tileOrder.map(tId => {
          const t = board.tiles[tId];
          if (!t) return null;
          const c = tileCenter[tId] ?? { x: 0, y: 0 };
          const glyph = TERRAIN_GLYPH[t.terrain] ?? '';
          // Shift glyph up so the number token sits below it cleanly.
          return (
            <text
              key={`glyph-${tId}`}
              className="terrain-glyph"
              x={c.x}
              y={c.y - 0.35}
              fontSize={0.6}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ pointerEvents: 'none', opacity: 0.75 }}
            >
              {glyph}
            </text>
          );
        })}
      </g>

      {/* Number tokens */}
      <g>
        {board.tileOrder.map(tId => {
          const t = board.tiles[tId];
          if (!t || t.number === null) return null;
          const c = tileCenter[tId] ?? { x: 0, y: 0 };
          const n = t.number;
          const hot = n === 6 || n === 8;
          const dots = probDots(n);
          const cy = c.y + 0.18;
          return (
            <g key={`num-${tId}`} filter="url(#tokenShadow)">
              <circle cx={c.x} cy={cy} r={0.42} fill="#f6ecd4" stroke="#2a1b07" strokeWidth={0.035} />
              <circle cx={c.x} cy={cy} r={0.36} fill="none" stroke="rgba(42,27,7,0.22)" strokeWidth={0.01} />
              <text
                x={c.x}
                y={cy - 0.06}
                className={`hex-label${hot ? ' red' : ''}`}
                style={{ fontSize: '0.44px', fill: hot ? '#b91c1c' : '#1a1209', stroke: 'none', fontWeight: 800 }}
              >
                {n}
              </text>
              {/* Probability dots */}
              <g>
                {Array.from({ length: dots }).map((_, i) => {
                  const spacing = 0.08;
                  const x = c.x + (i - (dots - 1) / 2) * spacing;
                  return (
                    <circle
                      key={`dot-${tId}-${i}`}
                      cx={x}
                      cy={cy + 0.22}
                      r={0.025}
                      fill={hot ? '#b91c1c' : '#1a1209'}
                    />
                  );
                })}
              </g>
            </g>
          );
        })}
      </g>

      {/* Ports */}
      <g className="ports">
        {board.ports.map((p, i) => {
          const place = portPlacement(i);
          if (!place) return null;
          return (
            <g key={`port-${i}`}>
              <line
                x1={place.ax.x} y1={place.ax.y} x2={place.hx} y2={place.hy}
                stroke="rgba(245,236,212,0.55)" strokeWidth={0.04} strokeDasharray="0.12 0.08" strokeLinecap="round"
              />
              <line
                x1={place.bx.x} y1={place.bx.y} x2={place.hx} y2={place.hy}
                stroke="rgba(245,236,212,0.55)" strokeWidth={0.04} strokeDasharray="0.12 0.08" strokeLinecap="round"
              />
              <circle
                className="port-dot"
                cx={place.hx} cy={place.hy} r={0.28}
                fill={p.kind === 'generic' ? 'rgba(217,119,6,0.9)' : portResourceFill(p.kind)}
                stroke="#f6ecd4"
                strokeWidth={0.045}
              />
              <text
                className="port-label"
                x={place.hx} y={place.hy + 0.015}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ fontSize: '0.16px', fill: '#0a1628', fontWeight: 700 }}
              >
                {portLabel(p.kind)}
              </text>
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
                style={legal ? { fill: 'rgba(217,119,6,0.18)' } : undefined}
              />
            );
          })}
        </g>
      )}

      {/* Roads */}
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
              strokeWidth={0.18}
              strokeLinecap="round"
            />
          );
        })}
      </g>

      {/* Edge hit-areas */}
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
                stroke={legal ? 'rgba(217,119,6,0.28)' : 'transparent'}
                onClick={legal ? () => onEdgeClick(eId) : undefined}
              />
            );
          })}
        </g>
      )}

      {/* Vertex pieces */}
      <g>
        {board.vertexOrder.map(vId => {
          const piece = state.pieces[vId];
          if (!piece) return null;
          const v = board.vertices[vId];
          if (!v) return null;
          const color = PLAYER_FILL[state.players[piece.owner]!.color];
          if (piece.kind === 'settlement') {
            const s = 0.28;
            return (
              <rect
                key={`piece-${vId}`}
                className="vertex-marker"
                x={v.x - s / 2} y={v.y - s / 2} width={s} height={s}
                fill={color} stroke="#0a0a0a" strokeWidth={0.03} rx={0.03}
              />
            );
          }
          const s = 0.42;
          return (
            <rect
              key={`piece-${vId}`}
              className="vertex-marker"
              x={v.x - s / 2} y={v.y - s / 2} width={s} height={s}
              fill={color} stroke="#fff" strokeWidth={0.05} rx={0.05}
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
                fill={legal ? 'rgba(217,119,6,0.34)' : 'transparent'}
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
          const c = tileCenter[state.robberTile] ?? { x: 0, y: 0 };
          return (
            <g key="robber" className="robber-group" filter="url(#tokenShadow)">
              <circle cx={c.x + 0.48} cy={c.y - 0.2} r={0.22} fill="#0a0a0a" stroke="#d97706" strokeWidth={0.05} />
            </g>
          );
        })()}
      </g>
    </svg>
  );
}

function portResourceFill(kind: PortKind): string {
  switch (kind) {
    case 'wood':  return '#2f6b2b';
    case 'brick': return '#b45309';
    case 'wheat': return '#d6a41a';
    case 'sheep': return '#94c42a';
    case 'ore':   return '#6b7280';
    default:      return '#d97706';
  }
}
