export { createFakeStructuredTextProvider } from "./fake";
export type { FakeStructuredTextProviderOptions } from "./fake";
export { createTanStackStructuredTextProvider } from "./tanstack";
export type { TanStackStructuredTextProviderOptions } from "./tanstack";
// The Convex Agent model path (agent harness, V26-1265) is a separate provider
// adapter normalized into the same Athena evidence shapes; TanStack AI above
// stays the structured-text provider and is untouched.
export {
  ATHENA_AGENT_TURN_V1,
  CONVEX_AGENT_PROVIDER_KEY,
  buildConvexAgentInvocationSummary,
  createConvexAgentProviderDescriptor,
  toAthenaProviderUsage,
} from "./convexAgent";
export type { ConvexAgentProviderDescriptor, ConvexAgentProviderOptions, ConvexAgentSettledUsage } from "./convexAgent";
