import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import {
  type NormalizedCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";
import { capitalizeWords, cn, currencyFormatter } from "@/lib/utils";
import {
  formatStoredAmount,
  parseDisplayAmountInput,
} from "@/lib/pos/displayAmounts";
import { toDisplayAmount } from "~/convex/lib/currency";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { userError } from "~/shared/commandResult";
import { EmptyState } from "../states/empty/empty-state";
import { WorkflowTraceRouteLink } from "../traces/WorkflowTraceRouteLink";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export type RegisterCloseoutSession = {
  _id: string;
  approvalRequest: null | {
    _id: string;
    createdAt: number;
    reason?: string;
    requestedByStaffName?: string | null;
    status: string;
  };
  closeoutReview: null | {
    hasVariance: boolean;
    reason?: string;
    requiresApproval: boolean;
    variance: number;
  };
  countedCash?: number;
  expectedCash: number;
  notes?: string;
  openedAt: number;
  openedByStaffName?: string | null;
  registerNumber?: string | null;
  status: string;
  workflowTraceId?: string | null;
};

type RegisterCloseoutSubmitArgs = {
  countedCash: number;
  notes?: string;
  registerSessionId: string;
};

type RegisterCloseoutReviewArgs = {
  decision: "approved" | "rejected";
  decisionNotes?: string;
  registerSessionId: string;
};

type RegisterCloseoutCommandPayload = {
  action?: "approval_required" | "closed" | "approved" | "rejected";
};

type RegisterCloseoutCommandResult =
  NormalizedCommandResult<RegisterCloseoutCommandPayload>;

type RegisterCloseoutViewContentProps = {
  currency: string;
  isLoading: boolean;
  onReviewCloseout: (
    args: RegisterCloseoutReviewArgs,
  ) => Promise<RegisterCloseoutCommandResult>;
  onSubmitCloseout: (
    args: RegisterCloseoutSubmitArgs,
  ) => Promise<RegisterCloseoutCommandResult>;
  registerSessions: RegisterCloseoutSession[];
};

function trimOptional(value?: string) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function formatSessionName(registerSession: RegisterCloseoutSession) {
  return registerSession.registerNumber?.trim() || "Unnamed register";
}

function formatStatusLabel(status: string) {
  return capitalizeWords(status.replaceAll("_", " "));
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getVariance(registerSession: RegisterCloseoutSession) {
  if (registerSession.closeoutReview) {
    return registerSession.closeoutReview.variance;
  }

  if (registerSession.countedCash !== undefined) {
    return registerSession.countedCash - registerSession.expectedCash;
  }

  return null;
}

function formatStoredAmountForInput(amount: number) {
  return String(toDisplayAmount(amount));
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "border-transparent bg-amber-100/70 text-amber-800";
    case "closing":
      return "border-transparent bg-sky-100/70 text-sky-800";
    case "open":
      return "border-transparent bg-emerald-100/70 text-emerald-800";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

function getVarianceTone(variance: null | number) {
  if (variance === null || variance === 0) {
    return "text-foreground";
  }

  return variance > 0 ? "text-emerald-700" : "text-destructive";
}

function formatReviewReason(
  formatter: ReturnType<typeof currencyFormatter>,
  reason?: string,
) {
  if (!reason) {
    return undefined;
  }

  return reason.replace(
    /Variance of (-?\d+) exceeded the closeout approval threshold\./,
    (_match, rawVariance) =>
      `Variance of ${formatStoredAmount(formatter, Number(rawVariance))} exceeded the closeout approval threshold.`,
  );
}

function getDefaultActiveSessionId(registerSessions: RegisterCloseoutSession[]) {
  return (
    registerSessions.find(
      (registerSession) => registerSession.approvalRequest?.status === "pending",
    )?._id ??
    registerSessions.find((registerSession) => registerSession.countedCash === undefined)
      ?._id ??
    registerSessions[0]?._id
  );
}

export function RegisterCloseoutViewContent({
  currency,
  isLoading,
  onReviewCloseout,
  onSubmitCloseout,
  registerSessions,
}: RegisterCloseoutViewContentProps) {
  const [countedCashValues, setCountedCashValues] = useState<Record<string, string>>({});
  const [sessionNotes, setSessionNotes] = useState<Record<string, string>>({});
  const [managerNotes, setManagerNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, string>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(() =>
    getDefaultActiveSessionId(registerSessions),
  );

  const formatter = currencyFormatter(currency || "USD");
  const pendingReviewCount = registerSessions.filter(
    (registerSession) => registerSession.approvalRequest?.status === "pending",
  ).length;
  const pendingCountCount = registerSessions.filter(
    (registerSession) => registerSession.countedCash === undefined,
  ).length;
  const totalExpectedCash = registerSessions.reduce(
    (sum, registerSession) => sum + registerSession.expectedCash,
    0,
  );

  useEffect(() => {
    setActiveSessionId((current) => {
      if (registerSessions.length === 0) {
        return undefined;
      }

      if (
        current &&
        registerSessions.some((registerSession) => registerSession._id === current)
      ) {
        return current;
      }

      return getDefaultActiveSessionId(registerSessions);
    });
  }, [registerSessions]);

  const applyCommandResult = (
    registerSessionId: string,
    result: RegisterCloseoutCommandResult,
  ) => {
    if (result.kind === "ok") {
      setErrors((current) => ({ ...current, [registerSessionId]: "" }));
      return true;
    }

    setErrors((current) => ({
      ...current,
      [registerSessionId]: result.error.message,
    }));
    return false;
  };

  async function handleSubmitCloseout(registerSession: RegisterCloseoutSession) {
    const countedCashValue =
      countedCashValues[registerSession._id] ??
      (registerSession.countedCash !== undefined
        ? formatStoredAmountForInput(registerSession.countedCash)
        : "");
    const countedCash = parseDisplayAmountInput(countedCashValue);

    if (countedCash === undefined) {
      setErrors((current) => ({
        ...current,
        [registerSession._id]: "Enter the counted cash before submitting the closeout.",
      }));
      return;
    }

    setErrors((current) => ({ ...current, [registerSession._id]: "" }));
    setPendingActions((current) => ({ ...current, [registerSession._id]: "submit" }));

    try {
      const result = await onSubmitCloseout({
        countedCash,
        notes: trimOptional(
          sessionNotes[registerSession._id] ?? registerSession.notes ?? "",
        ),
        registerSessionId: registerSession._id,
      });

      if (!applyCommandResult(registerSession._id, result)) {
        return;
      }

      setCountedCashValues((current) => ({ ...current, [registerSession._id]: "" }));
      setSessionNotes((current) => ({ ...current, [registerSession._id]: "" }));
    } finally {
      setPendingActions((current) => {
        const nextState = { ...current };
        delete nextState[registerSession._id];
        return nextState;
      });
    }
  }

  async function handleReviewCloseout(
    registerSession: RegisterCloseoutSession,
    decision: "approved" | "rejected",
  ) {
    setErrors((current) => ({ ...current, [registerSession._id]: "" }));
    setPendingActions((current) => ({ ...current, [registerSession._id]: decision }));

    try {
      const result = await onReviewCloseout({
        decision,
        decisionNotes: trimOptional(managerNotes[registerSession._id]),
        registerSessionId: registerSession._id,
      });

      if (!applyCommandResult(registerSession._id, result)) {
        return;
      }

      setManagerNotes((current) => ({ ...current, [registerSession._id]: "" }));
    } finally {
      setPendingActions((current) => {
        const nextState = { ...current };
        delete nextState[registerSession._id];
        return nextState;
      });
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {registerSessions.length} in queue
            {pendingReviewCount > 0 ? ` · ${pendingReviewCount} pending review` : ""}
            {pendingCountCount > 0 ? ` · ${pendingCountCount} awaiting count` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            Open one register to count or review, then move to the next.
          </p>
        </div>

        <div className="space-y-1 sm:text-right">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Expected total
          </p>
          <p className="text-2xl font-semibold leading-none text-foreground">
            {formatStoredAmount(formatter, totalExpectedCash)}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-6 text-sm text-muted-foreground">
          Loading register closeouts...
        </div>
      ) : registerSessions.length === 0 ? (
        <EmptyState
          description="Open, active, and closing register sessions will appear here for manager closeout."
          title="No active register closeouts"
        />
      ) : (
        <Accordion
          className="rounded-lg border border-border/70 bg-background"
          collapsible
          onValueChange={(value) => setActiveSessionId(value || undefined)}
          type="single"
          value={activeSessionId}
        >
          {registerSessions.map((registerSession) => {
            const registerName = formatSessionName(registerSession);
            const variance = getVariance(registerSession);
            const hasPendingApproval =
              registerSession.approvalRequest?.status === "pending";
            const pendingAction = pendingActions[registerSession._id];
            const errorMessage = errors[registerSession._id];
            const countedCashValue =
              countedCashValues[registerSession._id] ??
              (registerSession.countedCash !== undefined
                ? formatStoredAmountForInput(registerSession.countedCash)
                : "");
            const draftCountedCash = parseDisplayAmountInput(countedCashValue);
            const draftVariance =
              draftCountedCash !== undefined
                ? draftCountedCash - registerSession.expectedCash
                : variance;
            const reviewReason = formatReviewReason(
              formatter,
              registerSession.approvalRequest?.reason ??
                registerSession.closeoutReview?.reason,
            );
            const isActive = activeSessionId === registerSession._id;

            return (
              <AccordionItem
                className={cn(
                  "border-border/60 px-4",
                  isActive && "bg-muted/10",
                )}
                key={registerSession._id}
                value={registerSession._id}
              >
                <AccordionTrigger className="py-4 text-left hover:no-underline">
                  <div className="flex w-full flex-col gap-3 pr-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-foreground">
                          {registerName}
                        </p>
                        <Badge
                          className={getStatusBadgeClass(registerSession.status)}
                          size="sm"
                        >
                          {formatStatusLabel(registerSession.status)}
                        </Badge>
                        {hasPendingApproval ? (
                          <Badge
                            className="border-amber-200 bg-amber-50/70 text-amber-800"
                            size="sm"
                            variant="outline"
                          >
                            Review needed
                          </Badge>
                        ) : null}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        Opened {formatTimestamp(registerSession.openedAt)}
                        {registerSession.openedByStaffName
                          ? ` by ${registerSession.openedByStaffName}`
                          : ""}
                      </p>
                    </div>

                    <dl className="grid grid-cols-3 gap-4 text-sm lg:min-w-[360px]">
                      <div className="space-y-1">
                        <dt className="text-xs text-muted-foreground">Expected</dt>
                        <dd className="font-medium text-foreground">
                          {formatStoredAmount(formatter, registerSession.expectedCash)}
                        </dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs text-muted-foreground">Counted</dt>
                        <dd className="font-medium text-foreground">
                          {registerSession.countedCash !== undefined
                            ? formatStoredAmount(formatter, registerSession.countedCash)
                            : "Not submitted"}
                        </dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs text-muted-foreground">Variance</dt>
                        <dd className={cn("font-medium", getVarianceTone(variance))}>
                          {variance === null
                            ? "Pending count"
                            : formatStoredAmount(formatter, variance)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="pb-0">
                  <div className="space-y-5 border-t border-border/60 px-2 pb-5 pt-5 sm:px-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      {registerSession.workflowTraceId ? (
                        <WorkflowTraceRouteLink
                          className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
                          traceId={registerSession.workflowTraceId}
                        >
                          View trace
                        </WorkflowTraceRouteLink>
                      ) : null}
                      {registerSession.notes ? (
                        <p>
                          Note on file:{" "}
                          <span className="text-foreground">{registerSession.notes}</span>
                        </p>
                      ) : null}
                    </div>

                    {hasPendingApproval ? (
                      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                              Manager review required
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {reviewReason ??
                                "A manager decision is required before this register can close."}
                            </p>
                          </div>

                          <p className="text-sm text-muted-foreground">
                            Submitted by{" "}
                            <span className="text-foreground">
                              {registerSession.approvalRequest?.requestedByStaffName ??
                                "Closeout workflow"}
                            </span>
                            {" · "}
                            Variance{" "}
                            <span
                              className={cn("font-medium", getVarianceTone(variance))}
                            >
                              {variance === null
                                ? "Pending count"
                                : formatStoredAmount(formatter, variance)}
                            </span>
                          </p>
                        </div>

                        <div className="space-y-3">
                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-foreground">
                              Manager notes
                            </span>
                            <Textarea
                              aria-label={`Manager notes for ${registerName}`}
                              onChange={(event) =>
                                setManagerNotes((current) => ({
                                  ...current,
                                  [registerSession._id]: event.target.value,
                                }))
                              }
                              placeholder="Add approval or rejection notes."
                              value={managerNotes[registerSession._id] ?? ""}
                            />
                          </label>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="min-w-[10rem]"
                              disabled={Boolean(pendingAction)}
                              onClick={() =>
                                void handleReviewCloseout(registerSession, "approved")
                              }
                              type="button"
                            >
                              {pendingAction === "approved"
                                ? "Approving..."
                                : "Approve variance"}
                            </Button>
                            <Button
                              className="min-w-[10rem]"
                              disabled={Boolean(pendingAction)}
                              onClick={() =>
                                void handleReviewCloseout(registerSession, "rejected")
                              }
                              type="button"
                              variant="outline"
                            >
                              {pendingAction === "rejected"
                                ? "Rejecting..."
                                : "Reject variance"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="space-y-3">
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-foreground">
                              Counted cash
                            </span>
                            <Input
                              aria-label={`Counted cash for ${registerName}`}
                              min={0}
                              onChange={(event) =>
                                setCountedCashValues((current) => ({
                                  ...current,
                                  [registerSession._id]: event.target.value,
                                }))
                              }
                              step="0.01"
                              type="number"
                              value={countedCashValue}
                            />
                          </label>

                          <p className="text-sm text-muted-foreground">
                            Variance{" "}
                            <span
                              className={cn(
                                "font-medium",
                                getVarianceTone(draftVariance),
                              )}
                            >
                              {draftVariance === null
                                ? "pending"
                                : formatStoredAmount(formatter, draftVariance)}
                            </span>
                          </p>
                        </div>

                        <div className="space-y-3">
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-foreground">
                              Closeout notes
                            </span>
                            <Textarea
                              aria-label={`Closeout notes for ${registerName}`}
                              className="min-h-[112px]"
                              onChange={(event) =>
                                setSessionNotes((current) => ({
                                  ...current,
                                  [registerSession._id]: event.target.value,
                                }))
                              }
                              placeholder="Add drawer notes if anything needs follow-up."
                              value={
                                sessionNotes[registerSession._id] ??
                                registerSession.notes ??
                                ""
                              }
                            />
                          </label>

                          <div className="flex justify-end">
                            <Button
                              className="min-w-[12rem]"
                              disabled={pendingAction === "submit"}
                              onClick={() =>
                                void handleSubmitCloseout(registerSession)
                              }
                              type="button"
                            >
                              {pendingAction === "submit"
                                ? "Submitting..."
                                : "Submit closeout"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {errorMessage ? (
                      <p
                        className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                        role="alert"
                      >
                        {errorMessage}
                      </p>
                    ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </section>
  );
}

export function RegisterCloseoutView() {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();

  const snapshot = useQuery(
    api.cashControls.closeouts.getCloseoutSnapshot,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  const submitRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.submitRegisterSessionCloseout,
  );
  const reviewRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.reviewRegisterSessionCloseout,
  );

  async function onSubmitCloseout(args: RegisterCloseoutSubmitArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to submit a register closeout.",
      });
    }

    const result = await runCommand(() =>
      submitRegisterSessionCloseout({
        actorUserId: user._id,
        countedCash: args.countedCash,
        notes: args.notes,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success(
        result.data?.action === "approval_required"
          ? "Closeout submitted for manager review"
          : "Register session closed",
      );
    }

    return result;
  }

  async function onReviewCloseout(args: RegisterCloseoutReviewArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to review a register closeout.",
      });
    }

    const result = await runCommand(() =>
      reviewRegisterSessionCloseout({
        decision: args.decision,
        decisionNotes: args.decisionNotes,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        reviewedByUserId: user._id,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success(
        args.decision === "approved"
          ? "Register closeout approved"
          : "Register closeout rejected",
      );
    }

    return result;
  }

  return (
    <RegisterCloseoutViewContent
      currency={activeStore?.currency || "USD"}
      isLoading={!activeStore || snapshot === undefined}
      onReviewCloseout={onReviewCloseout}
      onSubmitCloseout={onSubmitCloseout}
      registerSessions={snapshot?.registerSessions ?? []}
    />
  );
}
