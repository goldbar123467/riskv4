// Pure validators. The single entrypoint canDo() is consulted by the UI
// before it enables a button and by the reducer before it mutates state.
// Double-gate.

import type {
  Action,
  GameState,
  Legality,
  PlayerId,
  Resource,
  VertexId,
} from '@/game/types';
import { BUILD_COSTS, handTotal } from '@/game/types';
import {
  adjacentVerticesOnEdge,
  edgeTouchesPlayer,
  vertexIsAdjacentToAnyBuilding,
} from '@/game/board';

const OK: Legality = { ok: true };

function fail(reason: string): Legality {
  return { ok: false, reason };
}

function isSetup(state: GameState): boolean {
  return (
    state.phase === 'SETUP_1_SETTLEMENT' ||
    state.phase === 'SETUP_1_ROAD' ||
    state.phase === 'SETUP_2_SETTLEMENT' ||
    state.phase === 'SETUP_2_ROAD'
  );
}

function canAfford(
  state: GameState,
  pid: PlayerId,
  cost: Partial<Record<Resource, number>>,
): boolean {
  const p = state.players[pid];
  if (!p) return false;
  for (const k of Object.keys(cost) as Resource[]) {
    if (p.hand[k] < (cost[k] ?? 0)) return false;
  }
  return true;
}

// Settlement placement: empty vertex, honors distance rule. In setup we skip
// the road-touch requirement; outside setup we require a connecting road.
function canPlaceSettlement(
  state: GameState,
  pid: PlayerId,
  vertex: VertexId,
  opts: { requireRoad: boolean },
): Legality {
  const v = state.board.vertices[vertex];
  if (!v) return fail('unknown vertex');
  if (state.pieces[vertex]) return fail('vertex occupied');
  if (vertexIsAdjacentToAnyBuilding(state, vertex)) return fail('too close to another building');
  if (opts.requireRoad) {
    let touches = false;
    for (const eId of v.edges) {
      if (state.roads[eId] === pid) { touches = true; break; }
    }
    if (!touches) return fail('must touch your road');
  }
  return OK;
}

// Road placement: empty edge, touches own piece/road. In setup the road must
// touch the settlement just placed.
function canPlaceRoad(
  state: GameState,
  pid: PlayerId,
  edge: string,
  setupAnchor: VertexId | null,
): Legality {
  const e = state.board.edges[edge];
  if (!e) return fail('unknown edge');
  if (state.roads[edge]) return fail('edge occupied');
  if (setupAnchor) {
    const [a, b] = adjacentVerticesOnEdge(state.board, edge);
    if (a !== setupAnchor && b !== setupAnchor) {
      return fail('setup road must touch your settlement');
    }
    return OK;
  }
  if (!edgeTouchesPlayer(state, edge, pid)) return fail('road must connect to your network');
  return OK;
}

// The vertex-id of the settlement the current setup player just placed.
// Used to require the setup road to be adjacent to it.
function pendingSetupSettlement(state: GameState, pid: PlayerId): VertexId | null {
  // Find a piece owned by pid whose *road* has not yet been placed at an adjacent edge.
  for (const vId of Object.keys(state.pieces)) {
    const piece = state.pieces[vId];
    if (!piece || piece.owner !== pid) continue;
    // count owned roads adjacent to this vertex
    const v = state.board.vertices[vId];
    if (!v) continue;
    let hasRoad = false;
    for (const eId of v.edges) if (state.roads[eId] === pid) { hasRoad = true; break; }
    if (!hasRoad) return vId;
  }
  return null;
}

