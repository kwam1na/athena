import type { Id, TableNames } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { ok, userError, type CommandResult } from "../../../../shared/commandResult";
import { isPosLocalSyncEventType } from "../../../../shared/posLocalSyncContract";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import { resolveReportingCalendarReferenceWithCtx } from "../../../reporting/operatingPeriods";
import { projectLocalSyncEvent } from "./projectLocalEvents";
import { patchRegisterSessionActivityFromLocalSyncWithCtx } from "./posRegisterSessionActivity";
import { hashPosLocalStaffProofToken } from "./staffProof";
import {
  verifyPosOfflineAuthorityReceiptForEvent,
  type OfflineAuthorityReceiptVerification,
} from "../offlineAuthorityReceipt";
import type {
  LocalSyncConflictRecord,
  LocalSyncCursorIdentity,
  LocalSyncEventRecord,
  LocalSyncIngestionRepository,
  LocalSyncMappingRecord,
  LocalSyncRepository,
  ParsedPosLocalSyncEventInput,
  PosLocalSaleItemInput,
  PosLocalSalePayload,
  PosLocalSyncEventInput,
  PosLocalSyncEventStatus,
  PosLocalSyncEventType,
  SyncProjectionRepository,
} from "./types";

export type PosLocalSyncBatchInput = {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  submittedByUserId?: Id<"athenaUser">;
  submittedAt: number;
  enforceOfflineAuthorityReceipt?: boolean;
  events: PosLocalSyncEventInput[];
};

export type PosLocalSyncEventOutcome = {
  localEventId: string;
  sequence: number;
  status: PosLocalSyncEventStatus;
};

export type PosLocalSyncHeldOutcome = {
  localEventId: string;
  sequence: number;
  code: "out_of_order";
  message: string;
};

export type PosLocalSyncResult = {
  accepted: PosLocalSyncEventOutcome[];
  held: PosLocalSyncHeldOutcome[];
  mappings: LocalSyncMappingRecord[];
  conflicts: LocalSyncConflictRecord[];
  syncCursor: {
    syncScope?: "pos" | "expense";
    localSyncCursorId?: string;
    localRegisterSessionId: string | null;
    localExpenseSessionId?: string | null;
    acceptedThroughSequence: number;
  };
};

function toSyncResultMapping(
  mapping: LocalSyncMappingRecord,
): LocalSyncMappingRecord {
  return {
    _id: mapping._id,
    storeId: mapping.storeId,
    terminalId: mapping.terminalId,
    localRegisterSessionId: mapping.localRegisterSessionId,
    localEventId: mapping.localEventId,
    localIdKind: mapping.localIdKind,
    localId: mapping.localId,
    cloudTable: mapping.cloudTable,
    cloudId: mapping.cloudId,
    createdAt: mapping.createdAt,
  };
}

function toSyncResultConflict(
  conflict: LocalSyncConflictRecord,
): LocalSyncConflictRecord {
  return {
    _id: conflict._id,
    storeId: conflict.storeId,
    terminalId: conflict.terminalId,
    localRegisterSessionId: conflict.localRegisterSessionId,
    localEventId: conflict.localEventId,
    sequence: conflict.sequence,
    conflictType: conflict.conflictType,
    status: conflict.status,
    summary: conflict.summary,
    details: conflict.details,
    createdAt: conflict.createdAt,
    ...(conflict.resolvedAt === undefined
      ? {}
      : { resolvedAt: conflict.resolvedAt }),
    ...(conflict.resolvedByStaffProfileId === undefined
      ? {}
      : { resolvedByStaffProfileId: conflict.resolvedByStaffProfileId }),
    ...(conflict.resolvedByUserId === undefined
      ? {}
      : { resolvedByUserId: conflict.resolvedByUserId }),
  };
}

// U9: how far a terminal `occurredAt` may lead server time before it is treated
// as clock skew. Legitimate offline lag is always in the past, so the forward
// tolerance is deliberately tight (5 minutes covers ordinary clock drift).
const POS_INGEST_FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export type ServerOperatingDateResolution =
  | { kind: "resolved"; operatingDate: string }
  | { kind: "missing_timezone_authority" }
  | { kind: "missing_store" }
  | { kind: "unavailable" };

/**
 * U9: server clock authority for the ingest trust boundary. Given only through
 * the ctx wrapper; when absent the service behaves exactly as before (so the
 * existing pure-service tests are unaffected). `resolveOperatingDate` is derived
 * from the store's versioned timezone authority + schedule and is therefore
 * deterministic for a fixed occurrence timestamp — the same event resolves to the
 * same operating date on every retry.
 */
export type ServerClockAuthority = {
  futureSkewToleranceMs: number;
  resolveOperatingDate: (args: {
    occurrenceAt: number;
    storeId: Id<"store">;
  }) => Promise<ServerOperatingDateResolution>;
};

type IngestionDependencies = {
  repository: LocalSyncIngestionRepository;
  projectionRepository: SyncProjectionRepository;
  now: () => number;
  serverClock?: ServerClockAuthority;
  offlineAuthorityVerifier?: (args: {
    eventOccurredAt: number;
    receipt?: string;
    storeId: string;
    terminalId: string;
  }) => Promise<OfflineAuthorityReceiptVerification>;
};

type ServerClockAttribution = Pick<
  LocalSyncEventRecord,
  "serverOccurredAt" | "serverOperatingDate" | "clockObservation"
>;

/**
 * Derive the server-authoritative business time and operating date for an event
 * at first ingest. The terminal-supplied `occurredAt`/payload are left untouched
 * (they drive `isSameLocalEvent`); the clamped/derived values are returned as
 * additive attribution stored on the accepted record. `serverTimeAt` is the
 * ingestion time, so the outcome is computed exactly once and stored — retries
 * reuse the persisted record and never recompute.
 */
async function assessServerClock(
  authority: ServerClockAuthority | undefined,
  args: {
    storeId: Id<"store">;
    occurredAt: number;
    serverTimeAt: number;
    eventType: PosLocalSyncEventType;
    terminalOperatingDate?: string;
    operatingDateOccurrenceAt?: number;
  },
): Promise<ServerClockAttribution> {
  if (!authority) {
    return {};
  }
  const futureBound = args.serverTimeAt + authority.futureSkewToleranceMs;
  // Only implausibly FUTURE timestamps are clamped; a plausibly old timestamp is
  // legitimate offline lag and is preserved.
  const occurredAtStatus =
    args.occurredAt > futureBound ? "future_skew_clamped" : "in_bounds";
  const serverOccurredAt =
    occurredAtStatus === "future_skew_clamped"
      ? args.serverTimeAt
      : args.occurredAt;

  let serverOperatingDate: string | undefined;
  let operatingDateStatus:
    | "terminal_matched"
    | "server_corrected"
    | "missing_timezone_authority"
    | undefined = undefined;

  if (
    args.eventType === "store_day_started" &&
    args.operatingDateOccurrenceAt !== undefined
  ) {
    const resolution = await authority.resolveOperatingDate({
      occurrenceAt: args.operatingDateOccurrenceAt,
      storeId: args.storeId,
    });
    if (resolution.kind === "resolved") {
      serverOperatingDate = resolution.operatingDate;
      operatingDateStatus =
        resolution.operatingDate === args.terminalOperatingDate
          ? "terminal_matched"
          : "server_corrected";
    } else if (
      resolution.kind === "missing_timezone_authority" ||
      resolution.kind === "missing_store"
    ) {
      // Defined missing-authority behavior: keep the terminal-supplied operating
      // date (preserve liveness) but flag it so it is never silently trusted.
      operatingDateStatus = "missing_timezone_authority";
    }
  }

  return {
    serverOccurredAt,
    ...(serverOperatingDate ? { serverOperatingDate } : {}),
    clockObservation: {
      serverTimeAt: args.serverTimeAt,
      occurredAtStatus,
      ...(operatingDateStatus ? { operatingDateStatus } : {}),
      ...(args.terminalOperatingDate
        ? { terminalOperatingDate: args.terminalOperatingDate }
        : {}),
    },
  };
}

const TERMINAL_NOT_PROVISIONED_MESSAGE =
  "This terminal is not provisioned for POS sync.";
const OFFLINE_AUTHORITY_REVIEW_SUMMARY =
  "Offline POS authority needs review before this event can be reconciled.";
