---
title: Athena Frontend Dependency Version Alignment Before Wrapper Changes
date: 2026-07-06
category: developer-experience
module: athena-webapp-frontend
problem_type: developer_experience
component: tooling
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "A shared UI wrapper appears incompatible with the installed package API"
  - "Local node_modules behavior disagrees with the package manifest or lockfile"
  - "A proposed wrapper patch changes styles to compensate for dependency drift"
tags: [frontend, dependencies, lockfile, react-day-picker, calendar, tooling]
related_components:
  - "athena-webapp"
  - "storefront-webapp"
  - "shared-ui"
---

# Athena Frontend Dependency Version Alignment Before Wrapper Changes

## Problem

Frontend package drift can make a shared UI wrapper look wrong even when the source code is aligned to the intended dependency version. Patching the wrapper around a stale local install can remove required library-provided class names and change the production styling contract.

This is not only a single-package problem. When Athena and Storefront declare different versions of the same shared frontend dependency, local hoisting can make each package resolve a different implementation even after a plain reinstall. The failure mode is especially easy to miss for UI libraries because TypeScript may pass while class names, slots, animations, or interaction semantics come from the wrong version.

## Solution

Before changing a shared wrapper for a package API mismatch, verify the dependency contract in this order:

1. Read the package manifest for the intended version range.
2. Refresh the install from the repo root with `bun install`.
3. Confirm the installed package version from the package-local `node_modules`.
4. Use `bun install --frozen-lockfile` to prove the lockfile is acceptable.
5. Keep the wrapper on the API and class-name contract expected by the manifest version.

For the Athena calendar wrapper, `packages/athena-webapp/package.json` declares `react-day-picker` as `^10.0.0`. The correct repair was to keep the v10 wrapper that uses `getDefaultClassNames`, `Root`, `DayButton`, and the `rdp-dropdown_root` styling path, then refresh `bun.lockb` and local install state. Replacing the wrapper with a compatibility shim changed where styles land and hid the actual dependency alignment issue.

For shared frontend dependencies, align the version declaration string everywhere the dependency is declared across the root manifest, `packages/athena-webapp/package.json`, and `packages/storefront-webapp/package.json`. The repo-level `dependency:check` script enforces both parts of the contract:

- shared manifest declarations for the same package must use the same version string
- every declared package must resolve from that workspace to an installed version satisfying the manifest

## Why This Matters

Shared UI wrappers are styling contracts, not just TypeScript adapters. When they preserve the upstream library's expected slots and default class names, design-system styles keep applying through predictable DOM structure. A compatibility shim can typecheck while still producing subtly wrong layout, focus, selected-day, or dropdown styles.

## Prevention

- Treat manifest/lock/install disagreement as a dependency problem first, not a component problem.
- Run `bun run dependency:check` before changing wrappers or package-specific shims.
- Do not remove upstream `getDefaultClassNames` composition from shared wrappers to work around a local install mismatch.
- When a package upgrade is intended, update the manifest and lockfile together, then adapt wrappers to the new version intentionally.
- For calendar changes, run the focused calendar test, webapp TypeScript, changed frontend lint, frozen lockfile install, graphify check, and the webapp build.

## Examples

Check the manifest and installed package directly:

```bash
node -e "const pkg=require('./packages/athena-webapp/package.json'); const installed=require('./packages/athena-webapp/node_modules/react-day-picker/package.json'); console.log({ manifest: pkg.dependencies['react-day-picker'], installed: installed.version })"
```

Keep tests pointed at the real styled slots:

```ts
expect(dropdown.closest(".rdp-dropdown_root")).toHaveClass(
  "border-input",
  "has-focus:ring-[3px]"
);
```

## Related

- [Repo Coverage Policy](../harness/repo-coverage-policy-2026-05-02.md)
- [Athena Storybook Vite Preview Esbuild Hang](../build-errors/athena-storybook-vite-preview-esbuild-hang-2026-05-03.md)
