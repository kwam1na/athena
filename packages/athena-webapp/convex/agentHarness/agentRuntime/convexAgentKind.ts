/**
 * Adapter identity constants, environment-neutral.
 *
 * `convexAgent.ts` is a Node-runtime module; V8 modules (the retention
 * binding, the turn seams) and the build-time SDK generator need the adapter
 * identity without loading the Node adapter or the AI SDK, so the constants
 * live here and `convexAgent.ts` re-exports them.
 *
 * The version is part of the published compatibility identity and of every
 * tool fingerprint, so changing it requires the pre-deploy epoch fence.
 */
export const CONVEX_AGENT_ADAPTER_KIND = "convex_agent" as const;

/** Exact package versions this adapter was proven against; bump only with the upgrade path in the runtime doc. */
export const CONVEX_AGENT_PINNED_VERSIONS = Object.freeze({
  "@convex-dev/agent": "0.7.1",
  ai: "7.0.76",
  "@ai-sdk/openai": "4.0.45",
});

export const CONVEX_AGENT_ADAPTER_VERSION =
  `convex_agent@${CONVEX_AGENT_PINNED_VERSIONS["@convex-dev/agent"]}+ai@${CONVEX_AGENT_PINNED_VERSIONS.ai}+athena.1` as const;
