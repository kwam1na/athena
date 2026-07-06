import type { Id } from "../../_generated/dataModel";
import type { ApprovalRequirement } from "../../../shared/approvalPolicy";
import { APPROVAL_ACTIONS } from "../approvalActions";

export const DAILY_CLOSE_SUBJECT_TYPE = "daily_close";
export const DAILY_CLOSE_CARRY_FORWARD_TYPE = "daily_close_carry_forward";
export const DAILY_CLOSE_COMPLETION_ACTION =
  APPROVAL_ACTIONS.dailyCloseCompletion;
export const DAILY_CLOSE_REOPEN_ACTION = APPROVAL_ACTIONS.dailyCloseReopen;
export const DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION = {
  key: "operations.daily_close.resolve_carry_forward",
  label: "Resolve carry-forward work",
} as const;

export function buildDailyCloseApprovalSubject(args: {
  operatingDate: string;
  storeId: Id<"store">;
}) {
  return {
    id: `${args.storeId}:${args.operatingDate}`,
    label: `EOD Review ${args.operatingDate}`,
    type: DAILY_CLOSE_SUBJECT_TYPE,
  };
}

export function buildDailyCloseCompletionApprovalRequirement(args: {
  operatingDate: string;
  storeId: Id<"store">;
}): ApprovalRequirement {
  return {
    action: DAILY_CLOSE_COMPLETION_ACTION,
    reason: "Manager approval is required to complete EOD Review.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: buildDailyCloseApprovalSubject(args),
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to approve this end of day review before the operating day is saved.",
      primaryActionLabel: "Approve and complete",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [
      {
        kind: "inline_manager_proof",
      },
    ],
    metadata: {
      operatingDate: args.operatingDate,
    },
  };
}

export function buildDailyCloseReopenApprovalRequirement(args: {
  dailyCloseId: Id<"dailyClose">;
  operatingDate: string;
  storeId: Id<"store">;
}): ApprovalRequirement {
  return {
    action: DAILY_CLOSE_REOPEN_ACTION,
    reason: "Manager approval is required to reopen EOD Review.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: {
      id: args.dailyCloseId,
      label: `EOD Review ${args.operatingDate}`,
      type: DAILY_CLOSE_SUBJECT_TYPE,
    },
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to approve reopening this EOD Review before the operating day can be revised.",
      primaryActionLabel: "Approve and reopen",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [
      {
        kind: "inline_manager_proof",
      },
    ],
    metadata: {
      dailyCloseId: args.dailyCloseId,
      operatingDate: args.operatingDate,
    },
  };
}

export function buildDailyCloseCarryForwardApprovalSubject(args: {
  businessDate: string;
  dailyCloseId: Id<"dailyClose">;
  outcome: "completed" | "cancelled";
  sourceId: string;
}) {
  return {
    id: `${args.dailyCloseId}:${args.sourceId}:${args.outcome}`,
    label: `Carry-forward follow-up for EOD Review ${args.businessDate}`,
    type: DAILY_CLOSE_CARRY_FORWARD_TYPE,
  };
}

export function buildDailyCloseCarryForwardApprovalRequirement(args: {
  businessDate: string;
  dailyCloseId: Id<"dailyClose">;
  outcome: "completed" | "cancelled";
  sourceId: string;
}): ApprovalRequirement {
  return {
    action: DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION,
    reason: "Manager approval is required to resolve carry-forward work.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: buildDailyCloseCarryForwardApprovalSubject(args),
    copy: {
      title: "Manager approval required",
      message:
        args.outcome === "completed"
          ? "A manager needs to approve completing this carry-forward follow-up."
          : "A manager needs to approve cancelling this carry-forward follow-up.",
      primaryActionLabel:
        args.outcome === "completed"
          ? "Approve and complete"
          : "Approve and cancel",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [
      {
        kind: "inline_manager_proof",
      },
    ],
    metadata: {
      businessDate: args.businessDate,
      dailyCloseId: args.dailyCloseId,
      outcome: args.outcome,
      sourceId: args.sourceId,
    },
  };
}