const TERMINAL_INGESTION_PROJECTION_OPTIONS = {
  allowReviewedInventorySaleProjection: true,
  trustStoredStaffProof: true,
} as const;

export function createLocalSyncIngestionService(
  dependencies: IngestionDependencies,
) {
  return {
    async ingestBatch(
      batch: PosLocalSyncBatchInput,
    ): Promise<CommandResult<PosLocalSyncResult>> {
      const terminal = await dependencies.repository.getTerminal(
        batch.terminalId,
      );
      if (
        !terminal ||
        terminal.storeId !== batch.storeId ||
        terminal.status !== "active"
      ) {
        return userError({
          code: "precondition_failed",
          message: TERMINAL_NOT_PROVISIONED_MESSAGE,
        });
      }

      const accepted: PosLocalSyncEventOutcome[] = [];
      const held: PosLocalSyncHeldOutcome[] = [];
      const mappings: LocalSyncMappingRecord[] = [];
      const conflicts: LocalSyncConflictRecord[] = [];
      let cursorIdentity: LocalSyncCursorIdentity | null = batch.events[0]
        ? getLocalSyncCursorIdentity(batch.events[0])
        : null;
      const syncScopes = new Set(batch.events.map(getLocalSyncScope));
      if (syncScopes.size > 1) {
        return userError({
          code: "validation_failed",
          message: "POS sync batches cannot mix POS and expense events.",
        });
      }
      const unsupportedEvent = batch.events.find(
        (event) => !isPosLocalSyncEventType(event.eventType),
      );
      if (unsupportedEvent !== undefined) {
        return userError({
          code: "validation_failed",
          message: `Unsupported POS sync event type: ${String(unsupportedEvent.eventType)}.`,
        });
      }

      const orderedEvents = [...batch.events].sort(
        (left, right) => left.sequence - right.sequence,
      );
      const offlineAuthorityByEvent = new Map<
        PosLocalSyncEventInput,
        OfflineAuthorityReceiptVerification
      >();
      if (batch.enforceOfflineAuthorityReceipt) {
        if (!dependencies.offlineAuthorityVerifier) {
          return userError({
            code: "unavailable",
            message: "Offline POS authority could not be verified. Try again.",
            retryable: true,
          });
        }
        for (const event of orderedEvents) {
          const verification = await dependencies.offlineAuthorityVerifier({
            eventOccurredAt: event.occurredAt,
            receipt: event.offlineAuthorityReceipt,
            storeId: batch.storeId,
            terminalId: batch.terminalId,
          });
          offlineAuthorityByEvent.set(event, verification);
          if (verification.disposition === "infrastructure_failure") {
            return userError({
              code: "unavailable",
              message: "Offline POS authority could not be verified. Try again.",
              retryable: true,
            });
          }
          if (verification.disposition === "rejected") {
            return userError({
              code: "authorization_failed",
              message: "Offline POS authority is not valid for this upload.",
            });
          }
        }
      }

      const cursorIds = new Set(
        batch.events.map(
          (event) => getLocalSyncCursorIdentity(event).localSyncCursorId,
        ),
      );
      if (cursorIds.size > 1) {
        return userError({
          code: "validation_failed",
          message: "POS sync batches must contain one local sync cursor.",
        });
      }
      let acceptedThroughSequence =
        cursorIdentity === null
          ? 0
          : await dependencies.repository.getAcceptedThroughSequence({
              storeId: batch.storeId,
              terminalId: batch.terminalId,
              cursor: cursorIdentity,
            });

      for (const event of orderedEvents) {
        cursorIdentity = getLocalSyncCursorIdentity(event);
        const existing = await dependencies.repository.findEvent({
          storeId: batch.storeId,
          terminalId: batch.terminalId,
          localEventId: event.localEventId,
        });

        if (existing) {
          if (existing.status === "conflicted") {
            const existingConflicts =
              await dependencies.repository.listConflictsForEvent({
                storeId: batch.storeId,
                terminalId: batch.terminalId,
                localEventId: existing.localEventId,
              });
            const hasOfflineAuthorityReview = existingConflicts.some(
              (conflict) => conflict.conflictType === "offline_authority",
            );
            const hasStableServerRejectedReview =
              batch.enforceOfflineAuthorityReceipt &&
              existingConflicts.some(
                (conflict) => conflict.conflictType === "server_rejected",
              );
            if (hasOfflineAuthorityReview || hasStableServerRejectedReview) {
              const matchesOriginal = hasOfflineAuthorityReview
                ? (() => {
                    const retryParseResult = parseLocalSyncEvent(
                      dependencies.repository,
                      event,
                    );
                    return (
                      retryParseResult.ok &&
                      isSameLocalEvent(existing, retryParseResult.event)
                    );
                  })()
                : isSameLocalEvent(existing, event);
              if (!matchesOriginal) {
                return userError({
                  code: "validation_failed",
                  message:
                    "POS sync event retry does not match the original local event.",
                });
              }
              accepted.push({
                localEventId: existing.localEventId,
                sequence: existing.sequence,
                status: "conflicted",
              });
              conflicts.push(...existingConflicts);
              acceptedThroughSequence = advanceAcceptedThroughSequence(
                acceptedThroughSequence,
                existing,
              );
              continue;
            }
          }
          if (
            existing.status !== "held" ||
            existing.heldReason !== "out_of_order"
          ) {
            if (existing.status === "rejected") {
              if (!(await isSameLocalEvent(existing, event))) {
                return userError({
                  code: "validation_failed",
                  message:
                    "POS sync event retry does not match the original local event.",
                });
              }
              if (batch.enforceOfflineAuthorityReceipt) {
                const existingConflicts =
                  await dependencies.repository.listConflictsForEvent({
                    storeId: batch.storeId,
                    terminalId: batch.terminalId,
                    localEventId: existing.localEventId,
                  });
                const reviewConflicts = existingConflicts.filter(
                  (conflict) => conflict.status === "needs_review",
                );
                if (reviewConflicts.length > 0) {
                  await dependencies.repository.patchEvent(existing._id, {
                    acceptedAt: existing.acceptedAt ?? dependencies.now(),
                    status: "conflicted",
                    submittedAt: batch.submittedAt,
                  });
                  accepted.push({
                    localEventId: existing.localEventId,
                    sequence: existing.sequence,
                    status: "conflicted",
                  });
                  conflicts.push(...reviewConflicts);
                  acceptedThroughSequence = advanceAcceptedThroughSequence(
                    acceptedThroughSequence,
                    { sequence: existing.sequence, status: "conflicted" },
                  );
                }
                continue;
              }
            } else {
              const retryParseResult = parseLocalSyncEvent(
                dependencies.repository,
                event,
              );
              if (
                !retryParseResult.ok ||
                !(await isSameLocalEvent(existing, retryParseResult.event))
              ) {
                return userError({
                  code: "validation_failed",
                  message:
                    "POS sync event retry does not match the original local event.",
                });
              }

              if (existing.status === "conflicted") {
                const acceptedAt = existing.acceptedAt ?? dependencies.now();
                const projection = await projectLocalSyncEvent(
                  dependencies.projectionRepository,
                  {
                    storeId: batch.storeId,
                    terminalId: batch.terminalId,
                    event: retryParseResult.event,
                    syncEventId: existing._id,
                    submittedByUserId: batch.submittedByUserId,
                    now: acceptedAt,
                    serverOperatingDate: existing.serverOperatingDate,
                    options: TERMINAL_INGESTION_PROJECTION_OPTIONS,
                  },
                );
                if (
                  projection.status === "projected" &&
                  projection.conflicts.length === 0
                ) {
                  await dependencies.repository.resolveConflictsForEvent({
                    storeId: batch.storeId,
                    terminalId: batch.terminalId,
                    localEventId: existing.localEventId,
                    resolvedAt: dependencies.now(),
                  });
                }
                await dependencies.repository.patchEvent(existing._id, {
                  status: projection.status,
                  projectedAt: dependencies.now(),
                  submittedAt: batch.submittedAt,
                });
                accepted.push({
                  localEventId: existing.localEventId,
                  sequence: existing.sequence,
                  status: projection.status,
                });
                mappings.push(...projection.mappings);
                conflicts.push(...projection.conflicts);
                acceptedThroughSequence = advanceAcceptedThroughSequence(
                  acceptedThroughSequence,
                  {
                    sequence: existing.sequence,
                    status: projection.status,
                  },
                );
                continue;
              }

              if (
                existing.status === "projected" &&
                retryParseResult.event.eventType === "sale_completed"
              ) {
                const acceptedAt = existing.acceptedAt ?? dependencies.now();
                const projection = await projectLocalSyncEvent(
                  dependencies.projectionRepository,
                  {
                    storeId: batch.storeId,
                    terminalId: batch.terminalId,
                    event: retryParseResult.event,
                    syncEventId: existing._id,
                    submittedByUserId: batch.submittedByUserId,
                    now: acceptedAt,
                    serverOperatingDate: existing.serverOperatingDate,
                    options: TERMINAL_INGESTION_PROJECTION_OPTIONS,
                  },
                );
                if (
                  projection.status === "projected" &&
                  projection.conflicts.length === 0
                ) {
                  await dependencies.repository.patchEvent(existing._id, {
                    projectedAt: dependencies.now(),
                    submittedAt: batch.submittedAt,
                  });
                  accepted.push({
                    localEventId: existing.localEventId,
                    sequence: existing.sequence,
                    status: "projected",
                  });
                  mappings.push(...projection.mappings);
                  acceptedThroughSequence = advanceAcceptedThroughSequence(
                    acceptedThroughSequence,
                    existing,
                  );
                  continue;
                }
              }
            }

            accepted.push({
              localEventId: existing.localEventId,
              sequence: existing.sequence,
              status: existing.status,
            });
            mappings.push(
              ...(await dependencies.repository.listMappingsForEvent({
                storeId: batch.storeId,
                terminalId: batch.terminalId,
                localEventId: existing.localEventId,
              })),
            );
            conflicts.push(
              ...(await dependencies.repository.listConflictsForEvent({
                storeId: batch.storeId,
                terminalId: batch.terminalId,
                localEventId: existing.localEventId,
              })),
            );
            acceptedThroughSequence = advanceAcceptedThroughSequence(
              acceptedThroughSequence,
              existing,
            );
            continue;
          }

          if (!(await isSameLocalEvent(existing, event))) {
            return userError({
              code: "validation_failed",
              message:
                "POS sync event retry does not match the original local event.",
            });
          }
        }

        const preparedEvent = prepareLocalSyncEventForProjection({
          existing,
          event,
          expectedSequence: acceptedThroughSequence + 1,
          repository: dependencies.repository,
        });

        if (preparedEvent.kind === "held") {
          const heldEvent =
            existing ??
            (await dependencies.repository.createEvent(
              await buildLocalSyncEventRecordInput(batch, event, {
                status: "held",
                heldReason: "out_of_order",
                acceptedAt: dependencies.now(),
              }),
            ));
          held.push({
            localEventId: heldEvent.localEventId,
            sequence: heldEvent.sequence,
            code: "out_of_order",
            message: "Earlier POS history must sync before this event.",
          });
          continue;
        }

        if (preparedEvent.kind === "rejected") {
          const rejectedEvent =
            existing ??
            (await dependencies.repository.createEvent(
              await buildLocalSyncEventRecordInput(batch, event, {
                status: "rejected",
                rejectionCode: "validation_failed",
                rejectionMessage: preparedEvent.message,
              }),
            ));
          if (existing) {
            await dependencies.repository.patchEvent(existing._id, {
              status: "rejected",
              rejectionCode: "validation_failed",
              rejectionMessage: preparedEvent.message,
            });
          }
          // A money-bearing sale that the server rejects would otherwise
          // vanish with the drawer left short and nobody notified. Surface it
          // as a manager-visible conflict while keeping the cursor advancing.
          // Non-financial rejects stay silent to avoid conflict spam.
          if (isMoneyBearingRejectedSaleEvent(event)) {
            const rejectedCursorIdentity = getLocalSyncCursorIdentity(event);
            const rejectedAmount = summarizeRejectedSaleAmount(event);
            const rejectedLocalTransactionId = optionalString(
              (event.payload as Record<string, unknown>).localTransactionId,
            );
            const serverRejectedConflict =
              await dependencies.repository.createConflict({
                storeId: batch.storeId,
                terminalId: batch.terminalId,
                localRegisterSessionId:
                  rejectedCursorIdentity.localSyncCursorId,
                localEventId: event.localEventId,
                sequence: event.sequence,
                conflictType: "server_rejected",
                status: "needs_review",
                summary: SERVER_REJECTED_SALE_CONFLICT_SUMMARY,
                details: {
                  code: "server_rejected",
                  reason: preparedEvent.message,
                  localEventId: event.localEventId,
                  localRegisterSessionId:
                    rejectedCursorIdentity.localSyncCursorId,
                  ...(rejectedAmount === undefined
                    ? {}
                    : { amount: rejectedAmount }),
                  ...(rejectedLocalTransactionId
                    ? { localTransactionId: rejectedLocalTransactionId }
                    : {}),
                },
                createdAt: dependencies.now(),
              });
            conflicts.push(serverRejectedConflict);
            if (batch.enforceOfflineAuthorityReceipt) {
              await dependencies.repository.patchEvent(rejectedEvent._id, {
                acceptedAt: rejectedEvent.acceptedAt ?? dependencies.now(),
                status: "conflicted",
              });
              accepted.push({
                localEventId: rejectedEvent.localEventId,
                sequence: rejectedEvent.sequence,
                status: "conflicted",
              });
              acceptedThroughSequence = advanceAcceptedThroughSequence(
                acceptedThroughSequence,
                { sequence: event.sequence, status: "conflicted" },
              );
            }
          }
          if (!batch.enforceOfflineAuthorityReceipt) {
            accepted.push({
              localEventId: rejectedEvent.localEventId,
              sequence: rejectedEvent.sequence,
              status: "rejected",
            });
            acceptedThroughSequence = advanceAcceptedThroughSequence(
              acceptedThroughSequence,
              { sequence: event.sequence, status: "rejected" },
            );
          }
          continue;
        }

        const parsedEvent = preparedEvent.event;
        const offlineAuthority = offlineAuthorityByEvent.get(event);
        if (offlineAuthority?.disposition === "needs_review") {
          const acceptedAt = existing?.acceptedAt ?? dependencies.now();
          const syncEvent =
            existing ??
            (await dependencies.repository.createEvent(
              await buildLocalSyncEventRecordInput(batch, event, {
                payload: parsedEvent.payload,
                status: "conflicted",
                acceptedAt,
              }),
            ));
          if (existing) {
            await dependencies.repository.patchEvent(existing._id, {
              payload: parsedEvent.payload,
              status: "conflicted",
              submittedAt: batch.submittedAt,
              acceptedAt,
              heldReason: undefined,
            });
          }
          const reviewConflict = await dependencies.repository.createConflict({
            storeId: batch.storeId,
            terminalId: batch.terminalId,
            localRegisterSessionId:
              getLocalSyncCursorIdentity(event).localSyncCursorId,
            localEventId: event.localEventId,
            sequence: event.sequence,
            conflictType: "offline_authority",
            status: "needs_review",
            summary: OFFLINE_AUTHORITY_REVIEW_SUMMARY,
            details: {
              reason: offlineAuthority.reason,
              localEventId: event.localEventId,
              ...(offlineAuthority.payload
                ? {
                    receiptVersion: offlineAuthority.payload.version,
                    receiptNonce: offlineAuthority.payload.nonce,
                    keyVersion: offlineAuthority.payload.keyVersion,
                  }
                : {}),
            },
            createdAt: acceptedAt,
          });
          await dependencies.repository.patchEvent(syncEvent._id, {
            status: "conflicted",
          });
          accepted.push({
            localEventId: event.localEventId,
            sequence: event.sequence,
            status: "conflicted",
          });
          conflicts.push(reviewConflict);
          acceptedThroughSequence = advanceAcceptedThroughSequence(
            acceptedThroughSequence,
            { sequence: event.sequence, status: "conflicted" },
          );
          continue;
        }
        const acceptedAt = existing?.acceptedAt ?? dependencies.now();
        // U9: derive server-authoritative clock attribution exactly once, at first
        // ingest. Retries reuse the persisted values so the outcome is stable and
        // `isSameLocalEvent` (which ignores these fields) still matches.
        const clockAttribution: ServerClockAttribution = existing
          ? {
              serverOccurredAt: existing.serverOccurredAt,
              serverOperatingDate: existing.serverOperatingDate,
              clockObservation: existing.clockObservation,
            }
          : await assessServerClock(dependencies.serverClock, {
              storeId: batch.storeId,
              occurredAt: event.occurredAt,
              serverTimeAt: acceptedAt,
              eventType: parsedEvent.eventType,
              terminalOperatingDate:
                parsedEvent.eventType === "store_day_started"
                  ? (parsedEvent.payload.operatingDate as string)
                  : undefined,
              operatingDateOccurrenceAt:
                parsedEvent.eventType === "store_day_started"
                  ? (parsedEvent.payload.startAt as number)
                  : undefined,
            });
        const syncEvent =
          existing ??
          (await dependencies.repository.createEvent(
            await buildLocalSyncEventRecordInput(batch, event, {
              payload: parsedEvent.payload,
              status: "accepted",
              acceptedAt,
              ...clockAttribution,
            }),
          ));
        if (existing) {
          await dependencies.repository.patchEvent(existing._id, {
            occurredAt: event.occurredAt,
            staffProfileId: event.staffProfileId,
            syncScope: getLocalSyncScope(event),
            localRegisterSessionId:
              getLocalSyncCursorIdentity(event).localSyncCursorId,
            ...(getLocalSyncScope(event) === "expense"
              ? { localExpenseSessionId: event.localExpenseSessionId ?? "" }
              : {}),
            sequence: event.sequence,
            payload: parsedEvent.payload,
            status: "accepted",
            submittedAt: batch.submittedAt,
            acceptedAt,
            heldReason: undefined,
          });
        }

        const projection = await projectLocalSyncEvent(
          dependencies.projectionRepository,
          {
            storeId: batch.storeId,
            terminalId: batch.terminalId,
            event: parsedEvent,
            syncEventId: syncEvent._id,
            submittedByUserId: batch.submittedByUserId,
            now: acceptedAt,
            // U9: the store-day projector persists this server-derived operating
            // date instead of the terminal-supplied one when they diverge.
            serverOperatingDate: clockAttribution.serverOperatingDate,
            options: TERMINAL_INGESTION_PROJECTION_OPTIONS,
          },
        );
        const finalStatus = projection.status;
        await dependencies.repository.patchEvent(syncEvent._id, {
          status: finalStatus,
          projectedAt: dependencies.now(),
        });

        accepted.push({
          localEventId: event.localEventId,
          sequence: event.sequence,
          status: finalStatus,
        });
        mappings.push(...projection.mappings);
        conflicts.push(...projection.conflicts);
        acceptedThroughSequence = advanceAcceptedThroughSequence(
          acceptedThroughSequence,
          {
            sequence: event.sequence,
            status: projection.status,
          },
        );
      }

      if (cursorIdentity !== null) {
        await dependencies.repository.updateAcceptedThroughSequence({
          storeId: batch.storeId,
          terminalId: batch.terminalId,
          cursor: cursorIdentity,
          acceptedThroughSequence,
          updatedAt: dependencies.now(),
        });
      }

      return ok({
        accepted,
        held,
        mappings: mappings.map(toSyncResultMapping),
        conflicts: conflicts.map(toSyncResultConflict),
        syncCursor: {
          ...(cursorIdentity
            ? {
                syncScope: cursorIdentity.syncScope,
                localSyncCursorId: cursorIdentity.localSyncCursorId,
              }
            : {}),
          localRegisterSessionId:
            cursorIdentity?.localRegisterSessionId ??
            cursorIdentity?.localSyncCursorId ??
            null,
          ...(cursorIdentity?.syncScope === "expense"
            ? {
                localExpenseSessionId:
                  cursorIdentity.localExpenseSessionId ?? null,
              }
            : {}),
          acceptedThroughSequence,
        },
      });
    },
  };
}

