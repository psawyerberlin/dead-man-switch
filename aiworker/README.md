# AIWorker specs

The work is built by **AIWorker** (pswsl). Upload the files of `specs/` one project at a time, in this order. Each project
starts from the branch the previous one pushed; merge the pull requests oldest first.

| Order | Upload | Starts from | Pushes to | Details in |
|---|---|---|---|---|
| 1 | `specs/dms-core.md` | `main` | `aiworker/dms-core` | `01-dms-core.md` |
| 2 | `specs/dms-notifier.md` | `aiworker/dms-core` | `aiworker/dms-notifier` | `02-dms-notifier.md` |
| 3 | `specs/dms-ui.md` | `aiworker/dms-notifier` | `aiworker/dms-ui` | `03-dms-ui.md` |
| 4 | `specs/dms-e2e.md` | `aiworker/dms-ui` | `aiworker/dms-e2e` | `04-dms-e2e.md` |

Prerequisites: the CRT repository's `main` at or after commit `7ceca10` (30-minute minimum term on testnet, the testnet
runner list), readable without credentials (public), because AIWorker's Claude has no GitHub access; the specs clone it
into `.refs/crt` and build `@crt/client` from it. This repository and its deploy key must be in AIWorker's allow-list
under the key name `dead-man-switch` (AIWorker guide, section 7a).

Acceptance: `node --test acceptance/aiworker-<name>/` and, where present, `node acceptance/aiworker-<name>/named.mjs`.
