import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { RecordPaymentAllocationArgs } from "../operations/paymentAllocations";
import {
  isPosUsableRegisterSessionStatus,
  POS_USABLE_REGISTER_SESSION_STATUSES,
  type RegisterSessionStatus,
} from "../../shared/registerSessionStatus";

type RegisterSessionAttributionCandidate = {
  _id: Id<"registerSession">;
  openedByStaffProfileId?: Id<"staffProfile">;
  openedByUserId?: Id<"athenaUser">;
  status: RegisterSessionStatus;
};
type InStorePayment = {
  amount: number;
  method: string;
  timestamp: number;
};

export function normalizeInStorePayments(args: {
  changeGiven?: number;
  payments: InStorePayment[];
}) {
  const normalizedPayments = args.payments.map((payment) => ({ ...payment }));
  let remainingChange = args.changeGiven ?? 0;

  for (let index = normalizedPayments.length - 1; index >= 0; index -= 1) {
    const payment = normalizedPayments[index];
    if (payment.method !== "cash" || remainingChange <= 0) {
      continue;
    }

    const appliedChange = Math.min(payment.amount, remainingChange);
    normalizedPayments[index] = {
      ...payment,
      amount: payment.amount - appliedChange,
    };
    remainingChange -= appliedChange;
  }

  return normalizedPayments.filter((payment) => payment.amount > 0);
}

export function buildInStorePaymentAllocations(
  args: Omit<
    RecordPaymentAllocationArgs,
    "amount" | "collectedInStore" | "direction" | "method"
  > & {
    changeGiven?: number;
    direction?: "in" | "out";
    externalReferencePrefix?: string;
    payments: InStorePayment[];
  }
) {
  const {
    changeGiven,
    externalReference,
    externalReferencePrefix,
    payments,
    ...baseArgs
  } = args;

  return normalizeInStorePayments({
    changeGiven,
    payments,
  }).map((payment, index) => ({
    ...baseArgs,
    amount: payment.amount,
    collectedInStore: true,
    direction: args.direction ?? "in",
    externalReference:
      externalReferencePrefix !== undefined
        ? `${externalReferencePrefix}:${index}`
        : externalReference,
    method: payment.method,
  }));
}

export function selectRegisterSessionForAttribution(args: {
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  registerSessionId?: Id<"registerSession">;
  sessions: RegisterSessionAttributionCandidate[];
}) {
  if (args.registerSessionId) {
    return args.registerSessionId;
  }

  const activeSessions = args.sessions.filter((session) =>
    isPosUsableRegisterSessionStatus(session.status)
  );

  if (args.actorStaffProfileId) {
    const staffSessions = activeSessions.filter(
      (session) => session.openedByStaffProfileId === args.actorStaffProfileId
    );

    if (staffSessions.length === 1) {
      return staffSessions[0]._id;
    }
  }

  if (args.actorUserId) {
    const userSessions = activeSessions.filter(
      (session) => session.openedByUserId === args.actorUserId
    );

    if (userSessions.length === 1) {
      return userSessions[0]._id;
    }
  }

  return activeSessions.length === 1 ? activeSessions[0]._id : undefined;
}

export async function resolveRegisterSessionForInStoreCollectionWithCtx(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
  }
) {
  if (args.registerSessionId) {
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    if (!isPosUsableRegisterSessionStatus(registerSession.status)) {
      throw new Error("Register session is not accepting new collections.");
    }

    return registerSession._id;
  }

  const sessions = (
    await Promise.all(
      POS_USABLE_REGISTER_SESSION_STATUSES.map((status) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- Store-scoped open/active session attribution needs the complete candidate set to avoid guessing across drawers.
        ctx.db
          .query("registerSession")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", status)
          )
          .collect()
      )
    )
  ).flat();

  return selectRegisterSessionForAttribution({
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    sessions,
  });
}