type PreparedLocalSyncEvent =
  | { kind: "accepted"; event: ParsedPosLocalSyncEventInput }
  | { kind: "held" }
  | { kind: "rejected"; message: string };

function getLocalSyncScope(event: PosLocalSyncEventInput): "pos" | "expense" {
  return event.syncScope === "expense" || event.eventType === "expense_recorded"
    ? "expense"
    : "pos";
}

function getLocalSyncCursorIdentity(
  event: PosLocalSyncEventInput,
): LocalSyncCursorIdentity {
  const syncScope = getLocalSyncScope(event);
  if (syncScope === "expense") {
    const localExpenseSessionId = event.localExpenseSessionId ?? "";
    return {
      syncScope,
      localSyncCursorId: localExpenseSessionId,
      localExpenseSessionId,
    };
  }

  const localRegisterSessionId = event.localRegisterSessionId ?? "";
  return {
    syncScope,
    localSyncCursorId: localRegisterSessionId,
    localRegisterSessionId,
  };
}

const SERVER_REJECTED_SALE_CONFLICT_SUMMARY =
  "Server rejected a completed sale during sync. Reconcile the drawer before closing.";

function isMoneyBearingRejectedSaleEvent(
  event: PosLocalSyncEventInput,
): boolean {
  if (event.eventType !== "sale_completed") {
    return false;
  }
  const payments = (event.payload as { payments?: unknown } | undefined)
    ?.payments;
  return Array.isArray(payments) && payments.length > 0;
}

