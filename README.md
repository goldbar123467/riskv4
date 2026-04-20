# Catan — The Cartographer's Edition

Single-page Settlers of Catan you play against 3 AI opponents in the browser.
TypeScript, Next.js App Router, zero backend. Deploys to Vercel as-is.

See [`PERSONA.md`](./PERSONA.md) for the design voice and [`SPEC.md`](./SPEC.md)
for the rules/architecture contract.

## Run

```bash
npm install
npm run dev          # localhost:3000
npm run gate         # type-check + lint + build
```

## Deploy

Push the branch. Import the repo into Vercel and accept the detected Next.js
settings — no env vars required.
