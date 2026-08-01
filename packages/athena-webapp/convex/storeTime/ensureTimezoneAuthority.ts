import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertStoreTimezoneVersionCanBeInserted } from "./storeTimeAuthority";

const TIMEZONE_VERSION_READ_LIMIT = 100;

export function scheduleTimezoneContentHash(args: {
  effectiveFrom: number;
  timezone: string;
}) {
  return `store-timezone-v1:${encodeURIComponent(args.timezone)}:${args.effectiveFrom}`;
}

export async function listTimezoneVersionsForStoreWithCtx(
  ctx: Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  return await ctx.db
    .query("storeTimezoneVersion")
    .withIndex("by_storeId_effectiveFrom", (version) =>
      version.eq("storeId", storeId),
    )
    .take(TIMEZONE_VERSION_READ_LIMIT);
}

export async function ensureTimezoneAuthorityForScheduleWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    actorUserId: Id<"athenaUser">;
    schedule: Doc<"storeSchedule">;
  },
) {
  if (args.schedule.timezoneVersionId) {
    return {
      action: "reused" as const,
      timezoneVersionId: args.schedule.timezoneVersionId,
    };
  }

  const versions = await listTimezoneVersionsForStoreWithCtx(
    ctx,
    args.schedule.storeId,
  );
  const matching = versions
    .filter(
      (version) =>
        version.organizationId === args.schedule.organizationId &&
        version.timezone === args.schedule.timezone &&
        version.effectiveFrom <= args.schedule.effectiveFrom &&
        (version.effectiveTo === undefined ||
          args.schedule.effectiveFrom < version.effectiveTo),
    )
    .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0];

  if (matching) {
    await ctx.db.patch("storeSchedule", args.schedule._id, {
      timezoneVersionId: matching._id,
    });
    return {
      action: "reused" as const,
      timezoneVersionId: matching._id,
    };
  }

  if (versions.length > 0) {
    throw new Error(
      "Store schedule timezone conflicts with existing authority; explicit timezone authorization is required.",
    );
  }

  const candidate = {
    _id: "pending",
    organizationId: args.schedule.organizationId,
    storeId: args.schedule.storeId,
    timezone: args.schedule.timezone,
    effectiveFrom: args.schedule.effectiveFrom,
    contentHash: scheduleTimezoneContentHash(args.schedule),
    evidenceHash: `store-schedule:${args.schedule._id}`,
    source: "schedule_evidence" as const,
    authorizedByUserId: args.actorUserId,
    authorizedAt: args.schedule.createdAt,
    createdAt: Date.now(),
  };
  assertStoreTimezoneVersionCanBeInserted({
    candidate,
    existing: versions,
  });

  const timezoneVersionId = await ctx.db.insert("storeTimezoneVersion", {
    organizationId: candidate.organizationId,
    storeId: candidate.storeId,
    timezone: candidate.timezone,
    effectiveFrom: candidate.effectiveFrom,
    contentHash: candidate.contentHash,
    evidenceHash: candidate.evidenceHash,
    source: candidate.source,
    authorizedByUserId: candidate.authorizedByUserId,
    authorizedAt: candidate.authorizedAt,
    createdAt: candidate.createdAt,
  });
  await ctx.db.patch("storeSchedule", args.schedule._id, {
    timezoneVersionId,
  });

  return {
    action: "inserted" as const,
    timezoneVersionId,
  };
}
