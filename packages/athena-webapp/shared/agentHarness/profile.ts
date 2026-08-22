/**
 * Agent profile and presentation-adapter contracts (browser-safe).
 *
 * A profile selects packages, lifecycle, scope policy, budgets, prompt and
 * egress policy, a presentation adapter, and evaluation scenarios. It never
 * adds kernel behavior: anything a profile needs that these contracts cannot
 * express is a versioned contract evolution, not a profile exception.
 *
 * The presentation adapter is what the reusable operator agent host consumes: profile
 * id, an opaque authorized context binding with a human-readable label, entry
 * metadata, mount mode, optional evidence-backed starter intents, a
 * source-destination resolver that may only yield internal routes, and the
 * thread-key policy. The host owns submission, state transitions,
 * cancellation, completion quality, evidence display, responsiveness, and
 * accessibility; the adapter owns none of them.
 */
import type { BudgetVector } from "./execution";
import { AGENT_BUDGET_DIMENSIONS } from "./execution";
import {
  manifestEgressClass,
  type AgentCapabilityManifest,
  type AgentSdkView,
} from "./manifest";
import type { AgentSourceRef } from "./results";
import {
  AGENT_EGRESS_CLASSES,
  AGENT_HARNESS_CONTRACT_VERSION,
  AGENT_LIFECYCLE_STATES,
  AGENT_MOUNT_MODES,
  AGENT_SCOPE_KINDS,
  deepFreezeContract,
  egressClassRank,
  isNonEmptyString,
  isOneOf,
  isPlainObject,
  isPositiveInteger,
  throwContractIssues,
  versionedExtensionRequired,
  type AgentContractIssue,
  type AgentEgressClass,
  type AgentHarnessContractVersion,
  type AgentLifecycleState,
  type AgentMountMode,
  type AgentScopeKind,
} from "./values";

// ---------------------------------------------------------------------------
// Presentation adapter
// ---------------------------------------------------------------------------

export type AgentContextValues = { readonly [key: string]: string };

/** Only server-minted internal routes are interactive in v1. */
export type AgentSourceDestination = {
  readonly kind: "internal_route";
  readonly route: string;
  readonly label: string;
};

export type AgentStarterIntent = {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly requiresPackages: readonly string[];
};

export const AGENT_CONTEXT_CHANGE_POLICIES = [
  "detach_and_offer_new_thread",
  "confirm_before_next_turn",
] as const;
export type AgentContextChangePolicy = (typeof AGENT_CONTEXT_CHANGE_POLICIES)[number];

/** V1 blocks a second submission on an active thread; it never queues. */
export const AGENT_ACTIVE_TURN_POLICIES = ["block_second_submission"] as const;
export type AgentActiveTurnPolicy = (typeof AGENT_ACTIVE_TURN_POLICIES)[number];

export const AGENT_THREAD_KEY_PROFILE_PART = "profileId";

export type AgentThreadKeyPolicyInput = {
  /** `profileId` plus context-binding keys that identify one thread. */
  readonly parts: readonly string[];
  readonly onContextChange: AgentContextChangePolicy;
  readonly activeTurnPolicy: AgentActiveTurnPolicy;
};

export type AgentThreadKeyPolicy = AgentThreadKeyPolicyInput & {
  readonly compose: (context: AgentContextValues) => string;
};

export type AgentContextBinding = {
  readonly scopeKind: AgentScopeKind;
  /** Context keys the host must show before any question is sent. */
  readonly keys: readonly string[];
  /** Keys snapshotted into every turn (e.g. operating date). */
  readonly snapshotKeys?: readonly string[];
};

export type AgentPresentationAdapterInput = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly profileId: string;
  readonly contextBinding: AgentContextBinding;
  readonly contextLabel: (context: AgentContextValues) => string;
  readonly entry: { readonly label: string; readonly location: string };
  readonly mountMode: AgentMountMode;
  readonly starterIntents: readonly AgentStarterIntent[];
  readonly resolveSourceDestination: (sourceRef: AgentSourceRef) => AgentSourceDestination | null;
  readonly threadKeyPolicy: AgentThreadKeyPolicyInput;
};

export type AgentPresentationAdapter = Omit<AgentPresentationAdapterInput, "threadKeyPolicy"> & {
  readonly threadKeyPolicy: AgentThreadKeyPolicy;
};

