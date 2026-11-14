# AIWorker specs

The work is built by **AIWorker** (pswsl). Upload the files of `specs/` one project at a time, in this order. Each project
starts from the branch the previous one pushed; merge the pull requests oldest first.

| Order | Upload | Starts from | Pushes to | Details in |
|---|---|---|---|---|
| 1 | `specs/dms-core.md` | `main` | `aiworker/dms-core` | `01-dms-core.md` |
| 2 | `specs/dms-ui.md` | `aiworker/dms-core` | `aiworker/dms-ui` | `02-dms-ui.md` |
| 3 | `specs/dms-e2e.md` | `aiworker/dms-ui` | `aiworker/dms-e2e` | `03-dms-e2e.md` |

Prerequisites: the CRT repository's projects are merged to its `main` (the specs clone `psawyerberlin/ckb-revocable-timelock`
from `main` into `.refs/crt` and build `@crt/client` from it), and that repository is readable without credentials (public),
because AIWorker's Claude has no GitHub access. This repository and its deploy key must be in AIWorker's allow-list under the
key name `dead-man-switch` (AIWorker guide, section 7a).

Acceptance: `node --test acceptance/aiworker-<name>/` and, where present, `node acceptance/aiworker-<name>/named.mjs`.
