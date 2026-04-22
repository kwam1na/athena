import type { QueryCtx } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

import type { PosCashierSummary } from "../../domain/types";

export async function getCashierForRegisterState(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    staffProfileId?: Id<"staffProfile">;
  },
): Promise<PosCashierSummary | null> {
  if (!args.staffProfileId) {
    return null;
  }

  const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);
  if (
    !staffProfile ||
    staffProfile.storeId !== args.storeId ||
    staffProfile.status !== "active"
  ) {
    return null;
  }

  const [firstName, ...restNames] =
    [staffProfile.firstName, staffProfile.lastName]
      .filter(Boolean)
      .map((value) => value!.trim().replace(/\s+/g, " "));
  const fallbackNames = staffProfile.fullName?
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => value.trim());

  const resolvedFirstName = firstName || fallbackNames[0] || staffProfile.fullName;
  const resolvedLastName =
    restNames.join(" ") || fallbackNames.slice(1).join(" ") || resolvedFirstName;

  return {
    _id: staffProfile._id,
    firstName: resolvedFirstName,
    lastName: resolvedLastName,
    active: staffProfile.status === "active",
  };
}
