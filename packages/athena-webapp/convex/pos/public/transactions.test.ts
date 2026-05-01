import { describe, expect, it } from "vitest";

import {
  correctTransactionPaymentMethod,
  getCompletedTransactions,
  getTransactionById,
} from "./transactions";

type SerializedValidator = {
  type: string;
  value?: SerializedValidator[] | Record<string, SerializedValidator & { fieldType?: SerializedValidator; optional?: boolean }>;
};

function exportReturns(definition: unknown): string {
  return (definition as { exportReturns(): string }).exportReturns();
}

function parseValidator(validator: unknown): SerializedValidator {
  return JSON.parse(String(validator)) as SerializedValidator;
}

describe("POS public transaction query validators", () => {
  it("allows payment correction to return inline approval requirements", () => {
    const validator = parseValidator(exportReturns(correctTransactionPaymentMethod));

    expect(validator.type).toBe("union");
    expect(JSON.stringify(validator)).toContain("approval_required");
    expect(JSON.stringify(validator)).toContain("inline_manager_proof");
  });

  it("exposes session trace ids for completed transaction lists", () => {
    const validator = parseValidator(exportReturns(getCompletedTransactions));

    expect(validator.type).toBe("array");
    expect(validator.value).toMatchObject({
      type: "object",
      value: {
        sessionTraceId: expect.any(Object),
        hasMultiplePaymentMethods: {
          fieldType: { type: "boolean" },
          optional: false,
        },
      },
    });
  });

  it("exposes session trace ids for transaction details", () => {
    const validator = parseValidator(exportReturns(getTransactionById));

    expect(validator.type).toBe("union");
    expect(Array.isArray(validator.value)).toBe(true);
    expect((validator.value as SerializedValidator[])[1]).toMatchObject({
      type: "object",
      value: {
        sessionTraceId: expect.any(Object),
      },
    });
  });
});
