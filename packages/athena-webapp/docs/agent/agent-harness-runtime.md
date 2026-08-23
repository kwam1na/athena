# Agent harness runtime: Convex Agent adapter and program sandbox

This is the runtime record for the agent harness: the exact versions the Convex Agent adapter is proven against, how to upgrade and roll them back, the program-sandbox decision with its evidence, the safety ceilings, the deployment findings, and how the program executor and the turn host construct and drive the pieces.

For what the harness is and where it sits, read [architecture.md](./architecture.md); to add a capability, a package, or a profile, read [capability-authoring.md](./capability-authoring.md).

## 1. What exists

| Piece | Path | Boundary |
| --- | --- | --- |
| Component mount | root `convex/convex.config.ts` + `convex/agentHarness/agentRuntime/convexAgentRegistration.ts` (constants only) | The root config imports `@convex-dev/agent/convex.config` directly and calls `app.use(agent, { name: CONVEX_AGENT_COMPONENT_NAME })` itself — the one runtime-native import allowed outside `agentRuntime/`. Mounting through a local module makes the Convex backend reject the push (section 6). The shim carries only the mount name; `importBoundary.test.ts` enforces both rules. |
| Runtime adapter | `convex/agentHarness/agentRuntime/convexAgent.ts` (`"use node"`) | Implements `shared/agentHarness/agentRuntime.ts` (`AgentRuntimeAdapter`) over Convex Agent. Only `agentRuntime/` may import `@convex-dev/agent`, `ai`, `@ai-sdk/*` (enforced by `convex/agentHarness/importBoundary.test.ts`). |
| Opaque refs and lookups | `convex/agentHarness/agentRuntime/convexAgentRefs.ts` (V8-safe) | Token minting/parsing and component lookups; type-only runtime imports so mutations can use it. |
| Retention cleanup | `convex/agentHarness/agentRuntime/convexAgentCleanup.ts` (V8-safe) | `cleanupConvexAgentRuntime` and `createConvexAgentCleanupHook` for the retention registry's `registerAgentRuntimeCleanupHook`; the adapter's `cleanup` delegates here. |
| Default model resolver | `convex/agentHarness/agentRuntime/models.ts` (`"use node"`) | OpenAI via `OPENAI_API_KEY`; refuses any other provider with a typed error. The profile-governed model registry (`convex/agentHarness/modelRegistry.ts`) replaces it. |
| Deployed smoke | `convex/agentHarness/agentRuntime/convexAgentSmoke.ts` (`"use node"`) | Internal action: a Convex Agent turn through the adapter plus an Athena tool through the sandbox bridge. `convexAgentSmoke.test.ts` runs the same action under convex-test. |
| Program runtime contract | `convex/agentHarness/programRuntime/types.ts` | Ceilings, facade shape, host bridge, typed outcomes. Environment-neutral. |
| Static validation | `convex/agentHarness/programRuntime/programValidation.ts` (`"use node"`) | `@babel/parser` TypeScript AST: policy, free-identifier allowlist, facade-shape rules, explicit-output rule, erasable-syntax stripping, JS re-parse. |
| Sandbox | `convex/agentHarness/programRuntime/quickJsRuntime.ts` (`"use node"`) | Direct QuickJS (wasm) behind the contract. The plan named this file `codeMode.ts`; it is `quickJsRuntime.ts` because the chosen adapter is not code-mode (section 3). |
| 240 KiB output ceiling | `convex/agentHarness/programRuntime/outputCeiling.ts` | Environment-neutral helper the executor runs before persisting any call output. |

Convex Node actions run on Node 22 (`packages/athena-webapp/convex.json`, `node.nodeVersion: "22"`). Only `"use node"` files are bundled for Node; every other non-test file under `convex/` is an isolate entry point that the push analyzes, which is why the engine-, parser-, and AI-SDK-bearing modules carry the directive and why the mutation-side helpers are split out.

