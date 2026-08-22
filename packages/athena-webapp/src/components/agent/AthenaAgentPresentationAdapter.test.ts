import { describe, expect, it } from "vitest";

import {
  ATHENA_AGENT_THREAD_KEY_PATTERN,
  composeAthenaThreadKey,
  describeAthenaContext,
  describeAthenaDenial,
  describeAthenaFailure,
  describeAthenaMilestone,
  describeAthenaUnavailable,
  resolveAthenaSourceLink,
  snapshotAthenaContext,
  defineAthenaAgentPresentation,
} from "./AthenaAgentPresentationAdapter";

const storePresentation = defineAthenaAgentPresentation({
  contractVersion: 1,
  profileId: "daily_operations",
  contextBinding: {
    scopeKind: "store",
    keys: ["storeRef", "operatingDate"],
    snapshotKeys: ["operatingDate"],
  },
  contextLabel: (context) =>
    `${context.storeName ?? context.storeRef ?? "This store"} · ${context.operatingDate ?? ""}`.trim(),
  entry: { label: "Ask Athena", location: "operations.dailyOperations.header" },
  mountMode: "docked_panel",
  starterIntents: [
    {
      id: "close_readiness",
      label: "What is holding up the close?",
      prompt: "What is blocking the end-of-day close?",
      requiresPackages: ["operations"],
    },
  ],
  resolveSourceDestination: (sourceRef) =>
    sourceRef.kind === "close_record"
      ? {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
          label: "EOD review",
        }
      : null,
  threadKeyPolicy: {
    parts: ["profileId", "storeRef"],
    onContextChange: "confirm_before_next_turn",
    activeTurnPolicy: "block_second_submission",
  },
});

const storeContext = {
  storeRef: "k1739ph0dqk9y1v3n3r6yv4bcs7bqvzy",
  storeName: "Osu",
  operatingDate: "2026-08-21",
};

describe("Athena agent thread keys", () => {
  it("encodes the composed thread key into the shape the turn contract accepts", () => {
    const threadKey = composeAthenaThreadKey(storePresentation, storeContext);

    // The presentation composes `daily_operations|storeRef=<id>`, which the
    // backend's thread-key grammar rejects; the host must encode it.
    expect(
      storePresentation.threadKeyPolicy.compose(storeContext),
    ).not.toMatch(ATHENA_AGENT_THREAD_KEY_PATTERN);
    expect(threadKey).toMatch(ATHENA_AGENT_THREAD_KEY_PATTERN);
    expect(threadKey).toContain("daily_operations");
  });

  it("keys one thread per store and detaches when the store changes", () => {
    const first = composeAthenaThreadKey(storePresentation, storeContext);
    const same = composeAthenaThreadKey(storePresentation, {
      ...storeContext,
      operatingDate: "2026-08-22",
      storeName: "Osu Renamed",
    });
    const otherStore = composeAthenaThreadKey(storePresentation, {
      ...storeContext,
      storeRef: "k17999999999999999999999999999zz",
    });

    expect(same).toBe(first);
    expect(otherStore).not.toBe(first);
  });

  it("folds an over-long key instead of emitting one the contract rejects", () => {
    const longPresentation = defineAthenaAgentPresentation({
      ...storePresentation,
      profileId: "p".repeat(140),
      threadKeyPolicy: storePresentation.threadKeyPolicy,
    });

    const threadKey = composeAthenaThreadKey(longPresentation, storeContext);

    expect(threadKey).toMatch(ATHENA_AGENT_THREAD_KEY_PATTERN);
    expect(threadKey.length).toBeLessThanOrEqual(128);
  });
});

describe("Athena agent context", () => {
  it("labels bound context keys in operator language and prefers a name over a reference", () => {
    const context = describeAthenaContext(storePresentation, storeContext);

    expect(context.label).toBe("Osu · 2026-08-21");
    expect(context.entries).toEqual([
      { key: "storeRef", label: "Store", value: "Osu" },
      { key: "operatingDate", label: "Operating date", value: "2026-08-21" },
    ]);
  });

  it("sends only bound context keys with a turn", () => {
    const snapshot = snapshotAthenaContext(storePresentation, {
      ...storeContext,
      secretDraft: "never leaves the browser",
    });

    expect(snapshot).toEqual({
      storeRef: storeContext.storeRef,
      storeName: "Osu",
      operatingDate: "2026-08-21",
    });
  });

  it("reports which snapshot keys changed since the last acknowledged context", () => {
    const changed = describeAthenaContext(storePresentation, {
      ...storeContext,
      operatingDate: "2026-08-22",
    }, storeContext);

    expect(changed.changedSnapshotKeys).toEqual(["operatingDate"]);
    expect(
      describeAthenaContext(storePresentation, storeContext, storeContext)
        .changedSnapshotKeys,
    ).toEqual([]);
  });
});

