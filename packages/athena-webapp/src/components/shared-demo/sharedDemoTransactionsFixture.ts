import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import {
  getSharedDemoHistoricalDayFixture,
  getSharedDemoHistoryStartOperatingDate,
  SHARED_DEMO_HISTORY_DAYS,
} from "./sharedDemoOperationsFixture";
import {
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STAFF_STORY,
  SHARED_DEMO_TERMINAL_DISPLAY_NAME,
  sharedDemoStaffShortName,
} from "~/shared/sharedDemoStory";
import type { Id } from "~/convex/_generated/dataModel";
import sheaButterImage from "~/assets/shared-demo-products/styled-props-plaster/demo-shea-250.webp";
import blackSoapImage from "~/assets/shared-demo-products/styled-props-plaster/demo-soap-bar.webp";
import clayMugImage from "~/assets/shared-demo-products/styled-props-plaster/demo-clay-mug.webp";
import bolgaBasketImage from "~/assets/shared-demo-products/styled-props-plaster/demo-bolga-basket.webp";
import soyCandleImage from "~/assets/shared-demo-products/styled-props-plaster/demo-soy-candle.webp";
import kenteScarfImage from "~/assets/shared-demo-products/styled-props-plaster/demo-kente-scarf.webp";
import batikToteImage from "~/assets/shared-demo-products/styled-props-plaster/demo-batik-tote.webp";
import beadedBraceletImage from "~/assets/shared-demo-products/styled-props-plaster/demo-bead-bracelet.webp";

const FIXTURE_TRANSACTION_ID_PREFIX = "shared-demo-pos-";
const FIXTURE_TRANSACTION_NUMBER_START = 640_000;
const VOIDED_DAY_OFFSET = 8;
const PRODUCT_PRICE_UNIT = 500;

const SHARED_DEMO_PRODUCT_IMAGES: Record<string, string> = {
  "demo-shea-250.webp": sheaButterImage,
  "demo-soap-bar.webp": blackSoapImage,
  "demo-clay-mug.webp": clayMugImage,
  "demo-bolga-basket.webp": bolgaBasketImage,
  "demo-soy-candle.webp": soyCandleImage,
  "demo-kente-scarf.webp": kenteScarfImage,
  "demo-batik-tote.webp": batikToteImage,
  "demo-bead-bracelet.webp": beadedBraceletImage,
};
const transactionFixtureCache = new Map<
  string,
  SharedDemoTransactionFixture[]
>();

type FixturePaymentMethod = "cash" | "card" | "mobile_money";

export type SharedDemoTransactionFixture = {
  _id: Id<"posTransaction">;
  transactionNumber: string;
  subtotal: number;
  tax: number;
  total: number;
  totalPaid: number;
  changeGiven: number;
  paymentMethod: FixturePaymentMethod;
  paymentMethods: FixturePaymentMethod[];
  hasMultiplePaymentMethods: false;
  payments: Array<{
    amount: number;
    method: FixturePaymentMethod;
    timestamp: number;
  }>;
  cashier: {
    firstName: string;
    fullName: string;
    lastName: string;
  };
  cashierName: string;
  customer: null;
  customerInfo: undefined;
  customerName: null;
  itemCount: number;
  serviceLineCount: 0;
  items: Array<{
    _id: string;
    barcode: string;
    image: string;
    productId: Id<"product">;
    productName: string;
    productSku: string;
    productSkuId: Id<"productSku">;
    quantity: number;
    totalPrice: number;
    unitPrice: number;
  }>;
  completedAt: number;
  hasTrace: false;
  sessionTraceId: null;
  status: "completed" | "void";
  voidedAt: number | null;
  voidReason: string | null;
  terminalId: Id<"posTerminal">;
  terminalName: string;
  registerNumber: string;
  registerSessionId: Id<"registerSession">;
  registerSessionStatus: "closed";
  adjustments: [];
  correctionHistory: [];
  canVoid: false;
  voidEligibility: { eligible: false };
};

function formatOperatingDate(date: Date) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 10);
}

function shiftOperatingDate(operatingDate: string, days: number) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  date.setDate(date.getDate() + days);
  return formatOperatingDate(date);
}

function operatingDateTimestamp(
  operatingDate: string,
  index: number,
  count: number,
) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);

  const openingMinutes = 9 * 60 + 40;
  const tradingMinutes = 8 * 60;
  const completedMinutes =
    openingMinutes + Math.round(((index + 1) / (count + 1)) * tradingMinutes);
  date.setHours(Math.floor(completedMinutes / 60), completedMinutes % 60, 0, 0);
  return date.getTime();
}

