---
project: dms-e2e
default_model: sonnet
protected_paths: [acceptance/, SPEC.md, AIWORKER.md, aiworker/, spec/vectors/]
source:
  repo: git@github.com:psawyerberlin/dead-man-switch.git
  ref: aiworker/dms-ui
  key: dead-man-switch
push:
  branch: aiworker/dms-e2e
  when: phase
---

# Concept
dead-man-switch is a web application on top of CRT (CKB Revocable Timelock): the owner writes letters for up to ten recipients, everything is encrypted in the browser and sealed in one CRT vault per recipient, the owner checks in regularly, and if they stop, the guardians (CSR runners) release the key on the CKB chain so that each recipient can open their vault. A small optional service, the messenger (notifier), reminds the owner before each deadline, raises alarms during the 24 h grace and, after release, emails each recipient the link to their vault; it never holds the key before release and never sees a letter. Testnet has a fire drill (30 min to 48 h). Languages: English, French, German (fixed vocabulary in `SPEC.md` §2). The visual design of `SPEC.md` §8 is part of the work. Stack: TypeScript, Vite, no UI framework, no analytics, no external fonts or CDNs, `@crt/client` from the CRT repository; the notifier is Node 22 with `node:http`, `node:sqlite` and `nodemailer`.
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


This project: end-to-end scenario, packaging and deployment files (`aiworker/04-dms-e2e.md`).

## Phase 1: Scripted scenario (written, not run)
model: opus
timeout: 120m

### Instructions
Read `aiworker/04-dms-e2e.md`, section "Phase 1", the introduction of that file, and the `SPEC.md` sections named there. Implement exactly that phase; translation keys, file names and test names as written. Write `test/e2e/scenario.mjs`; do NOT run it (it needs a devnet and headless Chromium, neither exists here). It must pass `node --check`.

### Acceptance
```bash
node --check test/e2e/scenario.mjs
```

## Phase 2: Packaging, deployment files and manual-steps file

### Instructions
Read `aiworker/04-dms-e2e.md`, section "Phase 2", the introduction of that file, and the `SPEC.md` sections named there. Implement exactly that phase; translation keys, file names and test names as written. Also write `docs/manual-steps.md` as section 'Phase 3 — the manual step' of the file describes, with exact commands and real paths; the human performs it in the last phase of this project.

### Acceptance
```bash
bash -n scripts/build-site.sh
node --test acceptance/aiworker-dms-e2e/
```

## Phase 3: The manual step (manual)

### Instructions
Manual: follow `docs/manual-steps.md` (organiser address, build and commit `site/app/`, devnet scenario, VPS deployment with the notifier and Caddy, the testnet fire drills, updates by `git pull`). Mark this phase passed in the web interface when done.

### Acceptance
```bash
true
```
