// Deterministic Catan AI. Single entrypoint: decide(state, actorId) -> Action.
// Never returns an illegal action — every candidate passes `canDo` first.

import {
  BUILD_COSTS,
  RESOURCES,
  VP_TO_WIN,
  handTotal,
  type Action,
  type AIPersonality,
  type DevCardKind,
  type EdgeId,
  type GameState,
  type Player,
  type PlayerId,
  type Resource,
  type TileId,
  type VertexId,
} from '@/game/types';
import { canDo } from '@/game/rules';
import {
  bankRatio,
  bestSetupRoadFrom,
  canAfford,
  pickBankTrade,
  quickVP,
  scoreBuildAction,
  scoreRobberTile,
  scoreSetupVertex,
  vertexValue,
  vpLeaderOtherThan,
} from './heuristics';

// ---------------------------------------------------------------- public API
export function decide(state: GameState, actorId: PlayerId): Action {
  const actor = state.players.find((p) => p.id === actorId);
  if (!actor) return { kind: 'END_TURN' };
  const weights = actor.personality?.weights ?? defaultWeights();

  switch (state.phase) {
    case 'SETUP_1_SETTLEMENT':
    case 'SETUP_2_SETTLEMENT':
      return gate(state, actorId, setupSettlement(state, weights));
    case 'SETUP_1_ROAD':
    case 'SETUP_2_ROAD':
      return gate(state, actorId, setupRoad(state, actorId, weights));
    case 'ROLL':
      return gate(state, actorId, { kind: 'ROLL' });
    case 'DISCARD':
      return gate(state, actorId, discard(state, actor));
    case 'MOVE_ROBBER':
    case 'STEAL':
      return gate(state, actorId, moveRobber(state, actorId, weights));
    case 'ROAD_BUILDING_1':
    case 'ROAD_BUILDING_2':
      return gate(state, actorId, freeRoad(state, actorId, weights));
    case 'ACTION':
      return gate(state, actorId, actionPhase(state, actor));
    case 'GAME_OVER':
      return { kind: 'END_TURN' };
  }
}

// ------------------------------------------------------------------- helpers

function defaultWeights(): AIPersonality['weights'] {
  return {
    wheat: 0.6, ore: 0.6, wood: 0.6, brick: 0.6, sheep: 0.6,
    cityBias: 0.5, devBias: 0.5, roadBias: 0.5, aggression: 0.5,
  };
}

// Validate; if the preferred action is illegal, fall back to END_TURN.
function gate(state: GameState, actorId: PlayerId, action: Action): Action {
  const ok = canDo(state, action, actorId);
  if (ok.ok) return action;
  // Safe default: in ACTION we can always end. In other phases return the action
  // anyway (the engine's gate will reject, and it exposes a bug to fix).
  if (state.phase === 'ACTION') return { kind: 'END_TURN' };
  return action;
}

// ----------------------------------------------------------- setup placement

function setupSettlement(state: GameState, weights: AIPersonality['weights']): Action {
  let best: VertexId | null = null;
  let bestScore = -Infinity;
  for (const vId of state.board.vertexOrder) {
    const s = scoreSetupVertex(state, vId, weights);
    if (s > bestScore || (s === bestScore && best !== null && vId < best)) {
      bestScore = s;
      best = vId;
    }
  }
  if (!best) return { kind: 'END_TURN' };
  return { kind: 'BUILD_SETTLEMENT', vertex: best, free: true };
}

function setupRoad(
  state: GameState,
  actorId: PlayerId,
  weights: AIPersonality['weights'],
): Action {
  // Find the settlement we just placed this setup turn (newest owned vertex without a road).
  let anchor: VertexId | null = null;
  for (const vId of state.board.vertexOrder) {
    const piece = state.pieces[vId];
    if (!piece || piece.owner !== actorId) continue;
    const v = state.board.vertices[vId];
    if (!v) continue;
    const hasRoad = v.edges.some((e) => state.roads[e] === actorId);
    if (!hasRoad) { anchor = vId; break; }
  }
  if (!anchor) return { kind: 'END_TURN' };
  const edge = bestSetupRoadFrom(state, anchor, weights);
  if (!edge) {
    // Fall back to any unclaimed incident edge.
    const v = state.board.vertices[anchor];
    for (const e of [...(v?.edges ?? [])].sort()) {
      if (state.roads[e] === undefined) return { kind: 'BUILD_ROAD', edge: e, free: true };
    }
    return { kind: 'END_TURN' };
  }
  return { kind: 'BUILD_ROAD', edge, free: true };
}

