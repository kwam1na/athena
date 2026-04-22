import { describe, expect, it } from "vitest";

import {
  mapActiveSessionDto,
  mapHeldSessionsDto,
} from "./sessionGateway.mapper";

describe("mapActiveSessionDto", () => {
  it("normalizes raw session cart items into the shared cart item shape", () => {
    const session = mapActiveSessionDto({
      _id: "session-1",
      _creationTime: 1,
      storeId: "store-1",
      terminalId: "terminal-1",
      cashierId: "cashier-1",
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
});

describe("mapHeldSessionsDto", () => {
  it("normalizes each held session cart item for the register ui", () => {
    const sessions = mapHeldSessionsDto([
      {
        _id: "session-2",
        _creationTime: 1,
        storeId: "store-1",
        terminalId: "terminal-1",
        cashierId: "cashier-1",
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
