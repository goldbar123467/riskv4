// Runtime sanity gate: construct initial state, let all AIs auto-play until
// either a victor emerges or MAX_ACTIONS is hit. Asserts the engine never
// wedges and every action remains legal.
//
// Run with: npx tsx scripts/smoke.ts

import { initialState } from '../src/game/setup';
import { reduce } from '../src/game/actions';
import { decide } from '../src/ai/agent';
import { PERSONALITIES } from '../src/ai/personalities';
import { canDo } from '../src/game/rules';
import type { PlayerId } from '../src/game/types';

const MAX_ACTIONS = 4000;
const seed = Number(process.env.SMOKE_SEED ?? (Date.now() & 0xffffffff)) >>> 0;

let state = initialState({ seed, aiPersonalities: PERSONALITIES });
// Force all seats AI for the smoke test.
state = {
  ...state,
  players: state.players.map((p, i) => ({
    ...p,
    isAI: true,
    personality: p.personality ?? PERSONALITIES[i % PERSONALITIES.length],
  })),
};

let steps = 0;
while (state.winner === null && steps < MAX_ACTIONS) {
  const actor: PlayerId =
    state.phase === 'DISCARD' && state.pendingDiscards.length > 0
      ? state.pendingDiscards[0]!.playerId
      : state.currentPlayer;

  const action = decide(state, actor);

  const legality = canDo(state, action, actor);
  if (!legality.ok) {
    console.error(
      `smoke: illegal action from AI — ${JSON.stringify(action)} (${legality.reason}) in phase ${state.phase}`,
    );
    process.exit(1);
  }

  state = reduce(state, action);
  steps++;
}

const turn = state.turn;
if (state.winner === null) {
  console.log(
    `smoke: no victor in ${steps} actions (turn ${turn}) — engine stayed well-formed (seed ${seed})`,
  );
} else {
  const winner = state.players[state.winner];
  console.log(
    `smoke: ${winner?.name ?? `P${state.winner}`} won in ${steps} actions (turn ${turn}, seed ${seed})`,
  );
}
