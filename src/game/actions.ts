// Pure reducer for every Action. Double-gates via canDo(); any illegal action
// throws so the UI can surface it. All randomness flows through rngStep.

import type {
  Action,
  DevCard,
  DevCardKind,
  DiceRoll,
  DiscardRequirement,
  GameState,
  LogEntry,
  Phase,
  Player,
  PlayerId,
  Resource,
  Tile,
  TileId,
  VertexId,
  VertexPiece,
} from '@/game/types';
import {
  BUILD_COSTS,
  RESOURCES,
  VP_TO_WIN,
  handTotal,
  playerVP,
} from '@/game/types';
import { canDo, bankTradeRatio } from '@/game/rules';
import { rngStep } from '@/lib/random';

// ---------- Helpers ----------

function advanceRng(state: GameState): { state: GameState; value: number } {
  const { state: next, value } = rngStep(state.rngState);
  return { state: { ...state, rngState: next }, value };
}

function log(state: GameState, entry: Omit<LogEntry, 'id' | 'turn'>): GameState {
  const id = state.logSeq;
  const full: LogEntry = { id, turn: state.turn, ...entry };
  return { ...state, log: [full, ...state.log], logSeq: id + 1 };
}

function playerName(state: GameState, pid: PlayerId | null): string {
  if (pid === null) return 'Game';
  return state.players[pid]?.name ?? `P${pid}`;
}

function patchPlayer(state: GameState, pid: PlayerId, patch: Partial<Player>): GameState {
  const players = state.players.map((p) => (p.id === pid ? { ...p, ...patch } : p));
  return { ...state, players };
}

function updatePlayerHand(
  state: GameState,
  pid: PlayerId,
  delta: Partial<Record<Resource, number>>,
): GameState {
  const p = state.players[pid];
  if (!p) return state;
  const hand = { ...p.hand };
  for (const r of Object.keys(delta) as Resource[]) {
    hand[r] = Math.max(0, hand[r] + (delta[r] ?? 0));
  }
  return patchPlayer(state, pid, { hand });
}

function spend(
  state: GameState,
  pid: PlayerId,
  cost: Partial<Record<Resource, number>>,
): GameState {
  const negated: Partial<Record<Resource, number>> = {};
  for (const r of Object.keys(cost) as Resource[]) negated[r] = -(cost[r] ?? 0);
  return updatePlayerHand(state, pid, negated);
}

// ---------- Phase transitions ----------

function nextSetupPhase(state: GameState): GameState {
  // After placing a settlement we enter the matching ROAD phase.
  // After placing the road we advance setupIndex and the next settlement.
  const { setupIndex, setupOrder } = state;
  const half = setupOrder.length / 2;

  if (state.phase === 'SETUP_1_SETTLEMENT' || state.phase === 'SETUP_2_SETTLEMENT') {
    const roadPhase: Phase = state.phase === 'SETUP_1_SETTLEMENT' ? 'SETUP_1_ROAD' : 'SETUP_2_ROAD';
    return { ...state, phase: roadPhase };
  }

  // After a road — advance
  if (state.phase === 'SETUP_1_ROAD') {
    const nextIdx = setupIndex + 1;
    if (nextIdx < half) {
      return {
        ...state,
        setupIndex: nextIdx,
        currentPlayer: setupOrder[nextIdx]!,
        phase: 'SETUP_1_SETTLEMENT',
      };
    }
    // Transition to round 2
    return {
      ...state,
      setupIndex: nextIdx,
      currentPlayer: setupOrder[nextIdx]!,
      phase: 'SETUP_2_SETTLEMENT',
    };
  }

  if (state.phase === 'SETUP_2_ROAD') {
    const nextIdx = setupIndex + 1;
    if (nextIdx < setupOrder.length) {
      return {
        ...state,
        setupIndex: nextIdx,
        currentPlayer: setupOrder[nextIdx]!,
        phase: 'SETUP_2_SETTLEMENT',
      };
    }
    // Setup complete — first real turn.
    return {
      ...state,
      phase: 'ROLL',
      currentPlayer: setupOrder[0]!,
      turn: 1,
      hasRolledThisTurn: false,
    };
  }

  return state;
}

