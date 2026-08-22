---
title: Convex Deploy And Module-Graph Constraints Are Only Visible From A Push
date: 2026-08-22
category: harness
module: athena-webapp
problem_type: convex_deploy_module_graph_constraints
component: convex-deploy
symptoms:
  - "Every push fails with an opaque `POST /api/deploy2/start_push 500 Internal Server Error` and no diagnostic naming a file"
  - "A module that vitest imports fine is rejected by esbuild during `bunx convex dev --once`"
  - "`Property 'x' does not exist on type {…}` at an `internal.*` call site for a module `api.d.ts` already lists"
  - "Convex prints `external dependencies: []` even though `externalPackages` names a package"
  - "`@convex-dev/import-wrong-runtime` errors on a `\"use node\"` module importing another `\"use node\"` module"
resolution_type: naming_placement_and_runtime_declaration
severity: high
tags:
  - convex
  - deploy
  - bundler
  - components
  - use-node
  - module-graph
  - agent-harness
delivery_diff_fingerprint: 4045ad992d1e75757b19b95b03058a765fff64bf1947fb9352a1fe7627de3092
---

# Convex Deploy And Module-Graph Constraints Are Only Visible From A Push

## Problem

Building the agent harness under `packages/athena-webapp/convex/agentHarness/`
surfaced nine separate constraints of the Convex deployment pipeline — what gets
bundled, what gets mounted, what gets typed, what the eslint plugin believes.
None of them are visible from reading source, and none of them are visible from
a green Vitest run. Every one was discovered by running `bunx convex dev --once`
or `tsc` and reading the failure.

They also share a remedy shape: **name the file differently, put it somewhere
else, or declare its runtime.** Almost none of them were fixed by changing
logic.

The companion note, [The sensor ladder: what a green suite cannot
see](./the-sensor-ladder-what-a-green-suite-cannot-see-2026-08-22.md), covers
the ordering question — which sensor to run when. This note is the catalogue of
what the deploy sensor actually reports.

## Solution

Each constraint below is stated as: the observable, the rule, the fix.

### 1. A Convex component must be mounted directly in the root `convex.config.ts`

**Observable.** Every push fails, with no file named:

```
POST /api/deploy2/start_push 500 Internal Server Error
```

**Rule.** Mounting a component through a local shim module that calls
`app.use(...)` on the caller's behalf makes the backend reject the push. A
14-push bisect ruled out Node 22, app volume, the monorepo `node_modules`
layout, the `{ name }` option, `@convex-dev/agent` 0.6.4/0.7.0/0.7.1, and Convex
CLI 1.43/1.45. This is the same class as `get-convex/convex-backend#467`.

**Fix.** Put the import and the `app.use` call literally in
`packages/athena-webapp/convex/convex.config.ts`:

```ts
import agent from "@convex-dev/agent/convex.config";
const app = defineApp({});
app.use(agent, { name: CONVEX_AGENT_COMPONENT_NAME });
export default app;
```

A successful push then prints:

```
Remounted component agent. Convex functions ready! (5.5–7.2 s)
```

The shim that remains (`convex/agentHarness/agentRuntime/convexAgentRegistration.ts`)
exports the name constant only — no imports, no `use`, no `defineApp`.
`convex/agentHarness/importBoundary.test.ts` enforces that shape statically.

### 2. Any path containing `.config.` is treated as a local component directory

**Observable.** No distinct error text was captured; the shim named
`convexAgent.config.ts` failed the same way as constraint 1, which is what made
the two hard to separate. The mechanism was read out of the CLI rather than
observed directly — `findComponentDependencies` in
`node_modules/convex/dist/esm/cli/lib/components/definition/bundle.js` treats any
`.config.` path reached from the root config as a local component directory.

**Fix.** Never put `.config.` in the name of a module the root config imports.
The shim was renamed to `convexAgentRegistration.ts`.

### 3. Convex ignores only a *top-level* `_generated/`

**Observable.** `convex/agentHarness/_generated/registry.ts` appears as a module
in `convex/_generated/api.d.ts` and is pushed to the deployment.

**Rule.** The CLI's skip check is `relPath.startsWith("_generated/")`. A nested
`convex/<area>/_generated/` is bundled and pushed like any other module.

**Fix.** This is fine for a pure data module (the generated capability registry
exports no Convex functions), but do not assume a nested `_generated/` is
invisible to the deploy.

### 4. A basename with two dots is skipped by the bundler, the eslint plugin, and the admission checker

**Observable.** No error — this is the escape hatch the other constraints force
you to find.

**Rule.** Files whose basename has two dots (`x.y.ts`) are skipped by the Convex
bundler, by `@convex-dev/eslint-plugin`, and by this repo's operation-admission
checker. `convex-test` will still load them, and will register them under any
module key you choose.

**Fix.** This is the right home for deployable-adjacent test support that must
sit inside `convex/` but must never be pushed:

- `convex/agentHarness/agentRuntime/convexAgent.contractHarness.ts`
- `convex/agentHarness/delegatedAdmission.testPorts.ts`
- `convex/agentHarness/executor.testSeams.ts`
- `convex/agentHarness/turns.testSeams.ts`

An internal-path-shaped function name can still resolve to one of these by
aliasing the convex-test module key:

```ts
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];
```

### 5. The 32 MiB per-deployment code cap counts source maps

**Rule.** Every non-test file under `convex/` is an isolate entry point, so
anything Node-only or heavy that is not marked `"use node"` lands in the isolate
bundle. The cap counts source maps as well as code. This one was measured rather
than crashed into — the budget was checked before the push that would have blown
it.