function findProductMix(amount: number, itemCount: number, seed: number) {
  if (amount % PRODUCT_PRICE_UNIT !== 0) return undefined;
  const target = amount / PRODUCT_PRICE_UNIT;
  const productOrder = Array.from(
    { length: SHARED_DEMO_PRODUCTS.length },
    (_, index) => (index + seed) % SHARED_DEMO_PRODUCTS.length,
  );
  let states = new Map<number, number[]>([[0, []]]);

  for (let count = 0; count < itemCount; count += 1) {
    const next = new Map<number, number[]>();
    for (const [current, products] of states) {
      for (const productIndex of productOrder) {
        const product = SHARED_DEMO_PRODUCTS[productIndex]!;
        const nextTotal = current + product.price / PRODUCT_PRICE_UNIT;
        if (nextTotal <= target && !next.has(nextTotal)) {
          next.set(nextTotal, [...products, productIndex]);
        }
      }
    }
    states = next;
  }

  return states.get(target);
}

function orderedItemCountCandidates({
  amount,
  maximum,
  minimum,
  salesTotal,
  totalItems,
}: {
  amount: number;
  maximum: number;
  minimum: number;
  salesTotal: number;
  totalItems: number;
}) {
  const ideal = Math.round((totalItems * amount) / salesTotal);
  return Array.from(
    { length: Math.max(0, maximum - minimum + 1) },
    (_, index) => minimum + index,
  ).sort(
    (first, second) =>
      Math.abs(first - ideal) - Math.abs(second - ideal) || first - second,
  );
}

function buildPaymentProductMixes(day: {
  paymentTotals: Array<{
    amount: number;
    method: string;
    transactionCount: number;
  }>;
  salesTotal: number;
  totalItemsSold: number;
}) {
  const [first, second, third] = day.paymentTotals;
  if (!first || !second || !third) {
    throw new Error("Shared demo trading days require three payment methods.");
  }

  const firstCandidates = orderedItemCountCandidates({
    amount: first.amount,
    maximum:
      day.totalItemsSold -
      second.transactionCount -
      third.transactionCount,
    minimum: first.transactionCount,
    salesTotal: day.salesTotal,
    totalItems: day.totalItemsSold,
  });

  for (const firstItemCount of firstCandidates) {
    const secondCandidates = orderedItemCountCandidates({
      amount: second.amount,
      maximum:
        day.totalItemsSold - firstItemCount - third.transactionCount,
      minimum: second.transactionCount,
      salesTotal: day.salesTotal,
      totalItems: day.totalItemsSold,
    });

    for (const secondItemCount of secondCandidates) {
      const thirdItemCount =
        day.totalItemsSold - firstItemCount - secondItemCount;
      const mixes = [
        findProductMix(first.amount, firstItemCount, 0),
        findProductMix(second.amount, secondItemCount, 3),
        findProductMix(third.amount, thirdItemCount, 5),
      ];

      if (mixes.every((mix) => mix !== undefined)) {
        return mixes as [number[], number[], number[]];
      }
    }
  }

  throw new Error("Shared demo product prices cannot reconcile this store day.");
}

function distributeProducts(
  productIndices: number[],
  transactionCount: number,
  seed: number,
) {
  const products = [...productIndices];
  for (let index = products.length - 1; index > 0; index -= 1) {
    const swapIndex = (seed * 17 + index * 11) % (index + 1);
    [products[index], products[swapIndex]] = [
      products[swapIndex]!,
      products[index]!,
    ];
  }

  const transactions = Array.from(
    { length: transactionCount },
    () => [] as number[],
  );
  products.forEach((productIndex, index) => {
    transactions[index % transactionCount]!.push(productIndex);
  });
  return transactions;
}

function buildItems({
  productIndices,
  transactionId,
}: {
  productIndices: number[];
  transactionId: string;
}): SharedDemoTransactionFixture["items"] {
  const quantities = new Map<number, number>();
  productIndices.forEach((productIndex) => {
    quantities.set(productIndex, (quantities.get(productIndex) ?? 0) + 1);
  });

  return [...quantities.entries()].map(([productIndex, quantity], index) => {
    const product = SHARED_DEMO_PRODUCTS[productIndex]!;
    return {
      _id: `${transactionId}-item-${index + 1}`,
      barcode: "",
      image: SHARED_DEMO_PRODUCT_IMAGES[product.imageFilename]!,
      productId: `shared-demo-product-${product.slug}` as Id<"product">,
      productName: product.name,
      productSku: product.sku,
      productSkuId: `shared-demo-sku-${product.slug}` as Id<"productSku">,
      quantity,
      totalPrice: product.price * quantity,
      unitPrice: product.price,
    };
  });
}