function advanceTurn(state: GameState): GameState {
  // Move to next player, reset turn flags, set phase to ROLL.
  const ids = state.players.map((p) => p.id);
  const idx = ids.indexOf(state.currentPlayer);
  const next = ids[(idx + 1) % ids.length]!;
  const players = state.players.map((p) => ({ ...p, playedDevThisTurn: false }));
  return {
    ...state,
    players,
    currentPlayer: next,
    phase: 'ROLL',
    turn: state.turn + 1,
    hasRolledThisTurn: false,
    dice: null,
  };
}

// ---------- Resource production ----------

export function produceResources(state: GameState, sum: number): GameState {
  if (sum === 7) return state;
  let next = state;
  // For each tile with the matching number and not robbed, every adjacent
  // settlement/city pays its owner.
  for (const tid of next.board.tileOrder) {
    const tile = next.board.tiles[tid]!;
    if (tile.number !== sum) continue;
    if (tid === next.robberTile) continue;
    if (tile.terrain === 'desert') continue;
    const resource = tile.terrain as Resource;
    // Collect gains per player first, then apply.
    const perPlayer: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const vId of tile.vertices) {
      const piece = next.pieces[vId];
      if (!piece) continue;
      perPlayer[piece.owner] += piece.kind === 'city' ? 2 : 1;
    }
    for (const pidStr of Object.keys(perPlayer)) {
      const pid = Number(pidStr) as PlayerId;
      const amount = perPlayer[pid];
      if (amount > 0) {
        next = updatePlayerHand(next, pid, { [resource]: amount });
      }
    }
  }
  return next;
}

// ---------- Robber ----------

function stealRandom(state: GameState, thief: PlayerId, victim: PlayerId): GameState {
  const v = state.players[victim];
  if (!v) return state;
  const bag: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < v.hand[r]; i++) bag.push(r);
  if (bag.length === 0) return state;
  const { state: s1, value } = advanceRng(state);
  const pick = bag[Math.floor(value * bag.length)]!;
  let s2 = updatePlayerHand(s1, victim, { [pick]: -1 });
  s2 = updatePlayerHand(s2, thief, { [pick]: +1 });
  return log(s2, {
    who: thief,
    kind: 'robber',
    text: `${playerName(s2, thief)} stole from ${playerName(s2, victim)}.`,
  });
}

export function applyRobberMove(
  state: GameState,
  tile: TileId,
  victim: PlayerId | null,
): GameState {
  let next: GameState = { ...state, robberTile: tile };
  next = log(next, {
    who: state.currentPlayer,
    kind: 'robber',
    text: `${playerName(next, state.currentPlayer)} moves the robber.`,
  });
  if (victim !== null) {
    next = stealRandom(next, state.currentPlayer, victim);
  }
  return next;
}

// ---------- Longest Road (DFS) ----------

export function recomputeLongestRoad(state: GameState): {
  holder: PlayerId | null;
  lengths: Record<PlayerId, number>;
} {
  const lengths: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const p of state.players) {
    lengths[p.id] = longestPathFor(state, p.id);
  }
  // Find holder: must be >= 5; ties keep previous holder.
  let best = 4;
  let holder: PlayerId | null = state.longestRoadHolder;
  let bestId: PlayerId | null = null;
  for (const p of state.players) {
    if (lengths[p.id] >= 5 && lengths[p.id] > best) {
      best = lengths[p.id];
      bestId = p.id;
    }
  }
  if (bestId !== null) {
    if (holder === null || lengths[bestId] > lengths[holder]) {
      holder = bestId;
    }
  } else if (holder !== null && lengths[holder] < 5) {
    holder = null;
  }
  return { holder, lengths };
}

