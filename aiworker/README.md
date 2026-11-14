# AI worker specs

Read `../AIWORKER.md` first. Run in order.

| # | Spec | Branch | Acceptance |
|---|---|---|---|
| 01 | `01-dms-core.md` | `aiworker/dms-core` | `acceptance/aiworker-dms-core/` |
| 02 | `02-dms-ui.md` | `aiworker/dms-ui` | `acceptance/aiworker-dms-ui/` |
| 03 | `03-dms-e2e.md` | `aiworker/dms-e2e` | `acceptance/aiworker-dms-e2e/` |

`node --test acceptance/aiworker-<name>/` and, where present, `node acceptance/aiworker-<name>/named.mjs`, from the
repository root.
