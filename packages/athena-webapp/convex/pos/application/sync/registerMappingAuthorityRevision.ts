import type { WithoutSystemFields } from "convex/server";

import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

type MappingInput = WithoutSystemFields<Doc<"posLocalSyncMapping">>;
type MappingAuthorityState = Doc<"posRegisterMappingAuthority">["state"];
type MappingAuthorityObservation = {
  state: MappingAuthorityState;
  cloudRegisterSessionId?: string;
  mappingId?: Id<"posLocalSyncMapping">;
};
type CurrentMappingAuthority = MappingAuthorityObservation & {
  revision: number;
};

export function buildNextRegisterMappingAuthority(
  current: CurrentMappingAuthority | null,
  observation: MappingAuthorityObservation,
): CurrentMappingAuthority {
  if (
    current &&
    current.state === observation.state &&
    current.cloudRegisterSessionId === observation.cloudRegisterSessionId &&
    current.mappingId === observation.mappingId
  ) {
    return current;
  }

  return {
    ...observation,
    revision: (current?.revision ?? 0) + 1,
  };
}

async function advanceRegisterMappingAuthority(
  ctx: MutationCtx,
  subject: Pick<
    MappingInput,
    "storeId" | "terminalId" | "localRegisterSessionId"
  >,
  observation: MappingAuthorityObservation & { sourceEventType?: string },
) {
  const current = await ctx.db
    .query("posRegisterMappingAuthority")
    .withIndex("by_store_terminal_localRegisterSession", (q) =>
      q
        .eq("storeId", subject.storeId)
        .eq("terminalId", subject.terminalId)
        .eq("localRegisterSessionId", subject.localRegisterSessionId),
    )
    .unique();
  const next = buildNextRegisterMappingAuthority(current, observation);
  if (next === current) return current;

  const value = {
    storeId: subject.storeId,
    terminalId: subject.terminalId,
    localRegisterSessionId: subject.localRegisterSessionId,
    revision: next.revision,
    state: next.state,
    cloudRegisterSessionId: next.cloudRegisterSessionId,
    mappingId: next.mappingId,
    sourceEventType: observation.sourceEventType,
    updatedAt: Date.now(),
  };
  if (current) {
    await ctx.db.patch("posRegisterMappingAuthority", current._id, value);
    return { ...current, ...value };
  }

  const id = await ctx.db.insert("posRegisterMappingAuthority", value);
  return { _id: id, _creationTime: Date.now(), ...value };
}

export async function createPosLocalSyncMappingWithAuthority(
  ctx: MutationCtx,
  input: MappingInput,
) {
  const matches = await ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_local", (q) =>
      q
        .eq("storeId", input.storeId)
        .eq("terminalId", input.terminalId)
        .eq("localRegisterSessionId", input.localRegisterSessionId)
        .eq("localIdKind", input.localIdKind)
        .eq("localId", input.localId),
    )
    .take(2);
  if (matches.length > 1) {
    throw new Error("POS local sync mapping is ambiguous.");
  }
  const existing = matches[0] ?? null;
  if (existing) {
    if (
      existing.localEventId === input.localEventId &&
      existing.cloudTable === input.cloudTable &&
      existing.cloudId === input.cloudId
    ) {
      if (
        input.localIdKind === "registerSession" &&
        input.cloudTable === "registerSession"
      ) {
        await advanceRegisterMappingAuthority(ctx, input, {
          state: "mapped",
          cloudRegisterSessionId: input.cloudId,
          mappingId: existing._id,
          sourceEventType: input.sourceEventType,
        });
      }
      return existing;
    }
    throw new Error(
      "POS local sync mapping already belongs to another projection.",
    );
  }

  const id = await ctx.db.insert("posLocalSyncMapping", input);
  const mapping = { _id: id, ...input } as Doc<"posLocalSyncMapping">;
  if (
    input.localIdKind === "registerSession" &&
    input.cloudTable === "registerSession"
  ) {
    await advanceRegisterMappingAuthority(ctx, input, {
      state: "mapped",
      cloudRegisterSessionId: input.cloudId,
      mappingId: id,
      sourceEventType: input.sourceEventType,
    });
  }
  return mapping;
}

export async function tombstoneRegisterMappingAuthority(
  ctx: MutationCtx,
  subject: Pick<
    MappingInput,
    "storeId" | "terminalId" | "localRegisterSessionId"
  >,
) {
  return advanceRegisterMappingAuthority(ctx, subject, { state: "tombstoned" });
}

export async function markRegisterMappingAuthorityAmbiguous(
  ctx: MutationCtx,
  subject: Pick<
    MappingInput,
    "storeId" | "terminalId" | "localRegisterSessionId"
  >,
) {
  return advanceRegisterMappingAuthority(ctx, subject, { state: "ambiguous" });
}

export async function markRegisterMappingAuthorityMapped(
  ctx: MutationCtx,
  input: Pick<
    MappingInput,
    "storeId" | "terminalId" | "localRegisterSessionId"
  > & {
    cloudRegisterSessionId: string;
    mappingId: Id<"posLocalSyncMapping">;
    sourceEventType?: string;
  },
) {
  return advanceRegisterMappingAuthority(ctx, input, {
    state: "mapped",
    cloudRegisterSessionId: input.cloudRegisterSessionId,
    mappingId: input.mappingId,
    sourceEventType: input.sourceEventType,
  });
}
