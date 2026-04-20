'use client';

// useGame — single source of truth for UI. Wraps engine reducer + AI loop.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Action, GameState, Legality, PlayerId } from '@/game/types';
import { initialState } from '@/game/setup';
import { reduce } from '@/game/actions';
import { canDo as engineCanDo } from '@/game/rules';
import { decide } from '@/ai/agent';
import { personalities } from '@/ai/personalities';

const SAVE_KEY = 'catan:save';
const AI_DELAY_MS = 700;

type ReducerAction =
  | { type: 'ACTION'; action: Action }
  | { type: 'RESET'; state: GameState };

function engineReducer(state: GameState, action: ReducerAction): GameState {
  switch (action.type) {
    case 'ACTION':
      return reduce(state, action.action);
    case 'RESET':
      return action.state;
  }
}

function makeSeed(): number {
  return (Date.now() & 0xffffffff) >>> 0;
}

function freshState(seed?: number): GameState {
  return initialState({
    seed: seed ?? makeSeed(),
    aiPersonalities: personalities,
  });
}

function loadSaved(): GameState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || typeof parsed !== 'object' || !parsed.board) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface UseGameResult {
  readonly state: GameState;
  readonly dispatch: (action: Action) => void;
  readonly newGame: (seed?: number) => void;
  readonly save: () => void;
  readonly canDo: (action: Action) => Legality;
  readonly currentActorIsAI: boolean;
}

export function useGame(): UseGameResult {
  const [state, rawDispatch] = useReducer(engineReducer, undefined, () => freshState());
  const hydratedRef = useRef(false);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rehydrate on mount — once.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const saved = loadSaved();
    if (saved) rawDispatch({ type: 'RESET', state: saved });
  }, []);

  // Persist every state change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch {
      // quota / private mode — ignore.
    }
  }, [state]);

  const dispatch = useCallback((action: Action) => {
    rawDispatch({ type: 'ACTION', action });
  }, []);

  const newGame = useCallback((seed?: number) => {
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    }
    rawDispatch({ type: 'RESET', state: freshState(seed) });
  }, []);

  const save = useCallback(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const canDo = useCallback((action: Action): Legality => engineCanDo(state, action), [state]);

  // AI loop — step whenever the current actor is an AI and a pending
  // requirement is on an AI (discard on 7, for instance).
  const actor = currentActor(state);
  const currentActorIsAI: boolean = state.winner === null && actor !== null && state.players[actor]?.isAI === true;

  useEffect(() => {
    if (aiTimerRef.current) {
      clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    if (state.winner !== null) return;
    const who = currentActor(state);
    if (who === null) return;
    const player = state.players[who];
    if (!player || !player.isAI) return;
    aiTimerRef.current = setTimeout(() => {
      try {
        const act = decide(state, who);
        rawDispatch({ type: 'ACTION', action: act });
      } catch {
        // If the AI errors out, skip a beat — a human may take over.
      }
    }, AI_DELAY_MS);
    return () => {
      if (aiTimerRef.current) {
        clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [state]);

  return { state, dispatch, newGame, save, canDo, currentActorIsAI };
}

// Whoever must act next. For DISCARD we yield to the first player who still owes cards.
function currentActor(state: GameState): PlayerId | null {
  if (state.winner !== null) return null;
  if (state.phase === 'DISCARD' && state.pendingDiscards.length > 0) {
    return state.pendingDiscards[0]!.playerId;
  }
  return state.currentPlayer;
}
