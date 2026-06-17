import type { Id } from "~/convex/_generated/dataModel";

import type {
  CartItem,
  CustomerInfo,
  Payment,
} from "@/components/pos/types";
import type { PosPaymentMethod } from "@/lib/pos/domain";
import type { PosSessionCustomer } from "@/lib/pos/infrastructure/convex/sessionGateway";

import {
  EMPTY_REGISTER_CUSTOMER_INFO,
  type RegisterServiceLineState,
} from "./registerUiState";

export function buildServiceCheckoutBlockMessage(input: {
  customerInfo: CustomerInfo;
  serviceItems: RegisterServiceLineState[];
}) {
  if (input.serviceItems.length === 0) return undefined;

  if (!input.customerInfo.customerProfileId) {
    return "Customer required. Add a customer before checking out services.";
  }

  if (input.serviceItems.some((item) => !item.serviceCatalogId)) {
    return "Service unavailable. Remove the service line and add it again.";
  }

  if (
    input.serviceItems.some(
      (item) => item.pricingModel === "starting_at" && item.price <= 0,
    )
  ) {
    return "Service amount required. Enter the service amount before checkout.";
  }

  if (
    input.serviceItems.some(
      (item) =>
        item.pricingModel === "quote_after_consultation" && item.price <= 0,
    )
  ) {
    return "Quoted amount required. Enter the quoted amount before checkout.";
  }

  return undefined;
}

export function hasCustomerDetails(
  customer: CustomerInfo | undefined | null,
): boolean {
  if (!customer) {
    return false;
  }

  return Boolean(
    customer.customerProfileId ||
      customer.name.trim() ||
      customer.email.trim() ||
      customer.phone.trim(),
  );
}

export function mapSessionCustomer(customer: PosSessionCustomer): CustomerInfo {
  if (!customer) {
    return EMPTY_REGISTER_CUSTOMER_INFO;
  }

  return {
    customerProfileId: customer.customerProfileId,
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
  };
}

export function combinePaymentsByMethod(payments: Payment[]): Payment[] {
  return payments.reduce<Payment[]>((combinedPayments, payment) => {
    const existingPayment = combinedPayments.find(
      (candidate) => candidate.method === payment.method,
    );

    if (!existingPayment) {
      combinedPayments.push({ ...payment });
      return combinedPayments;
    }

    combinedPayments[combinedPayments.indexOf(existingPayment)] = {
      ...existingPayment,
      amount: existingPayment.amount + payment.amount,
      timestamp: Math.max(existingPayment.timestamp, payment.timestamp),
    };
    return combinedPayments;
  }, []);
}

export function isPosPaymentMethod(method: string): method is PosPaymentMethod {
  return method === "cash" || method === "card" || method === "mobile_money";
}

export function mapLocalPaymentToPayment(
  payment: {
    amount: number;
    id?: string;
    method: Payment["method"] | string;
    timestamp: number;
  },
  createPaymentId: () => string,
): Payment {
  const method = isPosPaymentMethod(payment.method) ? payment.method : "cash";

  return {
    id: payment.id ?? createPaymentId(),
    method,
    amount: payment.amount,
    timestamp: payment.timestamp,
  };
}

export function buildCompletedSalePayload(input: {
  cartItems: CartItem[];
  customerInfo: CustomerInfo;
  localReceiptNumber: string;
  localPosSessionId: string;
  localTransactionId: string;
  payments: Payment[];
  receiptNumber: string;
  serviceItems: RegisterServiceLineState[];
  totals: { subtotal: number; tax: number; total: number };
}) {
  const customer = hasCustomerDetails(input.customerInfo)
    ? input.customerInfo
    : null;

  return {
    localPosSessionId: input.localPosSessionId,
    localTransactionId: input.localTransactionId,
    localReceiptNumber: input.localReceiptNumber,
    receiptNumber: input.receiptNumber,
    customerProfileId: customer?.customerProfileId,
    customerName: customer?.name || undefined,
    customerEmail: customer?.email || undefined,
    customerPhone: customer?.phone || undefined,
    subtotal: input.totals.subtotal,
    tax: input.totals.tax,
    total: input.totals.total,
    items: input.cartItems.map((item) => ({
      localItemId: item.id.toString(),
      productId: item.productId,
      productSkuId: item.skuId,
      pendingCheckoutItemId:
        "pendingCheckoutItemId" in item
          ? (item.pendingCheckoutItemId ?? null)
          : null,
      inventoryImportProvisionalSkuId:
        "inventoryImportProvisionalSkuId" in item
          ? (item.inventoryImportProvisionalSkuId ?? null)
          : null,
      productSku: item.sku || "",
      barcode: item.barcode || null,
      productName: item.name,
      price: item.price,
      quantity: item.quantity,
      image: item.image || null,
    })),
    serviceLines:
      input.serviceItems.length > 0
        ? input.serviceItems.map((item) => ({
            localServiceLineId: item.id,
            serviceCatalogId: item.serviceCatalogId?.toString() ?? "",
            serviceCatalogName: item.name,
            serviceMode: item.serviceMode,
            pricingModel: item.pricingModel,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.price * item.quantity,
            ...(item.catalogUpdatedAt !== undefined
              ? { catalogUpdatedAt: item.catalogUpdatedAt }
              : {}),
            customerProfileId: customer?.customerProfileId,
          }))
        : undefined,
    payments: input.payments.map((payment) => ({
      localPaymentId: payment.id,
      method: payment.method,
      amount: payment.amount,
      timestamp: payment.timestamp,
    })),
  };
}

