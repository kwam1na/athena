---
title: Athena Public Architecture Walkthrough Artifacts Need Harness Coverage
date: 2026-06-06
category: architecture
module: athena-webapp
problem_type: missing_validation_surface
component: public-html-artifacts
symptoms:
  - "A standalone public HTML walkthrough can build locally but fail pre-push review as an uncovered app surface"
  - "Harness audit fixtures can drift when a new public asset is added to the validation registry"
root_cause: public_assets_are_reviewed_surfaces
resolution_type: validation_mapping
severity: medium
tags:
  - public-assets
  - harness
  - architecture-docs
  - athena-webapp
---

# Athena Public Architecture Walkthrough Artifacts Need Harness Coverage

## Problem

Standalone architecture walkthroughs are useful when the audience needs a
shareable, unauthenticated page instead of an in-app route. In Athena, placing
that page under `packages/athena-webapp/public/` makes it a real deployable app
surface, not just a brainstorming document.

That means the page must be covered by the same validation map used by
pre-push review. Adding the file without updating the harness registry leaves a
coverage gap, and updating the registry without updating the harness audit
fixture makes repo-level harness tests fail.

## Solution

When adding a deployable standalone HTML walkthrough:

- Keep the source copy in `docs/brainstorms/` if the artifact is also useful as
  a planning or explanation document.
- Copy the deployable version into `packages/athena-webapp/public/` so Vite can
  serve it from the QA domain without app authentication.
- Add the public path to an Athena validation scenario in
  `scripts/harness-app-registry.ts`, then run `bun run harness:generate`.
- Add the same public path to `scripts/harness-audit.test.ts` fixture setup so
  generated validation-map coverage and live fixture surfaces stay aligned.
- Add a focused `scripts/harness-app-registry.test.ts` assertion for the
  validation scenario that owns the public asset.

For architecture walkthroughs that are also available as React routes, keep the
route/component test focused on the interactive model and let the public HTML
asset share the route-or-UI validation surface.

## Prevention

- Treat `packages/athena-webapp/public/*` as deployable app surface whenever a
  new file is intentionally served from QA or production.
- Run `bun run harness:self-review --base origin/main` before pushing after
  adding public assets; it will identify unmapped paths before the pre-push hook
  reaches the full suite.
- If `scripts/harness-app-registry.ts` changes, update the paired registry and
  audit tests in the same commit.
- Run `bun run graphify:rebuild` after source or harness-code edits so Graphify
  stays fresh with the generated harness documentation.
