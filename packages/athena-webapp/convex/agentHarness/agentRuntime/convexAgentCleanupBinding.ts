/**
 * Production binding of the Convex Agent cleanup hook (V8-safe).
 *
 * The kernel's retention module may not name the component (`components.agent`
 * is a runtime-native identifier reserved to this directory), so this file is
 * the one place that binds the mounted component to the adapter's cleanup
 * factory (`convexAgentCleanup.ts`). It
 * imports only the generated `components` object and the environment-neutral
 * cleanup module — no `@convex-dev/agent` value import, no Node runtime.
 */
import { components } from "../../_generated/api";
import { CONVEX_AGENT_ADAPTER_KIND } from "./convexAgentKind";
import { createConvexAgentCleanupHook } from "./convexAgentCleanup";

export { CONVEX_AGENT_ADAPTER_KIND };

/** The hook the harness retention registry runs for `convex_agent` bindings. */
export function createProductionConvexAgentCleanupHook() {
  return createConvexAgentCleanupHook(components.agent);
}
