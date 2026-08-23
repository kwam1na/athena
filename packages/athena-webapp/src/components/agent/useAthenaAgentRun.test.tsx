import { act, renderHook, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

import { defineAthenaAgentPresentation } from "./AthenaAgentPresentationAdapter";
import {
  deriveAthenaProvisionalState,
  useAthenaAgentRun,
  type AthenaAgentProvisionalInput,
  type AthenaAgentRun,
} from "./useAthenaAgentRun";

vi.mock("~/convex/_generated/api", () => ({
  api: {
    agentHarness: {
      turns: {
        startTurn: "startTurn",
        cancelTurn: "cancelTurn",
        resumeTurn: "resumeTurn",
        acknowledgeTurnAnswer: "acknowledgeTurnAnswer",
        inspectCitationEvidence: "inspectCitationEvidence",
        acknowledgeProvisionalView: "acknowledgeProvisionalView",
        getTurnView: "getTurnView",
        getTurnAnswer: "getTurnAnswer",
        getThreadHistory: "getThreadHistory",
        previewTurnNarrative: "previewTurnNarrative",
      },
    },
  },
}));

const presentation = defineAthenaAgentPresentation({
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

const STORE_ID = "store-1" as Id<"store">;
const BINDING_ID = "binding-1" as Id<"agentTurnBinding">;

type QueryArgs = Record<string, unknown> | "skip";

type Backend = {
  history: unknown;
  view: unknown;
  answer: unknown;
  preview: unknown;
  calls: { name: string; args: unknown }[];
  results: Record<string, unknown>;
};

let backend: Backend;

function baseView(overrides: Record<string, unknown> = {}) {
  return {
    kind: "view",
    bindingId: BINDING_ID,
    runId: "run-1",
    profileId: "daily_operations",
    threadKey: "daily_operations:7c:storeRef:3d:store-1",
    createdAt: 1,
    updatedAt: 2,
    phase: "running",
    step: "running",
    milestones: [{ milestone: "checking_sources", at: 3 }],
    question: "What is blocking the close?",
    context: { storeRef: "store-1", storeName: "Osu", operatingDate: "2026-08-21" },
    promptState: "retained",
    answer: { available: false, suppressed: false },
    canCancel: true,
    ...overrides,
  };
}

function mountRun(
  options: Partial<Parameters<typeof useAthenaAgentRun>[0]> = {},
) {
  return renderHook((props: Record<string, unknown> = {}) =>
    useAthenaAgentRun({
      presentation,
      storeId: STORE_ID,
      context: {
        storeRef: "store-1",
        storeName: "Osu",
        operatingDate: "2026-08-21",
      },
      routeParams: { orgUrlSlug: "wigclub", storeUrlSlug: "osu" },
      isActive: true,
      createTurnKey: () => "turnkey1",
      ...options,
      ...props,
    }),
  );
}

beforeEach(() => {
  backend = {
    history: { kind: "history", threadKey: "t", reauthorizedAt: 1, entries: [] },
    view: undefined,
    answer: undefined,
    preview: undefined,
    calls: [],
    results: {},
  };

  vi.mocked(useQuery).mockImplementation(((name: string, args: QueryArgs) => {
    if (args === "skip") return undefined;
    backend.calls.push({ name: `query:${name}`, args });
    if (name === "getThreadHistory") return backend.history;
    if (name === "getTurnView") return backend.view;
    if (name === "getTurnAnswer") return backend.answer;
    if (name === "previewTurnNarrative") return backend.preview;
    return undefined;
  }) as unknown as typeof useQuery);

  vi.mocked(useMutation).mockImplementation(((name: string) =>
    vi.fn(async (args: unknown) => {
      backend.calls.push({ name, args });
      const result = backend.results[name];
      if (typeof result === "function") {
        return (result as (input: unknown) => unknown)(args);
      }
      return result ?? { outcome: "unavailable", reason: "not_found" };
    })) as unknown as typeof useMutation);
});

function callsNamed(name: string) {
  return backend.calls.filter((call) => call.name === name);
}

describe("first use", () => {
  it("shows the authorized context and profile starters before any question", () => {
    const { result } = mountRun();

    expect(result.current.hostState).toBe("idle");
    expect(result.current.context.label).toBe("Osu · 2026-08-21");
    expect(result.current.starterIntents.map((intent) => intent.id)).toEqual([
      "close_readiness",
    ]);
    expect(result.current.availability.available).toBe(true);
    expect(result.current.canSubmit).toBe(true);
  });

  it("reads thread history with the encoded thread key for this store", () => {
    const { result } = mountRun();
    const historyCall = callsNamed("query:getThreadHistory")[0];

    expect(historyCall?.args).toMatchObject({
      storeId: STORE_ID,
      profileId: "daily_operations",
      threadKey: result.current.threadKey,
    });
    expect(result.current.threadKey).toMatch(
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/,
    );
  });

  it("closes the surface calmly when the profile is not available here", () => {
    backend.history = { kind: "unavailable", reason: "profile_unpublished" };
    const { result } = mountRun();

    expect(result.current.availability.available).toBe(false);
    expect(result.current.availability.headline).toBe(
      "Ask Athena isn't available for this store right now.",
    );
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.hostState).toBe("terminal_denied");
  });
});

describe("submitting one turn", () => {
  it("sends the prompt with the snapshotted context and blocks a duplicate submit", async () => {
    backend.results.startTurn = {
      outcome: "started",
      bindingId: BINDING_ID,
      runId: "run-1",
      threadKey: "thread",
    };
    const { result } = mountRun();

    await act(async () => {
      await result.current.submit("What is blocking the close?");
    });

    const start = callsNamed("startTurn");
    expect(start).toHaveLength(1);
    expect(start[0]?.args).toMatchObject({
      storeId: STORE_ID,
      profileId: "daily_operations",
      threadKey: result.current.threadKey,
      turnIdempotencyKey: "turnkey1",
      prompt: "What is blocking the close?",
      context: {
        storeRef: "store-1",
        storeName: "Osu",
        operatingDate: "2026-08-21",
      },
    });
    expect(result.current.activeTurnId).toBe(BINDING_ID);
    expect(result.current.canSubmit).toBe(false);

    await act(async () => {
      await result.current.submit("Second question");
    });

    expect(callsNamed("startTurn")).toHaveLength(1);
    expect(result.current.blockedSubmission?.reason).toBe("turn_active");
  });

  it("reports queued work without claiming model progress", async () => {
    backend.results.startTurn = {
      outcome: "started",
      bindingId: BINDING_ID,
      runId: "run-1",
      threadKey: "thread",
    };
    const { result } = mountRun();

    await act(async () => {
      await result.current.submit("Anything");
    });

    expect(result.current.hostState).toBe("submitting");
    expect(result.current.status.headline).toBe("Starting your request…");
    expect(result.current.canCancel).toBe(true);
  });

  it("keeps the draft and explains a denial in operator language", async () => {
    backend.results.startTurn = {
      outcome: "denied",
      code: "prompt_too_large",
      message: "prompt exceeded maxPromptBytes on agentTurnBinding",
      retryable: false,
    };
    const { result } = mountRun();

    await act(async () => {
      await result.current.submit("A very long question");
    });

    expect(result.current.denial?.headline).toBe("That question is too long.");
    expect(JSON.stringify(result.current.denial)).not.toContain(
      "agentTurnBinding",
    );
    expect(result.current.activeTurnId).toBeNull();
    expect(result.current.hostState).toBe("idle");
    expect(result.current.canSubmit).toBe(true);
  });

  it("collapses an unexpected failure to the calm default without starting a turn", async () => {
    backend.results.startTurn = () => {
      throw new Error("network down: convex 502 agentTurnBinding");
    };
    const { result } = mountRun();

    await act(async () => {
      await result.current.submit("Anything");
    });

    expect(result.current.denial?.headline).toBe(
      "Athena can't take that question right now.",
    );
    expect(result.current.activeTurnId).toBeNull();
  });
});

describe("running, cancelling, and completing", () => {
  it("shows only server-authored milestones and never model text", async () => {
    backend.view = baseView({
      milestones: [
        { milestone: "checking_sources", at: 3 },
        { milestone: "Here is what I found so far", at: 4 },
        { milestone: "reading_sources", at: 5 },
      ],
    });
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("running"));
    expect(result.current.milestones.map((entry) => entry.label)).toEqual([
      "Checking the requested sources",
      "Reading sources",
    ]);
    expect(result.current.answer).toBeNull();
    expect(result.current.canInspectSources).toBe(false);
  });

  it("treats cancellation as a nonterminal state until the run confirms", async () => {
    backend.view = baseView();
    backend.results.cancelTurn = { outcome: "canceled" };
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("running"));
    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.hostState).toBe("cancellation_requested");
    expect(result.current.status.headline).toBe("Stopping…");
    expect(result.current.canSubmit).toBe(false);

    backend.view = baseView({ phase: "canceled", canCancel: false });
    rerender();

    await waitFor(() =>
      expect(result.current.status.headline).toBe("Stopped."),
    );
    expect(result.current.canSubmit).toBe(true);
  });

  it("releases the answer, then records the receipt separately", async () => {
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      answer: { available: true, outcome: "answer", suppressed: false },
    });
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "Two lanes are open.",
      egressClass: "sensitive",
      committedAt: 9,
      citations: [{ citationRef: "citation:1", label: "Close record" }],
    };
    backend.results.acknowledgeTurnAnswer = {
      kind: "acknowledged",
      operatorViewedAt: 11,
      answer: backend.answer,
    };
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("completed"));
    expect(result.current.answer?.narrative).toBe("Two lanes are open.");
    expect(result.current.canInspectSources).toBe(true);

    await waitFor(() =>
      expect(callsNamed("acknowledgeTurnAnswer")).toHaveLength(1),
    );
    expect(result.current.answer?.viewedAt).toBe(11);
  });

  it("separates a partial answer from one with no usable sources", async () => {
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      answer: { available: true, outcome: "answer", suppressed: false },
    });
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "Partial.",
      egressClass: "operational",
      limitedEvidence: true,
      committedAt: 9,
      citations: [],
    };
    backend.results.acknowledgeTurnAnswer = {
      kind: "acknowledged",
      operatorViewedAt: 11,
      answer: backend.answer,
    };
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("partial"));

    backend.answer = {
      kind: "answer",
      outcome: "no_usable_sources",
      narrative: "Nothing could be read.",
      egressClass: "operational",
      committedAt: 9,
      citations: [],
    };
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      answer: { available: true, outcome: "no_usable_sources", suppressed: false },
    });
    rerender();

    await waitFor(() =>
      expect(result.current.hostState).toBe("no_usable_sources"),
    );
  });

  it("gives a hard failure its own calm terminal state", async () => {
    backend.view = baseView({
      phase: "failed",
      canCancel: false,
      error: {
        code: "turn_elapsed_ceiling",
        retryable: false,
        headline: "raw backend headline",
      },
    });
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() =>
      expect(result.current.hostState).toBe("terminal_denied"),
    );
    expect(result.current.status.headline).toBe("That took too long.");
    expect(result.current.status.detail).toBe("Ask a narrower question.");
  });
});

