# Agent harness runtime: Convex Agent adapter and program sandbox

This is the runtime record for the agent harness: the exact versions the Convex Agent adapter is proven against, how to upgrade and roll them back, the program-sandbox decision with its evidence, the safety ceilings, the deployment findings, and how the program executor and the turn host construct and drive the pieces.

For what the harness is and where it sits, read [architecture.md](./architecture.md); to add a capability, a package, or a profile, read [capability-authoring.md](./capability-authoring.md).

## 1. What exists

| Piece | Path | Boundary |
| --- | --- | --- |
| Component mount | root `convex/convex.config.ts` + `convex/agentHarness/agentRuntime/convexAgentRegistration.ts` (constants only) | The root config imports `@convex-dev/agent/convex.config` directly and calls `app.use(agent, { name: CONVEX_AGENT_COMPONENT_NAME })` itself — the one runtime-native import allowed outside `agentRuntime/`. Mounting through a local module makes the Convex backend reject the push (section 7). The shim carries only the mount name; `importBoundary.test.ts` enforces both rules. |
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
- `streams`: empty, and it stays empty. The component persists no stream deltas: the adapter passes `saveStreamDeltas: false` and consumes the provider stream in process, so the model's narrative leaves the adapter only as ordered `narrative_delta` runtime events (section 5). Athena holds no buffer of it either — the turn host writes the coalesced draft into one short-lived `agentProvisionalNarrative` row that is deleted on every terminal cause. The committed artifact `completeRun` mints remains the only released answer.
- Provider requests (the mock model's recorded calls): system instructions, the Athena-projected history, and the prompt — a message seeded directly into the component thread never reaches the provider. The adapter installs a `contextHandler` that returns only `inputMessages` and `inputPrompt`, with `recentMessages: 0`, so raw component replay is structurally impossible.

Opaque refs: `runtime_thread:th_<40 hex>`, and `runtime_input|runtime_turn|runtime_projection:<in|tn|pj>_<thread token>.<24 hex>` (SHA-256 digests; thread-scoped so a fresh adapter can resolve any ref from the ref alone). They never match a raw document id and component ids never leave `agentRuntime/`.

## 5. The provisional narrative stream

The adapter calls `agent.streamText(…, { saveStreamDeltas: false })` and consumes `result.fullStream` inside the same action. The text never becomes component state and it is never held until completion; it is normalized into runtime events as it arrives.

- **Part allowlist (default deny).** Only `text-delta` parts feed the narrative. Reasoning, tool input, tool calls and results, sources, files, and raw provider frames are dropped and can never reach a host. Control parts drive lifecycle only: a mid-stream `error` part fails the turn with the existing provider-failure code (a provider error arrives as a part here, not as a throw), `abort` cancels it, and `finish-step` advances `draftOrdinal`.
- **The event.** `narrative_delta { draftOrdinal, text }`, under protocol `athena.agent-runtime.v2`. It carries no stream identifier and no per-delta index: the envelope's `turnRef` and `sequence` already identify and order every event, and `draftOrdinal` identifies the draft. Malformed fields fail as `event_invalid`; an unknown kind still fails as `versioned_extension_required`.
- **Coalescing rule.** One event per provider token would swamp the host, so a slice is released at a sentence boundary, at the end of a provider text block (`text-end`), or once the buffer reaches `NARRATIVE_COALESCE_MIN_CHARS` (24). There are no timers, so the cadence is the same under `convex-test` as it is against a live provider. Two flushes are **normative, not tuning knobs**: `dispatch()` flushes at its top, before it emits `tool_call_requested`, so a preamble reaches the operator before the tool call it precedes; and the stream's end flushes whatever is left. `finish-step` flushes before it advances the draft.
- **Narration directive.** `DEFAULT_INSTRUCTIONS` asks the model to narrate in one or two sentences before its first tool call and between tool rounds, and says plainly that the narration is provisional and that the answer is the one submitted through `athena.completeRun`. Without the ask, providers routinely emit no assistant text on a step that ends in a tool call and the turn shows nothing until it completes.

The turn host coalesces deltas in memory and writes them through one single-flight `internal.agentHarness.turns.flushProvisionalNarrative` — internal and host-only, never admitted as public ingress. That flush is the enforcement point for provisional exposure; the row, the preview query, and deletion on every terminal cause are described in [architecture.md](./architecture.md).

### Reading a driven turn

`driveTurn` is a scheduled action whose return value the scheduler discards, so one log line per driven turn is the only read path for what the turn did:

```bash
bunx convex logs --history 200
```

```
[agentHarness:driveTurn] {"turnId":…,"runId":…,"outcome":…,"code":…,"events":"turn_started,narrative_delta×4,tool_call_requested,…","firstDeltaMs":812,"firstProgressMs":…,"completionMs":9214,"elapsedMs":9530}
```

`events` is the turn's event kinds with consecutive repeats collapsed (`kind×n`), `firstDeltaMs` is time to the first provisional text, `completionMs` is time to `turn_completed`, and `elapsedMs` covers the whole driven turn. Opaque refs and event kinds only: no prompt text and no narrative text. This is the first-turn monitoring hook for time-to-first-provisional-text and completion latency.

The repair sweep logs only when its expiry phase deleted something:

```
[agentHarness:repairSweep] {"recoveredAttempts":…,"failedTurns":…,"canceledFencedRuns":…,"expiredProvisionalNarratives":1,"hasMore":true}
```

A nonzero `expiredProvisionalNarratives` means a draft outlived its exposure bound (`AGENT_PROVISIONAL_NARRATIVE_TTL_MS`, 5 minutes) without any terminal cause reaching it — the dead-host signal. The sweep runs every 5 minutes in production and every 60 minutes elsewhere, so such a row is unreadable after 5 minutes but stays at rest until the next sweep.

### The engineer's turn trace

The operator's pane shows a draft and then an answer; refining the agent needs the other half — what the model was actually handed and what it did with it. The turn trace (`agentTurnTraceEvent`) records, per driven turn, every runtime event in the order the host saw it, the narrative deltas, each tool call's **exact arguments** and the outcome object the model read back, each provisional-flush outcome, and the turn's own report. It is engineer-only: nothing projects it into thread history, a prompt, a citation, or any operator-admitted query, and no public ingress reads the table. It is the single deliberate exception to "the narrative never enters Athena's durable record".

- **What is written.** `adapter` rows carry the runtime envelope (`kind`, `sequence`, `turnRef`, `at`) plus the kind's own fields. `host` rows carry the host's own monotone counter and one of four kinds: `tool_dispatch` (the arguments, the settled outcome, hashes, and the dispatch latency — the normalized `tool_call_requested` event carries no arguments, so this is where they live), `provisional_flush` (the flush outcome and ordinal, never the text — the deltas already carry it), `trace_capped`, and `turn_report` (the `[agentHarness:driveTurn]` payload plus the `dispatch` outcome list).
- **When it is written.** The host buffers rows in memory and flushes them in batches of `AGENT_TURN_TRACE_FLUSH_BATCH` (200) at every `tool_call_completed`, and once more **before** `finalizeTurn` — so a crash after finalize cannot lose the record — never inside the commit transaction. Every write goes through the settle-never-rethrow wrapper: a failed trace write can never fail a turn.
- **Bounds.** `AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES` is 32 KiB per row, re-enforced server-side in `recordTurnTrace` rather than trusted from the host: an over-cap payload loses its largest string leaves first (cut at a whole codepoint) and the row is marked `truncated`; a payload with no string leaf big enough to absorb the excess degrades to `{ omitted: true, byteLength }`. `AGENT_TURN_TRACE_MAX_EVENTS_PER_TURN` is 4 000 rows per turn; past it the host records one `trace_capped` row and stops buffering everything except the turn's own `turn_report` summary row, which is always written last. A batch the deployment rejects is dropped, never rethrown into the turn, and logged as `[agentHarness:turnTrace] {"trace":"flush_failed",…}` with the error's class (never its text, which can quote the batch). An `athena.executeProgram` outcome links to the run's stored `program_result` through `replayPayloadId`, so the full body is one hop away instead of duplicated.
- **Retention and removal.** Standard class, 365 days, expired by the `sweepExpiredAgentContent` phase; store and organization removal delete the rows through the scope indexes with the rest of the harness content.
- **The switch.** `AGENT_TURN_TRACE` is read on the Convex side inside `recordTurnTrace`. `off`, `0`, or `false` disables capture — the mutation writes nothing and the host stops buffering for the rest of the turn; anything else, **including unset**, captures. Capture-by-default is the point: the turn worth tracing is the one nobody predicted. The `driveTurn` report carries `trace: { enabled, recorded, capped }`.

Reading one turn:

```bash
# The most recent turns on the deployment.
bunx convex data agentTurnBinding --limit 3

# One turn's trace, in order (also accepts {"runId": "<intelligenceRun id>"}).
bunx convex run agentHarness/evals/directHarness:listTurnTrace '{"bindingId":"<agentTurnBinding id>"}'

# The same thing as JSONL, paged to the end, for offline replay.
bun scripts/agent-trace-export.ts --binding <agentTurnBinding id> --out trace.jsonl
bun scripts/agent-trace-export.ts --run <intelligenceRun id>
```

An exported file holds the model's narrative and the arguments of every capability call for one store: treat it as that store's content.

### The committed turn's draft trail

The pane's live draft is gone the moment the turn ends — the row is deleted by every terminal cause, including a successful commit. What an operator loses with it is the record of *how* Athena got to the answer: reload the page, or scroll back to an earlier turn in the thread, and the drafts are simply not there. The narrative trail (`agentTurnNarrativeTrail`) is that record, and it is operator-readable on purpose.

- **Written once, only for a committed turn.** The turn host keeps each draft's full coalesced text in memory beside the single-flight flush, and hands the whole set to `finalizeTurn` as an optional `trail: [{ draftOrdinal, text, truncated }]` — only from the branch where the run completed with a committed release. `finalizeTurnWithCtx` re-checks that (`refreshed.status === "completed"` and `operatorReleaseCommittedAt` set) before writing, so a canceled, failed, refused, or already-terminal turn never gets one. The write is insert-once: a re-finalize finds the row and leaves the record as first committed. The existing provisional-row deletion is unchanged and still runs above the already-terminal return.
- **What the host does NOT hand on.** Text the operator's pane was never being offered: anything the model narrates after quiescence for the commit, and every draft of a turn whose flush the kernel refused (an egress downgrade, a revoked membership). A draft that was withdrawn from the pane must not reappear as a durable record.
- **Released and withdrawn with the answer.** The row carries the *committed artifact's* `egressClass`, not the turn's stamped class — the value `getTurnAnswer` gates on — so the trail can never outrank the answer it accompanies. `getTurnNarrativeTrail` (public query, admitted like `getTurnAnswer`: `intelligence.view`, store-scoped, shared demo and public denied) walks the answer's ladder plus one rung: `reauthorizeTurnAccess` first, so a cross-store or non-owner read is `not_found` before any turn fact; then the profile's `narrativePolicy` (`policy_disabled` — the answer is readable, the drafts are not a thing a buffered profile serves, written before the policy changed or not); then `suppressed`; then `not_ready` when the run has not completed or the release has not committed; then the stored class against the viewer's current grant (`egress_beyond_authority`). The reason vocabulary is the answer's plus `policy_disabled`; there is no epoch fence, because the answer has none and a committed turn has nothing left a fence could stop. It never writes. A committed turn that narrated nothing serves `{ kind: "trail", committedAt, entries: [] }` rather than refusing — an honest empty record, not a missing one.
- **Bounds.** `AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES` is 96 KiB for the whole turn. Over it, every draft is cut to one common byte ceiling — the highest the trail still fits under — at a whole codepoint, marking only what was cut. No ordinal is ever dropped: how many drafts there were and in what order is part of the record, and a missing ordinal would be a worse lie than a shortened one.
- **Retention and removal.** Standard class, 365 days as the leaf's own literal, expired by the `sweepExpiredAgentContent` phase (`deletedNarrativeTrails`); store and organization removal delete through the scope indexes. Release suppression deliberately does **not** delete — the row stays at rest and the ladder refuses, mirroring the committed artifact.
- **Containment.** Only the leaf, `turns.ts`, `retention.ts`, the schema, and tests may name the table; only `turns.ts` and `retention.ts` import the leaf. `historyProjection.ts`, the prompt assembler, and `citations.ts` reach it neither way — a previous turn's unverified drafts can never enter a prompt, and a citation can never resolve against one. `historyProjection.test.ts` holds both lists exact.

In the browser, the panel shows the trail in two places: behind the committed answer of the active turn (the same collapsed "How Athena got here" block the in-session timeline used, now fed by the server so it survives a reload), and on each earlier thread-history entry that has a committed answer, where the block mounts its subscription lazily on first open so a long thread does not open one query per turn.

### Fence and rollback for `narrativePolicy`

`narrativePolicy` (`provisional_streaming | buffered`) is a required per-profile field folded into the registry's compatibility digest, and the protocol version is part of the same digest — which is why this contract moved it to `fnv1a64:501827e670579cf1`. Changing either ships through the standing procedure in [capability-authoring.md](./capability-authoring.md) §10.1/§10.2: fence the deployment about to be replaced (`bun scripts/agent-harness-fence.ts --reason "<deploy id>"`, one transaction that disables the named profiles and advances the epoch) → deploy → smoke while the switch is off → `bun scripts/agent-harness-switch.ts --profile <id> --enable --reason "<id>"`.

Rollback has two rungs and neither needs a code deploy to take effect for new turns: set the profiles' policy to `buffered` and fence again — the flush then refuses server-side and deletes whatever is at rest, and a turn whose text was already on screen withdraws with the `policy_disabled` reason rather than vanishing silently; the flip also refuses already-committed turns' trails with the same reason, so the history's draft blocks close while the answers stay readable — or use the profile kill switch, which denies new turns and cancels active ones.

## 6. Safety ceilings

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

## 7. Deployment findings (scenario 1)

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

## 8. Construction guide for the executor and the turn host

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