## 2. Exact versions, upgrade, and rollback

Pinned exactly in `packages/athena-webapp/package.json`, mirrored in `CONVEX_AGENT_PINNED_VERSIONS` (`convexAgent.ts`), and asserted by `convexAgentPersistence.test.ts` ("fails the contract the moment the pinned runtime packages change without an upgrade record"):

| Package | Version | Why |
| --- | --- | --- |
| `@convex-dev/agent` | 0.7.1 | Requires AI SDK v7 and Node >= 22. |
| `ai` | 7.0.76 | AI SDK core; peer of the agent. |
| `@ai-sdk/openai` | 4.0.45 | Default provider path for the dev deployment's credentials. |
| `@ai-sdk/provider` / `@ai-sdk/provider-utils` | 4.0.7 / 5.0.28 | Declared peers of the agent, pinned so the lockfile cannot drift. |
| `quickjs-emscripten-core` | 0.32.0 | Sandbox engine API. |
| `@jitl/quickjs-singlefile-mjs-release-sync` | 0.32.0 | Engine build with the wasm embedded (no file or network loading inside the Convex bundle). |
| `@babel/parser` | 7.29.8 | Static validation and type stripping (see section 3 for why not `typescript`). |
| `zod` | `^3.23.8` declared (lockfile resolves 3.25.76) | AI SDK v7 accepts `zod ^3.25.76 || ^4.1.8`; the resolved version satisfies the peer and the declared floor was left as is. No application schema was migrated; the adapter uses `jsonSchema` tools and no Zod. |

`CONVEX_AGENT_ADAPTER_VERSION` (`convex_agent@0.7.1+ai@7.0.76+athena.1`) is part of every tool fingerprint. Changing it makes every recorded idempotency key mismatch on replay by design, so an upgrade never silently reuses results produced by another runtime version.

### Upgrade path (no separate promotion process)

