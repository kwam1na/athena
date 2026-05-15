import type { Id, TableNames } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { ok, userError, type CommandResult } from "../../../../shared/commandResult";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import { projectLocalSyncEvent } from "./projectLocalEvents";
import { hashPosLocalStaffProofToken } from "./staffProof";
import type {
  LocalSyncConflictRecord,
  LocalSyncEventRecord,
  LocalSyncIngestionRepository,
  LocalSyncMappingRecord,
  LocalSyncRepository,
  ParsedPosLocalSyncEventInput,
  PosLocalSalePayload,
  PosLocalSyncEventInput,
  PosLocalSyncEventStatus,
  SyncProjectionRepository,
} from "./types";

export type PosLocalSyncBatchInput = {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  submittedByUserId?: Id<"athenaUser">;
  submittedAt: number;
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
    localRegisterSessionId: string | null;
    acceptedThroughSequence: number;
  };
};

type IngestionDependencies = {
  repository: LocalSyncIngestionRepository;
  projectionRepository: SyncProjectionRepository;
  now: () => number;
};

const TERMINAL_NOT_PROVISIONED_MESSAGE =
  "This terminal is not provisioned for POS sync.";

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
      let cursorRegisterSessionId: string | null =
        batch.events[0]?.localRegisterSessionId ?? null;
      const registerSessionIds = new Set(
        batch.events.map((event) => event.localRegisterSessionId),
      );
      if (registerSessionIds.size > 1) {
        return userError({
          code: "validation_failed",
          message: "POS sync batches must contain one local register session.",
        });
      }
      let acceptedThroughSequence =
        cursorRegisterSessionId === null
          ? 0
          : await dependencies.repository.getAcceptedThroughSequence({
              storeId: batch.storeId,
              terminalId: batch.terminalId,
              localRegisterSessionId: cursorRegisterSessionId,
            });

      for (const event of [...batch.events].sort(
        (left, right) => left.sequence - right.sequence,
      )) {
        cursorRegisterSessionId = event.localRegisterSessionId;
        const existing = await dependencies.repository.findEvent({
          storeId: batch.storeId,
          terminalId: batch.terminalId,
          localEventId: event.localEventId,
        });

        if (existing) {
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
          accepted.push({
            localEventId: rejectedEvent.localEventId,
            sequence: rejectedEvent.sequence,
            status: "rejected",
          });
          acceptedThroughSequence = advanceAcceptedThroughSequence(
            acceptedThroughSequence,
            { sequence: event.sequence, status: "rejected" },
          );
          continue;
        }

        const parsedEvent = preparedEvent.event;
        const acceptedAt = existing?.acceptedAt ?? dependencies.now();
        const syncEvent =
          existing ??
          (await dependencies.repository.createEvent(
            await buildLocalSyncEventRecordInput(batch, event, {
              payload: parsedEvent.payload,
              status: "accepted",
              acceptedAt,
            }),
          ));
        if (existing) {
          await dependencies.repository.patchEvent(existing._id, {
            occurredAt: event.occurredAt,
            staffProfileId: event.staffProfileId,
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

      if (cursorRegisterSessionId !== null) {
        await dependencies.repository.updateAcceptedThroughSequence({
          storeId: batch.storeId,
          terminalId: batch.terminalId,
          localRegisterSessionId: cursorRegisterSessionId,
          acceptedThroughSequence,
          updatedAt: dependencies.now(),
        });
      }

      return ok({
        accepted,
        held,
        mappings,
        conflicts,
        syncCursor: {
          localRegisterSessionId: cursorRegisterSessionId,
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
    localEventId: event.localEventId,
    localRegisterSessionId: event.localRegisterSessionId,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    staffProfileId: event.staffProfileId,
    staffProofTokenHash: await hashPosLocalStaffProofToken(event.staffProofToken),
    payload: event.payload,
    submittedAt: batch.submittedAt,
    ...patch,
  };
}

function validateLocalSyncEventEnvelope(
  event: PosLocalSyncEventInput,
): string | null {
  if (!event.localEventId.trim() || !event.localRegisterSessionId.trim()) {
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
        eventType: "register_opened",
        payload: {
          openingFloat: event.payload.openingFloat as number,
          registerNumber: optionalString(event.payload.registerNumber),
          notes: optionalString(event.payload.notes),
        },
      },
    };
  }

  if (event.eventType === "sale_completed") {
    return {
      ok: true,
      event: {
        ...event,
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

  return {
    ok: true,
    event: {
      ...event,
      eventType: "register_reopened",
      payload: {
        reason: optionalString(event.payload.reason),
      },
    },
  };
}

function validateLocalSyncEventPayload(event: PosLocalSyncEventInput): string | null {
  if (event.eventType === "register_opened") {
    return validateRegisterOpenedPayload(event.payload);
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

  return validateRegisterReopenedPayload(event.payload);
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
      isNonEmptyString(item.productId) &&
      !repository.normalizeCloudId("product", item.productId)
    ) {
      return "POS sale product reference is invalid.";
    }

    if (
      isNonEmptyString(item.productSkuId) &&
      !repository.normalizeCloudId("productSku", item.productSkuId)
    ) {
      return "POS sale product SKU reference is invalid.";
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
  if (!Array.isArray(items) || items.length === 0) {
    return "POS sale has no line items.";
  }

  const canonicalSubtotal = roundMoney(
    items.reduce((sum, item) => {
      if (!isRecord(item)) return Number.NaN;
      if (
        !isNonEmptyString(item.productName) ||
        !isNonEmptyString(item.productId) ||
        !isNonEmptyString(item.productSkuId) ||
        !isOptionalString(item.productSku) ||
        !isOptionalNonEmptyString(item.localTransactionItemId) ||
        !isPositiveInteger(item.quantity) ||
        !isNonNegativeFiniteNumber(item.unitPrice)
      ) {
        return Number.NaN;
      }
      return sum + item.quantity * item.unitPrice;
    }, 0),
  );

  if (!Number.isFinite(canonicalSubtotal)) {
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
    items: (payload.items as Record<string, unknown>[]).map((item) => ({
      localTransactionItemId: optionalString(item.localTransactionItemId),
      productId: requireNormalizedCloudId(
        repository,
        "product",
        item.productId as string,
      ),
      productSkuId: requireNormalizedCloudId(
        repository,
        "productSku",
        item.productSkuId as string,
      ),
      productName: item.productName as string,
      productSku: optionalDisplayString(item.productSku),
      barcode: optionalString(item.barcode),
      quantity: item.quantity as number,
      unitPrice: item.unitPrice as number,
      image: optionalString(item.image),
    })),
    payments: (payload.payments as Record<string, unknown>[]).map((payment) => ({
      localPaymentId: optionalString(payment.localPaymentId),
      method: payment.method as string,
      amount: payment.amount as number,
      timestamp: payment.timestamp as number,
    })),
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

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
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
  return (
    existing.localRegisterSessionId === incoming.localRegisterSessionId &&
    existing.sequence === incoming.sequence &&
    existing.eventType === incoming.eventType &&
    existing.occurredAt === incoming.occurredAt &&
    existing.staffProfileId === incoming.staffProfileId &&
    canonicalJson(existing.payload) === canonicalJson(incoming.payload)
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
  return createLocalSyncIngestionService({
    repository,
    projectionRepository: repository,
    now: () => Date.now(),
  }).ingestBatch(batch);
}
