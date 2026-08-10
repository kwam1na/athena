import type { Id } from "../_generated/dataModel";

export type WeeklyCloseEvidenceCoverage = {
  scheduledDayCount: number;
  status: "complete" | "partial" | "unavailable";
  usableDayCount: number;
};

export type WeeklyExpenseProductRow = {
  productName: string;
  productSku: string;
  productSkuId: Id<"productSku">;
  quantity: number;
  spendMinor: number;
};

export type WeeklyExpenseRemainder = {
  productCount: number;
  quantity: number;
  spendMinor: number;
};

export type WeeklyCloseEvidence = {
  cash: {
    cashVarianceMinor: number;
    coverage: WeeklyCloseEvidenceCoverage;
  };
  transactions: {
    coverage: WeeklyCloseEvidenceCoverage;
    transactionCount: number;
  };
  payments: {
    coveredTenderValueMinor: number;
    coverage: WeeklyCloseEvidenceCoverage;
    rows: Array<{
      amountMinor: number;
      method: string;
      shareBasisPoints: number;
      tenderUseCount: number;
    }>;
  };
  expenses: {
    byQuantity: WeeklyExpenseProductRow[];
    bySpend: WeeklyExpenseProductRow[];
    coveredQuantity: number;
    coveredSpendMinor: number;
    coverage: WeeklyCloseEvidenceCoverage;
    quantityRemainder: WeeklyExpenseRemainder | null;
    spendRemainder: WeeklyExpenseRemainder | null;
  };
};

type CloseSnapshot = {
  _id: Id<"dailyClose">;
  lifecycleStatus?: string;
  operatingDate: string;
  reportSnapshot?: {
    expenseProductEvidence?: unknown;
    summary?: Record<string, unknown>;
  };
  status: string;
};

type CompleteExpenseEvidence = {
  expenseTotal: number;
  products: Array<{
    productName: string;
    productSku: string;
    productSkuId: Id<"productSku">;
    quantity: number;
    spend: number;
  }>;
};

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) {
      return null;
    }
    total += value;
  }
  return total;
}

function coverage(usableDayCount: number, scheduledDayCount: number) {
  return {
    scheduledDayCount,
    status:
      usableDayCount === 0
        ? ("unavailable" as const)
        : usableDayCount === scheduledDayCount
          ? ("complete" as const)
          : ("partial" as const),
    usableDayCount,
  };
}

function completeExpenseEvidence(value: unknown): CompleteExpenseEvidence | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.contractVersion !== 1 ||
    candidate.status !== "complete" ||
    !isNonnegativeSafeInteger(candidate.expenseTotal) ||
    !isNonnegativeSafeInteger(candidate.sourceItemCount) ||
    !isNonnegativeSafeInteger(candidate.sourceTransactionCount) ||
    !Array.isArray(candidate.products)
  ) {
    return null;
  }
  const seen = new Set<string>();
  const products: CompleteExpenseEvidence["products"] = [];
  for (const raw of candidate.products) {
    if (!raw || typeof raw !== "object") return null;
    const product = raw as Record<string, unknown>;
    const productSkuId = String(product.productSkuId ?? "").trim();
    if (
      !productSkuId ||
      seen.has(productSkuId) ||
      typeof product.productName !== "string" ||
      !product.productName.trim() ||
      typeof product.productSku !== "string" ||
      !isNonnegativeSafeInteger(product.quantity) ||
      !isNonnegativeSafeInteger(product.spend)
    ) {
      return null;
    }
    seen.add(productSkuId);
    products.push({
      productName: product.productName,
      productSku: product.productSku,
      productSkuId: productSkuId as Id<"productSku">,
      quantity: product.quantity,
      spend: product.spend,
    });
  }
  const productSpend = safeSum(products.map((product) => product.spend));
  if (productSpend === null || productSpend !== candidate.expenseTotal) {
    return null;
  }
  return { expenseTotal: candidate.expenseTotal, products };
}

