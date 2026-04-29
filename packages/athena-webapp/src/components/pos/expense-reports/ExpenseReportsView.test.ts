import { describe, expect, it } from "vitest";

import { toExpenseReportRows } from "./ExpenseReportsView";
import type { ExpenseReportRow } from "./expenseReportColumns";

describe("toExpenseReportRows", () => {
  it("uses the staff profile name returned by the expense transaction query", () => {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "GHS",
      currencyDisplay: "code",
    });

    const rows = toExpenseReportRows(
      [
        {
          _id: "expense_txn_1" as ExpenseReportRow["_id"],
          transactionNumber: "346784",
          totalValue: 30000,
          staffProfileName: "Kwamina N.",
          itemCount: 1,
          completedAt: 1_775_000_000_000,
        },
      ],
      formatter,
    );

    expect(rows[0]?.cashierName).toBe("Kwamina N.");
  });
});
