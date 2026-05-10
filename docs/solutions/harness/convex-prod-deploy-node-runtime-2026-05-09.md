---
title: Convex Prod Deploys Need A Supported Node Runtime
date: 2026-05-09
category: harness
module: deploy
problem_type: deploy_runtime_drift
component: convex-prod-deploy
symptoms:
  - "scripts/deploy-vps.sh convex-prod could stall inside the Convex CLI on a machine whose default node was not supported for Convex action bundling"
  - "The generated-artifact hook already avoided this by selecting Node 18, 20, 22, or 24, but the production deploy script used raw PATH"
  - "After the Convex 1.38 upgrade, the Convex-local esbuild binary could hang before printing --version on Apple Silicon, leaving deploy stuck before bundleDefinitions completed"
root_cause: deploy_script_runtime_selection_gap
resolution_type: runtime_guardrail
severity: medium
tags:
  - convex
  - deploy
  - node
  - esbuild
  - vps
---

# Convex Prod Deploys Need A Supported Node Runtime

## Problem

Convex deploy and generated-artifact refresh can bundle node actions through
esbuild. This repo treats Node 18, 20, 22, and 24 as the supported runtimes for
that path. During production delivery, `scripts/deploy-vps.sh convex-prod` ran
`npx convex deploy` through whichever `node` happened to be first on `PATH`,
which can be an unsupported local version.

The pre-commit generated-artifact hook already had a supported-node resolver,
but the production deploy path did not. That meant the same Convex action
bundling workflow had different runtime guarantees depending on which command
the agent ran.

After the Convex 1.38 upgrade, the deploy also depended on the esbuild binary
resolved from Convex's nested dependency tree. On Apple Silicon, that nested
binary could hang before printing `--version`, while the repo-level
`node_modules/@esbuild/darwin-arm64/bin/esbuild` binary with the same esbuild
version ran normally. The deploy then stalled before
`bundleDefinitions` completed and could surface as `esbuild failed: Error: The
service was stopped: write EPIPE`.

## Solution

Add `scripts/convex-node-env.sh` as the shell-side runtime resolver and wire
`deploy_convex_prod` through it before invoking `npx convex deploy`.

The resolver checks, in order:

- `ATHENA_CONVEX_NODE_BIN`
- `NODE_BINARY`
- the bundled Codex primary runtime Node
- common Homebrew Node 24, 22, 20, and 18 locations
- the default `node` on `PATH`

If no supported runtime is available, the deploy fails before invoking Convex
and prints the checked node versions with a concrete override instruction. This
makes the failure immediate and actionable instead of leaving the CLI in an
opaque bundling state.

Also resolve a working esbuild binary for Convex deploys. The wrapper honors
`ATHENA_CONVEX_ESBUILD_BIN` and `ESBUILD_BINARY_PATH`, then falls back to the
repo-level Apple Silicon esbuild binary. `scripts/deploy-vps.sh convex-prod`
exports the resolved path as `ESBUILD_BINARY_PATH` so the Convex CLI does not
use the hanging nested binary.

## Prevention

- Keep shell paths that call `npx convex ...` on `scripts/convex-node-env.sh`.
- Keep the TypeScript generated-artifact resolver and the shell deploy resolver
  aligned on the supported Node majors: 18, 20, 22, and 24.
- Keep production Convex deploys pinned to a known-working esbuild binary when
  the package manager installs multiple esbuild copies.
- When adding new deploy or generated-code commands for Athena Convex, test both
  the supported override path and the unsupported-node diagnostic.