describe("revocation", () => {
  it("removes a released answer when authority is lost after it was viewed", async () => {
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      answer: {
        available: true,
        outcome: "answer",
        suppressed: false,
        viewedAt: 12,
      },
    });
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "Sensitive totals.",
      egressClass: "sensitive",
      committedAt: 9,
      viewedAt: 12,
      citations: [],
    };
    backend.results.acknowledgeTurnAnswer = {
      kind: "acknowledged",
      operatorViewedAt: 12,
      answer: backend.answer,
    };
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() =>
      expect(result.current.answer?.narrative).toBe("Sensitive totals."),
    );

    backend.view = { kind: "unavailable", reason: "membership_revoked" };
    backend.answer = { kind: "unavailable", reason: "membership_revoked" };
    rerender();

    await waitFor(() => expect(result.current.answer).toBeNull());
    expect(result.current.status.headline).toBe(
      "This answer is no longer available to you.",
    );
    expect(result.current.hostState).toBe("terminal_denied");
  });

  it("suppresses the answer when release is revoked before the receipt", async () => {
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      answer: { available: true, outcome: "answer", suppressed: false },
    });
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "Committed but revoked.",
      egressClass: "sensitive",
      committedAt: 9,
      citations: [],
    };
    backend.results.acknowledgeTurnAnswer = {
      kind: "suppressed",
      reason: "membership_revoked",
    };
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() =>
      expect(callsNamed("acknowledgeTurnAnswer")).toHaveLength(1),
    );
    await waitFor(() => expect(result.current.answer).toBeNull());
    expect(result.current.status.headline).toBe(
      "This answer is no longer available to you.",
    );
  });
});