function longestPathFor(state: GameState, pid: PlayerId): number {
  const ownedEdges: string[] = [];
  for (const e of Object.keys(state.roads)) if (state.roads[e] === pid) ownedEdges.push(e);
  if (ownedEdges.length === 0) return 0;

  // Build adjacency: vertex -> owned edges
  const vertEdges = new Map<VertexId, string[]>();
  for (const e of ownedEdges) {
    const edge = state.board.edges[e]!;
    for (const v of [edge.a, edge.b] as VertexId[]) {
      // A road path is broken by an opponent's building on a vertex.
      const piece = state.pieces[v];
      if (piece && piece.owner !== pid) continue;
      const list = vertEdges.get(v) ?? [];
      list.push(e);
      vertEdges.set(v, list);
    }
  }

  let longest = 0;
  function dfs(v: VertexId, used: Set<string>): number {
    const list = vertEdges.get(v) ?? [];
    let best = 0;
    for (const e of list) {
      if (used.has(e)) continue;
      used.add(e);
      const edge = state.board.edges[e]!;
      const other = edge.a === v ? edge.b : edge.a;
      const otherPiece = state.pieces[other];
      // Extend through `other` unless blocked by opponent building.
      const canPass = !otherPiece || otherPiece.owner === pid;
      const branch = canPass ? 1 + dfs(other, used) : 1;
      if (branch > best) best = branch;
      used.delete(e);
    }
    return best;
  }

  for (const v of vertEdges.keys()) {
    const len = dfs(v, new Set());
    if (len > longest) longest = len;
  }
  return longest;
}

export function recomputeLargestArmy(state: GameState): { holder: PlayerId | null } {
  let best = 2; // must exceed 2 to qualify (>= 3)
  let holder: PlayerId | null = state.largestArmyHolder;
  for (const p of state.players) {
    if (p.knightsPlayed >= 3 && p.knightsPlayed > best) {
      best = p.knightsPlayed;
      holder = p.id;
    }
  }
  return { holder };
}

function applyRecomputes(state: GameState): GameState {
  const lr = recomputeLongestRoad(state);
  const la = recomputeLargestArmy(state);
  const players = state.players.map((p) => ({
    ...p,
    hasLongestRoad: lr.holder === p.id,
    hasLargestArmy: la.holder === p.id,
    longestRoadLength: lr.lengths[p.id] ?? p.longestRoadLength,
  }));
  return {
    ...state,
    players,
    longestRoadHolder: lr.holder,
    largestArmyHolder: la.holder,
  };
}

function checkVictory(state: GameState): GameState {
  for (const p of state.players) {
    if (playerVP(state, p) >= VP_TO_WIN) {
      const next = log(state, {
        who: p.id,
        kind: 'victory',
        text: `${p.name} wins with ${VP_TO_WIN}+ victory points.`,
      });
      return { ...next, phase: 'GAME_OVER', winner: p.id };
    }
  }
  return state;
}

function computeDiscards(state: GameState): DiscardRequirement[] {
  const out: DiscardRequirement[] = [];
  for (const p of state.players) {
    const total = handTotal(p.hand);
    if (total > 7) out.push({ playerId: p.id, count: Math.floor(total / 2) });
  }
  return out;
}

// ---------- Reducer ----------