export function composeThreadKey(
  profileId: string,
  parts: readonly string[],
  context: AgentContextValues,
): string {
  const segments = parts
    .filter((part) => part !== AGENT_THREAD_KEY_PROFILE_PART)
    .map((part) => `${part}=${context[part] ?? ""}`);
  return [profileId, ...segments].join("|");
}

export function definePresentationAdapter<const P extends AgentPresentationAdapterInput>(
  input: P,
): Omit<P, "threadKeyPolicy"> & { readonly threadKeyPolicy: P["threadKeyPolicy"] & AgentThreadKeyPolicy } {
  const threadKeyPolicy = {
    ...input.threadKeyPolicy,
    compose: (context: AgentContextValues) =>
      composeThreadKey(input.profileId, input.threadKeyPolicy.parts, context),
  };
  return deepFreezeContract({ ...input, threadKeyPolicy }) as Omit<P, "threadKeyPolicy"> & {
    readonly threadKeyPolicy: P["threadKeyPolicy"] & AgentThreadKeyPolicy;
  };
}

// ---------------------------------------------------------------------------
// Profile definition
// ---------------------------------------------------------------------------

export const AGENT_EVALUATION_SCENARIO_KINDS = [
  "cross_package",
  "role_restricted",
  "partial_or_no_data",
  "cancellation",
  "citation_resolution",
] as const;
export type AgentEvaluationScenarioKind = (typeof AGENT_EVALUATION_SCENARIO_KINDS)[number];

/** Every profile must carry at least these representative smoke tasks. */
export const AGENT_REQUIRED_EVALUATION_KINDS = [
  "cross_package",
  "role_restricted",
  "partial_or_no_data",
] as const satisfies readonly AgentEvaluationScenarioKind[];

export type AgentEvaluationScenario = {
  readonly id: string;
  readonly kind: AgentEvaluationScenarioKind;
  readonly prompt: string;
  readonly expects: readonly string[];
};

export type AgentProfileBudgetPolicy = {
  readonly runLimits: BudgetVector;
  readonly attemptLimits?: BudgetVector;
  readonly maxAttempts: number;
  readonly maxInFlightCalls: number;
};

export type AgentProfilePromptPolicy = {
  readonly intent: string;
  /** Label under which retrieved product data is presented as untrusted data. */
  readonly untrustedDataLabel: string;
  readonly maxPromptBytes: number;
  readonly maxPromptTokens: number;
};

export type AgentProviderAllowance = {
  readonly providerId: string;
  readonly modelId: string;
  readonly region: string;
  readonly maxClass: AgentEgressClass;
};

export type AgentProfileEgressPolicy = {
  readonly maxClass: AgentEgressClass;
  readonly providers: readonly AgentProviderAllowance[];
};

export type AgentProfileDefinition = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly lifecycle: AgentLifecycleState;
  readonly scope: { readonly kind: AgentScopeKind };
  readonly packages: readonly { readonly packageKey: string; readonly packageVersion: string }[];
  readonly budgetPolicy: AgentProfileBudgetPolicy;
  readonly promptPolicy: AgentProfilePromptPolicy;
  readonly egressPolicy: AgentProfileEgressPolicy;
  /** Runtime adapter kind selected for the profile (the Convex Agent adapter registers `convex_agent`). */
  readonly runtimeAdapterKind: string;
  readonly presentation: AgentPresentationAdapter;
  readonly evaluation: { readonly scenarios: readonly AgentEvaluationScenario[] };
};

export type AgentProfileValidation =
  | { readonly ok: true; readonly profile: AgentProfileDefinition }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