function buildTransaction({
  completedAt,
  dayOffset,
  index,
  method,
  operatingDate,
  productIndices,
  status = "completed",
}: {
  completedAt: number;
  dayOffset: number;
  index: number;
  method: FixturePaymentMethod;
  operatingDate: string;
  productIndices: number[];
  status?: "completed" | "void";
}): SharedDemoTransactionFixture {
  const suffix = `${operatingDate.replaceAll("-", "")}-${String(index + 1).padStart(3, "0")}`;
  const transactionId = `${FIXTURE_TRANSACTION_ID_PREFIX}${suffix}`;
  const transactionNumber = String(
    FIXTURE_TRANSACTION_NUMBER_START + dayOffset * 100 + index + 1,
  ).padStart(6, "0");
  const cashier = SHARED_DEMO_STAFF_STORY.cashier;
  const voidedAt = status === "void" ? completedAt + 25 * 60_000 : null;
  const items = buildItems({ productIndices, transactionId });
  const amount = items.reduce((sum, item) => sum + item.totalPrice, 0);

  return {
    _id: transactionId as Id<"posTransaction">,
    transactionNumber,
    subtotal: amount,
    tax: 0,
    total: amount,
    totalPaid: amount,
    changeGiven: 0,
    paymentMethod: method,
    paymentMethods: [method],
    hasMultiplePaymentMethods: false,
    payments: [{ amount, method, timestamp: completedAt }],
    cashier: {
      firstName: cashier.firstName,
      fullName: cashier.fullName,
      lastName: cashier.lastName,
    },
    cashierName: sharedDemoStaffShortName(cashier),
    customer: null,
    customerInfo: undefined,
    customerName: null,
    itemCount: productIndices.length,
    serviceLineCount: 0,
    items,
    completedAt,
    hasTrace: false,
    sessionTraceId: null,
    status,
    voidedAt,
    voidReason: status === "void" ? "Sale entered twice" : null,
    terminalId: "shared-demo-terminal" as Id<"posTerminal">,
    terminalName: SHARED_DEMO_TERMINAL_DISPLAY_NAME,
    registerNumber: "1",
    registerSessionId: `shared-demo-register-${operatingDate}` as Id<
      "registerSession"
    >,
    registerSessionStatus: "closed",
    adjustments: [],
    correctionHistory: [],
    canVoid: false,
    voidEligibility: { eligible: false },
  };
}

function buildDayTransactions(
  operatingDate: string,
  today: string,
  dayOffset: number,
) {
  const day = getSharedDemoHistoricalDayFixture(operatingDate, today);
  if (!day || day.transactionCount === 0) return [];

  const paymentProductMixes = buildPaymentProductMixes(day);
  let transactionIndex = 0;
  const transactions = day.paymentTotals.flatMap((payment, paymentIndex) =>
    distributeProducts(
      paymentProductMixes[paymentIndex]!,
      payment.transactionCount,
      dayOffset + paymentIndex,
    ).map((productIndices) => {
      const index = transactionIndex;
      transactionIndex += 1;
      return buildTransaction({
        completedAt: operatingDateTimestamp(
          operatingDate,
          index,
          day.transactionCount,
        ),
        dayOffset,
        index,
        method: payment.method as FixturePaymentMethod,
        operatingDate,
        productIndices,
      });
    }),
  );

  if (dayOffset === VOIDED_DAY_OFFSET) {
    transactions.push(
      buildTransaction({
        completedAt: operatingDateTimestamp(
          operatingDate,
          day.transactionCount,
          day.transactionCount + 1,
        ),
        dayOffset,
        index: day.transactionCount,
        method: "card",
        operatingDate,
        productIndices: [4],
        status: "void",
      }),
    );
  }

  return transactions;
}

export function createSharedDemoTransactionFixtures(
  today = getLocalOperatingDate(),
) {
  const cached = transactionFixtureCache.get(today);
  if (cached) return cached;

  const historyStart = getSharedDemoHistoryStartOperatingDate(today);

  const fixtures = Array.from(
    { length: SHARED_DEMO_HISTORY_DAYS },
    (_, dayOffset) =>
      buildDayTransactions(
        shiftOperatingDate(historyStart, dayOffset),
        today,
        dayOffset,
      ),
  )
    .flat()
    .sort((first, second) => second.completedAt - first.completedAt);
  transactionFixtureCache.set(today, fixtures);
  return fixtures;
}

export function isSharedDemoTransactionFixtureId(transactionId?: string) {
  return Boolean(transactionId?.startsWith(FIXTURE_TRANSACTION_ID_PREFIX));
}

export function getSharedDemoTransactionFixture(
  transactionId: string,
  today = getLocalOperatingDate(),
) {
  return createSharedDemoTransactionFixtures(today).find(
    (transaction) => transaction._id === transactionId,
  );
}
