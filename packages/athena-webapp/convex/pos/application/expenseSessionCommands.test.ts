import { describe, expect, it } from "vitest";

type ExpenseSessionRecord = {
  _id: string;
  sessionNumber: string;
  storeId: string;
  terminalId: string;
  staffProfileId: string;
  registerNumber?: string;
  registerSessionId?: string;
  status: "active" | "held" | "completed" | "void" | "expired";
  expiresAt: number;
  updatedAt: number;
  createdAt: number;
  heldAt?: number;
  resumedAt?: number;
  notes?: string;
  workflowTraceId?: string;
};

type RegisterSessionRecord = {
  _id: string;
  storeId: string;
  status: "open" | "active" | "closing" | "closed";
  terminalId?: string;
  registerNumber?: string;
};

type ExpenseSessionItemRecord = {
  _id: string;
  sessionId: string;
  storeId: string;
  productId: string;
  productSkuId: string;
  productSku: string;
  productName: string;
  price: number;
  quantity: number;
  createdAt: number;
  updatedAt: number;
};

type InventoryCall =
  | { kind: "acquire"; skuId: string; quantity: number }
  | {
      kind: "adjust";
      skuId: string;
      oldQuantity: number;
      newQuantity: number;
    }
  | { kind: "release"; skuId: string; quantity: number };

type TraceCall = {
  stage: string;
  sessionId: string;
  sessionNumber: string;
  traceId?: string;
  itemName?: string;
  quantity?: number;
  previousQuantity?: number;
  itemCount?: number;
};

describe("createExpenseSessionCommandService", () => {
  it("records a started trace when creating a fresh expense session", async () => {
    const commandService = await loadCommandService();
    const traceCalls: TraceCall[] = [];
    const repository = createFakeRepository();

    const result = await commandService(
      createDependencies({
        repository,
        traceCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).startSession({
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "expense-session-1",
        expiresAt: 61_000,
      },
    });
    expect(traceCalls).toEqual([
      {
        stage: "started",
        sessionId: "expense-session-1",
        sessionNumber: "EXP-001",
        traceId: "expense_session:expense-session-1",
      },
    ]);
    expect(repository.sessions[0]).toEqual(
      expect.objectContaining({
        workflowTraceId: "expense_session:expense-session-1",
      }),
    );
  });

  it("creates a fresh active expense session without requiring a drawer binding", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-1",
          registerNumber: "1",
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).startSession({
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
      registerNumber: " 1 ",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "expense-session-1",
        expiresAt: 61_000,
      },
    });
    expect(repository.sessions).toContainEqual(
      expect.objectContaining({
        _id: "expense-session-1",
        sessionNumber: "EXP-001",
        status: "active",
        terminalId: "terminal-1",
        staffProfileId: "staff-1",
        registerNumber: "1",
        expiresAt: 61_000,
      }),
    );
    expect(repository.sessions[0]).not.toHaveProperty("registerSessionId");
  });

  it("creates an expense session even when the drawer is closing", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "closing",
          terminalId: "terminal-1",
          registerNumber: "1",
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).startSession({
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "drawer-1",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "expense-session-1",
        expiresAt: 61_000,
      },
    });
    expect(repository.sessions).toContainEqual(
      expect.objectContaining({
        _id: "expense-session-1",
        status: "active",
      }),
    );
    expect(repository.sessions[0]).not.toHaveProperty("registerSessionId");
    expect(repository.sessionPatches).toEqual([]);
  });

  it("binds a preserved active expense session to a matching drawer without clearing cart state", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "expense-session-7",
          sessionNumber: "EXP-007",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "staff-1",
          registerNumber: "1",
          status: "active",
          expiresAt: 10_000,
          updatedAt: 900,
          createdAt: 100,
          notes: "Damaged item",
        }),
      ],
      items: [
        buildItem({
          _id: "item-1",
          sessionId: "expense-session-7",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productSku: "SKU-1",
          productName: "Test product",
          price: 100,
          quantity: 2,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "active",
          terminalId: "terminal-1",
          registerNumber: "1",
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).bindSessionToRegisterSession({
      sessionId: "expense-session-7",
      staffProfileId: "staff-1",
      registerSessionId: "drawer-1",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "expense-session-7",
        expiresAt: 61_000,
      },
    });
    expect(repository.getSession("expense-session-7")).toEqual(
      expect.objectContaining({
        notes: "Damaged item",
        registerSessionId: "drawer-1",
        status: "active",
      }),
    );
    expect(repository.items).toHaveLength(1);
  });

  it("allows item mutation without a drawer binding", async () => {
    const commandService = await loadCommandService();
    const inventoryCalls: InventoryCall[] = [];
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "expense-session-1",
          sessionNumber: "EXP-001",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "staff-1",
          registerNumber: "1",
          status: "active",
          expiresAt: 10_000,
          updatedAt: 900,
          createdAt: 100,
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).upsertSessionItem({
      sessionId: "expense-session-1",
      staffProfileId: "staff-1",
      productId: "product-1",
      productSkuId: "sku-1",
      productSku: "SKU-1",
      productName: "Test product",
      price: 100,
      quantity: 1,
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        itemId: "item-1",
        expiresAt: 61_000,
      },
    });
    expect(inventoryCalls).toEqual([
      { kind: "acquire", skuId: "sku-1", quantity: 1 },
    ]);
    expect(repository.items).toContainEqual(
      expect.objectContaining({
        _id: "item-1",
        sessionId: "expense-session-1",
        productSkuId: "sku-1",
        quantity: 1,
      }),
    );
    expect(repository.sessionPatches).toEqual([
      {
        sessionId: "expense-session-1",
        patch: {
          updatedAt: 1_000,
          expiresAt: 61_000,
        },
      },
    ]);
  });

  it("clears cart items even when a stored drawer binding no longer matches", async () => {
    const commandService = await loadCommandService();
    const inventoryCalls: InventoryCall[] = [];
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "expense-session-1",
          sessionNumber: "EXP-001",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "staff-1",
          registerNumber: "1",
          registerSessionId: "drawer-2",
          status: "active",
          expiresAt: 10_000,
          updatedAt: 900,
          createdAt: 100,
        }),
      ],
      items: [
        buildItem({
          _id: "item-1",
          sessionId: "expense-session-1",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productSku: "SKU-1",
          productName: "Test product",
          price: 100,
          quantity: 2,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-2",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-2",
          registerNumber: "2",
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).clearSessionItems({
      sessionId: "expense-session-1",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "expense-session-1",
      },
    });
    expect(inventoryCalls).toEqual([
      { kind: "release", skuId: "sku-1", quantity: 2 },
    ]);
    expect(repository.items).toHaveLength(0);
  });
});

