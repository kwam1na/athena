import { describe, expect, it } from "vitest";

import { getLocalDateFromOperatingDate } from "@/lib/operations/operatingDate";
import {
  getSharedDemoHistoricalDayFixture,
  getSharedDemoHistoryStartOperatingDate,
  SHARED_DEMO_HISTORY_DAYS,
} from "./sharedDemoOperationsFixture";
import {
  createSharedDemoTransactionFixtures,
  getSharedDemoTransactionFixture,
  isSharedDemoTransactionFixtureId,
} from "./sharedDemoTransactionsFixture";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";

const TODAY = "2026-07-21";

function shiftOperatingDate(operatingDate: string, days: number) {
  const date = getLocalDateFromOperatingDate(operatingDate)!;
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) =>
      index === 0 ? String(part) : String(part).padStart(2, "0"),
    )
    .join("-");
}

function operatingDateForTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) =>
      index === 0 ? String(part) : String(part).padStart(2, "0"),
    )
    .join("-");
}

describe("shared demo transaction fixtures", () => {
  it("reconciles completed transactions to every historical operations day", () => {
    const transactions = createSharedDemoTransactionFixtures(TODAY);
    const historyStart = getSharedDemoHistoryStartOperatingDate(TODAY);

    for (let offset = 0; offset < SHARED_DEMO_HISTORY_DAYS; offset += 1) {
      const operatingDate = shiftOperatingDate(historyStart, offset);
      const metric = getSharedDemoHistoricalDayFixture(operatingDate, TODAY)!;
      const completed = transactions.filter(
        (transaction) =>
          transaction.status === "completed" &&
          operatingDateForTimestamp(transaction.completedAt) === operatingDate,
      );

      expect(completed).toHaveLength(metric.transactionCount);
      expect(
        completed.reduce((sum, transaction) => sum + transaction.total, 0),
      ).toBe(metric.salesTotal);
      expect(
        completed.reduce((sum, transaction) => sum + transaction.itemCount, 0),
      ).toBe(metric.totalItemsSold);

      for (const payment of metric.paymentTotals) {
        const matching = completed.filter(
          (transaction) => transaction.paymentMethod === payment.method,
        );
        expect(matching).toHaveLength(payment.transactionCount);
        expect(
          matching.reduce((sum, transaction) => sum + transaction.total, 0),
        ).toBe(payment.amount);
      }
    }
  });

  it("builds credible read-only details and one excluded void", () => {
    const transactions = createSharedDemoTransactionFixtures(TODAY);
    const completed = transactions.filter(
      (transaction) => transaction.status === "completed",
    );
    const voided = transactions.filter(
      (transaction) => transaction.status === "void",
    );

    expect(voided).toHaveLength(1);
    expect(voided[0]?.voidReason).toBe("Sale entered twice");

    for (const transaction of completed) {
      expect(transaction.transactionNumber).toMatch(/^\d{6}$/);
      expect(transaction.cashierName).toBe("Afua O.");
      expect(transaction.customerName).toBeNull();
      expect(transaction.customerInfo).toBeUndefined();
      expect(transaction.payments).toEqual([
        {
          amount: transaction.total,
          method: transaction.paymentMethod,
          timestamp: transaction.completedAt,
        },
      ]);
      expect(
        transaction.items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0,
        ),
      ).toBe(transaction.total);
      expect(
        transaction.items.reduce((sum, item) => sum + item.quantity, 0),
      ).toBe(transaction.itemCount);
      for (const item of transaction.items) {
        const product = SHARED_DEMO_PRODUCTS.find(
          (candidate) => candidate.sku === item.productSku,
        );
        expect(product).toBeDefined();
        expect(item.unitPrice).toBe(product!.price);
        expect(item.image).toContain("/styled-props-plaster/");
        expect(item.image).toContain(product!.imageFilename);
      }
    }

    const example = completed[0]!;
    expect(isSharedDemoTransactionFixtureId(example._id)).toBe(true);
    expect(getSharedDemoTransactionFixture(example._id, TODAY)).toEqual(example);
  });
});
