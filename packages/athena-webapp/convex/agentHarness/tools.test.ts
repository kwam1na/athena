/**
 * Answer artifact derivation in `athena.completeRun`.
 *
 * The narrative the model writes may quote anything the provider was shown, so
 * the artifact's egress class must be derived from every attempt whose result
 * was released to the provider — and from the projected history the provider
 * was replayed — never from the cited subset the model chooses.
 */
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { AgentToolHandlerContext } from "../../shared/agentHarness/agentRuntime";
import { opaqueRef, type AgentEgressClass } from "../../shared/agentHarness/values";
import { completeRunTool, createAthenaToolRegistrations, type AgentToolHostContext } from "./tools";

type CompleteRunCall = { artifact: { payload: Record<string, unknown> } };

const PREPARE_COMPLETION = { seam: "prepareCompletion" };
const COMPLETE_RUN = { seam: "completeRun" };

function handlerContext(idempotencyKey: string): AgentToolHandlerContext {
  return {
    turnRef: opaqueRef("runtime_turn", "test"),
    callId: idempotencyKey,
    idempotencyKey,
    signal: new AbortController().signal,
  };
}

/**
 * One attempt per requested class, each released to the provider, then a
 * completion citing only the refs the caller names. `egressFloor` is the class
 * of the projected history the turn replayed into the provider.
 */
function toolsUnderTest(attemptClasses: readonly AgentEgressClass[], egressFloor?: AgentEgressClass) {
  const completions: CompleteRunCall[] = [];
  let sequence = 0;

  const host = {
    runId: "run_1" as Id<"intelligenceRun">,
    bindingId: "binding_1" as Id<"agentTurnBinding">,
    ctx: {
      runQuery: async () => ({ kind: "refused", stage: "test", reason: "unused" }),
      runMutation: async (reference: unknown, args: unknown) => {
        if (reference === PREPARE_COMPLETION) {
          return { outcome: "prepared", preparedCompletionRef: "prepared_1" };
        }
        completions.push(args as CompleteRunCall);
        return { outcome: "completed", artifactId: "artifact_1", citations: [] };
      },
    },
    refs: { prepareCompletion: PREPARE_COMPLETION, completeRun: COMPLETE_RUN } as unknown as AgentToolHostContext["refs"],
    executeProgram: async () => {
      const index = sequence++;
      return {
        outcome: "result",
        attemptRef: `attempt_${index}`,
        attemptId: `attempt_id_${index}` as Id<"agentProgramAttempt">,
        result: {
          output: { index },
          egressClass: attemptClasses[index],
          completeness: { status: "complete", sources: [] },
          freshness: { class: "live", authority: "live_read" },
        },
        citations: [{ citation: `citation_${index}`, namespace: "inventory.positions", verb: "list" }],
        calls: [],
      } as never;
    },
    now: () => 1_700_000_000_000,
    egressFloor: egressFloor ?? "operational",
  } satisfies Partial<AgentToolHostContext> as unknown as AgentToolHostContext;

  const { registrations } = createAthenaToolRegistrations(host);
  const byId = new Map(registrations.map((registration) => [registration.definition.toolId, registration]));
  return {
    completions,
    executeProgram: async () =>
      byId.get("athena.executeProgram")!.handler({ source: "return 1;" } as never, handlerContext(`exec_${sequence}`)),
    completeRun: (args: Record<string, unknown>) =>
      byId.get("athena.completeRun")!.handler(args as never, handlerContext("complete_1")),
  };
}

describe("athena.completeRun answer egress class", () => {
  it("commits the maximum class over every provider-exposed attempt, not the cited subset", async () => {
    const tools = toolsUnderTest(["operational", "sensitive"]);
    await tools.executeProgram();
    await tools.executeProgram();

    const outcome = await tools.completeRun({
      outcome: "answer",
      narrative: "Stock is short on two lines.",
      citedAttemptRefs: ["attempt_0"],
      citations: [{ ref: "citation_0" }],
    });

    expect(outcome.kind).toBe("success");
    expect(tools.completions).toHaveLength(1);
    expect(tools.completions[0].artifact.payload.egressClass).toBe("sensitive");
  });

  it("keeps the class at the floor when no attempt exceeded it", async () => {
    const tools = toolsUnderTest(["operational", "operational"]);
    await tools.executeProgram();
    await tools.executeProgram();

    await tools.completeRun({
      outcome: "answer",
      narrative: "Nothing exceptional today.",
      citedAttemptRefs: ["attempt_1"],
      citations: [{ ref: "citation_1" }],
    });

    expect(tools.completions[0].artifact.payload.egressClass).toBe("operational");
  });

  it("holds the class at the projected history's class when this turn read only operational sources", async () => {
    // A prior sensitive answer was replayed into the provider, so the narrative
    // may restate it even though nothing this turn read exceeded operational.
    const tools = toolsUnderTest(["operational", "operational"], "sensitive");
    await tools.executeProgram();
    await tools.executeProgram();

    await tools.completeRun({
      outcome: "answer",
      narrative: "Same as the figures above.",
      citedAttemptRefs: ["attempt_0"],
      citations: [{ ref: "citation_0" }],
    });

    expect(tools.completions[0].artifact.payload.egressClass).toBe("sensitive");
  });
});

