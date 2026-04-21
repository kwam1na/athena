import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { capitalizeWords, currencyFormatter } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { EmptyState } from "../states/empty/empty-state";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const cashControlsApi = (
  api as unknown as {
    cashControls: {
      closeouts: {
        getCloseoutSnapshot: any;
        reviewRegisterSessionCloseout: any;
        submitRegisterSessionCloseout: any;
      };
    };
  }
).cashControls.closeouts;

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

type RegisterCloseoutViewContentProps = {
  currency: string;
  isLoading: boolean;
  onReviewCloseout: (args: RegisterCloseoutReviewArgs) => Promise<void>;
  onSubmitCloseout: (args: RegisterCloseoutSubmitArgs) => Promise<void>;
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

  const formatter = currencyFormatter(currency || "USD");

  async function handleSubmitCloseout(registerSession: RegisterCloseoutSession) {
    const countedCashValue =
      countedCashValues[registerSession._id] ??
      (registerSession.countedCash !== undefined
        ? String(registerSession.countedCash)
        : "");
    const countedCash = Number(countedCashValue);

    if (!countedCashValue || Number.isNaN(countedCash) || countedCash < 0) {
      setErrors((current) => ({
        ...current,
        [registerSession._id]: "Enter the counted cash before submitting the closeout.",
      }));
      return;
    }

    setErrors((current) => ({ ...current, [registerSession._id]: "" }));
    setPendingActions((current) => ({ ...current, [registerSession._id]: "submit" }));

    try {
      await onSubmitCloseout({
        countedCash,
        notes: trimOptional(
          sessionNotes[registerSession._id] ?? registerSession.notes ?? "",
        ),
        registerSessionId: registerSession._id,
      });

      setCountedCashValues((current) => ({ ...current, [registerSession._id]: "" }));
      setSessionNotes((current) => ({ ...current, [registerSession._id]: "" }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [registerSession._id]:
          error instanceof Error
            ? error.message
            : "Failed to submit the register closeout.",
      }));
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
      await onReviewCloseout({
        decision,
        decisionNotes: trimOptional(managerNotes[registerSession._id]),
        registerSessionId: registerSession._id,
      });

      setManagerNotes((current) => ({ ...current, [registerSession._id]: "" }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [registerSession._id]:
          error instanceof Error
            ? error.message
            : "Failed to review the register closeout.",
      }));
    } finally {
      setPendingActions((current) => {
        const nextState = { ...current };
        delete nextState[registerSession._id];
        return nextState;
      });
    }
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-base font-medium">Register closeouts</h3>
        <p className="text-sm text-muted-foreground">
          Managers can close open drawers and review pending variance signoff here.
        </p>
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
        <div className="space-y-4">
          {registerSessions.map((registerSession) => {
            const registerName = formatSessionName(registerSession);
            const variance = getVariance(registerSession);
            const hasPendingApproval =
              registerSession.approvalRequest?.status === "pending";
            const pendingAction = pendingActions[registerSession._id];
            const errorMessage = errors[registerSession._id];

            return (
              <article
                className="space-y-4 rounded-md border p-4"
                key={registerSession._id}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{registerName}</p>
                      <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                        {formatStatusLabel(registerSession.status)}
                      </span>
                      {hasPendingApproval ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                          Variance review pending
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p>
                        Opened {formatTimestamp(registerSession.openedAt)}
                        {registerSession.openedByStaffName
                          ? ` by ${registerSession.openedByStaffName}`
                          : ""}
                      </p>
                      {registerSession.notes ? (
                        <p>Session notes: {registerSession.notes}</p>
                      ) : null}
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Expected cash</dt>
                      <dd className="font-medium text-foreground">
                        {formatter.format(registerSession.expectedCash)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Counted cash</dt>
                      <dd className="font-medium text-foreground">
                        {registerSession.countedCash !== undefined
                          ? formatter.format(registerSession.countedCash)
                          : "Not submitted"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Variance</dt>
                      <dd
                        className={
                          variance === null
                            ? "font-medium text-foreground"
                            : variance === 0
                              ? "font-medium text-foreground"
                              : variance > 0
                                ? "font-medium text-emerald-700"
                                : "font-medium text-destructive"
                        }
                      >
                        {variance === null ? "Pending count" : formatter.format(variance)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {hasPendingApproval ? (
                  <div className="space-y-3 rounded-md bg-muted/40 p-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Manager decision</p>
                      <p className="text-sm text-muted-foreground">
                        {registerSession.approvalRequest?.reason ??
                          registerSession.closeoutReview?.reason ??
                          "Manager review is required before this register can close."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {registerSession.approvalRequest?.requestedByStaffName
                          ? `Submitted by ${registerSession.approvalRequest.requestedByStaffName}`
                          : "Submitted from the closeout workflow"}
                      </p>
                    </div>

                    <label className="block space-y-2">
                      <span className="text-sm font-medium">Manager notes</span>
                      <Textarea
                        aria-label={`Manager notes for ${registerName}`}
                        onChange={(event) =>
                          setManagerNotes((current) => ({
                            ...current,
                            [registerSession._id]: event.target.value,
                          }))
                        }
                        placeholder="Add optional approval or rejection notes."
                        value={managerNotes[registerSession._id] ?? ""}
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <Button
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
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Counted cash</span>
                      <Input
                        aria-label={`Counted cash for ${registerName}`}
                        min={0}
                        onChange={(event) =>
                          setCountedCashValues((current) => ({
                            ...current,
                            [registerSession._id]: event.target.value,
                          }))
                        }
                        step="1"
                        type="number"
                        value={
                          countedCashValues[registerSession._id] ??
                          (registerSession.countedCash !== undefined
                            ? String(registerSession.countedCash)
                            : "")
                        }
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium">Closeout notes</span>
                      <Textarea
                        aria-label={`Closeout notes for ${registerName}`}
                        onChange={(event) =>
                          setSessionNotes((current) => ({
                            ...current,
                            [registerSession._id]: event.target.value,
                          }))
                        }
                        placeholder="Add optional drawer notes."
                        value={
                          sessionNotes[registerSession._id] ??
                          registerSession.notes ??
                          ""
                        }
                      />
                    </label>

                    <div className="flex items-end">
                      <Button
                        disabled={pendingAction === "submit"}
                        onClick={() => void handleSubmitCloseout(registerSession)}
                        type="button"
                      >
                        {pendingAction === "submit"
                          ? "Submitting..."
                          : "Submit closeout"}
                      </Button>
                    </div>
                  </div>
                )}

                {errorMessage ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMessage}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function RegisterCloseoutView() {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();

  const snapshot = useQuery(
    cashControlsApi.getCloseoutSnapshot,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  ) as { registerSessions: RegisterCloseoutSession[] } | undefined;

  const submitRegisterSessionCloseout = useMutation(
    cashControlsApi.submitRegisterSessionCloseout,
  );
  const reviewRegisterSessionCloseout = useMutation(
    cashControlsApi.reviewRegisterSessionCloseout,
  );

  async function onSubmitCloseout(args: RegisterCloseoutSubmitArgs) {
    if (!activeStore?._id || !user?._id) {
      throw new Error("You must be logged in to submit a register closeout.");
    }

    try {
      const result = await submitRegisterSessionCloseout({
        actorUserId: user._id,
        countedCash: args.countedCash,
        notes: args.notes,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        storeId: activeStore._id,
      });

      toast.success(
        result?.action === "approval_required"
          ? "Closeout submitted for manager review"
          : "Register session closed",
      );
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Failed to submit register closeout.";
      toast.error("Failed to submit register closeout", { description });
      throw error;
    }
  }

  async function onReviewCloseout(args: RegisterCloseoutReviewArgs) {
    if (!activeStore?._id || !user?._id) {
      throw new Error("You must be logged in to review a register closeout.");
    }

    try {
      await reviewRegisterSessionCloseout({
        decision: args.decision,
        decisionNotes: args.decisionNotes,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        reviewedByUserId: user._id,
        storeId: activeStore._id,
      });

      toast.success(
        args.decision === "approved"
          ? "Register closeout approved"
          : "Register closeout rejected",
      );
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Failed to review register closeout.";
      toast.error("Failed to review register closeout", { description });
      throw error;
    }
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
