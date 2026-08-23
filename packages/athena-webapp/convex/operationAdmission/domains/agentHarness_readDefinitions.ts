import type { OperationReadDefinition } from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * Agent harness turn reads (V26-1265). The turn view, the reauthorized answer,
 * and the thread history are intelligence reads (`intelligence.view`, not
 * demo-granted); admission clamps the store and each handler reauthorizes the
 * viewer against the run's pinned operator and the live authority port.
 */
function turnRead(functionName: string, operationId: string) {
  return defineReadOperation({
    kind: "query" as const,
    functionName,
    operationId,
    access: { kind: "read" as const, intent: "intelligence.view" as const },
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const getTurnViewReadDefinition = turnRead("agentHarness/turns:getTurnView", "agentHarness/turns.getTurnView.read");
export const getTurnAnswerReadDefinition = turnRead("agentHarness/turns:getTurnAnswer", "agentHarness/turns.getTurnAnswer.read");
export const getThreadHistoryReadDefinition = turnRead("agentHarness/turns:getThreadHistory", "agentHarness/turns.getThreadHistory.read");
/** The provisional-narrative preview: same rail, same store clamp, reauthorized per read; only the initiating operator is ever served. */
export const previewTurnNarrativeReadDefinition = turnRead("agentHarness/turns:previewTurnNarrative", "agentHarness/turns.previewTurnNarrative.read");
/** The committed turn's draft trail: the answer's own rail and gate, so the trail is never readable where the answer is not. */
export const getTurnNarrativeTrailReadDefinition = turnRead("agentHarness/turns:getTurnNarrativeTrail", "agentHarness/turns.getTurnNarrativeTrail.read");

export const AGENT_HARNESS_READ_DEFINITIONS: readonly OperationReadDefinition[] = [
  getTurnViewReadDefinition,
  getTurnAnswerReadDefinition,
  getThreadHistoryReadDefinition,
  previewTurnNarrativeReadDefinition,
  getTurnNarrativeTrailReadDefinition,
];