describe("reconnecting", () => {
  it("rejoins an active turn without starting a second one", async () => {
    backend.results.resumeTurn = {
      outcome: "continue",
      step: "running",
      runStatus: "running",
    };
    backend.view = undefined;
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    expect(result.current.hostState).toBe("reconnecting");
    expect(result.current.status.headline).toBe("Reconnecting…");

    backend.view = baseView();
    rerender();

    await waitFor(() => expect(result.current.hostState).toBe("running"));
    expect(callsNamed("startTurn")).toHaveLength(0);
    await waitFor(() => expect(callsNamed("resumeTurn")).toHaveLength(1));
  });

  it("explains an erased prompt instead of inventing the question", async () => {
    backend.view = baseView({
      phase: "failed",
      canCancel: false,
      promptState: "expired",
      question: undefined,
      error: { code: "prompt_unavailable", retryable: false, headline: "x" },
    });
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() =>
      expect(result.current.hostState).toBe("expired_content"),
    );
    expect(result.current.turn?.question).toBeUndefined();
    expect(result.current.status.headline).toBe(
      "The question is no longer stored.",
    );
  });
});

describe("thread and context policy", () => {
  it("detaches the thread when the store changes", async () => {
    backend.view = baseView();
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("running"));
    const firstThreadKey = result.current.threadKey;

    rerender({
      context: {
        storeRef: "store-2",
        storeName: "Accra Mall",
        operatingDate: "2026-08-21",
      },
    });

    await waitFor(() =>
      expect(result.current.threadKey).not.toBe(firstThreadKey),
    );
    expect(result.current.activeTurnId).toBeNull();
    expect(result.current.turn).toBeNull();
    expect(result.current.context.label).toBe("Accra Mall · 2026-08-21");
  });

  it("asks the operator to confirm a changed operating date before the next turn", async () => {
    const { result, rerender } = mountRun();

    expect(result.current.canSubmit).toBe(true);

    rerender({
      context: {
        storeRef: "store-1",
        storeName: "Osu",
        operatingDate: "2026-08-22",
      },
    });

    await waitFor(() =>
      expect(result.current.pendingContextChange?.keys).toEqual([
        "operatingDate",
      ]),
    );
    expect(result.current.canSubmit).toBe(false);

    await act(async () => {
      result.current.confirmContextChange();
    });

    expect(result.current.pendingContextChange).toBeNull();
    expect(result.current.canSubmit).toBe(true);
  });

  it("keeps a running turn labelled with its own context and disables follow-up", async () => {
    backend.view = baseView();
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("running"));

    rerender({
      context: {
        storeRef: "store-1",
        storeName: "Osu",
        operatingDate: "2026-08-22",
      },
    });

    await waitFor(() => expect(result.current.contextDrift).toBe(true));
    expect(result.current.turn?.contextLabel).toBe("Osu · 2026-08-21");
    expect(result.current.canFollowUp).toBe(false);
    expect(callsNamed("cancelTurn")).toHaveLength(0);
  });

  it("starts a new thread on the same authorized context", async () => {
    backend.view = baseView({ phase: "completed", canCancel: false });
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.turn).not.toBeNull());
    const firstThreadKey = result.current.threadKey;

    act(() => {
      result.current.startNewThread();
    });

    expect(result.current.threadKey).not.toBe(firstThreadKey);
    expect(result.current.threadKey).toMatch(
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/,
    );
    expect(result.current.turn).toBeNull();
    expect(result.current.activeTurnId).toBeNull();
  });
});