export function reduce(state: GameState, action: Action): GameState {
  const actor: PlayerId =
    action.kind === 'DISCARD' ? action.playerId : state.currentPlayer;
  const legality = canDo(state, action, actor);
  if (!legality.ok) throw new Error(legality.reason ?? 'illegal action');

  let s: GameState = { ...state, lastAction: action };

  switch (action.kind) {
    case 'ROLL': {
      const r1 = rngStep(s.rngState);
      const r2 = rngStep(r1.state);
      const a = 1 + Math.floor(r1.value * 6);
      const b = 1 + Math.floor(r2.value * 6);
      const dice: DiceRoll = { a, b, sum: a + b };
      s = { ...s, rngState: r2.state, dice, hasRolledThisTurn: true };
      s = log(s, {
        who: s.currentPlayer,
        kind: 'roll',
        text: `${playerName(s, s.currentPlayer)} rolled ${dice.sum} (${a}+${b}).`,
      });
      if (dice.sum === 7) {
        const reqs = computeDiscards(s);
        if (reqs.length > 0) {
          s = { ...s, pendingDiscards: reqs, phase: 'DISCARD' };
        } else {
          s = { ...s, phase: 'MOVE_ROBBER' };
        }
      } else {
        s = produceResources(s, dice.sum);
        s = { ...s, phase: 'ACTION' };
      }
      return s;
    }

    case 'DISCARD': {
      s = updatePlayerHand(
        s,
        action.playerId,
        Object.fromEntries(
          Object.entries(action.cards).map(([k, v]) => [k, -(v ?? 0)]),
        ) as Partial<Record<Resource, number>>,
      );
      const remaining = s.pendingDiscards.filter((d) => d.playerId !== action.playerId);
      const total = Object.values(action.cards).reduce<number>((a, b) => a + (b ?? 0), 0);
      s = log(s, {
        who: action.playerId,
        kind: 'robber',
        text: `${playerName(s, action.playerId)} discarded ${total}.`,
      });
      if (remaining.length === 0) {
        s = { ...s, pendingDiscards: [], phase: 'MOVE_ROBBER' };
      } else {
        s = { ...s, pendingDiscards: remaining };
      }
      return s;
    }

    case 'MOVE_ROBBER': {
      s = applyRobberMove(s, action.tile, action.victim);
      s = { ...s, phase: 'ACTION' };
      return s;
    }

    case 'BUILD_SETTLEMENT': {
      const isSetup =
        s.phase === 'SETUP_1_SETTLEMENT' || s.phase === 'SETUP_2_SETTLEMENT';
      if (!isSetup && !action.free) s = spend(s, actor, BUILD_COSTS.settlement);
      const piece: VertexPiece = { owner: actor, kind: 'settlement' };
      s = { ...s, pieces: { ...s.pieces, [action.vertex]: piece } };
      s = log(s, {
        who: actor,
        kind: 'build',
        text: `${playerName(s, actor)} built a settlement.`,
      });
      // Second-setup settlement grants adjacent resources.
      if (s.phase === 'SETUP_2_SETTLEMENT') {
        s = grantSecondSetupResources(s, action.vertex);
      }
      if (isSetup) s = nextSetupPhase(s);
      s = applyRecomputes(s);
      s = checkVictory(s);
      return s;
    }

    case 'BUILD_ROAD': {
      const isSetup = s.phase === 'SETUP_1_ROAD' || s.phase === 'SETUP_2_ROAD';
      const isRoadBuilding =
        s.phase === 'ROAD_BUILDING_1' || s.phase === 'ROAD_BUILDING_2';
      if (!isSetup && !isRoadBuilding && !action.free) {
        s = spend(s, actor, BUILD_COSTS.road);
      }
      s = { ...s, roads: { ...s.roads, [action.edge]: actor } };
      s = log(s, {
        who: actor,
        kind: 'build',
        text: `${playerName(s, actor)} built a road.`,
      });
      if (isSetup) s = nextSetupPhase(s);
      if (s.phase === 'ROAD_BUILDING_1') s = { ...s, phase: 'ROAD_BUILDING_2' };
      else if (s.phase === 'ROAD_BUILDING_2') s = { ...s, phase: 'ACTION' };
      s = applyRecomputes(s);
      s = checkVictory(s);
      return s;
    }

    case 'BUILD_CITY': {
      s = spend(s, actor, BUILD_COSTS.city);
      const piece: VertexPiece = { owner: actor, kind: 'city' };
      s = { ...s, pieces: { ...s.pieces, [action.vertex]: piece } };
      s = log(s, {
        who: actor,
        kind: 'build',
        text: `${playerName(s, actor)} built a city.`,
      });
      s = applyRecomputes(s);
      s = checkVictory(s);
      return s;
    }

    case 'BUY_DEV_CARD': {
      s = spend(s, actor, BUILD_COSTS.dev);
      const card = s.devDeck[0]!;
      const rest = s.devDeck.slice(1);
      const { state: rngAdvanced } = advanceRng({ ...s, devDeck: rest });
      s = rngAdvanced;
      const dc: DevCard = { kind: card, boughtOnTurn: s.turn, played: false };
      const player = s.players[actor]!;
      s = patchPlayer(s, actor, { devCards: [...player.devCards, dc] });
      s = log(s, {
        who: actor,
        kind: 'dev',
        text: `${playerName(s, actor)} bought a development card.`,
      });
      s = checkVictory(s); // VP cards can win
      return s;
    }

    case 'PLAY_KNIGHT': {
      s = markDevPlayed(s, actor, 'knight');
      const p = s.players[actor]!;
      s = patchPlayer(s, actor, { knightsPlayed: p.knightsPlayed + 1 });
      s = log(s, {
        who: actor,
        kind: 'dev',
        text: `${playerName(s, actor)} played Knight.`,
      });
      s = applyRobberMove(s, action.tile, action.victim);
      s = applyRecomputes(s);
      s = checkVictory(s);
      return s;
    }

    case 'PLAY_ROAD_BUILDING': {
      s = markDevPlayed(s, actor, 'roadBuilding');
      s = log(s, {
        who: actor,
        kind: 'dev',
        text: `${playerName(s, actor)} played Road Building.`,
      });
      s = { ...s, phase: 'ROAD_BUILDING_1' };
      return s;
    }

    case 'PLAY_MONOPOLY': {
      s = markDevPlayed(s, actor, 'monopoly');
      let taken = 0;
      const players = s.players.map((p) => {
        if (p.id === actor) return p;
        const amount = p.hand[action.resource];
        taken += amount;
        return { ...p, hand: { ...p.hand, [action.resource]: 0 } };
      });
      s = { ...s, players };
      s = updatePlayerHand(s, actor, { [action.resource]: taken });
      s = log(s, {
        who: actor,
        kind: 'dev',
        text: `${playerName(s, actor)} monopolized ${action.resource} (+${taken}).`,
      });
      return s;
    }

    case 'PLAY_YEAR_OF_PLENTY': {
      s = markDevPlayed(s, actor, 'yearOfPlenty');
      const [r1, r2] = action.resources;
      s = updatePlayerHand(s, actor, { [r1]: 1 });
      s = updatePlayerHand(s, actor, { [r2]: 1 });
      s = log(s, {
        who: actor,
        kind: 'dev',
        text: `${playerName(s, actor)} took ${r1} + ${r2}.`,
      });
      return s;
    }

    case 'TRADE_BANK': {
      const ratio = bankTradeRatio(s, actor, action.give);
      s = updatePlayerHand(s, actor, { [action.give]: -ratio, [action.getR]: +1 });
      s = log(s, {
        who: actor,
        kind: 'trade',
        text: `${playerName(s, actor)} traded ${ratio} ${action.give} → 1 ${action.getR}.`,
      });
      return s;
    }

    case 'END_TURN': {
      s = advanceTurn(s);
      return s;
    }

    default: {
      // Exhaustiveness
      const _never: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(_never)}`);
    }
  }
}

// Grant adjacent resources on second-setup settlement. Inline to avoid a
// circular import with setup.ts.
function grantSecondSetupResources(state: GameState, vertex: VertexId): GameState {
  const v = state.board.vertices[vertex];
  if (!v) return state;
  const piece = state.pieces[vertex];
  if (!piece) return state;
  let next = state;
  for (const tId of v.tiles) {
    const t: Tile | undefined = next.board.tiles[tId];
    if (!t || t.terrain === 'desert') continue;
    next = updatePlayerHand(next, piece.owner, { [t.terrain as Resource]: 1 });
  }
  next = log(next, {
    who: piece.owner,
    kind: 'setup',
    text: `${playerName(next, piece.owner)} collects starting resources.`,
  });
  return next;
}

function markDevPlayed(state: GameState, pid: PlayerId, kind: DevCardKind): GameState {
  const p = state.players[pid];
  if (!p) return state;
  // Mark the oldest unplayed, not-this-turn card of the kind.
  let marked = false;
  const devCards: DevCard[] = p.devCards.map((d) => {
    if (!marked && d.kind === kind && !d.played && d.boughtOnTurn < state.turn) {
      marked = true;
      return { ...d, played: true };
    }
    return d;
  });
  return patchPlayer(state, pid, { devCards, playedDevThisTurn: true });
}