describe("athena.executeProgram field diagnostics", () => {
  it("passes field advisories through to the model as fieldDiagnostics messages", async () => {
    const host = {
      runId: "run_1" as Id<"intelligenceRun">,
      bindingId: "binding_1" as Id<"agentTurnBinding">,
      ctx: { runQuery: async () => ({}), runMutation: async () => ({}) },
      refs: {} as unknown as AgentToolHostContext["refs"],
      executeProgram: async () =>
        ({
          outcome: "result",
          attemptRef: "attempt_0",
          attemptId: "attempt_id_0" as Id<"agentProgramAttempt">,
          result: {
            output: { total: null },
            egressClass: "operational",
            completeness: { status: "complete", sources: [] },
            freshness: { class: "live", authority: "live_read" },
          },
          citations: [],
          calls: [],
          fieldAdvisories: [
            { namespace: "reports.daySales", field: "totalSales", message: "`totalSales` is not a field of reports.daySales; its fields are: grossRevenue, paymentGroups." },
          ],
        }) as never,
      now: () => 1_700_000_000_000,
      egressFloor: "operational",
    } satisfies Partial<AgentToolHostContext> as unknown as AgentToolHostContext;
    const { registrations } = createAthenaToolRegistrations(host);
    const executeProgram = registrations.find((registration) => registration.definition.toolId === "athena.executeProgram")!;
    const outcome = await executeProgram.handler({ source: "return 1;" } as never, handlerContext("exec_advisory"));
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") return;
    expect((outcome.result as { fieldDiagnostics?: readonly string[] }).fieldDiagnostics).toEqual([
      "`totalSales` is not a field of reports.daySales; its fields are: grossRevenue, paymentGroups.",
    ]);
  });
});