describe("citations", () => {
  it("opens a source only after the viewer is reauthorized", async () => {
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      answer: { available: true, outcome: "answer", suppressed: false },
    });
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "Answer.",
      egressClass: "operational",
      committedAt: 9,
      citations: [{ citationRef: "citation:1", label: "Close record" }],
    };
    backend.results.acknowledgeTurnAnswer = {
      kind: "acknowledged",
      operatorViewedAt: 11,
      answer: backend.answer,
    };
    backend.results.inspectCitationEvidence = {
      kind: "evidence",
      state: "replayable",
      citation: {
        citationRef: "citation:1",
        resultHash: "hash",
        sourceRef: { ref: "source:1", kind: "close_record", label: "EOD" },
        freshness: "accepted",
        completeness: "complete",
      },
    };
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.answer).not.toBeNull());

    await act(async () => {
      await result.current.inspectCitation("citation:1");
    });

    const source = result.current.sources["citation:1"];
    expect(source?.state).toBe("evidence");
    expect(source?.link?.href).toBe(
      "/wigclub/store/osu/operations/daily-close",
    );
    expect(source?.freshness).toBe("accepted");
  });

  it("downgrades the evidence state when the source is no longer authorized", async () => {
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      answer: { available: true, outcome: "answer", suppressed: false },
    });
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "Answer.",
      egressClass: "operational",
      committedAt: 9,
      citations: [{ citationRef: "citation:1" }],
    };
    backend.results.acknowledgeTurnAnswer = {
      kind: "acknowledged",
      operatorViewedAt: 11,
      answer: backend.answer,
    };
    backend.results.inspectCitationEvidence = {
      kind: "unauthorized",
      reason: "membership_revoked",
    };
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.answer).not.toBeNull());
    await act(async () => {
      await result.current.inspectCitation("citation:1");
    });

    const source = result.current.sources["citation:1"];
    expect(source?.state).toBe("unauthorized");
    expect(source?.headline).toBe("This source is no longer available to you.");
    expect(result.current.answer?.narrative).toBe("Answer.");
  });
});

describe("history", () => {
  it("renders the reauthorized projection and names what was withheld", () => {
    backend.history = {
      kind: "history",
      threadKey: "t",
      reauthorizedAt: 5,
      entries: [
        {
          bindingId: "binding-0",
          runId: "run-0",
          createdAt: 1,
          runStatus: "completed",
          state: "answered",
          questionState: "retained",
          question: "Earlier question",
          answer: {
            outcome: "answer",
            narrative: "Earlier answer",
            egressClass: "operational",
            committedAt: 2,
            citations: [],
          },
        },
        {
          bindingId: "binding-x",
          runId: "run-x",
          createdAt: 0,
          runStatus: "completed",
          state: "unauthorized",
          questionState: "deleted",
          omittedReason: "egress_beyond_authority",
        },
      ],
    };
    const { result } = mountRun();

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[0]?.question).toBe("Earlier question");
    expect(result.current.history[1]?.question).toBeUndefined();
    expect(result.current.history[1]?.omittedHeadline).toBe(
      "This answer is no longer available to you.",
    );
  });
});

