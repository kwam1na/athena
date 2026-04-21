import { describe, expect, it } from "vitest";

type SessionRecord = {
  _id: string;
  sessionNumber: string;
  storeId: string;
  terminalId: string;
  cashierId?: string;
  registerNumber?: string;
  status: "active" | "held" | "completed" | "void" | "expired";
  expiresAt: number;
  updatedAt: number;
  heldAt?: number;
  resumedAt?: number;
  holdReason?: string;
};

type SessionItemRecord = {
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

describe("createPosSessionCommandService", () => {
  it("creates a fresh active session when no matching active session exists", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository();

    const result = await commandService(
      createDependencies({
        repository,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).startSession({
      storeId: "store-1",
      terminalId: "terminal-1",
      cashierId: "cashier-1",
      registerNumber: "1",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "session-1",
        expiresAt: 61_000,
      },
    });
    expect(repository.sessions).toContainEqual(
      expect.objectContaining({
        _id: "session-1",
        sessionNumber: "SES-001",
        status: "active",
        terminalId: "terminal-1",
        cashierId: "cashier-1",
        registerNumber: "1",
        expiresAt: 61_000,
      }),
    );
  });

  it("refuses to start a new session when the cashier is already active on another terminal", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-9",
          sessionNumber: "SES-009",
          storeId: "store-1",
          terminalId: "terminal-2",
          cashierId: "cashier-1",
          status: "active",
          expiresAt: 10_000,
          updatedAt: 900,
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
      cashierId: "cashier-1",
      registerNumber: "1",
    });

    expect(result).toEqual({
      status: "terminalUnavailable",
      message: "A session is active for this cashier on a different terminal",
    });
    expect(repository.sessions).toHaveLength(1);
  });

  it("auto-holds an existing same-terminal session with items before returning it", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-4",
          sessionNumber: "SES-004",
          storeId: "store-1",
          terminalId: "terminal-1",
          cashierId: "cashier-1",
          status: "active",
          expiresAt: 12_000,
          updatedAt: 950,
        }),
      ],
      items: [
        buildItem({
          _id: "item-1",
          sessionId: "session-4",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productSku: "SKU-1",
          productName: "Sneaker",
          price: 120,
          quantity: 2,
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
      cashierId: "cashier-1",
      registerNumber: "1",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "session-4",
        expiresAt: 12_000,
      },
    });
    expect(repository.getSession("session-4")).toEqual(
      expect.objectContaining({
        status: "held",
        heldAt: 1_000,
        holdReason: "Auto-held when new session started",
      }),
    );
  });

  it("holds a modifiable session without refreshing its expiration", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-2",
          sessionNumber: "SES-002",
          storeId: "store-1",
          terminalId: "terminal-1",
          cashierId: "cashier-1",
          status: "active",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).holdSession({
      sessionId: "session-2",
      cashierId: "cashier-1",
      holdReason: "Customer stepped away",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "session-2",
        expiresAt: 8_000,
      },
    });
    expect(repository.getSession("session-2")).toEqual(
      expect.objectContaining({
        status: "held",
        heldAt: 1_000,
        expiresAt: 8_000,
        holdReason: "Customer stepped away",
      }),
    );
  });

  it("refuses to resume an expired held session", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-3",
          sessionNumber: "SES-003",
          storeId: "store-1",
          terminalId: "terminal-1",
          cashierId: "cashier-1",
          status: "held",
          expiresAt: 900,
          updatedAt: 500,
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).resumeSession({
      sessionId: "session-3",
      cashierId: "cashier-1",
      terminalId: "terminal-1",
    });

    expect(result).toEqual({
      status: "sessionExpired",
      message: "This session has expired. Start a new one to proceed.",
    });
  });

  it("acquires a new inventory hold when adding a new cart line and refreshes session expiration", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-5",
          sessionNumber: "SES-005",
          storeId: "store-1",
          terminalId: "terminal-1",
          cashierId: "cashier-1",
          status: "active",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
    });
    const inventoryCalls: InventoryCall[] = [];

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).upsertSessionItem({
      sessionId: "session-5",
      cashierId: "cashier-1",
      productId: "product-1",
      productSkuId: "sku-1",
      productSku: "SKU-1",
      productName: "Sneaker",
      price: 120,
      quantity: 2,
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        itemId: "item-1",
        expiresAt: 61_000,
      },
    });
    expect(inventoryCalls).toEqual([
      { kind: "acquire", skuId: "sku-1", quantity: 2 },
    ]);
    expect(repository.items).toContainEqual(
      expect.objectContaining({
        _id: "item-1",
        sessionId: "session-5",
        productSkuId: "sku-1",
        quantity: 2,
      }),
    );
    expect(repository.getSession("session-5")?.expiresAt).toBe(61_000);
  });

  it("adjusts the existing inventory hold when updating a cart line quantity", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-6",
          sessionNumber: "SES-006",
          storeId: "store-1",
          terminalId: "terminal-1",
          cashierId: "cashier-1",
          status: "active",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      items: [
        buildItem({
          _id: "item-9",
          sessionId: "session-6",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productSku: "SKU-1",
          productName: "Sneaker",
          price: 120,
          quantity: 2,
        }),
      ],
    });
    const inventoryCalls: InventoryCall[] = [];

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).upsertSessionItem({
      sessionId: "session-6",
      cashierId: "cashier-1",
      productId: "product-1",
      productSkuId: "sku-1",
      productSku: "SKU-1",
      productName: "Sneaker",
      price: 125,
      quantity: 5,
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        itemId: "item-9",
        expiresAt: 61_000,
      },
    });
    expect(inventoryCalls).toEqual([
      {
        kind: "adjust",
        skuId: "sku-1",
        oldQuantity: 2,
        newQuantity: 5,
      },
    ]);
    expect(repository.getItem("item-9")).toEqual(
      expect.objectContaining({
        quantity: 5,
        price: 125,
      }),
    );
  });

  it("releases the held quantity when removing a cart line", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-7",
          sessionNumber: "SES-007",
          storeId: "store-1",
          terminalId: "terminal-1",
          cashierId: "cashier-1",
          status: "active",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      items: [
        buildItem({
          _id: "item-3",
          sessionId: "session-7",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productSku: "SKU-1",
          productName: "Sneaker",
          price: 120,
          quantity: 3,
        }),
      ],
    });
    const inventoryCalls: InventoryCall[] = [];

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).removeSessionItem({
      sessionId: "session-7",
      cashierId: "cashier-1",
      itemId: "item-3",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        expiresAt: 61_000,
      },
    });
    expect(inventoryCalls).toEqual([
      { kind: "release", skuId: "sku-1", quantity: 3 },
    ]);
    expect(repository.getItem("item-3")).toBeNull();
    expect(repository.getSession("session-7")?.expiresAt).toBe(61_000);
  });
});

