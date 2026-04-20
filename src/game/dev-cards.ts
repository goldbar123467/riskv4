// Dev card deck management. Deterministic shuffle is the caller's job
// (initialState uses rngStep). Drawing consumes the state's rngState.

import type { DevCardKind, GameState } from '@/game/types';
import { rngStep } from '@/lib/random';

// Classic 25-card deck.
export function initialDeck(): DevCardKind[] {
  const deck: DevCardKind[] = [];
  for (let i = 0; i < 14; i++) deck.push('knight');
  for (let i = 0; i < 5; i++) deck.push('victoryPoint');
  for (let i = 0; i < 2; i++) deck.push('roadBuilding');
  for (let i = 0; i < 2; i++) deck.push('monopoly');
  for (let i = 0; i < 2; i++) deck.push('yearOfPlenty');
  return deck;
}

// Draw the top card (FIFO). The deck was shuffled at construction, so simply
// pop from index 0. rngState is advanced so draws have a unique signature
// even when the deck is pre-shuffled.
export function drawDevCard(
  state: GameState,
): { state: GameState; card: DevCardKind | null } {
  if (state.devDeck.length === 0) {
    return { state, card: null };
  }
  const { state: nextRng } = rngStep(state.rngState);
  const card = state.devDeck[0]!;
  const devDeck = state.devDeck.slice(1);
  return {
    state: { ...state, rngState: nextRng, devDeck },
    card,
  };
}