async function loadCommandService() {
  const module = await import("./commands/expenseSessionCommands").catch(
    () => ({}),
  );

  expect(module).toHaveProperty("createExpenseSessionCommandService");
  expect(
    (module as { createExpenseSessionCommandService?: unknown })
      .createExpenseSessionCommandService,
  ).toBeTypeOf("function");

  return (
    module as {
      createExpenseSessionCommandService: (
        dependencies: ReturnType<typeof createDependencies>,
      ) => ReturnType<typeof createCommandService>;
    }
  ).createExpenseSessionCommandService;
}

function createDependencies(options: {
  repository: ReturnType<typeof createFakeRepository>;
  now: number;
  nextExpiration: number;
  inventoryCalls?: InventoryCall[];
  traceCalls?: TraceCall[];
}) {
  return {
    now: () => options.now,
    calculateExpiration: () => options.nextExpiration,
    repository: options.repository,
    inventory: {
      acquireHold: async (skuId: string, quantity: number) => {
        options.inventoryCalls?.push({ kind: "acquire", skuId, quantity });
        return { success: true };
      },
      adjustHold: async (
        skuId: string,
        oldQuantity: number,
        newQuantity: number,
      ) => {
        options.inventoryCalls?.push({
          kind: "adjust",
          skuId,
          oldQuantity,
          newQuantity,
        });
        return { success: true };
      },
      releaseHold: async (skuId: string, quantity: number) => {
        options.inventoryCalls?.push({ kind: "release", skuId, quantity });
        return { success: true };
      },
    },
    ...(options.traceCalls
      ? {
          traceRecorder: {
            record: async (input: {
              stage: string;
              session: ExpenseSessionRecord;
              itemName?: string;
              quantity?: number;
              previousQuantity?: number;
              itemCount?: number;
            }) => {
              const traceId = `expense_session:${input.session._id}`;
              options.traceCalls?.push({
                stage: input.stage,
                sessionId: input.session._id,
                sessionNumber: input.session.sessionNumber,
                traceId,
                itemName: input.itemName,
                quantity: input.quantity,
                previousQuantity: input.previousQuantity,
                itemCount: input.itemCount,
              });

              return {
                traceCreated: true,
                traceId,
              };
            },
          },
        }
      : {}),
  };
}

