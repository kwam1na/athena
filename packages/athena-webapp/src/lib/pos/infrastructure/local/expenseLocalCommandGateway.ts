import { ok, userError, type CommandResult } from "~/shared/commandResult";

import { projectExpenseLocalReadModel } from "./expenseReadModel";
import type {
  PosLocalAppendEventInput,
  PosLocalEventRecord,
  PosLocalEventValidationMetadata,
  PosLocalStoreResult,
} from "@/lib/pos/application/posLocalStoreTypes";

type ExpenseLocalCommandStore = {
  appendEvent(
    input: PosLocalAppendEventInput,
  ): Promise<PosLocalStoreResult<PosLocalEventRecord>>;
  listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
};

type CreateExpenseLocalCommandGatewayOptions = {
  store: ExpenseLocalCommandStore;
  clock?: () => number;
  createLocalId?: (kind: string) => string;
  onEventAppended?: () => void;
  staffProofToken?: string | ((staffProfileId: string) => string | undefined);
};

export type ExpenseLocalCommandResult<T> = CommandResult<T>;

export type ExpenseLocalCommandScope = {
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  staffProfileId: string;
  validationMetadata?: PosLocalEventValidationMetadata;
};

export type ExpenseLocalItemInput = {
  localExpenseSessionId: string;
  localItemId?: string;
  productId?: string;
  productSkuId: string;
  pendingCheckoutItemId?: string;
  inventoryImportProvisionalSkuId?: string;
  productSku?: string;
  barcode?: string;
  productName?: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  length?: number;
  color?: string;
};

