import { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  MoveRight,
  ShieldAlert,
  WalletCards,
  Smartphone,
  User,
  RefreshCw,
} from "lucide-react";

import View from "../../View";
import { FadeIn } from "../../common/FadeIn";
import { ComposedPageHeader } from "../../common/PageHeader";
import { api } from "~/convex/_generated/api";
import { Badge } from "../../ui/badge";
import { getRelativeTime } from "~/src/lib/utils";
import { PosPaymentMethod } from "~/src/lib/pos/domain";
import { OrderSummary } from "../OrderSummary";
import { CartItems } from "../CartItems";
import type { CartItem } from "../types";
import type { Id } from "~/convex/_generated/dataModel";
import { CardContent, CardHeader } from "../../ui/card";
import { WorkflowTraceRouteLink } from "../../traces/WorkflowTraceRouteLink";
import { Button } from "../../ui/button";
import config from "~/src/config";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";
import { Textarea } from "../../ui/textarea";
import { Input } from "../../ui/input";
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
import { useApprovedCommand } from "../../operations/useApprovedCommand";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";

type RouteParams =
  | {
      transactionId: string;
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

const PAYMENT_METHOD_OPTIONS = [
  { label: "Cash", value: "cash" },
  { label: "Card", value: "card" },
  { label: "Mobile Money", value: "mobile_money" },
] satisfies Array<{ label: string; value: PosPaymentMethod }>;

function formatCorrectionEventType(eventType: string) {
  return eventType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCorrectionHistoryTitle(event: CorrectionEvent) {
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

function formatPaymentMethodLabel(method: unknown) {
  if (typeof method !== "string" || !method.trim()) {
    return null;
  }

  return method
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requiresInlineManagerProof(approval: ApprovalRequirement) {
  return approval.resolutionModes.some(
    (mode) => mode.kind === "inline_manager_proof",
  );
}

function formatCorrectionHistoryChange(event: CorrectionEvent) {
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

function getCorrectionHistoryChangeParts(event: CorrectionEvent) {
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

export function TransactionView() {
  const params = useParams({
    strict: false,
  }) as RouteParams;
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
  const [customerProfileIdInput, setCustomerProfileIdInput] = useState("");
  const [customerCorrectionReason, setCustomerCorrectionReason] = useState("");
  const [paymentCorrectionReason, setPaymentCorrectionReason] = useState("");
  const [paymentMethodInput, setPaymentMethodInput] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [pendingCorrection, setPendingCorrection] = useState<
    "customer" | "payment_method" | null
  >(null);
  const [correctionHistoryExpanded, setCorrectionHistoryExpanded] =
    useState(false);
  const { activeStore, isAuthenticated } = useProtectedAdminPageState();
  const correctAuth = useMutation(
    api.operations.staffCredentials.authenticateStaffCredential,
  );
  const approveCommand = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );
  const correctCustomer = useMutation(
    api.inventory.pos.correctTransactionCustomer,
  );
  const correctPaymentMethod = useMutation(
    api.inventory.pos.correctTransactionPaymentMethod,
  );
  const paymentApprovalRunner = useApprovedCommand({
    storeId: activeStore?._id,
    onAuthenticateForApproval: (args) => {
      if (!activeStore?._id) {
        return Promise.resolve({
          kind: "user_error",
          error: {
            code: "authentication_failed",
            message: "Select a store before approving this command.",
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
            requestedByStaffProfileId: args.requestedByStaffProfileId,
            storeId: activeStore._id,
            subject: args.subject,
            username: args.username,
          }) as Promise<CommandResult<{
            approvalProofId: Id<"approvalProof">;
            approvedByStaffProfileId: Id<"staffProfile">;
            expiresAt: number;
            requestedByStaffProfileId?: Id<"staffProfile">;
          }>>,
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

  const completedData = useMemo(() => {
    if (!transaction) return undefined;
    return {
      paymentMethod: transaction.paymentMethod || "cash",
      completedAt: transaction.completedAt,
      cartItems,
      subtotal: transaction.subtotal,
      tax: transaction.tax,
      total: transaction.total,
      payments: transaction.payments.map((payment, index) => ({
        id: `${payment.method}-${index}-${payment.timestamp}`,
        ...payment,
        method: payment.method as PosPaymentMethod,
      })),
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
  }, [transaction, cartItems]);

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
    ? Array.from(new Set(transaction.payments.map((payment) => payment.method)))
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
  const storefrontReceiptUrl = `${config.storeFrontUrl.replace(
    /\/$/,
    "",
  )}/shop/receipt/${transactionId}`;
  const correctionHistory = getTransactionCorrectionHistory(transaction);
  const hiddenCorrectionCount = Math.max(0, correctionHistory.length - 2);
  const visibleCorrectionHistory = correctionHistoryExpanded
    ? correctionHistory
    : correctionHistory.slice(0, 2);
  const staffAuthenticationDialogCopy = {
    title: "Staff sign-in required",
    description: "Authenticate to record this update.",
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
      } to update payment details.`
    : "Only same-amount payment method updates are supported.";
  const currentPaymentMethod = (transaction.payments?.[0]?.method ??
    transaction.paymentMethod ??
    null) as PosPaymentMethod | null;
  const correctionPaymentMethodOptions = PAYMENT_METHOD_OPTIONS.filter(
    (option) => option.value !== currentPaymentMethod,
  );
  const showPaymentMethodDirectFlow =
    selectedCorrection === "payment_method" && supportsPaymentMethodCorrection;

  async function authenticateCorrectionStaff(args: {
    correction: "customer" | "payment_method" | null;
    pinHash: string;
    username: string;
  }) {
    if (!activeStore?._id) {
      return {
        kind: "user_error" as const,
        error: {
          code: "authentication_failed" as const,
          message: "Select a store before confirming staff credentials.",
        },
      };
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

  async function runCustomerCorrection(staff: StaffAuthenticationResult) {
    if (!isAuthenticated) {
      setCorrectionError("Sign in again before updating this transaction.");
      return;
    }

    const reason = customerCorrectionReason.trim();
    if (!reason) {
      setCorrectionError("Add a reason for this update.");
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
    approvalProofId?: Id<"approvalProof">;
    staffProfileId?: Id<"staffProfile">;
  }) {
    if (!isAuthenticated) {
      setCorrectionError("Sign in again before updating this transaction.");
      return;
    }

    const paymentMethod = paymentMethodInput as PosPaymentMethod;
    const reason = paymentCorrectionReason.trim();
    if (!paymentMethod) {
      setCorrectionError("Choose the updated payment method.");
      return;
    }
    if (paymentMethod === currentPaymentMethod) {
      setCorrectionError("Choose a different payment method.");
      return;
    }
    if (!reason) {
      setCorrectionError("Add a reason for this update.");
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
              approvalProofId: approvalArgs.approvalProofId ?? args?.approvalProofId,
              paymentMethod,
              reason,
              transactionId: transactionId as Id<"posTransaction">,
            }) as Promise<ApprovalCommandResult<PaymentMethodCorrectionResultData>>,
        );
        setCorrectionSubmitting(false);
        return result;
      },
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

  function requestCorrectionSubmit(kind: "customer" | "payment_method") {
    setCorrectionError(null);

    if (kind === "customer" && !customerCorrectionReason.trim()) {
      setCorrectionError("Add a reason for this update.");
      return;
    }

    if (kind === "payment_method") {
      if (!paymentMethodInput.trim()) {
        setCorrectionError("Choose the updated payment method.");
        return;
      }
      if (paymentMethodInput === currentPaymentMethod) {
        setCorrectionError("Choose a different payment method.");
        return;
      }

      if (!paymentCorrectionReason.trim()) {
        setCorrectionError("Add a reason for this update.");
        return;
      }
    }

    if (kind === "payment_method") {
      setPendingCorrection(kind);
      return;
    }

    setPendingCorrection(kind);
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
            ? `Confirmed as ${staffDisplayName}.`
            : "Staff credentials confirmed.";
        }}
        onAuthenticate={(args) =>
          authenticateCorrectionStaff({
            correction: pendingCorrection,
            pinHash: args.pinHash,
            username: args.username,
          })
        }
        onAuthenticated={(result) => {
          const correction = pendingCorrection;
          setPendingCorrection(null);
          if (correction === "customer") {
            void runCustomerCorrection(result);
          }
          if (correction === "payment_method") {
            void runPaymentMethodCorrection({
              staffProfileId: result.staffProfileId,
            });
          }
        }}
        onDismiss={() => setPendingCorrection(null)}
        open={
          pendingCorrection === "customer" ||
          pendingCorrection === "payment_method"
        }
      />
      {paymentApprovalRunner.dialog}
      <FadeIn className="h-full">
        <div className="container mx-auto h-full min-h-0 px-6 pb-16 pt-6">
          <div className="grid h-full min-h-0 gap-8 xl:grid-cols-[380px,minmax(0,1fr)]">
            <div className="space-y-6 pb-16">
              <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border/80 bg-surface-raised shadow-surface">
                <CardHeader className="space-y-4 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge
                      variant="outline"
                      className="w-fit border-[hsl(var(--success)/0.22)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))] flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Completed
                      <p className="text-xs text-muted-foreground">
                        {getRelativeTime(transaction.completedAt)}
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

                  <div className="grid gap-3 border-t border-border/70 bg-muted/20 p-6 sm:grid-cols-2">
                    {isCompletedTransaction ? (
                      <Button
                        className="w-full"
                        onClick={() => {
                          if (correctionPanelOpen) {
                            exitCorrectionWorkflow();
                            return;
                          }

                          setCorrectionPanelOpen(true);
                          setCorrectionError(null);
                        }}
                        type="button"
                        variant={correctionPanelOpen ? "workflow" : "outline"}
                      >
                        Update
                      </Button>
                    ) : null}

                    <Button
                      className="w-full"
                      onClick={() =>
                        window.open(
                          storefrontReceiptUrl,
                          "_blank",
                          "noreferrer",
                        )
                      }
                      variant="outline"
                    >
                      View receipt
                    </Button>
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
                          Update customer attribution or payment labels here.
                          Use guided workflows for sale totals and item changes.
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
                          onClick={() => setSelectedCorrection("customer")}
                          type="button"
                          variant={
                            selectedCorrection === "customer"
                              ? "workflow-soft"
                              : "outline"
                          }
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
                            <Button
                              disabled={correctionSubmitting}
                              onClick={() =>
                                requestCorrectionSubmit("payment_method")
                              }
                              type="button"
                            >
                              Submit payment update
                            </Button>
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
                          onClick={() => setSelectedCorrection("line_items")}
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
                          onClick={() => setSelectedCorrection("amounts")}
                          type="button"
                          variant={
                            selectedCorrection === "amounts"
                              ? "workflow-soft"
                              : "outline"
                          }
                        >
                          Amounts or totals
                        </Button>
                        <Button
                          aria-label="Discounts"
                          className="h-auto justify-start whitespace-normal px-3 py-2.5 text-left"
                          onClick={() => setSelectedCorrection("discounts")}
                          type="button"
                          variant={
                            selectedCorrection === "discounts"
                              ? "workflow-soft"
                              : "outline"
                          }
                        >
                          Discounts
                        </Button>
                      </div>
                    </div>

                    {selectedCorrection &&
                    !["customer", "payment_method"].includes(
                      selectedCorrection,
                    ) ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-sm text-muted-foreground">
                        Use refund, exchange, or manager review for item,
                        amount, total, or discount updates.
                      </div>
                    ) : null}
                    {correctionError ? (
                      <p className="text-sm text-destructive">
                        {correctionError}
                      </p>
                    ) : null}
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
                cartItems={cartItems}
                readOnly
                presentation="rail"
                registerNumber={transaction.registerNumber}
                completedOrderNumber={transaction.transactionNumber}
                completedTransactionData={completedData}
                cashierName={
                  transaction.cashier
                    ? (formatStaffDisplayName(transaction.cashier) ?? undefined)
                    : undefined
                }
                receiptNumberOverride={transaction.transactionNumber}
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
              cartItems={cartItems}
              readOnly
              className="h-full min-h-0"
            />
          </div>
        </div>
      </FadeIn>
    </View>
  );
}

export default TransactionView;
