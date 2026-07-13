export type PosReconciliationLifecycle =
  | "completion"
  | "refund"
  | "void"
  | "adjustment"
  | "settlement_correction";

export type PosReconciliationRow = {
  amountMinor: number;
  businessEventKey: string;
  currencyCode: string;
  lifecycle: PosReconciliationLifecycle;
  operatingDate: string;
  quantity: number;
};

function indexRows(rows: PosReconciliationRow[]) {
  const indexed = new Map<string, PosReconciliationRow>();
  for (const row of rows) {
    if (indexed.has(row.businessEventKey)) {
      throw new Error(
        `duplicate POS reconciliation identity: ${row.businessEventKey}`,
      );
    }
    indexed.set(row.businessEventKey, row);
  }
  return indexed;
}

function sameMaterialValue(
  left: PosReconciliationRow,
  right: PosReconciliationRow,
) {
  return (
    left.amountMinor === right.amountMinor &&
    left.currencyCode === right.currencyCode &&
    left.lifecycle === right.lifecycle &&
    left.operatingDate === right.operatingDate &&
    left.quantity === right.quantity
  );
}

function sum(rows: PosReconciliationRow[], field: "amountMinor" | "quantity") {
  return rows.reduce((total, row) => total + row[field], 0);
}

export function reconcilePosSourceFacts(input: {
  facts: PosReconciliationRow[];
  source: PosReconciliationRow[];
}) {
  const source = indexRows(input.source);
  const facts = indexRows(input.facts);
  const missingFactKeys = [...source.keys()]
    .filter((key) => !facts.has(key))
    .sort();
  const unexpectedFactKeys = [...facts.keys()]
    .filter((key) => !source.has(key))
    .sort();
  const mismatchedKeys = [...source.entries()]
    .filter(([key, row]) => {
      const fact = facts.get(key);
      return fact !== undefined && !sameMaterialValue(row, fact);
    })
    .map(([key]) => key)
    .sort();
  const unexplainedCount =
    missingFactKeys.length + unexpectedFactKeys.length + mismatchedKeys.length;

  return {
    amountDeltaMinor:
      sum(input.facts, "amountMinor") - sum(input.source, "amountMinor"),
    complete: unexplainedCount === 0,
    factCount: input.facts.length,
    mismatchedKeys,
    missingFactKeys,
    quantityDelta: sum(input.facts, "quantity") - sum(input.source, "quantity"),
    sourceCount: input.source.length,
    unexpectedFactKeys,
    unexplainedCount,
  };
}
