# Roadmap

Planned changes that are decided but not scheduled. Each entry: why, what it takes, what stays as it is until then.

## One CRT service for standard switches and drills (testnet)

**Why.** A CSR operator who guards dead-man-switch switches on testnet now approves and enables two CRT services:
the normal one (24 h grace, service `0xe6c32cab…40dcfec1` on runner `0x44e29c3b…2a6772`) and the drill variant
(10 min grace, `0xf887904f…09cce9fa`). One service would be simpler for operators.

**What it takes (CRT, a new contract version).**

* The grace moves from a compiled constant (`GRACE_SECONDS`, `drill` feature) into the Node Cell data, chosen at
  Create: 600 s for a drill, 86 400 s otherwise.
* `crt-node-lock` checks the grace against a per-network minimum (testnet 600 s, mainnet 86 400 s); `crt-service`
  reads the grace from the Node Cell.
* New Node Cell layout, security review, new deployments and one new manifest per runner; client, kit, vault
  opener and notifier follow.
* Existing switches stay on today's deployments: both current services stay enabled until those switches end.

**Trade-off to settle first.** Today the normal testnet deployment runs the same code as mainnet, so every testnet
switch also tests mainnet. With a per-network minimum the two binaries differ.

**Until then.** Two services on testnet (`scripts/crt-enable.sh` and `scripts/crt-enable.sh --deployment
testnet-drill` in CRT); mainnet has only the normal one.
