// Four archetype personalities for Catan AI. Weights live in 0..1.
// Inspired by RISK Cold War's Personality/Goal/Plan/Mood quartet.

import type { AIPersonality, PlayerColor } from '@/game/types';

export const QUILL: AIPersonality = {
  id: 'quill',
  label: 'Quill — Merchant of Ambers',
  weights: {
    wheat: 0.72,
    ore: 0.55,
    wood: 0.58,
    brick: 0.58,
    sheep: 0.62,
    cityBias: 0.55,
    devBias: 0.78,
    roadBias: 0.40,
    aggression: 0.35,
  },
};

export const GRIM: AIPersonality = {
  id: 'grim',
  label: 'Grim — Miner of Crimson Depths',
  weights: {
    wheat: 0.80,
    ore: 0.92,
    wood: 0.35,
    brick: 0.40,
    sheep: 0.30,
    cityBias: 0.90,
    devBias: 0.45,
    roadBias: 0.25,
    aggression: 0.80,
  },
};

export const BRACKEN: AIPersonality = {
  id: 'bracken',
  label: 'Bracken — Forester of Emerald Marches',
  weights: {
    wheat: 0.55,
    ore: 0.30,
    wood: 0.88,
    brick: 0.85,
    sheep: 0.45,
    cityBias: 0.30,
    devBias: 0.35,
    roadBias: 0.90,
    aggression: 0.55,
  },
};

export const SAFFRON: AIPersonality = {
  id: 'saffron',
  label: 'Saffron — Shepherd of Sapphire Pastures',
  weights: {
    wheat: 0.78,
    ore: 0.50,
    wood: 0.40,
    brick: 0.40,
    sheep: 0.90,
    cityBias: 0.50,
    devBias: 0.85,
    roadBias: 0.30,
    aggression: 0.25,
  },
};

export const PERSONALITIES: readonly AIPersonality[] = [QUILL, GRIM, BRACKEN, SAFFRON];

// Stable mapping so seat colours get a signature archetype.
export const PERSONALITY_BY_COLOR: Readonly<Record<PlayerColor, AIPersonality>> = {
  amber: QUILL,
  crimson: GRIM,
  emerald: BRACKEN,
  sapphire: SAFFRON,
};

export function personalityById(id: string): AIPersonality | undefined {
  return PERSONALITIES.find((p) => p.id === id);
}
