import { describe, expect, it } from "vitest";

import {
  getCompletedTransactions,
  getTransactionById,
} from "./transactions";

type SerializedValidator = {
  type: string;
  value?: SerializedValidator[] | Record<string, SerializedValidator>;
};

function exportReturns(definition: unknown): string {
  return (definition as { exportReturns(): string }).exportReturns();
}

function parseValidator(validator: unknown): SerializedValidator {
  return JSON.parse(String(validator)) as SerializedValidator;
}

describe("POS public transaction query validators", () => {
  it("exposes sale and session trace ids for completed transaction lists", () => {
    const validator = parseValidator(exportReturns(getCompletedTransactions));

    expect(validator.type).toBe("array");
    expect(validator.value).toMatchObject({
      type: "object",
      value: {
        saleTraceId: expect.any(Object),
        sessionTraceId: expect.any(Object),
      },
    });
  });

  it("exposes sale and session trace ids for transaction details", () => {
    const validator = parseValidator(exportReturns(getTransactionById));

    expect(validator.type).toBe("union");
    expect(Array.isArray(validator.value)).toBe(true);
    expect((validator.value as SerializedValidator[])[1]).toMatchObject({
      type: "object",
      value: {
        saleTraceId: expect.any(Object),
        sessionTraceId: expect.any(Object),
      },
    });
  });
});
