import { isValidStoreTimezone } from "../lib/storeScheduleTime";

export type StoreTimezoneVersion = {
  _id: string;
  organizationId: string;
  storeId: string;
  timezone: string;
  effectiveFrom: number;
  effectiveTo?: number;
  contentHash: string;
  evidenceHash?: string;
  source: "admin_authorized" | "schedule_evidence" | "import";
  authorizedByUserId: string;
  authorizedAt: number;
  createdAt: number;
};

function includesOccurrence(
  version: Pick<StoreTimezoneVersion, "effectiveFrom" | "effectiveTo">,
  occurrenceAt: number,
) {
  return (
    version.effectiveFrom <= occurrenceAt &&
    (version.effectiveTo === undefined || occurrenceAt < version.effectiveTo)
  );
}

function localDate(occurrenceAt: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(occurrenceAt));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function intervalsOverlap(
  left: Pick<StoreTimezoneVersion, "effectiveFrom" | "effectiveTo">,
  right: Pick<StoreTimezoneVersion, "effectiveFrom" | "effectiveTo">,
) {
  const leftEnd = left.effectiveTo ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo ?? Number.POSITIVE_INFINITY;
  return left.effectiveFrom < rightEnd && right.effectiveFrom < leftEnd;
}

export function assertStoreTimezoneVersionCanBeInserted(args: {
  candidate: StoreTimezoneVersion;
  existing: StoreTimezoneVersion[];
}) {
  const { candidate } = args;
  if (!isValidStoreTimezone(candidate.timezone)) {
    throw new Error("Store timezone authority requires a valid IANA timezone");
  }
  if (!Number.isFinite(candidate.effectiveFrom)) {
    throw new Error("Store timezone authority requires a finite effectiveFrom");
  }
  if (
    candidate.effectiveTo !== undefined &&
    (!Number.isFinite(candidate.effectiveTo) ||
      candidate.effectiveTo <= candidate.effectiveFrom)
  ) {
    throw new Error("Store timezone effectiveTo must be after effectiveFrom");
  }
  if (!candidate.contentHash.trim()) {
    throw new Error("Store timezone authority requires an immutable content hash");
  }

  const overlap = args.existing.find(
    (version) =>
      version._id !== candidate._id &&
      version.organizationId === candidate.organizationId &&
      version.storeId === candidate.storeId &&
      intervalsOverlap(version, candidate),
  );
  if (overlap) {
    throw new Error(`Store timezone version overlaps ${overlap._id}`);
  }
}

export function resolveStoreTimeAuthority(args: {
  occurrenceAt: number;
  organizationId: string;
  storeId: string;
  versions: StoreTimezoneVersion[];
}) {
  const intervalMatches = args.versions.filter((version) =>
    includesOccurrence(version, args.occurrenceAt),
  );
  const scoped = intervalMatches.filter(
    (version) =>
      version.organizationId === args.organizationId &&
      version.storeId === args.storeId,
  );
  if (scoped.length === 0) {
    return {
      kind:
        intervalMatches.length > 0
          ? ("cross_store_timezone_authority" as const)
          : ("missing_timezone_authority" as const),
      occurrenceAt: args.occurrenceAt,
    };
  }
  if (scoped.length !== 1) {
    return {
      kind: "conflicting_timezone_authority" as const,
      occurrenceAt: args.occurrenceAt,
      timezoneVersionIds: scoped.map((version) => version._id).sort(),
    };
  }

  const version = scoped[0];
  if (!isValidStoreTimezone(version.timezone) || !version.contentHash.trim()) {
    return {
      kind: "invalid_timezone_authority" as const,
      occurrenceAt: args.occurrenceAt,
      timezoneVersionId: version._id,
    };
  }
  return {
    kind: "resolved" as const,
    occurrenceAt: args.occurrenceAt,
    reportingDate: localDate(args.occurrenceAt, version.timezone),
    timezone: version.timezone,
    timezoneVersionId: version._id,
    timezoneVersionHash: version.contentHash,
  };
}
