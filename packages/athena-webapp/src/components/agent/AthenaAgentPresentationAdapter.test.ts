import { describe, expect, it } from "vitest";

import {
  ATHENA_AGENT_PROVISIONAL_WITHDRAWAL_REASONS,
  ATHENA_AGENT_THREAD_KEY_PATTERN,
  composeAthenaThreadKey,
  describeAthenaContext,
  describeAthenaDenial,
  describeAthenaFailure,
  describeAthenaMilestone,
  describeAthenaProvisionalCue,
  describeAthenaProvisionalEntry,
  describeAthenaProvisionalTimeline,
  describeAthenaProvisionalNotice,
  describeAthenaShortenedNotice,
  describeAthenaUnavailable,
  describeProvisionalWithdrawal,
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

  it("has no destination for a ref that did not come from the server's minting path", () => {
    expect(
      resolveAthenaSourceLink(
        storePresentation,
        { ref: "not-an-opaque-ref", kind: "close_record" },
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
      "turn_key_conflict",
      "spend_ceiling",
    ];

    for (const code of codes) {
      const denial = describeAthenaDenial(code);

      expect(denial.headline.length).toBeGreaterThan(0);
      expect(denial.headline).not.toMatch(/_/);
      expect(denial.headline).not.toMatch(/[Ee]rror|[Ff]ailed|invalid|null/);
    }

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
    // A turn the sweeper closed because its host died is retryable: the copy
    // must say so rather than falling through to the generic headline.
    expect(describeAthenaFailure("turn_host_stalled")).toMatchObject({
      headline: "This request stopped unexpectedly.",
      detail: "Ask again.",
    });
    expect(describeAthenaFailure("authority_revoked").headline).toBe(
      "This answer is no longer available to you.",
    );
    expect(describeAthenaFailure("some_internal_code").headline).toBe(
      "Athena couldn't finish this question.",
    );
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

describe("provisional draft copy", () => {
  it("says the draft is unverified, must not be acted on, and will be replaced", () => {
    const notice = describeAthenaProvisionalNotice();

    expect(notice.headline).toBe("Draft in progress. Not verified.");
    expect(notice.detail).toContain("thinking out loud");
    expect(notice.detail).toMatch(/don't act on/i);
    expect(notice.detail).toMatch(/replaces it/i);
    expect(notice.detail).toMatch(/may differ/i);
  });

  it("gives the reset, limit, and pause cues their own polite lines", () => {
    expect(describeAthenaProvisionalCue("reset")).toBe(
      "Moved on to the next step. The earlier draft stays in the timeline.",
    );
    expect(describeAthenaProvisionalCue("paused_at_limit")).toBe(
      "Draft display limit reached. The rest of the draft isn't shown here.",
    );
    // A stalled draft can be the operator's last signal, so the line names the
    // controls the panel keeps enabled.
    expect(describeAthenaProvisionalCue("stalled")).toBe(
      "Draft paused. You can stop this request or start a new thread.",
    );
  });

  it("shortens a runaway draft with its own notice, not the answer's", () => {
    expect(describeAthenaShortenedNotice("answer")).toBe(
      "This answer was shortened for display.",
    );
    expect(describeAthenaShortenedNotice("provisional")).toBe(
      "This draft was shortened for display.",
    );
  });

  it("covers every withdrawal reason the preview mints and says nothing about the answer", () => {
    for (const reason of ATHENA_AGENT_PROVISIONAL_WITHDRAWAL_REASONS) {
      const withdrawal = describeProvisionalWithdrawal(reason);

      expect(withdrawal.reason).toBe(reason);
      expect(withdrawal.headline).toBe("Draft withdrawn.");
      expect(withdrawal.detail?.length ?? 0).toBeGreaterThan(0);
      expect(JSON.stringify(withdrawal)).not.toMatch(/answer/i);
      expect(withdrawal.detail).not.toMatch(/_/);
    }

    expect(describeProvisionalWithdrawal("compatibility_epoch_fenced").detail).toBe(
      "Athena was updated while this draft was being written.",
    );
    expect(describeProvisionalWithdrawal("policy_disabled").detail).toBe(
      "Live drafts are turned off for this store.",
    );
    expect(describeProvisionalWithdrawal("egress_beyond_authority").detail).toBe(
      "This draft went beyond what you can read here.",
    );
    expect(describeProvisionalWithdrawal("run_canceled").detail).toBe(
      "This request was stopped.",
    );
  });

  it("falls back through the authority classes and then to a bare default", () => {
    // `TurnAccess.reason` is an open string: an authority refusal that the
    // preview passes through still gets calm, draft-only copy.
    expect(describeProvisionalWithdrawal("membership_revoked").detail).toBe(
      "This draft is no longer available to you.",
    );
    expect(describeProvisionalWithdrawal("profile_disabled").detail).toBe(
      "Ask Athena isn't available for this store right now.",
    );

    const unknown = describeProvisionalWithdrawal("some_new_backend_reason");
    expect(unknown.headline).toBe("Draft withdrawn.");
    expect(unknown.detail).toBeUndefined();
    expect(JSON.stringify(unknown)).not.toContain("some_new_backend_reason".toUpperCase());
  });
});

describe("the provisional timeline copy", () => {
  it("labels finished drafts by position and the collapsed timeline as unverified", () => {
    expect(describeAthenaProvisionalEntry(0)).toBe("Earlier draft 1");
    expect(describeAthenaProvisionalEntry(2)).toBe("Earlier draft 3");
    expect(describeAthenaProvisionalTimeline()).toEqual({
      summary: "How Athena got here",
      detail: "Athena's drafts along the way. Not verified — the answer above is the only checked text.",
    });
  });
});
