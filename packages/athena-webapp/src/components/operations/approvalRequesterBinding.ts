import type { Id } from "~/convex/_generated/dataModel";
import type { ApprovalRequesterBinding } from "~/shared/approvalPolicy";

export function toApprovalRequesterBindingArg(
  binding?: ApprovalRequesterBinding,
):
  | {
      challengeId: Id<"approvalRequesterChallenge">;
      kind: "operational_staff_challenge";
      requestedByStaffProfileId: Id<"staffProfile">;
    }
  | undefined {
  if (!binding) {
    return undefined;
  }

  return {
    challengeId: binding.challengeId as Id<"approvalRequesterChallenge">,
    kind: binding.kind,
    requestedByStaffProfileId:
      binding.requestedByStaffProfileId as Id<"staffProfile">,
  };
}
