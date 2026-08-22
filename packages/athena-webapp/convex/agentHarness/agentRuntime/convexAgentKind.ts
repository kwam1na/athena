/**
 * Adapter kind constant, environment-neutral.
 *
 * `convexAgent.ts` is a Node-runtime module; V8 modules (the retention
 * binding, the turn seams) need the adapter kind without loading the Node
 * adapter, so the constant lives here and `convexAgent.ts` re-exports it.
 */
export const CONVEX_AGENT_ADAPTER_KIND = "convex_agent" as const;
