export type ReconciliationValues = Record<string, number>;

export type ReconciliationDifference = {
  actual: number;
  difference: number;
  expected: number;
  field: string;
  unit: "minor_currency" | "quantity";
};

function unitFor(field: string): ReconciliationDifference["unit"] {
  return field.toLowerCase().includes("minor")
    ? "minor_currency"
    : "quantity";
}

export function reconcileProjection(input: {
  expected: ReconciliationValues;
  projected: ReconciliationValues;
}) {
  const fields = Array.from(
    new Set([...Object.keys(input.expected), ...Object.keys(input.projected)]),
  );
  const differences: ReconciliationDifference[] = [];

  for (const field of fields) {
    const expected = input.expected[field] ?? 0;
    const actual = input.projected[field] ?? 0;
    if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(actual)) {
      throw new Error(`Reconciliation field ${field} must use safe integers`);
    }
    if (expected !== actual) {
      differences.push({
        actual,
        difference: actual - expected,
        expected,
        field,
        unit: unitFor(field),
      });
    }
  }

  return {
    differences,
    status: differences.length === 0 ? ("verified" as const) : ("failed" as const),
  };
}