export function mapLocalServiceLineToState(line: {
  catalogUpdatedAt?: number;
  localServiceLineId: string;
  pricingModel: RegisterServiceLineState["pricingModel"];
  quantity: number;
  serviceCatalogId: string;
  serviceCatalogName: string;
  serviceMode: RegisterServiceLineState["serviceMode"];
  unitPrice: number;
}): RegisterServiceLineState {
  return {
    id: line.localServiceLineId,
    serviceCatalogId: line.serviceCatalogId as Id<"serviceCatalog">,
    name: line.serviceCatalogName,
    serviceMode: line.serviceMode,
    pricingModel: line.pricingModel,
    price: line.unitPrice,
    quantity: line.quantity,
    amountRequired:
      (line.pricingModel === "starting_at" ||
        line.pricingModel === "quote_after_consultation") &&
      line.unitPrice <= 0,
    catalogUpdatedAt: line.catalogUpdatedAt,
  };
}

export function matchingServiceLineDraft(
  drafts: RegisterServiceLineState[],
  service: {
    name: string;
    pricingModel: RegisterServiceLineState["pricingModel"];
    serviceCatalogId?: Id<"serviceCatalog">;
    serviceMode: RegisterServiceLineState["serviceMode"];
  },
) {
  const serviceCatalogId = service.serviceCatalogId?.toString();
  const normalizedName = service.name.trim().toLowerCase();

  return drafts.find((line) => {
    const lineCatalogId = line.serviceCatalogId?.toString();

    if (serviceCatalogId && lineCatalogId) {
      return serviceCatalogId === lineCatalogId;
    }

    if (serviceCatalogId || lineCatalogId) {
      return false;
    }

    return (
      line.name.trim().toLowerCase() === normalizedName &&
      line.serviceMode === service.serviceMode &&
      line.pricingModel === service.pricingModel
    );
  });
}

export function serviceLineStateToLocalPayload(
  line: RegisterServiceLineState,
) {
  return {
    localServiceLineId: line.id,
    serviceCatalogId: line.serviceCatalogId?.toString() ?? "",
    serviceCatalogName: line.name,
    serviceMode: line.serviceMode,
    pricingModel: line.pricingModel,
    quantity: line.quantity,
    unitPrice: line.price,
    totalPrice: line.price * line.quantity,
    ...(line.catalogUpdatedAt !== undefined
      ? { catalogUpdatedAt: line.catalogUpdatedAt }
      : {}),
  };
}

export function serviceLineStateToCartLine(line: RegisterServiceLineState) {
  return {
    lineKind: "service" as const,
    id: `service:${line.id}` as const,
    name: line.name,
    displayName: line.name,
    serviceCatalogId: line.serviceCatalogId as Id<"serviceCatalog">,
    serviceMode: line.serviceMode,
    pricingSource:
      line.pricingModel === "fixed"
        ? ("catalog_base_price" as const)
        : ("pos_entered" as const),
    unitPrice: line.price,
    price: line.price,
    quantity: line.quantity,
  };
}

export function completedCustomerInfo(customerInfo: CustomerInfo) {
  return hasCustomerDetails(customerInfo)
    ? {
        name: customerInfo.name,
        email: customerInfo.email,
        phone: customerInfo.phone,
      }
    : undefined;
}