export function validateProfileDefinition(profile: AgentProfileDefinition): AgentProfileValidation {
  const issues: AgentContractIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const extension = (primitive: string, value: unknown, path: string) =>
    issues.push(versionedExtensionRequired(primitive, String(value), path));
  const raw: Record<string, unknown> = isPlainObject(profile) ? profile : {};
  if (!isPlainObject(profile)) {
    add("profile_invalid", "$", "Profile must be a plain object.");
    return { ok: false, issues };
  }

  if (raw.contractVersion !== AGENT_HARNESS_CONTRACT_VERSION) {
    extension("contractVersion", raw.contractVersion, "contractVersion");
  }
  if (!isNonEmptyString(raw.profileId)) add("metadata_incomplete", "profileId", "Profile id is required.");
  if (!isNonEmptyString(raw.profileVersion)) {
    add("metadata_incomplete", "profileVersion", "Profile version is required.");
  }
  if (!isOneOf(AGENT_LIFECYCLE_STATES, raw.lifecycle)) extension("lifecycle", raw.lifecycle, "lifecycle");
  const scope = raw.scope;
  if (!isPlainObject(scope)) {
    add("metadata_incomplete", "scope", "Scope kind is required.");
  } else if (!isOneOf(AGENT_SCOPE_KINDS, scope.kind)) {
    extension("scope.kind", scope.kind, "scope.kind");
  }

  if (!Array.isArray(raw.packages) || raw.packages.length === 0) {
    add("packages_empty", "packages", "A profile selects at least one package.");
  } else {
    const seen = new Set<string>();
    raw.packages.forEach((selection, index) => {
      if (!isPlainObject(selection) || !isNonEmptyString(selection.packageKey) || !isNonEmptyString(selection.packageVersion)) {
        add("package_selection_invalid", `packages[${index}]`, "Package selections carry key and version.");
        return;
      }
      if (seen.has(selection.packageKey)) {
        add("package_duplicate", `packages[${index}]`, `Package "${selection.packageKey}" selected twice.`);
      }
      seen.add(selection.packageKey);
    });
  }

  const budget = raw.budgetPolicy;
  if (!isPlainObject(budget) || !isPlainObject(budget.runLimits)) {
    add("budget_invalid", "budgetPolicy", "Run limits are required.");
  } else {
    for (const dimension of AGENT_BUDGET_DIMENSIONS) {
      if (!isPositiveInteger(budget.runLimits[dimension])) {
        add("budget_invalid", `budgetPolicy.runLimits.${dimension}`, "Run limits are positive integers.");
      }
    }
    if (!isPositiveInteger(budget.maxAttempts)) {
      add("budget_invalid", "budgetPolicy.maxAttempts", "maxAttempts must be positive.");
    }
    const calls = typeof budget.runLimits.calls === "number" ? budget.runLimits.calls : 0;
    if (!isPositiveInteger(budget.maxInFlightCalls) || budget.maxInFlightCalls > calls) {
      add("budget_invalid", "budgetPolicy.maxInFlightCalls", "In-flight cap must be positive and within the call budget.");
    }
  }

  const prompt = raw.promptPolicy;
  if (
    !isPlainObject(prompt) ||
    !isNonEmptyString(prompt.intent) ||
    !isNonEmptyString(prompt.untrustedDataLabel) ||
    !isPositiveInteger(prompt.maxPromptBytes) ||
    !isPositiveInteger(prompt.maxPromptTokens)
  ) {
    add("metadata_incomplete", "promptPolicy", "Prompt policy needs intent, untrusted-data label, and size ceilings.");
  }

  const egress = raw.egressPolicy;
  if (!isPlainObject(egress)) {
    add("metadata_incomplete", "egressPolicy", "Egress policy is required.");
  } else {
    if (!isOneOf(AGENT_EGRESS_CLASSES, egress.maxClass)) extension("egressClass", egress.maxClass, "egressPolicy.maxClass");
    if (!Array.isArray(egress.providers) || egress.providers.length === 0) {
      add("providers_empty", "egressPolicy.providers", "Allowlist at least one provider/model/region.");
    } else {
      egress.providers.forEach((provider, index) => {
        const path = `egressPolicy.providers[${index}]`;
        if (
          !isPlainObject(provider) ||
          !isNonEmptyString(provider.providerId) ||
          !isNonEmptyString(provider.modelId) ||
          !isNonEmptyString(provider.region)
        ) {
          add("provider_invalid", path, "Providers carry id, model, and region.");
          return;
        }
        if (!isOneOf(AGENT_EGRESS_CLASSES, provider.maxClass)) {
          extension("egressClass", provider.maxClass, `${path}.maxClass`);
        }
      });
    }
  }

  if (!isNonEmptyString(raw.runtimeAdapterKind)) {
    add("metadata_incomplete", "runtimeAdapterKind", "Select a runtime adapter kind.");
  }

  const presentation = raw.presentation;
  if (!isPlainObject(presentation)) {
    add("metadata_incomplete", "presentation", "Presentation adapter is required.");
  } else {
    if (presentation.contractVersion !== AGENT_HARNESS_CONTRACT_VERSION) {
      extension("contractVersion", presentation.contractVersion, "presentation.contractVersion");
    }
    if (presentation.profileId !== raw.profileId) {
      add("presentation_profile_mismatch", "presentation.profileId", "Presentation adapter belongs to another profile.");
    }
    const binding = presentation.contextBinding;
    const contextKeys = new Set<string>();
    if (!isPlainObject(binding) || !Array.isArray(binding.keys) || binding.keys.length === 0) {
      add("metadata_incomplete", "presentation.contextBinding", "Context binding needs a scope kind and keys.");
    } else {
      if (!isOneOf(AGENT_SCOPE_KINDS, binding.scopeKind)) {
        extension("scope.kind", binding.scopeKind, "presentation.contextBinding.scopeKind");
      } else if (isPlainObject(scope) && scope.kind !== binding.scopeKind) {
        add("scope_mismatch", "presentation.contextBinding.scopeKind", "Context binding scope differs from profile scope.");
      }
      for (const key of binding.keys) contextKeys.add(String(key));
      const snapshotKeys: unknown[] = Array.isArray(binding.snapshotKeys) ? binding.snapshotKeys : [];
      for (const key of snapshotKeys) {
        if (!contextKeys.has(String(key))) {
          add("context_key_unbound", "presentation.contextBinding.snapshotKeys", `Snapshot key "${String(key)}" is not a context key.`);
        }
      }
    }
    if (typeof presentation.contextLabel !== "function") {
      add("metadata_incomplete", "presentation.contextLabel", "Provide a human-readable context label.");
    }
    const entry = presentation.entry;
    if (!isPlainObject(entry) || !isNonEmptyString(entry.label) || !isNonEmptyString(entry.location)) {
      add("metadata_incomplete", "presentation.entry", "Entry label and location are required.");
    }
    if (!isOneOf(AGENT_MOUNT_MODES, presentation.mountMode)) {
      extension("mountMode", presentation.mountMode, "presentation.mountMode");
    }
    if (!Array.isArray(presentation.starterIntents)) {
      add("metadata_incomplete", "presentation.starterIntents", "Starter intents must be an array (may be empty).");
    } else {
      presentation.starterIntents.forEach((intent, index) => {
        if (
          !isPlainObject(intent) ||
          !isNonEmptyString(intent.id) ||
          !isNonEmptyString(intent.label) ||
          !isNonEmptyString(intent.prompt) ||
          !Array.isArray(intent.requiresPackages)
        ) {
          add("starter_intent_invalid", `presentation.starterIntents[${index}]`, "Starter intents carry id, label, prompt, and packages.");
        }
      });
    }
    if (typeof presentation.resolveSourceDestination !== "function") {
      add("metadata_incomplete", "presentation.resolveSourceDestination", "Provide a source-destination resolver.");
    }
    const threadKey = presentation.threadKeyPolicy;
    if (!isPlainObject(threadKey) || !Array.isArray(threadKey.parts) || threadKey.parts.length === 0) {
      add("metadata_incomplete", "presentation.threadKeyPolicy", "Thread-key policy is required.");
    } else {
      if (!threadKey.parts.includes(AGENT_THREAD_KEY_PROFILE_PART)) {
        add("thread_key_part_unbound", "presentation.threadKeyPolicy.parts", "Thread keys always include the profile id.");
      }
      for (const part of threadKey.parts) {
        if (part !== AGENT_THREAD_KEY_PROFILE_PART && !contextKeys.has(String(part))) {
          add("thread_key_part_unbound", "presentation.threadKeyPolicy.parts", `Thread-key part "${String(part)}" is not a context key.`);
        }
      }
      if (!isOneOf(AGENT_CONTEXT_CHANGE_POLICIES, threadKey.onContextChange)) {
        extension("threadKeyPolicy.onContextChange", threadKey.onContextChange, "presentation.threadKeyPolicy.onContextChange");
      }
      if (!isOneOf(AGENT_ACTIVE_TURN_POLICIES, threadKey.activeTurnPolicy)) {
        extension("threadKeyPolicy.activeTurnPolicy", threadKey.activeTurnPolicy, "presentation.threadKeyPolicy.activeTurnPolicy");
      }
      if (typeof threadKey.compose !== "function") {
        add("metadata_incomplete", "presentation.threadKeyPolicy.compose", "Use definePresentationAdapter to derive compose().");
      }
    }
  }

  const evaluation = raw.evaluation;
  if (!isPlainObject(evaluation) || !Array.isArray(evaluation.scenarios)) {
    add("metadata_incomplete", "evaluation", "Evaluation scenarios are required.");
  } else {
    const kinds = new Set<string>();
    evaluation.scenarios.forEach((scenario, index) => {
      const path = `evaluation.scenarios[${index}]`;
      if (!isPlainObject(scenario) || !isNonEmptyString(scenario.id) || !isNonEmptyString(scenario.prompt) || !Array.isArray(scenario.expects)) {
        add("evaluation_scenario_invalid", path, "Scenarios carry id, kind, prompt, and expectations.");
        return;
      }
      if (!isOneOf(AGENT_EVALUATION_SCENARIO_KINDS, scenario.kind)) {
        extension("evaluation.kind", scenario.kind, `${path}.kind`);
        return;
      }
      kinds.add(scenario.kind);
    });
    for (const required of AGENT_REQUIRED_EVALUATION_KINDS) {
      if (!kinds.has(required)) {
        add("evaluation_scenarios_incomplete", "evaluation.scenarios", `A "${required}" scenario is required.`);
      }
    }
  }

  return issues.length === 0 ? { ok: true, profile } : { ok: false, issues };
}

