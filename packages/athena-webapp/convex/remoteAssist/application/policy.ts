import {
  userError,
  type CommandResult,
} from "../../../shared/commandResult";
import type {
  RemoteAssistClient,
  RemoteAssistMode,
} from "./types";
import { REMOTE_ASSIST_PRESENCE_FRESHNESS_MS } from "./types";

export type RemoteAssistActor = {
  organizationId: string;
  storeIds?: string[];
  userId: string;
  role: "full_admin" | "pos_only" | "support" | "owner";
  remoteAssistAllowed?: boolean;
};

export type RemoteAssistPolicyDecision =
  | {
      kind: "allowed";
      effectiveMode: RemoteAssistMode;
      requiresLocalApproval: boolean;
    }
  | {
      kind: "denied";
      code: "authorization_failed" | "precondition_failed" | "unavailable";
      reason: string;
    };

export function evaluateRemoteAssistPolicy(args: {
  actor: RemoteAssistActor;
  client: RemoteAssistClient;
  now: number;
  requestedMode: RemoteAssistMode;
}): RemoteAssistPolicyDecision {
  const { actor, client } = args;
  if (actor.organizationId !== client.organizationId) {
    return denied("authorization_failed", "Remote Assist is limited to the client's organization.");
  }
  if (client.storeId && actor.storeIds && !actor.storeIds.includes(client.storeId)) {
    return denied("authorization_failed", "Remote Assist is limited to the actor's store scope.");
  }
  if (!actor.remoteAssistAllowed && actor.role !== "full_admin" && actor.role !== "owner") {
    return denied("authorization_failed", "This account cannot start Remote Assist sessions.");
  }
  if (client.enrollmentStatus !== "active") {
    return denied("precondition_failed", "This client is not enrolled for Remote Assist.");
  }
  if (client.accessPolicy === "disabled") {
    return denied("precondition_failed", "Remote Assist is disabled for this client.");
  }
  if (!isClientFresh(client, args.now)) {
    return denied("unavailable", "This client is not currently available for Remote Assist.");
  }
  if (args.requestedMode === "unattended") {
    if (!client.capabilities.unattendedCoBrowsing || !client.capabilities.boundedControl) {
      return denied("precondition_failed", "This client does not support unattended Remote Assist.");
    }
    if (client.accessPolicy === "attended_required") {
      return {
        kind: "allowed",
        effectiveMode: "attended",
        requiresLocalApproval: true,
      };
    }
  }

  return {
    kind: "allowed",
    effectiveMode: args.requestedMode,
    requiresLocalApproval: client.accessPolicy === "attended_required",
  };
}

export function policyDecisionToCommandResult(
  decision: RemoteAssistPolicyDecision,
): CommandResult<RemoteAssistPolicyDecision> {
  if (decision.kind === "allowed") {
    return { kind: "ok", data: decision };
  }
  return userError({
    code: decision.code,
    message: decision.reason,
  });
}

function isClientFresh(client: RemoteAssistClient, now: number): boolean {
  return (
    client.presenceStatus === "online" &&
    typeof client.lastPresenceAt === "number" &&
    now - client.lastPresenceAt <= REMOTE_ASSIST_PRESENCE_FRESHNESS_MS
  );
}

function denied(
  code: Extract<RemoteAssistPolicyDecision, { kind: "denied" }>["code"],
  reason: string,
): RemoteAssistPolicyDecision {
  return {
    kind: "denied",
    code,
    reason,
  };
}
