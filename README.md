# Catan — The Cartographer's Edition

A single-page **Settlers of Catan** you play against three AI opponents in
the browser. Built in TypeScript on Next.js 14, deterministic engine,
zero backend. Deploys to Vercel as-is.

> *Drafted from the aesthetic DNA of RISK: Cold War Edition — see
> [`PERSONA.md`](./PERSONA.md) for the design voice and
> [`SPEC.md`](./SPEC.md) for the rules/architecture contract.*

---

## Highlights

- **Deterministic engine.** Pure-TypeScript reducer; all randomness flows
  through a seeded mulberry32 PRNG. Same seed + same inputs replays exactly.
- **Double-gated validators.** Every action is checked once by the UI (to
  enable a button) and again by the reducer (before mutating). Illegal state
  is unreachable.
- **Four AI archetypes.** `Quill`, `Grim`, `Bracken`, `Saffron` — each a
  personality bundle of resource, build, and aggression weights. Picks are
  telegraphed through moods and a single action log.
- **Save on every turn.** State is serialized to `localStorage` after each
  transition. Refreshing the tab resumes the game.
- **Single page, no backend.** Next.js App Router, one `'use client'` shell,
  no API routes, no env vars.
- **CI gate.** Every push runs `tsc --noEmit` → `eslint` → an AI-only smoke
  playthrough → `next build`. If the gate passes, Vercel deploys.

---

## Quickstart

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint (next/core-web-vitals)
npm run smoke        # AI-only auto-play sanity (seeded)
npm run build        # next build (Vercel parity)
npm run gate         # type-check + lint + smoke + build, fail-fast
```

Set a specific seed for smoke runs:

```bash
SMOKE_SEED=1234567 npm run smoke
```

---

## How to play

1. **Setup.** Snake order — each player places two settlements and two
   adjacent roads. The second settlement grants its three adjacent tiles as
   starting resources.
2. **Roll.** Two dice. Non-robbed tiles matching the roll pay 1 resource
   per settlement, 2 per city, to their owner.
3. **On a 7.** Any player holding more than 7 cards discards half. The
   current player moves the robber and steals one random card from a
   settlement/city on the new tile.
4. **Action phase.** Any order, any number: trade with the bank (4:1, or
   3:1/2:1 through ports), build (road / settlement / city), buy or play a
   development card. One dev card per turn; the one you just bought cannot
   be played this turn.
5. **Victory.** First to **10 VP**. Settlement = 1, City = 2, VP card = 1,
   Longest Road (≥ 5) = 2, Largest Army (≥ 3 knights) = 2.

The sidebar always shows, in one line, what you may legally do next.

---

## Architecture at a glance

```
app/                  Next.js shell — layout, page ('use client'), globals.css
src/game/             Pure engine — types, board, rules, reducer, dev deck
src/ai/               Pure AI — decide(state) → Action, heuristics, personalities
src/components/       Thin React renders — Board, Sidebar, Modals, Toasts, Log
src/hooks/useGame.ts  useReducer + localStorage + AI setTimeout loop
src/lib/random.ts     Mulberry32 PRNG
scripts/              smoke.ts (auto-play) + gate.mjs (pipeline runner)
```

Path alias: `@/*` → `./src/*`.

The engine never imports React; the AI never mutates state; components never
hold game logic. Full invariants and "how to add X" walkthroughs live in
[`CLAUDE.md`](./CLAUDE.md).

---

## Deploy

Push the branch. Import the repo into Vercel and accept the detected Next.js
settings — no env vars required. `vercel.json` pins framework detection.
The CI gate (`.github/workflows/ci.yml`) runs the same checks Vercel does,
so a green gate is a green deploy.

---

## Contributing

- Follow [`PERSONA.md`](./PERSONA.md) for voice and [`CLAUDE.md`](./CLAUDE.md)
  for engineering invariants.
- Every change must pass `npm run gate` locally.
- Keep commits small, lowercase-subject, declarative. No emoji.
- Open a PR only when the change is ready to review; the gate runs on every
  push.

---

## License

Unreleased / private build. Ask before redistributing.
