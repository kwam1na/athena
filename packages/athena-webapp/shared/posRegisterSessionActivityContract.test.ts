import { describe, expect, it } from "vitest";

import {
  POS_REGISTER_SESSION_ACTIVITY_CATEGORIES,
  POS_REGISTER_SESSION_ACTIVITY_SOURCES,
  POS_REGISTER_SESSION_ACTIVITY_STATUSES,
  classifyPosRegisterSessionLocalEventType,
  sanitizePosRegisterSessionLocalActivity,
  toPosRegisterSessionActivityStatusLabel,
} from "./posRegisterSessionActivityContract";

describe("posRegisterSessionActivityContract", () => {
  it("defines stable category, status, and source vocabularies", () => {
    expect(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES).toEqual([
      "register",
      "session",
      "cart",
      "payment",
      "service",
      "sale",
      "cash",
      "expense",
      "closeout",
      "reopen",
      "review",
      "sync",
    ]);
    expect(POS_REGISTER_SESSION_ACTIVITY_STATUSES).toEqual([
      "terminal_reported",
      "mapping_pending",
      "accepted",
      "projected",
      "held",
      "conflicted",
      "manager_applied",
      "manager_rejected",
      "rejected",
      "repaired",
    ]);
    expect(POS_REGISTER_SESSION_ACTIVITY_SOURCES).toEqual([
      "terminal_local",
      "core_sync",
      "cloud_projection",
      "manager_review",
      "cash_controls",
      "workflow_trace",
      "system",
    ]);
    expect(toPosRegisterSessionActivityStatusLabel("conflicted")).toBe(
      "Needs manager review",
    );
  });

  it("classifies current local POS event types into operator categories and labels", () => {
    expect(classifyPosRegisterSessionLocalEventType("register.opened")).toEqual(
      expect.objectContaining({
        category: "register",
        label: "Register opened",
      }),
    );
    expect(
      classifyPosRegisterSessionLocalEventType("session.payments_updated"),
    ).toEqual(
      expect.objectContaining({
        category: "payment",
        label: "Payment updated",
      }),
    );
    expect(
      classifyPosRegisterSessionLocalEventType("cash.movement_recorded"),
    ).toEqual(
      expect.objectContaining({
        category: "cash",
        label: "Cash movement recorded",
      }),
    );
    expect(
      classifyPosRegisterSessionLocalEventType("expense.completed"),
    ).toEqual(
      expect.objectContaining({
        category: "expense",
        label: "Expense recorded",
      }),
    );
    expect(
      classifyPosRegisterSessionLocalEventType("register.closeout_started"),
    ).toEqual(
      expect.objectContaining({
        category: "closeout",
        label: "Closeout started",
      }),
    );
    expect(classifyPosRegisterSessionLocalEventType("register.reopened")).toEqual(
      expect.objectContaining({
        category: "reopen",
        label: "Register reopened",
      }),
    );
  });

  it("sanitizes register, cart, payment, sale, cash, expense, closeout, and reopen metadata with a positive allowlist", () => {
    const sale = sanitizePosRegisterSessionLocalActivity({
      localEventId: "event-sale",
      sequence: 8,
      uploadSequence: 5,
      type: "transaction.completed",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "register-1",
      localPosSessionId: "sale-1",
      localTransactionId: "transaction-1",
      staffProfileId: "staff-1",
      createdAt: 1_000,
      payload: {
        localReceiptNumber: "LOCAL-1",
        receiptNumber: "R-100",
        totals: { subtotal: 100, tax: 8, total: 108 },
        items: [{ productName: "Bundle", quantity: 1 }],
        serviceLines: [{ serviceCatalogName: "Install", quantity: 1 }],
        payments: [
          {
            method: "cash",
            amount: 108,
            rawProviderPayload: { secret: "processor-secret" },
          },
        ],
        customerInfo: {
          name: "Customer Name",
          email: "customer@example.com",
          phone: "555-0100",
        },
        staffProofToken: "proof-token",
        pin: "1234",
        notes: "local note",
        arbitrary: { unsafe: true },
      },
    });

    expect(sale).toEqual({
      ok: true,
      value: expect.objectContaining({
        category: "sale",
        label: "Sale completed",
        source: "terminal_local",
        status: "terminal_reported",
        metadata: {
          itemCount: 1,
          localReceiptNumber: "LOCAL-1",
          paymentCount: 1,
          receiptNumber: "R-100",
          serviceLineCount: 1,
          subtotal: 100,
          tax: 8,
          total: 108,
        },
      }),
    });

    const serialized = JSON.stringify(sale);
    expect(serialized).not.toContain("processor-secret");
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("555-0100");
    expect(serialized).not.toContain("proof-token");
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("local note");
    expect(serialized).not.toContain("unsafe");

    const payment = sanitizePosRegisterSessionLocalActivity({
      localEventId: "event-payment",
      sequence: 4,
      type: "session.payments_updated",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-1",
      localPosSessionId: "sale-1",
      createdAt: 900,
      payload: {
        payments: [
          { method: "cash", amount: 20, paymentIntentSecret: "secret" },
          { method: "card", amount: 30, providerReference: "pi_secret" },
        ],
        stage: "checkout",
        paymentMethod: "card",
        amount: 30,
        previousAmount: 20,
      },
    });
    expect(payment.ok && payment.value.metadata).toEqual({
      amount: 30,
      paymentCount: 2,
      paymentMethodLabel: "Card",
      previousAmount: 20,
      stage: "checkout",
      totalPaid: 50,
    });

    const expense = sanitizePosRegisterSessionLocalActivity({
      localEventId: "event-expense",
      sequence: 11,
      type: "expense.completed",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-1",
      localExpenseSessionId: "expense-1",
      createdAt: 1_100,
      payload: {
        subtotal: 35,
        tax: 0,
        total: 35,
        reason: "Damaged item",
        notes: "vendor detail",
        items: [{ productName: "Comb" }, { productName: "Brush" }],
      },
    });
    expect(expense.ok && expense.value.metadata).toEqual({
      itemCount: 2,
      subtotal: 35,
      tax: 0,
      total: 35,
    });

    const closeout = sanitizePosRegisterSessionLocalActivity({
      localEventId: "event-closeout",
      sequence: 12,
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-1",
      createdAt: 1_200,
      payload: { countedCash: 200, notes: "count note" },
    });
    expect(closeout.ok && closeout.value.metadata).toEqual({
      countedCash: 200,
    });
  });

  it("returns typed safe skip reasons for unsupported or unscoped local events", () => {
    expect(
      sanitizePosRegisterSessionLocalActivity({
        localEventId: "event-unknown",
        sequence: 1,
        type: "terminal.seeded",
        terminalId: "terminal-1",
        storeId: "store-1",
        createdAt: 1_000,
        payload: { syncSecret: "secret" },
      }),
    ).toEqual({
      ok: false,
      reasonCode: "unsupported_event_type",
    });

    expect(
      sanitizePosRegisterSessionLocalActivity({
        localEventId: "event-no-session",
        sequence: 2,
        type: "register.opened",
        terminalId: "terminal-1",
        storeId: "store-1",
        createdAt: 1_000,
        payload: { openingFloat: 100, notes: "unsafe" },
      }),
    ).toEqual({
      ok: false,
      reasonCode: "missing_register_session",
    });
  });
});