function remainder(
  allRows: readonly WeeklyExpenseProductRow[],
  rankedRows: readonly WeeklyExpenseProductRow[],
): WeeklyExpenseRemainder | null {
  if (allRows.length === rankedRows.length) return null;
  const rankedIds = new Set(rankedRows.map((row) => String(row.productSkuId)));
  const omitted = allRows.filter(
    (row) => !rankedIds.has(String(row.productSkuId)),
  );
  const quantity = safeSum(omitted.map((row) => row.quantity));
  const spendMinor = safeSum(omitted.map((row) => row.spendMinor));
  if (quantity === null || spendMinor === null) return null;
  return { productCount: omitted.length, quantity, spendMinor };
}

/**
 * Fold scheduled, resolved Daily Close snapshots into the one persisted weekly
 * close-evidence contract. Every lane validates and counts coverage separately.
 */
export function aggregateWeeklyCloseEvidence(args: {
  closes: ReadonlyMap<string, CloseSnapshot>;
  days: readonly {
    closeId?: Id<"dailyClose">;
    operatingDate: string;
  }[];
  scheduledDates: readonly string[];
}): WeeklyCloseEvidence {
  const scheduled = new Set(args.scheduledDates);
  const scheduledDayCount = scheduled.size;
  const resolvedCloses = args.days
    .filter((day) => scheduled.has(day.operatingDate) && day.closeId)
    .sort((left, right) => left.operatingDate.localeCompare(right.operatingDate))
    .flatMap((day) => {
      const close = args.closes.get(String(day.closeId));
      return close &&
        close.operatingDate === day.operatingDate &&
        close.status === "completed" &&
        close.lifecycleStatus !== "superseded" &&
        close.lifecycleStatus !== "reopened"
        ? [close]
        : [];
    });

  const cashValues = resolvedCloses.flatMap((close) => {
    const value = close.reportSnapshot?.summary?.netCashVariance;
    return Number.isSafeInteger(value) ? [value as number] : [];
  });
  const cashTotal = safeSum(cashValues);

  const transactionValues = resolvedCloses.flatMap((close) => {
    const value = close.reportSnapshot?.summary?.transactionCount;
    return isNonnegativeSafeInteger(value) ? [value] : [];
  });
  const transactionTotal = safeSum(transactionValues);

  const paymentDays: Array<
    Array<{ amountMinor: number; method: string; tenderUseCount: number }>
  > = [];
  let paymentEvidenceValid = true;
  for (const close of resolvedCloses) {
    const rawTotals = close.reportSnapshot?.summary?.paymentTotals;
    if (!Array.isArray(rawTotals)) continue;
    const methods = new Set<string>();
    const rows: (typeof paymentDays)[number] = [];
    let valid = true;
    for (const raw of rawTotals) {
      if (!raw || typeof raw !== "object") {
        valid = false;
        break;
      }
      const row = raw as Record<string, unknown>;
      const method = typeof row.method === "string" ? row.method.trim() : "";
      if (
        !method ||
        // Labels that collapse under normalization are the same tender; a day
        // certifying both "Cash" and "cash" is malformed, not two rows.
        methods.has(method.toLowerCase()) ||
        !isNonnegativeSafeInteger(row.amount) ||
        !isNonnegativeSafeInteger(row.transactionCount)
      ) {
        valid = false;
        break;
      }
      methods.add(method.toLowerCase());
      rows.push({
        amountMinor: row.amount,
        method,
        tenderUseCount: row.transactionCount,
      });
    }
    if (!valid) {
      paymentEvidenceValid = false;
    } else if (
      safeSum(rows.map((row) => row.amountMinor)) !== null &&
      safeSum(rows.map((row) => row.tenderUseCount)) !== null
    ) {
      paymentDays.push(rows);
    } else {
      paymentEvidenceValid = false;
    }
  }

  // Keyed by the case-insensitive canonical method so "Cash" and "cash"
  // frozen on different days aggregate as one tender. The display label
  // follows the frozen-identity rule the expense rows already use: the
  // latest covered close's spelling wins (days arrive in date order).
  const paymentsByMethod = new Map<
    string,
    { amountMinor: number; method: string; tenderUseCount: number }
  >();
  let paymentArithmeticValid = paymentEvidenceValid;
  for (const rows of paymentDays) {
    for (const row of rows) {
      const canonicalMethod = row.method.toLowerCase();
      const existing = paymentsByMethod.get(canonicalMethod) ?? {
        amountMinor: 0,
        tenderUseCount: 0,
      };
      const amountMinor = safeSum([existing.amountMinor, row.amountMinor]);
      const tenderUseCount = safeSum([
        existing.tenderUseCount,
        row.tenderUseCount,
      ]);
      if (amountMinor === null || tenderUseCount === null) {
        paymentArithmeticValid = false;
        break;
      }
      paymentsByMethod.set(canonicalMethod, {
        amountMinor,
        method: row.method,
        tenderUseCount,
      });
    }
  }
  const tenderTotal = paymentArithmeticValid
    ? safeSum(Array.from(paymentsByMethod.values(), (row) => row.amountMinor))
    : null;
  const paymentRows =
    tenderTotal === null
      ? []
      : Array.from(paymentsByMethod, ([canonicalMethod, row]) => ({
          ...row,
          canonicalMethod,
          shareBasisPoints:
            tenderTotal === 0
              ? 0
              : Number(
                  (BigInt(row.amountMinor) * 10_000n +
                    BigInt(tenderTotal) / 2n) /
                    BigInt(tenderTotal),
                ),
        }))
          .sort(
            (left, right) =>
              right.amountMinor - left.amountMinor ||
              left.canonicalMethod.localeCompare(right.canonicalMethod),
          )
          .map(({ canonicalMethod: _canonicalMethod, ...row }) => row);

  const expenseDays = resolvedCloses.flatMap((close) => {
    const evidence = completeExpenseEvidence(
      close.reportSnapshot?.expenseProductEvidence,
    );
    return evidence ? [evidence] : [];
  });
  const expensesBySku = new Map<string, WeeklyExpenseProductRow>();
  let expenseArithmeticValid = true;
  for (const evidence of expenseDays) {
    for (const product of evidence.products) {
      const existing = expensesBySku.get(String(product.productSkuId));
      const quantity = safeSum([existing?.quantity ?? 0, product.quantity]);
      const spendMinor = safeSum([existing?.spendMinor ?? 0, product.spend]);
      if (quantity === null || spendMinor === null) {
        expenseArithmeticValid = false;
        break;
      }
      expensesBySku.set(String(product.productSkuId), {
        productName: product.productName,
        productSku: product.productSku,
        productSkuId: product.productSkuId,
        quantity,
        spendMinor,
      });
    }
  }
  const expenseRows = expenseArithmeticValid
    ? Array.from(expensesBySku.values())
    : [];
  const coveredSpendMinor = expenseArithmeticValid
    ? safeSum(expenseDays.map((day) => day.expenseTotal))
    : null;
  const coveredQuantity = expenseArithmeticValid
    ? safeSum(expenseRows.map((row) => row.quantity))
    : null;
  const bySpend = [...expenseRows]
    .sort(
      (left, right) =>
        right.spendMinor - left.spendMinor ||
        right.quantity - left.quantity ||
        String(left.productSkuId).localeCompare(String(right.productSkuId)),
    )
    .slice(0, 5);
  const byQuantity = [...expenseRows]
    .sort(
      (left, right) =>
        right.quantity - left.quantity ||
        right.spendMinor - left.spendMinor ||
        String(left.productSkuId).localeCompare(String(right.productSkuId)),
    )
    .slice(0, 5);

  return {
    cash: {
      cashVarianceMinor: cashTotal ?? 0,
      coverage: coverage(cashTotal === null ? 0 : cashValues.length, scheduledDayCount),
    },
    transactions: {
      coverage: coverage(
        transactionTotal === null ? 0 : transactionValues.length,
        scheduledDayCount,
      ),
      transactionCount: transactionTotal ?? 0,
    },
    payments: {
      coveredTenderValueMinor: tenderTotal ?? 0,
      coverage: coverage(tenderTotal === null ? 0 : paymentDays.length, scheduledDayCount),
      rows: paymentRows,
    },
    expenses: {
      byQuantity,
      bySpend,
      coveredQuantity: coveredQuantity ?? 0,
      coveredSpendMinor: coveredSpendMinor ?? 0,
      coverage: coverage(
        coveredSpendMinor === null || coveredQuantity === null
          ? 0
          : expenseDays.length,
        scheduledDayCount,
      ),
      quantityRemainder: remainder(expenseRows, byQuantity),
      spendRemainder: remainder(expenseRows, bySpend),
    },
  };
}
