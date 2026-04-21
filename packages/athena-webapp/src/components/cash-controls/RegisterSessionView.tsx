import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { capitalizeWords, currencyFormatter } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { SimplePageHeader } from "../common/PageHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
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

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.04,
      staggerChildren: 0.06,
    },
  },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
};

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

type RegisterSessionCloseoutReview = {
  hasVariance: boolean;
  reason?: string | null;
  requiresApproval: boolean;
  variance: number;
};

type RegisterSessionTimelineEvent = {
  _id: string;
  actorStaffName?: string | null;
  createdAt: number;
  eventType: string;
  message?: string | null;
  reason?: string | null;
};

export type RegisterSessionSnapshot = {
  closeoutReview: RegisterSessionCloseoutReview | null;
  deposits: RegisterSessionDeposit[];
  registerSession: RegisterSessionDetail;
  timeline: RegisterSessionTimelineEvent[];
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

type RegisterSessionViewContentProps = {
  actorStaffProfileId?: string;
  actorUserId?: string;
  currency: string;
  isLoading: boolean;
  onRecordDeposit: (args: RecordRegisterSessionDepositArgs) => Promise<void>;
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

  return currencyFormatter(currency).format(amount);
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

function formatRegisterName(registerNumber?: string | null) {
  const trimmedRegisterNumber = registerNumber?.trim();
  return trimmedRegisterNumber ? trimmedRegisterNumber : "Unnamed register";
}

function getVarianceTone(variance?: number) {
  if (!variance) {
    return "text-foreground";
  }

  return variance > 0 ? "text-emerald-700" : "text-destructive";
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
        className="border-stone-300 bg-transparent text-stone-700 hover:bg-stone-100"
        size="sm"
        variant="outline"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
        >
          Overview
        </Link>
      </Button>
      <Button
        asChild
        className="border-stone-300 bg-transparent text-stone-700 hover:bg-stone-100"
        size="sm"
        variant="outline"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers"
        >
          All registers
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

  async function handleRecordDeposit() {
    if (!registerSession?._id || !storeId) {
      setErrorMessage("A store and register session are required before recording a deposit.");
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
      await onRecordDeposit({
        actorStaffProfileId,
        actorUserId,
        amount: parsedAmount,
        notes: trimOptional(notes),
        reference: trimOptional(reference),
        registerSessionId: registerSession._id,
        storeId,
        submissionKey,
      });
      setAmount("");
      setNotes("");
      setReference("");
      setSubmissionKey(buildDepositSubmissionKey(registerSession._id));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to record the register deposit.",
      );
    } finally {
      setIsRecordingDeposit(false);
    }
  }

  return (
    <View
      header={
        <SimplePageHeader
          className="text-lg font-semibold"
          title={registerSession ? formatRegisterName(registerSession.registerNumber) : "Register session"}
        />
      }
    >
      <FadeIn>
        <motion.div
          animate="visible"
          className="container mx-auto space-y-6 p-6"
          initial="hidden"
          variants={containerVariants}
        >
          <motion.section
            className="overflow-hidden rounded-[28px] bg-[#f7f1e7] ring-1 ring-stone-200/80"
            variants={sectionVariants}
          >
            <div className="border-b border-stone-200/80 px-6 py-6 lg:flex lg:items-start lg:justify-between">
              <div className="max-w-2xl space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-amber-800/75">
                  Register detail
                </p>
                {registerSession ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-3xl font-semibold tracking-[-0.05em] text-stone-950">
                        {formatRegisterName(registerSession.registerNumber)}
                      </h1>
                      <Badge
                        className="border-stone-300/80 bg-stone-100 text-stone-700"
                        size="sm"
                        variant="outline"
                      >
                        {formatStatusLabel(registerSession.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-stone-600">
                      Opened {formatTimestamp(registerSession.openedAt)}
                      {registerSession.openedByStaffName
                        ? ` by ${registerSession.openedByStaffName}`
                        : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-stone-600">
                    Register-level cash detail and deposit history.
                  </p>
                )}
              </div>

              <div className="mt-4 lg:mt-0">
                <DetailNav orgUrlSlug={orgUrlSlug} storeUrlSlug={storeUrlSlug} />
              </div>
            </div>

            {isLoading ? (
              <div className="px-6 py-6 text-sm text-stone-600">
                Loading register session...
              </div>
            ) : !registerSession ? (
              <div className="px-6 py-8">
                <EmptyState
                  description="Try re-opening the cash-controls workspace and selecting a register session again."
                  title="Register session not found"
                />
              </div>
            ) : (
              <div className="grid gap-0 xl:grid-cols-[minmax(0,1.18fr)_320px]">
                <div className="border-b border-stone-200/80 px-6 py-6 xl:border-b-0 xl:border-r">
                  <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-1 border-b border-stone-200/70 pb-3 xl:border-b-0 xl:pb-0">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.24em] text-amber-800/75">
                        Opening float
                      </dt>
                      <dd className="font-mono text-2xl tracking-[-0.04em] text-stone-950">
                        {formatCurrency(currency, registerSession.openingFloat)}
                      </dd>
                    </div>
                    <div className="space-y-1 border-b border-stone-200/70 pb-3 xl:border-b-0 xl:pb-0">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.24em] text-amber-800/75">
                        Expected cash
                      </dt>
                      <dd className="font-mono text-2xl tracking-[-0.04em] text-stone-950">
                        {formatCurrency(
                          currency,
                          registerSession.netExpectedCash ?? registerSession.expectedCash,
                        )}
                      </dd>
                    </div>
                    <div className="space-y-1 border-b border-stone-200/70 pb-3 sm:border-b-0 sm:pb-0">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.24em] text-amber-800/75">
                        Total deposited
                      </dt>
                      <dd className="font-mono text-2xl tracking-[-0.04em] text-stone-950">
                        {formatCurrency(currency, registerSession.totalDeposited)}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.24em] text-amber-800/75">
                        Variance
                      </dt>
                      <dd className={`font-mono text-2xl tracking-[-0.04em] ${getVarianceTone(registerSession.variance)}`}>
                        {formatCurrency(currency, registerSession.variance ?? 0)}
                      </dd>
                    </div>
                  </dl>

                  {registerSession.pendingApprovalRequest?.reason ? (
                    <div className="mt-6 border-t border-stone-200/70 pt-6">
                      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-stone-500">
                        Manager follow-up
                      </p>
                      <p className="mt-2 text-sm text-stone-700">
                        {registerSession.pendingApprovalRequest.reason}
                      </p>
                    </div>
                  ) : null}
                </div>

                <aside className="px-6 py-6">
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-stone-500">
                      Closeout review
                    </p>
                    {registerSessionSnapshot?.closeoutReview ? (
                      <div className="space-y-3">
                        <p className={`font-mono text-3xl tracking-[-0.04em] ${getVarianceTone(registerSessionSnapshot.closeoutReview.variance)}`}>
                          {formatCurrency(currency, registerSessionSnapshot.closeoutReview.variance)}
                        </p>
                        <p className="text-sm text-stone-600">
                          Approval required: {registerSessionSnapshot.closeoutReview.requiresApproval ? "Yes" : "No"}
                        </p>
                        {registerSessionSnapshot.closeoutReview.reason ? (
                          <p className="text-sm text-stone-700">
                            {registerSessionSnapshot.closeoutReview.reason}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-stone-600">
                        No closeout review has been submitted yet.
                      </p>
                    )}
                  </div>
                </aside>
              </div>
            )}
          </motion.section>

          <motion.section
            className="rounded-[24px] bg-white/80 px-6 py-6 ring-1 ring-stone-200/70"
            variants={sectionVariants}
          >
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                  Deposit history
                </h2>
                <p className="text-sm text-stone-600">
                  Every safe drop recorded against this drawer, newest first.
                </p>
              </div>

              {!registerSessionSnapshot ? null : registerSessionSnapshot.deposits.length === 0 ? (
                <EmptyState
                  description="Once a safe drop is recorded it will appear here with the staff name and reference."
                  title="No deposits recorded"
                />
              ) : (
                <div className="overflow-hidden rounded-[22px] bg-white ring-1 ring-stone-200/70">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-stone-200/80 hover:bg-transparent">
                        <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                          Amount
                        </TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                          Recorded
                        </TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                          Reference
                        </TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                          By
                        </TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                          Notes
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registerSessionSnapshot.deposits.map((deposit) => (
                        <TableRow
                          className="border-b border-stone-200/70 hover:bg-[#f8f2e8]"
                          key={deposit._id}
                        >
                          <TableCell className="font-mono text-stone-950">
                            {formatCurrency(currency, deposit.amount)}
                          </TableCell>
                          <TableCell className="text-stone-600">
                            {formatTimestamp(deposit.recordedAt)}
                          </TableCell>
                          <TableCell>{deposit.reference ?? "—"}</TableCell>
                          <TableCell>{deposit.recordedByStaffName ?? "—"}</TableCell>
                          <TableCell>{deposit.notes ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </motion.section>

          <motion.section
            className="rounded-[24px] bg-white/80 px-6 py-6 ring-1 ring-stone-200/70"
            variants={sectionVariants}
          >
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                  Timeline
                </h2>
                <p className="text-sm text-stone-600">
                  Operational events recorded against this drawer during the day.
                </p>
              </div>

              {!registerSessionSnapshot ? null : registerSessionSnapshot.timeline.length === 0 ? (
                <EmptyState
                  description="Register lifecycle events will appear here as the drawer is used, deposited, and closed."
                  title="No timeline events yet"
                />
              ) : (
                <div className="space-y-3">
                  {registerSessionSnapshot.timeline.map((event) => (
                    <article
                      className="rounded-[20px] bg-[#fcfaf6] px-5 py-4 ring-1 ring-stone-200/70"
                      key={event._id}
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <p className="font-medium text-stone-950">
                            {event.message ??
                              capitalizeWords(event.eventType.replaceAll("_", " "))}
                          </p>
                          <p className="text-sm text-stone-600">
                            {event.actorStaffName ?? "System event"}
                          </p>
                          {event.reason ? (
                            <p className="text-sm text-stone-600">{event.reason}</p>
                          ) : null}
                        </div>
                        <p className="text-sm text-stone-500">
                          {formatTimestamp(event.createdAt)}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </motion.section>

          <motion.section
            className="rounded-[24px] bg-[#f7f1e7] px-6 py-6 ring-1 ring-amber-200/70"
            variants={sectionVariants}
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-amber-800/75">
                  Action
                </p>
                <div className="space-y-1">
                  <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                    Record cash deposit
                  </h2>
                  <p className="text-sm text-stone-600">
                    Capture the next safe drop against this register session.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-stone-900">Amount</span>
                    <Input
                      aria-label="Deposit amount"
                      className="border-stone-300 bg-white"
                      min={0}
                      onChange={(event) => setAmount(event.target.value)}
                      step="1"
                      type="number"
                      value={amount}
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-stone-900">Reference</span>
                    <Input
                      aria-label="Deposit reference"
                      className="border-stone-300 bg-white"
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="BANK-123"
                      value={reference}
                    />
                  </label>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-stone-900">Notes</span>
                  <Textarea
                    aria-label="Deposit notes"
                    className="min-h-[110px] border-stone-300 bg-white"
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
                  className="bg-stone-950 text-stone-50 hover:bg-stone-950/90"
                  disabled={isRecordingDeposit}
                  isLoading={isRecordingDeposit}
                  onClick={() => void handleRecordDeposit()}
                  type="button"
                >
                  Record deposit
                </LoadingButton>
              </div>
            </div>
          </motion.section>
        </motion.div>
      </FadeIn>
    </View>
  );
}

export function RegisterSessionView() {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const { canAccessOperations, isLoading } = usePermissions();
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        sessionId?: string;
        storeUrlSlug?: string;
      }
    | undefined;

  const registerSessionSnapshotArgs =
    activeStore?._id && params?.sessionId
      ? {
          registerSessionId: params.sessionId as Id<"registerSession">,
          storeId: activeStore._id,
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
    try {
      const result = await recordRegisterSessionDeposit({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile"> | undefined,
        actorUserId: args.actorUserId as Id<"athenaUser"> | undefined,
        amount: args.amount,
        notes: args.notes,
        reference: args.reference,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        storeId: args.storeId as Id<"store">,
        submissionKey: args.submissionKey,
      });

      toast.success(
        result?.action === "duplicate"
          ? "Deposit already recorded"
          : "Register deposit recorded",
      );
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Failed to record register deposit.";
      toast.error("Failed to record register deposit", { description });
      throw error;
    }
  }

  if (isLoading) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading register session...
        </div>
      </View>
    );
  }

  if (!canAccessOperations()) {
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
