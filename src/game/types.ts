// Central type contract — consumed by engine, AI, and UI.
// Edit with care; parallel workers expect these names and shapes.

export type Resource = 'wood' | 'brick' | 'wheat' | 'sheep' | 'ore';
export const RESOURCES: readonly Resource[] = ['wood', 'brick', 'wheat', 'sheep', 'ore'] as const;

export type Terrain = Resource | 'desert';

export type PlayerId = 0 | 1 | 2 | 3;
export type PlayerColor = 'crimson' | 'sapphire' | 'emerald' | 'amber';

// Axial hex coordinates (cube: x + y + z = 0; we store x and z).
export interface Axial {
  readonly x: number;
  readonly z: number;
}

// Stable string IDs so set/map keys work without structural hashing.
export type TileId = string;    // "T:x,z"
export type VertexId = string;  // "V:x,z,N" where N is 0..5 corner index on the canonical tile
export type EdgeId = string;    // "E:x,z,N" where N is 0..5 side index on the canonical tile

export interface Tile {
  readonly id: TileId;
  readonly axial: Axial;
  readonly terrain: Terrain;
  readonly number: number | null; // 2..12 except 7, null on desert
  readonly vertices: readonly VertexId[]; // 6 corner ids (canonical)
  readonly edges: readonly EdgeId[];      // 6 side ids (canonical)
}

export interface Vertex {
  readonly id: VertexId;
  readonly x: number;   // pixel-space x (unit radius)
  readonly y: number;   // pixel-space y
  readonly tiles: readonly TileId[];
  readonly edges: readonly EdgeId[];
}

export interface Edge {
  readonly id: EdgeId;
  readonly a: VertexId;
  readonly b: VertexId;
  readonly tiles: readonly TileId[];
}

export type PortKind = Resource | 'generic';
export interface Port {
  readonly vertices: readonly [VertexId, VertexId];
  readonly kind: PortKind; // generic = 3:1, resource = 2:1 of that type
}

export interface Board {
  readonly tiles: Readonly<Record<TileId, Tile>>;
  readonly vertices: Readonly<Record<VertexId, Vertex>>;
  readonly edges: Readonly<Record<EdgeId, Edge>>;
  readonly ports: readonly Port[];
  readonly tileOrder: readonly TileId[];
  readonly vertexOrder: readonly VertexId[];
  readonly edgeOrder: readonly EdgeId[];
}

// ----- Dev cards -----
export type DevCardKind =
  | 'knight'
  | 'victoryPoint'
  | 'roadBuilding'
  | 'monopoly'
  | 'yearOfPlenty';

export interface DevCard {
  readonly kind: DevCardKind;
  readonly boughtOnTurn: number;
  readonly played: boolean;
}

// ----- Player -----
export interface Player {
  readonly id: PlayerId;
  readonly color: PlayerColor;
  readonly name: string;
  readonly isAI: boolean;
  readonly personality?: AIPersonality;
  hand: Record<Resource, number>;
  devCards: DevCard[];            // full private list (engine view)
  knightsPlayed: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
  longestRoadLength: number;      // cached on commit
  playedDevThisTurn: boolean;
  mood: MoodKind;
}

export type MoodKind =
  | 'serene' | 'content' | 'confident' | 'ascendant'
  | 'anxious' | 'thwarted' | 'furious' | 'triumphant';

export interface AIPersonality {
  readonly id: string;
  readonly label: string;         // shown in log/roster
  readonly weights: {
    readonly wheat: number;
    readonly ore: number;
    readonly wood: number;
    readonly brick: number;
    readonly sheep: number;
    readonly cityBias: number;    // preference for cities over new settlements
    readonly devBias: number;     // preference for dev cards
    readonly roadBias: number;    // preference for longest-road push
    readonly aggression: number;  // probability of targeting leader with robber/knight
  };
}

// ----- Dice -----
export interface DiceRoll {
  readonly a: number;
  readonly b: number;
  readonly sum: number;
}

// ----- Phases -----
export type Phase =
  | 'SETUP_1_SETTLEMENT'
  | 'SETUP_1_ROAD'
  | 'SETUP_2_SETTLEMENT'
  | 'SETUP_2_ROAD'
  | 'ROLL'
  | 'DISCARD'
  | 'MOVE_ROBBER'
  | 'STEAL'
  | 'ACTION'
  | 'ROAD_BUILDING_1'
  | 'ROAD_BUILDING_2'
  | 'GAME_OVER';

