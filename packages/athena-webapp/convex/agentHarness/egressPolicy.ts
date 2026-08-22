/**
 * Provider egress policy (kernel; pure, environment-neutral).
 *
 * Authority boundary (plan decision 12): every prompt, context field, history
 * artifact, and reachable capability carries an egress class; a turn's class
 * is the MAXIMUM across all of them, never a mid-turn renegotiation. The
 * profile allowlists provider/model/region combinations with the class each
 * may receive. Selection is deterministic (allowlist order), fails early when
 * nothing covers the class, never falls over to a less-trusted provider, and
 * is locked for the whole turn. Unclassified material is `restricted` (fail
 * closed). Provider evidence names model, region, policy class, retention
 * mode, and redaction — never a credential.
 */
import type { AgentModelSelection } from "../../shared/agentHarness/agentRuntime";
import type { AgentProfileEgressPolicy, AgentProviderAllowance } from "../../shared/agentHarness/profile";
import { AGENT_EGRESS_CLASSES, egressClassRank, isOneOf, maxEgressClass, type AgentEgressClass } from "../../shared/agentHarness/values";

/** Anything outside the closed vocabulary is treated as the most sensitive class. */
export function normalizeEgressClass(value: unknown): AgentEgressClass {
  return isOneOf(AGENT_EGRESS_CLASSES, value) ? value : "restricted";
}

export type AgentTurnEgressInputs = {
  readonly prompt: AgentEgressClass;
  readonly context: AgentEgressClass;
  /** Maximum class of every capability/projection reachable through the grant. */
  readonly grant: AgentEgressClass;
  /** Maximum class of every artifact admitted into the projected history. */
  readonly history: AgentEgressClass;
};

export function resolveTurnEgressClass(inputs: AgentTurnEgressInputs): AgentEgressClass {
  return maxEgressClass(
    normalizeEgressClass(inputs.prompt),
    normalizeEgressClass(inputs.context),
    normalizeEgressClass(inputs.grant),
    normalizeEgressClass(inputs.history),
  );
}

export type AgentProviderSelection =
  | { readonly kind: "selected"; readonly selection: AgentModelSelection; readonly allowance: AgentProviderAllowance }
  | { readonly kind: "no_compatible_provider"; readonly required: AgentEgressClass; readonly candidates: readonly AgentProviderAllowance[] };

export type AgentProviderSelectionOptions = {
  /** Credential/config check per provider id; unconfigured providers are skipped, never guessed. */
  readonly isConfigured?: (providerId: string) => boolean;
};

function covers(allowance: AgentProviderAllowance, required: AgentEgressClass): boolean {
  return egressClassRank(normalizeEgressClass(allowance.maxClass)) >= egressClassRank(required);
}

/** First allowance (allowlist order) whose class covers the requirement. */
export function selectProviderForEgress(
  policy: AgentProfileEgressPolicy,
  required: AgentEgressClass,
  options: AgentProviderSelectionOptions = {},
): AgentProviderSelection {
  const requiredClass = normalizeEgressClass(required);
  for (const allowance of policy.providers) {
    if (!covers(allowance, requiredClass)) continue;
    if (options.isConfigured && !options.isConfigured(allowance.providerId)) continue;
    return {
      kind: "selected",
      selection: { providerId: allowance.providerId, modelId: allowance.modelId, region: allowance.region },
      allowance,
    };
  }
  return { kind: "no_compatible_provider", required: requiredClass, candidates: [...policy.providers] };
}

/**
 * Allowances a retry of the SAME turn could move to: only those that still
 * cover the class. A less-trusted provider is never a failover target.
 */
export function permittedFailovers(
  policy: AgentProfileEgressPolicy,
  current: AgentProviderAllowance,
  required: AgentEgressClass,
): readonly AgentProviderAllowance[] {
  const requiredClass = normalizeEgressClass(required);
  return policy.providers.filter(
    (allowance) =>
      covers(allowance, requiredClass) &&
      !(allowance.providerId === current.providerId && allowance.modelId === current.modelId && allowance.region === current.region),
  );
}

export type AgentModelSelectionLockOutcome =
  | { readonly kind: "locked"; readonly selection: AgentModelSelection }
  | { readonly kind: "already_locked"; readonly selection: AgentModelSelection }
  | { readonly kind: "conflict"; readonly locked: AgentModelSelection };

function sameSelection(a: AgentModelSelection, b: AgentModelSelection): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.region === b.region;
}

/** V1 never switches provider mid-turn: one selection per turn key, conflicts are refused. */
export function createModelSelectionLock() {
  const locks = new Map<string, AgentModelSelection>();
  return {
    lock(turnKey: string, selection: AgentModelSelection): AgentModelSelectionLockOutcome {
      const existing = locks.get(turnKey);
      if (!existing) {
        const frozen = Object.freeze({ ...selection });
        locks.set(turnKey, frozen);
        return { kind: "locked", selection: frozen };
      }
      if (sameSelection(existing, selection)) return { kind: "already_locked", selection: existing };
      return { kind: "conflict", locked: existing };
    },
    selectionFor(turnKey: string): AgentModelSelection | undefined {
      return locks.get(turnKey);
    },
  };
}

export type AgentProviderEvidence = {
  readonly providerId: string;
  readonly modelId: string;
  readonly region: string;
  /** The class the turn required, i.e. what the provider may have received. */
  readonly policyClass: AgentEgressClass;
  readonly providerMaxClass: AgentEgressClass;
  readonly retentionMode: "provider_default";
  readonly redaction: "prompt_hash_only";
};

/** Provider invocation evidence (plan decision 12): policy facts only. */
export function describeProviderSelectionForEvidence(
  selected: Extract<AgentProviderSelection, { kind: "selected" }>,
  required: AgentEgressClass,
): AgentProviderEvidence {
  return {
    providerId: selected.selection.providerId,
    modelId: selected.selection.modelId,
    region: selected.selection.region,
    policyClass: normalizeEgressClass(required),
    providerMaxClass: normalizeEgressClass(selected.allowance.maxClass),
    retentionMode: "provider_default",
    redaction: "prompt_hash_only",
  };
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b(Bearer)\s+[A-Za-z0-9._-]{12,}/g,
  /\b(api[_-]?key|secret|token)\s*[=:]\s*[A-Za-z0-9._-]{8,}/gi,
];

/** Mask credential-shaped material in any diagnostic text before it is recorded. */
export function redactProviderSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0], "[redacted]");
  out = out.replace(SECRET_PATTERNS[1], "$1 [redacted]");
  out = out.replace(SECRET_PATTERNS[2], "$1=[redacted]");
  return out;
}
