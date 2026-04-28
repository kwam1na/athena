import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, userError } from "~/shared/commandResult";
import {
  mapActiveSessionDto,
  mapHeldSessionsDto,
} from "./sessionGateway.mapper";
import { useConvexSessionActions } from "./sessionGateway";

const { mockUseMutation } = vi.hoisted(() => ({
  mockUseMutation: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQuery: vi.fn(),
}));

describe("mapActiveSessionDto", () => {
  beforeEach(() => {
    mockUseMutation.mockReset();
  });

  it("normalizes raw session cart items into the shared cart item shape", () => {
    const session = mapActiveSessionDto({
      _id: "session-1",
      _creationTime: 1,
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
      status: "active",
      registerNumber: "REG-1",
      sessionNumber: "SES-001",
      customerId: undefined,
      subtotal: 120,
      tax: 0,
      total: 120,
      holdReason: undefined,
      expiresAt: 10_000,
      completedAt: undefined,
      transactionId: undefined,
      heldAt: undefined,
      holdExpiresAt: undefined,
      notes: undefined,
      createdAt: 1,
      updatedAt: 2,
      customer: null,
      cartItems: [
        {
          _id: "item-1",
          _creationTime: 1,
          sessionId: "session-1",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productSku: "SKU-1",
          barcode: "123",
          productName: "Hair Clips",
          price: 120,
          quantity: 1,
          image: "https://example.com/clip.png",
          size: "Large",
          length: 18,
          color: "silver",
          areProcessingFeesAbsorbed: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    } as never);

    expect(session?.cartItems).toEqual([
      expect.objectContaining({
        id: "item-1",
        name: "Hair Clips",
        sku: "SKU-1",
        barcode: "123",
        skuId: "sku-1",
        productId: "product-1",
        quantity: 1,
      }),
    ]);
  });

  it("carries drawer, customer profile, payment, and checkout state fields", () => {
    const session = mapActiveSessionDto({
      _id: "session-1",
      _creationTime: 1,
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
      status: "active",
      registerNumber: "REG-1",
      registerSessionId: "drawer-1",
      sessionNumber: "SES-001",
      customerId: "customer-1",
      customerProfileId: "profile-1",
      subtotal: 120,
      tax: 0,
      total: 120,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
      checkoutStateVersion: 3,
      holdReason: undefined,
      expiresAt: 10_000,
      completedAt: undefined,
      transactionId: undefined,
      heldAt: undefined,
      holdExpiresAt: undefined,
      notes: undefined,
      createdAt: 1,
      updatedAt: 2,
      customer: {
        name: "Ama K",
        customerProfileId: "profile-1",
      },
      cartItems: [],
    } as never);

    expect(session).toEqual(
      expect.objectContaining({
        registerSessionId: "drawer-1",
        customerProfileId: "profile-1",
        payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
        checkoutStateVersion: 3,
        customer: expect.objectContaining({
          customerProfileId: "profile-1",
        }),
      }),
    );
  });
});

describe("mapHeldSessionsDto", () => {
  it("normalizes each held session cart item for the register ui", () => {
    const sessions = mapHeldSessionsDto([
      {
        _id: "session-2",
        _creationTime: 1,
        storeId: "store-1",
        terminalId: "terminal-1",
        staffProfileId: "staff-1",
        status: "held",
        registerNumber: "REG-1",
        sessionNumber: "SES-002",
        customerId: undefined,
        subtotal: 75,
        tax: 0,
        total: 75,
        holdReason: "Customer stepped away",
        expiresAt: 20_000,
        completedAt: undefined,
        transactionId: undefined,
        heldAt: 10,
        holdExpiresAt: undefined,
        notes: undefined,
        createdAt: 1,
        updatedAt: 2,
        customer: null,
        cartItems: [
          {
            _id: "item-2",
            _creationTime: 1,
            sessionId: "session-2",
            storeId: "store-1",
            productId: "product-2",
            productSkuId: "sku-2",
            productSku: "SKU-2",
            barcode: undefined,
            productName: "Bone Straight",
            price: 75,
            quantity: 1,
            image: undefined,
            size: undefined,
            length: undefined,
            color: undefined,
            areProcessingFeesAbsorbed: false,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    ] as never);

    expect(sessions?.[0]?.cartItems).toEqual([
      expect.objectContaining({
        id: "item-2",
        name: "Bone Straight",
        skuId: "sku-2",
        barcode: "",
      }),
    ]);
  });
});

describe("useConvexSessionActions", () => {
  beforeEach(() => {
    mockUseMutation.mockReset();
  });

  it("normalizes resume command results while preserving register session payloads", async () => {
    const resumeSessionMutation = vi.fn().mockResolvedValue(
      ok({
        sessionId: "session-1",
        registerSessionId: "drawer-1",
        expiresAt: 10_000,
      }),
    );
    mockUseMutation.mockReturnValue(vi.fn());
    mockUseMutation.mockReturnValueOnce(resumeSessionMutation);

    const actions = useConvexSessionActions();
    const result = await actions.resumeSession({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      registerSessionId: "drawer-1",
    } as never);

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-1",
        registerSessionId: "drawer-1",
        expiresAt: 10_000,
      },
    });
    expect(resumeSessionMutation).toHaveBeenCalledWith({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      registerSessionId: "drawer-1",
    });
  });

  it("normalizes recover/bind command failures without throwing", async () => {
    const bindSessionMutation = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message: "Open the cash drawer before recovering this sale.",
      }),
    );
    mockUseMutation.mockReturnValue(vi.fn());
    mockUseMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(bindSessionMutation);

    const actions = useConvexSessionActions();
    const result = await actions.bindSessionToRegisterSession({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      registerSessionId: "drawer-1",
    } as never);

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Open the cash drawer before recovering this sale.",
      },
    });
  });

  it("preserves checkout sync payload fields from modify command results", async () => {
    const syncSessionCheckoutStateMutation = vi.fn().mockResolvedValue(
      ok({
        sessionId: "session-1",
        payments: [{ method: "card", amount: 120, timestamp: 1_000 }],
        checkoutStateVersion: 4,
        customerProfileId: "profile-1",
        expiresAt: 10_000,
      }),
    );
    mockUseMutation.mockReturnValue(vi.fn());
    mockUseMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(syncSessionCheckoutStateMutation);

    const actions = useConvexSessionActions();
    const result = await actions.syncSessionCheckoutState({
      sessionId: "session-1",
      staffProfileId: "staff-1",
      payments: [{ method: "card", amount: 120, timestamp: 1_000 }],
      checkoutStateVersion: 4,
    } as never);

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-1",
        payments: [{ method: "card", amount: 120, timestamp: 1_000 }],
        checkoutStateVersion: 4,
        customerProfileId: "profile-1",
        expiresAt: 10_000,
      },
    });
  });

  it("normalizes thrown command faults to unexpected errors", async () => {
    const removeItemMutation = vi.fn().mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockUseMutation.mockReturnValue(vi.fn());
    mockUseMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(removeItemMutation);

    const actions = useConvexSessionActions();
    const result = await actions.removeItem({ itemId: "item-1" } as never);

    expect(result).toEqual({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: "Please try again.",
        traceId: undefined,
      },
    });
  });
});