// ----- Buildings -----
export type Building = 'settlement' | 'city';

export interface VertexPiece {
  readonly owner: PlayerId;
  readonly kind: Building;
}

// edge → playerId owning a road (or undefined)
export type RoadMap = Readonly<Record<EdgeId, PlayerId | undefined>>;
// vertex → piece (or undefined)
export type VertexMap = Readonly<Record<VertexId, VertexPiece | undefined>>;

// ----- Log -----
export interface LogEntry {
  readonly id: number;
  readonly turn: number;
  readonly who: PlayerId | null;
  readonly text: string;
  readonly kind: 'info' | 'roll' | 'build' | 'trade' | 'robber' | 'dev' | 'victory' | 'setup' | 'warn';
}

// ----- Pending state (for multi-step actions) -----
export interface DiscardRequirement {
  readonly playerId: PlayerId;
  readonly count: number;
}

// ----- Full game state -----
export interface GameState {
  readonly seed: number;
  readonly rngState: number;                  // Current PRNG state — engine advances it
  readonly board: Board;
  readonly players: readonly Player[];
  readonly currentPlayer: PlayerId;
  readonly setupOrder: readonly PlayerId[];   // snake order for setup (len 8: 4 fwd + 4 rev)
  readonly setupIndex: number;
  readonly phase: Phase;
  readonly turn: number;
  readonly dice: DiceRoll | null;
  readonly hasRolledThisTurn: boolean;
  readonly roads: RoadMap;
  readonly pieces: VertexMap;
  readonly robberTile: TileId;
  readonly devDeck: readonly DevCardKind[];   // remaining, FIFO
  readonly pendingDiscards: readonly DiscardRequirement[];
  readonly longestRoadHolder: PlayerId | null;
  readonly largestArmyHolder: PlayerId | null;
  readonly log: readonly LogEntry[];
  readonly logSeq: number;
  readonly winner: PlayerId | null;
  readonly lastAction: Action | null;
}

// ----- Actions (discriminated union) -----
export type Action =
  | { kind: 'ROLL' }
  | { kind: 'BUILD_ROAD'; edge: EdgeId; free?: boolean }
  | { kind: 'BUILD_SETTLEMENT'; vertex: VertexId; free?: boolean }
  | { kind: 'BUILD_CITY'; vertex: VertexId }
  | { kind: 'BUY_DEV_CARD' }
  | { kind: 'PLAY_KNIGHT'; tile: TileId; victim: PlayerId | null }
  | { kind: 'PLAY_ROAD_BUILDING' }
  | { kind: 'PLAY_MONOPOLY'; resource: Resource }
  | { kind: 'PLAY_YEAR_OF_PLENTY'; resources: [Resource, Resource] }
  | { kind: 'TRADE_BANK'; give: Resource; getR: Resource }
  | { kind: 'DISCARD'; playerId: PlayerId; cards: Partial<Record<Resource, number>> }
  | { kind: 'MOVE_ROBBER'; tile: TileId; victim: PlayerId | null }
  | { kind: 'END_TURN' };

export type ActionKind = Action['kind'];

// ----- Validator result -----
export interface Legality {
  readonly ok: boolean;
  readonly reason?: string;
}

// ----- Helpers -----
export const COLORS: readonly PlayerColor[] = ['amber', 'crimson', 'sapphire', 'emerald'];
export const BUILD_COSTS = {
  road:       { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city:       { wheat: 2, ore: 3 },
  dev:        { wheat: 1, sheep: 1, ore: 1 },
} as const satisfies Record<string, Partial<Record<Resource, number>>>;

export const VP_TO_WIN = 10;

export function emptyHand(): Record<Resource, number> {
  return { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };
}

export function handTotal(h: Record<Resource, number>): number {
  return h.wood + h.brick + h.wheat + h.sheep + h.ore;
}

export function playerVP(state: GameState, p: Player): number {
  let vp = 0;
  for (const vId of Object.keys(state.pieces)) {
    const piece = state.pieces[vId];
    if (piece && piece.owner === p.id) vp += piece.kind === 'city' ? 2 : 1;
  }
  if (p.hasLongestRoad) vp += 2;
  if (p.hasLargestArmy) vp += 2;
  for (const d of p.devCards) if (d.kind === 'victoryPoint') vp += 1;
  return vp;
}
