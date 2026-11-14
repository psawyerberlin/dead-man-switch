## What and why

Spec: `aiworker/NN-….md`, phases done: 

## How tested

- [ ] `node --test acceptance/aiworker-<name>/` and `node acceptance/aiworker-<name>/named.mjs` green
- [ ] `npm run typecheck` / `npm run lint` / `npm run build`
- [ ] `npm test` (if TypeScript changed)
- [ ] devnet scenario output pasted into `DECISIONS.md` (spec 03)

## Decisions

See `DECISIONS.md` section for this spec. Proposed `SPEC.md` changes (the worker cannot edit it):

## Security-sensitive?

- [ ] touches `app/src/core` or `app/src/opener` (needs two reviews)
