import { Id } from "../_generated/dataModel";

export function buildApprovalRequest(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  requestType: string;
  subjectType: string;
  subjectId: string;
  requestedByUserId?: Id<"athenaUser">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  reason?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}) {
  return {
    ...args,
    status: "pending" as const,
    createdAt: Date.now(),
  };
}