async function loadCommandService() {
  const module = await import("./commands/sessionCommands").catch(() => ({}));

  expect(module).toHaveProperty("createPosSessionCommandService");
  expect(
    (module as { createPosSessionCommandService?: unknown })
      .createPosSessionCommandService,
  ).toBeTypeOf("function");

  return (
    module as {
      createPosSessionCommandService: (
        dependencies: ReturnType<typeof createDependencies>,
      ) => ReturnType<typeof createCommandService>;
    }
  ).createPosSessionCommandService;
}

function createDependencies(options: {
  repository: ReturnType<typeof createFakeRepository>;
  now: number;
  nextExpiration: number;
  inventoryCalls?: InventoryCall[];
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
  };
}

function createFakeRepository(seed?: {
  sessions?: SessionRecord[];
  items?: SessionItemRecord[];
}) {
  const repository = {
    sessions: [...(seed?.sessions ?? [])],
    items: [...(seed?.items ?? [])],
    getSession(sessionId: string) {
      return (
        repository.sessions.find((session) => session._id === sessionId) ?? null
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
    async listActiveSessionsForCashier(args: {
      storeId: string;
      cashierId: string;
    }) {
      return repository.sessions.filter(
        (session) =>
          session.storeId === args.storeId &&
          session.cashierId === args.cashierId &&
          session.status === "active",
      );
    },
    async getSessionById(sessionId: string) {
      return repository.getSession(sessionId);
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
    async createSession(input: Omit<SessionRecord, "_id">) {
      const sessionId = `session-${repository.sessions.length + 1}`;
      repository.sessions.push({ _id: sessionId, ...input });
      return sessionId;
    },
    async patchSession(sessionId: string, patch: Partial<SessionRecord>) {
      const session = repository.getSession(sessionId);
      if (!session) {
        return;
      }

      Object.assign(session, patch);
    },
    async createSessionItem(
      input: Omit<SessionItemRecord, "_id" | "createdAt" | "updatedAt"> & {
        createdAt: number;
        updatedAt: number;
      },
    ) {
      const itemId = `item-${repository.items.length + 1}`;
      repository.items.push({ _id: itemId, ...input });
      return itemId;
    },
    async patchSessionItem(itemId: string, patch: Partial<SessionItemRecord>) {
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

function buildSession(input: SessionRecord): SessionRecord {
  return input;
}

function buildItem(
  input: Omit<SessionItemRecord, "createdAt" | "updatedAt">,
): SessionItemRecord {
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
    cashierId?: string;
    registerNumber?: string;
  }) => Promise<unknown>;
  holdSession: (args: {
    sessionId: string;
    cashierId: string;
    holdReason?: string;
  }) => Promise<unknown>;
  resumeSession: (args: {
    sessionId: string;
    cashierId: string;
    terminalId: string;
  }) => Promise<unknown>;
  upsertSessionItem: (args: {
    sessionId: string;
    cashierId: string;
    productId: string;
    productSkuId: string;
    productSku: string;
    productName: string;
    price: number;
    quantity: number;
  }) => Promise<unknown>;
  removeSessionItem: (args: {
    sessionId: string;
    cashierId: string;
    itemId: string;
  }) => Promise<unknown>;
} {
  return dependencies as never;
}
