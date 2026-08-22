/**
 * Runtime retention binding (kernel; V8).
 *
 * Authority boundary: runtime payloads (the operator prompt text, the per-turn
 * record, and the projected artifact narrative the Convex Agent component
 * holds) obey the same 30-day short-lived ceiling as every other harness
 * payload, and follow the Athena turn binding on store/organization removal.
 * The harness retention registry (`retention.ts`) drives both through one
 * adapter-keyed cleanup hook; this module registers the Convex Agent adapter's
 * hook for the `convex_agent` kind.
 *
 * Registration is lazy and idempotent (`ensureConvexAgentRuntimeCleanupRegistered`
 * is called by the retention sweep before every lookup), so it works in
 * whichever isolate runs the sweep and survives the test-only registry reset.
 * The binding never names the component itself: that lives in
 * `agentRuntime/convexAgentCleanupBinding.ts`.
 */
import type { MutationCtx } from "../_generated/server";
import { CONVEX_AGENT_ADAPTER_KIND, createProductionConvexAgentCleanupHook } from "./agentRuntime/convexAgentCleanupBinding";
import {
  hasAgentRuntimeCleanupHook,
  registerAgentRuntimeCleanupHook,
  type AgentRuntimeCleanupDescriptor,
  type AgentRuntimeCleanupHook,
  type AgentRuntimeCleanupResult,
} from "./retention";

export { CONVEX_AGENT_ADAPTER_KIND };

/**
 * Adapt the Convex Agent adapter's structurally typed hook to the retention
 * registry signature. Only the
 * opaque runtime refs cross; a thrown adapter error becomes a retryable
 * failure so the sweep backs off and retries rather than marking the turn
 * clean.
 */
export function createConvexAgentRuntimeCleanupHook(
  cleanup: ReturnType<typeof createProductionConvexAgentCleanupHook>,
): AgentRuntimeCleanupHook {
  return async (ctx: MutationCtx, descriptor: AgentRuntimeCleanupDescriptor): Promise<AgentRuntimeCleanupResult> => {
    const outcome = await cleanup(
      { runQuery: ctx.runQuery, runMutation: ctx.runMutation },
      {
        runtimeThreadRef: descriptor.runtimeThreadRef,
        runtimeInputRef: descriptor.runtimeInputRef,
        runtimeProjectionRef: descriptor.runtimeProjectionRef,
      },
    );
    return outcome.ok ? { ok: true } : { ok: false, retryable: outcome.retryable, error: outcome.error };
  };
}

/** Register the production hook once per isolate; a no-op when already present. */
export function ensureConvexAgentRuntimeCleanupRegistered(): void {
  if (hasAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND)) return;
  registerAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND, createConvexAgentRuntimeCleanupHook(createProductionConvexAgentCleanupHook()));
}