function summarizeRejectedSaleAmount(
  event: PosLocalSyncEventInput,
): number | undefined {
  const payload = event.payload as
    | { payments?: unknown; totals?: { total?: unknown } }
    | undefined;
  const payments = payload?.payments;
  if (Array.isArray(payments)) {
    let sum = 0;
    let sawAmount = false;
    for (const payment of payments) {
      if (isRecord(payment) && isNonNegativeFiniteNumber(payment.amount)) {
        sum += payment.amount;
        sawAmount = true;
      }
    }
    if (sawAmount) {
      return sum;
    }
  }
  const total = payload?.totals?.total;
  return isNonNegativeFiniteNumber(total) ? total : undefined;
}

function prepareLocalSyncEventForProjection(input: {
  existing: LocalSyncEventRecord | null;
  event: PosLocalSyncEventInput;
  expectedSequence: number;
  repository: LocalSyncIngestionRepository;
}): PreparedLocalSyncEvent {
  const envelopeMessage = validateLocalSyncEventEnvelope(input.event);
  if (envelopeMessage) {
    return { kind: "rejected", message: envelopeMessage };
  }

  if (input.event.sequence !== input.expectedSequence) {
    return { kind: "held" };
  }

  const parseResult = parseLocalSyncEvent(input.repository, input.event);
  if (!parseResult.ok) {
    return { kind: "rejected", message: parseResult.message };
  }

  return { kind: "accepted", event: parseResult.event };
}

async function buildLocalSyncEventRecordInput(
  batch: PosLocalSyncBatchInput,
  event: PosLocalSyncEventInput,
  patch: Pick<LocalSyncEventRecord, "status"> &
    Partial<Omit<LocalSyncEventRecord, "_id" | "status">>,
): Promise<Omit<LocalSyncEventRecord, "_id">> {
  return {
    storeId: batch.storeId,
    terminalId: batch.terminalId,
    syncScope: getLocalSyncScope(event),
    localEventId: event.localEventId,
    localRegisterSessionId: getLocalSyncCursorIdentity(event).localSyncCursorId,
    ...(getLocalSyncScope(event) === "expense"
      ? { localExpenseSessionId: event.localExpenseSessionId ?? "" }
      : {}),
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    staffProfileId: event.staffProfileId,
    ...(event.staffProofToken
      ? {
          staffProofTokenHash: await hashPosLocalStaffProofToken(
            event.staffProofToken,
          ),
        }
      : {}),
    payload: event.payload,
    submittedAt: batch.submittedAt,
    ...patch,
  };
}

function validateLocalSyncEventEnvelope(
  event: PosLocalSyncEventInput,
): string | null {
  const scope = getLocalSyncScope(event);
  const localSyncIdentity = getLocalSyncCursorIdentity(event);
  if (!event.localEventId.trim() || !localSyncIdentity.localSyncCursorId.trim()) {
    if (scope === "expense") {
      return "Expense sync event is missing required local identifiers.";
    }
    return "POS sync event is missing required local identifiers.";
  }

  if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0) {
    return "POS sync event sequence is invalid.";
  }

  if (!Number.isFinite(event.occurredAt) || event.occurredAt <= 0) {
    return "POS sync event timestamp is invalid.";
  }

  return null;
}

