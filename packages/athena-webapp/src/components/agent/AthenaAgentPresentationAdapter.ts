/**
 * Host-side presentation contract for the reusable Athena agent experience.
 *
 * This module is the only place the host translates profile-provided metadata
 * and backend outcome codes into operator-facing material: thread keys the turn
 * contract accepts, visible context labels, internal source destinations, and
 * calm copy for every denial, failure, and unavailability reason. It knows
 * nothing about any product surface — a profile supplies its own values through
 * `AgentPresentationAdapter` and gets the same host behaviour.
 */
import {
  AGENT_PROGRESS_MILESTONES,
  type AgentProgressMilestone,
} from "~/shared/agentHarness/agentRuntime";
import {
  AGENT_THREAD_KEY_PATTERN,
  definePresentationAdapter,
  type AgentContextValues,
  type AgentPresentationAdapter,
  type AgentPresentationAdapterInput,
  type AgentSourceDestination,
} from "~/shared/agentHarness/profile";
import { isOpaqueRef } from "~/shared/agentHarness/values";

export type AthenaAgentPresentation = AgentPresentationAdapter;
export type AthenaAgentContext = AgentContextValues;

/** Identity helper so a surface declares its adapter with the shared contract. */
export const defineAthenaAgentPresentation = definePresentationAdapter;

// ---------------------------------------------------------------------------
// Thread keys
// ---------------------------------------------------------------------------

/**
 * The grammar `startTurn` accepts, shared with the turn contract. The composed
 * key from a presentation adapter is a readable join (`<profileId>|<key>=<value>`)
 * that this grammar rejects, so the host encodes it rather than sending a key
 * the turn contract would deny.
 */
export const ATHENA_AGENT_THREAD_KEY_PATTERN = AGENT_THREAD_KEY_PATTERN;

const THREAD_KEY_MAX_LENGTH = 128;
const THREAD_KEY_FOLD_PREFIX_LENGTH = 96;

function isThreadKeySafeCharacter(character: string) {
  return /[A-Za-z0-9_.-]/.test(character);
}