1. In `packages/athena-webapp`: `bun add --exact @convex-dev/agent@<v> ai@<v> @ai-sdk/openai@<v> @ai-sdk/provider@<v> @ai-sdk/provider-utils@<v>`.
2. Read `node_modules/@convex-dev/agent/CHANGELOG.md` for component schema changes. The component owns its tables; a new schema is applied by `bunx convex dev --once` on dev and by the normal deploy on production. Record any migration the changelog requires here first.
3. Update `CONVEX_AGENT_PINNED_VERSIONS` and bump the `athena.N` suffix of `CONVEX_AGENT_ADAPTER_VERSION`.
4. Run, in order: `bun run test -- convex/agentHarness/agentRuntime convex/agentHarness/programRuntime shared/agentHarness convex/agentHarness/importBoundary.test.ts convex/intelligence/providers`, `bunx convex dev --once`, then `bunx convex run agentHarness/agentRuntime/convexAgentSmoke:run '{"model":"mock"}'` and, with provider credentials, `'{"model":"openai"}'`.
5. Incompatible active runs are invalidated through the existing compatibility-epoch path (`advanceCompatibilityEpochWithCtx` in `convex/agentHarness/lifecycle.ts`, given the registry's `compatibilityDigest`, which includes the adapter version); there is no drain, no cohort, and no dedicated deploy workflow.
6. Update the table above; the version pin test fails until steps 1–5 are recorded.

### Rollback path

1. `bun add --exact` the previous versions from the table and restore `CONVEX_AGENT_PINNED_VERSIONS` / the adapter version suffix.
2. If the newer component schema added tables or indexes, the older component definition simply stops using them; Convex keeps the data. If it changed an existing field in a way the old validators reject, run the agent's documented down-migration before pushing, or clear the affected component tables — Athena persists nothing in the component that its own durable tables do not already hold (section 4).
3. `bunx convex dev --once`, then the smoke action. Runs started under the newer adapter version are invalidated by the same epoch path.

## 3. Sandbox decision: direct QuickJS over `@ai-sdk/code-mode`

Both candidates were spiked behind `programRuntime/types.ts` on 2026-08-21. Decision: **direct QuickJS (`quickjs-emscripten-core` + single-file wasm variant)**. `@ai-sdk/code-mode` and its `run` dependency were removed from `package.json` after the spike; an external microVM remains the later fallback. `node:vm` was never a candidate.

| Criterion | `@ai-sdk/code-mode` 1.0.33 (`run` 2.0.0) | Direct QuickJS 0.32.0 (`quickJsRuntime.ts`) |
| --- | --- | --- |
| Deployability in Convex Node 22 | Worker thread with an inline (data-URL) worker and embedded wasm; plausible in Lambda but **requires Node >= 22.13** (`node:module.stripTypeScriptTypes`). Fails to load under the repo's local Node 20 (`bun run test` and the orchestrator's `pr:athena` gate): `SyntaxError: The requested module 'node:module' does not provide an export named 'stripTypeScriptTypes'`. Works under Node 23.5 locally; CI's `ubuntu-latest` ships Node 22.23. | In-process wasm, no workers, no files. Loads on Node 20 and 22 and in vitest today; 3.1 MB embedded wasm bundles as-is. |
| Isolation | Separate worker thread plus QuickJS heap; `Function` constructor blocked; `Date.now`/`Math.random` present but seeded-deterministic; no host globals. | Fresh QuickJS runtime + context per execution inside the wasm heap; `Date` and `Proxy` intrinsics not installed; `eval`, `Reflect`, `Math.random` removed; every function-prototype `constructor` replaced with a throwing stub; facade deep-frozen; only JSON text crosses the boundary. Same thread as the action (a wasm trap becomes an exception, not a crash). |
| Async host bridge | Native: `tools.*` host functions with in-flight limits. | Native promises resolved by the host and driven by `executePendingJobs`; bounded `Promise.all` proven (max in flight observed = 3 for three parallel calls). |
| Cancellation | `abortSignal`; worker terminated. | `AbortSignal` -> interrupt handler + immediate finalization; host results arriving afterwards are dropped before touching the context. |
| Explicit limits | timeout, memory, stack, source, result, console, tool input/output, bridge requests, in-flight. | Elapsed, heap, stack (clamped at 256 KiB), source, result, call args, per-call output, cumulative bridge bytes, calls, in-flight, plus `facade_violation`, `detached_call`, `stalled`, `result_not_serializable`. |
| Maintenance | Vercel-maintained, every export `experimental_*`, carries approval/continuation machinery Athena does not use; hard Node floor above the repo's toolchain. | Mature engine binding (quickjs-emscripten 0.32); ~400 lines of Athena-owned driver pinned by the contract tests. |
| Static TypeScript | Strips types only. | Athena validates the TypeScript AST (policy, free identifiers, facade shape, explicit output) and strips erasable syntax itself before the engine sees the program. |

Measured on the dev machine (Apple Silicon), 12–20 iterations of a two-call `Promise.all` program:

| Metric | code-mode (Node 23.5) | Direct QuickJS (Node 20.20, via vitest, incl. Athena validation) |
| --- | --- | --- |
| Engine startup (first load) | 161 ms first run incl. worker + wasm | 17 ms wasm compile (`startupMs`) |
| Completion p50 / p95 | 10.0 ms / 143 ms | 1.3 ms / 1.9 ms |
| First host call (first progress) p50 / p95 | n/a | 0.9 ms / 1.4 ms |

Engine-specific findings the program executor depends on:

