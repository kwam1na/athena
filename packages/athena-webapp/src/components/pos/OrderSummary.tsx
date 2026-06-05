import { useCallback, useEffect, useRef, useState } from "react";
import { render } from "@react-email/components";
import {
  Ban,
  Banknote,
  Check,
  CreditCard,
  Plus,
  Printer,
  Smartphone,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  calculatePosRemainingDue,
  calculatePosTotalPaid,
} from "@/lib/pos/domain";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { usePrint } from "~/src/hooks/usePrint";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import { capitalizeWords, cn } from "~/src/lib/utils";
import config from "~/src/config";
import PosReceiptEmail from "~/convex/emails/PosReceiptEmail";
import { currencyFormatter } from "~/shared/currencyFormatter";
import type { ReceiptMessagingConfig } from "./receipt/PosReceiptShareControl";
import type { Id } from "~/convex/_generated/dataModel";

import { PaymentView, type SelectedPaymentMethod } from "./PaymentView";
import { PaymentsAddedList } from "./PaymentsAddedList";
import type { CartItem, Payment, PosServiceReceiptLine } from "./types";

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

function formatServiceLabel(value?: string | null) {
  const label = value?.replaceAll("_", " ").trim();
  return label ? capitalizeWords(label) : null;
}

function formatServiceLineMeta(line: PosServiceReceiptLine) {
  if (line.serviceCaseUnavailable) {
    return "Service Case Unavailable";
  }

  return [
    formatServiceLabel(line.serviceCaseTitle),
    formatServiceLabel(line.serviceStatus),
    formatServiceLabel(line.servicePaymentStatus),
  ]
    .filter(Boolean)
    .join(" • ");
}

function formatProductLineMeta(
  item: CartItem,
  formatter: Intl.NumberFormat,
) {
  const skuOrBarcode = item.sku || item.barcode;

  return [
    `${item.quantity} x ${formatStoredAmount(formatter, item.price)}`,
    skuOrBarcode,
  ]
    .filter(Boolean)
    .join(" • ");
}

interface OrderSummaryProps {
  cartItems: CartItem[];
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  registerNumber?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  payments?: Payment[];
  hasTerminal?: boolean;
  isTransactionCompleted?: boolean;
  readOnly?: boolean;
  completedOrderNumber?: string | null;
  completionBlockMessage?: string;
  serviceLines?: PosServiceReceiptLine[];
  completedTransactionData?: {
    paymentMethod: string;
    payments?: Payment[];
    transactionId?: string;
    completedAt: Date | number;
    cartItems: CartItem[];
    serviceLines?: PosServiceReceiptLine[];
    subtotal: number;
    tax: number;
    total: number;
    status?: "completed" | "voided";
    customerInfo?: {
      name?: string;
      email?: string;
      phone?: string;
    };
  } | null;
  completedAdjustmentSummary?: {
    originalTotal: number;
    totalDelta: number;
    settlementAmount: number;
    settlementDirection: string;
    settlementMethod?: string;
  } | null;
  presentation?: "workspace" | "rail";
  cashierName?: string;
  receiptMessaging?: ReceiptMessagingConfig;
  actorStaffProfileId?: Id<"staffProfile"> | string | null;
  receiptNumberOverride?: string;
  onAddPayment?: (
    method: SelectedPaymentMethod,
    amount: number,
  ) => boolean | Promise<boolean>;
  onUpdatePayment?: (
    paymentId: string,
    amount: number,
  ) => boolean | Promise<boolean>;
  onRemovePayment?: (paymentId: string) => boolean | Promise<boolean>;
  onClearPayments?: () => boolean | Promise<boolean>;
  onCompleteTransaction?: () => Promise<boolean>;
  onStartNewTransaction?: () => void | Promise<void>;
  onVoidTransaction?: () => void | Promise<void>;
  onPaymentFlowChange?: (isActive: boolean) => void;
  onPaymentEntryStart?: () => void;
  onCompletionBlockAction?: () => void;
  onEditingPaymentChange?: (isEditing: boolean) => void;
  hidePaymentItemCountSummary?: boolean;
  hideActiveSummaryCards?: boolean;
  paymentsExpanded?: boolean;
  onPaymentsExpandedChange?: (isExpanded: boolean) => void;
}

const attemptedAutoPrintReceiptKeys = new Set<string>();
const AUTO_PRINT_COMPLETED_SALE_RECEIPTS = false;

export function clearAttemptedOrderSummaryAutoPrintReceiptKeysForTest() {
  attemptedAutoPrintReceiptKeys.clear();
}