/** Identity helper that validates, fails fast, and freezes the profile. */
export function defineAgentProfile<const P extends AgentProfileDefinition>(profile: P): P {
  const validation = validateProfileDefinition(profile);
  if (!validation.ok) throwContractIssues(`profile ${profile?.profileId ?? "<unknown>"}`, validation.issues);
  return deepFreezeContract(profile);
}

// ---------------------------------------------------------------------------
// Profile selection conformance
// ---------------------------------------------------------------------------

export type AgentProfileSelectionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

/**
 * Check a profile's package selection against a composed SDK view and the
 * manifests behind it: packages must exist at the selected version, every
 * selected capability must share the profile's scope kind and fit its egress
 * ceiling, and starter intents may only require selected packages.
 */
export function assertProfileSelection(
  profile: AgentProfileDefinition,
  view: AgentSdkView,
  manifests: readonly AgentCapabilityManifest[],
): AgentProfileSelectionResult {
  const issues: AgentContractIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const selected = new Set<string>();

  profile.packages.forEach((selection, index) => {
    const pkg = view.packages[selection.packageKey];
    const path = `packages[${index}]`;
    if (!pkg) {
      add("package_unknown", path, `Package "${selection.packageKey}" is not in the SDK view.`);
      return;
    }
    if (pkg.version !== selection.packageVersion) {
      add(
        "package_version_mismatch",
        path,
        `Package "${selection.packageKey}" is ${pkg.version}; profile selects ${selection.packageVersion}.`,
      );
      return;
    }
    selected.add(selection.packageKey);
  });

  for (const manifest of manifests) {
    if (!selected.has(manifest.namespace.package)) continue;
    const path = `packages.${manifest.namespace.package}.${manifest.namespace.resource}`;
    if (manifest.scope.kind !== profile.scope.kind) {
      add("scope_mismatch", path, `Capability scope "${manifest.scope.kind}" differs from profile scope "${profile.scope.kind}".`);
    }
    const reach = manifestEgressClass(manifest);
    if (egressClassRank(reach) > egressClassRank(profile.egressPolicy.maxClass)) {
      add("egress_class_exceeded", path, `Capability reaches "${reach}" but the profile allows "${profile.egressPolicy.maxClass}".`);
    }
  }

  profile.presentation.starterIntents.forEach((intent, index) => {
    for (const packageKey of intent.requiresPackages) {
      if (!selected.has(packageKey)) {
        add(
          "starter_intent_package_not_selected",
          `presentation.starterIntents[${index}]`,
          `Starter intent "${intent.id}" requires unselected package "${packageKey}".`,
        );
      }
    }
  });

  const providerCeiling = profile.egressPolicy.providers.reduce(
    (max, provider) => (egressClassRank(provider.maxClass) > egressClassRank(max) ? provider.maxClass : max),
    AGENT_EGRESS_CLASSES[0] as AgentEgressClass,
  );
  if (egressClassRank(providerCeiling) < egressClassRank(profile.egressPolicy.maxClass)) {
    add("provider_class_below_profile", "egressPolicy.providers", "No allowed provider covers the profile's maximum egress class.");
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ---------------------------------------------------------------------------
// Host state vocabulary (consumed by the reusable operator agent host)
// ---------------------------------------------------------------------------

export const AGENT_HOST_STATES = [
  "idle",
  "submitting",
  "reconnecting",
  "running",
  "cancellation_requested",
  "completed",
  "partial",
  "no_usable_sources",
  "terminal_denied",
  "expired_content",
] as const;
export type AgentHostState = (typeof AGENT_HOST_STATES)[number];