- **Stack ceiling is 256 KiB.** QuickJS checks its own stack against the wasm stack; with `setMaxStackSize` at 512 KiB or above the wasm stack overflows first (`RangeError` in the host, runtime left unusable). At 256 KiB the engine reports `InternalError: stack overflow` cleanly (depth ≈ 1,360 frames). `quickJsRuntime.ts` clamps any larger ceiling.
- **Heap exhaustion is slow, not instant.** Near `maxHeapBytes` QuickJS retries GC before `out of memory`; an 8 MiB ceiling took ~5 s to trip. The elapsed ceiling bounds it either way.
- **Host `evalCode` needs the engine's eval intrinsic**, so dynamic code is blocked by deleting `eval` and replacing `Function.prototype.constructor` (and the async/generator prototypes) rather than by dropping the intrinsic. `programValidation.ts` rejects the identifiers statically as well.
- A call is **detached** when the program settles while a host call is still in flight (`detached_call`); results of detached calls are discarded.

### Why the validator is `@babel/parser`, not the `typescript` checker

The first implementation used `typescript` 5.9 (`createProgram` with the ES2022 lib + a generated facade declaration; ~60–130 ms per validation). It was rejected on bundle size: Convex caps **code at 32 MiB per deployment** (docs: "Code size: 32 MiB"), this app's isolate bundle is already ~19 MB with source maps, and `typescript` adds ~6.3 MB of Node bundle plus ~5.8 MB of source map (measured with `bunx convex dev --once --debug-bundle-path <dir>`). `typescript` also needs its lib files at runtime, which a bundled Node action does not have (Convex installs `externalPackages` only from `<package>/node_modules`, and this workspace hoists to the repo root). The Babel validator adds ~0.5 MB and has no runtime file dependency.

What the validator guarantees: syntax, import/export bans, host/network/fs/eval/timer/clock/randomness bans by free-identifier allowlist, prototype/mutation-handle member bans, `athena.<package>.<resource>.<verb>(args)` facade shape against the grant, exactly one explicit output, erasable-only TypeScript, and a JavaScript re-parse of the stripped program. What it does **not** do: semantic type checking (assignability). Runtime argument validation at the bridge (`AgentToolDefinition.validateInput`, then delegated admission) stays authoritative for argument shapes; if a checker is wanted later, it has to run outside the Convex bundle.

## 4. Persistence allowlist (Convex Agent component)

`convexAgentPersistence.test.ts` inspects the component's `messages`, `threads`, and `streams` through convex-test with the component registered, across success, retry (second attempt on the same input), cancellation, and failure:

- `threads`: one per Athena thread key, found through the correlation `userId` `athena:thread:<thread token>` (correlation only, never authorization), `title` = profile id, `summary` = `<contextBindingRef>|<operatorRef>`.
- `messages`: the operator prompt text (`kind: "input"`, with `promptHash`, `projectionDigest`, `egressClass`, opaque refs), one assistant record per attempt (`kind: "turn"`, empty content, status `pending -> success|failed`), and one assistant message per committed artifact projection (`kind: "projection"`, the artifact narrative plus citation keys/labels). Nothing else: `saveMessages: "none"` keeps tool calls, tool results, model drafts, and failure messages out of the component. The component does not persist a caller-supplied message `id`, so Athena's token lives in `providerMetadata.athena.token`.
- `streams`: empty. The component persists no stream deltas; the model narrative is buffered server-side until `completeRun` and exposed in-process as ordered `narrative_delta` runtime events that a host may surface as provisional text, and the committed artifact remains the only released answer.
- Provider requests (the mock model's recorded calls): system instructions, the Athena-projected history, and the prompt — a message seeded directly into the component thread never reaches the provider. The adapter installs a `contextHandler` that returns only `inputMessages` and `inputPrompt`, with `recentMessages: 0`, so raw component replay is structurally impossible.

Opaque refs: `runtime_thread:th_<40 hex>`, and `runtime_input|runtime_turn|runtime_projection:<in|tn|pj>_<thread token>.<24 hex>` (SHA-256 digests; thread-scoped so a fresh adapter can resolve any ref from the ref alone). They never match a raw document id and component ids never leave `agentRuntime/`.

## 5. Safety ceilings

`AGENT_PROGRAM_RUNTIME_CEILINGS` in `programRuntime/types.ts` (frozen; the executor consumes the object and may lower values per profile, never raise the stack ceiling):

| Ceiling | Value |
| --- | --- |
| `maxElapsedMs` | 60,000 |
| `maxAttempts` | 3 |
| `maxCapabilityCalls` | 24 |
| `maxInFlightCalls` | 4 |
| `maxRows` | 5,000 (budgeted by the run budget's `rows` dimension; the sandbox cannot count rows) |
| `maxRunBridgeBytes` | 2 MiB |
| `maxCallOutputBytes` | 240 KiB (`fitEncodedCallOutput` enforces it before persistence, cutting at a collection-item boundary with typed truncation; snapshots that cannot fit are rejected) |
| `maxCallArgsBytes` | 64 KiB |
| `maxSourceBytes` | 32 KiB |
| `maxResultBytes` | 256 KiB |
| `maxHeapBytes` | 64 MiB |
| `maxStackBytes` | 256 KiB (engine limit; see section 3) |
| `maxProviderCostUnits` | 2,000 |

These are initial safety limits, not release benchmarks; tune from observed use.

## 6. Deployment findings (scenario 1)

- `convex.json` with `node.nodeVersion: "22"` is accepted; the deployed action reports `process.version` `v22.23.1`.
- **Component mounting must be direct.** Pushing the Agent component fails server-side with `POST /api/deploy2/start_push 500 Internal Server Error` whenever the mount happens through a local module (`registerConvexAgent(app)` in a shim, even a constants-only-looking one that calls `app.use`). The orchestrator's 14-push bisect on the same dev deployment ruled out Node 22, app volume, the monorepo `node_modules` layout, the `{ name }` option, agent 0.6.4/0.7.0/0.7.1, and CLI 1.43/1.45; `import agent from "@convex-dev/agent/convex.config"` + `app.use(agent, { name: "agent" })` directly in the root config pushes ("Remounted component agent. Convex functions ready!"). Same class as get-convex/convex-backend#467 (facade-style component imports). Plan decision 8 ("root `convex.config.ts` imports only the local shim") is therefore amended: the root config owns the mount; the shim is constants only; no other file under `convex/` may import a `convex.config` or call `defineApp` (enforced).
- Deployed smoke, `bunx convex run agentHarness/agentRuntime/convexAgentSmoke:run` (2026-08-21, dev deployment):

  | | `{"model":"mock"}` | `{"model":"openai"}` (gpt-5-nano) |
  | --- | --- | --- |
  | Node | v22.23.1 | v22.23.1 |
  | Events | turn_started, tool_call_requested, tool_call_completed, usage, usage, turn_completed, completion_projected | same |
  | Dispatch | success | success (a first run without the argument spelled out in the prompt produced `protocol_violation:invalid_arguments` through the ledger, as designed) |
  | Program | completed `{ open: true, queued: 2 }`; 2 host calls, 2 in flight; 29 ms (cold) | completed, same output; 7 ms (warm) |
  | Sandbox startup | 28 ms | 28 ms |
  | First progress / completion / total | 135 / 274 / 1,087 ms | 6,640 / 9,339 / 10,114 ms (provider latency) |
  | Usage (normalized, 2 cumulative streams) | input 120, output 24 | input 995, output 760, reasoning 576, cached 0 |
  | Persisted before cleanup | 1 thread; `input` (user, 145 B prompt text, metadata: egressClass, inputRef, kind, projectionDigest, promptHash, reauthorizedAt, token, turnKey, untrustedDataLabel) + `turn` (assistant, 0 B, status success, metadata: inputRef, kind, startedAt, token, turnRef); no tool parts | same shape (prompt 389 B) |
  | Projection / cleanup | projected, not replayed / ok, thread deleted | same |

- `_generated/api.d.ts` now carries `components.agent`; no casts remain.

## 7. Construction guide for the executor and the turn host

```ts
import type { AgentComponent } from "@convex-dev/agent";           // only inside agentRuntime/ or adapter tests
import { components } from "../../_generated/api";
import { createConvexAgentRuntimeAdapter } from "../agentRuntime/convexAgent";
import { createConvexAgentCleanupHook } from "../agentRuntime/convexAgentCleanup";
import { resolveDefaultLanguageModel } from "../agentRuntime/models";
import { createQuickJsProgramRuntime } from "../programRuntime/quickJsRuntime";
import { AGENT_PROGRAM_RUNTIME_CEILINGS } from "../programRuntime/types";

// Inside a "use node" internalAction (Node 22):
const adapter = createConvexAgentRuntimeAdapter({
  ctx,                                  // runQuery/runMutation (+ runAction for turns)
  component: components.agent,
  resolveModel: (selection) => resolveDefaultLanguageModel(selection), // in production: the profile-governed model registry
  clock: () => Date.now(),              // injectable for deterministic tests
  // idempotencyKeyFor: defaults to `${turnRef}:${callId}`
});

const thread = await adapter.ensureThread({ threadKey, contextBindingRef, correlation });
const input = await adapter.saveInput({ threadRef: thread.threadRef, turnKey, prompt, history }); // same invocation as startTurn
const { turnRef } = await adapter.startTurn({ threadRef, inputRef: input.inputRef, turnKey, tools, model, limits }, hooks);
await adapter.inspect.settled(turnRef);  // or react to hooks.onEvent turn_completed
await adapter.projectCompletion({ threadRef, turnRef, artifact, idempotencyKey }); // after Athena commits the artifact
await adapter.cleanup({ threadRef, reason });

// Server-authored progress from an Athena tool handler (never model-visible):
await adapter.reportProgress(turnRef, "reading_sources");

// Retention (the harness retention hook registry, V8 mutation side):
registerAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND, createConvexAgentCleanupHook(components.agent));

// Program execution from the athena.executeProgram handler:
const runtime = await createQuickJsProgramRuntime();       // wasm loads once per process
const outcome = await runtime.execute({
  source,                                                  // model-authored TypeScript
  bridge: { facade, invoke },                              // grant-derived facade + admitted capability calls
  ceilings: AGENT_PROGRAM_RUNTIME_CEILINGS,                // or a profile-lowered copy
  signal,                                                  // AbortSignal from the tool handler context
});
```

Rules the adapter relies on:

- `saveInput` must run in the same action invocation as `startTurn`: the projected history is re-authorized and re-projected per attempt and is never persisted in the component. `startTurn` throws `input_not_loaded` otherwise.
- `resumeTurn` resumes only a turn this process holds; a durable `pending` record from a crashed action answers `unknown` (the turn host retries through the durable turn binding), a finalized record answers `terminal`.
- Tool definitions are Athena-owned (`AgentToolDefinition`); native names are `toolId.replaceAll(".", "__")` and must match `^[a-zA-Z0-9_-]+$`.
- Usage: one cumulative terminal stream per provider invocation (`<turn token>:<n>`), emitted at step end and only when the provider reported any count; the turn host settles missing usage conservatively through the reconciler. [capability-authoring.md](./capability-authoring.md) describes what that settlement guarantees and who owns cost.
- Turn elapsed ceiling: the adapter fails the turn with `turn_elapsed_ceiling` when `limits.maxElapsedMs` passes.
- `cleanup` from a mutation context uses the component's async deletion (self-scheduling); with an action context it deletes synchronously.
- Programs must call the facade as `athena.<package>.<resource>.<verb>({ ... })` — no aliasing, no passing facade functions around — and may reference only the allowlisted globals (`Promise`, `JSON`, `Math` minus `random`, `Array`, `Object`, `String`, `Number`, `Boolean`, `Map`, `Set`, `Error`, `TypeError`, `RangeError`, and a few scalars/helpers).