function hashToken(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Encode a composed key into the accepted grammar. `:` is the escape marker
 * (`::` is a literal colon, `:<hex>:` is any other character), so two different
 * contexts can never encode to the same key.
 */
function encodeThreadKey(composed: string) {
  let encoded = "";
  for (const character of composed) {
    if (isThreadKeySafeCharacter(character)) {
      encoded += character;
    } else if (character === ":") {
      encoded += "::";
    } else {
      encoded += `:${(character.codePointAt(0) ?? 0).toString(16)}:`;
    }
  }
  if (!/^[A-Za-z0-9]/.test(encoded)) encoded = `t${encoded}`;
  if (encoded.length <= THREAD_KEY_MAX_LENGTH) return encoded;
  return `${encoded.slice(0, THREAD_KEY_FOLD_PREFIX_LENGTH)}.${hashToken(composed)}.${composed.length}`;
}

/**
 * The thread key for one authorized context, per the profile's key policy.
 * `threadToken` starts a separate conversation on the same context ("New
 * thread") without changing which context the thread belongs to.
 */
export function composeAthenaThreadKey(
  presentation: AthenaAgentPresentation,
  context: AthenaAgentContext,
  threadToken?: string,
): string {
  const composed = presentation.threadKeyPolicy.compose(context);
  return encodeThreadKey(threadToken ? `${composed}#${threadToken}` : composed);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type AthenaAgentContextEntry = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

export type AthenaAgentContextView = {
  readonly label: string;
  readonly entries: readonly AthenaAgentContextEntry[];
  readonly changedKeys: readonly string[];
  readonly changedSnapshotKeys: readonly string[];
};

/** `storeRef` reads as "Store", `operatingDate` as "Operating date". */
function labelForContextKey(key: string) {
  const withoutRef = key.replace(/Ref$/, "");
  const spaced = withoutRef.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A reference shows its readable companion (`storeRef` → `storeName`) when present. */
function displayValueForContextKey(context: AthenaAgentContext, key: string) {
  const companion = key.endsWith("Ref")
    ? context[`${key.slice(0, -3)}Name`]
    : undefined;
  return companion ?? context[key] ?? "";
}

export function describeAthenaContext(
  presentation: AthenaAgentPresentation,
  context: AthenaAgentContext,
  acknowledged?: AthenaAgentContext,
): AthenaAgentContextView {
  const keys = presentation.contextBinding.keys;
  const snapshotKeys = presentation.contextBinding.snapshotKeys ?? [];
  const entries = keys
    .map((key) => ({
      key,
      label: labelForContextKey(key),
      value: displayValueForContextKey(context, key),
    }))
    .filter((entry) => entry.value.length > 0);
  const changedKeys = acknowledged
    ? keys.filter((key) => (context[key] ?? "") !== (acknowledged[key] ?? ""))
    : [];
  return {
    label: presentation.contextLabel(context),
    entries,
    changedKeys,
    changedSnapshotKeys: changedKeys.filter((key) => snapshotKeys.includes(key)),
  };
}

const CONTEXT_VALUE_MAX_BYTES = 256;
const CONTEXT_MAX_KEYS = 8;

function truncateToBytes(value: string, maxBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  let truncated = value;
  while (truncated.length > 0 && encoder.encode(truncated).length > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

/**
 * The context snapshotted into a turn: the profile's bound keys plus their
 * readable companions, and nothing else the browser happens to be holding.
 */
export function snapshotAthenaContext(
  presentation: AthenaAgentPresentation,
  context: AthenaAgentContext,
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const key of presentation.contextBinding.keys) {
    for (const candidate of [
      key,
      key.endsWith("Ref") ? `${key.slice(0, -3)}Name` : undefined,
    ]) {
      if (!candidate) continue;
      const value = context[candidate];
      if (value === undefined || value.length === 0) continue;
      if (Object.keys(snapshot).length >= CONTEXT_MAX_KEYS) continue;
      snapshot[candidate] = truncateToBytes(value, CONTEXT_VALUE_MAX_BYTES);
    }
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Source destinations
// ---------------------------------------------------------------------------

export type AthenaAgentSourceLink = {
  readonly label: string;
  readonly to: string;
  readonly params: Record<string, string>;
  readonly href: string;
};

export type AthenaAgentSourceInput = {
  readonly ref: string;
  readonly kind?: string;
  readonly label?: string;
};

/**
 * Resolve a server-minted citation to the in-app route that owns the record.
 * Anything the profile does not own, and any route whose parameters are not all
 * known, resolves to nothing rather than to a guessed destination.
 *
 * The host only ever holds the serialized form of a source ref, so the ref is
 * validated back into `OpaqueRef<"source">` here; a citation that did not come
 * from the server's minting path resolves to nothing.
 */
export function resolveAthenaSourceLink(
  presentation: AthenaAgentPresentation,
  source: AthenaAgentSourceInput,
  params: Record<string, string | undefined>,
): AthenaAgentSourceLink | null {
  if (!source.kind) return null;
  if (!isOpaqueRef(source.ref, "source")) return null;
  const destination: AgentSourceDestination | null =
    presentation.resolveSourceDestination({
      ref: source.ref,
      kind: source.kind,
      label: source.label,
      capturedAt: 0,
    });
  if (!destination || destination.kind !== "internal_route") return null;

  const required = Array.from(
    destination.route.matchAll(/\$([A-Za-z0-9_]+)/g),
    (match) => match[1] as string,
  );
  const resolved: Record<string, string> = {};
  for (const name of required) {
    const value = params[name];
    if (value === undefined || value.length === 0) return null;
    resolved[name] = value;
  }
  const href = required.reduce(
    (route, name) => route.replace(`$${name}`, resolved[name] as string),
    destination.route,
  );
  return { label: destination.label, to: destination.route, params: resolved, href };
}

// ---------------------------------------------------------------------------
// Operator copy
// ---------------------------------------------------------------------------

export type AthenaAgentDenial = {
  readonly code: string;
  readonly headline: string;
  readonly detail?: string;
};

const DENIAL_COPY: Record<string, { headline: string; detail?: string }> = {
  prompt_empty: { headline: "Type a question to ask." },
  prompt_too_large: {
    headline: "That question is too long.",
    detail: "Shorten it and ask again.",
  },
  prompt_too_many_tokens: {
    headline: "That question is too long.",
    detail: "Shorten it and ask again.",
  },
  prompt_invalid_unicode: {
    headline: "Athena can't read some characters in that question.",
    detail: "Retype it and ask again.",
  },
  prompt_disallowed_control: {
    headline: "Athena can't read some characters in that question.",
    detail: "Retype it and ask again.",
  },
  prompt_disallowed_bidi: {
    headline: "Athena can't read some characters in that question.",
    detail: "Retype it and ask again.",
  },
  prompt_not_text: { headline: "Type a question to ask." },
  profile_unavailable: {
    headline: "Ask Athena isn't available for this store yet.",
  },
  operator_unauthorized: {
    headline: "You don't have access to Ask Athena for this store.",
  },
  store_unavailable: { headline: "This store isn't available." },
  thread_key_invalid: {
    headline: "This conversation can't be continued.",
    detail: "Start a new thread and ask again.",
  },
  context_invalid: {
    headline: "Athena couldn't read the store and day for this question.",
    detail: "Reload the page and ask again.",
  },
  no_granted_capabilities: {
    headline: "There's nothing Athena can read for you in this store.",
  },
  no_compatible_provider: {
    headline: "Athena can't answer this safely right now.",
  },
  active_run_limit: {
    headline: "Athena is still working on an earlier question.",
    detail: "Wait for it to finish, or cancel it.",
  },
  thread_busy: {
    headline: "Athena is still answering in this conversation.",
    detail: "Wait for it to finish, or cancel it.",
  },
  turn_key_conflict: {
    headline: "Athena couldn't start this question.",
    detail: "Ask it again.",
  },
  spend_ceiling: {
    headline: "Athena has reached today's limit for this store.",
    detail: "Try again later.",
  },
};

/**
 * Operator copy for a denied submission. The backend's own message is never
 * shown: this table is the only source of denial copy, and an unrecognized code
 * collapses to the calm default.
 */
export function describeAthenaDenial(code: string): AthenaAgentDenial {
  const copy = DENIAL_COPY[code];
  if (!copy) {
    return {
      code,
      headline: "Athena can't take that question right now.",
    };
  }
  return {
    code,
    headline: copy.headline,
    ...(copy.detail ? { detail: copy.detail } : {}),
  };
}

export type AthenaAgentUnavailableState =
  | "authority_lost"
  | "profile_unavailable"
  | "missing"
  | "pending"
  | "unknown";

export type AthenaAgentUnavailable = {
  readonly reason: string;
  readonly state: AthenaAgentUnavailableState;
  readonly headline: string;
  readonly detail?: string;
};

const AUTHORITY_LOST_REASONS = new Set([
  "suppressed",
  "membership_revoked",
  "operator_unauthorized",
  "operator_unknown",
  "principal_missing",
  "session_expired",
  "store_missing",
  "store_out_of_scope",
  "demo_disabled",
  "capability_disabled",
  "authority_shrunk",
  "grant_deleted",
  "authority_revoked",
  "egress_beyond_authority",
  "authority_port_missing",
]);

const PROFILE_UNAVAILABLE_REASONS = new Set([
  "profile_disabled",
  "profile_unpublished",
  "profile_unknown",
  "compatibility_epoch_fenced",
  "registry_digest_mismatch",
]);

const CONTENT_GONE_REASONS = new Set([
  "deleted_by_lifecycle",
  "answer_unreadable",
  "release_not_committed",
]);

/**
 * Why a turn, answer, or source cannot be shown. `subject` names what the
 * operator was looking at so the same reason reads correctly in each surface.
 */
export function describeAthenaUnavailable(
  reason: string,
  subject: "answer" | "conversation" | "source" = "answer",
): AthenaAgentUnavailable {
  if (AUTHORITY_LOST_REASONS.has(reason)) {
    return {
      reason,
      state: "authority_lost",
      headline: `This ${subject} is no longer available to you.`,
    };
  }
  if (PROFILE_UNAVAILABLE_REASONS.has(reason)) {
    return {
      reason,
      state: "profile_unavailable",
      headline: "Ask Athena isn't available for this store right now.",
    };
  }
  if (reason === "not_found" || reason === "not_your_turn") {
    return {
      reason,
      state: "missing",
      headline: `Athena can't find this ${subject === "answer" ? "conversation" : subject}.`,
    };
  }
  if (CONTENT_GONE_REASONS.has(reason)) {
    return {
      reason,
      state: "missing",
      headline: "This content is no longer stored.",
      detail: "Ask the question again to get a fresh answer.",
    };
  }
  if (reason === "not_ready") {
    return { reason, state: "pending", headline: "The answer isn't ready yet." };
  }
  return {
    reason,
    state: "unknown",
    headline: `Athena can't show this ${subject} right now.`,
  };
}

export type AthenaAgentFailure = {
  readonly code: string;
  readonly headline: string;
  readonly detail?: string;
};

const FAILURE_COPY: Record<string, { headline: string; detail?: string }> = {
  canceled: { headline: "Stopped." },
  completion_missing: {
    headline: "Athena didn't reach an answer.",
    detail: "Ask again.",
  },
  provider_failure: {
    headline: "The answer service didn't respond.",
    detail: "Ask again in a moment.",
  },
  runtime_adapter_error: {
    headline: "The answer service didn't respond.",
    detail: "Ask again in a moment.",
  },
  model_unresolvable: {
    headline: "The answer service didn't respond.",
    detail: "Ask again in a moment.",
  },
  turn_elapsed_ceiling: {
    headline: "That took too long.",
    detail: "Ask a narrower question.",
  },
  compatibility_epoch_fenced: {
    headline: "Athena was updated while this was running.",
    detail: "Ask again.",
  },
  turn_binding_stalled: {
    headline: "This request didn't start in time.",
    detail: "Ask again.",
  },
  turn_host_stalled: {
    headline: "This request stopped unexpectedly.",
    detail: "Ask again.",
  },
  prompt_unavailable: {
    headline: "The question is no longer stored.",
    detail: "Ask it again to get a fresh answer.",
  },
  no_compatible_provider: {
    headline: "Athena can't answer this safely right now.",
  },
  spend_ceiling: {
    headline: "Athena reached its limit for this question.",
  },
  authority_revoked: { headline: "This answer is no longer available to you." },
  membership_revoked: { headline: "This answer is no longer available to you." },
  store_out_of_scope: { headline: "This answer is no longer available to you." },
  profile_disabled: {
    headline: "Ask Athena isn't available for this store right now.",
  },
};

/** Operator copy for a terminal run failure. Diagnostics stay in evidence. */
export function describeAthenaFailure(code: string): AthenaAgentFailure {
  const copy = FAILURE_COPY[code];
  if (!copy) {
    return {
      code,
      headline: "Athena couldn't finish this question.",
    };
  }
  return {
    code,
    headline: copy.headline,
    ...(copy.detail ? { detail: copy.detail } : {}),
  };
}

const MILESTONE_COPY: Record<AgentProgressMilestone, string> = {
  reconnecting: "Reconnecting",
  checking_sources: "Checking the requested sources",
  reading_sources: "Reading sources",
  composing_answer: "Composing the answer",
  finalizing: "Finishing up",
};

/**
 * Progress copy for a server-authored milestone. Anything else — including any
 * model-authored text that ever reached this field — has no copy and is not
 * shown.
 */
export function describeAthenaMilestone(milestone: string): string | null {
  const known = (AGENT_PROGRESS_MILESTONES as readonly string[]).includes(milestone);
  return known ? MILESTONE_COPY[milestone as AgentProgressMilestone] : null;
}

export type AthenaAgentPresentationInput = AgentPresentationAdapterInput;
