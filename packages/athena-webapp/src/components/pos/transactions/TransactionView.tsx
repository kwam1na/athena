import { useMemo, useState } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Banknote,
  Ban,
  CheckCircle2,
  CreditCard,
  Minus,
  MoveRight,
  Plus,
  RefreshCw,
  Smartphone,
  User,
  WalletCards,
} from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { ComposedPageHeader } from "../../common/PageHeader";
import { api } from "~/convex/_generated/api";
import { Badge } from "../../ui/badge";
import { capitalizeWords, getRelativeTime } from "~/src/lib/utils";
import { PosPaymentMethod } from "~/src/lib/pos/domain";
import { OrderSummary } from "../OrderSummary";
import type { ReceiptDeliveryHistoryEntry } from "../receipt/PosReceiptShareControl";
import { CartItems } from "../CartItems";
import type { CartItem, PosServiceReceiptLine } from "../types";
import type { Id } from "~/convex/_generated/dataModel";
import type { RegisterServiceLineState } from "~/src/lib/pos/presentation/register/registerUiState";
import { CardContent, CardHeader } from "../../ui/card";
import { WorkflowTraceRouteLink } from "../../traces/WorkflowTraceRouteLink";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";
import { Textarea } from "../../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  isApprovalRequiredResult,
  runCommand,
} from "~/src/lib/errors/runCommand";
import type {
  ApprovalCommandResult,
  CommandResult,
} from "~/shared/commandResult";
import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
} from "../../staff-auth/StaffAuthenticationDialog";
import { useProtectedAdminPageState } from "~/src/hooks/useProtectedAdminPageState";
import { toApprovalRequesterBindingArg } from "../../operations/approvalRequesterBinding";
import { useApprovedCommand } from "../../operations/useApprovedCommand";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { currencyFormatter } from "~/shared/currencyFormatter";
import { getOrigin } from "~/src/lib/navigationUtils";

type RouteParams =
  | {
      orgUrlSlug?: string;
      storeUrlSlug?: string;
      transactionId: string;
    }
  | undefined;

type RouteSearch =
  | {
      intent?: string;
    }
  | undefined;

type CorrectionEvent = {
  _id: string;
  actorStaffName?: string | null;
  createdAt: number;
  eventType: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  reason?: string | null;
};

type PaymentMethodCorrectionResultData = {
  approvalProofId: Id<"approvalProof">;
  approverStaffProfileId: Id<"staffProfile">;
};

type ItemAdjustmentResultData = {
  adjustmentId?: string;
  adjustmentStatus?: string;
  adjustedTotal?: number;
  approvalProofId?: Id<"approvalProof">;
  approvalRequestId?: Id<"approvalRequest">;
  approverStaffProfileId?: Id<"staffProfile">;
  effectiveNetTotal?: number;
  originalTotal?: number;
  settlementAmount?: number;
  settlementDirection?: string;
  settlementMethod?: string;
  transactionId: Id<"posTransaction">;
};

type TransactionVoidResultData = {
  approvalProofId?: Id<"approvalProof">;
  approverStaffProfileId?: Id<"staffProfile">;
  inventoryMovementIds: Array<Id<"inventoryMovement">>;
  operationalEventId?: Id<"operationalEvent">;
  paymentAllocationIds: Array<Id<"paymentAllocation">>;
  transactionId: Id<"posTransaction">;
  transactionNumber: string;
  voidedAt: number;
};

type TransactionWithReceiptDelivery = {
  receiptDeliveryHistory?: ReceiptDeliveryHistoryEntry[] | null;
};

const PAYMENT_METHOD_OPTIONS = [
  { label: "Cash", value: "cash" },
  { label: "Card", value: "card" },
  { label: "Mobile Money", value: "mobile_money" },
] satisfies Array<{ label: string; value: PosPaymentMethod }>;

const ghsCurrencyFormatter = currencyFormatter("GHS");
const REGISTER_EXPECTED_CASH_ERROR =
  "Register session expected cash cannot be negative.";

function normalizeReceiptServiceMode(
  value: PosServiceReceiptLine["serviceMode"],
): RegisterServiceLineState["serviceMode"] {
  if (
    value === "consultation" ||
    value === "repair" ||
    value === "revamp" ||
    value === "same_day"
  ) {
    return value;
  }

  return "same_day";
}

function receiptServiceLineToCartServiceLine(
  line: PosServiceReceiptLine,
): RegisterServiceLineState {
  const quantity = line.quantity && line.quantity > 0 ? line.quantity : 1;
  const unitPrice =
    line.unitPrice && line.unitPrice > 0
      ? line.unitPrice
      : Math.round(line.totalPrice / quantity);

  return {
    id: line.id,
    name: line.name,
    serviceMode: normalizeReceiptServiceMode(line.serviceMode),
    pricingModel: "fixed",
    price: unitPrice,
    quantity,
    amountRequired: false,
  };
}

function isAdjustedLineItem(line: {
  adjustedQuantity?: number;
  originalQuantity?: number;
  quantityDelta?: number;
  totalDelta?: number;
}) {
  if (typeof line.quantityDelta === "number") {
    return line.quantityDelta !== 0;
  }

  if (
    typeof line.originalQuantity === "number" &&
    typeof line.adjustedQuantity === "number"
  ) {
    return line.originalQuantity !== line.adjustedQuantity;
  }

  if (typeof line.totalDelta === "number") {
    return line.totalDelta !== 0;
  }

  return true;
}

export function formatCorrectionEventType(eventType: string) {
  return eventType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatCorrectionHistoryTitle(event: CorrectionEvent) {
  switch (event.eventType) {
    case "pos_transaction_payment_method_corrected":
      return "Payment method updated";
    case "transaction_customer_corrected":
    case "pos_transaction_customer_corrected":
      return "Customer attribution updated";
    default:
      return event.message ?? formatCorrectionEventType(event.eventType);
  }
}

function formatCorrectionHistoryMeta(event: CorrectionEvent) {
  const timestamp = getRelativeTime(event.createdAt);
  const actorName = event.actorStaffName
    ? formatStaffDisplayName({ fullName: event.actorStaffName })
    : null;

  return actorName ? `${timestamp} by ${actorName}` : timestamp;
}

export function formatPaymentMethodLabel(method: unknown) {
  if (typeof method !== "string" || !method.trim()) {
    return null;
  }

  return method
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requiresInlineManagerProof(approval: ApprovalRequirement) {
  const hasAsyncApprovalRequest = approval.resolutionModes.some(
    (mode) => mode.kind === "async_request" && Boolean(mode.approvalRequestId),
  );

  return (
    !hasAsyncApprovalRequest &&
    approval.resolutionModes.some(
      (mode) => mode.kind === "inline_manager_proof",
    )
  );
}

function isManagerStaff(staff: StaffAuthenticationResult) {
  return staff.activeRoles?.includes("manager") ?? false;
}

function getTransactionReceiptDeliveryHistory(
  transaction: TransactionWithReceiptDelivery,
) {
  return transaction.receiptDeliveryHistory ?? [];
}

export function formatCorrectionHistoryChange(event: CorrectionEvent) {
  if (event.eventType !== "pos_transaction_payment_method_corrected") {
    return null;
  }

  const previousPaymentMethod = formatPaymentMethodLabel(
    event.metadata?.previousPaymentMethod,
  );
  const paymentMethod = formatPaymentMethodLabel(event.metadata?.paymentMethod);

  if (previousPaymentMethod && paymentMethod) {
    return `Changed from ${previousPaymentMethod} to ${paymentMethod}`;
  }

  if (paymentMethod) {
    return `Changed to ${paymentMethod}`;
  }

  return null;
}

export function getCorrectionHistoryChangeParts(event: CorrectionEvent) {
  if (event.eventType !== "pos_transaction_payment_method_corrected") {
    return null;
  }

  const previousPaymentMethod = formatPaymentMethodLabel(
    event.metadata?.previousPaymentMethod,
  );
  const paymentMethod = formatPaymentMethodLabel(event.metadata?.paymentMethod);

  if (!paymentMethod) {
    return null;
  }

  return {
    paymentMethod,
    previousPaymentMethod,
  };
}

function getTransactionCorrectionHistory(transaction: {
  correctionHistory?: CorrectionEvent[];
  timeline?: CorrectionEvent[];
}) {
  return [
    ...(transaction.correctionHistory ?? transaction.timeline ?? []),
  ].sort((first, second) => second.createdAt - first.createdAt);
}

function normalizeVoidCommandError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("daily close") ||
    normalizedMessage.includes("operating day") ||
    normalizedMessage.includes("day is closed")
  ) {
    return "Daily close completed. Reopen the day before voiding this sale.";
  }

  if (
    normalizedMessage.includes("register") ||
    normalizedMessage.includes("drawer") ||
    normalizedMessage.includes("closeout")
  ) {
    return "Register closed. Reopen the register before voiding this sale.";
  }

  if (
    normalizedMessage.includes("already void") ||
    normalizedMessage.includes("voided") ||
    normalizedMessage.includes("not completed") ||
    normalizedMessage.includes("can only void completed")
  ) {
    return "Sale already voided or no longer eligible. Refresh the transaction before continuing.";
  }

  if (
    normalizedMessage.includes("mixed service") ||
    normalizedMessage.includes("service ops") ||
    normalizedMessage.includes("service payment")
  ) {
    return "Mixed service sale. Reverse the service payment in Service Ops before voiding the retail sale.";
  }

  if (
    normalizedMessage.includes("staff") ||
    normalizedMessage.includes("sign") ||
    normalizedMessage.includes("auth")
  ) {
    return "Staff sign-in required. Sign in before voiding this sale.";
  }

  return "Sale could not be voided. Check the transaction state and try again.";
}

