---
title: Athena Storybook Preview Hangs Can Come From Config Root Drift and a Stuck Esbuild Binary
date: 2026-05-03
category: build-errors
module: athena-webapp-storybook
problem_type: build_error
component: tooling
symptoms:
  - "Storybook manager loads the story index but selected stories show the generic render error"
  - "The preview iframe waits on /@storybook/builder-vite/vite-app.js or generated preview modules"
  - "`storybook build` hangs at Vite transforming instead of completing the preview build"
  - "`esbuild --version` hangs for the root esbuild binary"
root_cause: config_error
resolution_type: config_change
severity: medium
tags:
  - storybook
  - vite
  - esbuild
  - athena-webapp
  - frontend-tooling
---

# Athena Storybook Preview Hangs Can Come From Config Root Drift and a Stuck Esbuild Binary

## Problem

Athena Storybook could start the manager on port 6006 and expose `index.json`, but stories did not render in the preview iframe. Static builds also appeared to hang during the Vite preview build.

This is misleading because Storybook can print "ready" while the preview module graph is still blocked.

## Symptoms

- `http://localhost:6006/index.json` lists stories, but the iframe root stays empty.
- The iframe displays Storybook's generic "component failed to render" error with no useful stack.
- The preview waits on `@id/__x00__virtual:/@storybook/builder-vite/vite-app.js`, `.storybook/preview.ts`, or React/Storybook preview entry modules.
- `bun run --cwd packages/athena-webapp storybook:build` stalls around `Vite transforming...`.
- The local root `node_modules/@esbuild/darwin-arm64/bin/esbuild --version` can hang, even when another nested esbuild binary works.

## What Didn't Work

- Waiting on Storybook readiness. The manager was ready, but the preview bootstrap was blocked.
- Treating the story files as the first suspect. The generated `storybook-stories.js` module responded immediately, so story discovery was not the root failure.
- Disabling Vite dependency optimization globally. That unblocked one virtual module but caused raw React and preview modules to hang instead.
- Setting `ESBUILD_BINARY_PATH` at the package script level. Storybook itself uses a different esbuild version, so a global override can fail main config evaluation with a host/binary version mismatch.

## Solution

Keep Athena's Storybook config outside the webapp package to avoid Storybook's dependency auto-ref scan against application dependencies, but set Vite's runtime root back to the webapp package.

The durable config shape is:

```ts
const packageRoot = fileURLToPath(
  new URL("../packages/athena-webapp", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

return mergeConfig(
  {
    ...config,
    plugins,
  },
  {
    root: packageRoot,
    server: {
      fs: {
        allow: [repoRoot, packageRoot],
      },
    },
    resolve: {
      alias: {
        "~": packageRoot,
        "@": path.resolve(packageRoot, "src"),
        "@cvx": path.resolve(packageRoot, "convex"),
      },
    },
  },
);
```

Then point package scripts at that config:

```json
{
  "storybook": "storybook dev -p 6006 --config-dir ../../.storybook-athena",
  "storybook:build": "storybook build --config-dir ../../.storybook-athena"
}
```

Add `.storybook-athena/package.json` so Storybook treats the external config as its own package boundary instead of walking to the repo root and scanning unrelated root dependencies:

```json
{
  "name": "@athena/storybook-config",
  "private": true,
  "type": "module"
}
```

Keep `typescript.reactDocgen` disabled for local startup speed, and keep incompatible TanStack router Vite plugins filtered out of Storybook's Vite config.

If the preview still hangs after the config is corrected, test esbuild directly:

```sh
node_modules/@esbuild/darwin-arm64/bin/esbuild --version
node -e "import('esbuild').then(async e => { await e.transform('const x = <div />', { loader: 'jsx' }); console.log('ok') })"
```

If either command hangs, the local dependency install is corrupt or blocked at the binary level. Repair the local install or replace the broken root esbuild binary from a known-good same-version package-local binary. Do not commit `node_modules`; this is an environment repair, not a source change.

## Why This Works

Storybook has two separate phases that can fail differently:

- The manager can load story metadata from `index.json`.
- The preview iframe still has to transform and execute Storybook's generated Vite app module, React, project annotations, and story imports.

The repo-level config avoids Storybook's package-ref scan over the webapp dependencies, where packages such as `openai` can expose package metadata in a way Storybook does not handle cleanly. Setting Vite `root` back to `packages/athena-webapp` makes dependency crawling and relative story entries match the actual application package.

The esbuild check matters because Vite's dependency optimizer depends on esbuild. When the binary hangs, Storybook appears stuck in Vite transform or preview bootstrap work even though the source config is valid.

## Prevention

- Validate Storybook with both dev rendering and static build:

  ```sh
  bun run --cwd packages/athena-webapp storybook:build
  bun run --cwd packages/athena-webapp test -- src/stories/storybook-config.test.ts
  ```

- After static build validation, remove `packages/athena-webapp/storybook-static` before restarting dev Storybook so stale build artifacts do not trigger confusing reloads.
- When Storybook manager loads but stories do not, inspect the iframe resource list before editing story files. If `index.json` and `storybook-stories.js` work, focus on the preview bootstrap and optimizer.
- Keep a test asserting the external config keeps `reactDocgen: false`, and preserve the plugin-filter test for TanStack router plugins.
- If the preview hangs with no console exception, check the exact esbuild binary Vite is using before changing application code.

## Related Issues

- Related source files:
  - `.storybook-athena/main.ts`
  - `.storybook-athena/package.json`
  - `packages/athena-webapp/package.json`
  - `packages/athena-webapp/src/stories/storybook-config.test.ts`
