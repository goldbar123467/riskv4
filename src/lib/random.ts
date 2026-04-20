// Mulberry32 — tiny, deterministic, fast enough for game RNG.
// All engine randomness must flow through here so games are replayable.

export type RngFn = () => number;

/** Deterministic [0,1) generator closed over a mutable internal state. */
export function makeRng(seed: number): RngFn {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure single-step. Advance the state once; return next state + [0,1) value. */
export function rngStep(state: number): { state: number; value: number } {
  let s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: s >>> 0, value };
}

export function randInt(rngFn: RngFn, maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  return Math.floor(rngFn() * maxExclusive);
}

export function shuffle<T>(arr: readonly T[], rngFn: RngFn): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rngFn() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function pickWeighted<T>(items: readonly T[], weights: readonly number[], rngFn: RngFn): T {
  if (items.length === 0) throw new Error('pickWeighted: empty');
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return items[randInt(rngFn, items.length)]!;
  let r = rngFn() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i] ?? 0);
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