// ---------------------------------------------------------------------------
// Provisional narrative
// ---------------------------------------------------------------------------

function streamingRow(overrides: Record<string, unknown> = {}) {
  return {
    state: "streaming",
    released: true,
    text: "Two lanes are still",
    truncated: false,
    draftOrdinal: 1,
    updatedAt: 100,
    expiresAt: 400,
    ttlMs: 300,
    ...overrides,
  };
}

function provisionalInput(
  overrides: Partial<AthenaAgentProvisionalInput> = {},
): AthenaAgentProvisionalInput {
  return {
    preview: null,
    viewPhase: "running",
    viewReleased: false,
    finalizingAt: null,
    lastRenderedOrdinal: null,
    rowExpired: false,
    ...overrides,
  };
}

describe("the provisional state precedence", () => {
  const row = streamingRow() as AthenaAgentProvisionalInput["preview"];

  const table: {
    name: string;
    input: Partial<AthenaAgentProvisionalInput>;
    expected: string;
  }[] = [
    {
      name: "a buffered profile that never released reads as disabled",
      input: { preview: { state: "disabled", released: false } },
      expected: "disabled",
    },
    {
      name: "disabled outranks a terminal run",
      input: {
        preview: { state: "disabled", released: false },
        viewPhase: "canceled",
      },
      expected: "disabled",
    },
    {
      name: "disabled outranks a withdrawal both arms would claim",
      input: {
        preview: { state: "disabled", released: true },
        viewPhase: "canceled",
      },
      expected: "disabled",
    },
    {
      name: "a preview withdrawal after a release withdraws",
      input: {
        preview: { state: "withdrawn", reason: "run_canceled", released: true },
      },
      expected: "withdrawn",
    },
    {
      name: "a refusal before any release keeps the milestone-only view",
      input: {
        preview: { state: "withdrawn", reason: "membership_revoked", released: false },
      },
      expected: "awaiting_first_text",
    },
    {
      name: "a never-released turn whose view went unavailable renders nothing",
      input: {
        preview: { state: "withdrawn", reason: "membership_revoked", released: false },
        viewPhase: null,
      },
      expected: "none",
    },
    {
      name: "a terminal run after a release withdraws even with no preview",
      input: { preview: null, viewPhase: "canceled", viewReleased: true },
      expected: "withdrawn",
    },
    {
      name: "a committed turn never flips back to withdrawn",
      input: {
        preview: { state: "withdrawn", reason: "suppressed", released: true },
        viewPhase: "completed",
        viewReleased: true,
      },
      expected: "superseded",
    },
    {
      name: "the preview's own superseded outranks every rung below it",
      input: { preview: { state: "superseded", released: true } },
      expected: "superseded",
    },
    {
      name: "a committed turn supersedes a row that is still live",
      input: {
        preview: row,
        viewPhase: "completed",
        viewReleased: true,
        lastRenderedOrdinal: 1,
      },
      expected: "superseded",
    },
    {
      name: "finalizing at or after the row's updatedAt is committing",
      input: { preview: row, finalizingAt: 100, lastRenderedOrdinal: 1 },
      expected: "committing",
    },
    {
      name: "committing outranks a reset the same row would also claim",
      input: {
        preview: streamingRow({ draftOrdinal: 2 }) as typeof row,
        finalizingAt: 100,
        lastRenderedOrdinal: 1,
      },
      expected: "committing",
    },
    {
      name: "an expired row never commits",
      input: {
        preview: row,
        finalizingAt: 100,
        lastRenderedOrdinal: 1,
        rowExpired: true,
      },
      expected: "stalled",
    },
    {
      name: "a resumed draft moves updatedAt past finalizing and streams again",
      input: { preview: streamingRow({ updatedAt: 140, draftOrdinal: 2 }) as typeof row, finalizingAt: 100, lastRenderedOrdinal: 2 },
      expected: "streaming",
    },
    {
      name: "a newer draft ordinal is an edge-triggered reset",
      input: { preview: streamingRow({ draftOrdinal: 2 }) as typeof row, lastRenderedOrdinal: 1 },
      expected: "reset",
    },
    {
      name: "a reset outranks a pause the same row would also claim",
      input: {
        preview: streamingRow({ truncated: true, draftOrdinal: 2 }) as typeof row,
        lastRenderedOrdinal: 1,
      },
      expected: "reset",
    },
    {
      name: "an expired row never resets",
      input: {
        preview: streamingRow({ draftOrdinal: 2 }) as typeof row,
        lastRenderedOrdinal: 1,
        rowExpired: true,
      },
      expected: "stalled",
    },
    {
      name: "the first row a mount paints is never a reset",
      input: { preview: row, lastRenderedOrdinal: null },
      expected: "streaming",
    },
    {
      name: "a truncated row pauses at the limit",
      input: { preview: streamingRow({ truncated: true }) as typeof row, lastRenderedOrdinal: 1 },
      expected: "paused_at_limit",
    },
    {
      name: "an expired truncated row stalls instead of pausing",
      input: {
        preview: streamingRow({ truncated: true }) as typeof row,
        lastRenderedOrdinal: 1,
        rowExpired: true,
      },
      expected: "stalled",
    },
    {
      name: "a running turn with no release shows milestones only",
      input: { preview: { state: "awaiting_first_text", released: false } },
      expected: "awaiting_first_text",
    },
    {
      name: "the server's stalled rung after a release stalls",
      input: { preview: { state: "stalled", released: true } },
      expected: "stalled",
    },
    {
      name: "a row past its ttl stalls client-side",
      input: {
        preview: row,
        lastRenderedOrdinal: 1,
        rowExpired: true,
        viewReleased: true,
      },
      expected: "stalled",
    },
    {
      name: "nothing at all renders nothing",
      input: { preview: null, viewPhase: null },
      expected: "none",
    },
  ];

  for (const entry of table) {
    it(entry.name, () => {
      expect(deriveAthenaProvisionalState(provisionalInput(entry.input))).toBe(
        entry.expected,
      );
    });
  }

  it("covers every arm of the union", () => {
    expect(new Set(table.map((entry) => entry.expected))).toEqual(
      new Set([
        "disabled",
        "withdrawn",
        "superseded",
        "committing",
        "reset",
        "paused_at_limit",
        "streaming",
        "awaiting_first_text",
        "stalled",
        "none",
      ]),
    );
  });
});

