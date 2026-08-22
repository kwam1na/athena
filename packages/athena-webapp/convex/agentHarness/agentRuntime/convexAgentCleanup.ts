/**
 * Retention cleanup of Convex Agent runtime payloads, environment-neutral so
 * U1's mutation-side retention hook (`registerAgentRuntimeCleanupHook`) can
 * run it from the V8 runtime without the Node-only adapter. The adapter's
 * `cleanup` delegates here so there is exactly one deletion path.
 *
 * Idempotent and retryable: deleting an already-deleted ref reports nothing
 * deleted and `ok: true`. With an action context the thread is removed
 * synchronously; with only query/mutation reach the component's async
 * deletion is used (it self-schedules until done).
 */
import type { AgentComponent } from "@convex-dev/agent";

import type { AgentRuntimeCleanupOutcome } from "../../../shared/agentHarness/agentRuntime";
import {
  createComponentLookups,
  tokenOf,
  tokenOfMessage,
  type ComponentLookups,
  type ConvexAgentRuntimeCtx,
  type ThreadState,
} from "./convexAgentRefs";

export type ConvexAgentCleanupRefs = {
  readonly threadRef?: string;
  readonly inputRef?: string;
  readonly turnRef?: string;
  readonly projectionRef?: string;
};

export async function cleanupConvexAgentRuntime(
  ctx: ConvexAgentRuntimeCtx,
  component: AgentComponent,
  refs: ConvexAgentCleanupRefs,
  lookups: ComponentLookups = createComponentLookups(ctx, component),
): Promise<AgentRuntimeCleanupOutcome> {
  const { threadRef, inputRef, turnRef, projectionRef } = refs;
  const deleted: string[] = [];
  const thread = threadRef ? await lookups.resolveThread(threadRef as never) : undefined;
  const scopedThreads = (
    await Promise.all([
      projectionRef ? lookups.resolveThreadOfScopedRef(projectionRef, "runtime_projection") : undefined,
      turnRef ? lookups.resolveThreadOfScopedRef(turnRef, "runtime_turn") : undefined,
      inputRef ? lookups.resolveThreadOfScopedRef(inputRef, "runtime_input") : undefined,
    ])
  ).filter((candidate): candidate is ThreadState => candidate !== undefined);
  const candidateThreads = thread ? [thread] : [...new Map(scopedThreads.map((candidate) => [candidate.token, candidate])).values()];

  const tokens: Array<[string, string]> = [];
  const projectionToken = projectionRef ? tokenOf(projectionRef, "runtime_projection") : undefined;
  const turnToken = turnRef ? tokenOf(turnRef, "runtime_turn") : undefined;
  const inputToken = inputRef ? tokenOf(inputRef, "runtime_input") : undefined;
  if (projectionToken && projectionRef) tokens.push([projectionToken, projectionRef]);
  if (turnToken && turnRef) tokens.push([turnToken, turnRef]);
  if (inputToken && inputRef) tokens.push([inputToken, inputRef]);
  for (const candidate of candidateThreads) {
    if (tokens.length === 0) break;
    const messages = await lookups.listMessages(candidate.threadId);
    const present = tokens.filter(([token]) => messages.some((message) => tokenOfMessage(message) === token));
    if (present.length === 0) continue;
    await ctx.runMutation(component.messages.deleteByIds, {
      messageIds: messages.filter((message) => present.some(([token]) => tokenOfMessage(message) === token)).map((message) => message._id),
    });
    deleted.push(...present.map(([, ref]) => ref));
  }

  if (threadRef && thread) {
    if (ctx.runAction) {
      await ctx.runAction(component.threads.deleteAllForThreadIdSync, { threadId: thread.threadId });
    } else {
      await ctx.runMutation(component.threads.deleteAllForThreadIdAsync, { threadId: thread.threadId });
    }
    lookups.threadsByRef.delete(thread.threadRef);
    deleted.push(threadRef);
  }
  return { ok: true, deleted };
}

/**
 * Factory for U1's retention registry:
 * `registerAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND, createConvexAgentCleanupHook(components.agent))`.
 * Typed structurally so this module never imports the kernel's retention module.
 */
export function createConvexAgentCleanupHook(component: AgentComponent) {
  return async (
    ctx: ConvexAgentRuntimeCtx,
    descriptor: { readonly runtimeThreadRef?: string; readonly runtimeInputRef?: string; readonly runtimeProjectionRef?: string },
  ): Promise<{ ok: true } | { ok: false; retryable: boolean; error: string }> => {
    try {
      const outcome = await cleanupConvexAgentRuntime(ctx, component, {
        threadRef: descriptor.runtimeThreadRef,
        inputRef: descriptor.runtimeInputRef,
        projectionRef: descriptor.runtimeProjectionRef,
      });
      return outcome.ok ? { ok: true } : { ok: false, retryable: outcome.retryable, error: outcome.error };
    } catch {
      return { ok: false, retryable: true, error: "convex_agent_cleanup_failed" };
    }
  };
}