**Evidence.** Adding `typescript` 5.9 as a program validator contributed roughly
6.3 MB of Node bundle plus 5.8 MB of source map to an isolate bundle already
around 19 MB across ~1,180 modules. The validator was rewritten on
`@babel/parser` (~0.5 MB) instead.

**Fix.** Measure without pushing:

```
cd packages/athena-webapp && bunx convex dev --once --debug-bundle-path <dir>
```

and mark Node-only modules `"use node"` (the harness marks `convexAgent.ts`,
`models.ts`, `programValidation.ts`, `quickJsRuntime.ts`, `executor.ts`,
`runtimeHost.ts`, `modelRegistry.ts`). See
[agent-harness-runtime.md](../../../packages/athena-webapp/docs/agent/agent-harness-runtime.md)
for the pinned-dependency and rollback path around this budget.

### 6. `externalPackages` resolves only from `<package>/node_modules`

**Observable.**

```
external dependencies: []
```

printed by Convex despite the package being declared.

**Rule.** Resolution starts at `packages/athena-webapp/node_modules`. This bun
workspace hoists to the repo root, so the lookup finds nothing and silently
externalizes nothing.

**Fix.** Do not plan around `externalPackages` in this repo. Choose a dependency
small enough to bundle, or move the work out of the Convex bundle entirely.

### 7. A Convex module with no function exports is invisible on `internal.*`

**Observable.** 19 typecheck errors of the form:

```
Property 'x' does not exist on type {…}
```

at the call site, with `internal.agentHarness.executorSeams` absent from the
`internal` tree — even though `convex/_generated/api.d.ts` lists the module.

**Rule.** `FilterApi` drops a module that exports no registered Convex
functions. The symptom points at the *property*, not at a missing module, which
sends you to regenerate `api.d.ts` for no reason.

**Fix.** Export the registered functions from the module. Regeneration does not
help.

### 8. Index range queries on optional fields must start with `gte(field, 0)`

**Observable.** No error. Rows where the field is `undefined` are silently
included in a `lt` / `lte` range and get swept.

**Rule.** An index range that only bounds the top of an optional numeric field
also matches rows that never set it.

**Fix.** Start the range with `gte(field, 0)` (or an explicit
`eq(field, undefined)` when undefined rows are the target). This bit both the
compatibility-epoch repair sweep over `intelligenceRun.compatibilityEpoch` and
the attempt-lease / next-attempt sweeps in
`convex/agentHarness/lifecycle.ts` and `convex/agentHarness/retention.ts`.

### 9. `import-wrong-runtime` never checks the importer's own `"use node"`, and text-matches inside JSDoc

**Observable.** `bun run --filter '@athena/webapp' lint:convex:changed` reports
`@convex-dev/import-wrong-runtime` errors on a `"use node"` module importing
other `"use node"` modules. In one case five errors traced to a JSDoc comment in
`convex/agentHarness/agentRuntime/convexAgentKind.ts` that merely *mentioned*
the directive — the file is V8-safe, but the rule read the quoted string.

**Rule.** The rule (`node_modules/@convex-dev/eslint-plugin/dist/esm/lib/no-import-use-node.js`)
flags any entry point importing a `"use node"` module and never inspects the
importer's own directive; it decides "this file is Node-only" by text-matching
the literal anywhere in the file, comments included.

**Fix.** Describe the directive without quoting it in prose, and waive the
remaining cases per line with a reason. Several harness modules carry such
waivers.

### 10. Node versions differ between the deployment and the local sensors

`packages/athena-webapp/convex.json` sets `node.nodeVersion: "22"` and the
deployed action reports `process.version` `v22.23.1`. The local smoke under
convex-test reported `{"node":"v20.20.2"}`, and `bun run test` and
`bun run pr:athena` run on Node 20.

That gap is a real gate on dependency choice. `@ai-sdk/code-mode` (via `run`)
was rejected for exactly this reason — it needs Node >= 22.13 at *load* time:

```
SyntaxError: The requested module 'node:module' does not provide an export named 'stripTypeScriptTypes'
```

Any dependency with that floor forces the whole local toolchain and the delivery
gate onto Node 22.13+, not just the deployment.

## Prevention

- Push before calling a Convex module done. `bunx convex dev --once` is the only
  sensor that runs esbuild over the real module graph; see the [sensor
  ladder](./the-sensor-ladder-what-a-green-suite-cannot-see-2026-08-22.md) for
  the full ordered list.
- Mount components only in the root `convex.config.ts`. `importBoundary.test.ts`
  asserts this statically (`findRegistrationShimViolations`,
  `findIndirectComponentMountViolations`), so the `start_push 500` cannot come
  back silently.
- Never use `.config.` in a filename the root config imports.
- Give test support that must live under `convex/` a two-dot basename, and alias
  the convex-test module key when a function path must resolve to it.
- Before adding a dependency to a `convex/` module, measure with
  `bunx convex dev --once --debug-bundle-path <dir>` and check both bundles
  against the 32 MiB cap. Assume source maps count.
- Mark every Node-only or heavy module `"use node"`, and expect the eslint plugin
  to be wrong about the importer; waive per line with a reason rather than
  restructuring around the false positive.
- When adding a range query on an optional field, write the `gte(field, 0)` lower
  bound first, then the real bound.
- Check a new dependency's Node floor against Node 20 as well as the deployment's
  Node 22 before committing to it.
- New capability packages: follow the declaration/ports split described in
  [capability-authoring.md](../../../packages/athena-webapp/docs/agent/capability-authoring.md).
  The composition root imports the declaration half, and the ports half imports
  the composition root; collapsing them into one file produces a TDZ
  `ReferenceError` at module load rather than a bundler error.