describe("streaming the provisional narrative", () => {
  function previewCalls() {
    return backend.calls.filter((call) => call.name === "query:previewTurnNarrative");
  }

  it("subscribes only while the turn is running or the view has gone unavailable", async () => {
    backend.view = baseView({ phase: "queued" });
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("submitting"));
    expect(previewCalls()).toHaveLength(0);

    backend.view = baseView();
    backend.preview = { state: "awaiting_first_text", released: false };
    rerender();

    await waitFor(() =>
      expect(result.current.provisionalState).toBe("awaiting_first_text"),
    );
    expect(previewCalls().length).toBeGreaterThan(0);
    expect(previewCalls()[0]?.args).toMatchObject({
      storeId: STORE_ID,
      bindingId: BINDING_ID,
    });
  });

  it("renders the draft, acknowledges it once, and follows a growing buffer", async () => {
    backend.view = baseView({ provisionalReleasedAt: 90 });
    backend.preview = streamingRow();
    backend.results.acknowledgeProvisionalView = {
      kind: "acknowledged",
      provisionalViewedAt: 120,
    };
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.provisionalState).toBe("streaming"));
    expect(result.current.provisional?.text).toBe("Two lanes are still");

    backend.preview = streamingRow({ text: "Two lanes are still open.", updatedAt: 120 });
    rerender();

    await waitFor(() =>
      expect(result.current.provisional?.text).toBe("Two lanes are still open."),
    );
    await waitFor(() =>
      expect(callsNamed("acknowledgeProvisionalView")).toHaveLength(1),
    );
  });

  it("clears the draft with a one-render reset cue and no reset on the first paint", async () => {
    backend.view = baseView({ provisionalReleasedAt: 90 });
    backend.preview = streamingRow();
    const seen: string[] = [];
    const { result, rerender } = renderHook(() => {
      const run: AthenaAgentRun = useAthenaAgentRun({
        presentation,
        storeId: STORE_ID,
        context: { storeRef: "store-1", storeName: "Osu", operatingDate: "2026-08-21" },
        isActive: true,
        activeTurnId: BINDING_ID,
      });
      seen.push(run.provisionalState);
      return run;
    });

    await waitFor(() => expect(result.current.provisionalState).toBe("streaming"));
    expect(seen).not.toContain("reset");

    backend.preview = streamingRow({ draftOrdinal: 2, text: "Checking again", updatedAt: 130 });
    rerender();

    await waitFor(() => expect(result.current.provisional?.text).toBe("Checking again"));
    expect(seen.filter((state) => state === "reset")).toHaveLength(1);
    expect(result.current.provisionalState).toBe("streaming");
  });

  it("stalls when the row's ttl elapses with no new server data, and recovers on the next row", async () => {
    vi.useFakeTimers();
    try {
      backend.view = baseView({ provisionalReleasedAt: 90 });
      backend.preview = streamingRow({ ttlMs: 5_000 });
      const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.provisionalState).toBe("streaming");

      await act(async () => {
        vi.advanceTimersByTime(5_001);
      });
      expect(result.current.provisionalState).toBe("stalled");
      expect(result.current.provisional).toBeNull();

      backend.preview = streamingRow({ ttlMs: 5_000, updatedAt: 200, text: "More text" });
      rerender();
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.provisionalState).toBe("streaming");
      expect(result.current.provisional?.text).toBe("More text");
    } finally {
      vi.useRealTimers();
    }
  });

  it("latches a withdrawal, stops subscribing, and keeps the notice", async () => {
    backend.view = baseView({ provisionalReleasedAt: 90 });
    backend.preview = { state: "withdrawn", reason: "egress_beyond_authority", released: true };
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.provisionalState).toBe("withdrawn"));
    expect(result.current.provisionalWithdrawal?.headline).toBe("Draft withdrawn.");
    expect(result.current.provisionalWithdrawal?.detail).toBe(
      "This draft went beyond what you can read here.",
    );

    const before = previewCalls().length;
    // The subscription is dropped, so the query stops answering entirely; the
    // latched verdict is what keeps the notice on screen.
    backend.preview = undefined;
    rerender();

    await waitFor(() => expect(result.current.provisionalState).toBe("withdrawn"));
    expect(previewCalls().length).toBe(before);
  });

  it("does not latch not_found, which is the pre-ownership arm", async () => {
    backend.view = baseView();
    backend.preview = { state: "not_found" };
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() =>
      expect(result.current.provisionalState).toBe("awaiting_first_text"),
    );

    backend.preview = { state: "withdrawn", reason: "compatibility_epoch_fenced", released: true };
    rerender();

    await waitFor(() => expect(result.current.provisionalState).toBe("withdrawn"));
    expect(result.current.provisionalWithdrawal?.detail).toBe(
      "Athena was updated while this draft was being written.",
    );
  });

  it("keeps a view gone unavailable after a release on the withdrawal, not the stall", async () => {
    backend.view = baseView({ provisionalReleasedAt: 90 });
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.hostState).toBe("running"));

    backend.view = { kind: "unavailable", reason: "membership_revoked" };
    backend.preview = { state: "withdrawn", reason: "membership_revoked", released: true };
    rerender();

    await waitFor(() => expect(result.current.provisionalState).toBe("withdrawn"));
    expect(result.current.hostState).toBe("terminal_denied");
    expect(result.current.provisionalWithdrawal?.detail).toBe(
      "This draft is no longer available to you.",
    );
  });

  it("swaps to the committed answer without flickering through withdrawn", async () => {
    backend.view = baseView({ provisionalReleasedAt: 90 });
    backend.preview = streamingRow();
    const seen: string[] = [];
    const { result, rerender } = renderHook(() => {
      const run: AthenaAgentRun = useAthenaAgentRun({
        presentation,
        storeId: STORE_ID,
        context: { storeRef: "store-1", storeName: "Osu", operatingDate: "2026-08-21" },
        isActive: true,
        activeTurnId: BINDING_ID,
      });
      seen.push(run.provisionalState);
      return run;
    });

    await waitFor(() => expect(result.current.provisionalState).toBe("streaming"));

    // The run completes before the client has the answer: the preview is still
    // reporting the row it has not deleted yet.
    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      provisionalReleasedAt: 90,
      answer: { available: true, outcome: "answer", suppressed: false },
    });
    backend.preview = { state: "superseded", released: true };
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "A different, checked answer.",
      egressClass: "operational",
      committedAt: 200,
      citations: [],
    };
    backend.results.acknowledgeTurnAnswer = {
      kind: "acknowledged",
      operatorViewedAt: 210,
    };
    rerender();

    await waitFor(() => expect(result.current.provisionalState).toBe("superseded"));
    expect(seen).not.toContain("withdrawn");
    expect(result.current.provisional).toBeNull();
    await waitFor(() =>
      expect(result.current.answer?.narrative).toBe("A different, checked answer."),
    );
  });

  it("shows committing while finalizing is at or after the row, on a panel that mounts late", async () => {
    backend.view = baseView({
      provisionalReleasedAt: 90,
      milestones: [
        { milestone: "reading_sources", at: 50 },
        { milestone: "finalizing", at: 150 },
      ],
    });
    backend.preview = streamingRow({ updatedAt: 150 });
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.provisionalState).toBe("committing"));
    expect(result.current.provisional?.text).toBe("Two lanes are still");

    // The commit was refused; the resumed draft's flush moves updatedAt past it.
    backend.preview = streamingRow({ updatedAt: 190, draftOrdinal: 2, text: "Trying again" });
    rerender();

    await waitFor(() => expect(result.current.provisionalState).toBe("streaming"));
  });

  it("shows no draft state at all for a buffered profile", async () => {
    backend.view = baseView();
    backend.preview = { state: "disabled", released: false };
    const { result } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.provisionalState).toBe("disabled"));
    expect(result.current.provisional).toBeNull();
    expect(result.current.provisionalWithdrawal).toBeNull();
    expect(callsNamed("acknowledgeProvisionalView")).toHaveLength(0);
  });
});

