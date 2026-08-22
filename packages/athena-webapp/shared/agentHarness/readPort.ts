/**
 * Domain-owned read-port definition and the explicit registration index
 * (browser-safe declaration; U4 binds the handlers at the operation-admission
 * composition root).
 *
 * A port binds one capability to an internal function reference, the read
 * intents the operation-admission rail already knows, the scope kind, a field
 * policy, its declared worst-case cost, completeness sources, and an
 * implementation version token that feeds the compatibility digest. The index
 * is explicit and agent-only: every grantable manifest maps to exactly one
 * port and every indexed port maps back to a manifest. Ordinary public reads
 * are not agent-exposed and are never orphans.
 */
import type { BudgetVector } from "./execution";
import { AGENT_BUDGET_DIMENSIONS } from "./execution";
import { namespacePath, supportedVerbs, type AgentCapabilityManifest } from "./manifest";
import {
  AGENT_HARNESS_CONTRACT_VERSION,
  AGENT_READ_VERBS,
  AGENT_SCOPE_KINDS,
  deepFreezeContract,
  isNonEmptyString,
  isNonNegativeInteger,
  isOneOf,
  isPlainObject,
  versionedExtensionRequired,
  type AgentContractIssue,
  type AgentHarnessContractVersion,
  type AgentReadVerb,
  type AgentScopeKind,
} from "./values";

export const AGENT_READ_PORT_HANDLER_KINDS = ["internal_query", "internal_action"] as const;
export type AgentReadPortHandlerKind = (typeof AGENT_READ_PORT_HANDLER_KINDS)[number];

/**
 * Internal function path in Convex `module/path:exportName` form. Public
 * `api.*` references and dotted paths are rejected: the bridge may only reach
 * registered internal functions.
 */
const INTERNAL_FUNCTION_PATH_PATTERN = /^[a-zA-Z0-9_]+(?:\/[a-zA-Z0-9_]+)*:[a-zA-Z0-9_]+$/;

export type AgentReadPortHandlerRef = {
  readonly kind: AgentReadPortHandlerKind;
  readonly functionPath: string;
};

export type AgentReadPortDefinition = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly portKey: string;
  readonly capabilityId: string;
  readonly verbs: readonly AgentReadVerb[];
  readonly scopeKind: AgentScopeKind;
  readonly readIntents: readonly string[];
  readonly implementationVersion: string;
  readonly declaredCost: BudgetVector;
  readonly handler: AgentReadPortHandlerRef;
  /** Sensitive projections the port can serve (mirrors the manifest). */
  readonly projections: readonly string[];
  readonly completenessSourceKeys: readonly string[];
};

export type AgentReadPortIndex = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly ports: readonly AgentReadPortDefinition[];
};

export function defineAgentReadPort<const P extends AgentReadPortDefinition>(port: P): P {
  return deepFreezeContract(port);
}

export type AgentReadPortValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

export function isInternalFunctionPath(functionPath: unknown): functionPath is string {
  return (
    typeof functionPath === "string" &&
    INTERNAL_FUNCTION_PATH_PATTERN.test(functionPath) &&
    !functionPath.startsWith("api") &&
    !functionPath.startsWith("_generated")
  );
}