export function TransactionView() {
  const params = useParams({
    strict: false,
  }) as RouteParams;
  const search = useSearch({
    strict: false,
  }) as RouteSearch;
  const transactionId = params?.transactionId;
  const [correctionPanelOpen, setCorrectionPanelOpen] = useState(false);
  const [selectedCorrection, setSelectedCorrection] = useState<
    | "customer"
    | "payment_method"
    | "line_items"
    | "amounts"
    | "discounts"
    | null
  >(null);
  const [customerCorrectionReason, setCustomerCorrectionReason] = useState("");
  const [customerProfileIdInput, setCustomerProfileIdInput] = useState("");
  const [paymentCorrectionReason, setPaymentCorrectionReason] = useState("");
  const [paymentMethodInput, setPaymentMethodInput] = useState("");
  const [itemAdjustmentReason, setItemAdjustmentReason] = useState("");
  const [itemAdjustmentSettlementMethod, setItemAdjustmentSettlementMethod] =
    useState("");
  const [correctedQuantities, setCorrectedQuantities] = useState<
    Record<string, number>
  >({});
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [pendingCorrection, setPendingCorrection] = useState<
    "customer" | "payment_method" | "line_items" | "void" | null
  >(null);
  const [correctionHistoryExpanded, setCorrectionHistoryExpanded] =
    useState(false);
  const [voidPanelOpen, setVoidPanelOpen] = useState(
    search?.intent === "void",
  );
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [localVoidState, setLocalVoidState] = useState<{
    reason: string;
    result: TransactionVoidResultData;
  } | null>(null);
  const { activeStore, hasFullAdminAccess, isAuthenticated } =
    useProtectedAdminPageState();
  const correctAuth = useMutation(
    api.operations.staffCredentials.authenticateStaffCredential,
  );
  const correctTerminalAuth = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForTerminal,
  );
  const approveCommand = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );
  const correctPaymentMethod = useMutation(
    api.inventory.pos.correctTransactionPaymentMethod,
  );
  const correctCustomer = useMutation(
    api.inventory.pos.correctTransactionCustomer,
  );
  const adjustTransactionItems = useMutation(
    api.inventory.pos.adjustTransactionItems,
  );
  const markReceiptPrinted = useMutation(api.inventory.pos.markReceiptPrinted);
  const voidTransaction = useMutation(api.inventory.pos.voidTransaction);
  const paymentApprovalRunner = useApprovedCommand({
    storeId: activeStore?._id,
    onAuthenticateForApproval: (args) => {
      if (!activeStore?._id) {
        return Promise.resolve({
          kind: "user_error",
          error: {
            code: "authentication_failed",
            message: "Select a store before approving this command",
          },
        });
      }

      return runCommand(
        () =>
          approveCommand({
            actionKey: args.actionKey,
            pinHash: args.pinHash,
            reason: args.reason,
            requiredRole: args.requiredRole,
            requesterBinding: toApprovalRequesterBindingArg(
              args.requesterBinding,
            ),
            requestedByStaffProfileId: args.requestedByStaffProfileId,
            storeId: activeStore._id,
            subject: args.subject,
            username: args.username,
          }) as Promise<
            CommandResult<{
              approvalProofId: Id<"approvalProof">;
              approvedByStaffProfileId: Id<"staffProfile">;
              expiresAt: number;
              requestedByStaffProfileId?: Id<"staffProfile">;
            }>
          >,
      );
    },
  });
  const itemAdjustmentApprovalRunner = useApprovedCommand({
    storeId: activeStore?._id,
    onAuthenticateForApproval: (args) => {
      if (!activeStore?._id) {
        return Promise.resolve({
          kind: "user_error",
          error: {
            code: "authentication_failed",
            message: "Select a store before approving this command",
          },
        });
      }

      return runCommand(
        () =>
          approveCommand({
            actionKey: args.actionKey,
            pinHash: args.pinHash,
            reason: args.reason,
            requiredRole: args.requiredRole,
            requesterBinding: toApprovalRequesterBindingArg(
              args.requesterBinding,
            ),
            requestedByStaffProfileId: args.requestedByStaffProfileId,
            storeId: activeStore._id,
            subject: args.subject,
            username: args.username,
          }) as Promise<
            CommandResult<{
              approvalProofId: Id<"approvalProof">;
              approvedByStaffProfileId: Id<"staffProfile">;
              expiresAt: number;
              requestedByStaffProfileId?: Id<"staffProfile">;
            }>
          >,
      );
    },
  });
  const voidApprovalRunner = useApprovedCommand({
    storeId: activeStore?._id,
    onAuthenticateForApproval: (args) => {
      if (!activeStore?._id) {
        return Promise.resolve({
          kind: "user_error",
          error: {
            code: "authentication_failed",
            message: "Select a store before approving this command",
          },
        });
      }

      return runCommand(
        () =>
          approveCommand({
            actionKey: args.actionKey,
            pinHash: args.pinHash,
            reason: args.reason,
            requiredRole: args.requiredRole,
            requesterBinding: toApprovalRequesterBindingArg(
              args.requesterBinding,
            ),
            requestedByStaffProfileId: args.requestedByStaffProfileId,
            storeId: activeStore._id,
            subject: args.subject,
            username: args.username,
          }) as Promise<
            CommandResult<{
              approvalProofId: Id<"approvalProof">;
              approvedByStaffProfileId: Id<"staffProfile">;
              expiresAt: number;
              requestedByStaffProfileId?: Id<"staffProfile">;
            }>
          >,
      );
    },
  });

  const transaction = useQuery(
    api.inventory.pos.getTransactionById,
    transactionId
      ? {
          transactionId: transactionId as Id<"posTransaction">,
        }
      : "skip",
  );

  const cartItems: CartItem[] = useMemo(() => {
    if (!transaction) return [];
    return transaction.items.map(
      (item: (typeof transaction.items)[number]) => ({
        id: item._id,
        name: item.productName,
        barcode: item.barcode || "",
        sku: item.productSku,
        price: item.unitPrice,
        quantity: item.quantity,
        productId: item.productId,
        skuId: item.productSkuId,
        image: item.image || undefined,
      }),
    );
  }, [transaction]);

  const appliedAdjustments = useMemo(() => {
    if (!transaction) return [];
    return (transaction.adjustments ?? []).filter(
      (adjustment: (typeof transaction.adjustments)[number]) =>
        adjustment.status === "applied",
    );
  }, [transaction]);
  const pendingAdjustments = useMemo(() => {
    if (!transaction) return [];
    return (transaction.adjustments ?? []).filter(
      (adjustment: (typeof transaction.adjustments)[number]) =>
        adjustment.status === "pending_approval",
    );
  }, [transaction]);
  const latestAppliedAdjustment = appliedAdjustments[0] ?? null;
  const latestPendingAdjustment = [...pendingAdjustments].sort(
    (first, second) => second.createdAt - first.createdAt,
  )[0] ?? null;
  const hasAppliedItemAdjustment = appliedAdjustments.length > 0;
  const pendingSaleTotal =
    typeof latestPendingAdjustment?.adjustedTotal === "number"
      ? latestPendingAdjustment.adjustedTotal
      : null;
  const adjustedCartItems: CartItem[] = useMemo(() => {
    if (!transaction) return [];

    const appliedLineItems = [...appliedAdjustments]
      .sort(
        (first, second) =>
          (first.appliedAt ?? first.createdAt) -
          (second.appliedAt ?? second.createdAt),
      )
      .flatMap((adjustment) => adjustment.lineItems ?? []);

    return transaction.items
      .map((item: (typeof transaction.items)[number]) => {
        const adjustedLine =
          appliedLineItems.find(
            (line) => line.productSku && line.productSku === item.productSku,
          ) ??
          appliedLineItems.find(
            (line) => line.productName === item.productName,
          );
        const adjustedQuantity =
          typeof adjustedLine?.adjustedQuantity === "number"
            ? adjustedLine.adjustedQuantity
            : typeof adjustedLine?.quantityDelta === "number"
              ? item.quantity + adjustedLine.quantityDelta
              : item.quantity;

        return {
          id: item._id,
          name: item.productName,
          barcode: item.barcode || "",
          sku: item.productSku,
          price: item.unitPrice,
          quantity: Math.max(0, adjustedQuantity),
          productId: item.productId,
          skuId: item.productSkuId,
          image: item.image || undefined,
        };
      })
      .filter((item) => item.quantity > 0);
  }, [appliedAdjustments, transaction]);
  const displayCartItems = hasAppliedItemAdjustment
    ? adjustedCartItems
    : cartItems;
  const serviceLines = useMemo(
    () =>
      (
        ((transaction as { serviceLines?: PosServiceReceiptLine[] } | null)
          ?.serviceLines ?? []) as PosServiceReceiptLine[]
      ).filter((line) => line.totalPrice > 0 || line.serviceCaseUnavailable),
    [transaction],
  );
  const displayServiceItems = useMemo(
    () => serviceLines.map(receiptServiceLineToCartServiceLine),
    [serviceLines],
  );
  const effectiveSaleTotal =
    transaction?.adjustmentSummary?.effectiveNetTotal ??
    transaction?.effectiveNetTotal ??
    transaction?.total ??
    0;
  const originalSaleTotal =
    transaction?.adjustmentSummary?.originalTotal ??
    transaction?.originalTotal ??
    transaction?.total ??
    0;
  const totalAppliedAdjustmentDelta =
    transaction?.adjustmentSummary?.totalAppliedAdjustmentDelta ??
    transaction?.totalAppliedAdjustmentDelta ??
    effectiveSaleTotal - originalSaleTotal;
  const effectiveSubtotal = transaction
    ? Math.max(0, effectiveSaleTotal - (transaction.tax ?? 0))
    : 0;
  const showRegisterExpectedCashRecovery =
    selectedCorrection === "line_items" &&
    correctionError === REGISTER_EXPECTED_CASH_ERROR;
  const registerSessionRecoveryLink =
    showRegisterExpectedCashRecovery &&
    transaction?.registerSessionId &&
    params?.orgUrlSlug &&
    params?.storeUrlSlug
      ? {
          orgUrlSlug: params.orgUrlSlug,
          sessionId: transaction.registerSessionId,
          storeUrlSlug: params.storeUrlSlug,
        }
      : null;

  const completedData = useMemo(() => {
    if (!transaction) return undefined;
    const transactionRecord = transaction as typeof transaction & {
      voidedAt?: number | null;
    };
    const receiptVoidedAt =
      localVoidState?.result.voidedAt ?? transactionRecord.voidedAt ?? null;
    const receiptStatus: "completed" | "voided" =
      localVoidState ||
      transaction.status === "void" ||
      transaction.status === "voided" ||
      typeof receiptVoidedAt === "number"
        ? "voided"
        : "completed";
    return {
      transactionId: transaction._id,
      paymentMethod: transaction.paymentMethod || "cash",
      completedAt: transaction.completedAt,
      cartItems: displayCartItems,
      serviceLines,
      subtotal: hasAppliedItemAdjustment
        ? effectiveSubtotal
        : transaction.subtotal,
      tax: transaction.tax,
      total: hasAppliedItemAdjustment ? effectiveSaleTotal : transaction.total,
      status: receiptStatus,
      payments: transaction.payments.map(
        (
          payment: {
            amount: number;
            method: string;
            timestamp: number;
          },
          index: number,
        ) => ({
          id: `${payment.method}-${index}-${payment.timestamp}`,
          ...payment,
          method: payment.method as PosPaymentMethod,
        }),
      ),
      customerInfo:
        transaction.customerInfo ??
        (transaction.customer
          ? {
              name: transaction.customer.name ?? undefined,
              email: transaction.customer.email ?? undefined,
              phone: transaction.customer.phone ?? undefined,
            }
          : undefined),
    };
  }, [
    displayCartItems,
    effectiveSaleTotal,
    effectiveSubtotal,
    hasAppliedItemAdjustment,
    localVoidState,
    serviceLines,
    transaction,
  ]);

  const itemAdjustmentDraft = useMemo(() => {
    if (!transaction) {
      return null;
    }

    const lines = transaction.items.map((item: (typeof transaction.items)[number]) => {
      const correctedQuantity =
        correctedQuantities[item._id] ?? item.quantity;
      const adjustedLineTotal = correctedQuantity * item.unitPrice;

      return {
        adjustedLineTotal,
        correctedQuantity,
        item,
        originalLineTotal: item.totalPrice,
        quantityDelta: correctedQuantity - item.quantity,
        totalDelta: adjustedLineTotal - item.totalPrice,
      };
    });
    const adjustedTotal = lines.reduce(
      (sum, line) => sum + line.adjustedLineTotal,
      transaction.tax ?? 0,
    );
    const totalDelta = adjustedTotal - transaction.total;
    const settlementAmount = Math.abs(totalDelta);
    const settlementDirection: "refund" | "collection" | "none" =
      totalDelta < 0 ? "refund" : totalDelta > 0 ? "collection" : "none";

    return {
      adjustedTotal,
      hasChanges: lines.some((line) => line.quantityDelta !== 0),
      lines,
      settlementAmount,
      settlementDirection,
      totalDelta,
    };
  }, [transaction, correctedQuantities]);

  if (!transactionId) {
    return null;
  }

  if (!transaction) {
    return (
      <View>
        <FadeIn>
          <div className="container mx-auto p-6 min-h-[50vh]" />
        </FadeIn>
      </View>
    );
  }

  const completedPaymentMethods = transaction.payments?.length
    ? Array.from(
        new Set(
          transaction.payments.map(
            (payment: { method: string }) => payment.method,
          ),
        ),
      )
    : [transaction.paymentMethod || "Unknown"];
  const paymentMethodLabel =
    completedPaymentMethods.length > 1
      ? "Multiple payment methods"
      : completedPaymentMethods[0]?.replace("_", " ") || "Unknown";
  const paymentMethodIcon =
    completedPaymentMethods.length > 1
      ? WalletCards
      : transaction.paymentMethod === "cash"
        ? Banknote
        : transaction.paymentMethod === "card"
          ? CreditCard
          : Smartphone;

  const PaymentIcon = paymentMethodIcon;
  const receiptDeliveryHistory = getTransactionReceiptDeliveryHistory(
    transaction as TransactionWithReceiptDelivery,
  );
  const receiptMessaging = {
    customerPhone:
      transaction.customer?.phone ?? transaction.customerInfo?.phone ?? "",
    deliveryHistory: receiptDeliveryHistory,
    transactionId: transactionId as Id<"posTransaction">,
    transactionNumber: transaction.transactionNumber,
  };
  const correctionHistory = getTransactionCorrectionHistory(transaction);
  const hiddenCorrectionCount = Math.max(0, correctionHistory.length - 2);
  const visibleCorrectionHistory = correctionHistoryExpanded
    ? correctionHistory
    : correctionHistory.slice(0, 2);
  const staffAuthenticationDialogCopy = {
    title: "Staff sign-in required",
    description: "Authenticate to record this update",
    submitLabel: "Confirm",
  };
  const isCompletedTransaction = transaction.status === "completed";
  const hasSinglePayment = (transaction.payments?.length ?? 0) <= 1;
  const registerSessionIsClosing =
    transaction.registerSessionStatus === "closing";
  const supportsPaymentMethodCorrection =
    hasSinglePayment &&
    (transaction.changeGiven ?? 0) <= 0 &&
    !registerSessionIsClosing;
  const paymentMethodCorrectionUnavailableMessage = registerSessionIsClosing
    ? `Reopen ${
        transaction.registerNumber
          ? `Register ${transaction.registerNumber}`
          : "this transaction's register"
      } to update payment details`
    : "Only same-amount payment method updates are supported";
  const currentPaymentMethod = (transaction.payments?.[0]?.method ??
    transaction.paymentMethod ??
    null) as PosPaymentMethod | null;
  const correctionPaymentMethodOptions = PAYMENT_METHOD_OPTIONS.filter(
    (option) => option.value !== currentPaymentMethod,
  );
  const showPaymentMethodDirectFlow =
    selectedCorrection === "payment_method" && supportsPaymentMethodCorrection;
  const showCustomerCorrectionError =
    selectedCorrection === "customer" && correctionError;
  const showPaymentMethodCorrectionError =
    showPaymentMethodDirectFlow && correctionError;
  const transactionRecord = transaction as typeof transaction & {
    canVoid?: boolean;
    pendingVoidApprovalRequest?: {
      _id: Id<"approvalRequest"> | string;
      createdAt: number;
      requestedByStaffProfileId?: Id<"staffProfile"> | string;
    } | null;
    voidEligibility?: { eligible?: boolean } | null;
    voidReason?: string | null;
    voidedAt?: number | null;
  };
  const pendingVoidApprovalRequestId =
    transactionRecord.pendingVoidApprovalRequest?._id ?? null;
  const hasPendingVoidApprovalRequest = Boolean(pendingVoidApprovalRequestId);
  const voidApprovalLinkParams =
    hasPendingVoidApprovalRequest &&
    hasFullAdminAccess &&
    params?.orgUrlSlug &&
    params?.storeUrlSlug
      ? {
          orgUrlSlug: params.orgUrlSlug,
          storeUrlSlug: params.storeUrlSlug,
        }
      : null;
  const transactionVoidedAt =
    localVoidState?.result.voidedAt ?? transactionRecord.voidedAt ?? null;
  const transactionVoidReason =
    localVoidState?.reason ?? transactionRecord.voidReason ?? null;
  const isVoidedTransaction =
    Boolean(localVoidState) ||
    transaction.status === "void" ||
    transaction.status === "voided" ||
    typeof transactionVoidedAt === "number";
  const readModelAllowsVoid =
    transactionRecord.canVoid !== false &&
    transactionRecord.voidEligibility?.eligible !== false;
  const canVoidTransaction =
    isCompletedTransaction &&
    !isVoidedTransaction &&
    readModelAllowsVoid &&
    !hasPendingVoidApprovalRequest;
  const transactionStatusLabel = isVoidedTransaction ? "Voided" : "Completed";
  const transactionStatusTime = getRelativeTime(
    transactionVoidedAt ?? transaction.completedAt,
  );

  async function authenticateCorrectionStaff(args: {
    pinHash: string;
    username: string;
  }) {
    if (!activeStore?._id) {
      return {
        kind: "user_error" as const,
        error: {
          code: "authentication_failed" as const,
          message: "Select a store before confirming staff credentials",
        },
      };
    }

    if (pendingCorrection === "line_items" || pendingCorrection === "void") {
      if (!transaction?.terminalId) {
        return {
          kind: "user_error" as const,
          error: {
            code: "authentication_failed" as const,
            message:
              "Transaction terminal is unavailable. Refresh the transaction and try again.",
          },
        };
      }
      const transactionTerminalId = transaction.terminalId;

      return runCommand(() =>
        correctTerminalAuth({
          allowedRoles: ["cashier", "manager"],
          allowActiveSessionsOnOtherTerminals: true,
          pinHash: args.pinHash,
          storeId: activeStore._id,
          terminalId: transactionTerminalId,
          username: args.username,
        }),
      );
    }

    return runCommand(() =>
      correctAuth({
        allowedRoles: ["cashier", "manager"],
        pinHash: args.pinHash,
        storeId: activeStore._id,
        username: args.username,
      }),
    );
  }

  function exitCorrectionWorkflow() {
    setCorrectionPanelOpen(false);
    setSelectedCorrection(null);
    setPendingCorrection(null);
    setCorrectionError(null);
  }

  function exitVoidWorkflow() {
    setVoidPanelOpen(false);
    setVoidReason("");
    setVoidError(null);
    setPendingCorrection(null);
  }

  function resetItemAdjustmentWorkflow() {
    setCorrectedQuantities({});
    setItemAdjustmentReason("");
    setItemAdjustmentSettlementMethod("");
  }

  function cancelItemAdjustmentWorkflow() {
    resetItemAdjustmentWorkflow();
    setCorrectionError(null);
    setPendingCorrection(null);
    setSelectedCorrection(null);
  }

  function cancelPaymentMethodWorkflow() {
    setPaymentCorrectionReason("");
    setPaymentMethodInput("");
    setCorrectionError(null);
    setPendingCorrection(null);
    setSelectedCorrection(null);
  }

  async function runCustomerCorrection(staff: StaffAuthenticationResult) {
    if (!isAuthenticated) {
      setCorrectionError("Sign in again before updating this transaction");
      return;
    }

    const reason = customerCorrectionReason.trim();
    if (!reason) {
      setCorrectionError("Add a reason for this update");
      return;
    }

    setCorrectionSubmitting(true);
    setCorrectionError(null);
    const result = await runCommand(
      () =>
        correctCustomer({
          actorStaffProfileId: staff.staffProfileId,
          customerProfileId: customerProfileIdInput.trim()
            ? (customerProfileIdInput.trim() as Id<"customerProfile">)
            : undefined,
          reason,
          transactionId: transactionId as Id<"posTransaction">,
        }) as Promise<CommandResult<unknown>>,
    );
    setCorrectionSubmitting(false);

    if (result.kind === "ok") {
      setCustomerCorrectionReason("");
      setCustomerProfileIdInput("");
      exitCorrectionWorkflow();
      toast.success("Customer attribution updated");
      return;
    }

    setCorrectionError(result.error.message);
  }

  async function runPaymentMethodCorrection(args?: {
    approvalRequestId?: Id<"approvalRequest">;
    approvalProofId?: Id<"approvalProof">;
    sameSubmissionApproval?: {
      pinHash: string;
      username: string;
    };
    staff?: StaffAuthenticationResult;
    staffProfileId?: Id<"staffProfile">;
  }) {
    if (!isAuthenticated) {
      setCorrectionError("Sign in again before updating this transaction");
      return;
    }

    const paymentMethod = paymentMethodInput as PosPaymentMethod;
    const reason = paymentCorrectionReason.trim();
    if (!paymentMethod) {
      setCorrectionError("Choose the updated payment method");
      return;
    }
    if (paymentMethod === currentPaymentMethod) {
      setCorrectionError("Choose a different payment method");
      return;
    }
    if (!reason) {
      setCorrectionError("Add a reason for this update");
      return;
    }

    setCorrectionError(null);
    await paymentApprovalRunner.run({
      requestedByStaffProfileId: args?.staffProfileId,
      execute: async (approvalArgs) => {
        setCorrectionSubmitting(true);
        const result = await runCommand(
          () =>
            correctPaymentMethod({
              actorStaffProfileId: args?.staffProfileId,
              approvalRequestId:
                approvalArgs.approvalRequestId ?? args?.approvalRequestId,
              approvalProofId:
                approvalArgs.approvalProofId ?? args?.approvalProofId,
              paymentMethod,
              reason,
              staffProofToken: args?.staff?.posLocalStaffProof?.token,
              transactionId: transactionId as Id<"posTransaction">,
            }) as Promise<
              ApprovalCommandResult<PaymentMethodCorrectionResultData>
            >,
        );
        setCorrectionSubmitting(false);
        return result;
      },
      sameSubmissionApproval:
        args?.sameSubmissionApproval && args.staff
          ? {
              canAttemptInlineManagerProof: isManagerStaff(args.staff),
              pinHash: args.sameSubmissionApproval.pinHash,
              requestedByStaffProfileId:
                args.staffProfileId ?? args.staff.staffProfileId,
              username: args.sameSubmissionApproval.username,
            }
          : undefined,
      onApprovalRequired: (approval) => {
        if (!requiresInlineManagerProof(approval)) {
          setPaymentCorrectionReason("");
          setPaymentMethodInput("");
          setCorrectionPanelOpen(false);
          setSelectedCorrection(null);
          setPendingCorrection(null);
          setCorrectionError(null);
        }
      },
      onResult: (result) => {
        if (isApprovalRequiredResult(result)) {
          return;
        }

        if (result.kind === "ok") {
          setPaymentCorrectionReason("");
          setPaymentMethodInput("");
          exitCorrectionWorkflow();
          toast.success("Payment method updated");
          return;
        }

        setCorrectionError(result.error.message);
      },
    });
  }

  async function runItemAdjustment(args?: {
    approvalRequestId?: Id<"approvalRequest">;
    approvalProofId?: Id<"approvalProof">;
    sameSubmissionApproval?: {
      pinHash: string;
      username: string;
    };
    staff?: StaffAuthenticationResult;
    staffProfileId?: Id<"staffProfile">;
  }) {
    if (!isAuthenticated) {
      setCorrectionError("Sign in again before updating this transaction");
      return;
    }

    if (!transaction) {
      setCorrectionError("Transaction details are still loading");
      return;
    }

    if (!itemAdjustmentDraft?.hasChanges) {
      setCorrectionError("Change at least one item quantity before submitting");
      return;
    }

    const reason = itemAdjustmentReason.trim();
    if (!reason) {
      setCorrectionError("Add a reason for this item adjustment");
      return;
    }

    const settlementMethod =
      itemAdjustmentDraft.settlementDirection === "none"
        ? undefined
        : itemAdjustmentSettlementMethod.trim();
    if (
      itemAdjustmentDraft.settlementDirection !== "none" &&
      !settlementMethod
    ) {
      setCorrectionError("Choose a settlement method before submitting");
      return;
    }
    const staffProofToken = args?.staff?.posLocalStaffProof?.token;
    if (!args?.staffProfileId || !staffProofToken) {
      setCorrectionError(
        "Staff sign-in is required before adjusting transaction items",
      );
      return;
    }
    const payloadSettlementDirection: "collect" | "refund" | "none" =
      itemAdjustmentDraft.settlementDirection === "collection"
        ? "collect"
        : itemAdjustmentDraft.settlementDirection;

    setCorrectionError(null);
    setCorrectionSubmitting(true);
    try {
      await itemAdjustmentApprovalRunner.run({
        requestedByStaffProfileId: args?.staffProfileId,
        execute: async (approvalArgs) =>
          runCommand(
            () =>
              adjustTransactionItems({
                actorStaffProfileId: args?.staffProfileId,
                approvalRequestId:
                  approvalArgs.approvalRequestId ?? args?.approvalRequestId,
                approvalProofId:
                  approvalArgs.approvalProofId ?? args?.approvalProofId,
                staffProofToken,
                payload: {
                  correctedTotal: itemAdjustmentDraft.adjustedTotal,
                  lines: itemAdjustmentDraft.lines.map((line) => ({
                    adjustedQuantity: line.correctedQuantity,
                    inventoryDelta: -line.quantityDelta,
                    originalQuantity: line.item.quantity,
                    originalTransactionItemId: line.item._id,
                    productId: line.item.productId,
                    productName: line.item.productName,
                    productSku: line.item.productSku,
                    productSkuId: line.item.productSkuId,
                    unitPrice: line.item.unitPrice,
                  })),
                  originalTotal: transaction.total,
                  settlementAmount: itemAdjustmentDraft.settlementAmount,
                  settlementDirection: payloadSettlementDirection,
                  settlementMethod,
                },
                reason,
                transactionId: transactionId as Id<"posTransaction">,
              }) as Promise<ApprovalCommandResult<ItemAdjustmentResultData>>,
          ),
        sameSubmissionApproval:
          args?.sameSubmissionApproval && args.staff
            ? {
                canAttemptInlineManagerProof: isManagerStaff(args.staff),
                pinHash: args.sameSubmissionApproval.pinHash,
                requestedByStaffProfileId:
                  args.staffProfileId ?? args.staff.staffProfileId,
                username: args.sameSubmissionApproval.username,
              }
            : undefined,
        onApprovalRequired: (approval) => {
          if (!requiresInlineManagerProof(approval)) {
            resetItemAdjustmentWorkflow();
            setCorrectionPanelOpen(false);
            setSelectedCorrection(null);
            setPendingCorrection(null);
            setCorrectionError(null);
            toast.success("Item adjustment queued for manager review");
          }
        },
        onResult: (result) => {
          if (isApprovalRequiredResult(result)) {
            return;
          }

          if (result.kind === "ok") {
            resetItemAdjustmentWorkflow();
            exitCorrectionWorkflow();
            toast.success("Item adjustment applied");
            return;
          }

          setCorrectionError(result.error.message);
        },
      });
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  async function runTransactionVoid(args?: {
    approvalRequestId?: Id<"approvalRequest">;
    approvalProofId?: Id<"approvalProof">;
    sameSubmissionApproval?: {
      pinHash: string;
      username: string;
    };
    staff?: StaffAuthenticationResult;
    staffProfileId?: Id<"staffProfile">;
  }) {
    if (!isAuthenticated) {
      setVoidError("Sign in again before voiding this sale");
      return;
    }

    const reason = voidReason.trim();

    if (!args?.staffProfileId) {
      setVoidError("Staff sign-in is required before voiding this sale");
      return;
    }

    const staffProofToken = args.staff?.posLocalStaffProof?.token;
    if (!staffProofToken) {
      setVoidError("Staff sign-in is required before voiding this sale");
      return;
    }

    const staffProfileId = args.staffProfileId;

    setVoidError(null);
    setVoidSubmitting(true);
    try {
      await voidApprovalRunner.run({
        requestedByStaffProfileId: staffProfileId,
        execute: async (approvalArgs) =>
          runCommand(
            () =>
              (
                voidTransaction as unknown as (payload: {
                  actorStaffProfileId: Id<"staffProfile">;
                  approvalProofId?: Id<"approvalProof">;
                  approvalRequestId?: Id<"approvalRequest">;
                  reason?: string;
                  staffProofToken: string;
                  transactionId: Id<"posTransaction">;
                }) => Promise<ApprovalCommandResult<TransactionVoidResultData>>
              )({
                actorStaffProfileId: staffProfileId,
                approvalProofId:
                  approvalArgs.approvalProofId ?? args.approvalProofId,
                approvalRequestId:
                  approvalArgs.approvalRequestId ?? args.approvalRequestId,
                ...(reason ? { reason } : {}),
                staffProofToken,
                transactionId: transactionId as Id<"posTransaction">,
              }),
          ),
        sameSubmissionApproval:
          args.sameSubmissionApproval && args.staff
            ? {
                canAttemptInlineManagerProof: isManagerStaff(args.staff),
                pinHash: args.sameSubmissionApproval.pinHash,
                requestedByStaffProfileId:
                  staffProfileId ?? args.staff.staffProfileId,
                username: args.sameSubmissionApproval.username,
              }
            : undefined,
        onApprovalRequired: (approval) => {
          if (!requiresInlineManagerProof(approval)) {
            exitVoidWorkflow();
            toast.success("Void queued for manager review");
          }
        },
        onResult: (result) => {
          if (isApprovalRequiredResult(result)) {
            return;
          }

          if (result.kind === "ok") {
            setLocalVoidState({ reason, result: result.data });
            exitVoidWorkflow();
            toast.success("Sale voided");
            return;
          }

          setVoidError(normalizeVoidCommandError(result.error.message));
        },
      });
    } finally {
      setVoidSubmitting(false);
    }
  }

  function requestCorrectionSubmit(
    kind: "customer" | "payment_method" | "line_items",
  ) {
    setCorrectionError(null);

    if (kind === "customer" && !customerCorrectionReason.trim()) {
      setCorrectionError("Add a reason for this update");
      return;
    }

    if (kind === "payment_method") {
      if (!paymentMethodInput.trim()) {
        setCorrectionError("Choose the updated payment method");
        return;
      }
      if (paymentMethodInput === currentPaymentMethod) {
        setCorrectionError("Choose a different payment method");
        return;
      }

      if (!paymentCorrectionReason.trim()) {
        setCorrectionError("Add a reason for this update");
        return;
      }
    }

    if (kind === "line_items") {
      if (!itemAdjustmentDraft?.hasChanges) {
        setCorrectionError(
          "Change at least one item quantity before submitting",
        );
        return;
      }

      if (!itemAdjustmentReason.trim()) {
        setCorrectionError("Add a reason for this item adjustment");
        return;
      }

      if (
        itemAdjustmentDraft.settlementDirection !== "none" &&
        !itemAdjustmentSettlementMethod.trim()
      ) {
        setCorrectionError("Choose a settlement method before submitting");
        return;
      }
    }

    if (kind === "payment_method") {
      setPendingCorrection(kind);
      return;
    }

    setPendingCorrection(kind);
  }

  function requestVoidSubmit() {
    if (!voidReason.trim()) {
      setVoidError("Reason is required before voiding this sale");
      return;
    }

    setVoidError(null);
    setPendingCorrection("void");
  }

  return (
    <View
      header={
        <ComposedPageHeader
          leadingContent={
            <p className="text-sm">
              Transaction #{transaction.transactionNumber}
            </p>
          }
          trailingContent={
            transaction.sessionTraceId ? (
              <Button asChild size="sm" type="button" variant="ghost">
                <WorkflowTraceRouteLink traceId={transaction.sessionTraceId}>
                  View trace
                </WorkflowTraceRouteLink>
              </Button>
            ) : null
          }
        />
      }
    >
      <StaffAuthenticationDialog
        copy={staffAuthenticationDialogCopy}
        getSuccessMessage={(result) => {
          const staffDisplayName = formatStaffDisplayName(result.staffProfile);
          return staffDisplayName
            ? `Confirmed as ${staffDisplayName}`
            : "Staff credentials confirmed";
        }}
        onAuthenticate={(args) =>
          authenticateCorrectionStaff({
            pinHash: args.pinHash,
            username: args.username,
          })
        }
        onAuthenticated={(result, _mode, credentials) => {
          const correction = pendingCorrection;
          setPendingCorrection(null);
          if (correction === "payment_method") {
            void runPaymentMethodCorrection({
              sameSubmissionApproval: credentials,
              staff: result,
              staffProfileId: result.staffProfileId,
            });
            return;
          }

          if (correction === "line_items") {
            void runItemAdjustment({
              sameSubmissionApproval: credentials,
              staff: result,
              staffProfileId: result.staffProfileId,
            });
            return;
          }

          if (correction === "void") {
            void runTransactionVoid({
              sameSubmissionApproval: credentials,
              staff: result,
              staffProfileId: result.staffProfileId,
            });
            return;
          }

          if (correction === "customer") {
            void runCustomerCorrection(result);
          }
        }}
        onDismiss={() => setPendingCorrection(null)}
        open={
          pendingCorrection === "customer" ||
          pendingCorrection === "payment_method" ||
          pendingCorrection === "line_items" ||
          pendingCorrection === "void"
        }
      />
      {paymentApprovalRunner.dialog}
      {itemAdjustmentApprovalRunner.dialog}
      {voidApprovalRunner.dialog}
      <FadeIn className="h-full">
        <div className="container mx-auto h-full min-h-0 px-4 pb-16 pt-4 sm:px-6 sm:pt-6">
          <div className="grid min-h-0 gap-6 xl:h-full xl:grid-cols-[380px,minmax(0,1fr)] xl:gap-8">
            <div className="order-2 space-y-6 pb-16 xl:order-1">
              <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border/80 bg-surface-raised shadow-surface">
                <CardHeader className="space-y-4 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge
                      variant="outline"
                      className={
                        isVoidedTransaction
                          ? "flex w-fit items-center gap-2 border-danger/25 bg-danger/10 text-danger"
                          : "flex w-fit items-center gap-2 border-[hsl(var(--success)/0.22)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]"
                      }
                    >
                      {isVoidedTransaction ? (
                        <Ban className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {transactionStatusLabel}
                      <p className="text-xs text-muted-foreground">
                        {transactionStatusTime}
                      </p>
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="border-t border-border/70 p-0 text-sm">
                  <dl className="divide-y divide-border/70">
                    {transaction.cashier ? (
                      <div className="flex items-center gap-3 px-6 py-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.85)] bg-muted text-muted-foreground">
                          <User className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Cashier
                          </dt>
                          <dd className="mt-1 truncate font-medium text-foreground">
                            {formatStaffDisplayName(transaction.cashier)}
                          </dd>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex items-center gap-3 px-6 py-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.85)] bg-muted text-muted-foreground">
                        <PaymentIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Payment
                        </dt>
                        <dd className="mt-1 truncate font-medium capitalize text-foreground">
                          {paymentMethodLabel}
                        </dd>
                      </div>
                    </div>

                    {(transaction.customer || transaction.customerInfo) && (
                      <div className="px-6 py-4">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Customer
                        </dt>
                        <dd className="mt-1 font-medium text-foreground">
                          {transaction.customer?.name ||
                            transaction.customerInfo?.name ||
                            "Walk-in customer"}
                        </dd>
                        {(transaction.customer?.email ||
                          transaction.customer?.phone ||
                          transaction.customerInfo?.email ||
                          transaction.customerInfo?.phone) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {transaction.customer?.email ||
                              transaction.customerInfo?.email}
                            {(transaction.customer?.email ||
                              transaction.customerInfo?.email) &&
                            (transaction.customer?.phone ||
                              transaction.customerInfo?.phone)
                              ? " • "
                              : ""}
                            {transaction.customer?.phone ||
                              transaction.customerInfo?.phone}
                          </p>
                        )}
                      </div>
                    )}
                  </dl>

                  <div className="border-t border-border/70 bg-muted/20 p-6">
                    {isCompletedTransaction ? (
                      <div className="grid gap-2">
                        {!isVoidedTransaction ? (
                          <Button
                            className="w-full"
                            onClick={() => {
                              if (correctionPanelOpen) {
                                exitCorrectionWorkflow();
                                return;
                              }

                              setCorrectionPanelOpen(true);
                              setVoidPanelOpen(false);
                              setCorrectionError(null);
                            }}
                            type="button"
                            variant={
                              correctionPanelOpen ? "workflow" : "outline"
                            }
                          >
                            Update
                          </Button>
                        ) : null}
                        {canVoidTransaction || hasPendingVoidApprovalRequest ? (
                          <Button
                            className="w-full"
                            disabled={hasPendingVoidApprovalRequest}
                            onClick={() => {
                              if (hasPendingVoidApprovalRequest) {
                                return;
                              }

                              if (voidPanelOpen) {
                                exitVoidWorkflow();
                                return;
                              }

                              setVoidPanelOpen(true);
                              setCorrectionPanelOpen(false);
                              setVoidError(null);
                            }}
                            type="button"
                            variant={
                              voidPanelOpen ? "destructive" : "outline"
                            }
                          >
                            {hasPendingVoidApprovalRequest
                              ? "Void requested"
                              : "Void sale"}
                          </Button>
                        ) : null}
                        {voidApprovalLinkParams ? (
                          <div className="rounded-[calc(var(--radius)*0.85)] border border-border bg-background p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <p className="text-sm font-medium text-foreground">
                                  Void approval pending
                                </p>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  Review this request in Approvals before the
                                  sale can be voided.
                                </p>
                              </div>
                              <Button
                                asChild
                                className="h-8 shrink-0 px-2 text-xs"
                                size="sm"
                                variant="ghost"
                              >
                                <Link
                                  params={voidApprovalLinkParams}
                                  search={{ o: getOrigin() }}
                                  to="/$orgUrlSlug/store/$storeUrlSlug/operations/approvals"
                                >
                                  Review
                                  <ArrowUpRight
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5"
                                  />
                                </Link>
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* {transaction.notes && (
                    <div className="space-y-1">
                      <p className="font-medium">Notes</p>
                      <p className="text-sm text-muted-foreground">
                        {transaction.notes}
                      </p>
                    </div>
                  )} */}
                </CardContent>
              </section>

              {voidPanelOpen && canVoidTransaction ? (
                <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-danger/25 bg-surface-raised shadow-surface">
                  <div className="border-b border-border/70 px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.85)] bg-danger/10 text-danger">
                        <Ban className="h-4 w-4" />
                      </div>
                      <div className="space-y-1">
                        <h2 className="font-display text-lg font-semibold text-foreground">
                          Void completed sale
                        </h2>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Staff sign-in and manager approval are required.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 p-5">
                    <Textarea
                      aria-label="Void reason"
                      aria-required="true"
                      className="min-h-[90px] border-input bg-background"
                      onChange={(event) => setVoidReason(event.target.value)}
                      placeholder="Reason for voiding this completed sale."
                      required
                      value={voidReason}
                    />
                    {voidError ? (
                      <p className="text-sm text-destructive">{voidError}</p>
                    ) : null}
                    <div className="grid gap-2">
                      <Button
                        className="border-danger/40 bg-danger/5 text-danger hover:bg-danger/10 hover:text-danger"
                        disabled={voidSubmitting}
                        onClick={requestVoidSubmit}
                        type="button"
                        variant="outline"
                      >
                        Submit void
                      </Button>
                      <Button
                        disabled={voidSubmitting}
                        onClick={exitVoidWorkflow}
                        type="button"
                        variant="outline"
                      >
                        Cancel void
                      </Button>
                    </div>
                  </div>
                </section>
              ) : null}

              {isVoidedTransaction ? (
                <section className="space-y-4 overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-danger/25 bg-surface-raised p-5 shadow-surface">
                  <div className="space-y-1">
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      Sale voided
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Original sale details remain visible. Payment and
                      inventory reversals are recorded separately.
                    </p>
                  </div>
                  <dl className="grid gap-3 rounded-lg border border-border bg-background p-4 text-sm">
                    {transactionVoidedAt ? (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">Voided</dt>
                        <dd className="font-medium text-foreground">
                          {getRelativeTime(transactionVoidedAt)}
                        </dd>
                      </div>
                    ) : null}
                    {transactionVoidReason ? (
                      <div className="border-t border-border/70 pt-3">
                        <dt className="text-muted-foreground">Reason</dt>
                        <dd className="mt-1 text-foreground">
                          {transactionVoidReason}
                        </dd>
                      </div>
                    ) : null}
                    {localVoidState ? (
                      <div className="grid gap-2 border-t border-border/70 pt-3 text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <dt>Payment reversals</dt>
                          <dd className="font-numeric text-foreground">
                            {localVoidState.result.paymentAllocationIds.length}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt>Inventory movements</dt>
                          <dd className="font-numeric text-foreground">
                            {localVoidState.result.inventoryMovementIds.length}
                          </dd>
                        </div>
                      </div>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              {correctionPanelOpen ? (
                <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border/80 bg-surface-raised shadow-surface">
                  <div className="border-b border-border/70 px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.85)] bg-muted text-muted-foreground">
                        <RefreshCw className="h-4 w-4" />
                      </div>
                      <div className="space-y-1">
                        <h2 className="font-display text-lg font-semibold text-foreground">
                          Transaction updates
                        </h2>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Update payment labels here. Use guided workflows for
                          sale totals and item changes.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5 p-5">
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Direct updates
                      </p>
                      <div className="grid gap-2">
                        <Button
                          aria-label="Customer attribution"
                          className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
                          disabled
                          onClick={() => undefined}
                          type="button"
                          variant="outline"
                        >
                          <span className="grid gap-1">
                            <span>Customer attribution</span>
                            <span className="text-xs font-normal opacity-75">
                              Change walk-in or customer assignment.
                            </span>
                          </span>
                        </Button>
                        {selectedCorrection === "customer" ? (
                          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                            <p className="text-sm font-medium text-foreground">
                              Customer attribution update
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Staff sign-in and customer lookup will update
                              attribution only.
                            </p>
                            <Input
                              aria-label="Updated customer profile ID"
                              className="border-input bg-background"
                              onChange={(event) =>
                                setCustomerProfileIdInput(event.target.value)
                              }
                              placeholder="Customer profile ID, or leave blank for walk-in."
                              value={customerProfileIdInput}
                            />
                            <Textarea
                              aria-label="Customer update reason"
                              className="min-h-[80px] border-input bg-background"
                              onChange={(event) =>
                                setCustomerCorrectionReason(event.target.value)
                              }
                              placeholder="Reason for customer attribution update."
                              value={customerCorrectionReason}
                            />
                            {showCustomerCorrectionError ? (
                              <p className="text-sm text-destructive">
                                {correctionError}
                              </p>
                            ) : null}
                            <Button
                              disabled={correctionSubmitting}
                              onClick={() =>
                                requestCorrectionSubmit("customer")
                              }
                              type="button"
                            >
                              Submit customer update
                            </Button>
                          </div>
                        ) : null}
                        <Button
                          aria-label="Payment method"
                          className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
                          disabled={!supportsPaymentMethodCorrection}
                          onClick={() => {
                            if (supportsPaymentMethodCorrection) {
                              setSelectedCorrection("payment_method");
                            }
                          }}
                          type="button"
                          variant={
                            selectedCorrection === "payment_method"
                              ? "workflow-soft"
                              : "outline"
                          }
                        >
                          <span className="grid gap-1">
                            <span>Payment method</span>
                            <span className="text-xs font-normal opacity-75">
                              Same-amount method update only.
                            </span>
                          </span>
                        </Button>
                        {!supportsPaymentMethodCorrection ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-sm text-muted-foreground">
                            {paymentMethodCorrectionUnavailableMessage}
                          </div>
                        ) : null}
                        {showPaymentMethodDirectFlow ? (
                          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                            <p className="text-sm font-medium text-foreground">
                              Same-amount payment method update
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Staff sign-in will keep the paid amount unchanged
                              and update the method history.
                            </p>
                            <Select
                              onValueChange={(value) =>
                                setPaymentMethodInput(value)
                              }
                              value={paymentMethodInput}
                            >
                              <SelectTrigger
                                aria-label="Updated payment method"
                                className="border-input bg-background"
                              >
                                <SelectValue placeholder="Choose payment method" />
                              </SelectTrigger>
                              <SelectContent>
                                {correctionPaymentMethodOptions.map(
                                  (option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                            <Textarea
                              aria-label="Payment method update reason"
                              className="min-h-[80px] border-input bg-background"
                              onChange={(event) =>
                                setPaymentCorrectionReason(event.target.value)
                              }
                              placeholder="Reason for payment method update."
                              value={paymentCorrectionReason}
                            />
                            {showPaymentMethodCorrectionError ? (
                              <p className="text-sm text-destructive">
                                {correctionError}
                              </p>
                            ) : null}
                            <div className="grid gap-2">
                              <Button
                                disabled={correctionSubmitting}
                                onClick={() =>
                                  requestCorrectionSubmit("payment_method")
                                }
                                type="button"
                                variant="workflow"
                              >
                                Submit payment update
                              </Button>
                              <Button
                                disabled={correctionSubmitting}
                                onClick={cancelPaymentMethodWorkflow}
                                type="button"
                                variant="outline"
                              >
                                Cancel payment update
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-border/70 pt-4">
                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Guided routes
                      </p>
                      <div className="grid gap-2">
                        <Button
                          aria-label="Items or quantities"
                          className="h-auto justify-start whitespace-normal px-3 py-2.5 text-left"
                          onClick={() => {
                            setSelectedCorrection("line_items");
                            setCorrectionError(null);
                          }}
                          type="button"
                          variant={
                            selectedCorrection === "line_items"
                              ? "workflow-soft"
                              : "outline"
                          }
                        >
                          Items or quantities
                        </Button>
                        <Button
                          aria-label="Amounts or totals"
                          className="h-auto justify-start whitespace-normal px-3 py-2.5 text-left"
                          disabled
                          onClick={() => undefined}
                          type="button"
                          variant="outline"
                        >
                          Amounts or totals
                        </Button>
                        <Button
                          aria-label="Discounts"
                          className="h-auto justify-start whitespace-normal px-3 py-2.5 text-left"
                          disabled
                          onClick={() => undefined}
                          type="button"
                          variant="outline"
                        >
                          Discounts
                        </Button>
                      </div>
                    </div>

                    {selectedCorrection === "line_items" &&
                    itemAdjustmentDraft ? (
                      <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            Review item adjustment
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Adjust completed-sale quantities, then submit the
                            complete bundle for manager approval.
                          </p>
                        </div>

                        <div className="divide-y divide-border/70 rounded-lg border border-border bg-background">
                          {itemAdjustmentDraft.lines.map((line) => {
                            const productDisplayName = capitalizeWords(
                              line.item.productName,
                            );

                            return (
                              <div
                                className="grid gap-3 px-3 py-3"
                                key={line.item._id}
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {productDisplayName}
                                  </p>
                                  <p className="mt-1 truncate text-xs text-muted-foreground">
                                    {line.item.productSku}
                                  </p>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-xs text-muted-foreground">
                                    Original {line.item.quantity}
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      aria-label={`Decrease ${productDisplayName}`}
                                      disabled={line.correctedQuantity <= 0}
                                      onClick={() =>
                                        setCorrectedQuantities((current) => ({
                                          ...current,
                                          [line.item._id]: Math.max(
                                            0,
                                            line.correctedQuantity - 1,
                                          ),
                                        }))
                                      }
                                      size="icon"
                                      type="button"
                                      variant="outline"
                                    >
                                      <Minus aria-hidden="true" />
                                    </Button>
                                    <Input
                                      aria-label={`Adjusted quantity for ${productDisplayName}`}
                                      className="h-9 w-20 border-input bg-background text-center font-numeric"
                                      min={0}
                                      onChange={(event) => {
                                        const quantity = Number(
                                          event.target.value,
                                        );
                                        setCorrectedQuantities((current) => ({
                                          ...current,
                                          [line.item._id]:
                                            Number.isFinite(quantity) &&
                                            quantity >= 0
                                              ? Math.trunc(quantity)
                                              : line.correctedQuantity,
                                        }));
                                      }}
                                      type="number"
                                      value={line.correctedQuantity}
                                    />
                                    <Button
                                      aria-label={`Increase ${productDisplayName}`}
                                      onClick={() =>
                                        setCorrectedQuantities((current) => ({
                                          ...current,
                                          [line.item._id]:
                                            line.correctedQuantity + 1,
                                        }))
                                      }
                                      size="icon"
                                      type="button"
                                      variant="outline"
                                    >
                                      <Plus aria-hidden="true" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="grid gap-3 rounded-lg border border-border bg-background p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                              Original total
                            </span>
                            <span className="font-numeric font-medium">
                              {formatStoredAmount(
                                ghsCurrencyFormatter,
                                transaction.total,
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                              Adjusted total
                            </span>
                            <span className="font-numeric font-medium">
                              {formatStoredAmount(
                                ghsCurrencyFormatter,
                                itemAdjustmentDraft.adjustedTotal,
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                            <span className="font-medium text-foreground">
                              {itemAdjustmentDraft.settlementDirection ===
                              "refund"
                                ? "Refund due"
                                : itemAdjustmentDraft.settlementDirection ===
                                    "collection"
                                  ? "Balance due"
                                  : "No payment movement"}
                            </span>
                            <span className="font-numeric font-semibold text-foreground">
                              {itemAdjustmentDraft.settlementDirection ===
                              "none"
                                ? "No payment movement"
                                : formatStoredAmount(
                                    ghsCurrencyFormatter,
                                    itemAdjustmentDraft.settlementAmount,
                                  )}
                            </span>
                          </div>
                        </div>

                        {itemAdjustmentDraft.settlementDirection !== "none" ? (
                          <Select
                            aria-label="Settlement method"
                            onValueChange={(value) =>
                              setItemAdjustmentSettlementMethod(value)
                            }
                            value={itemAdjustmentSettlementMethod}
                          >
                            <SelectTrigger
                              aria-label="Settlement method"
                              className="border-input bg-background"
                            >
                              <SelectValue placeholder="Choose settlement method" />
                            </SelectTrigger>
                            <SelectContent>
                              {PAYMENT_METHOD_OPTIONS.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}
                        <Textarea
                          aria-label="Item adjustment reason"
                          className="min-h-[80px] border-input bg-background"
                          onChange={(event) =>
                            setItemAdjustmentReason(event.target.value)
                          }
                          placeholder="Reason for item adjustment."
                          value={itemAdjustmentReason}
                        />
                        {selectedCorrection === "line_items" &&
                        correctionError ? (
                          showRegisterExpectedCashRecovery ? (
                            <div className="space-y-3 rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm">
                              <p className="font-medium text-destructive">
                                Drawer expected cash is below this refund.
                              </p>
                              <p className="leading-5 text-muted-foreground">
                                Correct the register session opening float so
                                expected cash can cover the cash refund, then
                                submit the item adjustment again.
                              </p>
                              {registerSessionRecoveryLink ? (
                                <Link
                                  className="inline-flex items-center gap-1 pt-1 font-medium text-destructive underline-offset-4 hover:underline"
                                  params={registerSessionRecoveryLink}
                                  search={{ o: getOrigin() }}
                                  to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                                >
                                  Review register session
                                  <ArrowUpRight
                                    aria-hidden="true"
                                    className="h-3 w-3"
                                  />
                                </Link>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-destructive">
                              {correctionError}
                            </p>
                          )
                        ) : null}
                        <div className="grid gap-2">
                          <Button
                            disabled={correctionSubmitting}
                            onClick={() =>
                              requestCorrectionSubmit("line_items")
                            }
                            type="button"
                            variant="workflow"
                          >
                            Submit item adjustment
                          </Button>
                          <Button
                            disabled={correctionSubmitting}
                            onClick={cancelItemAdjustmentWorkflow}
                            type="button"
                            variant="outline"
                          >
                            Cancel item adjustment
                          </Button>
                        </div>
                      </div>
                    ) : selectedCorrection &&
                      !["customer", "payment_method"].includes(
                        selectedCorrection,
                      ) ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-sm text-muted-foreground">
                        Use refund, exchange, or manager review for item,
                        amount, total, or discount updates.
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {transaction.adjustmentSummary?.hasAdjustments ? (
                <section className="space-y-4 overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border/80 bg-surface-raised p-5 shadow-surface">
                  <div className="space-y-1">
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      {hasAppliedItemAdjustment
                        ? "Adjusted sale"
                        : "Adjustment state"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {hasAppliedItemAdjustment
                        ? "Original sale totals stay locked. Applied totals are shown for closeout and reporting."
                        : "Original sale totals stay locked. Pending totals apply after approval."}
                    </p>
                  </div>
                  <dl className="grid gap-3 rounded-lg border border-border bg-background p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">
                        Original sale total
                      </dt>
                      <dd className="font-numeric font-medium">
                        {formatStoredAmount(
                          ghsCurrencyFormatter,
                          originalSaleTotal,
                        )}
                      </dd>
                    </div>
                    {hasAppliedItemAdjustment ? (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">
                          Applied sale total
                        </dt>
                        <dd className="font-numeric font-semibold">
                          {formatStoredAmount(
                            ghsCurrencyFormatter,
                            effectiveSaleTotal,
                          )}
                        </dd>
                      </div>
                    ) : null}
                    {pendingSaleTotal !== null ? (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">
                          Pending sale total
                        </dt>
                        <dd className="font-numeric font-semibold">
                          {formatStoredAmount(
                            ghsCurrencyFormatter,
                            pendingSaleTotal,
                          )}
                        </dd>
                      </div>
                    ) : null}
                    {hasAppliedItemAdjustment ? (
                      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                        <dt className="text-muted-foreground">
                          Item adjustment
                        </dt>
                        <dd className="font-numeric font-medium text-foreground">
                          {totalAppliedAdjustmentDelta > 0 ? "+" : ""}
                          {formatStoredAmount(
                            ghsCurrencyFormatter,
                            totalAppliedAdjustmentDelta,
                          )}
                        </dd>
                      </div>
                    ) : null}
                    {transaction.adjustmentSummary.pendingCount > 0 ? (
                      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                        <dt className="text-muted-foreground">
                          Pending approval
                        </dt>
                        <dd className="font-medium text-foreground">
                          {transaction.adjustmentSummary.pendingCount}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="space-y-3">
                    {transaction.adjustments?.map((adjustment) => {
                      const adjustedLineItems =
                        adjustment.lineItems.filter(isAdjustedLineItem);

                      return (
                        <div
                          className="rounded-lg border border-border bg-muted/20 p-4"
                          key={adjustment._id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {adjustment.status === "pending_approval"
                                  ? "Item adjustment pending approval"
                                  : "Item adjustment applied"}
                              </p>
                              {adjustment.actorStaffName ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Requested by {adjustment.actorStaffName}
                                </p>
                              ) : null}
                            </div>
                            <Badge variant="outline">
                              {adjustment.settlementDirection === "refund"
                                ? "Refund due"
                                : adjustment.settlementDirection ===
                                      "collection" ||
                                    adjustment.settlementDirection === "collect"
                                  ? "Balance due"
                                  : "No payment movement"}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm text-muted-foreground">
                            {adjustment.settlementDirection === "none"
                              ? "No payment movement"
                              : formatStoredAmount(
                                  ghsCurrencyFormatter,
                                  adjustment.settlementAmount,
                                )}
                          </p>
                          {adjustedLineItems.length > 0 ? (
                            <div className="mt-4 space-y-2 border-t border-border/70 pt-3">
                              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Items adjusted
                              </p>
                              <div className="space-y-2">
                                {adjustedLineItems.map((line) => (
                                  <div
                                    className="grid gap-1 rounded-md bg-background px-3 py-2 text-sm"
                                    key={`${adjustment._id}-${line.productName}-${line.productSku ?? "sku"}`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <span className="font-medium text-foreground">
                                        {capitalizeWords(line.productName)}
                                      </span>
                                      {typeof line.totalDelta === "number" ? (
                                        <span className="font-numeric text-foreground">
                                          {line.totalDelta > 0 ? "+" : ""}
                                          {formatStoredAmount(
                                            ghsCurrencyFormatter,
                                            line.totalDelta,
                                          )}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {line.productSku
                                        ? `${line.productSku} · `
                                        : ""}
                                      {typeof line.originalQuantity ===
                                        "number" &&
                                      typeof line.adjustedQuantity === "number"
                                        ? `${line.originalQuantity} original to ${line.adjustedQuantity} adjusted`
                                        : "Quantity adjusted"}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {correctionHistory.length > 0 ? (
                <section className="space-y-4 overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border/80 bg-surface-raised p-5 shadow-surface">
                  <div className="space-y-1">
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      Update history
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Operational updates recorded for this transaction.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {visibleCorrectionHistory.map((event) => {
                      const changeParts =
                        getCorrectionHistoryChangeParts(event);

                      return (
                        <div
                          className="space-y-3 rounded-lg border border-border bg-muted/20 p-4"
                          key={event._id}
                        >
                          <div className="space-y-1">
                            <p className="text-sm font-medium leading-5 text-foreground">
                              {formatCorrectionHistoryTitle(event)}
                            </p>
                            <p className="text-xs leading-4 text-muted-foreground">
                              {formatCorrectionHistoryMeta(event)}
                            </p>
                          </div>
                          {changeParts ? (
                            <div
                              aria-label={
                                formatCorrectionHistoryChange(event) ??
                                undefined
                              }
                              className="flex min-w-0 items-center gap-2 rounded-md py-2 text-sm"
                            >
                              <span className="min-w-0 truncate text-muted-foreground">
                                {changeParts.previousPaymentMethod ??
                                  "Previous method"}
                              </span>
                              <MoveRight
                                aria-hidden="true"
                                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              />
                              <span className="min-w-0 truncate font-medium text-foreground">
                                {changeParts.paymentMethod}
                              </span>
                            </div>
                          ) : null}
                          {event.reason ? (
                            <p className="border-t border-border/70 pt-3 text-sm leading-5 text-muted-foreground">
                              {event.reason}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                    {hiddenCorrectionCount > 0 ? (
                      <Button
                        className="w-full"
                        onClick={() =>
                          setCorrectionHistoryExpanded((value) => !value)
                        }
                        type="button"
                        variant="outline"
                      >
                        {correctionHistoryExpanded
                          ? "Show fewer updates"
                          : `Show ${hiddenCorrectionCount} more ${
                              hiddenCorrectionCount === 1 ? "update" : "updates"
                            }`}
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <OrderSummary
                cartItems={displayCartItems}
                readOnly
                presentation="rail"
                registerNumber={transaction.registerNumber}
                terminalName={transaction.terminalName}
                completedOrderNumber={transaction.transactionNumber}
                completedTransactionData={completedData}
                completedAdjustmentSummary={
                  hasAppliedItemAdjustment && latestAppliedAdjustment
                    ? {
                        originalTotal: originalSaleTotal,
                        settlementAmount:
                          latestAppliedAdjustment.settlementAmount,
                        settlementDirection:
                          latestAppliedAdjustment.settlementDirection,
                        settlementMethod:
                          latestAppliedAdjustment.settlementMethod,
                        totalDelta: totalAppliedAdjustmentDelta,
                      }
                    : null
                }
                cashierName={
                  transaction.cashier
                    ? (formatStaffDisplayName(transaction.cashier) ?? undefined)
                    : undefined
                }
                receiptNumberOverride={transaction.transactionNumber}
                receiptMessaging={receiptMessaging}
                receiptPrintTransactionId={transaction._id}
                onReceiptPrinted={(printedTransactionId) =>
                  markReceiptPrinted({
                    transactionId: printedTransactionId,
                  })
                }
                pendingVoidApprovalRequestId={pendingVoidApprovalRequestId}
                customerInfo={
                  transaction.customer
                    ? {
                        name: transaction.customer.name ?? "",
                        email: transaction.customer.email ?? "",
                        phone: transaction.customer.phone ?? "",
                      }
                    : transaction.customerInfo
                      ? {
                          name: transaction.customerInfo.name ?? "",
                          email: transaction.customerInfo.email ?? "",
                          phone: transaction.customerInfo.phone ?? "",
                        }
                      : undefined
                }
              />
            </div>

            <CartItems
              cartItems={displayCartItems}
              serviceItems={displayServiceItems}
              readOnly
              className="order-1 min-h-[22rem] xl:order-2 xl:h-full xl:min-h-0"
            />
          </div>
        </div>
      </FadeIn>
    </View>
  );
}

export default TransactionView;
