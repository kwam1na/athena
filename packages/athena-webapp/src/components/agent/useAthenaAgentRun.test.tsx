import { act, renderHook, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

import { defineAthenaAgentPresentation } from "./AthenaAgentPresentationAdapter";
import { useAthenaAgentRun } from "./useAthenaAgentRun";

vi.mock("~/convex/_generated/api", () => ({
  api: {
    agentHarness: {
      turns: {
        startTurn: "startTurn",
        cancelTurn: "cancelTurn",
        resumeTurn: "resumeTurn",
        acknowledgeTurnAnswer: "acknowledgeTurnAnswer",
        inspectCitationEvidence: "inspectCitationEvidence",
        getTurnView: "getTurnView",
        getTurnAnswer: "getTurnAnswer",
        getThreadHistory: "getThreadHistory",
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
    calls: [],
    results: {},
  };

  vi.mocked(useQuery).mockImplementation(((name: string, args: QueryArgs) => {
    if (args === "skip") return undefined;
    backend.calls.push({ name: `query:${name}`, args });
    if (name === "getThreadHistory") return backend.history;
    if (name === "getTurnView") return backend.view;
    if (name === "getTurnAnswer") return backend.answer;
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