export function validateReadPortDefinition(port: AgentReadPortDefinition): AgentReadPortValidation {
  const issues: AgentContractIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const raw: Record<string, unknown> = isPlainObject(port) ? port : {};
  if (!isPlainObject(port)) {
    add("port_invalid", "$", "Read port must be a plain object.");
    return { ok: false, issues };
  }
  if (raw.contractVersion !== AGENT_HARNESS_CONTRACT_VERSION) {
    issues.push(versionedExtensionRequired("contractVersion", String(raw.contractVersion), "contractVersion"));
  }
  if (!isNonEmptyString(raw.portKey)) add("metadata_incomplete", "portKey", "Port key is required.");
  if (!isNonEmptyString(raw.capabilityId)) add("metadata_incomplete", "capabilityId", "Capability id is required.");
  if (!Array.isArray(raw.verbs) || raw.verbs.length === 0) {
    add("metadata_incomplete", "verbs", "Declare the verbs the port serves.");
  } else {
    for (const verb of raw.verbs) {
      if (!isOneOf(AGENT_READ_VERBS, verb)) {
        issues.push(versionedExtensionRequired("operation.verb", String(verb), "verbs"));
      }
    }
  }
  if (!isOneOf(AGENT_SCOPE_KINDS, raw.scopeKind)) {
    issues.push(versionedExtensionRequired("scope.kind", String(raw.scopeKind), "scopeKind"));
  }
  if (!Array.isArray(raw.readIntents) || raw.readIntents.length === 0 || raw.readIntents.some((i) => !isNonEmptyString(i))) {
    add("read_intents_missing", "readIntents", "A port binds at least one admitted read intent.");
  }
  if (!isNonEmptyString(raw.implementationVersion)) {
    add("metadata_incomplete", "implementationVersion", "Implementation version token is required.");
  }
  const cost = raw.declaredCost;
  if (!isPlainObject(cost)) {
    add("cost_invalid", "declaredCost", "Declared worst-case cost is required.");
  } else {
    for (const dimension of AGENT_BUDGET_DIMENSIONS) {
      if (!isNonNegativeInteger(cost[dimension])) {
        add("cost_invalid", `declaredCost.${dimension}`, "Cost units are non-negative integers.");
      }
    }
    if (cost.calls !== 1) add("cost_invalid", "declaredCost.calls", "One port call costs exactly one call.");
  }
  const handler = raw.handler;
  if (!isPlainObject(handler) || !isOneOf(AGENT_READ_PORT_HANDLER_KINDS, handler.kind)) {
    add("handler_not_internal", "handler", "Handlers are internal queries or internal actions.");
  } else if (!isInternalFunctionPath(handler.functionPath)) {
    add("handler_not_internal", "handler.functionPath", "Handler must be an internal `module/path:export` reference, never api.*.");
  }
  if (!Array.isArray(raw.projections)) add("metadata_incomplete", "projections", "Declare served projections (may be empty).");
  if (!Array.isArray(raw.completenessSourceKeys) || raw.completenessSourceKeys.length === 0) {
    add("metadata_incomplete", "completenessSourceKeys", "Declare completeness source keys.");
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export type AgentReadPortIndexOptions = {
  /** Closed read-intent vocabulary check (the Convex registry supplies `isAthenaReadIntent`). */
  readonly isKnownReadIntent?: (intent: string) => boolean;
};

/**
 * Coverage invariant for the explicit agent read-port index: every manifest
 * binds to exactly one port that serves its verbs with the same intents,
 * scope, cost, projections, completeness sources, and implementation
 * version; every port maps back to a manifest.
 */
export function validateReadPortIndex(
  index: AgentReadPortIndex,
  manifests: readonly AgentCapabilityManifest[],
  options: AgentReadPortIndexOptions = {},
): AgentReadPortValidation {
  const issues: AgentContractIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (index.contractVersion !== AGENT_HARNESS_CONTRACT_VERSION) {
    issues.push(versionedExtensionRequired("contractVersion", String(index.contractVersion), "contractVersion"));
  }

  const byPortKey = new Map<string, AgentReadPortDefinition>();
  index.ports.forEach((port, position) => {
    const validation = validateReadPortDefinition(port);
    if (!validation.ok) {
      issues.push(...validation.issues.map((issue) => ({ ...issue, path: `ports[${position}].${issue.path}` })));
      return;
    }
    if (byPortKey.has(port.portKey)) {
      add("port_key_duplicate", `ports[${position}].portKey`, `Port key "${port.portKey}" is registered twice.`);
      return;
    }
    byPortKey.set(port.portKey, port);
    if (options.isKnownReadIntent) {
      for (const intent of port.readIntents) {
        if (!options.isKnownReadIntent(intent)) {
          add("read_intent_unknown", `ports[${position}].readIntents`, `"${intent}" is not in the closed read-intent catalog.`);
        }
      }
    }
  });

  const manifestByCapability = new Map<string, AgentCapabilityManifest>();
  for (const manifest of manifests) manifestByCapability.set(manifest.capabilityId, manifest);

  const claimedPortKeys = new Set<string>();
  for (const manifest of manifests) {
    const path = `manifests.${namespacePath(manifest.namespace)}`;
    const port = byPortKey.get(manifest.binding.portKey);
    if (!port || port.capabilityId !== manifest.capabilityId) {
      add("capability_port_missing", path, `No registered port "${manifest.binding.portKey}" serves ${manifest.capabilityId}.`);
      continue;
    }
    claimedPortKeys.add(port.portKey);
    const drift: string[] = [];
    if (!sameSet(port.verbs, supportedVerbs(manifest))) drift.push("verbs");
    if (!sameSet(port.readIntents, manifest.binding.readIntents)) drift.push("readIntents");
    if (port.scopeKind !== manifest.scope.kind) drift.push("scopeKind");
    if (port.implementationVersion !== manifest.binding.implementationVersion) drift.push("implementationVersion");
    if (!sameSet(port.projections, Object.keys(manifest.projections))) drift.push("projections");
    if (!sameSet(port.completenessSourceKeys, manifest.completeness.sourceKeys)) drift.push("completenessSourceKeys");
    for (const dimension of AGENT_BUDGET_DIMENSIONS) {
      if (port.declaredCost[dimension] !== manifest.cost.worstCasePerCall[dimension]) {
        drift.push(`declaredCost.${dimension}`);
        break;
      }
    }
    if (drift.length > 0) {
      add("port_binding_drift", path, `Port "${port.portKey}" drifts from its manifest on: ${drift.join(", ")}.`);
    }
  }

  for (const [portKey, port] of byPortKey) {
    if (claimedPortKeys.has(portKey)) continue;
    const manifest = manifestByCapability.get(port.capabilityId);
    const reason = manifest
      ? `manifest ${manifest.capabilityId} binds "${manifest.binding.portKey}" instead`
      : `capability ${port.capabilityId} has no manifest`;
    add("port_orphaned", `ports.${portKey}`, `Port "${portKey}" maps to no manifest (${reason}).`);
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