function parseLocalSyncEvent(
  repository: LocalSyncIngestionRepository,
  event: PosLocalSyncEventInput,
):
  | { ok: true; event: ParsedPosLocalSyncEventInput }
  | { ok: false; message: string } {
  if (!isPosLocalSyncEventType(event.eventType)) {
    return {
      ok: false,
      message: `Unsupported POS sync event type: ${String(event.eventType)}.`,
    };
  }

  const payloadMessage = validateLocalSyncEventPayload(event);
  const referenceMessage =
    payloadMessage ?? validateLocalSyncEventReferences(repository, event);
  if (referenceMessage) {
    return { ok: false, message: referenceMessage };
  }

  if (event.eventType === "register_opened") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "pos",
        localRegisterSessionId: event.localRegisterSessionId ?? "",
        eventType: "register_opened",
        payload: {
          openingFloat: event.payload.openingFloat as number,
          registerNumber: optionalString(event.payload.registerNumber),
          notes: optionalString(event.payload.notes),
        },
      },
    };
  }

  if (event.eventType === "store_day_started") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "pos",
        localRegisterSessionId: event.localRegisterSessionId ?? "",
        eventType: "store_day_started",
        payload: {
          operatingDate: event.payload.operatingDate as string,
          startAt: event.payload.startAt as number,
          endAt: event.payload.endAt as number,
        },
      },
    };
  }

  if (event.eventType === "pending_checkout_item_defined") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "pos",
        localRegisterSessionId: event.localRegisterSessionId ?? "",
        eventType: "pending_checkout_item_defined",
        payload: parsePendingCheckoutItemDefinedPayload(event.payload),
      },
    };
  }

  if (event.eventType === "sale_completed") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "pos",
        localRegisterSessionId: event.localRegisterSessionId ?? "",
        eventType: "sale_completed",
        payload: parseSaleCompletedPayload(repository, event.payload),
      },
    };
  }

  if (event.eventType === "sale_cleared") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "pos",
        localRegisterSessionId: event.localRegisterSessionId ?? "",
        eventType: "sale_cleared",
        payload: {
          localPosSessionId: event.payload.localPosSessionId as string,
          reason: optionalString(event.payload.reason),
        },
      },
    };
  }

  if (event.eventType === "register_closed") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "pos",
        localRegisterSessionId: event.localRegisterSessionId ?? "",
        eventType: "register_closed",
        payload: {
          countedCash:
            event.payload.countedCash === undefined
              ? undefined
              : (event.payload.countedCash as number),
          notes: optionalString(event.payload.notes),
        },
      },
    };
  }

  if (event.eventType === "expense_recorded") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "expense",
        localExpenseSessionId: event.localExpenseSessionId ?? "",
        eventType: "expense_recorded",
        payload: {
          localExpenseSessionId: event.payload.localExpenseSessionId as string,
          localExpenseEventId: event.payload.localExpenseEventId as string,
          reason: optionalString(event.payload.reason),
          notes: optionalString(event.payload.notes),
          totals: totalsFromPayload(event.payload.totals),
          items: (Array.isArray(event.payload.items)
            ? event.payload.items
            : []
          ).map(toSaleItemInput),
        },
      },
    };
  }

  if (event.eventType === "register_reopened") {
    return {
      ok: true,
      event: {
        ...event,
        syncScope: "pos",
        localRegisterSessionId: event.localRegisterSessionId ?? "",
        eventType: "register_reopened",
        payload: {
          reason: optionalString(event.payload.reason),
        },
      },
    };
  }

  return {
    ok: false,
    message: `Unsupported POS sync event type: ${String(event.eventType)}.`,
  };
}

export function parseStoredLocalSyncEvent(
  repository: LocalSyncIngestionRepository,
  event: LocalSyncEventRecord,
):
  | { ok: true; event: ParsedPosLocalSyncEventInput }
  | { ok: false; message: string } {
  const envelopeMessage = validateLocalSyncEventEnvelope(event);
  if (envelopeMessage) {
    return { ok: false, message: envelopeMessage };
  }

  return parseLocalSyncEvent(repository, {
    syncScope: event.syncScope,
    localEventId: event.localEventId,
    localRegisterSessionId: event.localRegisterSessionId,
    localExpenseSessionId: event.localExpenseSessionId,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    staffProfileId: event.staffProfileId,
    payload: event.payload,
  });
}

function validateLocalSyncEventPayload(event: PosLocalSyncEventInput): string | null {
  if (event.eventType === "register_opened") {
    return validateRegisterOpenedPayload(event.payload);
  }

  if (event.eventType === "store_day_started") {
    const { operatingDate, startAt, endAt } = event.payload;
    if (
      typeof operatingDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(operatingDate) ||
      typeof startAt !== "number" ||
      !Number.isFinite(startAt) ||
      typeof endAt !== "number" ||
      !Number.isFinite(endAt) ||
      endAt <= startAt
    ) {
      return "POS store-day start payload is invalid.";
    }
    return null;
  }

  if (event.eventType === "pending_checkout_item_defined") {
    return validatePendingCheckoutItemDefinedPayload(event.payload);
  }

  if (event.eventType === "sale_completed") {
    return validateSaleCompletedPayload(event.payload);
  }

  if (event.eventType === "sale_cleared") {
    return validateSaleClearedPayload(event.payload);
  }

  if (event.eventType === "register_closed") {
    return validateRegisterClosedPayload(event.payload);
  }

  if (event.eventType === "expense_recorded") {
    return validateExpenseRecordedPayload(event);
  }

  if (event.eventType === "register_reopened") {
    return validateRegisterReopenedPayload(event.payload);
  }

  return `Unsupported POS sync event type: ${String(event.eventType)}.`;
}

function validateExpenseRecordedPayload(event: PosLocalSyncEventInput): string | null {
  if (event.eventType !== "expense_recorded") return null;
  const payload = event.payload;
  if (
    !isNonEmptyString(event.localExpenseSessionId) ||
    !isNonEmptyString(payload.localExpenseSessionId) ||
    !isNonEmptyString(payload.localExpenseEventId) ||
    payload.localExpenseSessionId !== event.localExpenseSessionId
  ) {
    return "Expense sync event is missing required local identifiers.";
  }

  if ("reason" in payload && !isOptionalNonEmptyString(payload.reason)) {
    return "Expense sync reason is invalid.";
  }

  if ("notes" in payload && !isOptionalNonEmptyString(payload.notes)) {
    return "Expense sync notes are invalid.";
  }

  const itemsMessage = validateExpenseRecordedItems(payload);
  if (itemsMessage) return itemsMessage;

  return null;
}

function validateExpenseRecordedItems(payload: Record<string, unknown>) {
  const items = payload.items;
  if (!Array.isArray(items) || items.length === 0) {
    return "Expense sync event has no line items.";
  }

  const totals = payload.totals;
  if (!isRecord(totals)) {
    return "Expense sync totals are invalid.";
  }

  if (
    !isNonNegativeFiniteNumber(totals.subtotal) ||
    !isNonNegativeFiniteNumber(totals.tax) ||
    !isNonNegativeFiniteNumber(totals.total)
  ) {
    return "Expense sync totals are invalid.";
  }

  const productSubtotal = items.reduce((sum, item) => {
    if (!isRecord(item)) return Number.NaN;
    if (
      !isNonEmptyString(item.productId) ||
      !isNonEmptyString(item.productSkuId) ||
      !isNonEmptyString(item.productName) ||
      !isOptionalString(item.productSku) ||
      !isOptionalNonEmptyString(item.localTransactionItemId) ||
      !isOptionalNonEmptyString(item.pendingCheckoutItemId) ||
      !isOptionalPendingCheckoutAliasState(item.pendingCheckoutAliasState) ||
      !isOptionalNonEmptyString(item.inventoryImportProvisionalSkuId) ||
      !isPositiveInteger(item.quantity) ||
      !isNonNegativeFiniteNumber(item.unitPrice)
    ) {
      return Number.NaN;
    }
    if (item.pendingCheckoutItemId && item.inventoryImportProvisionalSkuId) {
      return Number.NaN;
    }
    return sum + item.quantity * item.unitPrice;
  }, 0);

  if (!Number.isFinite(productSubtotal)) {
    return "Expense sync line items are invalid.";
  }

  const canonicalTotal = roundMoney(totals.subtotal + totals.tax);
  if (
    roundMoney(totals.subtotal) !== roundMoney(productSubtotal) ||
    roundMoney(totals.total) !== canonicalTotal
  ) {
    return "Expense sync totals do not match line items.";
  }

  return null;
}