export function createExpenseLocalCommandGateway(
  options: CreateExpenseLocalCommandGatewayOptions,
): {
  addItem(input: ExpenseLocalCommandScope & ExpenseLocalItemInput): Promise<boolean>;
  cancelSession(input: ExpenseLocalSessionCommandInput): Promise<boolean>;
  clearCart(input: ExpenseLocalSessionCommandInput): Promise<boolean>;
  completeExpense(input: CompleteExpenseLocalInput): Promise<boolean>;
  holdSession(input: ExpenseLocalSessionCommandInput): Promise<boolean>;
  removeItem(
    input: ExpenseLocalCommandScope &
      Pick<
        ExpenseLocalItemInput,
        | "inventoryImportProvisionalSkuId"
        | "localExpenseSessionId"
        | "localItemId"
        | "pendingCheckoutItemId"
        | "productSkuId"
      >,
  ): Promise<boolean>;
  resumeSession(input: ExpenseLocalSessionCommandInput): Promise<boolean>;
  startSession(
    input: ExpenseLocalCommandScope & { localExpenseSessionId?: string },
  ): Promise<
    ExpenseLocalCommandResult<{
      localExpenseSessionId: string;
      status: "active";
      startedAt: number;
    }>
  >;
  updateItem(input: ExpenseLocalCommandScope & ExpenseLocalItemInput): Promise<boolean>;
  voidSession(input: ExpenseLocalSessionCommandInput): Promise<boolean>;
} {
  const clock = options.clock ?? Date.now;
  const createLocalId =
    options.createLocalId ??
    ((kind: string) =>
      `${kind}-${clock()}-${Math.random().toString(36).slice(2)}`);

  async function append(input: PosLocalAppendEventInput) {
    const result = await options.store.appendEvent(input);
    if (!result.ok) return false;
    options.onEventAppended?.();
    return true;
  }

  async function readExpenseSession(localExpenseSessionId: string) {
    const result = await options.store.listEvents();
    if (!result.ok) return null;
    const model = projectExpenseLocalReadModel({ events: result.value });
    return (
      model.sessions.find(
        (session) => session.localExpenseSessionId === localExpenseSessionId,
      ) ?? null
    );
  }

  async function canMutate(localExpenseSessionId: string) {
    const session = await readExpenseSession(localExpenseSessionId);
    return (
      !session ||
      session.status === "active" ||
      session.status === "held"
    );
  }

  async function reopenPreCompletionClosedSession(
    input: ExpenseLocalCommandScope & { localExpenseSessionId: string },
  ) {
    const session = await readExpenseSession(input.localExpenseSessionId);
    if (session?.status !== "voided") {
      return false;
    }

    return append(
      baseInput(
        "expense.session_started",
        input,
        { status: "active", recoveredFromStatus: session.status },
      ),
    );
  }

  function baseInput(
    type: PosLocalAppendEventInput["type"],
    input: ExpenseLocalCommandScope & { localExpenseSessionId: string },
    payload: Record<string, unknown>,
  ): PosLocalAppendEventInput {
    return {
      type,
      terminalId: input.terminalId,
      storeId: input.storeId,
      registerNumber: input.registerNumber,
      localRegisterSessionId: input.localRegisterSessionId,
      localExpenseSessionId: input.localExpenseSessionId,
      staffProfileId: input.staffProfileId,
      validationMetadata: input.validationMetadata,
      payload: {
        localExpenseSessionId: input.localExpenseSessionId,
        ...payload,
      },
    };
  }

  return {
    async startSession(input) {
      if (!input.staffProfileId) {
        return userError({
          code: "unavailable",
          message: "Staff sign-in required before recording an expense.",
          retryable: true,
        });
      }

      const localExpenseSessionId =
        input.localExpenseSessionId ?? createLocalId("local-expense-session");
      const startedAt = clock();
      const appended = await append(
        baseInput(
          "expense.session_started",
          { ...input, localExpenseSessionId },
          { status: "active" },
        ),
      );
      if (!appended) {
        return userError({
          code: "unavailable",
          message: "Local expense recording is not ready on this terminal.",
          retryable: true,
        });
      }

      return ok({
        localExpenseSessionId,
        status: "active" as const,
        startedAt,
      });
    },

    async addItem(input) {
      if (
        !(await canMutate(input.localExpenseSessionId)) &&
        !(await reopenPreCompletionClosedSession(input))
      ) {
        return false;
      }
      return append(baseInput("expense.item_added", input, itemPayload(input)));
    },

    async updateItem(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append(baseInput("expense.item_updated", input, itemPayload(input)));
    },

    async removeItem(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append(
        baseInput("expense.item_removed", input, {
          localItemId: input.localItemId,
          productSkuId: input.productSkuId,
          pendingCheckoutItemId: input.pendingCheckoutItemId,
          inventoryImportProvisionalSkuId:
            input.inventoryImportProvisionalSkuId,
        }),
      );
    },

    async clearCart(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append(baseInput("expense.cart_cleared", input, reasonPayload(input)));
    },

    async holdSession(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append(baseInput("expense.held", input, reasonPayload(input)));
    },

    async resumeSession(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append(baseInput("expense.resumed", input, reasonPayload(input)));
    },

    async voidSession(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append(baseInput("expense.voided", input, reasonPayload(input)));
    },

    async cancelSession(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append(baseInput("expense.canceled", input, reasonPayload(input)));
    },

    async completeExpense(input) {
      if (!(await canMutate(input.localExpenseSessionId))) return false;
      return append({
        ...baseInput("expense.completed", input, {
          localExpenseEventId:
            input.localExpenseEventId ?? createLocalId("local-expense-event"),
          reason: input.reason,
          notes: input.notes,
          subtotal: input.subtotal,
          tax: input.tax,
          total: input.total,
          items: input.items?.map(itemPayload),
        }),
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId,
        ),
      });
    },
  };
}

export type ExpenseLocalSessionCommandInput = ExpenseLocalCommandScope & {
  localExpenseSessionId: string;
  reason?: string;
  notes?: string;
};

export type CompleteExpenseLocalInput = ExpenseLocalSessionCommandInput & {
  localExpenseEventId?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  items?: ExpenseLocalItemInput[];
};

function itemPayload(input: ExpenseLocalItemInput) {
  return {
    localExpenseSessionId: input.localExpenseSessionId,
    localExpenseItemId: input.localItemId,
    localItemId: input.localItemId,
    productId: input.productId,
    productSkuId: input.productSkuId,
    pendingCheckoutItemId: input.pendingCheckoutItemId,
    inventoryImportProvisionalSkuId: input.inventoryImportProvisionalSkuId,
    productSku: input.productSku,
    barcode: input.barcode,
    productName: input.productName,
    price: input.price,
    quantity: input.quantity,
    image: input.image,
    size: input.size,
    length: input.length,
    color: input.color,
  };
}

function reasonPayload(input: { reason?: string; notes?: string }) {
  return {
    reason: input.reason,
    notes: input.notes,
  };
}

function resolveStaffProofToken(
  staffProofToken: CreateExpenseLocalCommandGatewayOptions["staffProofToken"],
  staffProfileId: string,
) {
  return typeof staffProofToken === "function"
    ? staffProofToken(staffProfileId)
    : staffProofToken;
}
