/**
 * Registration constants for the Convex Agent component.
 *
 * The component itself is mounted directly in the root `convex/convex.config.ts`
 * (`app.use(agent, { name: CONVEX_AGENT_COMPONENT_NAME })`): mounting it through a
 * local module makes the Convex backend reject the push with an opaque
 * `start_push 500` (see `docs/agent/agent-harness-runtime.md`, section 6). This
 * module therefore carries no runtime-native import and no `use` call; it only
 * names the mount so the root config and the adapter agree on
 * `components.<name>`.
 */

/** Name the component is mounted under (`components.agent` in `_generated/api`). */
export const CONVEX_AGENT_COMPONENT_NAME = "agent" as const;