function totalsFromPayload(value: unknown) {
  const totals = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  return {
    subtotal: numberOrZero(totals.subtotal),
    tax: numberOrZero(totals.tax),
    total: numberOrZero(totals.total),
  };
}

function toSaleItemInput(value: unknown): PosLocalSaleItemInput {
  const item = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  return {
    localTransactionItemId: optionalString(item.localTransactionItemId),
    productId: String(item.productId ?? ""),
    productSkuId: String(item.productSkuId ?? ""),
    pendingCheckoutItemId: optionalString(item.pendingCheckoutItemId),
    pendingCheckoutAliasState:
      item.pendingCheckoutAliasState === "linked_to_catalog"
        ? "linked_to_catalog"
        : undefined,
    inventoryImportProvisionalSkuId: optionalString(
      item.inventoryImportProvisionalSkuId,
    ),
    productName: String(item.productName ?? ""),
    productSku: String(item.productSku ?? ""),
    barcode: optionalString(item.barcode),
    quantity: numberOrZero(item.quantity),
    unitPrice: numberOrZero(item.unitPrice),
    image: optionalString(item.image),
  };
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function validateLocalSyncEventReferences(
  repository: LocalSyncIngestionRepository,
  event: PosLocalSyncEventInput,
): string | null {
  if (event.eventType !== "sale_completed") {
    return null;
  }

  const payload = event.payload;
  if (
    isNonEmptyString(payload.customerProfileId) &&
    !repository.normalizeCloudId("customerProfile", payload.customerProfileId)
  ) {
    return "POS sale customer reference is invalid.";
  }

  const items = payload.items;
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }

    if (
      !isPendingCheckoutLineWithoutTrustedAlias(item) &&
      !isNonEmptyString(item.inventoryImportProvisionalSkuId) &&
      isNonEmptyString(item.productId) &&
      !repository.normalizeCloudId("product", item.productId)
    ) {
      return "POS sale product reference is invalid.";
    }

    if (
      !isPendingCheckoutLineWithoutTrustedAlias(item) &&
      !isNonEmptyString(item.inventoryImportProvisionalSkuId) &&
      isNonEmptyString(item.productSkuId) &&
      !repository.normalizeCloudId("productSku", item.productSkuId)
    ) {
      return "POS sale product SKU reference is invalid.";
    }

    if (
      "pendingCheckoutItemId" in item &&
      !isOptionalNonEmptyString(item.pendingCheckoutItemId)
    ) {
      return "POS sale pending checkout item reference is invalid.";
    }

    if (
      "inventoryImportProvisionalSkuId" in item &&
      !isOptionalNonEmptyString(item.inventoryImportProvisionalSkuId)
    ) {
      return "POS sale provisional import row reference is invalid.";
    }
  }

  const serviceLines = payload.serviceLines;
  if (!Array.isArray(serviceLines)) {
    return null;
  }

  for (const line of serviceLines) {
    if (!isRecord(line)) {
      continue;
    }

    if (
      isNonEmptyString(line.serviceCatalogId) &&
      !repository.normalizeCloudId("serviceCatalog", line.serviceCatalogId)
    ) {
      return "POS sale service catalog reference is invalid.";
    }

    if (
      isNonEmptyString(line.existingServiceCaseId) &&
      !repository.normalizeCloudId("serviceCase", line.existingServiceCaseId)
    ) {
      return "POS sale service case reference is invalid.";
    }

    if (
      isNonEmptyString(line.customerProfileId) &&
      !repository.normalizeCloudId("customerProfile", line.customerProfileId)
    ) {
      return "POS sale service customer reference is invalid.";
    }
  }

  return null;
}

function validateRegisterOpenedPayload(payload: Record<string, unknown>) {
  if (!isNonNegativeFiniteNumber(payload.openingFloat)) {
    return "POS register opening float is invalid.";
  }

  if (
    !isOptionalNonEmptyString(payload.registerNumber) ||
    !isOptionalNonEmptyString(payload.notes)
  ) {
    return "POS register opening details are invalid.";
  }

  return null;
}

function validateRegisterClosedPayload(payload: Record<string, unknown>) {
  if (
    payload.countedCash !== undefined &&
    !isNonNegativeFiniteNumber(payload.countedCash)
  ) {
    return "POS register counted cash is invalid.";
  }

  if (!isOptionalNonEmptyString(payload.notes)) {
    return "POS register closeout notes are invalid.";
  }

  return null;
}

function validatePendingCheckoutItemDefinedPayload(
  payload: Record<string, unknown>,
) {
  if (
    !isNonEmptyString(payload.localPendingCheckoutItemId) ||
    !isNonEmptyString(payload.name)
  ) {
    return "POS pending checkout item is missing required local details.";
  }

  if (
    !isOptionalNonEmptyString(payload.lookupCode) ||
    !isNonNegativeFiniteNumber(payload.price) ||
    !isPositiveInteger(payload.quantitySold)
  ) {
    return "POS pending checkout item details are invalid.";
  }

  if (
    payload.searchContext !== undefined &&
    (!isRecord(payload.searchContext) ||
      !isOptionalString(payload.searchContext.query) ||
      !isPendingCheckoutSearchSource(payload.searchContext.source) ||
      !isPendingCheckoutSearchMatch(payload.searchContext.matched))
  ) {
    return "POS pending checkout item search context is invalid.";
  }

  if (
    payload.localMetadata !== undefined &&
    (!isRecord(payload.localMetadata) ||
      payload.localMetadata.schema !==
        "pos_pending_checkout_item_local_metadata_v1" ||
      !isPendingCheckoutMetadataSource(payload.localMetadata.source) ||
      !isOptionalBoolean(payload.localMetadata.reusedExistingPendingItem) ||
      !isOptionalBoolean(payload.localMetadata.createdOffline) ||
      !isPendingCheckoutAppSessionValidation(
        payload.localMetadata.appSessionValidation,
      ) ||
      !isPendingCheckoutCloudValidation(payload.localMetadata.cloudValidation))
  ) {
    return "POS pending checkout item local metadata is invalid.";
  }

  return null;
}

