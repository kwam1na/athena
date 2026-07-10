import type { WithoutSystemFields } from "convex/server";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type RegisterSessionDocument = WithoutSystemFields<Doc<"registerSession">>;
type RegisterSessionPatch = Omit<
  Partial<RegisterSessionDocument>,
  "lifecycleAuthorityRevision"
>;

export function initialRegisterSessionAuthorityRevision() {
  return 1;
}

export function buildRegisterSessionAuthorityPatch<
  T extends RegisterSessionPatch,
>(
  current: Pick<
    Doc<"registerSession">,
    "status" | "lifecycleAuthorityRevision"
  >,
  patch: T,
): T & { lifecycleAuthorityRevision?: number } {
  const {
    lifecycleAuthorityRevision: _callerRevision,
    ...safePatch
  } = patch as T & { lifecycleAuthorityRevision?: number };
  if (safePatch.status === undefined || safePatch.status === current.status) {
    return safePatch as T;
  }

  return {
    ...safePatch,
    lifecycleAuthorityRevision: (current.lifecycleAuthorityRevision ?? 0) + 1,
  } as T & { lifecycleAuthorityRevision: number };
}

export function insertRegisterSessionWithAuthority(
  ctx: MutationCtx,
  value: RegisterSessionDocument,
) {
  return ctx.db.insert("registerSession", {
    ...value,
    lifecycleAuthorityRevision: initialRegisterSessionAuthorityRevision(),
  });
}

export async function patchRegisterSessionWithAuthority(
  ctx: MutationCtx,
  registerSessionId: Id<"registerSession">,
  patch: RegisterSessionPatch,
) {
  const current = await ctx.db.get("registerSession", registerSessionId);
  if (!current) {
    throw new Error("Register session not found.");
  }

  await ctx.db.patch(
    "registerSession",
    registerSessionId,
    buildRegisterSessionAuthorityPatch(current, patch),
  );
}
