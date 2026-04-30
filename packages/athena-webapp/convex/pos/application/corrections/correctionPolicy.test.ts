import { describe, expect, it } from "vitest";
import { isUserErrorResult } from "../../../../shared/commandResult";
import { classifyCorrectionIntent } from "./correctionPolicy";

describe("correction policy", () => {
  it("classifies opening-float corrections on open drawers as staff-auth recoverable drawer math", () => {
    expect(
      classifyCorrectionIntent({
        intent: "opening_float",
        registerSessionStatus: "open",
      })
    ).toMatchObject({
      kind: "ok",
      data: {
        intent: "opening_float",
        riskTier: "recoverable_drawer_math",
        authorization: "staff_auth",
        directEditAllowed: true,
        auditEventType: "pos.correction.opening_float",
      },
    });
  });

  it("blocks opening-float corrections when the register session is no longer open", () => {
    const result = classifyCorrectionIntent({
      intent: "opening_float",
      registerSessionStatus: "closed",
    });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(result.error).toEqual({
        code: "precondition_failed",
        title: "Drawer not open",
        message: "Drawer not open. Open the drawer before correcting the opening float.",
        retryable: false,
        metadata: {
          intent: "opening_float",
          riskTier: "recoverable_drawer_math",
          directEditAllowed: false,
          registerSessionStatus: "closed",
        },
      });
    }
  });

  it("classifies customer attribution as low-risk metadata", () => {
    expect(classifyCorrectionIntent({ intent: "customer_attribution" })).toMatchObject({
      kind: "ok",
      data: {
        riskTier: "metadata",
        authorization: "cashier",
        directEditAllowed: true,
      },
    });
  });

  it("classifies payment method corrections as ledger-affecting and stricter than metadata", () => {
    const paymentMethod = classifyCorrectionIntent({ intent: "payment_method" });
    const customerAttribution = classifyCorrectionIntent({
      intent: "customer_attribution",
    });

    expect(paymentMethod).toMatchObject({
      kind: "ok",
      data: {
        riskTier: "ledger_affecting",
        authorization: "manager_approval",
        directEditAllowed: false,
      },
    });
    expect(paymentMethod.kind).toBe("ok");
    expect(customerAttribution.kind).toBe("ok");
    if (paymentMethod.kind === "ok" && customerAttribution.kind === "ok") {
      expect(paymentMethod.data.severityRank).toBeGreaterThan(
        customerAttribution.data.severityRank
      );
    }
  });

  it.each([
    "item",
    "quantity",
    "total",
    "discount",
    "inventory",
  ] as const)("routes %s corrections to safer workflows", (intent) => {
    const result = classifyCorrectionIntent({ intent });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(result.error).toMatchObject({
        code: "precondition_failed",
        title: "Correction workflow required",
        retryable: false,
        metadata: {
          intent,
          riskTier: "unsupported_high_risk",
          directEditAllowed: false,
        },
      });
      expect(result.error.message).toContain("Use the guided correction workflow");
    }
  });

  it("returns safe validation feedback for unknown correction intents", () => {
    const result = classifyCorrectionIntent({ intent: "tax_rate" });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(result.error).toEqual({
        code: "validation_failed",
        title: "Correction unavailable",
        message: "Correction unavailable. Choose a supported correction type.",
        retryable: false,
        metadata: {
          intent: "tax_rate",
          riskTier: "unknown",
          directEditAllowed: false,
        },
      });
    }
  });
});