export function canDo(state: GameState, action: Action, actorId: PlayerId): Legality {
  if (state.phase === 'GAME_OVER') return fail('game over');

  // Discarding is the only action tolerated during the DISCARD phase, and any
  // player with a pending requirement may act (not just the current player).
  if (state.phase === 'DISCARD') {
    if (action.kind !== 'DISCARD') return fail('must discard');
    const req = state.pendingDiscards.find((d) => d.playerId === action.playerId);
    if (!req) return fail('no discard owed');
    if (action.playerId !== actorId) return fail('not your discard');
    let total = 0;
    for (const k of Object.keys(action.cards) as Resource[]) {
      total += action.cards[k] ?? 0;
    }
    if (total !== req.count) return fail(`must discard ${req.count}`);
    const p = state.players[action.playerId];
    if (!p) return fail('no such player');
    for (const k of Object.keys(action.cards) as Resource[]) {
      if ((action.cards[k] ?? 0) > p.hand[k]) return fail('not enough of a resource');
    }
    return OK;
  }

  // Everything else belongs to the current player.
  if (actorId !== state.currentPlayer) return fail('not your turn');

  switch (action.kind) {
    case 'ROLL': {
      if (state.phase !== 'ROLL') return fail('not roll phase');
      if (state.hasRolledThisTurn) return fail('already rolled');
      return OK;
    }

    case 'BUILD_SETTLEMENT': {
      if (state.phase === 'SETUP_1_SETTLEMENT' || state.phase === 'SETUP_2_SETTLEMENT') {
        return canPlaceSettlement(state, actorId, action.vertex, { requireRoad: false });
      }
      if (state.phase !== 'ACTION') return fail('not build phase');
      if (!action.free && !canAfford(state, actorId, BUILD_COSTS.settlement)) {
        return fail('insufficient resources');
      }
      return canPlaceSettlement(state, actorId, action.vertex, { requireRoad: true });
    }

    case 'BUILD_ROAD': {
      if (state.phase === 'SETUP_1_ROAD' || state.phase === 'SETUP_2_ROAD') {
        const anchor = pendingSetupSettlement(state, actorId);
        if (!anchor) return fail('no pending settlement');
        return canPlaceRoad(state, actorId, action.edge, anchor);
      }
      if (state.phase === 'ROAD_BUILDING_1' || state.phase === 'ROAD_BUILDING_2') {
        return canPlaceRoad(state, actorId, action.edge, null);
      }
      if (state.phase !== 'ACTION') return fail('not build phase');
      if (!action.free && !canAfford(state, actorId, BUILD_COSTS.road)) {
        return fail('insufficient resources');
      }
      return canPlaceRoad(state, actorId, action.edge, null);
    }

    case 'BUILD_CITY': {
      if (state.phase !== 'ACTION') return fail('not build phase');
      const piece = state.pieces[action.vertex];
      if (!piece || piece.owner !== actorId) return fail('no settlement to upgrade');
      if (piece.kind !== 'settlement') return fail('already a city');
      if (!canAfford(state, actorId, BUILD_COSTS.city)) return fail('insufficient resources');
      return OK;
    }

    case 'BUY_DEV_CARD': {
      if (state.phase !== 'ACTION') return fail('not action phase');
      if (state.devDeck.length === 0) return fail('deck empty');
      if (!canAfford(state, actorId, BUILD_COSTS.dev)) return fail('insufficient resources');
      return OK;
    }

    case 'PLAY_KNIGHT': {
      if (state.phase !== 'ACTION' && state.phase !== 'ROLL') return fail('not action phase');
      const p = state.players[actorId];
      if (!p) return fail('no such player');
      if (p.playedDevThisTurn) return fail('one dev card per turn');
      // Must own a knight not bought this turn.
      const idx = p.devCards.findIndex((d) =>
        d.kind === 'knight' && !d.played && d.boughtOnTurn < state.turn
      );
      if (idx < 0) return fail('no playable knight');
      if (!state.board.tiles[action.tile]) return fail('unknown tile');
      if (action.tile === state.robberTile) return fail('robber must move');
      return OK;
    }

    case 'PLAY_ROAD_BUILDING': {
      if (state.phase !== 'ACTION') return fail('not action phase');
      const p = state.players[actorId];
      if (!p) return fail('no such player');
      if (p.playedDevThisTurn) return fail('one dev card per turn');
      const idx = p.devCards.findIndex((d) =>
        d.kind === 'roadBuilding' && !d.played && d.boughtOnTurn < state.turn
      );
      if (idx < 0) return fail('no playable road building');
      return OK;
    }

    case 'PLAY_MONOPOLY': {
      if (state.phase !== 'ACTION') return fail('not action phase');
      const p = state.players[actorId];
      if (!p) return fail('no such player');
      if (p.playedDevThisTurn) return fail('one dev card per turn');
      const idx = p.devCards.findIndex((d) =>
        d.kind === 'monopoly' && !d.played && d.boughtOnTurn < state.turn
      );
      if (idx < 0) return fail('no playable monopoly');
      return OK;
    }

    case 'PLAY_YEAR_OF_PLENTY': {
      if (state.phase !== 'ACTION') return fail('not action phase');
      const p = state.players[actorId];
      if (!p) return fail('no such player');
      if (p.playedDevThisTurn) return fail('one dev card per turn');
      const idx = p.devCards.findIndex((d) =>
        d.kind === 'yearOfPlenty' && !d.played && d.boughtOnTurn < state.turn
      );
      if (idx < 0) return fail('no playable year of plenty');
      return OK;
    }

    case 'TRADE_BANK': {
      if (state.phase !== 'ACTION') return fail('not action phase');
      if (action.give === action.getR) return fail('cannot trade for same resource');
      const p = state.players[actorId];
      if (!p) return fail('no such player');
      // Determine best ratio: 2:1 port, 3:1 port, else 4:1.
      const ratio = bankTradeRatio(state, actorId, action.give);
      if (p.hand[action.give] < ratio) return fail(`need ${ratio} ${action.give}`);
      return OK;
    }

    case 'MOVE_ROBBER': {
      if (state.phase !== 'MOVE_ROBBER' && state.phase !== 'STEAL') {
        return fail('not robber phase');
      }
      if (!state.board.tiles[action.tile]) return fail('unknown tile');
      if (action.tile === state.robberTile) return fail('must move robber');
      if (action.victim !== null) {
        const hasPiece = Object.keys(state.pieces).some((vId) => {
          const piece = state.pieces[vId];
          if (!piece || piece.owner !== action.victim) return false;
          const v = state.board.vertices[vId];
          return v?.tiles.includes(action.tile) ?? false;
        });
        if (!hasPiece) return fail('victim not on tile');
        const victim = state.players[action.victim];
        if (!victim) return fail('unknown victim');
        if (handTotal(victim.hand) <= 0) return fail('victim has no cards');
      }
      return OK;
    }

    case 'END_TURN': {
      if (state.phase !== 'ACTION') return fail('not end-turn phase');
      if (!state.hasRolledThisTurn) return fail('must roll first');
      return OK;
    }

    default:
      return fail('unknown action');
  }
}

// Best ratio available to player for trading away `give`:
// 2 if owns a 2:1 port for that resource; 3 if owns any generic port; else 4.
export function bankTradeRatio(state: GameState, pid: PlayerId, give: Resource): number {
  let hasGeneric = false;
  let hasSpecific = false;
  for (const port of state.board.ports) {
    const owned = port.vertices.some((vId) => {
      const piece = state.pieces[vId];
      return piece?.owner === pid;
    });
    if (!owned) continue;
    if (port.kind === 'generic') hasGeneric = true;
    else if (port.kind === give) hasSpecific = true;
  }
  if (hasSpecific) return 2;
  if (hasGeneric) return 3;
  return 4;
}
