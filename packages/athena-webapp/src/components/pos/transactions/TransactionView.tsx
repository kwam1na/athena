import { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  ShieldAlert,
  WalletCards,
  Smartphone,
  User,
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
import { runCommand } from "~/src/lib/errors/runCommand";
import type { CommandResult } from "~/shared/commandResult";
import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
} from "../../staff-auth/StaffAuthenticationDialog";
import { useProtectedAdminPageState } from "~/src/hooks/useProtectedAdminPageState";

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
  reason?: string | null;
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
      return "Payment method corrected";
    case "transaction_customer_corrected":
    case "pos_transaction_customer_corrected":
      return "Customer attribution corrected";
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

function getTransactionCorrectionHistory(transaction: {
  correctionHistory?: CorrectionEvent[];
  timeline?: CorrectionEvent[];
}) {
  return transaction.correctionHistory ?? transaction.timeline ?? [];
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
  const { activeStore, isAuthenticated } = useProtectedAdminPageState();
  const correctAuth = useMutation(
    api.operations.staffCredentials.authenticateStaffCredential,
  );
  const correctCustomer = useMutation(
    api.inventory.pos.correctTransactionCustomer,
  );
  const correctPaymentMethod = useMutation(
    api.inventory.pos.correctTransactionPaymentMethod,
  );

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
  const isCompletedTransaction = transaction.status === "completed";
  const hasSinglePayment = (transaction.payments?.length ?? 0) <= 1;
  const showPaymentMethodDirectFlow =
    selectedCorrection === "payment_method" && hasSinglePayment;

  async function authenticateCorrectionStaff(args: {
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

  async function runCustomerCorrection(staff: StaffAuthenticationResult) {
    if (!isAuthenticated) {
      setCorrectionError("Sign in again before correcting this transaction.");
      return;
    }

    const reason = customerCorrectionReason.trim();
    if (!reason) {
      setCorrectionError("Add a reason for this correction.");
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
      toast.success("Customer attribution corrected");
      return;
    }

    setCorrectionError(result.error.message);
  }

  async function runPaymentMethodCorrection(staff: StaffAuthenticationResult) {
    if (!isAuthenticated) {
      setCorrectionError("Sign in again before correcting this transaction.");
      return;
    }

    const paymentMethod = paymentMethodInput as PosPaymentMethod;
    const reason = paymentCorrectionReason.trim();
    if (!paymentMethod) {
      setCorrectionError("Choose the corrected payment method.");
      return;
    }
    if (!reason) {
      setCorrectionError("Add a reason for this correction.");
      return;
    }

    setCorrectionSubmitting(true);
    setCorrectionError(null);
    const result = await runCommand(
      () =>
        correctPaymentMethod({
          actorStaffProfileId: staff.staffProfileId,
          paymentMethod,
          reason,
          transactionId: transactionId as Id<"posTransaction">,
        }) as Promise<CommandResult<unknown>>,
    );
    setCorrectionSubmitting(false);

    if (result.kind === "ok") {
      setPaymentCorrectionReason("");
      setPaymentMethodInput("");
      toast.success("Payment method corrected");
      return;
    }

    setCorrectionError(result.error.message);
  }

  function requestCorrectionSubmit(kind: "customer" | "payment_method") {
    setCorrectionError(null);

    if (kind === "customer" && !customerCorrectionReason.trim()) {
      setCorrectionError("Add a reason for this correction.");
      return;
    }

    if (kind === "payment_method") {
      if (!paymentMethodInput.trim()) {
        setCorrectionError("Choose the corrected payment method.");
        return;
      }

      if (!paymentCorrectionReason.trim()) {
        setCorrectionError("Add a reason for this correction.");
        return;
      }
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
        copy={{
          title: "Staff sign-in required",
          description: "Enter username and PIN to record this correction.",
          submitLabel: "Confirm staff",
        }}
        getSuccessMessage={(result) => {
          const staffDisplayName = formatStaffDisplayName(result.staffProfile);
          return staffDisplayName
            ? `Confirmed as ${staffDisplayName}.`
            : "Staff credentials confirmed.";
        }}
        onAuthenticate={(args) =>
          authenticateCorrectionStaff({
            pinHash: args.pinHash,
            username: args.username,
          })
        }
        onAuthenticated={(result) => {
          const correction = pendingCorrection;
          setPendingCorrection(null);
          if (correction === "customer") {
            void runCustomerCorrection(result);
          } else if (correction === "payment_method") {
            void runPaymentMethodCorrection(result);
          }
        }}
        onDismiss={() => setPendingCorrection(null)}
        open={Boolean(pendingCorrection)}
      />
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
                          setCorrectionPanelOpen((value) => !value);
                          setSelectedCorrection(null);
                        }}
                        type="button"
                        variant={correctionPanelOpen ? "workflow" : "outline"}
                      >
                        Correct
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
                        <ShieldAlert className="h-4 w-4" />
                      </div>
                      <div className="space-y-1">
                        <h2 className="font-display text-lg font-semibold text-foreground">
                          Transaction correction
                        </h2>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Correct metadata or payment labels here. Use guided
                          workflows for sale totals and item changes.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5 p-5">
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Direct corrections
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
                              Customer correction
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Staff sign-in and customer lookup will update
                              attribution only.
                            </p>
                            <Input
                              aria-label="Corrected customer profile ID"
                              className="border-input bg-background"
                              onChange={(event) =>
                                setCustomerProfileIdInput(event.target.value)
                              }
                              placeholder="Customer profile ID, or leave blank for walk-in."
                              value={customerProfileIdInput}
                            />
                            <Textarea
                              aria-label="Customer correction reason"
                              className="min-h-[80px] border-input bg-background"
                              onChange={(event) =>
                                setCustomerCorrectionReason(event.target.value)
                              }
                              placeholder="Reason for customer attribution correction."
                              value={customerCorrectionReason}
                            />
                            <Button
                              disabled={correctionSubmitting}
                              onClick={() =>
                                requestCorrectionSubmit("customer")
                              }
                              type="button"
                            >
                              Submit customer correction
                            </Button>
                          </div>
                        ) : null}
                        <Button
                          aria-label="Payment method"
                          className="h-auto justify-start whitespace-normal px-3 py-3 text-left"
                          onClick={() =>
                            setSelectedCorrection("payment_method")
                          }
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
                              Same-amount method correction only.
                            </span>
                          </span>
                        </Button>
                        {showPaymentMethodDirectFlow ? (
                          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                            <p className="text-sm font-medium text-foreground">
                              Same-amount payment method correction
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
                                aria-label="Corrected payment method"
                                className="border-input bg-background"
                              >
                                <SelectValue placeholder="Choose payment method" />
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
                            <Textarea
                              aria-label="Payment method correction reason"
                              className="min-h-[80px] border-input bg-background"
                              onChange={(event) =>
                                setPaymentCorrectionReason(event.target.value)
                              }
                              placeholder="Reason for payment method correction."
                              value={paymentCorrectionReason}
                            />
                            <Button
                              disabled={correctionSubmitting}
                              onClick={() =>
                                requestCorrectionSubmit("payment_method")
                              }
                              type="button"
                            >
                              Submit payment correction
                            </Button>
                          </div>
                        ) : selectedCorrection === "payment_method" ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-sm text-muted-foreground">
                            Multi-payment corrections need review before
                            editing payment records.
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
                        amount, total, or discount corrections.
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
                      Correction history
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Operational corrections recorded for this transaction.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {correctionHistory.map((event) => (
                      <div
                        className="space-y-2 rounded-lg border border-border bg-muted/20 p-4"
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
                        {event.reason ? (
                          <p className="border-t border-border/70 pt-3 text-sm leading-5 text-muted-foreground">
                            {event.reason}
                          </p>
                        ) : null}
                      </div>
                    ))}
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
