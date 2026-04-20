// Hex geometry + standard 19-tile Catan board construction.
// Unit hex radius = 1. Pixel math rounds happen in the UI layer.

import type {
  Axial,
  Board,
  Edge,
  EdgeId,
  GameState,
  PlayerId,
  Port,
  PortKind,
  Resource,
  Terrain,
  Tile,
  TileId,
  Vertex,
  VertexId,
} from '@/game/types';
import { makeRng, shuffle } from '@/lib/random';

// ---------- Axial helpers ----------

export function tileId(a: Axial): TileId {
  return `T:${a.x},${a.z}`;
}

// Pointy-top hex: neighbors in axial go in 6 directions indexed 0..5.
// Direction 0 is east, increasing clockwise.
const AXIAL_DIRS: readonly Axial[] = [
  { x: +1, z: 0 },   // 0 E
  { x: +1, z: -1 },  // 1 NE
  { x: 0,  z: -1 },  // 2 NW
  { x: -1, z: 0 },   // 3 W
  { x: -1, z: +1 },  // 4 SW
  { x: 0,  z: +1 },  // 5 SE
];

function neighbor(a: Axial, dir: number): Axial {
  const d = AXIAL_DIRS[((dir % 6) + 6) % 6]!;
  return { x: a.x + d.x, z: a.z + d.z };
}

// ---------- Canonical IDs ----------

// Vertex N (0..5) is the corner between side N-1 and side N going clockwise.
// A vertex is shared by up to 3 tiles. To get a single stable id we pick
// the canonical (tile, corner) tuple deterministically.

function cmpAxial(a: Axial, b: Axial): number {
  return a.x - b.x || a.z - b.z;
}

// Each corner touches 3 tiles. Return the 3 (tile, cornerIndex) tuples.
function cornerTouching(a: Axial, corner: number): Array<{ a: Axial; c: number }> {
  // Corner c of tile sits at the meeting of tiles: self, neighbor(dir c-1), neighbor(dir c).
  const c = ((corner % 6) + 6) % 6;
  const d1 = (c + 5) % 6; // c - 1
  const d2 = c;
  const n1 = neighbor(a, d1);
  const n2 = neighbor(a, d2);
  // The same corner index on each of the three tiles differs; compute from position.
  // Corner c on tile A equals corner (c+2)%6 on neighbor via d1, and (c+4)%6 on neighbor via d2.
  return [
    { a, c },
    { a: n1, c: (c + 2) % 6 },
    { a: n2, c: (c + 4) % 6 },
  ];
}

// Each edge touches 2 tiles. Return both (tile, sideIndex) tuples.
function edgeTouching(a: Axial, side: number): Array<{ a: Axial; s: number }> {
  const s = ((side % 6) + 6) % 6;
  const n = neighbor(a, s);
  // Side s on tile A equals side (s+3)%6 on the neighbor.
  return [
    { a, s },
    { a: n, s: (s + 3) % 6 },
  ];
}

function canonicalCorner(a: Axial, corner: number): { a: Axial; c: number } {
  const opts = cornerTouching(a, corner);
  let best = opts[0]!;
  for (const o of opts) if (cmpAxial(o.a, best.a) < 0) best = o;
  return best;
}

function canonicalSide(a: Axial, side: number): { a: Axial; s: number } {
  const [x, y] = edgeTouching(a, side);
  return cmpAxial(x!.a, y!.a) <= 0 ? x! : y!;
}

export function vertexId(a: Axial, corner: number): VertexId {
  const { a: ca, c } = canonicalCorner(a, corner);
  return `V:${ca.x},${ca.z},${c}`;
}

export function edgeId(a: Axial, side: number): EdgeId {
  const { a: ca, s } = canonicalSide(a, side);
  return `E:${ca.x},${ca.z},${s}`;
}

// ---------- Pixel math (unit radius) ----------

export function axialToPixel(a: Axial, size: number): { x: number; y: number } {
  // Pointy-top layout.
  const x = size * Math.sqrt(3) * (a.x + a.z / 2);
  const y = size * (3 / 2) * a.z;
  return { x, y };
}

// Corner c of a unit-radius tile at (0,0). Pointy-top, starting at the top corner (c=0).
function cornerOffset(corner: number, size: number): { x: number; y: number } {
  const c = ((corner % 6) + 6) % 6;
  // Angles: 30, 90, 150, 210, 270, 330 (in degrees from +x)?
  // For pointy-top, corners sit at 90, 150, 210, 270, 330, 30. We start c=0 at the top.
  const angle = (Math.PI / 180) * (90 - 60 * c);
  return { x: size * Math.cos(angle), y: -size * Math.sin(angle) };
}