export function OrderSummary({
  cartItems,
  customerInfo,
  registerNumber,
  subtotal: propSubtotal,
  total: propTotal,
  payments = [],
  hasTerminal = true,
  isTransactionCompleted = false,
  readOnly = false,
  completedOrderNumber,
  completionBlockMessage,
  serviceLines = [],
  completedTransactionData,
  completedAdjustmentSummary,
  presentation = "workspace",
  cashierName,
  receiptMessaging,
  actorStaffProfileId,
  receiptNumberOverride,
  onAddPayment,
  onUpdatePayment,
  onRemovePayment,
  onClearPayments,
  onCompleteTransaction,
  onStartNewTransaction,
  onVoidTransaction,
  onPaymentFlowChange,
  onPaymentEntryStart,
  onCompletionBlockAction,
  onEditingPaymentChange,
  hidePaymentItemCountSummary = false,
  hideActiveSummaryCards = false,
  paymentsExpanded,
  onPaymentsExpandedChange,
}: OrderSummaryProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const { printReceipt } = usePrint();
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<SelectedPaymentMethod | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [paymentAmountDraft, setPaymentAmountDraft] = useState<
    number | undefined
  >(undefined);
  const printedReceiptKeyRef = useRef<string | null>(null);

  const effectiveCartItems =
    completedTransactionData?.cartItems && (readOnly || isTransactionCompleted)
      ? completedTransactionData.cartItems
      : cartItems;
  const effectiveServiceLines =
    completedTransactionData?.serviceLines &&
    (readOnly || isTransactionCompleted)
      ? completedTransactionData.serviceLines
      : serviceLines;
  const completedServiceLines = completedTransactionData?.serviceLines ?? [];
  const completedProductLines = completedTransactionData
    ? effectiveCartItems.filter((item) => item.lineKind !== "service")
    : [];
  const showCompletedLineSections = Boolean(completedTransactionData) && !readOnly;
  const serviceLinesCount = effectiveServiceLines.reduce(
    (sum, line) => sum + (line.quantity ?? 1),
    0,
  );
  const effectiveCustomerInfo =
    completedTransactionData?.customerInfo ?? customerInfo;
  const summarySubtotal =
    completedTransactionData?.subtotal ?? propSubtotal ?? 0;
  const total = completedTransactionData?.total ?? propTotal ?? 0;
  const totalPaid = calculatePosTotalPaid(payments);
  const remainingDue = calculatePosRemainingDue(totalPaid, total);
  const completedTransactionAmountPaid = completedTransactionData
    ? calculatePosTotalPaid(completedTransactionData.payments ?? payments)
    : totalPaid;
  const completedTransactionChangeGiven =
    completedTransactionAmountPaid > total
      ? completedTransactionAmountPaid - total
      : 0;
  const hasCompletedTransactionChangeGiven =
    completedTransactionData !== undefined &&
    completedTransactionChangeGiven > 0;
  const completedTransactionPayments = completedTransactionData
    ? (completedTransactionData.payments ?? payments)
    : payments;
  const completedPaymentBreakdown = completedTransactionPayments.reduce<
    Array<{ amount: number; method: string }>
  >((breakdown, payment) => {
    const existingPayment = breakdown.find(
      (candidate) => candidate.method === payment.method,
    );

    if (existingPayment) {
      existingPayment.amount += payment.amount;
      return breakdown;
    }

    breakdown.push({
      amount: payment.amount,
      method: payment.method,
    });
    return breakdown;
  }, []);
  const showCompletedPaymentBreakdown =
    Boolean(completedTransactionData) && completedPaymentBreakdown.length > 1;
  const hasCompletedAdjustment = Boolean(completedAdjustmentSummary);
  const canVoidCompletedTransaction =
    Boolean(onVoidTransaction) &&
    !readOnly &&
    completedTransactionData?.status !== "voided";
  const completedSummaryTitle = hasCompletedAdjustment
    ? "Adjusted sale recorded"
    : "Sale recorded";
  const completedSummaryEyebrow = hasCompletedAdjustment
    ? "Adjusted transaction summary"
    : "Transaction summary";
  const completedTotalLabel = hasCompletedAdjustment
    ? "Adjusted total"
    : "Total";
  const isEditingPaymentAmount = editingPaymentId !== null;
  const cartItemsCount =
    effectiveCartItems.reduce((sum, item) => sum + item.quantity, 0) +
    serviceLinesCount;
  const completedAtDate = completedTransactionData?.completedAt
    ? completedTransactionData.completedAt instanceof Date
      ? completedTransactionData.completedAt
      : new Date(completedTransactionData.completedAt)
    : null;
  const completedDateLabel = completedAtDate
    ? completedAtDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Pending";
  const completedTimeLabel = completedAtDate
    ? completedAtDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "Pending";
  const completedTransactionPaymentMethods = completedTransactionData
    ? completedTransactionData.payments?.length
      ? completedTransactionData.payments.map((payment) => payment.method)
      : [completedTransactionData.paymentMethod]
    : payments.map((payment) => payment.method);
  const dedupedCompletedPaymentMethods = Array.from(
    new Set(completedTransactionPaymentMethods),
  );
  const summaryPaymentMethodLabel = dedupedCompletedPaymentMethods
    .map((method) => formatPaymentMethod(method))
    .join(", ");
  const summaryPaymentMethodValue =
    summaryPaymentMethodLabel || formatPaymentMethod("cash");
  const receiptLabel = readOnly
    ? (receiptNumberOverride ?? completedOrderNumber ?? "Transaction")
    : (completedOrderNumber ?? "Transaction");
  const effectiveReceiptMessaging = receiptMessaging
    ? {
        ...receiptMessaging,
        actorStaffProfileId:
          receiptMessaging.actorStaffProfileId ?? actorStaffProfileId,
        customerPhone:
          receiptMessaging.customerPhone ?? effectiveCustomerInfo?.phone,
        transactionId:
          receiptMessaging.transactionId ??
          completedTransactionData?.transactionId ??
          null,
        transactionNumber:
          receiptMessaging.transactionNumber ?? completedOrderNumber,
      }
    : completedTransactionData
      ? {
          actorStaffProfileId,
          customerPhone: effectiveCustomerInfo?.phone,
          transactionId: completedTransactionData.transactionId ?? null,
          transactionNumber: completedOrderNumber,
        }
      : null;
  void effectiveReceiptMessaging;
  const summaryRows = [
    { label: "Transaction", value: `#${receiptLabel}` },
    {
      label: "Completed",
      value: `${completedDateLabel} • ${completedTimeLabel}`,
    },
    {
      label: "Payment",
      value: summaryPaymentMethodValue,
    },
    {
      label: "Register",
      value: registerNumber ? `${registerNumber}` : "Unassigned",
    },
    {
      label: "Cashier",
      value: cashierName || "Unassigned",
    },
    {
      label: "Items",
      value: `${cartItemsCount} item${cartItemsCount === 1 ? "" : "s"}`,
    },
  ];

  const showPaymentButtons =
    !readOnly &&
    !isTransactionCompleted &&
    !isEditingPaymentAmount &&
    selectedPaymentMethod === null &&
    (payments.length === 0 || remainingDue > 0);
  const paymentMethodsDisabled =
    cartItemsCount === 0 || Boolean(completionBlockMessage);
  const showPaymentEditor =
    !readOnly &&
    !isTransactionCompleted &&
    !isEditingPaymentAmount &&
    !showPaymentButtons;
  const shouldDockPaymentButtons = showPaymentButtons;
  const shouldShowPaymentButtonBalance = payments.length === 0;
  const isPaymentEntryActive = showPaymentEditor;
  const isPaymentFlowActive =
    !readOnly &&
    !isTransactionCompleted &&
    (showPaymentEditor || payments.length > 0);
  const isPaymentAmountOverpaying =
    selectedPaymentMethod !== null &&
    paymentAmountDraft !== undefined &&
    paymentAmountDraft > remainingDue;
  const remainingAfterDraft =
    paymentAmountDraft !== undefined && selectedPaymentMethod !== null
      ? Math.max(remainingDue - paymentAmountDraft, 0)
      : remainingDue;
  const balanceDueLabel = isPaymentAmountOverpaying
    ? "Change due"
    : "Balance due";
  const balanceDueAmount = isPaymentAmountOverpaying
    ? paymentAmountDraft - remainingDue
    : remainingAfterDraft;
  const balanceDueToneClass = isPaymentAmountOverpaying
    ? "border-success/30 bg-success/10"
    : "border-transaction-signal/20 bg-transaction-signal/5";
  const balanceDueLabelClass = isPaymentAmountOverpaying
    ? "text-success"
    : "text-transaction-signal";
  const [completionBlockTitle, completionBlockDetail] = completionBlockMessage
    ? (() => {
        const [title, ...detailParts] = completionBlockMessage.split(". ");
        return [
          title.replace(/\.$/, ""),
          detailParts.join(". ").replace(/\.$/, "") ||
            "Add a customer to continue.",
        ];
      })()
    : [null, null];

  const completedAdjustmentSettlementLabel =
    completedAdjustmentSummary?.settlementDirection === "refund"
      ? "Refund due"
      : completedAdjustmentSummary?.settlementDirection === "collection" ||
          completedAdjustmentSummary?.settlementDirection === "collect"
        ? "Balance due"
        : "Adjustment settlement";
  const completedAdjustmentSettlementValue =
    completedAdjustmentSummary?.settlementDirection === "none"
      ? "No payment movement"
      : completedAdjustmentSummary
        ? [
            formatStoredAmount(
              formatter,
              completedAdjustmentSummary.settlementAmount,
            ),
            completedAdjustmentSummary.settlementMethod
              ? `via ${formatPaymentMethod(
                  completedAdjustmentSummary.settlementMethod,
                )}`
              : null,
          ]
            .filter(Boolean)
            .join(" ")
        : null;

  useEffect(() => {
    if (selectedPaymentMethod === null) {
      setPaymentAmountDraft(undefined);
    }

    onPaymentFlowChange?.(isPaymentEntryActive);
  }, [isPaymentEntryActive, onPaymentFlowChange, selectedPaymentMethod]);

  useEffect(() => {
    if (!completionBlockMessage || selectedPaymentMethod === null) {
      return;
    }

    setSelectedPaymentMethod(null);
    setPaymentAmountDraft(undefined);
    onPaymentFlowChange?.(false);
  }, [completionBlockMessage, onPaymentFlowChange, selectedPaymentMethod]);

  useEffect(() => {
    return () => onPaymentFlowChange?.(false);
  }, [onPaymentFlowChange]);

  useEffect(() => {
    return () => onEditingPaymentChange?.(false);
  }, [onEditingPaymentChange]);

  useEffect(() => {
    if (
      editingPaymentId !== null &&
      !payments.some((payment) => payment.id === editingPaymentId)
    ) {
      setEditingPaymentId(null);
      onEditingPaymentChange?.(false);
    }
  }, [editingPaymentId, onEditingPaymentChange, payments]);

  const handleCompleteTransaction = async () => {
    if (!onCompleteTransaction) {
      return;
    }

    setIsCompleting(true);
    try {
      const success = await onCompleteTransaction();
      if (success) {
        setSelectedPaymentMethod(null);
        onPaymentFlowChange?.(false);
      }
    } finally {
      setIsCompleting(false);
    }
  };

  const handleStartNewTransaction = () => {
    setSelectedPaymentMethod(null);
    onPaymentFlowChange?.(false);
    onStartNewTransaction?.();
  };

  const handleSelectedPaymentMethodChange = (
    method: SelectedPaymentMethod | null,
  ) => {
    if (method === null) {
      onPaymentFlowChange?.(false);
    }

    setSelectedPaymentMethod(method);
  };

  const handleEditingPaymentIdChange = (paymentId: string | null) => {
    setEditingPaymentId(paymentId);
    onEditingPaymentChange?.(paymentId !== null);
  };

  const completedReceiptKey =
    completedOrderNumber ??
    completedTransactionData?.transactionId ??
    completedAtDate?.toISOString() ??
    null;

  const handlePrintReceipt = useCallback(async () => {
    const completedData = completedTransactionData;
    if (!completedData || !activeStore) {
      return false;
    }

    try {
      const completedAtDate =
        completedData.completedAt instanceof Date
          ? completedData.completedAt
          : new Date(completedData.completedAt);

      const receiptProductItems = completedData.cartItems.map((item) => {
        const attributeParts: string[] = [];
        if (item.size) {
          attributeParts.push(`${item.size}`);
        }
        if (item.length) {
          attributeParts.push(`${item.length}"`);
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
      const receiptServiceItems = (completedData.serviceLines ?? []).map(
        (line) => ({
          name: formatServiceLabel(line.name) ?? line.name,
          totalPrice: formatStoredAmount(formatter, line.totalPrice),
          quantityLabel: `${line.quantity ?? 1} × ${formatStoredAmount(
            formatter,
            line.unitPrice ?? line.totalPrice,
          )}`,
          skuOrBarcode: line.serviceCaseId
            ? `Service case ${line.serviceCaseId}`
            : undefined,
          attributes:
            [
              line.serviceMode
                ? `Service mode: ${formatServiceLabel(line.serviceMode)}`
                : null,
              line.servicePaymentStatus
                ? `Payment: ${formatServiceLabel(line.servicePaymentStatus)}`
                : null,
            ]
              .filter(Boolean)
              .join(" • ") || undefined,
        }),
      );
      const receiptItems = [...receiptProductItems, ...receiptServiceItems];

      const paymentMethodLabel = formatPaymentMethod(
        completedData.paymentMethod,
      );
      const receiptPayments = completedData.payments ?? payments;
      const formattedPayments =
        receiptPayments.length > 0
          ? receiptPayments.map((payment) => ({
              method: payment.method,
              amount: formatStoredAmount(formatter, payment.amount),
            }))
          : undefined;
      const totalPaidFromPayments = receiptPayments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      const changeGiven =
        formattedPayments &&
        totalPaidFromPayments > completedData.total &&
        receiptPayments.length > 0
          ? formatStoredAmount(
              formatter,
              totalPaidFromPayments - completedData.total,
            )
          : undefined;

      const storeContact = getStoreConfigV2(activeStore).contact;
      const { street, city, state, zipCode, country } = parseReceiptLocation(
        storeContact.location,
      );

      const receiptHTML = await render(
        <PosReceiptEmail
          amountPaid={formatStoredAmount(
            formatter,
            totalPaidFromPayments || completedData.total,
          )}
          storeName={activeStore.name || "Store Name"}
          storeContact={
            activeStore.config
              ? {
                  street,
                  city,
                  state,
                  zipCode,
                  country,
                  phone: storeContact?.phoneNumber,
                  website: formatReceiptWebsite(config.storeFrontUrl),
                }
              : undefined
          }
          receiptNumber={
            readOnly
              ? (receiptNumberOverride ?? completedOrderNumber ?? "Transaction")
              : (completedOrderNumber ?? "Transaction")
          }
          completedDate={completedAtDate.toLocaleDateString()}
          completedTime={completedAtDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
          itemsCount={cartItemsCount}
          cashierName={cashierName || "Unassigned"}
          registerNumber={registerNumber || undefined}
          items={receiptItems}
          subtotal={formatStoredAmount(formatter, completedData.subtotal)}
          tax={
            completedData.tax > 0
              ? formatStoredAmount(formatter, completedData.tax)
              : undefined
          }
          total={formatStoredAmount(formatter, completedData.total)}
          paymentMethodLabel={paymentMethodLabel}
          payments={formattedPayments}
          changeGiven={changeGiven}
          statusLabel={completedData.status === "voided" ? "Voided" : undefined}
        />,
      );

      printReceipt(receiptHTML);
      return true;
    } catch (error) {
      console.error("Error in handlePrintReceipt:", error);
      return false;
    }
  }, [
    activeStore,
    cashierName,
    cartItemsCount,
    completedOrderNumber,
    completedTransactionData,
    formatter,
    payments,
    printReceipt,
    readOnly,
    receiptNumberOverride,
    registerNumber,
  ]);

  useEffect(() => {
    if (
      !AUTO_PRINT_COMPLETED_SALE_RECEIPTS ||
      readOnly ||
      !isTransactionCompleted ||
      !completedTransactionData ||
      !completedReceiptKey ||
      hasCompletedTransactionChangeGiven
    ) {
      printedReceiptKeyRef.current = null;
      return;
    }

    if (
      printedReceiptKeyRef.current === completedReceiptKey ||
      attemptedAutoPrintReceiptKeys.has(completedReceiptKey)
    ) {
      return;
    }

    printedReceiptKeyRef.current = completedReceiptKey;
    attemptedAutoPrintReceiptKeys.add(completedReceiptKey);
    void handlePrintReceipt().then((didPrint) => {
      if (!didPrint) {
        attemptedAutoPrintReceiptKeys.delete(completedReceiptKey);
        if (printedReceiptKeyRef.current === completedReceiptKey) {
          printedReceiptKeyRef.current = null;
        }
      }
    });
  }, [
    completedReceiptKey,
    completedTransactionData,
    handlePrintReceipt,
    hasCompletedTransactionChangeGiven,
    isTransactionCompleted,
    readOnly,
  ]);

  if ((readOnly || isTransactionCompleted) && presentation === "rail") {
    return (
      <section className="overflow-hidden rounded-[1.5rem] border border-border/80 bg-surface-raised shadow-surface">
        <div className="border-b border-border/70 bg-[linear-gradient(180deg,_hsl(var(--surface-raised)),_hsl(var(--surface)))] px-5 py-5">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]">
              <Check className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {completedSummaryEyebrow}
              </p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {completedSummaryTitle}
              </h2>
            </div>
          </div>
        </div>

        <dl className="space-y-4 px-5 py-5">
          {summaryRows.map((row) => (
            <div
              key={row.label}
              className="flex items-start justify-between gap-4 text-sm"
            >
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="max-w-[62%] text-right font-medium text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="space-y-6 border-t border-border/70 bg-surface px-5 py-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium text-foreground">
              {formatStoredAmount(formatter, summarySubtotal)}
            </span>
          </div>
          {showCompletedLineSections && completedProductLines.length > 0 ? (
            <div className="space-y-4 border-y border-border/70 py-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Product lines
              </p>
              <div className="space-y-4">
                {completedProductLines.map((item) => (
                  <div className="grid gap-1" key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-foreground">
                        {capitalizeWords(item.name)}
                      </span>
                      <span className="font-medium text-foreground">
                        {formatStoredAmount(
                          formatter,
                          item.price * item.quantity,
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatProductLineMeta(item, formatter)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {showCompletedLineSections && completedServiceLines.length > 0 ? (
            <div className="space-y-4 border-y border-border/70 py-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Service lines
              </p>
              <div className="space-y-4">
                {completedServiceLines.map((line) => {
                  const serviceMeta = formatServiceLineMeta(line);

                  return (
                    <div
                      className="grid gap-1"
                      key={`${line.id}-${line.serviceCaseId ?? "service"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 text-foreground">
                          {formatServiceLabel(line.name) ?? line.name}
                        </span>
                        <span className="font-medium text-foreground">
                          {formatStoredAmount(formatter, line.totalPrice)}
                        </span>
                      </div>
                      {serviceMeta ? (
                        <p className="text-xs text-muted-foreground">
                          {serviceMeta}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {completedTransactionData && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {hasCompletedAdjustment
                  ? "Original amount paid"
                  : "Amount paid"}
              </span>
              <span className="font-medium text-foreground">
                {formatStoredAmount(formatter, completedTransactionAmountPaid)}
              </span>
            </div>
          )}
          {completedAdjustmentSummary && (
            <div className="space-y-4 border-y border-border/70 py-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  Original sale total
                </span>
                <span className="font-medium text-foreground">
                  {formatStoredAmount(
                    formatter,
                    completedAdjustmentSummary.originalTotal,
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Item adjustment</span>
                <span className="font-medium text-foreground">
                  {completedAdjustmentSummary.totalDelta > 0 ? "+" : ""}
                  {formatStoredAmount(
                    formatter,
                    completedAdjustmentSummary.totalDelta,
                  )}
                </span>
              </div>
              {completedAdjustmentSettlementValue ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {completedAdjustmentSettlementLabel}
                  </span>
                  <span className="max-w-[58%] text-right font-medium text-foreground">
                    {completedAdjustmentSettlementValue}
                  </span>
                </div>
              ) : null}
            </div>
          )}
          {showCompletedPaymentBreakdown && (
            <div className="space-y-4 border-y border-border/70 py-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Payments
              </p>
              <div className="space-y-4">
                {completedPaymentBreakdown.map((payment) => (
                  <div
                    className="flex items-center justify-between gap-3"
                    key={payment.method}
                  >
                    <span className="text-muted-foreground">
                      {formatPaymentMethod(payment.method)}
                    </span>
                    <span className="font-medium text-foreground">
                      {formatStoredAmount(formatter, payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {completedTransactionData &&
            completedTransactionChangeGiven > 0 &&
            !hasCompletedAdjustment && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Change given</span>
                <span className="font-medium text-foreground">
                  {formatStoredAmount(
                    formatter,
                    completedTransactionChangeGiven,
                  )}
                </span>
              </div>
            )}
          <div className="flex items-baseline justify-between gap-4 pb-4">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {completedTotalLabel}
            </span>
            <span className="text-3xl font-semibold tracking-tight text-foreground">
              {formatStoredAmount(formatter, total)}
            </span>
          </div>
          <Button
            onClick={handlePrintReceipt}
            variant="outline"
            className="h-11 w-full rounded-xl border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] px-4 text-sm font-semibold text-white shadow-[hsl(var(--foreground))/0.18] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]"
          >
            <Printer className="h-4 w-4" />
            Print receipt
          </Button>
          {/* {shouldShowReceiptMessaging && effectiveReceiptMessaging ? (
            <PosReceiptShareControl
              compact
              messaging={effectiveReceiptMessaging}
            />
          ) : null} */}
        </div>
      </section>
    );
  }

  if (readOnly || isTransactionCompleted) {
    return (
      <div
        className={cn(
          "grid h-full min-h-0 flex-1 auto-rows-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]",
          !hasTerminal && !readOnly && "opacity-60 transition-all duration-300",
        )}
      >
        <section className="flex h-full min-h-0">
          <div className="relative flex h-full min-h-[36rem] flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/80 bg-[linear-gradient(145deg,hsl(var(--surface-raised))_0%,hsl(var(--surface))_52%,hsl(var(--muted)/0.72)_100%)] p-8 shadow-[var(--shadow-surface)] md:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
            />

            <div className="flex flex-1 flex-col">
              <div className="space-y-10">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] shadow-[0_20px_40px_-24px_hsl(var(--success)/0.75)] animate-[presence-lift_var(--motion-standard)_var(--ease-emphasized)_both]">
                  <Check className="h-7 w-7" />
                </div>

                <div className="max-w-2xl space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                    Sale complete
                  </p>
                  <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-[3rem]">
                    {readOnly ? "Sale recorded" : "Ready for next sale"}
                  </h2>
                </div>
              </div>

              <div className="mt-auto space-y-5">
                <div
                  className={cn(
                    "grid gap-3 md:gap-4",
                    hasCompletedTransactionChangeGiven
                      ? "md:grid-cols-6"
                      : "md:grid-cols-4",
                  )}
                >
                  <div className="rounded-lg border border-border/70 bg-surface-raised p-4 backdrop-blur-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Total
                    </p>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {formatStoredAmount(formatter, total)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-surface-raised p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Amount paid
                    </p>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {formatStoredAmount(
                        formatter,
                        completedTransactionAmountPaid,
                      )}
                    </p>
                  </div>
                  {hasCompletedTransactionChangeGiven && (
                    <div className="rounded-lg border border-success/30 bg-success/10 p-4 shadow-surface md:col-span-2">
                      <div className="flex h-full min-h-[5.25rem] flex-col justify-between">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-success">
                          Change given
                        </p>
                        <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                          {formatStoredAmount(
                            formatter,
                            completedTransactionChangeGiven,
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="rounded-lg border border-border/70 bg-surface-raised p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Customer
                    </p>
                    <p className="mt-3 text-sm font-medium text-foreground">
                      {effectiveCustomerInfo?.name ||
                        effectiveCustomerInfo?.email ||
                        "Walk-in customer"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-surface-raised p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Paid with
                    </p>
                    <div className="mt-3 flex flex-col gap-2 text-sm font-medium text-foreground">
                      {dedupedCompletedPaymentMethods.length > 0 ? (
                        dedupedCompletedPaymentMethods.map((method) => (
                          <p key={method}>{formatPaymentMethod(method)}</p>
                        ))
                      ) : (
                        <p>{formatPaymentMethod("cash")}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    "grid gap-3",
                    canVoidCompletedTransaction
                      ? "md:grid-cols-3"
                      : "md:grid-cols-2",
                  )}
                >
                  <Button
                    onClick={handlePrintReceipt}
                    variant="outline"
                    className="h-14 rounded-2xl border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] px-5 text-sm font-semibold text-white shadow-[hsl(var(--foreground))/0.18] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]"
                  >
                    <Printer className="h-4 w-4" />
                    Print receipt
                  </Button>
                  {!readOnly && (
                    <Button
                      onClick={handleStartNewTransaction}
                      variant="outline"
                      className="h-14 rounded-2xl border-border bg-background px-5 text-sm font-semibold"
                    >
                      <Plus className="h-4 w-4" />
                      New sale
                    </Button>
                  )}
                  {canVoidCompletedTransaction ? (
                    <Button
                      onClick={onVoidTransaction}
                      variant="outline"
                      className="h-14 rounded-2xl border-destructive/30 bg-destructive/5 px-5 text-sm font-semibold text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Ban className="h-4 w-4" />
                      Void sale
                    </Button>
                  ) : null}
                </div>
                {/* {shouldShowReceiptMessaging && effectiveReceiptMessaging ? (
                  <PosReceiptShareControl
                    messaging={effectiveReceiptMessaging}
                  />
                ) : null} */}
              </div>
            </div>
          </div>
        </section>

        <aside className="grid h-full min-h-0 gap-5">
          <section className="flex h-full min-h-0 flex-col rounded-[1.5rem] border border-border/80 bg-surface p-5 shadow-[var(--shadow-surface)]">
            <div className="border-b border-border/70 pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Transaction summary
              </p>
            </div>

            <dl className="flex-1 space-y-5 py-6">
              {summaryRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-start justify-between gap-4 text-sm"
                >
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="max-w-[60%] text-right font-medium text-foreground">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-auto space-y-3 border-t border-border/70 pt-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium text-foreground">
                  {formatStoredAmount(formatter, summarySubtotal)}
                </span>
              </div>
              {completedTransactionData && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Amount paid</span>
                  <span className="font-medium text-foreground">
                    {formatStoredAmount(
                      formatter,
                      completedTransactionAmountPaid,
                    )}
                  </span>
                </div>
              )}
              {showCompletedLineSections && completedProductLines.length > 0 ? (
                <div className="space-y-3 border-y border-border/70 py-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Product lines
                  </p>
                  <div className="space-y-3">
                    {completedProductLines.map((item) => (
                      <div className="grid gap-1" key={item.id}>
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 text-foreground">
                            {capitalizeWords(item.name)}
                          </span>
                          <span className="font-medium text-foreground">
                            {formatStoredAmount(
                              formatter,
                              item.price * item.quantity,
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatProductLineMeta(item, formatter)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {showCompletedLineSections && completedServiceLines.length > 0 ? (
                <div className="space-y-3 border-y border-border/70 py-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Service lines
                  </p>
                  <div className="space-y-3">
                    {completedServiceLines.map((line) => {
                      const serviceMeta = formatServiceLineMeta(line);

                      return (
                        <div
                          className="grid gap-1"
                          key={`${line.id}-${line.serviceCaseId ?? "service"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="min-w-0 text-foreground">
                              {formatServiceLabel(line.name) ?? line.name}
                            </span>
                            <span className="font-medium text-foreground">
                              {formatStoredAmount(formatter, line.totalPrice)}
                            </span>
                          </div>
                          {serviceMeta ? (
                            <p className="text-xs text-muted-foreground">
                              {serviceMeta}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {showCompletedPaymentBreakdown && (
                <div className="space-y-3 border-y border-border/70 py-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Payments
                  </p>
                  <div className="space-y-3">
                    {completedPaymentBreakdown.map((payment) => (
                      <div
                        className="flex items-center justify-between gap-3"
                        key={payment.method}
                      >
                        <span className="text-muted-foreground">
                          {formatPaymentMethod(payment.method)}
                        </span>
                        <span className="font-medium text-foreground">
                          {formatStoredAmount(formatter, payment.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {completedTransactionData &&
                completedTransactionChangeGiven > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Change given</span>
                    <span className="font-medium text-foreground">
                      {formatStoredAmount(
                        formatter,
                        completedTransactionChangeGiven,
                      )}
                    </span>
                  </div>
                )}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Total
                </span>
                <span className="text-3xl font-semibold tracking-tight text-foreground">
                  {formatStoredAmount(formatter, total)}
                </span>
              </div>
            </div>
          </section>

          {(effectiveCustomerInfo?.name ||
            effectiveCustomerInfo?.email ||
            effectiveCustomerInfo?.phone) && (
            <section className="rounded-[1.5rem] border border-border/80 bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-surface)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Customer
              </p>
              <div className="mt-4 space-y-1">
                <p className="text-lg font-semibold text-foreground">
                  {effectiveCustomerInfo.name || "Guest checkout"}
                </p>
                {effectiveCustomerInfo.email && (
                  <p className="text-sm text-muted-foreground">
                    {effectiveCustomerInfo.email}
                  </p>
                )}
                {effectiveCustomerInfo.phone && (
                  <p className="text-sm text-muted-foreground">
                    {effectiveCustomerInfo.phone}
                  </p>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col",
        !hasTerminal && !readOnly && "opacity-60 transition-all duration-300",
      )}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-5 p-0",
          isPaymentFlowActive && "gap-3",
        )}
      >
        {showPaymentEditor &&
          payments.length === 0 &&
          !hideActiveSummaryCards && (
            <div
              className={cn(
                "grid gap-3",
                hidePaymentItemCountSummary ? "grid-cols-1" : "grid-cols-2",
              )}
            >
              {!hidePaymentItemCountSummary && (
                <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-surface">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Items
                  </p>
                  <p className="mt-2 text-2xl font-semibold leading-none text-foreground">
                    {cartItemsCount}
                  </p>
                </div>
              )}
              <div
                className={cn(
                  "rounded-xl border p-4 shadow-sm",
                  balanceDueToneClass,
                )}
              >
                <p
                  className={cn(
                    "text-xs font-medium uppercase tracking-wide",
                    balanceDueLabelClass,
                  )}
                >
                  {balanceDueLabel}
                </p>
                <p className="mt-2 text-2xl font-semibold leading-none text-foreground">
                  {formatStoredAmount(formatter, balanceDueAmount)}
                </p>
              </div>
            </div>
          )}

        {payments.length > 0 && (
          <PaymentsAddedList
            payments={payments}
            formatter={formatter}
            totalAmountDue={total}
            balanceDue={isPaymentFlowActive ? remainingDue : undefined}
            selectedPaymentMethod={selectedPaymentMethod}
            paymentAmountDraft={paymentAmountDraft}
            readOnly={readOnly}
            isTransactionCompleted={isTransactionCompleted}
            editingPaymentId={editingPaymentId}
            onEditingPaymentIdChange={handleEditingPaymentIdChange}
            paymentsExpanded={paymentsExpanded}
            onUpdatePayment={onUpdatePayment}
            onRemovePayment={onRemovePayment}
            onClearPayments={
              onClearPayments
                ? async () => {
                    const saved = await onClearPayments();
                    if (saved === false) return false;
                    setSelectedPaymentMethod(null);
                    handleEditingPaymentIdChange(null);
                    onPaymentFlowChange?.(false);
                    return saved;
                  }
                : undefined
            }
            onPaymentsExpandedChange={onPaymentsExpandedChange}
            variant={selectedPaymentMethod ? "minimized" : "default"}
          />
        )}

        {effectiveCustomerInfo &&
          (effectiveCustomerInfo.name || effectiveCustomerInfo.email) && (
            <div className="rounded-lg bg-muted/30 p-3">
              <h4 className="font-medium text-sm mb-2">Customer</h4>
              {effectiveCustomerInfo.name && (
                <p className="text-sm">{effectiveCustomerInfo.name}</p>
              )}
              {effectiveCustomerInfo.email && (
                <p className="text-xs text-muted-foreground">
                  {effectiveCustomerInfo.email}
                </p>
              )}
            </div>
          )}

        {showPaymentButtons && (
          <div
            className={cn(
              shouldDockPaymentButtons
                ? "mt-auto flex flex-col gap-5"
                : "grid grid-cols-2 gap-3",
            )}
          >
            {shouldShowPaymentButtonBalance && (
              <div
                className={cn(
                  "rounded-xl border p-5",
                  !shouldDockPaymentButtons && "col-span-2",
                  balanceDueToneClass,
                )}
              >
                <p
                  className={cn(
                    "text-xs font-medium uppercase tracking-wide",
                    balanceDueLabelClass,
                  )}
                >
                  {balanceDueLabel}
                </p>
                <p className="mt-2 text-4xl font-semibold leading-none text-foreground">
                  {formatStoredAmount(formatter, balanceDueAmount)}
                </p>
              </div>
            )}

            {completionBlockMessage ? (
              <button
                type="button"
                disabled={!onCompletionBlockAction}
                onClick={onCompletionBlockAction}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border border-action-workflow-border bg-action-workflow-soft px-3.5 py-3 text-left text-action-workflow transition-colors hover:bg-action-workflow-soft/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default disabled:hover:bg-action-workflow-soft",
                  !shouldDockPaymentButtons && "col-span-2",
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-action-workflow">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {completionBlockTitle}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-action-workflow/80">
                    {completionBlockDetail}
                  </span>
                </span>
                <span className="shrink-0 rounded-md border border-action-workflow-border/80 bg-white/70 px-2.5 py-1 text-xs font-semibold text-action-workflow">
                  Find/add
                </span>
              </button>
            ) : null}

            <div
              className={cn(
                "grid grid-cols-2 gap-3",
                !shouldDockPaymentButtons && "contents",
              )}
            >
              <Button
                onClick={() => {
                  onPaymentEntryStart?.();
                  setSelectedPaymentMethod("cash");
                }}
                disabled={paymentMethodsDisabled}
                className="flex h-28 flex-col items-start justify-between rounded-xl bg-transaction-signal p-4 text-left text-transaction-signal-foreground shadow-md shadow-transaction-signal/20 hover:bg-transaction-signal/90 hover:text-transaction-signal-foreground"
                size="lg"
                variant="outline"
              >
                <Banknote className="h-5 w-5" />
                <span className="text-base font-semibold">Cash</span>
              </Button>
              <Button
                onClick={() => {
                  onPaymentEntryStart?.();
                  setSelectedPaymentMethod("card");
                }}
                disabled={paymentMethodsDisabled}
                variant="outline"
                className="flex h-28 flex-col items-start justify-between rounded-xl border-border bg-surface-raised p-4 text-left text-foreground shadow-surface hover:bg-muted/30"
                size="lg"
              >
                <CreditCard className="h-5 w-5 text-rose-600" />
                <span className="text-base font-semibold">Card</span>
              </Button>
              <Button
                onClick={() => {
                  onPaymentEntryStart?.();
                  setSelectedPaymentMethod("mobile_money");
                }}
                disabled={paymentMethodsDisabled}
                variant="outline"
                className="col-span-2 flex h-24 items-center justify-between rounded-xl bg-yellow-200 p-4 text-left text-yellow-950 shadow-sm shadow-yellow-200/70 hover:bg-yellow-100 hover:text-yellow-950"
                size="lg"
              >
                <span className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5" />
                  <span className="text-base font-semibold">Mobile Money</span>
                </span>
              </Button>
            </div>
          </div>
        )}

        {showPaymentEditor && (
          <div
            className={cn(selectedPaymentMethod ? "min-h-0 flex-1" : "mt-auto")}
          >
            <PaymentView
              cartItemCount={cartItemsCount}
              totalPaid={totalPaid}
              remainingDue={remainingDue}
              amountDue={total}
              formatter={formatter}
              selectedPaymentMethod={selectedPaymentMethod}
              setSelectedPaymentMethod={handleSelectedPaymentMethodChange}
              onAddPayment={(method, amount) =>
                onAddPayment?.(method, amount) ?? false
              }
              onPaymentAmountChange={setPaymentAmountDraft}
              onComplete={handleCompleteTransaction}
              completionBlockMessage={completionBlockMessage}
              isCompleting={isCompleting}
            />
          </div>
        )}

        {(readOnly || isTransactionCompleted) && (
          <div className="space-y-4">
            <Button
              onClick={handlePrintReceipt}
              className="w-full py-12 text-lg"
              size="lg"
              variant="outline"
            >
              <Printer className="w-10 h-10 mr-2" />
              Print Receipt
            </Button>
            {!readOnly && (
              <Button
                onClick={handleStartNewTransaction}
                variant="outline"
                className="w-full py-12 text-lg"
                size="lg"
              >
                <Plus className="w-10 h-10 mr-2" />
                New Transaction
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function formatPaymentMethod(method: string) {
    switch (method) {
      case "card":
        return "Card Payment";
      case "cash":
        return "Cash Payment";
      case "mobile_money":
        return "Mobile Money";
      default:
        return method;
    }
  }
}