describe("the provisional timeline", () => {
  it("keeps each finished draft in order as the ordinal advances, then folds the last one in at commit", async () => {
    backend.view = baseView({ provisionalReleasedAt: 90 });
    backend.preview = streamingRow({ draftOrdinal: 0, text: "Checking the registers." });
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });

    await waitFor(() => expect(result.current.provisionalState).toBe("streaming"));
    expect(result.current.provisionalTimeline).toEqual([]);

    backend.preview = streamingRow({ draftOrdinal: 1, text: "Now the automation log.", updatedAt: 130 });
    rerender();
    await waitFor(() => expect(result.current.provisional?.text).toBe("Now the automation log."));
    await waitFor(() =>
      expect(result.current.provisionalTimeline).toEqual([
        { text: "Checking the registers.", truncated: false, draftOrdinal: 0 },
      ]),
    );

    backend.preview = streamingRow({ draftOrdinal: 2, text: "Summing up.", updatedAt: 140 });
    rerender();
    await waitFor(() =>
      expect(result.current.provisionalTimeline.map((entry) => entry.draftOrdinal)).toEqual([0, 1]),
    );
    expect(result.current.provisionalTimeline[1]?.text).toBe("Now the automation log.");
    // The live draft is never also a timeline entry.
    expect(result.current.provisionalTimeline.some((entry) => entry.draftOrdinal === 2)).toBe(false);

    backend.view = baseView({
      phase: "completed",
      canCancel: false,
      provisionalReleasedAt: 90,
      answer: { available: true, outcome: "answer", suppressed: false },
    });
    backend.preview = { state: "superseded", released: true };
    backend.answer = {
      kind: "answer",
      outcome: "answer",
      narrative: "A different, checked answer.",
      egressClass: "operational",
      committedAt: 200,
      citations: [],
    };
    backend.results.acknowledgeTurnAnswer = { kind: "acknowledged", operatorViewedAt: 210 };
    rerender();

    await waitFor(() => expect(result.current.provisionalState).toBe("superseded"));
    expect(result.current.provisional).toBeNull();
    await waitFor(() =>
      expect(result.current.provisionalTimeline.map((entry) => entry.draftOrdinal)).toEqual([0, 1, 2]),
    );
    expect(result.current.provisionalTimeline[2]?.text).toBe("Summing up.");
  });

  it("hides the timeline when the draft is withdrawn and drops it for the next thread", async () => {
    backend.view = baseView({ provisionalReleasedAt: 90 });
    backend.preview = streamingRow({ draftOrdinal: 0, text: "Checking the registers." });
    const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });
    await waitFor(() => expect(result.current.provisionalState).toBe("streaming"));

    backend.preview = streamingRow({ draftOrdinal: 1, text: "Now the log.", updatedAt: 130 });
    rerender();
    await waitFor(() => expect(result.current.provisionalTimeline).toHaveLength(1));

    backend.preview = { state: "withdrawn", reason: "membership_revoked", released: true };
    rerender();
    await waitFor(() => expect(result.current.provisionalState).toBe("withdrawn"));
    expect(result.current.provisionalTimeline).toEqual([]);

    act(() => {
      result.current.startNewThread();
    });
    expect(result.current.provisionalTimeline).toEqual([]);
  });

  it("hides the timeline while a draft is stalled and shows it again when the draft resumes", async () => {
    vi.useFakeTimers();
    try {
      backend.view = baseView({ provisionalReleasedAt: 90 });
      backend.preview = streamingRow({ draftOrdinal: 0, text: "Checking the registers." });
      const { result, rerender } = mountRun({ activeTurnId: BINDING_ID });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.provisionalState).toBe("streaming");

      backend.preview = streamingRow({ draftOrdinal: 1, text: "Now the log.", updatedAt: 130, ttlMs: 1_000 });
      rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.provisionalTimeline).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_001);
      });
      expect(result.current.provisionalState).toBe("stalled");
      expect(result.current.provisionalTimeline).toEqual([]);

      backend.preview = streamingRow({ draftOrdinal: 1, text: "Now the log, continued.", updatedAt: 2_000, ttlMs: 5_000 });
      rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.provisionalState).toBe("streaming");
      expect(result.current.provisionalTimeline).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
