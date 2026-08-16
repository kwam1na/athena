import type { AthenaCapability } from "../platform/capabilityCatalog";
import type { OperationCapabilitySpec } from "./types";

export {
  ATHENA_CAPABILITY_CATALOG,
  classifyAthenaPublicWrite,
  isSharedDemoCapabilityAllowed,
  SHARED_DEMO_ALLOWED_CAPABILITIES,
  type AthenaCapability,
} from "../platform/capabilityCatalog";

export function isDynamicOperationCapability(
  capability: OperationCapabilitySpec,
): capability is Extract<OperationCapabilitySpec, { kind: "dynamic" }> {
  return typeof capability === "object" && capability.kind === "dynamic";
}

/**
 * Every capability a call requires, with all-of semantics.
 *
 * A dynamic capability classifies the whole call once: a batch that mixes a
 * granted and an ungranted capability requires both, so it is denied before
 * the handler runs rather than partially applied. A resolved capability
 * outside `candidates` is a declaration drift and denies the call.
 */
export function resolveOperationCapabilities(
  capability: OperationCapabilitySpec,
  args: Record<string, unknown>,
):
  | { kind: "resolved"; capabilities: readonly AthenaCapability[] }
  | { kind: "out_of_candidates"; capabilities: readonly AthenaCapability[] } {
  if (!isDynamicOperationCapability(capability)) {
    return { kind: "resolved", capabilities: [capability] };
  }

  const resolved = capability.resolve(args);
  const candidates = new Set<AthenaCapability>(capability.candidates);
  const outside = resolved.filter((entry) => !candidates.has(entry));
  if (outside.length > 0) {
    return { kind: "out_of_candidates", capabilities: outside };
  }
  return { kind: "resolved", capabilities: resolved };
}

export function describeOperationCapability(
  capability: OperationCapabilitySpec,
): string {
  return isDynamicOperationCapability(capability)
    ? `dynamic(${capability.candidates.join(",")})`
    : capability;
}
