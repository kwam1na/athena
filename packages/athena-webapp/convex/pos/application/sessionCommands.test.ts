import { describe, expect, it } from "vitest";

type SessionRecord = {
  _id: string;
  sessionNumber: string;
  storeId: string;
  terminalId: string;
  staffProfileId?: string;
  registerNumber?: string;
  registerSessionId?: string;
  status: "active" | "held" | "completed" | "void" | "expired";
  workflowTraceId?: string;
  expiresAt: number;
  updatedAt: number;
  heldAt?: number;
  resumedAt?: number;
  holdReason?: string;
};

type RegisterSessionRecord = {
  _id: string;
  storeId: string;
  status: "open" | "active" | "closing" | "closed";
  terminalId?: string;
  registerNumber?: string;
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

type TraceCall = {
  stage: string;
  sessionId: string;
  sessionNumber: string;
  status: SessionRecord["status"];
  traceId?: string;
  transactionId?: string;
  holdReason?: string;
  itemName?: string;
  quantity?: number;
  previousQuantity?: number;
};

describe("createPosSessionCommandService", () => {
  it("creates a fresh active session when no matching active session exists", async () => {
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
    const traceCalls: TraceCall[] = [];

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
      staffProfileId: "cashier-1",
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
        staffProfileId: "cashier-1",
        registerNumber: "1",
        registerSessionId: "drawer-1",
        expiresAt: 61_000,
        workflowTraceId: "pos_session:ses-001",
      }),
    );
    expect(traceCalls).toEqual([
      {
        stage: "started",
        sessionId: "session-1",
        sessionNumber: "SES-001",
        status: "active",
        traceId: "pos_session:ses-001",
      },
    ]);
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
          staffProfileId: "cashier-1",
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
      staffProfileId: "cashier-1",
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
    const traceCalls: TraceCall[] = [];
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
      sessions: [
        buildSession({
          _id: "session-4",
          sessionNumber: "SES-004",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          registerSessionId: "drawer-1",
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
        traceCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).startSession({
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "cashier-1",
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
        registerSessionId: "drawer-1",
      }),
    );
    expect(traceCalls).toEqual([
      {
        stage: "autoHeld",
        sessionId: "session-4",
        sessionNumber: "SES-004",
        status: "held",
        traceId: "pos_session:ses-004",
        holdReason: "Auto-held when new session started",
      },
    ]);
  });

  it("holds a modifiable session without refreshing its expiration", async () => {
    const commandService = await loadCommandService();
    const traceCalls: TraceCall[] = [];
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-2",
          sessionNumber: "SES-002",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          workflowTraceId: "pos_session:ses-002",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
    });

    const result = await commandService(
      createDependencies({
        repository,
        traceCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).holdSession({
      sessionId: "session-2",
      staffProfileId: "cashier-1",
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
    expect(traceCalls).toEqual([
      {
        stage: "held",
        sessionId: "session-2",
        sessionNumber: "SES-002",
        status: "held",
        traceId: "pos_session:ses-002",
        holdReason: "Customer stepped away",
      },
    ]);
  });

  it("keeps session start successful when lifecycle tracing fails", async () => {
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
        traceError: new Error("trace unavailable"),
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).startSession({
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "cashier-1",
      registerNumber: "1",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "session-1",
        expiresAt: 61_000,
      },
    });
    expect(repository.getSession("session-1")).not.toHaveProperty(
      "workflowTraceId",
    );
  });

  it("fails clearly when no open drawer can be resolved for a new retail session", async () => {
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
      staffProfileId: "cashier-1",
      registerNumber: "1",
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before starting a sale.",
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it("does not bind to an open drawer for a different terminal", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-2",
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
      staffProfileId: "cashier-1",
      registerNumber: "1",
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before starting a sale.",
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it("refuses to start a retail session with an explicitly closing drawer", async () => {
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
      staffProfileId: "cashier-1",
      registerNumber: "1",
      registerSessionId: "drawer-1",
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before starting a sale.",
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it("binds an active same-terminal session to an open drawer without holding or clearing it", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-2",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-1",
          registerNumber: "1",
        }),
      ],
      sessions: [
        buildSession({
          _id: "session-1",
          sessionNumber: "SES-001",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          expiresAt: 8_000,
          updatedAt: 500,
          registerNumber: "1",
        }),
      ],
      items: [
        buildItem({
          _id: "item-1",
          sessionId: "session-1",
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
    ).bindSessionToRegisterSession({
      sessionId: "session-1",
      staffProfileId: "cashier-1",
      registerSessionId: "drawer-2",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "session-1",
        expiresAt: 61_000,
      },
    });
    expect(repository.getSession("session-1")).toEqual(
      expect.objectContaining({
        status: "active",
        registerSessionId: "drawer-2",
        updatedAt: 1_000,
        expiresAt: 61_000,
      }),
    );
    expect(repository.items).toHaveLength(1);
  });

  it("treats binding an active session to the same drawer as idempotent", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-2",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-1",
          registerNumber: "1",
        }),
      ],
      sessions: [
        buildSession({
          _id: "session-1",
          sessionNumber: "SES-001",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          expiresAt: 8_000,
          updatedAt: 500,
          registerNumber: "1",
          registerSessionId: "drawer-2",
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
      sessionId: "session-1",
      staffProfileId: "cashier-1",
      registerSessionId: "drawer-2",
    });

    expect(result).toEqual({
      status: "ok",
      data: {
        sessionId: "session-1",
        expiresAt: 8_000,
      },
    });
    expect(repository.getSession("session-1")).toEqual(
      expect.objectContaining({
        registerSessionId: "drawer-2",
        updatedAt: 500,
        expiresAt: 8_000,
      }),
    );
  });

  it("rejects recovery binding when the drawer identity does not match the session", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-2",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-9",
          registerNumber: "9",
        }),
      ],
      sessions: [
        buildSession({
          _id: "session-1",
          sessionNumber: "SES-001",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          expiresAt: 8_000,
          updatedAt: 500,
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
      sessionId: "session-1",
      staffProfileId: "cashier-1",
      registerSessionId: "drawer-2",
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before recovering this sale.",
    });
    expect(repository.getSession("session-1")).not.toHaveProperty(
      "registerSessionId",
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
          staffProfileId: "cashier-1",
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
      staffProfileId: "cashier-1",
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
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          registerSessionId: "drawer-1",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
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
    const inventoryCalls: InventoryCall[] = [];
    const traceCalls: TraceCall[] = [];

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        traceCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).upsertSessionItem({
      sessionId: "session-5",
      staffProfileId: "cashier-1",
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
    expect(traceCalls).toEqual([
      {
        stage: "itemAdded",
        sessionId: "session-5",
        sessionNumber: "SES-005",
        status: "active",
        traceId: "pos_session:ses-005",
        itemName: "Sneaker",
        quantity: 2,
        previousQuantity: undefined,
      },
    ]);
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
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          registerSessionId: "drawer-1",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-1",
          registerNumber: "1",
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
    const traceCalls: TraceCall[] = [];

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        traceCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).upsertSessionItem({
      sessionId: "session-6",
      staffProfileId: "cashier-1",
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
    expect(traceCalls).toEqual([
      {
        stage: "itemQuantityUpdated",
        sessionId: "session-6",
        sessionNumber: "SES-006",
        status: "active",
        traceId: "pos_session:ses-006",
        itemName: "Sneaker",
        quantity: 5,
        previousQuantity: 2,
      },
    ]);
  });

  it("refuses to add a cart line when the active session has no drawer binding", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-10",
          sessionNumber: "SES-010",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
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
      sessionId: "session-10",
      staffProfileId: "cashier-1",
      productId: "product-1",
      productSkuId: "sku-1",
      productSku: "SKU-1",
      productName: "Sneaker",
      price: 120,
      quantity: 2,
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before modifying this sale.",
    });
    expect(inventoryCalls).toEqual([]);
    expect(repository.items).toEqual([]);
  });

  it("refuses to add a cart line when the bound drawer is closed", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-11",
          sessionNumber: "SES-011",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          registerSessionId: "drawer-1",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "closed",
          terminalId: "terminal-1",
          registerNumber: "1",
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
      sessionId: "session-11",
      staffProfileId: "cashier-1",
      productId: "product-1",
      productSkuId: "sku-1",
      productSku: "SKU-1",
      productName: "Sneaker",
      price: 120,
      quantity: 2,
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before modifying this sale.",
    });
    expect(inventoryCalls).toEqual([]);
    expect(repository.items).toEqual([]);
  });

  it("refuses to update a cart line when the bound drawer identity is mismatched", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-12",
          sessionNumber: "SES-012",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          registerSessionId: "drawer-9",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-9",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-9",
          registerNumber: "9",
        }),
      ],
      items: [
        buildItem({
          _id: "item-12",
          sessionId: "session-12",
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
      sessionId: "session-12",
      staffProfileId: "cashier-1",
      productId: "product-1",
      productSkuId: "sku-1",
      productSku: "SKU-1",
      productName: "Sneaker",
      price: 125,
      quantity: 5,
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before modifying this sale.",
    });
    expect(inventoryCalls).toEqual([]);
    expect(repository.getItem("item-12")).toEqual(
      expect.objectContaining({
        quantity: 2,
        price: 120,
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
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          registerSessionId: "drawer-1",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-1",
          registerNumber: "1",
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
    const traceCalls: TraceCall[] = [];

    const result = await commandService(
      createDependencies({
        repository,
        inventoryCalls,
        traceCalls,
        now: 1_000,
        nextExpiration: 61_000,
      }),
    ).removeSessionItem({
      sessionId: "session-7",
      staffProfileId: "cashier-1",
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
    expect(traceCalls).toEqual([
      {
        stage: "itemRemoved",
        sessionId: "session-7",
        sessionNumber: "SES-007",
        status: "active",
        traceId: "pos_session:ses-007",
        itemName: "Sneaker",
        quantity: 3,
        previousQuantity: undefined,
      },
    ]);
  });

  it("refuses to remove a cart line when the active session has no drawer binding", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-13",
          sessionNumber: "SES-013",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      items: [
        buildItem({
          _id: "item-13",
          sessionId: "session-13",
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
      sessionId: "session-13",
      staffProfileId: "cashier-1",
      itemId: "item-13",
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before modifying this sale.",
    });
    expect(inventoryCalls).toEqual([]);
    expect(repository.getItem("item-13")).not.toBeNull();
  });

  it("refuses to remove a cart line when the bound drawer is closed", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-14",
          sessionNumber: "SES-014",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          registerSessionId: "drawer-1",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-1",
          storeId: "store-1",
          status: "closed",
          terminalId: "terminal-1",
          registerNumber: "1",
        }),
      ],
      items: [
        buildItem({
          _id: "item-14",
          sessionId: "session-14",
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
      sessionId: "session-14",
      staffProfileId: "cashier-1",
      itemId: "item-14",
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before modifying this sale.",
    });
    expect(inventoryCalls).toEqual([]);
    expect(repository.getItem("item-14")).not.toBeNull();
  });

  it("refuses to remove a cart line when the bound drawer identity is mismatched", async () => {
    const commandService = await loadCommandService();
    const repository = createFakeRepository({
      sessions: [
        buildSession({
          _id: "session-15",
          sessionNumber: "SES-015",
          storeId: "store-1",
          terminalId: "terminal-1",
          staffProfileId: "cashier-1",
          status: "active",
          registerNumber: "1",
          registerSessionId: "drawer-9",
          expiresAt: 8_000,
          updatedAt: 500,
        }),
      ],
      registerSessions: [
        buildRegisterSession({
          _id: "drawer-9",
          storeId: "store-1",
          status: "open",
          terminalId: "terminal-9",
          registerNumber: "9",
        }),
      ],
      items: [
        buildItem({
          _id: "item-15",
          sessionId: "session-15",
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
      sessionId: "session-15",
      staffProfileId: "cashier-1",
      itemId: "item-15",
    });

    expect(result).toEqual({
      status: "validationFailed",
      message: "Open the cash drawer before modifying this sale.",
    });
    expect(inventoryCalls).toEqual([]);
    expect(repository.getItem("item-15")).not.toBeNull();
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
  traceCalls?: TraceCall[];
  traceError?: Error;
  traceResult?: {
    traceCreated: boolean;
    traceId: string;
  };
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
    tracing: {
      record: async (input: {
        stage: string;
        session: SessionRecord;
        transactionId?: string;
        holdReason?: string;
        itemName?: string;
        quantity?: number;
        previousQuantity?: number;
      }) => {
        const traceCall: TraceCall = {
          stage: input.stage,
          sessionId: input.session._id,
          sessionNumber: input.session.sessionNumber,
          status: input.session.status,
          transactionId: input.transactionId,
          holdReason: input.holdReason,
          itemName: input.itemName,
          quantity: input.quantity,
          previousQuantity: input.previousQuantity,
        };
        options.traceCalls?.push(traceCall);

        if (options.traceError) {
          throw options.traceError;
        }

        const traceResult = options.traceResult ?? {
          traceCreated: true,
          traceId: `pos_session:${input.session.sessionNumber.toLowerCase()}`,
        };
        traceCall.traceId = traceResult.traceId;
        return traceResult;
      },
    },
  };
}

function createFakeRepository(seed?: {
  sessions?: SessionRecord[];
  items?: SessionItemRecord[];
  registerSessions?: RegisterSessionRecord[];
}) {
  const repository = {
    sessions: [...(seed?.sessions ?? [])],
    items: [...(seed?.items ?? [])],
    registerSessions: [...(seed?.registerSessions ?? [])],
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
    async listActiveSessionsForCashier(args: {
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

      if (!args.terminalId) {
        return null;
      }

      return (
        [...repository.registerSessions]
          .reverse()
          .find(
            (session) =>
              session.storeId === args.storeId &&
              session.terminalId === args.terminalId &&
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

function buildRegisterSession(
  input: RegisterSessionRecord,
): RegisterSessionRecord {
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
    staffProfileId?: string;
    registerNumber?: string;
    registerSessionId?: string;
  }) => Promise<unknown>;
  holdSession: (args: {
    sessionId: string;
    staffProfileId: string;
    holdReason?: string;
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
  removeSessionItem: (args: {
    sessionId: string;
    staffProfileId: string;
    itemId: string;
  }) => Promise<unknown>;
} {
  return dependencies as never;
}