function validateSaleCompletedPayload(payload: Record<string, unknown>) {
  if (
    !isNonEmptyString(payload.localPosSessionId) ||
    !isNonEmptyString(payload.localTransactionId) ||
    !isNonEmptyString(payload.localReceiptNumber)
  ) {
    return "POS sale is missing required local identifiers.";
  }

  const totals = payload.totals;
  if (!isRecord(totals)) {
    return "POS sale totals are invalid.";
  }

  if (
    !isNonNegativeFiniteNumber(totals.subtotal) ||
    !isNonNegativeFiniteNumber(totals.tax) ||
    !isNonNegativeFiniteNumber(totals.total)
  ) {
    return "POS sale totals are invalid.";
  }

  const items = payload.items;
  const serviceLines = payload.serviceLines;
  if (!Array.isArray(items)) {
    return "POS sale has no line items.";
  }
  if (serviceLines !== undefined && !Array.isArray(serviceLines)) {
    return "POS sale service lines are invalid.";
  }
  if (items.length === 0 && (!Array.isArray(serviceLines) || serviceLines.length === 0)) {
    return "POS sale has no line items.";
  }

  const productSubtotal = items.reduce((sum, item) => {
    if (!isRecord(item)) return Number.NaN;
    if (
      !isNonEmptyString(item.productName) ||
      !isNonEmptyString(item.productId) ||
      !isNonEmptyString(item.productSkuId) ||
      !isOptionalNonEmptyString(item.pendingCheckoutItemId) ||
      !isOptionalPendingCheckoutAliasState(item.pendingCheckoutAliasState) ||
      !isOptionalString(item.productSku) ||
      !isOptionalNonEmptyString(item.localTransactionItemId) ||
      !isPositiveInteger(item.quantity) ||
      !isNonNegativeFiniteNumber(item.unitPrice)
    ) {
      return Number.NaN;
    }
    return sum + item.quantity * item.unitPrice;
  }, 0);
  const serviceSubtotal = (Array.isArray(serviceLines) ? serviceLines : []).reduce(
    (sum, line) => {
      if (!isRecord(line)) return Number.NaN;
      if (
        !isOptionalNonEmptyString(line.localServiceLineId) ||
        !isOptionalNonEmptyString(line.localServiceCaseId) ||
        !isOptionalNonEmptyString(line.existingServiceCaseId) ||
        !isNonEmptyString(line.serviceCatalogId) ||
        !isNonEmptyString(line.serviceCatalogName) ||
        !isServiceMode(line.serviceMode) ||
        !isServicePricingModel(line.pricingModel) ||
        !isPositiveInteger(line.quantity) ||
        !isNonNegativeFiniteNumber(line.unitPrice) ||
        !isNonNegativeFiniteNumber(line.totalPrice) ||
        !isOptionalFiniteNumber(line.catalogUpdatedAt) ||
        !isOptionalNonEmptyString(line.customerProfileId) ||
        roundMoney(line.quantity * line.unitPrice) !==
          roundMoney(line.totalPrice)
      ) {
        return Number.NaN;
      }
      return sum + line.totalPrice;
    },
    0,
  );
  const canonicalSubtotal = roundMoney(productSubtotal + serviceSubtotal);

  if (!Number.isFinite(productSubtotal) || !Number.isFinite(serviceSubtotal)) {
    return "POS sale line items are invalid.";
  }

  const canonicalTotal = roundMoney(totals.subtotal + totals.tax);
  if (
    roundMoney(totals.subtotal) !== canonicalSubtotal ||
    roundMoney(totals.total) !== canonicalTotal
  ) {
    return "POS sale totals do not match line items.";
  }

  const payments = payload.payments;
  if (!Array.isArray(payments) || payments.length === 0) {
    return "POS sale has no payment records.";
  }

  const invalidPayment = payments.some(
    (payment) =>
      !isRecord(payment) ||
      !isNonEmptyString(payment.method) ||
      !isOptionalNonEmptyString(payment.localPaymentId) ||
      !isNonNegativeFiniteNumber(payment.amount) ||
      !Number.isFinite(payment.timestamp),
  );
  if (invalidPayment) {
    return "POS sale payment records are invalid.";
  }

  const totalPaid = payments.reduce((sum, payment) => {
    if (
      !isRecord(payment) ||
      !isNonEmptyString(payment.method) ||
      !isOptionalNonEmptyString(payment.localPaymentId) ||
      !isNonNegativeFiniteNumber(payment.amount) ||
      !Number.isFinite(payment.timestamp)
    ) {
      return sum;
    }
    return sum + payment.amount;
  }, 0);

  const cashPaid = payments.reduce((sum, payment) => {
    if (
      !isRecord(payment) ||
      payment.method !== "cash" ||
      !isNonNegativeFiniteNumber(payment.amount)
    ) {
      return sum;
    }
    return sum + payment.amount;
  }, 0);
  const overpayment = roundMoney(totalPaid - totals.total);
  if (overpayment > 0 && roundMoney(cashPaid) < overpayment) {
    return "POS sale non-cash payments cannot exceed the sale total.";
  }

  if (
    !isOptionalNonEmptyString(payload.registerNumber) ||
    !isOptionalNonEmptyString(payload.receiptNumber) ||
    !isOptionalNonEmptyString(payload.customerProfileId)
  ) {
    return "POS sale optional identifiers are invalid.";
  }

  const customerInfo = payload.customerInfo;
  if (
    customerInfo !== undefined &&
    (!isRecord(customerInfo) ||
      !isOptionalNonEmptyString(customerInfo.name) ||
      !isOptionalNonEmptyString(customerInfo.email) ||
      !isOptionalNonEmptyString(customerInfo.phone))
  ) {
    return "POS sale customer details are invalid.";
  }

  return null;
}

function validateSaleClearedPayload(payload: Record<string, unknown>) {
  if (!isNonEmptyString(payload.localPosSessionId)) {
    return "POS sale clear is missing the local sale identifier.";
  }

  if (!isOptionalNonEmptyString(payload.reason)) {
    return "POS sale clear reason is invalid.";
  }

  return null;
}

function validateRegisterReopenedPayload(payload: Record<string, unknown>) {
  if (!isOptionalNonEmptyString(payload.reason)) {
    return "POS register reopen reason is invalid.";
  }

  return null;
}

function parseSaleCompletedPayload(
  repository: LocalSyncIngestionRepository,
  payload: Record<string, unknown>,
): PosLocalSalePayload {
  const totals = payload.totals as Record<string, unknown>;
  const customerInfo = isRecord(payload.customerInfo)
    ? {
        name: optionalString(payload.customerInfo.name),
        email: optionalString(payload.customerInfo.email),
        phone: optionalString(payload.customerInfo.phone),
      }
    : undefined;
  const customerProfileId = optionalString(payload.customerProfileId);

  return {
    localPosSessionId: payload.localPosSessionId as string,
    localTransactionId: payload.localTransactionId as string,
    localReceiptNumber: payload.localReceiptNumber as string,
    receiptNumber:
      optionalString(payload.receiptNumber) ?? (payload.localReceiptNumber as string),
    registerNumber: optionalString(payload.registerNumber),
    customerProfileId: customerProfileId
      ? repository.normalizeCloudId("customerProfile", customerProfileId) ??
        undefined
      : undefined,
    customerInfo:
      customerInfo &&
      (customerInfo.name || customerInfo.email || customerInfo.phone)
        ? customerInfo
        : undefined,
    totals: {
      subtotal: totals.subtotal as number,
      tax: totals.tax as number,
      total: totals.total as number,
    },
    items: (payload.items as Record<string, unknown>[]).map((item) => {
      const pendingCheckoutItemId = optionalString(item.pendingCheckoutItemId);
      const pendingCheckoutAliasState =
        item.pendingCheckoutAliasState === "linked_to_catalog"
          ? "linked_to_catalog" as const
          : undefined;
      const inventoryImportProvisionalSkuId = optionalString(
        item.inventoryImportProvisionalSkuId,
      );
      const isLinkedPendingCheckoutAlias =
        pendingCheckoutAliasState === "linked_to_catalog";

      return {
        localTransactionItemId: optionalString(item.localTransactionItemId),
        productId:
          (pendingCheckoutItemId && !isLinkedPendingCheckoutAlias) ||
          inventoryImportProvisionalSkuId
          ? (item.productId as string)
          : requireNormalizedCloudId(
              repository,
              "product",
              item.productId as string,
            ),
        productSkuId:
          (pendingCheckoutItemId && !isLinkedPendingCheckoutAlias) ||
          inventoryImportProvisionalSkuId
          ? (item.productSkuId as string)
          : requireNormalizedCloudId(
              repository,
              "productSku",
              item.productSkuId as string,
            ),
        pendingCheckoutItemId: pendingCheckoutItemId as
          | Id<"posPendingCheckoutItem">
          | undefined,
        pendingCheckoutAliasState,
        inventoryImportProvisionalSkuId,
        productName: item.productName as string,
        productSku: optionalDisplayString(item.productSku),
        barcode: optionalString(item.barcode),
        quantity: item.quantity as number,
        unitPrice: item.unitPrice as number,
        image: optionalString(item.image),
      };
    }),
    serviceLines: Array.isArray(payload.serviceLines)
      ? (payload.serviceLines as Record<string, unknown>[]).map((line) => {
          const existingServiceCaseId = optionalString(line.existingServiceCaseId);
          const customerProfileId = optionalString(line.customerProfileId);
          return {
            localServiceLineId: optionalString(line.localServiceLineId),
            localServiceCaseId: optionalString(line.localServiceCaseId),
            existingServiceCaseId: existingServiceCaseId
              ? repository.normalizeCloudId("serviceCase", existingServiceCaseId) ??
                undefined
              : undefined,
            serviceCatalogId: requireNormalizedCloudId(
              repository,
              "serviceCatalog",
              line.serviceCatalogId as string,
            ),
            serviceCatalogName: line.serviceCatalogName as string,
            serviceMode: line.serviceMode as never,
            pricingModel: line.pricingModel as never,
            quantity: line.quantity as number,
            unitPrice: line.unitPrice as number,
            totalPrice: line.totalPrice as number,
            catalogUpdatedAt:
              typeof line.catalogUpdatedAt === "number"
                ? line.catalogUpdatedAt
                : undefined,
            customerProfileId: customerProfileId
              ? repository.normalizeCloudId("customerProfile", customerProfileId) ??
                undefined
              : undefined,
          };
        })
      : undefined,
    payments: (payload.payments as Record<string, unknown>[]).map((payment) => ({
      localPaymentId: optionalString(payment.localPaymentId),
      method: payment.method as string,
      amount: payment.amount as number,
      timestamp: payment.timestamp as number,
    })),
  };
}

