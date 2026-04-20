// Game construction + setup helpers.

import type {
  AIPersonality,
  GameState,
  Player,
  PlayerColor,
  PlayerId,
  Resource,
  VertexId,
} from '@/game/types';
import { COLORS, emptyHand } from '@/game/types';
import { createStandardBoard } from '@/game/board';
import { initialDeck } from '@/game/dev-cards';
import { makeRng, shuffle } from '@/lib/random';

export interface InitialStateOpts {
  readonly seed: number;
  readonly humanColor?: PlayerColor;
  readonly aiPersonalities?: readonly AIPersonality[];
}

// Snake order: forward 0..n-1, then reverse n-1..0.
export function setupOrder(playerIds: readonly PlayerId[]): PlayerId[] {
  const forward = playerIds.slice();
  const reverse = playerIds.slice().reverse();
  return [...forward, ...reverse];
}

const DEFAULT_AI_NAMES = ['Albrecht', 'Mira', 'Jules'] as const;

export function initialState(opts: InitialStateOpts): GameState {
  const { seed, humanColor, aiPersonalities } = opts;
  const board = createStandardBoard(seed);

  // Assign colors: human gets chosen color (default amber), AIs get the rest.
  const human = humanColor ?? 'amber';
  const rest: PlayerColor[] = COLORS.filter((c) => c !== human);
  const colors: PlayerColor[] = [human, ...rest];

  const players: Player[] = colors.map((color, i) => ({
    id: i as PlayerId,
    color,
    name: i === 0 ? 'You' : (DEFAULT_AI_NAMES[i - 1] ?? `AI ${i}`),
    isAI: i !== 0,
    personality: i === 0 ? undefined : aiPersonalities?.[i - 1],
    hand: emptyHand(),
    devCards: [],
    knightsPlayed: 0,
    hasLongestRoad: false,
    hasLargestArmy: false,
    longestRoadLength: 0,
    playedDevThisTurn: false,
    mood: 'content',
  }));

  const playerIds = players.map((p) => p.id);
  const order = setupOrder(playerIds);

  // Deterministic dev deck from seed.
  const rng = makeRng(seed ^ 0x85ebca6b);
  const devDeck = shuffle(initialDeck(), rng);

  // Find desert for robber start.
  const desert = board.tileOrder.find((tid) => board.tiles[tid]?.terrain === 'desert')
    ?? board.tileOrder[0]!;

  const state: GameState = {
    seed,
    rngState: (seed ^ 0xdeadbeef) >>> 0,
    board,
    players,
    currentPlayer: order[0]!,
    setupOrder: order,
    setupIndex: 0,
    phase: 'SETUP_1_SETTLEMENT',
    turn: 0,
    dice: null,
    hasRolledThisTurn: false,
    roads: {},
    pieces: {},
    robberTile: desert,
    devDeck,
    pendingDiscards: [],
    longestRoadHolder: null,
    largestArmyHolder: null,
    log: [
      {
        id: 0,
        turn: 0,
        who: null,
        text: 'Game begins. Place first settlement.',
        kind: 'setup',
      },
    ],
    logSeq: 1,
    winner: null,
    lastAction: null,
  };

  return state;
}

// Grant one of each adjacent-tile resource for a second-setup settlement.
export function grantSetupResources(state: GameState, vertex: VertexId): GameState {
  const v = state.board.vertices[vertex];
  if (!v) return state;
  const piece = state.pieces[vertex];
  if (!piece) return state;
  const gains: Partial<Record<Resource, number>> = {};
  for (const tId of v.tiles) {
    const t = state.board.tiles[tId];
    if (!t) continue;
    if (t.terrain === 'desert') continue;
    const r = t.terrain as Resource;
    gains[r] = (gains[r] ?? 0) + 1;
  }
  const players = state.players.map((p) => {
    if (p.id !== piece.owner) return p;
    const hand = { ...p.hand };
    for (const k of Object.keys(gains) as Resource[]) {
      hand[k] += gains[k] ?? 0;
    }
    return { ...p, hand };
  });
  return { ...state, players };
}