describe("athena.completeRun submission canonicalization", () => {
  it("re-buckets refs filed under the wrong argument by prefix", () => {
    const validated = completeRunTool.validateInput({
      outcome: "answer",
      narrative: "One shift is open.",
      citedAttemptRefs: ["attempt_v1.2.abc", "citation:v1.2.3.def"],
      citations: [
        { ref: "attempt_v1.2.abc" },
        { ref: "citation:v1.2.4.9a8", claim: "day sales" },
      ],
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.args.citedAttemptRefs).toEqual(["attempt_v1.2.abc"]);
    expect(validated.args.citations).toEqual([
      { ref: "citation:v1.2.3.def" },
      { ref: "citation:v1.2.4.9a8", claim: "day sales" },
    ]);
  });

  it("completes honestly with no_usable_sources when every read failed", async () => {
    const tools = toolsUnderTest(["operational"]);
    const outcome = await tools.completeRun({
      outcome: "no_usable_sources",
      narrative: "No usable data sources were accessible in this run.",
      citedAttemptRefs: [],
      citations: [],
    });
    expect(outcome.kind).toBe("success");
    expect(tools.completions).toHaveLength(1);
    expect(tools.completions[0].artifact.payload).toMatchObject({ outcome: "no_usable_sources" });
  });

  it("still refuses an answer with zero successful attempts", async () => {
    const tools = toolsUnderTest(["operational"]);
    const outcome = await tools.completeRun({
      outcome: "answer",
      narrative: "Guessed.",
      citedAttemptRefs: [],
      citations: [],
    });
    expect(outcome).toMatchObject({ kind: "denied", denial: { code: "no_attempts" } });
  });
});

describe("athena.completeRun ref resolution by content-hash tail", () => {
  /** Attempts whose refs carry realistic 32-hex tails, as the harness mints them. */
  function hashedTools() {
    const completions: CompleteRunCall[] = [];
    let sequence = 0;
    const host = {
      runId: "run_1" as Id<"intelligenceRun">,
      bindingId: "binding_1" as Id<"agentTurnBinding">,
      ctx: {
        runQuery: async () => ({}),
        runMutation: async (reference: unknown, args: unknown) => {
          if (reference === PREPARE_COMPLETION) return { outcome: "prepared", preparedCompletionRef: "prepared_1" };
          completions.push(args as CompleteRunCall);
          return { outcome: "completed", artifactId: "artifact_1", citations: [] };
        },
      },
      refs: { prepareCompletion: PREPARE_COMPLETION, completeRun: COMPLETE_RUN } as unknown as AgentToolHostContext["refs"],
      executeProgram: async () => {
        const index = sequence++;
        return {
          outcome: "result",
          attemptRef: `attempt_v1.${index + 1}.aaaabbbbccccdddd0000111122223333`,
          attemptId: `attempt_id_${index}` as Id<"agentProgramAttempt">,
          result: { output: { index }, egressClass: "operational", completeness: { status: "complete", sources: [] }, freshness: { class: "live", authority: "live_read" } },
          citations: [{ citation: `citation:v1.${index + 1}.${index + 1}.9999888877776666555544443333222${index}`, namespace: "inventory.positions", verb: "list" }],
          calls: [],
        } as never;
      },
      now: () => 1_700_000_000_000,
      egressFloor: "operational",
    } satisfies Partial<AgentToolHostContext> as unknown as AgentToolHostContext;
    const { registrations } = createAthenaToolRegistrations(host);
    const byId = new Map(registrations.map((registration) => [registration.definition.toolId, registration]));
    return {
      completions,
      executeProgram: () => byId.get("athena.executeProgram")!.handler({ source: "return 1;" } as never, handlerContext(`exec_${sequence}`)),
      completeRun: (args: Record<string, unknown>) => byId.get("athena.completeRun")!.handler(args as never, handlerContext("complete_1")),
    };
  }

  it("snaps prefix-dropped and segment-dropped refs to the minted handles by hash tail", async () => {
    const tools = hashedTools();
    await tools.executeProgram();
    const outcome = await tools.completeRun({
      outcome: "answer",
      narrative: "One line.",
      // Dropped "citation:" prefix on the citation; version segment intact on the attempt.
      citedAttemptRefs: ["attempt_v1.1.aaaabbbbccccdddd0000111122223333"],
      citations: [{ ref: "v1.1.1.99998888777766665555444433332220", claim: "positions read" }],
    });
    expect(outcome.kind).toBe("success");
    const call = tools.completions[0] as unknown as { citedAttemptRefs: string[]; citations: { ref: string; claim?: string }[] };
    expect(call.citedAttemptRefs).toEqual(["attempt_v1.1.aaaabbbbccccdddd0000111122223333"]);
    expect(call.citations).toEqual([{ ref: "citation:v1.1.1.99998888777766665555444433332220", claim: "positions read" }]);
  });

  it("re-buckets a citation hash wearing an attempt prefix", async () => {
    const tools = hashedTools();
    await tools.executeProgram();
    const outcome = await tools.completeRun({
      outcome: "answer",
      narrative: "One line.",
      citedAttemptRefs: [
        "attempt_v1.1.aaaabbbbccccdddd0000111122223333",
        // A citation's hash tail wearing an attempt-shaped prefix.
        "attempt_v1.1.1.99998888777766665555444433332220",
      ],
      citations: [],
    });
    expect(outcome.kind).toBe("success");
    const call = tools.completions[0] as unknown as { citedAttemptRefs: string[]; citations: { ref: string }[] };
    expect(call.citedAttemptRefs).toEqual(["attempt_v1.1.aaaabbbbccccdddd0000111122223333"]);
    expect(call.citations).toEqual([{ ref: "citation:v1.1.1.99998888777766665555444433332220" }]);
  });

  it("names the minted refs when an answer still lacks a resolvable citation", async () => {
    const tools = hashedTools();
    await tools.executeProgram();
    // A namespace string resolves to no known handle, so no citation survives
    // normalization — and the denial names exactly what would be valid.
    const denied = await tools.completeRun({
      outcome: "answer",
      narrative: "One line.",
      citedAttemptRefs: ["attempt_v1.1.aaaabbbbccccdddd0000111122223333"],
      citations: [{ ref: "operations.storeDay.get" }],
    });
    expect(denied).toMatchObject({ kind: "denied", denial: { code: "citations_required" } });
    if (denied.kind !== "denied") return;
    expect(denied.denial.message).toContain("attempt_v1.1.aaaabbbbccccdddd0000111122223333");
    expect(denied.denial.message).toContain("citation:v1.1.1.99998888777766665555444433332220");
  });
});
