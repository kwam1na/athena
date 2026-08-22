import type { OperationDefinition } from "../types";
import { defineOperation } from "./_shapes";

/**
 * Agent harness turn ingress (V26-1265).
 *
 * Starting or resuming a turn reaches an external model provider, exactly like
 * insight generation: the capability is `intelligence.generate` and the
 * `integration.dispatch` gateway is declared, so the shared demo is denied
 * twice over before any prompt is built. Cancelling, acknowledging a view, and
 * inspecting evidence are bookkeeping writes on the operator's own turn under
 * `intelligence.manage`. Every handler reauthorizes the viewer again through
 * the delegated authority port; admission only clamps the store and names the
 * capability.
 */
function turnStartOperation(args: { functionName: string; operationId: string }) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "intelligence.generate" as const,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "none" as const },
    effects: { mode: "protected" as const, gateways: ["integration.dispatch"] as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

function turnManageOperation(args: { functionName: string; operationId: string }) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "intelligence.manage" as const,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const startTurnOperationDefinition = turnStartOperation({
  functionName: "agentHarness/turns:startTurn",
  operationId: "agentHarness/turns.startTurn",
});

export const resumeTurnOperationDefinition = turnStartOperation({
  functionName: "agentHarness/turns:resumeTurn",
  operationId: "agentHarness/turns.resumeTurn",
});

export const cancelTurnOperationDefinition = turnManageOperation({
  functionName: "agentHarness/turns:cancelTurn",
  operationId: "agentHarness/turns.cancelTurn",
});

export const acknowledgeTurnAnswerOperationDefinition = turnManageOperation({
  functionName: "agentHarness/turns:acknowledgeTurnAnswer",
  operationId: "agentHarness/turns.acknowledgeTurnAnswer",
});

export const inspectCitationEvidenceOperationDefinition = turnManageOperation({
  functionName: "agentHarness/turns:inspectCitationEvidence",
  operationId: "agentHarness/turns.inspectCitationEvidence",
});

export const AGENT_HARNESS_DEFINITIONS: readonly OperationDefinition[] = [
  startTurnOperationDefinition,
  resumeTurnOperationDefinition,
  cancelTurnOperationDefinition,
  acknowledgeTurnAnswerOperationDefinition,
  inspectCitationEvidenceOperationDefinition,
];
