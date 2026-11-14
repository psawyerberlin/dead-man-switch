---
project: dms-ui
default_model: sonnet
protected_paths: [acceptance/, SPEC.md, AIWORKER.md, aiworker/, spec/vectors/]
source:
  repo: git@github.com:psawyerberlin/dead-man-switch.git
  ref: aiworker/dms-core
  key: dead-man-switch
push:
  branch: aiworker/dms-ui
  when: phase
---

# Concept
dead-man-switch is a web application on top of CRT: the user writes a letter, it is encrypted and sealed in a CRT vault, the user checks in regularly, and if they stop, the guardians (CSR runners) release the key so that the recipients can open the letter. Languages: English, French, German (fixed vocabulary in `SPEC.md`). Stack: TypeScript, Vite, no UI framework beyond what the files say, no analytics, no external fonts or CDNs, `@crt/client` from the CRT repository.
## How this project runs (read first)

This repository already contains the full design: `SPEC.md` is **normative**, and the file named in each phase
under `aiworker/` holds the exact interfaces, file names, test names and deliverables of that phase. The
acceptance tests already exist under `acceptance/` and are protected: do not edit them, implement what they check.
`AIWORKER.md` describes the same work from an earlier, tool-independent point of view; where it or the
`aiworker/*.md` files mention branches, commits, pushes, pull requests, a `../ckb-service-runner` or
`../ckb-revocable-timelock` checkout, or running things on a devnet, **the rules below win**:

* The orchestrator commits and pushes. You never run `git commit`, `git push`, `git tag` or open pull requests.
* You may only touch files inside this directory. Wherever the files say `../ckb-revocable-timelock`, use the
  read-only reference clone `.refs/crt` (create it if it is missing, it is git-ignored):
  `[ -d .refs/crt ] || git clone --depth 1 --branch main https://github.com/psawyerberlin/ckb-revocable-timelock .refs/crt`.
  Build `@crt/client` from `.refs/crt/client` (`npm ci && npm run build` there) and depend on it as a file dependency of `app/`.
* Nothing runs on a devnet or testnet here (no node binaries, no funds, no Docker). Scripts that need one are
  written and statically checked only; running them is a manual phase at the end of the last project.
* No sudo. Rust lives in the user's home (`$HOME/.cargo`, installed with rustup, minimal profile, stable toolchain,
  target `riscv64imac-unknown-none-elf`). Every shell command that needs `cargo` starts with
  `. "$HOME/.cargo/env"`. The machine has 3 GB RAM: build with `CARGO_BUILD_JOBS=2`, never build in parallel
  with other heavy jobs, and prefer `cargo test` without `--release` unless a phase says otherwise.
* Node 22, npm, Python 3.14 are available. No browser. Tests must run offline once dependencies are installed.
* Record every decision in `DECISIONS.md` (root of the repository), newest at the top, one section per phase.
* No secrets anywhere in the repository. `.gitignore` must contain `target/`, `build/`, `node_modules/`, `.refs/`,
  `.devnet/`, `dist/`.


This project: the screens Write, My switches and Open, in three languages (`aiworker/02-dms-ui.md`).

## Phase 1: Shell

### Instructions
Read `aiworker/02-dms-ui.md`, section "Phase 1", the introduction of that file, and the `SPEC.md` sections named there. Implement exactly that phase; translation keys, file names and test names as written.

### Acceptance
```bash
cd app && npm run typecheck
cd app && npm run build
```

## Phase 2: Write

### Instructions
Read `aiworker/02-dms-ui.md`, section "Phase 2", the introduction of that file, and the `SPEC.md` sections named there. Implement exactly that phase; translation keys, file names and test names as written.

### Acceptance
```bash
cd app && npm test
cd app && npm run build
```

## Phase 3: My switches and Open

### Instructions
Read `aiworker/02-dms-ui.md`, section "Phase 3", the introduction of that file, and the `SPEC.md` sections named there. Implement exactly that phase; translation keys, file names and test names as written.

### Acceptance
```bash
cd app && npm test
cd app && npm run build
```

## Phase 4: Quality and build

### Instructions
Read `aiworker/02-dms-ui.md`, section "Phase 4", the introduction of that file, and the `SPEC.md` sections named there. Implement exactly that phase; translation keys, file names and test names as written.

### Acceptance
```bash
node --test acceptance/aiworker-dms-ui/
node acceptance/aiworker-dms-ui/named.mjs
```