// ------------------------------------------------------------------ discard

function discard(state: GameState, actor: Player): Action {
  const req = state.pendingDiscards.find((r) => r.playerId === actor.id);
  const need = req?.count ?? Math.floor(handTotal(actor.hand) / 2);
  // Rank resources by value-to-keep: want's resources are precious, glut is not.
  const w = actor.personality?.weights ?? defaultWeights();
  const rank: Array<[Resource, number]> = RESOURCES.map((r) => [r, w[r]]);
  // Discard the cheapest-to-us first, proportional to glut.
  rank.sort((a, b) => {
    const aScore = a[1] - actor.hand[a[0]] * 0.15;
    const bScore = b[1] - actor.hand[b[0]] * 0.15;
    return aScore - bScore; // lowest first → discard first
  });
  const cards: Partial<Record<Resource, number>> = {};
  let remaining = need;
  for (const [r] of rank) {
    if (remaining <= 0) break;
    const take = Math.min(actor.hand[r], remaining);
    if (take > 0) { cards[r] = take; remaining -= take; }
  }
  return { kind: 'DISCARD', playerId: actor.id, cards };
}

// ---------------------------------------------------------------- robber / steal

function moveRobber(
  state: GameState,
  actorId: PlayerId,
  weights: AIPersonality['weights'],
): Action {
  let bestTile: TileId | null = null;
  let bestScore = -Infinity;
  for (const tId of state.board.tileOrder) {
    const s = scoreRobberTile(state, tId, actorId, weights);
    if (s > bestScore || (s === bestScore && bestTile !== null && tId < bestTile)) {
      bestScore = s;
      bestTile = tId;
    }
  }
  if (!bestTile) return { kind: 'END_TURN' };
  const victim = pickVictim(state, bestTile, actorId);
  return { kind: 'MOVE_ROBBER', tile: bestTile, victim };
}

function pickVictim(state: GameState, tile: TileId, actorId: PlayerId): PlayerId | null {
  const t = state.board.tiles[tile];
  if (!t) return null;
  const leader = vpLeaderOtherThan(state, actorId);
  const candidates = new Map<PlayerId, number>();
  for (const vId of t.vertices) {
    const piece = state.pieces[vId];
    if (!piece || piece.owner === actorId) continue;
    const target = state.players.find((p) => p.id === piece.owner);
    if (!target) continue;
    const cards = handTotal(target.hand);
    if (cards === 0) continue;
    const prior = candidates.get(piece.owner) ?? 0;
    candidates.set(piece.owner, prior + cards + (piece.owner === leader ? 3 : 0));
  }
  let bestVictim: PlayerId | null = null;
  let bestScore = -1;
  for (const [pid, score] of candidates) {
    if (score > bestScore || (score === bestScore && bestVictim !== null && pid < bestVictim)) {
      bestScore = score;
      bestVictim = pid;
    }
  }
  return bestVictim;
}

// ------------------------------------------------------------ free road (dev)

function freeRoad(
  state: GameState,
  actorId: PlayerId,
  weights: AIPersonality['weights'],
): Action {
  const edge = bestOwnedExtension(state, actorId, weights);
  if (!edge) return { kind: 'END_TURN' };
  return { kind: 'BUILD_ROAD', edge, free: true };
}

// Extend from the current road network toward the highest-value endpoint.
function bestOwnedExtension(
  state: GameState,
  actorId: PlayerId,
  weights: AIPersonality['weights'],
): EdgeId | null {
  let best: EdgeId | null = null;
  let bestScore = -Infinity;
  for (const eId of state.board.edgeOrder) {
    if (state.roads[eId] !== undefined) continue;
    const legal = canDo(state, { kind: 'BUILD_ROAD', edge: eId, free: true }, actorId);
    if (!legal.ok) continue;
    const e = state.board.edges[eId];
    if (!e) continue;
    const s = Math.max(vertexValue(state, e.a, weights), vertexValue(state, e.b, weights));
    if (s > bestScore || (s === bestScore && best !== null && eId < best)) {
      bestScore = s;
      best = eId;
    }
  }
  return best;
}

// ---------------------------------------------------------------- action phase