function createFakeRepository(seed?: {
  sessions?: ExpenseSessionRecord[];
  items?: ExpenseSessionItemRecord[];
  registerSessions?: RegisterSessionRecord[];
}) {
  const repository = {
    sessions: [...(seed?.sessions ?? [])],
    items: [...(seed?.items ?? [])],
    registerSessions: [...(seed?.registerSessions ?? [])],
    sessionPatches: [] as Array<{
      sessionId: string;
      patch: Partial<ExpenseSessionRecord>;
    }>,
    itemPatches: [] as Array<{
      itemId: string;
      patch: Partial<ExpenseSessionItemRecord>;
    }>,
    getSession(sessionId: string) {
      return (
        repository.sessions.find((session) => session._id === sessionId) ?? null
      );
    },
    getRegisterSession(registerSessionId: string) {
      return (
        repository.registerSessions.find(
          (session) => session._id === registerSessionId,
        ) ?? null
      );
    },
    getItem(itemId: string) {
      return repository.items.find((item) => item._id === itemId) ?? null;
    },
    async getLatestSessionNumber() {
      return repository.sessions.at(-1)?.sessionNumber ?? null;
    },
    async listActiveSessionsForTerminal(args: {
      storeId: string;
      terminalId: string;
    }) {
      return repository.sessions.filter(
        (session) =>
          session.storeId === args.storeId &&
          session.terminalId === args.terminalId &&
          session.status === "active",
      );
    },
    async listActiveSessionsForStaffProfile(args: {
      storeId: string;
      staffProfileId: string;
    }) {
      return repository.sessions.filter(
        (session) =>
          session.storeId === args.storeId &&
          session.staffProfileId === args.staffProfileId &&
          session.status === "active",
      );
    },
    async getSessionById(sessionId: string) {
      return repository.getSession(sessionId);
    },
    async getRegisterSessionById(registerSessionId: string) {
      return repository.getRegisterSession(registerSessionId);
    },
    async getOpenRegisterSessionForIdentity(args: {
      storeId: string;
      terminalId: string;
      registerNumber?: string;
    }) {
      const usableOpenStatuses = new Set(["open", "active"]);

      return (
        [...repository.registerSessions]
          .reverse()
          .find(
            (session) =>
              session.storeId === args.storeId &&
              session.terminalId === args.terminalId &&
              (!args.registerNumber ||
                session.registerNumber === args.registerNumber) &&
              usableOpenStatuses.has(session.status),
          ) ?? null
      );
    },
    async listSessionItems(sessionId: string) {
      return repository.items.filter((item) => item.sessionId === sessionId);
    },
    async findSessionItemBySku(args: {
      sessionId: string;
      productSkuId: string;
    }) {
      return (
        repository.items.find(
          (item) =>
            item.sessionId === args.sessionId &&
            item.productSkuId === args.productSkuId,
        ) ?? null
      );
    },
    async getSessionItemById(itemId: string) {
      return repository.getItem(itemId);
    },
    async createSession(input: Omit<ExpenseSessionRecord, "_id">) {
      const sessionId = `expense-session-${repository.sessions.length + 1}`;
      repository.sessions.push({ _id: sessionId, ...input });
      return sessionId;
    },
    async patchSession(
      sessionId: string,
      patch: Partial<ExpenseSessionRecord>,
    ) {
      repository.sessionPatches.push({ sessionId, patch });
      const session = repository.getSession(sessionId);
      if (!session) {
        return;
      }

      Object.assign(session, patch);
    },
    async createSessionItem(input: Omit<ExpenseSessionItemRecord, "_id">) {
      const itemId = `item-${repository.items.length + 1}`;
      repository.items.push({ _id: itemId, ...input });
      return itemId;
    },
    async patchSessionItem(
      itemId: string,
      patch: Partial<ExpenseSessionItemRecord>,
    ) {
      repository.itemPatches.push({ itemId, patch });
      const item = repository.getItem(itemId);
      if (!item) {
        return;
      }

      Object.assign(item, patch);
    },
    async deleteSessionItem(itemId: string) {
      repository.items = repository.items.filter((item) => item._id !== itemId);
    },
  };

  return repository;
}

function buildSession(input: ExpenseSessionRecord): ExpenseSessionRecord {
  return input;
}

function buildRegisterSession(
  input: RegisterSessionRecord,
): RegisterSessionRecord {
  return input;
}

function buildItem(
  input: Omit<ExpenseSessionItemRecord, "createdAt" | "updatedAt">,
): ExpenseSessionItemRecord {
  return {
    ...input,
    createdAt: 0,
    updatedAt: 0,
  };
}

function createCommandService(
  dependencies: ReturnType<typeof createDependencies>,
): {
  startSession: (args: {
    storeId: string;
    terminalId: string;
    staffProfileId: string;
    registerNumber?: string;
    registerSessionId?: string;
  }) => Promise<unknown>;
  resumeSession: (args: {
    sessionId: string;
    staffProfileId: string;
    terminalId: string;
  }) => Promise<unknown>;
  bindSessionToRegisterSession: (args: {
    sessionId: string;
    staffProfileId: string;
    registerSessionId: string;
  }) => Promise<unknown>;
  upsertSessionItem: (args: {
    sessionId: string;
    staffProfileId: string;
    productId: string;
    productSkuId: string;
    productSku: string;
    productName: string;
    price: number;
    quantity: number;
  }) => Promise<unknown>;
  clearSessionItems: (args: { sessionId: string }) => Promise<unknown>;
} {
  return dependencies as never;
}
