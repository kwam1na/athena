import { render } from "@react-email/components";

import ExpenseReceiptEmail from "~/convex/emails/ExpenseReceiptEmail";
import config from "~/src/config";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import { capitalizeWords } from "~/src/lib/utils";
import type { CartItem } from "@/components/pos/types";

interface ExpenseReceiptStore {
  name?: string | null;
  config?: unknown;
}

export interface ExpenseReceiptData {
  store: ExpenseReceiptStore;
  formatter: Intl.NumberFormat;
  reportNumber: string;
  completedAt: Date | number;
  recordedBy?: string | null;
  registerNumber?: string | null;
  cartItems: CartItem[];
  totalValue: number;
  notes?: string | null;
}

function formatReceiptWebsite(url: string) {
  return url.replace(/^https?:\/\//, (protocol) =>
    protocol === "https://" ? "www." : "",
  );
}

function parseReceiptLocation(location?: string) {
  const parts =
    location
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean) ?? [];

  if (parts.length === 0) {
    return {};
  }

  const [street, city, third, fourth, ...rest] = parts;

  if (parts.length === 4) {
    return {
      street,
      city,
      state: third,
      country: fourth,
    };
  }

  return {
    street,
    city,
    state: third,
    zipCode: fourth,
    country: rest.join(", ") || undefined,
  };
}

export async function buildExpenseReceiptHtml({
  store,
  formatter,
  reportNumber,
  completedAt,
  recordedBy,
  registerNumber,
  cartItems,
  totalValue,
  notes,
}: ExpenseReceiptData) {
  const completedAtDate =
    completedAt instanceof Date ? completedAt : new Date(completedAt);
  const storeContact = getStoreConfigV2(store).contact;
  const { street, city, state, zipCode, country } = parseReceiptLocation(
    storeContact.location,
  );

  const receiptItems = cartItems.map((item) => {
    const attributeParts: string[] = [];
    if (item.size) {
      attributeParts.push(`${item.size}`);
    }
    if (item.length) {
      attributeParts.push(`${item.length}"`);
    }
    if (item.color) {
      attributeParts.push(item.color);
    }

    return {
      name: capitalizeWords(item.name),
      totalPrice: formatStoredAmount(formatter, item.price * item.quantity),
      quantityLabel: `${item.quantity} × ${formatStoredAmount(formatter, item.price)}`,
      skuOrBarcode: item.sku || item.barcode,
      attributes:
        attributeParts.length > 0 ? attributeParts.join(" • ") : undefined,
    };
  });

  const receiptHTML = await render(
    <ExpenseReceiptEmail
      storeName={store.name || "Store Name"}
      storeContact={{
        street,
        city,
        state,
        zipCode,
        country,
        phone: storeContact.phoneNumber,
        website: formatReceiptWebsite(config.storeFrontUrl),
      }}
      reportNumber={reportNumber}
      completedDate={completedAtDate.toLocaleDateString()}
      completedTime={completedAtDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })}
      itemsCount={cartItems.reduce((sum, item) => sum + item.quantity, 0)}
      recordedBy={recordedBy || "Unassigned"}
      registerNumber={registerNumber || undefined}
      items={receiptItems}
      total={formatStoredAmount(formatter, totalValue)}
      notes={notes}
    />,
  );

  return receiptHTML;
}