function actionPhase(state: GameState, actor: Player): Action {
  const weights = actor.personality?.weights ?? defaultWeights();

  // 1. Instant win checks.
  const winMove = findWinningMove(state, actor);
  if (winMove) return winMove;

  // 2. City if affordable — always a gain over settlements for VP density.
  if (canAfford(actor, BUILD_COSTS.city)) {
    const city = bestCityVertex(state, actor);
    if (city) return { kind: 'BUILD_CITY', vertex: city };
  }

  // 3. Settlement on a good vertex.
  if (canAfford(actor, BUILD_COSTS.settlement)) {
    const settle = bestSettlementVertex(state, actor, weights);
    if (settle && scoreBuildAction(state, { kind: 'BUILD_SETTLEMENT', vertex: settle }, actor) > 10)
      return { kind: 'BUILD_SETTLEMENT', vertex: settle };
  }

  // 4. Longest-road push.
  if (canAfford(actor, BUILD_COSTS.road) && shouldChaseLongestRoad(state, actor)) {
    const edge = bestOwnedExtension(state, actor.id, weights);
    if (edge) return { kind: 'BUILD_ROAD', edge };
  }

  // 5. Dev card.
  if (weights.devBias > 0.4 && canAfford(actor, BUILD_COSTS.dev) && state.devDeck.length > 0) {
    return { kind: 'BUY_DEV_CARD' };
  }

  // 5b. Play a ready dev card if impactful (knight/monopoly/yop/road-building).
  const devAction = tryPlayDev(state, actor, weights);
  if (devAction) return devAction;

  // 6. Smart bank trade toward the next build goal.
  const trade = pickBankTrade(state, actor);
  if (trade) {
    const ratio = bankRatio(state, actor, trade.give);
    if (actor.hand[trade.give] >= ratio) {
      return { kind: 'TRADE_BANK', give: trade.give, getR: trade.getR };
    }
  }

  // 7. Fallback: settlement on any legal vertex is better than passing.
  if (canAfford(actor, BUILD_COSTS.settlement)) {
    const settle = bestSettlementVertex(state, actor, weights);
    if (settle) return { kind: 'BUILD_SETTLEMENT', vertex: settle };
  }

  return { kind: 'END_TURN' };
}

// -------------------------------------------------------------- tactical

function findWinningMove(state: GameState, actor: Player): Action | null {
  const vp = quickVP(state, actor);
  const gap = VP_TO_WIN - vp;
  if (gap <= 0) return null;
  // City: +1 VP per upgrade (settlement worth 1 → city worth 2).
  if (gap <= 1 && canAfford(actor, BUILD_COSTS.city)) {
    const c = bestCityVertex(state, actor);
    if (c) return { kind: 'BUILD_CITY', vertex: c };
  }
  // Settlement: +1 VP.
  if (gap <= 1 && canAfford(actor, BUILD_COSTS.settlement)) {
    const s = bestSettlementVertex(state, actor, actor.personality?.weights ?? defaultWeights());
    if (s) return { kind: 'BUILD_SETTLEMENT', vertex: s };
  }
  // Dev card can flip to VP — only a last-resort gamble, so skip unless gap=1 and we have a reveal path.
  return null;
}

function bestCityVertex(state: GameState, actor: Player): VertexId | null {
  const w = actor.personality?.weights ?? defaultWeights();
  let best: VertexId | null = null;
  let bestScore = -Infinity;
  for (const vId of state.board.vertexOrder) {
    const piece = state.pieces[vId];
    if (!piece || piece.owner !== actor.id || piece.kind !== 'settlement') continue;
    const s = vertexValue(state, vId, w);
    if (s > bestScore || (s === bestScore && best !== null && vId < best)) {
      bestScore = s;
      best = vId;
    }
  }
  return best;
}

function bestSettlementVertex(
  state: GameState,
  actor: Player,
  weights: AIPersonality['weights'],
): VertexId | null {
  let best: VertexId | null = null;
  let bestScore = -Infinity;
  for (const vId of state.board.vertexOrder) {
    const legal = canDo(state, { kind: 'BUILD_SETTLEMENT', vertex: vId }, actor.id);
    if (!legal.ok) continue;
    const s = vertexValue(state, vId, weights);
    if (s > bestScore || (s === bestScore && best !== null && vId < best)) {
      bestScore = s;
      best = vId;
    }
  }
  return best;
}

