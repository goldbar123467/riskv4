// Scoring functions for the Catan AI. Pure. No side effects. No DOM.
// All numbers are in comparable ranges; ties broken by stable id order.

import {
  BUILD_COSTS,
  RESOURCES,
  type AIPersonality,
  type Action,
  type EdgeId,
  type GameState,
  type Player,
  type PlayerId,
  type Resource,
  type TileId,
  type VertexId,
} from '@/game/types';

export type ResourceWeights = AIPersonality['weights'];

// Probability dots for a number token: 6-|7-n|. 2 & 12 → 1 dot; 6 & 8 → 5 dots.
export function tokenDots(n: number | null): number {
  if (n == null) return 0;
  return 6 - Math.abs(7 - n);
}

// Is a vertex adjacent to a port? Returns the port kind or null.
function portKindAt(state: GameState, vertex: VertexId): 'generic' | Resource | null {
  for (const p of state.board.ports) {
    if (p.vertices[0] === vertex || p.vertices[1] === vertex) return p.kind;
  }
  return null;
}

// Sum of expected production weighted by personality preferences plus a port bonus.
export function vertexValue(
  state: GameState,
  vertex: VertexId,
  weights: ResourceWeights,
): number {
  const v = state.board.vertices[vertex];
  if (!v) return 0;
  let score = 0;
  for (const tileId of v.tiles) {
    const tile = state.board.tiles[tileId];
    if (!tile) continue;
    if (tile.terrain === 'desert') continue;
    const dots = tokenDots(tile.number);
    const w = weights[tile.terrain];
    score += dots * w;
  }
  const port = portKindAt(state, vertex);
  if (port === 'generic') score += 0.6;
  else if (port) score += 0.9 + weights[port] * 0.4;
  return score;
}

// Stricter variant for setup: reward diverse terrain, punish desert-adjacent, reward pips.
export function scoreSetupVertex(
  state: GameState,
  vertex: VertexId,
  weights: ResourceWeights,
): number {
  const v = state.board.vertices[vertex];
  if (!v) return -Infinity;
  // Can't place if occupied or adjacent to an occupied vertex.
  if (state.pieces[vertex]) return -Infinity;
  for (const eId of v.edges) {
    const e = state.board.edges[eId];
    if (!e) continue;
    const other = e.a === vertex ? e.b : e.a;
    if (state.pieces[other]) return -Infinity;
  }
  let base = vertexValue(state, vertex, weights);
  const terrains = new Set<string>();
  let pips = 0;
  let desertTouch = 0;
  for (const tileId of v.tiles) {
    const t = state.board.tiles[tileId];
    if (!t) continue;
    if (t.terrain === 'desert') { desertTouch += 1; continue; }
    terrains.add(t.terrain);
    pips += tokenDots(t.number);
  }
  // Diversity: each distinct resource adds, desert subtracts.
  base += terrains.size * 0.8;
  base -= desertTouch * 1.2;
  // Raw pip count feathered in for overall richness.
  base += pips * 0.15;
  return base;
}

// Pick adjacent edge that points toward the best reachable next-vertex.
export function bestSetupRoadFrom(
  state: GameState,
  vertex: VertexId,
  weights: ResourceWeights,
): EdgeId | null {
  const v = state.board.vertices[vertex];
  if (!v) return null;
  let bestEdge: EdgeId | null = null;
  let bestScore = -Infinity;
  for (const eId of [...v.edges].sort()) {
    const e = state.board.edges[eId];
    if (!e) continue;
    if (state.roads[eId] !== undefined) continue;
    const other = e.a === vertex ? e.b : e.a;
    const ov = state.board.vertices[other];
    if (!ov) continue;
    // Look one step further for future settlement site value.
    let lookahead = vertexValue(state, other, weights);
    for (const e2 of ov.edges) {
      if (e2 === eId) continue;
      const ee = state.board.edges[e2];
      if (!ee) continue;
      const next = ee.a === other ? ee.b : ee.a;
      lookahead = Math.max(lookahead, vertexValue(state, next, weights) * 0.6);
    }
    if (lookahead > bestScore) {
      bestScore = lookahead;
      bestEdge = eId;
    }
  }
  return bestEdge;
}

// Score a concrete build action for the given player.
export function scoreBuildAction(state: GameState, action: Action, player: Player): number {
  const w = player.personality?.weights;
  if (!w) return 0;
  switch (action.kind) {
    case 'BUILD_CITY':
      return 18 + w.cityBias * 6 + vertexValue(state, action.vertex, w) * 0.4;
    case 'BUILD_SETTLEMENT':
      return 12 + vertexValue(state, action.vertex, w);
    case 'BUILD_ROAD': {
      const edge = state.board.edges[action.edge];
      if (!edge) return 0;
      const endA = vertexValue(state, edge.a, w);
      const endB = vertexValue(state, edge.b, w);
      return 2 + w.roadBias * 3 + Math.max(endA, endB) * 0.2;
    }
    case 'BUY_DEV_CARD':
      return 6 + w.devBias * 5;
    case 'TRADE_BANK':
      return 1;
    default:
      return 0;
  }
}

