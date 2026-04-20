# SPEC — Catan (Web, TypeScript, Vercel, vs AI)

## Game rules (simplified Catan for vs-AI web play)

- **Players:** 1 human + 3 AI, colors `crimson`, `sapphire`, `emerald`, `amber`.
- **Board:** standard 19 land hexes — 4 wood, 4 wheat, 4 sheep, 3 brick, 3 ore,
  1 desert. Number tokens 2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12 shuffled to
  non-desert tiles. Coastal 18 ports with 4 generic (3:1) and 5 specific (2:1).
- **Setup:** snake order place 2 settlements + 2 adjacent roads each. Second
  settlement grants starting resources from its three adjacent tiles.
- **Turn:**
  1. `ROLL` — d6 + d6.
  2. `PRODUCE` — each non-robbed tile matching the roll gives 1 resource per
     settlement, 2 per city to its owner.
  3. On a 7: every player with >7 cards discards half (rounded down). Current
     player moves the robber to a new tile and steals 1 random resource from
     a player with a settlement/city there.
  4. `ACTION` — any order, any number: trade with bank (4:1 or port ratio),
     build, play 1 dev card (not on purchase turn except Victory).
  5. `END` — pass turn.
- **Build costs:**
  - Road: wood + brick
  - Settlement: wood + brick + wheat + sheep (must touch own road, not adjacent
    to any settlement/city)
  - City: 2 wheat + 3 ore (upgrades own settlement)
  - Dev card: wheat + sheep + ore
- **Victory:** 10 VP. Settlement=1, City=2, VP card=1, Longest Road=2,
  Largest Army=2. Longest road requires 5+; largest army requires 3+ knights.
- **Dev cards:** Knight (move robber + steal; counts to army), VP (hidden),
  Road Building (2 free roads), Monopoly (take all of 1 resource from rivals),
  Year of Plenty (2 free bank resources).

## Architecture

```
app/
  layout.tsx        # Root layout, fonts, <body>
  page.tsx          # 'use client' shell: <Board/> + <Sidebar/>
  globals.css       # Design tokens + resets
src/
  game/
    types.ts        # SHARED CONTRACT — read-only for engine + AI + UI
    board.ts        # Hex geometry, tile/vertex/edge IDs, port map
    setup.ts        # initialState(seed), snake setup helpers
    rules.ts        # canDoAction(state, action) → { ok, reason? }
    actions.ts      # reduce(state, action) → state
    dev-cards.ts    # Dev card deck + effects
  ai/
    agent.ts        # decide(state, playerId) → Action
    heuristics.ts   # Scoring functions (value of vertex, production)
  components/
    Board.tsx       # SVG hex board
    Sidebar.tsx     # Phase header, roster, resources, controls
    Log.tsx         # Scrolling action log
    Toasts.tsx      # Transient notifications
    Modals.tsx      # Discard / robber / monopoly / YoP / victory
  hooks/
    useGame.ts      # useReducer + localStorage + AI loop
  lib/
    random.ts       # Seeded PRNG (mulberry32)
```

## Phase state machine

```
SETUP_1_PLACE_SETTLEMENT → SETUP_1_PLACE_ROAD →
SETUP_2_PLACE_SETTLEMENT → SETUP_2_PLACE_ROAD →
  (repeat across players in snake order) →
MAIN[ROLL → (DISCARD → MOVE_ROBBER → STEAL)? → ACTION → END]
```

## Action shape (discriminated union)

```ts
type Action =
  | { kind: 'ROLL' }
  | { kind: 'BUILD_ROAD'; edge: EdgeId }
  | { kind: 'BUILD_SETTLEMENT'; vertex: VertexId }
  | { kind: 'BUILD_CITY'; vertex: VertexId }
  | { kind: 'BUY_DEV_CARD' }
  | { kind: 'PLAY_KNIGHT'; tile: TileId; victim: PlayerId | null }
  | { kind: 'PLAY_ROAD_BUILDING'; edges: [EdgeId, EdgeId?] }
  | { kind: 'PLAY_MONOPOLY'; resource: Resource }
  | { kind: 'PLAY_YEAR_OF_PLENTY'; resources: [Resource, Resource] }
  | { kind: 'TRADE_BANK'; give: Resource; getR: Resource }
  | { kind: 'DISCARD'; cards: Partial<Record<Resource, number>> }
  | { kind: 'MOVE_ROBBER'; tile: TileId; victim: PlayerId | null }
  | { kind: 'END_TURN' };
```

## Pipeline gates

1. `npm run type-check` — `tsc --noEmit` must pass.
2. `npm run lint` — `eslint` must pass with 0 warnings.
3. `npm run build` — `next build` must pass (Vercel parity).
4. Runtime sanity: initial state construction must not throw; an AI-only
   auto-play of 50 turns must terminate in a well-formed state.

## Visual contract

- Design tokens from PERSONA. Board hex fills by terrain:
  - wood `#166534`, brick `#b45309`, wheat `#ca8a04`, sheep `#84cc16`,
    ore `#64748b`, desert `#78716c`.
- Roads = 6px colored lines along edges.
- Settlements = 14px filled squares at vertices.
- Cities = 18px filled squares with inner stroke.
- Robber = 24px dark circle with amber ring over a tile.
- Dice = 42px rounded squares, amber ring, mono pips.

## Save/Load

- On every `reduce` the engine snapshots `state` to
  `localStorage['catan:save']`. On mount, `useGame` rehydrates if present.
- Header shows **NEW GAME** and **RESTART** buttons.