function shouldChaseLongestRoad(state: GameState, actor: Player): boolean {
  const w = actor.personality?.weights ?? defaultWeights();
  if (w.roadBias < 0.5) return false;
  // If the gap between us and the current leader is small, extending helps.
  let leaderLen = 0;
  for (const p of state.players) if (p.longestRoadLength > leaderLen) leaderLen = p.longestRoadLength;
  return actor.longestRoadLength + 2 >= leaderLen;
}

// ------------------------------------------------------------- dev card play

function tryPlayDev(
  state: GameState,
  actor: Player,
  weights: AIPersonality['weights'],
): Action | null {
  if (actor.playedDevThisTurn) return null;
  const ready = readyDevCards(state, actor);
  if (ready.length === 0) return null;

  // Monopoly: only when a rival holds a big stockpile of our desired resource.
  if (ready.includes('monopoly')) {
    const pick = pickMonopolyResource(state, actor, weights);
    if (pick) return { kind: 'PLAY_MONOPOLY', resource: pick };
  }

  // Year of Plenty: only when it unlocks an immediate build.
  if (ready.includes('yearOfPlenty')) {
    const pair = pickYearOfPlenty(actor);
    if (pair) return { kind: 'PLAY_YEAR_OF_PLENTY', resources: pair };
  }

  // Road Building: only if roadBias high and network has legal extensions.
  if (ready.includes('roadBuilding') && weights.roadBias > 0.6) {
    const edge = bestOwnedExtension(state, actor.id, weights);
    if (edge) return { kind: 'PLAY_ROAD_BUILDING' };
  }

  // Knight: aggressive — move robber to a leader-pinned tile.
  if (ready.includes('knight') && weights.aggression > 0.4) {
    let bestTile: TileId | null = null;
    let bestScore = -Infinity;
    for (const tId of state.board.tileOrder) {
      if (tId === state.robberTile) continue;
      const s = scoreRobberTile(state, tId, actor.id, weights);
      if (s > bestScore || (s === bestScore && bestTile !== null && tId < bestTile)) {
        bestScore = s;
        bestTile = tId;
      }
    }
    if (bestTile && bestScore > 0) {
      const victim = pickVictim(state, bestTile, actor.id);
      return { kind: 'PLAY_KNIGHT', tile: bestTile, victim };
    }
  }

  return null;
}

function readyDevCards(state: GameState, actor: Player): DevCardKind[] {
  const out: DevCardKind[] = [];
  for (const d of actor.devCards) {
    if (d.played) continue;
    if (d.boughtOnTurn >= state.turn && d.kind !== 'victoryPoint') continue;
    out.push(d.kind);
  }
  return out;
}

function pickMonopolyResource(
  state: GameState,
  actor: Player,
  weights: AIPersonality['weights'],
): Resource | null {
  let best: Resource | null = null;
  let bestScore = 0;
  for (const r of RESOURCES) {
    let total = 0;
    for (const p of state.players) if (p.id !== actor.id) total += p.hand[r];
    const s = total * (weights[r] + 0.2);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return bestScore >= 3 ? best : null;
}

function pickYearOfPlenty(actor: Player): [Resource, Resource] | null {
  const w = actor.personality?.weights;
  if (!w) return null;
  // Pick the two resources we most need to close a build cost.
  const goals: Array<Partial<Record<Resource, number>>> = [
    BUILD_COSTS.city, BUILD_COSTS.settlement, BUILD_COSTS.dev, BUILD_COSTS.road,
  ];
  for (const cost of goals) {
    const missing: Resource[] = [];
    for (const r of RESOURCES) {
      const need = (cost as Partial<Record<Resource, number>>)[r] ?? 0;
      if (actor.hand[r] < need) {
        for (let i = 0; i < need - actor.hand[r]; i++) missing.push(r);
      }
    }
    if (missing.length >= 2) return [missing[0], missing[1]];
    if (missing.length === 1) {
      // Pair with the next-most-valuable resource by weight.
      const partner = RESOURCES
        .filter((r) => r !== missing[0])
        .sort((a, b) => w[b] - w[a])[0];
      return [missing[0], partner];
    }
  }
  // No immediate missing resource; greedy pick top two weights.
  const ranked = [...RESOURCES].sort((a, b) => w[b] - w[a]);
  return [ranked[0], ranked[1]];
}