function parsePendingCheckoutItemDefinedPayload(
  payload: Record<string, unknown>,
) {
  const searchContext = isRecord(payload.searchContext)
    ? {
        query: optionalString(payload.searchContext.query),
        source: pendingCheckoutSearchSourceOrUndefined(
          payload.searchContext.source,
        ),
        matched: pendingCheckoutSearchMatchOrUndefined(
          payload.searchContext.matched,
        ),
      }
    : undefined;
  const localMetadata = isRecord(payload.localMetadata)
    ? {
        schema: "pos_pending_checkout_item_local_metadata_v1" as const,
        source: pendingCheckoutMetadataSourceOrUndefined(
          payload.localMetadata.source,
        ),
        reusedExistingPendingItem:
          typeof payload.localMetadata.reusedExistingPendingItem === "boolean"
            ? payload.localMetadata.reusedExistingPendingItem
            : undefined,
        createdOffline:
          typeof payload.localMetadata.createdOffline === "boolean"
            ? payload.localMetadata.createdOffline
            : undefined,
        appSessionValidation: pendingCheckoutAppSessionValidationOrUndefined(
          payload.localMetadata.appSessionValidation,
        ),
        cloudValidation:
          payload.localMetadata.cloudValidation === "uncertain"
            ? "uncertain" as const
            : undefined,
      }
    : undefined;

  return {
    localPendingCheckoutItemId: payload.localPendingCheckoutItemId as string,
    name: payload.name as string,
    lookupCode: optionalString(payload.lookupCode),
    searchContext:
      searchContext &&
      (searchContext.query || searchContext.source || searchContext.matched)
        ? searchContext
        : undefined,
    price: payload.price as number,
    quantitySold: payload.quantitySold as number,
    localMetadata,
  };
}

function requireNormalizedCloudId<TableName extends TableNames>(
  repository: LocalSyncIngestionRepository,
  tableName: TableName,
  value: string,
): Id<TableName> {
  const normalized = repository.normalizeCloudId(tableName, value);
  if (!normalized) {
    throw new Error(`Invalid ${tableName} id after POS sync validation.`);
  }
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalDisplayString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalPendingCheckoutAliasState(
  value: unknown,
): value is "linked_to_catalog" | undefined {
  return value === undefined || value === "linked_to_catalog";
}

function isPendingCheckoutLineWithoutTrustedAlias(
  item: Record<string, unknown>,
) {
  return (
    isNonEmptyString(item.pendingCheckoutItemId) &&
    item.pendingCheckoutAliasState !== "linked_to_catalog"
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isServiceMode(value: unknown) {
  return (
    value === "same_day" ||
    value === "consultation" ||
    value === "repair" ||
    value === "revamp"
  );
}

function isServicePricingModel(value: unknown) {
  return (
    value === "fixed" ||
    value === "starting_at" ||
    value === "quote_after_consultation"
  );
}

function isPendingCheckoutSearchSource(
  value: unknown,
): value is
  | undefined
  | "barcode"
  | "lookup_code"
  | "manual"
  | "catalog_search"
  | "unknown" {
  return (
    value === undefined ||
    value === "barcode" ||
    value === "lookup_code" ||
    value === "manual" ||
    value === "catalog_search" ||
    value === "unknown"
  );
}

function pendingCheckoutSearchSourceOrUndefined(value: unknown) {
  return isPendingCheckoutSearchSource(value) ? value : undefined;
}

function isPendingCheckoutSearchMatch(
  value: unknown,
): value is
  | undefined
  | "existing_product"
  | "pending_checkout_item"
  | "none"
  | "unknown" {
  return (
    value === undefined ||
    value === "existing_product" ||
    value === "pending_checkout_item" ||
    value === "none" ||
    value === "unknown"
  );
}

function pendingCheckoutSearchMatchOrUndefined(value: unknown) {
  return isPendingCheckoutSearchMatch(value) ? value : undefined;
}

function isPendingCheckoutMetadataSource(
  value: unknown,
): value is
  | undefined
  | "offline_search"
  | "online_search"
  | "manual_entry"
  | "unknown" {
  return (
    value === undefined ||
    value === "offline_search" ||
    value === "online_search" ||
    value === "manual_entry" ||
    value === "unknown"
  );
}

function pendingCheckoutMetadataSourceOrUndefined(value: unknown) {
  return isPendingCheckoutMetadataSource(value) ? value : undefined;
}

function isPendingCheckoutAppSessionValidation(
  value: unknown,
): value is undefined | "supported" | "unverified" {
  return (
    value === undefined ||
    value === "supported" ||
    value === "unverified"
  );
}

function pendingCheckoutAppSessionValidationOrUndefined(value: unknown) {
  return isPendingCheckoutAppSessionValidation(value) ? value : undefined;
}

function isPendingCheckoutCloudValidation(
  value: unknown,
): value is undefined | "uncertain" {
  return value === undefined || value === "uncertain";
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function advanceAcceptedThroughSequence(
  acceptedThroughSequence: number,
  event: Pick<LocalSyncEventRecord, "sequence" | "status">,
) {
  if (event.status === "held") {
    return acceptedThroughSequence;
  }

  return event.sequence === acceptedThroughSequence + 1
    ? event.sequence
    : acceptedThroughSequence;
}

function isSameLocalEvent(
  existing: LocalSyncEventRecord,
  incoming: PosLocalSyncEventInput,
) {
  const sequenceMatches =
    existing.sequence === incoming.sequence ||
    isRepairableHeldExpenseSequenceRetry(existing, incoming);

  return (
    (existing.syncScope ?? "pos") === getLocalSyncScope(incoming) &&
    existing.localRegisterSessionId ===
      getLocalSyncCursorIdentity(incoming).localSyncCursorId &&
    sequenceMatches &&
    existing.eventType === incoming.eventType &&
    existing.occurredAt === incoming.occurredAt &&
    existing.staffProfileId === incoming.staffProfileId &&
    canonicalJson(existing.payload) === canonicalJson(incoming.payload)
  );
}

function isRepairableHeldExpenseSequenceRetry(
  existing: LocalSyncEventRecord,
  incoming: PosLocalSyncEventInput,
) {
  return (
    existing.status === "held" &&
    existing.heldReason === "out_of_order" &&
    (existing.syncScope ?? "pos") === "expense" &&
    getLocalSyncScope(incoming) === "expense" &&
    existing.sequence > incoming.sequence
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
  );
}

export async function ingestLocalEventsWithCtx(
  ctx: MutationCtx,
  batch: PosLocalSyncBatchInput,
) {
  const repository = createConvexLocalSyncRepository(ctx);
  const result = await createLocalSyncIngestionService({
    repository,
    projectionRepository: repository,
    now: () => Date.now(),
    ...(batch.enforceOfflineAuthorityReceipt
      ? { offlineAuthorityVerifier: verifyPosOfflineAuthorityReceiptForEvent }
      : {}),
    serverClock: {
      futureSkewToleranceMs: POS_INGEST_FUTURE_SKEW_TOLERANCE_MS,
      resolveOperatingDate: async ({ occurrenceAt, storeId }) => {
        const reference = await resolveReportingCalendarReferenceWithCtx(ctx, {
          occurrenceAt,
          storeId,
        });
        if (reference.kind === "resolved") {
          return { kind: "resolved", operatingDate: reference.operatingDate };
        }
        if (reference.kind === "missing_store") {
          return { kind: "missing_store" };
        }
        // Any other non-resolved outcome (missing/invalid timezone authority or an
        // unresolvable schedule window) means the server cannot authoritatively
        // derive the operating date; fall back to the terminal value with a flag.
        return { kind: "missing_timezone_authority" };
      },
    },
  }).ingestBatch(batch);
  if (result.kind === "ok") {
    try {
      await patchRegisterSessionActivityFromLocalSyncWithCtx(ctx, {
        accepted: result.data.accepted,
        conflicts: result.data.conflicts,
        held: result.data.held,
        mappings: result.data.mappings,
        storeId: batch.storeId,
        terminalId: batch.terminalId,
      });
    } catch {
      // Activity replay is auxiliary evidence; never fail authoritative POS sync after core ingest succeeds.
    }
  }
  await repository.flushCatalogSummaryRefreshes?.();
  return result;
}