export function tileCorners(a: Axial, size = 1): Array<{ x: number; y: number }> {
  const center = axialToPixel(a, size);
  const out: Array<{ x: number; y: number }> = [];
  for (let c = 0; c < 6; c++) {
    const o = cornerOffset(c, size);
    out.push({ x: center.x + o.x, y: center.y + o.y });
  }
  return out;
}

// ---------- Standard board construction ----------

// The classic Catan layout is 3/4/5/4/3 hex rows. Using axial, we lay out
// concentric rings: center + ring 1 (6) + ring 2 (12) = 19 tiles.
const STANDARD_AXIALS: readonly Axial[] = buildStandardAxials();

function buildStandardAxials(): Axial[] {
  const out: Axial[] = [{ x: 0, z: 0 }];
  for (let ring = 1; ring <= 2; ring++) {
    let hex: Axial = { x: -ring, z: ring }; // start at the SW ring corner
    for (let dir = 0; dir < 6; dir++) {
      for (let i = 0; i < ring; i++) {
        out.push(hex);
        hex = neighbor(hex, dir);
      }
    }
  }
  return out;
}

// Canonical 9-port kind sequence laid clockwise around the coast.
// 4 generic (3:1) + 5 specific (2:1). The *edges* are picked dynamically
// from the actual coastline so ports always sit on real outer edges.
const PORT_KIND_SEQUENCE: readonly PortKind[] = [
  'generic', 'wheat',  'ore',
  'generic', 'sheep',  'generic',
  'brick',   'generic','wood',
];

// Standard terrain multiset: 4 wood, 4 wheat, 4 sheep, 3 brick, 3 ore, 1 desert.
const TERRAIN_POOL: readonly Terrain[] = [
  'wood','wood','wood','wood',
  'wheat','wheat','wheat','wheat',
  'sheep','sheep','sheep','sheep',
  'brick','brick','brick',
  'ore','ore','ore',
  'desert',
];

// Standard number token set (18 tokens, one per non-desert tile).
const NUMBER_POOL: readonly number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

export function createStandardBoard(seed: number): Board {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const terrains = shuffle(TERRAIN_POOL, rng);
  const numbers = shuffle(NUMBER_POOL, rng);

  const tiles: Record<TileId, Tile> = {};
  const vertices: Record<VertexId, Vertex> = {};
  const edges: Record<EdgeId, Edge> = {};
  const tileOrder: TileId[] = [];

  // Vertex/edge working maps so we can accumulate tile lists.
  const vertTiles = new Map<VertexId, Set<TileId>>();
  const vertEdges = new Map<VertexId, Set<EdgeId>>();
  const vertCanonical = new Map<VertexId, { a: Axial; c: number }>();
  const edgeVerts = new Map<EdgeId, [VertexId, VertexId]>();
  const edgeTiles = new Map<EdgeId, Set<TileId>>();

  let numIdx = 0;
  let robberTile: TileId | null = null;

  for (let i = 0; i < STANDARD_AXIALS.length; i++) {
    const axial = STANDARD_AXIALS[i]!;
    const terrain = terrains[i]!;
    const tId = tileId(axial);
    tileOrder.push(tId);

    const vIds: VertexId[] = [];
    const eIds: EdgeId[] = [];
    for (let c = 0; c < 6; c++) {
      const vId = vertexId(axial, c);
      vIds.push(vId);
      if (!vertTiles.has(vId)) vertTiles.set(vId, new Set());
      vertTiles.get(vId)!.add(tId);
      if (!vertCanonical.has(vId)) {
        vertCanonical.set(vId, canonicalCorner(axial, c));
      }
    }
    for (let s = 0; s < 6; s++) {
      const eId = edgeId(axial, s);
      eIds.push(eId);
      if (!edgeTiles.has(eId)) edgeTiles.set(eId, new Set());
      edgeTiles.get(eId)!.add(tId);
      // Edge side s connects corner s and corner (s+1)%6 on this tile.
      const vA = vertexId(axial, s);
      const vB = vertexId(axial, (s + 1) % 6);
      if (!edgeVerts.has(eId)) edgeVerts.set(eId, [vA, vB]);
      if (!vertEdges.has(vA)) vertEdges.set(vA, new Set());
      if (!vertEdges.has(vB)) vertEdges.set(vB, new Set());
      vertEdges.get(vA)!.add(eId);
      vertEdges.get(vB)!.add(eId);
    }

    let number: number | null = null;
    if (terrain === 'desert') {
      robberTile = tId;
    } else {
      number = numbers[numIdx++] ?? null;
    }

    tiles[tId] = {
      id: tId,
      axial,
      terrain,
      number,
      vertices: vIds,
      edges: eIds,
    };
  }

  // Materialize vertex records with pixel coords.
  const vertexOrder: VertexId[] = [];
  for (const [vId, canon] of vertCanonical.entries()) {
    const center = axialToPixel(canon.a, 1);
    const off = cornerOffset(canon.c, 1);
    vertices[vId] = {
      id: vId,
      x: center.x + off.x,
      y: center.y + off.y,
      tiles: [...(vertTiles.get(vId) ?? [])],
      edges: [...(vertEdges.get(vId) ?? [])],
    };
    vertexOrder.push(vId);
  }
  vertexOrder.sort();

  // Materialize edge records.
  const edgeOrder: EdgeId[] = [];
  for (const [eId, [a, b]] of edgeVerts.entries()) {
    edges[eId] = {
      id: eId,
      a,
      b,
      tiles: [...(edgeTiles.get(eId) ?? [])],
    };
    edgeOrder.push(eId);
  }
  edgeOrder.sort();

  // Ports: walk the actual coastline clockwise and place 9 ports evenly.
  // A coastal edge is one touching exactly one tile (no neighbor across it).
  type CoastalEdge = {
    readonly eId: EdgeId;
    readonly a: VertexId;
    readonly b: VertexId;
    readonly midX: number;
    readonly midY: number;
  };
  const coastal: CoastalEdge[] = [];
  for (const eId of edgeOrder) {
    const e = edges[eId]!;
    if (e.tiles.length !== 1) continue;
    const vA = vertices[e.a]!;
    const vB = vertices[e.b]!;
    coastal.push({
      eId,
      a: e.a,
      b: e.b,
      midX: (vA.x + vB.x) / 2,
      midY: (vA.y + vB.y) / 2,
    });
  }
  // Sort clockwise-from-north around board centroid (SVG y grows downward,
  // so atan2(y, x) running counter-clockwise in math is clockwise visually).
  coastal.sort((p, q) => Math.atan2(p.midY, p.midX) - Math.atan2(q.midY, q.midX));

  const ports: Port[] = [];
  if (coastal.length >= PORT_KIND_SEQUENCE.length) {
    const step = coastal.length / PORT_KIND_SEQUENCE.length;
    for (let i = 0; i < PORT_KIND_SEQUENCE.length; i++) {
      const idx = Math.floor(i * step) % coastal.length;
      const ce = coastal[idx]!;
      ports.push({ vertices: [ce.a, ce.b] as const, kind: PORT_KIND_SEQUENCE[i]! });
    }
  }

  if (!robberTile) {
    // Safety: fallback to first tile — should not happen with standard pool.
    robberTile = tileOrder[0]!;
  }

  return {
    tiles,
    vertices,
    edges,
    ports,
    tileOrder,
    vertexOrder,
    edgeOrder,
  };
}