describe("Athena agent source destinations", () => {
  it("resolves a server-minted citation to an internal route with the route params filled in", () => {
    const link = resolveAthenaSourceLink(
      storePresentation,
      { ref: "source:abc", kind: "close_record", label: "Close record" },
      { orgUrlSlug: "wigclub", storeUrlSlug: "osu" },
    );

    expect(link).toEqual({
      label: "EOD review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      params: { orgUrlSlug: "wigclub", storeUrlSlug: "osu" },
      href: "/wigclub/store/osu/operations/daily-close",
    });
  });

  it("has no destination for a source kind the profile does not own", () => {
    expect(
      resolveAthenaSourceLink(
        storePresentation,
        { ref: "source:abc", kind: "unknown_kind" },
        { orgUrlSlug: "wigclub", storeUrlSlug: "osu" },
      ),
    ).toBeNull();
  });

  it("refuses to build a link with an unfilled route parameter", () => {
    expect(
      resolveAthenaSourceLink(
        storePresentation,
        { ref: "source:abc", kind: "close_record" },
        { orgUrlSlug: "wigclub" },
      ),
    ).toBeNull();
  });
});

describe("Athena agent operator copy", () => {
  it("normalizes every start-turn denial into calm operator language", () => {
    const codes = [
      "prompt_empty",
      "prompt_too_large",
      "prompt_too_many_tokens",
      "prompt_invalid_unicode",
      "prompt_disallowed_control",
      "prompt_disallowed_bidi",
      "prompt_not_text",
      "profile_unavailable",
      "operator_unauthorized",
      "store_unavailable",
      "thread_key_invalid",
      "context_invalid",
      "no_granted_capabilities",
      "no_compatible_provider",
      "active_run_limit",
      "thread_busy",
      "spend_ceiling",
    ];

    for (const code of codes) {
      const denial = describeAthenaDenial(code);

      expect(denial.headline.length).toBeGreaterThan(0);
      expect(denial.headline).not.toMatch(/_/);
      expect(denial.headline).not.toMatch(/[Ee]rror|[Ff]ailed|invalid|null/);
    }

    expect(describeAthenaDenial("thread_busy").retryable).toBe(true);
    expect(describeAthenaDenial("active_run_limit").retryable).toBe(true);
    expect(describeAthenaDenial("prompt_empty").retryable).toBe(false);
  });

  it("never repeats raw backend wording for an unrecognized denial", () => {
    const denial = describeAthenaDenial("some_new_backend_code");

    expect(denial.headline).toBe("Athena can't take that question right now.");
    expect(JSON.stringify(denial)).not.toContain("agentTurnBinding");
  });

  it("gives revocation, expiry, and suppression their own operator states", () => {
    expect(describeAthenaUnavailable("membership_revoked").state).toBe(
      "authority_lost",
    );
    expect(describeAthenaUnavailable("profile_disabled").state).toBe(
      "profile_unavailable",
    );
    expect(describeAthenaUnavailable("profile_unpublished").state).toBe(
      "profile_unavailable",
    );
    expect(describeAthenaUnavailable("suppressed").headline).toBe(
      "This answer is no longer available to you.",
    );
    expect(describeAthenaUnavailable("egress_beyond_authority").state).toBe(
      "authority_lost",
    );
    expect(describeAthenaUnavailable("not_found").state).toBe("missing");
    expect(describeAthenaUnavailable("not_your_turn").state).toBe("missing");
    expect(describeAthenaUnavailable("not_ready").state).toBe("pending");
  });

  it("keeps run failures reason-specific and free of raw diagnostics", () => {
    expect(describeAthenaFailure("turn_elapsed_ceiling").headline).toBe(
      "That took too long.",
    );
    expect(describeAthenaFailure("canceled").headline).toBe("Stopped.");
    expect(describeAthenaFailure("authority_revoked").headline).toBe(
      "This answer is no longer available to you.",
    );
    expect(describeAthenaFailure("some_internal_code").headline).toBe(
      "Athena couldn't finish this question.",
    );
    expect(describeAthenaFailure("provider_failure").retryable).toBe(true);
  });

  it("describes only server-authored milestones", () => {
    expect(describeAthenaMilestone("checking_sources")).toBe(
      "Checking the requested sources",
    );
    expect(describeAthenaMilestone("reading_sources")).toBe("Reading sources");
    expect(describeAthenaMilestone("composing_answer")).toBe(
      "Composing the answer",
    );
    expect(describeAthenaMilestone("finalizing")).toBe("Finishing up");
    expect(describeAthenaMilestone("model said hello")).toBeNull();
  });
});
