import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Banknote,
  CreditCard,
  Receipt,
  Smartphone,
  WalletCards,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import {
  type NormalizedCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import { capitalizeWords, currencyFormatter } from "@/lib/utils";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { ComposedPageHeader } from "../common/PageHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Textarea } from "../ui/textarea";
import { WorkflowTraceRouteLink } from "../traces/WorkflowTraceRouteLink";

const LINKED_TRANSACTIONS_PREVIEW_LIMIT = 5;

type RegisterSessionApprovalRequest = {
  _id: string;
  reason?: string | null;
  requestedByStaffName?: string | null;
  status: string;
};

type RegisterSessionDetail = {
  _id: string;
  countedCash?: number;
  expectedCash: number;
  netExpectedCash?: number;
  openedAt: number;
  openedByStaffName?: string | null;
  openingFloat: number;
  pendingApprovalRequest?: RegisterSessionApprovalRequest | null;
  registerNumber?: string | null;
  status: string;
  totalDeposited: number;
  variance?: number;
  workflowTraceId?: string | null;
};

type RegisterSessionDeposit = {
  _id: string;
  amount: number;
  notes?: string | null;
  recordedAt: number;
  recordedByStaffName?: string | null;
  reference?: string | null;
  registerSessionId?: string | null;
};

type RegisterSessionTransaction = {
  _id: string;
  cashierName?: string | null;
  completedAt: number;
  customerName?: string | null;
  hasMultiplePaymentMethods?: boolean;
  itemCount: number;
  paymentMethod?: string | null;
  total: number;
  transactionNumber: string;
  workflowTraceId?: string | null;
};

type RegisterSessionCloseoutReview = {
  hasVariance: boolean;
  reason?: string | null;
  requiresApproval: boolean;
  variance: number;
};

export type RegisterSessionSnapshot = {
  closeoutReview: RegisterSessionCloseoutReview | null;
  deposits: RegisterSessionDeposit[];
  registerSession: RegisterSessionDetail;
  transactions?: RegisterSessionTransaction[];
};

type RecordRegisterSessionDepositArgs = {
  actorStaffProfileId?: string;
  actorUserId?: string;
  amount: number;
  notes?: string;
  reference?: string;
  registerSessionId: string;
  storeId: string;
  submissionKey: string;
};

type RegisterSessionDepositPayload = {
  action?: "duplicate" | "recorded";
};

type RegisterSessionDepositResult =
  NormalizedCommandResult<RegisterSessionDepositPayload>;

type RegisterSessionViewContentProps = {
  actorStaffProfileId?: string;
  actorUserId?: string;
  currency: string;
  isLoading: boolean;
  onRecordDeposit: (
    args: RecordRegisterSessionDepositArgs,
  ) => Promise<RegisterSessionDepositResult>;
  orgUrlSlug?: string;
  registerSessionSnapshot: RegisterSessionSnapshot | null;
  storeId?: string;
  storeUrlSlug?: string;
};

function trimOptional(value?: string) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function buildDepositSubmissionKey(registerSessionId: string) {
  return `register-session-deposit-${registerSessionId}-${Date.now().toString(36)}`;
}

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return formatStoredAmount(currencyFormatter(currency), amount);
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatStatusLabel(status: string) {
  return capitalizeWords(status.replaceAll("_", " "));
}

function formatPaymentMethod(method?: string | null) {
  if (!method) {
    return "Unknown";
  }

  return capitalizeWords(method.replaceAll("_", " "));
}

function formatRegisterName(registerNumber?: string | null) {
  const trimmedRegisterNumber = registerNumber?.trim();
  return trimmedRegisterNumber ? trimmedRegisterNumber : "Unnamed register";
}

function formatRegisterHeaderName(registerNumber?: string | null) {
  const registerName = formatRegisterName(registerNumber);

  if (/^register\b/i.test(registerName)) {
    return registerName;
  }

  if (registerName === "Unnamed register") {
    return "Register detail";
  }

  return `Register ${registerName}`;
}

function getVarianceTone(variance?: number) {
  if (!variance) {
    return "text-foreground";
  }

  return variance > 0 ? "text-emerald-700" : "text-destructive";
}

function getPaymentMethodIcon({
  hasMultiplePaymentMethods,
  paymentMethod,
}: {
  hasMultiplePaymentMethods?: boolean;
  paymentMethod?: string | null;
}) {
  if (hasMultiplePaymentMethods) {
    return WalletCards;
  }

  switch (paymentMethod) {
    case "cash":
      return Banknote;
    case "card":
      return CreditCard;
    case "mobile_money":
      return Smartphone;
    default:
      return Receipt;
  }
}

function DetailNav({
  orgUrlSlug,
  storeUrlSlug,
}: {
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  if (!orgUrlSlug || !storeUrlSlug) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        asChild
        className="border-border bg-transparent text-muted-foreground hover:bg-muted"
        size="sm"
        variant="outline"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
        >
          Cash Controls
        </Link>
      </Button>
      <Button
        asChild
        className="border-border bg-muted text-foreground hover:bg-muted/80"
        size="sm"
        variant="outline"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/closeouts"
        >
          Closeouts
        </Link>
      </Button>
    </div>
  );
}

export function RegisterSessionViewContent({
  actorStaffProfileId,
  actorUserId,
  currency,
  isLoading,
  onRecordDeposit,
  orgUrlSlug,
  registerSessionSnapshot,
  storeId,
  storeUrlSlug,
}: RegisterSessionViewContentProps) {
  const navigate = useNavigate();
  const registerSession = registerSessionSnapshot?.registerSession ?? null;
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isRecordingDeposit, setIsRecordingDeposit] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildDepositSubmissionKey(registerSession?._id ?? "session"),
  );

  useEffect(() => {
    if (!registerSession?._id) {
      return;
    }

    setSubmissionKey(buildDepositSubmissionKey(registerSession._id));
  }, [registerSession?._id]);

  const applyCommandResult = (result: RegisterSessionDepositResult) => {
    if (result.kind === "ok") {
      setErrorMessage("");
      return true;
    }

    setErrorMessage(result.error.message);
    return false;
  };

  async function handleRecordDeposit() {
    if (!registerSession?._id || !storeId) {
      setErrorMessage(
        "A store and register session are required before recording a deposit.",
      );
      return;
    }

    const parsedAmount = Number(amount);

    if (!amount.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage("Enter a deposit amount greater than zero.");
      return;
    }

    setErrorMessage("");
    setIsRecordingDeposit(true);

    try {
      const result = await onRecordDeposit({
        actorStaffProfileId,
        actorUserId,
        amount: parsedAmount,
        notes: trimOptional(notes),
        reference: trimOptional(reference),
        registerSessionId: registerSession._id,
        storeId,
        submissionKey,
      });

      if (!applyCommandResult(result)) {
        return;
      }

      setAmount("");
      setNotes("");
      setReference("");
      setSubmissionKey(buildDepositSubmissionKey(registerSession._id));
    } finally {
      setIsRecordingDeposit(false);
    }
  }

  const transactions = registerSessionSnapshot?.transactions ?? [];
  const previewTransactions = transactions.slice(
    0,
    LINKED_TRANSACTIONS_PREVIEW_LIMIT,
  );
  const hasAdditionalTransactions =
    transactions.length > previewTransactions.length;
  const transactionTotal = transactions.reduce(
    (sum, transaction) => sum + transaction.total,
    0,
  );
  const expectedCash =
    registerSession?.netExpectedCash ?? registerSession?.expectedCash ?? 0;
  const summaryRows = registerSession
    ? [
        {
          label: "Opening float",
          value: formatCurrency(currency, registerSession.openingFloat),
        },
        {
          label: "Sales linked",
          value: formatCurrency(currency, transactionTotal),
        },
        {
          label: "Total deposited",
          value: formatCurrency(currency, registerSession.totalDeposited),
        },
        {
          label: "Variance",
          value: formatCurrency(currency, registerSession.variance ?? 0),
          valueClassName: getVarianceTone(registerSession.variance),
        },
      ]
    : [];
  const headerTitle = registerSession
    ? formatRegisterHeaderName(registerSession.registerNumber)
    : "Register detail";

  return (
    <View
      header={
        <ComposedPageHeader
          leadingContent={
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-foreground">
                {headerTitle}
              </span>
              {registerSession ? (
                <>
                  <Badge
                    className="border-border bg-muted text-muted-foreground"
                    size="sm"
                    variant="outline"
                  >
                    {formatStatusLabel(registerSession.status)}
                  </Badge>
                </>
              ) : null}
            </div>
          }
          trailingContent={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {registerSession?.workflowTraceId ? (
                <Button
                  asChild
                  className="border-border bg-surface text-muted-foreground hover:bg-muted"
                  size="sm"
                  variant="outline"
                >
                  <WorkflowTraceRouteLink
                    traceId={registerSession.workflowTraceId}
                  >
                    View trace
                  </WorkflowTraceRouteLink>
                </Button>
              ) : null}
              <DetailNav orgUrlSlug={orgUrlSlug} storeUrlSlug={storeUrlSlug} />
            </div>
          }
        />
      }
    >
      <FadeIn>
        <div className="container mx-auto space-y-6 p-6">
          <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border bg-surface shadow-surface">
            {isLoading ? (
              <div className="px-layout-lg py-layout-lg text-sm text-muted-foreground">
                Loading register session...
              </div>
            ) : !registerSession ? (
              <div className="px-layout-lg py-layout-xl">
                <EmptyState
                  description="Try re-opening the cash-controls workspace and selecting a register session again."
                  title="Register session not found"
                />
              </div>
            ) : (
              <div className="grid gap-0 xl:grid-cols-[380px_minmax(0,1fr)]">
                <aside className="border-b border-border/80 bg-muted/20 px-layout-lg py-layout-lg xl:border-b-0 xl:border-r">
                  <dl className="space-y-layout-md">
                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Expected cash
                      </dt>
                      <dd className="mt-2 font-mono text-3xl text-foreground">
                        {formatCurrency(currency, expectedCash)}
                      </dd>
                    </div>

                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Opened
                      </dt>
                      <dd className="mt-2 text-sm text-foreground">
                        {formatTimestamp(registerSession.openedAt)}
                      </dd>
                      {registerSession.openedByStaffName ? (
                        <dd className="mt-1 text-xs text-muted-foreground">
                          By{" "}
                          {formatStaffDisplayName({
                            fullName: registerSession.openedByStaffName,
                          })}
                        </dd>
                      ) : null}
                    </div>

                    <div className="divide-y divide-border rounded-lg border border-border bg-surface-raised">
                      {summaryRows.map((row) => (
                        <div
                          className="flex items-center justify-between gap-layout-md px-layout-md py-3"
                          key={row.label}
                        >
                          <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            {row.label}
                          </dt>
                          <dd
                            className={`font-mono text-lg ${row.valueClassName ?? "text-foreground"}`}
                          >
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </div>
                  </dl>

                  {registerSession.pendingApprovalRequest?.reason ? (
                    <div className="mt-layout-lg border-t border-border/70 pt-layout-lg">
                      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        Manager follow-up
                      </p>
                      <p className="mt-2 text-sm text-foreground">
                        {registerSession.pendingApprovalRequest.reason}
                      </p>
                    </div>
                  ) : null}
                </aside>

                <div className="space-y-layout-lg px-layout-lg py-layout-lg">
                  <div className="flex flex-wrap items-start justify-between gap-layout-sm">
                    <div className="space-y-1">
                      <h2 className="font-display text-2xl font-semibold text-foreground">
                        Linked transactions
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Completed sales recorded against this register session.
                      </p>
                    </div>
                    <Badge
                      className="border-border bg-muted text-muted-foreground"
                      variant="outline"
                    >
                      {transactions.length}{" "}
                      {transactions.length === 1 ? "sale" : "sales"}
                    </Badge>
                  </div>

                  {transactions.length === 0 ? (
                    <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/25">
                      <EmptyState
                        icon={
                          <Receipt className="h-12 w-12 text-muted-foreground" />
                        }
                        description="Completed POS sales linked to this register will appear here."
                        title="No linked transactions"
                      />
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-b border-border hover:bg-transparent">
                            <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              Transaction
                            </TableHead>
                            <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              Total
                            </TableHead>
                            <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              Payment
                            </TableHead>
                            <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              Cashier
                            </TableHead>
                            <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              Completed
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewTransactions.map((transaction) => {
                            const PaymentIcon = getPaymentMethodIcon({
                              hasMultiplePaymentMethods:
                                transaction.hasMultiplePaymentMethods,
                              paymentMethod: transaction.paymentMethod,
                            });
                            const transactionLabel = `#${transaction.transactionNumber}`;
                            const canOpenTransaction = Boolean(
                              orgUrlSlug && storeUrlSlug,
                            );
                            const transactionRoute = canOpenTransaction
                              ? {
                                  params: {
                                    orgUrlSlug: orgUrlSlug!,
                                    storeUrlSlug: storeUrlSlug!,
                                    transactionId: transaction._id,
                                  },
                                  search: { o: getOrigin() },
                                  to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId" as const,
                                }
                              : null;

                            const openTransaction = () => {
                              if (!transactionRoute) {
                                return;
                              }

                              navigate(transactionRoute);
                            };

                            return (
                              <TableRow
                                aria-label={
                                  canOpenTransaction
                                    ? `Open transaction ${transactionLabel}`
                                    : undefined
                                }
                                className={
                                  canOpenTransaction
                                    ? "group border-b border-border/70 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    : "border-b border-border/70 transition-colors"
                                }
                                key={transaction._id}
                                onClick={
                                  canOpenTransaction
                                    ? openTransaction
                                    : undefined
                                }
                                onKeyDown={
                                  canOpenTransaction
                                    ? (event) => {
                                        if (
                                          event.key !== "Enter" &&
                                          event.key !== " "
                                        ) {
                                          return;
                                        }

                                        event.preventDefault();
                                        openTransaction();
                                      }
                                    : undefined
                                }
                                role={canOpenTransaction ? "link" : undefined}
                                tabIndex={canOpenTransaction ? 0 : undefined}
                              >
                                <TableCell>
                                  <div className="flex flex-col gap-1">
                                    <span className="inline-flex w-fit items-center gap-1 font-medium text-foreground group-hover:text-primary">
                                      {transactionLabel}
                                      {canOpenTransaction ? (
                                        <ArrowUpRight className="h-3.5 w-3.5" />
                                      ) : null}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {transaction.itemCount}{" "}
                                      {transaction.itemCount === 1
                                        ? "item"
                                        : "items"}
                                      {transaction.customerName
                                        ? ` - ${transaction.customerName}`
                                        : ""}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-foreground">
                                  {formatCurrency(currency, transaction.total)}
                                </TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                                    <PaymentIcon className="h-4 w-4" />
                                    {transaction.hasMultiplePaymentMethods
                                      ? "Multiple"
                                      : formatPaymentMethod(
                                          transaction.paymentMethod,
                                        )}
                                  </span>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {transaction.cashierName
                                    ? formatStaffDisplayName({
                                        fullName: transaction.cashierName,
                                      })
                                    : "N/A"}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {formatTimestamp(transaction.completedAt)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      {hasAdditionalTransactions &&
                      registerSession &&
                      orgUrlSlug &&
                      storeUrlSlug ? (
                        <div className="flex flex-wrap items-center justify-between gap-layout-sm border-t border-border/70 px-4 py-3">
                          <p className="text-sm text-muted-foreground">
                            Showing latest {previewTransactions.length} of{" "}
                            {transactions.length} linked sales.
                          </p>
                          <Button asChild size="sm" variant="outline">
                            <Link
                              params={{ orgUrlSlug, storeUrlSlug }}
                              search={{
                                o: getOrigin(),
                                registerSessionId: registerSession._id,
                              }}
                              to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions"
                            >
                              View all linked transactions
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-[calc(var(--radius)*1.25)] border border-border bg-surface px-layout-lg py-layout-lg shadow-surface">
              <div className="space-y-layout-md">
                <div className="space-y-1">
                  <h2 className="font-display text-2xl font-semibold text-foreground">
                    Deposit history
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Safe drops recorded against this drawer, newest first.
                  </p>
                </div>

                {!registerSessionSnapshot ? null : registerSessionSnapshot
                    .deposits.length === 0 ? (
                  <EmptyState
                    description="Once a safe drop is recorded it will appear here with the staff name and reference."
                    title="No deposits recorded"
                  />
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b border-border hover:bg-transparent">
                          <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Amount
                          </TableHead>
                          <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Recorded
                          </TableHead>
                          <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Reference
                          </TableHead>
                          <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            By
                          </TableHead>
                          <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Notes
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registerSessionSnapshot.deposits.map((deposit) => (
                          <TableRow
                            className="border-b border-border/70 transition-colors hover:bg-muted/40"
                            key={deposit._id}
                          >
                            <TableCell className="font-mono text-foreground">
                              {formatCurrency(currency, deposit.amount)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatTimestamp(deposit.recordedAt)}
                            </TableCell>
                            <TableCell>{deposit.reference ?? "N/A"}</TableCell>
                            <TableCell>
                              {deposit.recordedByStaffName
                                ? formatStaffDisplayName({
                                    fullName: deposit.recordedByStaffName,
                                  })
                                : "N/A"}
                            </TableCell>
                            <TableCell>{deposit.notes ?? "N/A"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-6 rounded-[calc(var(--radius)*1.25)] border border-border bg-surface px-layout-lg py-layout-lg shadow-surface">
              <div className="space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Closeout review
                </p>
                {registerSessionSnapshot?.closeoutReview ? (
                  <div className="space-y-3">
                    <p
                      className={`font-mono text-3xl ${getVarianceTone(registerSessionSnapshot.closeoutReview.variance)}`}
                    >
                      {formatCurrency(
                        currency,
                        registerSessionSnapshot.closeoutReview.variance,
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Approval required:{" "}
                      {registerSessionSnapshot.closeoutReview.requiresApproval
                        ? "Yes"
                        : "No"}
                    </p>
                    {registerSessionSnapshot.closeoutReview.reason ? (
                      <p className="text-sm text-foreground">
                        {registerSessionSnapshot.closeoutReview.reason}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No closeout review has been submitted yet.
                  </p>
                )}
              </div>

              <div className="border-t border-border/70 pt-6">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Action
                  </p>
                  <h2 className="font-display text-xl font-semibold text-foreground">
                    Record cash deposit
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Capture the next safe drop for this register session.
                  </p>
                </div>

                <div className="mt-4 space-y-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">
                      Amount
                    </span>
                    <Input
                      aria-label="Deposit amount"
                      className="border-input bg-background"
                      min={0}
                      onChange={(event) => setAmount(event.target.value)}
                      step="1"
                      type="number"
                      value={amount}
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">
                      Reference
                    </span>
                    <Input
                      aria-label="Deposit reference"
                      className="border-input bg-background"
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="BANK-123"
                      value={reference}
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">
                      Notes
                    </span>
                    <Textarea
                      aria-label="Deposit notes"
                      className="min-h-[110px] border-input bg-background"
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Optional handoff or safe-drop notes."
                      value={notes}
                    />
                  </label>

                  {errorMessage ? (
                    <p className="text-sm text-destructive" role="alert">
                      {errorMessage}
                    </p>
                  ) : null}

                  <LoadingButton
                    className="bg-signal text-signal-foreground hover:bg-signal/90"
                    disabled={isRecordingDeposit}
                    isLoading={isRecordingDeposit}
                    onClick={() => void handleRecordDeposit()}
                    type="button"
                  >
                    Record deposit
                  </LoadingButton>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </FadeIn>
    </View>
  );
}

export function RegisterSessionView() {
  const {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState();
  const { user } = useAuth();
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        sessionId?: string;
        storeUrlSlug?: string;
      }
    | undefined;

  const registerSessionSnapshotArgs =
    canQueryProtectedData && params?.sessionId
      ? {
          registerSessionId: params.sessionId as Id<"registerSession">,
          storeId: activeStore!._id,
        }
      : "skip";
  const registerSessionSnapshot = useQuery(
    api.cashControls.deposits.getRegisterSessionSnapshot,
    registerSessionSnapshotArgs,
  );
  const recordRegisterSessionDeposit = useMutation(
    api.cashControls.deposits.recordRegisterSessionDeposit,
  );

  async function onRecordDeposit(args: RecordRegisterSessionDepositArgs) {
    const result = await runCommand(() =>
      recordRegisterSessionDeposit({
        actorStaffProfileId: args.actorStaffProfileId as
          | Id<"staffProfile">
          | undefined,
        actorUserId: args.actorUserId as Id<"athenaUser"> | undefined,
        amount: args.amount,
        notes: args.notes,
        reference: args.reference,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        storeId: args.storeId as Id<"store">,
        submissionKey: args.submissionKey,
      }),
    );

    if (result.kind === "ok") {
      toast.success(
        result.data?.action === "duplicate"
          ? "Deposit already recorded"
          : "Register deposit recorded",
      );
    }

    return result;
  }

  if (isLoadingAccess) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading register session...
        </div>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before this register session can load protected cash-controls data." />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!activeStore) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening a register session."
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <RegisterSessionViewContent
      actorUserId={user?._id}
      currency={activeStore.currency || "USD"}
      isLoading={registerSessionSnapshot === undefined}
      onRecordDeposit={onRecordDeposit}
      orgUrlSlug={params?.orgUrlSlug}
      registerSessionSnapshot={registerSessionSnapshot ?? null}
      storeId={activeStore._id}
      storeUrlSlug={params?.storeUrlSlug}
    />
  );
}
