import type { MutationCtx } from "../_generated/server";
import type { OperationAdmissionContext } from "../operationAdmission/types";
import { appendContextEventWithCtx } from "./contextEvents";

type AppendContextEvent = typeof appendContextEventWithCtx;

/**
 * Records what a shared-demo visitor actually did, from the one boundary every
 * migrated public write already passes through.
 *
 * Only admitted actions are captured here. A denied admission throws, and a
 * Convex mutation throw rolls back every write in the transaction, so a denial
 * event written at this point could never commit — denials are observed from
 * the browser instead. The same rollback rule means a row that survives here
 * belongs to an operation whose transaction committed.
 */
export function buildSharedDemoActionAppendArgs(
  admission: OperationAdmissionContext,
  now: number,
  occurrenceId: string = crypto.randomUUID(),
) {
  const actor = admission.actor as Extract<
    OperationAdmissionContext["actor"],
    { kind: "shared_demo" }
  >;

  return {
    storeId: actor.storeId,
    organizationId: actor.organizationId,
    surface: "shared_demo" as const,
    eventId: "shared_demo.action_admitted",
    schemaVersion: 1,
    // Each admitted action is its own occurrence: a visitor completing three
    // sales must show up as three, not one deduplicated row. The timestamp
    // alone is not enough — two admitted actions in the same millisecond would
    // produce the same key and the second would be dropped as a duplicate — so
    // the key carries a per-execution discriminator too.
    idempotencyKey: `shared-demo-action:${actor.authUserId}:${admission.operation.operationId}:${now}:${occurrenceId}`,
    occurredAt: now,
    payload: {
      operationId: admission.operation.operationId,
      capability:
        "capability" in admission.operation
          ? admission.operation.capability
          : admission.operation.access.intent,
    },
    actorRef: { kind: "guest" as const, id: actor.authUserId },
    visibilityMode: "support" as const,
    retentionClass: "standard" as const,
    abusePartitionKey: `shared-demo:${actor.authUserId}`,
    nonCompilable: true,
  };
}

export async function captureSharedDemoAdmittedActionWithCtx(
  ctx: Pick<MutationCtx, "db">,
  admission: OperationAdmissionContext,
  options: { append?: AppendContextEvent; now?: number } = {},
) {
  if (admission.actor.kind !== "shared_demo") return;

  const append = options.append ?? appendContextEventWithCtx;
  try {
    await append(
      ctx,
      buildSharedDemoActionAppendArgs(
        admission,
        options.now ?? Date.now(),
      ) as Parameters<AppendContextEvent>[1],
    );
  } catch {
    // Visibility must never decide whether a demo operation succeeds.
  }
}