// ---------- Query helpers ----------

export function adjacentVerticesOnEdge(board: Board, eId: EdgeId): [VertexId, VertexId] {
  const e = board.edges[eId];
  if (!e) throw new Error(`unknown edge ${eId}`);
  return [e.a, e.b];
}

// Returns true if any settlement/city sits on v OR on any vertex one edge away.
export function vertexIsAdjacentToAnyBuilding(state: GameState, vId: VertexId): boolean {
  const v = state.board.vertices[vId];
  if (!v) return false;
  if (state.pieces[vId]) return true;
  for (const eId of v.edges) {
    const [a, b] = adjacentVerticesOnEdge(state.board, eId);
    const other = a === vId ? b : a;
    if (state.pieces[other]) return true;
  }
  return false;
}

// True if the player owns a settlement or city at vId, OR a road ending at vId.
export function playerHasRoadAtVertex(state: GameState, vId: VertexId, pid: PlayerId): boolean {
  const piece = state.pieces[vId];
  if (piece && piece.owner === pid) return true;
  const v = state.board.vertices[vId];
  if (!v) return false;
  for (const eId of v.edges) {
    if (state.roads[eId] === pid) return true;
  }
  return false;
}

// True if edge has at least one endpoint where pid owns a connecting piece/road.
// Used to validate new road placement outside setup.
export function edgeTouchesPlayer(state: GameState, eId: EdgeId, pid: PlayerId): boolean {
  const e = state.board.edges[eId];
  if (!e) return false;
  for (const vId of [e.a, e.b]) {
    const piece = state.pieces[vId];
    if (piece && piece.owner === pid) return true;
    // Roads connect through vertices unless that vertex has an opponent's building
    // (Catan's "broken road" rule). We honor that rule here.
    if (piece && piece.owner !== pid) continue;
    const v = state.board.vertices[vId];
    if (!v) continue;
    for (const otherEdge of v.edges) {
      if (otherEdge === eId) continue;
      if (state.roads[otherEdge] === pid) return true;
    }
  }
  return false;
}