// Robber: prefer hitting VP leader (not self), favor tiles with many rival pieces.
export function scoreRobberTile(
  state: GameState,
  tileId: TileId,
  actor: PlayerId,
  weights: ResourceWeights,
): number {
  if (tileId === state.robberTile) return -Infinity;
  const tile = state.board.tiles[tileId];
  if (!tile) return -Infinity;
  if (tile.terrain === 'desert') return -10; // legal, but unproductive
  const leader = vpLeaderOtherThan(state, actor);
  let score = tokenDots(tile.number) * (weights.wheat + weights.ore) * 0.25;
  let selfPieces = 0;
  let rivalPieces = 0;
  let leaderPieces = 0;
  for (const vId of tile.vertices) {
    const piece = state.pieces[vId];
    if (!piece) continue;
    const w = piece.kind === 'city' ? 2 : 1;
    if (piece.owner === actor) selfPieces += w;
    else {
      rivalPieces += w;
      if (leader !== null && piece.owner === leader) leaderPieces += w;
    }
  }
  if (selfPieces > 0 && rivalPieces === 0) return -Infinity; // never rob yourself
  score += rivalPieces * 4;
  score += leaderPieces * 6;
  score -= selfPieces * 5;
  return score;
}

// Identify the VP leader that isn't `self`. Ties broken by lowest id.
export function vpLeaderOtherThan(state: GameState, self: PlayerId): PlayerId | null {
  let best: PlayerId | null = null;
  let bestVp = -1;
  for (const p of state.players) {
    if (p.id === self) continue;
    const vp = quickVP(state, p);
    if (vp > bestVp || (vp === bestVp && best !== null && p.id < best)) {
      bestVp = vp;
      best = p.id;
    }
  }
  return best;
}

// Cheap VP count that mirrors types.playerVP semantics without circular imports.
export function quickVP(state: GameState, p: Player): number {
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

// Ratio a player can spend to trade a resource to the bank (4, 3 via generic port, or 2 via specific port).
export function bankRatio(state: GameState, player: Player, give: Resource): 2 | 3 | 4 {
  let hasGeneric = false;
  let hasSpecific = false;
  for (const p of state.board.ports) {
    const owned = p.vertices.some((vId) => {
      const piece = state.pieces[vId];
      return piece?.owner === player.id;
    });
    if (!owned) continue;
    if (p.kind === 'generic') hasGeneric = true;
    else if (p.kind === give) hasSpecific = true;
  }
  if (hasSpecific) return 2;
  if (hasGeneric) return 3;
  return 4;
}

// What resources does the personality most want to hoard next?
function desiredBuild(player: Player): 'city' | 'settlement' | 'road' | 'dev' {
  const w = player.personality?.weights;
  if (!w) return 'settlement';
  const scores: Array<[('city' | 'settlement' | 'road' | 'dev'), number]> = [
    ['city', w.cityBias + 0.4],
    ['settlement', 1.0],
    ['road', w.roadBias],
    ['dev', w.devBias],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

const COST_KEYS = {
  city: BUILD_COSTS.city,
  settlement: BUILD_COSTS.settlement,
  road: BUILD_COSTS.road,
  dev: BUILD_COSTS.dev,
} as const;

// If trading closes the gap to the desired build, return that trade.
export function pickBankTrade(
  state: GameState,
  player: Player,
): { give: Resource; getR: Resource } | null {
  const want = desiredBuild(player);
  const cost = COST_KEYS[want];
  const hand = player.hand;
  // What are we missing for the desired build?
  const missing: Resource[] = [];
  for (const r of RESOURCES) {
    const need = (cost as Partial<Record<Resource, number>>)[r] ?? 0;
    if (hand[r] < need) missing.push(r);
  }
  if (missing.length === 0) return null;
  // What can we afford to give up? Must keep enough to hit the cost after trade.
  for (const give of RESOURCES) {
    if (missing.includes(give)) continue;
    const reserve = (cost as Partial<Record<Resource, number>>)[give] ?? 0;
    const ratio = bankRatio(state, player, give);
    if (hand[give] < ratio + reserve) continue;
    const getR = missing[0];
    if (give === getR) continue;
    return { give, getR };
  }
  return null;
}

// Can player afford a given build given their current hand?
export function canAfford(player: Player, cost: Partial<Record<Resource, number>>): boolean {
  for (const r of RESOURCES) {
    const need = cost[r] ?? 0;
    if (player.hand[r] < need) return false;
  }
  return true;
}
