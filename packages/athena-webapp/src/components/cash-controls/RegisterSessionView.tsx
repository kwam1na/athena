import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Banknote,
  ChevronDown,
  CreditCard,
  Receipt,
  RotateCcw,
  Smartphone,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import {
  CommandApprovalDialog,
  type CommandApprovalDialogProps,
  CommandApprovalApprovedResult,
  CommandApprovalProofResult,
} from "@/components/operations/CommandApprovalDialog";
import { useApprovedCommand } from "@/components/operations/useApprovedCommand";
import {
  isApprovalRequiredResult,
  type NormalizedCommandResult,
  type NormalizedApprovalCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import { capitalizeWords, currencyFormatter } from "@/lib/utils";
import {
  formatStoredCurrencyAmount,
  parseDisplayAmountInput,
} from "@/lib/pos/displayAmounts";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { toDisplayAmount } from "~/convex/lib/currency";
import { userError, type CommandResult } from "~/shared/commandResult";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import { currencyDisplaySymbol } from "~/shared/currencyFormatter";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { ComposedPageHeader } from "../common/PageHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { formatReviewReason } from "./formatReviewReason";
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
  notes?: string | null;
  reason?: string | null;
  requestedByStaffName?: string | null;
  status: string;
};

type RegisterSessionDetail = {
  _id: string;
  closedAt?: number;
  closedByStaffName?: string | null;
  closeoutRecords?: Array<{
    actorStaffProfileId?: string;
    occurredAt: number;
    type: "closed" | "reopened";
  }>;
  countedCash?: number;
  expectedCash: number;
  netExpectedCash?: number;
  notes?: string | null;
  openedAt: number;
  openedByStaffName?: string | null;
  openingFloat: number;
  pendingApprovalRequest?: RegisterSessionApprovalRequest | null;
  registerNumber?: string | null;
  status: string;
  terminalName?: string | null;
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

type RegisterSessionTimelineEvent = {
  _id: string;
  actorStaffName?: string | null;
  createdAt: number;
  eventType: string;
  metadata?: Record<string, unknown> | null;
  message?: string | null;
  reason?: string | null;
};

export type RegisterSessionSnapshot = {
  closeoutReview: RegisterSessionCloseoutReview | null;
  deposits: RegisterSessionDeposit[];
  registerSession: RegisterSessionDetail;
  timeline?: RegisterSessionTimelineEvent[];
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

type RegisterCloseoutSubmitArgs = {
  actorStaffProfileId: string;
  approvalProofId?: string;
  closeoutModificationApprovalProofId?: string;
  countedCash: number;
  notes?: string;
  registerSessionId: string;
  requestedByStaffProfileId?: string;
};

type RegisterCloseoutReviewArgs = {
  approvalProofId: string;
  decision: "approved" | "rejected";
  decisionNotes?: string;
  registerSessionId: string;
};

type RegisterCloseoutCommandPayload = {
  action?: "closed" | "approved" | "rejected" | "reopened";
};

type RegisterCloseoutCommandResult =
  NormalizedApprovalCommandResult<RegisterCloseoutCommandPayload>;

type StaffAuthenticationCommandResult =
  NormalizedCommandResult<StaffAuthenticationResult>;

type CloseoutApprovalAuthenticationResult = StaffAuthenticationResult & {
  approvalProofId?: string;
};

type CloseoutApprovalAuthenticationCommandResult =
  NormalizedCommandResult<CloseoutApprovalAuthenticationResult>;

type CorrectOpeningFloatArgs = {
  actorStaffProfileId?: string;
  approvalProofId?: string;
  correctedOpeningFloat: number;
  reason: string;
  registerSessionId: string;
};

type CorrectOpeningFloatCommandResult = NormalizedApprovalCommandResult<{
  action?: "corrected" | "duplicate";
}>;

type StaffAuthenticationRole = "cashier" | "manager";

type RegisterSessionViewContentProps = {
  actorStaffProfileId?: string;
  actorUserId?: string;
  currency: string;
  isLoading: boolean;
  onRecordDeposit: (
    args: RecordRegisterSessionDepositArgs,
  ) => Promise<RegisterSessionDepositResult>;
  onCorrectOpeningFloat?: (
    args: CorrectOpeningFloatArgs,
  ) => Promise<CorrectOpeningFloatCommandResult>;
  onReviewCloseout: (
    args: RegisterCloseoutReviewArgs,
  ) => Promise<RegisterCloseoutCommandResult>;
  onReopenCloseout?: (args: {
    actorStaffProfileId: string;
    approvalProofId: string;
    registerSessionId: string;
    requestedByStaffProfileId?: string;
  }) => Promise<RegisterCloseoutCommandResult>;
  onAuthenticateStaff: (args: {
    allowedRoles: StaffAuthenticationRole[];
    pinHash: string;
    username: string;
  }) => Promise<StaffAuthenticationCommandResult>;
  onAuthenticateCloseoutReviewApproval?: (args: {
    pinHash: string;
    reason?: string;
    registerSessionId: string;
    requestedByStaffProfileId?: Id<"staffProfile">;
    username: string;
  }) => Promise<CloseoutApprovalAuthenticationCommandResult>;
  onAuthenticateForApproval?: CommandApprovalDialogProps["onAuthenticateForApproval"];
  onSubmitCloseout: (
    args: RegisterCloseoutSubmitArgs,
  ) => Promise<RegisterCloseoutCommandResult>;
  orgUrlSlug?: string;
  registerSessionSnapshot: RegisterSessionSnapshot | null;
  storeId?: string;
  storeUrlSlug?: string;
};

type CloseoutStaffAuthIntent =
  | {
      kind: "submit";
      countedCash: number;
      notes?: string;
      registerSessionId: string;
    }
  | {
      decision: "approved" | "rejected";
      decisionNotes?: string;
      kind: "review";
      registerSessionId: string;
    };

type ReopenedCloseoutSubmitIntent = {
  countedCash: number;
  notes?: string;
  registerSessionId: string;
  reopenedByStaffProfileId?: string;
};

type OpeningFloatCorrectionIntent = {
  correctedOpeningFloat: number;
  reason: string;
  registerSessionId: string;
};

function trimOptional(value?: string) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function isManagerStaff(staff: StaffAuthenticationResult) {
  return staff.activeRoles?.includes("manager") ?? false;
}

function buildDepositSubmissionKey(registerSessionId: string) {
  return `register-session-deposit-${registerSessionId}-${Date.now().toString(36)}`;
}

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return formatStoredCurrencyAmount(currency, amount, {
    revealMinorUnits: true,
  });
}

function formatStoredAmountForInput(amount: number) {
  return String(toDisplayAmount(amount));
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

function isCloseoutRejectionEvent(event: RegisterSessionTimelineEvent) {
  return event.eventType === "register_session_closeout_rejected";
}

function isOpeningFloatCorrectionEvent(event: RegisterSessionTimelineEvent) {
  return (
    event.eventType.toLowerCase().includes("opening_float") ||
    event.message?.toLowerCase().includes("opening float")
  );
}

function getNumericEventMetadata(
  event: RegisterSessionTimelineEvent,
  key: string,
) {
  const value = event.metadata?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRegisterSessionCorrectionEvent(event: RegisterSessionTimelineEvent) {
  return (
    isCloseoutRejectionEvent(event) || isOpeningFloatCorrectionEvent(event)
  );
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

function formatSessionCode(sessionId: string) {
  return sessionId.slice(-6).toUpperCase();
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

export function RegisterSessionViewContent({
  actorStaffProfileId,
  actorUserId,
  currency,
  isLoading,
  onAuthenticateForApproval,
  onAuthenticateStaff,
  onAuthenticateCloseoutReviewApproval,
  onCorrectOpeningFloat,
  onRecordDeposit,
  onReopenCloseout,
  onReviewCloseout,
  onSubmitCloseout,
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
  const [countedCash, setCountedCash] = useState("");
  const [closeoutNotes, setCloseoutNotes] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [closeoutErrorMessage, setCloseoutErrorMessage] = useState("");
  const [pendingCloseoutAction, setPendingCloseoutAction] = useState<
    "approved" | "rejected" | "reopen" | "submit" | null
  >(null);
  const [closeoutStaffAuthIntent, setCloseoutStaffAuthIntent] =
    useState<CloseoutStaffAuthIntent | null>(null);
  const [reopenedCloseoutSubmitIntent, setReopenedCloseoutSubmitIntent] =
    useState<ReopenedCloseoutSubmitIntent | null>(null);
  const [
    isReopenedCloseoutSubmitApprovalOpen,
    setIsReopenedCloseoutSubmitApprovalOpen,
  ] = useState(false);
  const [isOpeningFloatCorrectionOpen, setIsOpeningFloatCorrectionOpen] =
    useState(false);
  const [correctedOpeningFloat, setCorrectedOpeningFloat] = useState("");
  const [openingFloatCorrectionReason, setOpeningFloatCorrectionReason] =
    useState("");
  const [openingFloatCorrectionError, setOpeningFloatCorrectionError] =
    useState("");
  const [openingFloatCorrectionInfo, setOpeningFloatCorrectionInfo] =
    useState("");
  const [openingFloatCorrectionSuccess, setOpeningFloatCorrectionSuccess] =
    useState("");
  const [openingFloatCorrectionIntent, setOpeningFloatCorrectionIntent] =
    useState<OpeningFloatCorrectionIntent | null>(null);
  const [pendingOpeningFloatApproval, setPendingOpeningFloatApproval] =
    useState<ApprovalRequirement | null>(null);
  const [isCorrectingOpeningFloat, setIsCorrectingOpeningFloat] =
    useState(false);
  const [isReopenApprovalOpen, setIsReopenApprovalOpen] = useState(false);
  const closeoutApprovalRunner = useApprovedCommand({
    storeId: storeId as Id<"store"> | undefined,
    onAuthenticateForApproval:
      onAuthenticateForApproval ??
      (() =>
        Promise.resolve(
          userError({
            code: "unavailable",
            message:
              "Manager approval is not available yet. Try again after the register tools refresh.",
          }),
        )),
  });
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildDepositSubmissionKey(registerSession?._id ?? "session"),
  );

  useEffect(() => {
    if (!registerSession?._id) {
      return;
    }

    setSubmissionKey(buildDepositSubmissionKey(registerSession._id));
  }, [registerSession?._id]);

  useEffect(() => {
    if (!registerSession?._id) {
      setCountedCash("");
      setCloseoutNotes("");
      setManagerNotes("");
      setCloseoutErrorMessage("");
      setPendingCloseoutAction(null);
      setCloseoutStaffAuthIntent(null);
      setReopenedCloseoutSubmitIntent(null);
      setIsReopenedCloseoutSubmitApprovalOpen(false);
      setIsOpeningFloatCorrectionOpen(false);
      setCorrectedOpeningFloat("");
      setOpeningFloatCorrectionReason("");
      setOpeningFloatCorrectionError("");
      setOpeningFloatCorrectionInfo("");
      setOpeningFloatCorrectionSuccess("");
      setOpeningFloatCorrectionIntent(null);
      setPendingOpeningFloatApproval(null);
      setIsReopenApprovalOpen(false);
      return;
    }

    setCountedCash(
      registerSession.countedCash !== undefined
        ? formatStoredAmountForInput(registerSession.countedCash)
        : "",
    );
    setCloseoutNotes("");
    setManagerNotes("");
    setCloseoutErrorMessage("");
    setPendingCloseoutAction(null);
    setCloseoutStaffAuthIntent(null);
    setReopenedCloseoutSubmitIntent(null);
    setIsReopenedCloseoutSubmitApprovalOpen(false);
    setIsOpeningFloatCorrectionOpen(false);
    setCorrectedOpeningFloat(
      formatStoredAmountForInput(registerSession.openingFloat),
    );
    setOpeningFloatCorrectionReason("");
    setOpeningFloatCorrectionError("");
    setOpeningFloatCorrectionInfo("");
    setOpeningFloatCorrectionSuccess("");
    setOpeningFloatCorrectionIntent(null);
    setPendingOpeningFloatApproval(null);
    setIsReopenApprovalOpen(false);
  }, [
    registerSession?._id,
    registerSession?.countedCash,
    registerSession?.openingFloat,
  ]);

  const reopenCloseoutApproval = useMemo<ApprovalRequirement | null>(() => {
    if (!registerSession || !storeId) {
      return null;
    }

    return {
      action: {
        key: "cash_controls.register_session.reopen_closeout",
        label: "Reopen register closeout",
      },
      copy: {
        title: "Manager approval required",
        message: "Manager approval is required to reopen this saved closeout.",
        primaryActionLabel: "Reopen closeout",
        secondaryActionLabel: "Cancel",
      },
      reason: "Manager approval is required to reopen this saved closeout.",
      requiredRole: "manager",
      resolutionModes: [{ kind: "inline_manager_proof" }],
      subject: {
        id: registerSession._id,
        label: registerSession.registerNumber ?? undefined,
        type: "register_session",
      },
    };
  }, [registerSession, storeId]);

  const latestCloseoutRecord = registerSession?.closeoutRecords?.at(-1) ?? null;
  const reopenedCloseoutRecord =
    latestCloseoutRecord?.type === "reopened" ? latestCloseoutRecord : null;
  const requiresReopenedCloseoutSubmitApproval =
    registerSession?.status === "closing" && Boolean(reopenedCloseoutRecord);

  const reopenedCloseoutSubmitApproval =
    useMemo<ApprovalRequirement | null>(() => {
      if (
        !registerSession ||
        !storeId ||
        !requiresReopenedCloseoutSubmitApproval
      ) {
        return null;
      }

      return {
        action: {
          key: "cash_controls.register_session.submit_reopened_closeout",
          label: "Submit reopened register closeout",
        },
        copy: {
          title: "Manager approval required",
          message:
            "The manager who reopened this closeout must submit the corrected count.",
          primaryActionLabel: "Submit correction",
          secondaryActionLabel: "Cancel",
        },
        reason:
          "The manager who reopened this closeout must submit the corrected count.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        subject: {
          id: registerSession._id,
          label: registerSession.registerNumber ?? undefined,
          type: "register_session",
        },
      };
    }, [registerSession, requiresReopenedCloseoutSubmitApproval, storeId]);

  const applyCommandResult = (result: RegisterSessionDepositResult) => {
    if (result.kind === "ok") {
      setErrorMessage("");
      return true;
    }

    setErrorMessage(result.error.message);
    return false;
  };

  const applyCloseoutCommandResult = (
    result: RegisterCloseoutCommandResult,
  ) => {
    if (isApprovalRequiredResult(result)) {
      setCloseoutErrorMessage("");
      return true;
    }

    if (result.kind === "ok") {
      setCloseoutErrorMessage("");
      return true;
    }

    setCloseoutErrorMessage(result.error.message);
    return false;
  };

  async function handleRecordDeposit() {
    if (!registerSession?._id || !storeId) {
      setErrorMessage(
        "A store and register session are required before recording a deposit",
      );
      return;
    }

    const parsedAmount = Number(amount);

    if (!amount.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage("Enter a deposit amount greater than zero");
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

  async function handleSubmitCloseout() {
    if (!registerSession?._id) {
      setCloseoutErrorMessage(
        "A register session is required before submitting a closeout",
      );
      return;
    }

    const parsedCountedCash = parseDisplayAmountInput(countedCash);

    if (parsedCountedCash === undefined) {
      setCloseoutErrorMessage(
        "Enter the counted cash before submitting the closeout",
      );
      return;
    }

    const trimmedCloseoutNotes = trimOptional(closeoutNotes);
    const expectedCloseoutCash =
      registerSession.netExpectedCash ?? registerSession.expectedCash;

    if (parsedCountedCash !== expectedCloseoutCash && !trimmedCloseoutNotes) {
      setCloseoutErrorMessage(
        "Add closeout notes before submitting a count with variance",
      );
      return;
    }

    setCloseoutErrorMessage("");

    if (requiresReopenedCloseoutSubmitApproval) {
      if (
        !onAuthenticateForApproval ||
        !storeId ||
        !reopenedCloseoutSubmitApproval
      ) {
        setCloseoutErrorMessage(
          "Manager approval is not available yet. Try again after the register tools refresh.",
        );
        return;
      }

      setReopenedCloseoutSubmitIntent({
        countedCash: parsedCountedCash,
        notes: trimmedCloseoutNotes,
        registerSessionId: registerSession._id,
        reopenedByStaffProfileId: reopenedCloseoutRecord?.actorStaffProfileId,
      });
      setIsReopenedCloseoutSubmitApprovalOpen(true);
      return;
    }

    setCloseoutStaffAuthIntent({
      kind: "submit",
      countedCash: parsedCountedCash,
      notes: trimmedCloseoutNotes,
      registerSessionId: registerSession._id,
    });
  }

  async function handleReviewCloseout(decision: "approved" | "rejected") {
    if (!registerSession?._id) {
      setCloseoutErrorMessage(
        "A register session is required before reviewing a closeout",
      );
      return;
    }

    setCloseoutErrorMessage("");
    setCloseoutStaffAuthIntent({
      kind: "review",
      decision,
      decisionNotes: trimOptional(managerNotes),
      registerSessionId: registerSession._id,
    });
  }

  async function handleReopenClosedCloseout() {
    if (!registerSession?._id) {
      setCloseoutErrorMessage(
        "A register session is required before reopening a closeout",
      );
      return;
    }

    if (!onReopenCloseout) {
      setCloseoutErrorMessage(
        "Closeout reopening is not available yet. Try again after the register tools refresh.",
      );
      return;
    }

    if (!onAuthenticateForApproval || !storeId || !reopenCloseoutApproval) {
      setCloseoutErrorMessage(
        "Manager approval is not available yet. Try again after the register tools refresh.",
      );
      return;
    }

    setCloseoutErrorMessage("");
    setIsReopenApprovalOpen(true);
  }

  async function handleSubmitOpeningFloatCorrection() {
    if (!registerSession?._id) {
      setOpeningFloatCorrectionError(
        "A register session is required before correcting opening float",
      );
      setOpeningFloatCorrectionInfo("");
      return;
    }

    if (!["open", "active"].includes(registerSession.status)) {
      setOpeningFloatCorrectionError(
        "Opening float can only be corrected while the drawer is open",
      );
      setOpeningFloatCorrectionInfo("");
      return;
    }

    const parsedOpeningFloat = parseDisplayAmountInput(correctedOpeningFloat);
    const trimmedReason = openingFloatCorrectionReason.trim();

    if (parsedOpeningFloat === undefined) {
      setOpeningFloatCorrectionError("Enter the corrected opening float");
      setOpeningFloatCorrectionInfo("");
      return;
    }

    if (parsedOpeningFloat === registerSession.openingFloat) {
      setOpeningFloatCorrectionError("");
      setOpeningFloatCorrectionInfo(
        "Corrected amount matches the current opening float. Enter a different amount to submit a correction.",
      );
      setOpeningFloatCorrectionSuccess("");
      setOpeningFloatCorrectionIntent(null);
      setPendingOpeningFloatApproval(null);
      return;
    }

    if (!trimmedReason) {
      setOpeningFloatCorrectionError("Add a reason for this correction");
      setOpeningFloatCorrectionInfo("");
      return;
    }

    const intent = {
      correctedOpeningFloat: parsedOpeningFloat,
      reason: trimmedReason,
      registerSessionId: registerSession._id,
    };

    setOpeningFloatCorrectionError("");
    setOpeningFloatCorrectionInfo("");
    setOpeningFloatCorrectionSuccess("");
    setOpeningFloatCorrectionIntent(intent);
    await runOpeningFloatCorrection(intent);
  }

  async function handleAuthenticatedCloseoutStaff(
    result: CloseoutApprovalAuthenticationResult,
    credentials?: { pinHash: string; username: string },
  ) {
    if (!closeoutStaffAuthIntent) {
      return;
    }

    const intent = closeoutStaffAuthIntent;
    const action = intent.kind === "submit" ? "submit" : intent.decision;

    setCloseoutErrorMessage("");
    setPendingCloseoutAction(action);
    setCloseoutStaffAuthIntent(null);

    try {
      const commandResult =
        intent.kind === "submit"
          ? await closeoutApprovalRunner.run({
              requestedByStaffProfileId:
                result.staffProfileId as Id<"staffProfile">,
              sameSubmissionApproval: credentials
                ? {
                    canAttemptInlineManagerProof: isManagerStaff(result),
                    pinHash: credentials.pinHash,
                    requestedByStaffProfileId:
                      result.staffProfileId as Id<"staffProfile">,
                    username: credentials.username,
                  }
                : undefined,
              execute: (approvalArgs) =>
                onSubmitCloseout({
                  actorStaffProfileId: result.staffProfileId,
                  approvalProofId:
                    approvalArgs.approvalProofId ?? result.approvalProofId,
                  countedCash: intent.countedCash,
                  notes: intent.notes,
                  registerSessionId: intent.registerSessionId,
                }),
              onResult: () => undefined,
            })
          : result.approvalProofId
            ? await onReviewCloseout({
                approvalProofId: result.approvalProofId,
                decision: intent.decision,
                decisionNotes: intent.decisionNotes,
                registerSessionId: intent.registerSessionId,
              })
            : userError({
                code: "authentication_failed",
                message:
                  "Manager approval could not be verified. Confirm manager credentials again.",
              });

      if (!applyCloseoutCommandResult(commandResult)) {
        return;
      }

      if (intent.kind === "submit") {
        setCloseoutNotes("");
      } else {
        setManagerNotes("");
      }
    } finally {
      setPendingCloseoutAction(null);
    }
  }

  async function runOpeningFloatCorrection(
    intent: OpeningFloatCorrectionIntent,
    args?: { approvalProofId?: string },
  ) {
    if (!onCorrectOpeningFloat) {
      setOpeningFloatCorrectionError(
        "Opening float correction is not available yet. Try again after the register tools refresh.",
      );
      return;
    }

    setOpeningFloatCorrectionError("");
    setOpeningFloatCorrectionInfo("");
    setIsCorrectingOpeningFloat(true);

    try {
      const commandResult = await onCorrectOpeningFloat({
        approvalProofId: args?.approvalProofId,
        correctedOpeningFloat: intent.correctedOpeningFloat,
        reason: intent.reason,
        registerSessionId: intent.registerSessionId,
      });

      if (isApprovalRequiredResult(commandResult)) {
        setOpeningFloatCorrectionInfo("");
        setPendingOpeningFloatApproval(commandResult.approval);
        return;
      }

      if (commandResult.kind !== "ok") {
        setOpeningFloatCorrectionError(commandResult.error.message);
        setOpeningFloatCorrectionInfo("");
        return;
      }

      setOpeningFloatCorrectionSuccess("Opening float corrected");
      setOpeningFloatCorrectionInfo("");
      setOpeningFloatCorrectionReason("");
      setIsOpeningFloatCorrectionOpen(false);
      setOpeningFloatCorrectionIntent(null);
      setPendingOpeningFloatApproval(null);
    } finally {
      setIsCorrectingOpeningFloat(false);
    }
  }

  function handleOpeningFloatApprovalApproved(
    result: CommandApprovalApprovedResult,
  ) {
    if (!openingFloatCorrectionIntent) {
      setOpeningFloatCorrectionError(
        "Opening float correction details were not available. Review the amount and submit again.",
      );
      setOpeningFloatCorrectionInfo("");
      setPendingOpeningFloatApproval(null);
      return;
    }

    setPendingOpeningFloatApproval(null);
    void runOpeningFloatCorrection(openingFloatCorrectionIntent, {
      approvalProofId: result.approvalProofId,
    });
  }

  async function handleReopenCloseoutApproved(
    result: CommandApprovalApprovedResult,
  ) {
    if (!registerSession?._id || !onReopenCloseout) {
      setCloseoutErrorMessage(
        "A register session is required before reopening a closeout",
      );
      setIsReopenApprovalOpen(false);
      return;
    }

    setCloseoutErrorMessage("");
    setPendingCloseoutAction("reopen");
    setIsReopenApprovalOpen(false);

    try {
      const commandResult = await onReopenCloseout({
        actorStaffProfileId: result.approvedByStaffProfileId,
        approvalProofId: result.approvalProofId,
        registerSessionId: registerSession._id,
        requestedByStaffProfileId: actorStaffProfileId,
      });

      applyCloseoutCommandResult(commandResult);
    } finally {
      setPendingCloseoutAction(null);
    }
  }

  async function handleReopenedCloseoutSubmitApproved(
    result: CommandApprovalApprovedResult,
  ) {
    if (!reopenedCloseoutSubmitIntent) {
      setCloseoutErrorMessage(
        "Closeout correction details were not available. Review the count and submit again.",
      );
      setIsReopenedCloseoutSubmitApprovalOpen(false);
      return;
    }

    if (
      reopenedCloseoutSubmitIntent.reopenedByStaffProfileId &&
      result.approvedByStaffProfileId !==
        reopenedCloseoutSubmitIntent.reopenedByStaffProfileId
    ) {
      setCloseoutErrorMessage(
        "The manager who reopened this closeout must submit the correction.",
      );
      setIsReopenedCloseoutSubmitApprovalOpen(false);
      return;
    }

    const intent = reopenedCloseoutSubmitIntent;

    setCloseoutErrorMessage("");
    setPendingCloseoutAction("submit");
    setReopenedCloseoutSubmitIntent(null);
    setIsReopenedCloseoutSubmitApprovalOpen(false);

    try {
      const commandResult = await onSubmitCloseout({
        actorStaffProfileId: result.approvedByStaffProfileId,
        closeoutModificationApprovalProofId: result.approvalProofId,
        countedCash: intent.countedCash,
        notes: intent.notes,
        registerSessionId: intent.registerSessionId,
        requestedByStaffProfileId: actorStaffProfileId,
      });

      if (!applyCloseoutCommandResult(commandResult)) {
        return;
      }

      setCloseoutNotes("");
    } finally {
      setPendingCloseoutAction(null);
    }
  }

  const closeoutStaffAuthCopy =
    closeoutStaffAuthIntent?.kind === "review"
      ? {
          title: "Manager sign-in required",
          description:
            closeoutStaffAuthIntent.decision === "approved"
              ? "Authenticate to approve variance"
              : "Authenticate to reject variance",
          submitLabel:
            closeoutStaffAuthIntent.decision === "approved"
              ? "Approve variance"
              : "Reject variance",
        }
      : {
          title: "Closeout sign-in required",
          description: "Authenticate to submit closeout",
          submitLabel: "Submit closeout",
        };
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
  const reviewReasonFormatter = currencyFormatter(currency);
  const formattedCurrency = currencyDisplaySymbol(currency);
  const parsedCountedCash = parseDisplayAmountInput(countedCash);
  const draftVariance =
    registerSession && parsedCountedCash !== undefined
      ? parsedCountedCash - expectedCash
      : (registerSession?.variance ?? null);
  const closeoutNotesRequired = draftVariance !== null && draftVariance !== 0;
  const hasPendingCloseoutApproval =
    registerSession?.pendingApprovalRequest?.status === "pending";
  const formattedApprovalReason = formatReviewReason(
    reviewReasonFormatter,
    registerSession?.pendingApprovalRequest?.reason,
  );
  const closeoutRequestNotes =
    registerSession?.pendingApprovalRequest?.notes ?? registerSession?.notes;
  const formattedCloseoutReviewReason = formatReviewReason(
    reviewReasonFormatter,
    registerSessionSnapshot?.closeoutReview?.reason,
  );
  const correctionTimeline = (registerSessionSnapshot?.timeline ?? []).filter(
    isRegisterSessionCorrectionEvent,
  );
  const hasCloseoutRejectionHistory = correctionTimeline.some(
    isCloseoutRejectionEvent,
  );
  const isClosedRegisterSession = registerSession?.status === "closed";
  const hasRejectedCloseoutApproval =
    registerSession?.pendingApprovalRequest?.status === "rejected";
  const needsCloseoutCorrection =
    !isClosedRegisterSession &&
    (hasRejectedCloseoutApproval || hasCloseoutRejectionHistory);
  const headerTitle = registerSession
    ? formatRegisterHeaderName(registerSession.registerNumber)
    : "Register detail";
  const headerTerminalName = registerSession?.terminalName?.trim();
  const sessionCode = registerSession
    ? formatSessionCode(registerSession._id)
    : undefined;
  const openedByLine = registerSession?.openedByStaffName
    ? `By ${formatStaffDisplayName({ fullName: registerSession.openedByStaffName })}`
    : "Staff not recorded";
  const linkedSalesLabel =
    transactions.length === 1
      ? "1 linked sale"
      : `${transactions.length} linked sales`;
  const closeoutState =
    registerSession?.status === "closed"
      ? "Closed"
      : registerSession?.status === "closing"
        ? needsCloseoutCorrection
          ? "Closeout rejected"
          : hasPendingCloseoutApproval
            ? "Manager approval pending"
            : "Closeout in progress"
        : undefined;
  const shouldShowCloseoutSummary = Boolean(closeoutState);
  const closeoutTimestamp =
    registerSession?.status === "closed" && registerSession.closedAt
      ? formatTimestamp(registerSession.closedAt)
      : undefined;
  const closeoutActorLine =
    registerSession?.status === "closed"
      ? registerSession.closedByStaffName
        ? `By ${formatStaffDisplayName({ fullName: registerSession.closedByStaffName })}`
        : "Staff not recorded"
      : undefined;
  const canCorrectOpeningFloat =
    registerSession?.status === "open" || registerSession?.status === "active";
  const showOpeningFloatCorrectionUnavailable =
    registerSession &&
    !canCorrectOpeningFloat &&
    registerSession.status !== "closed";
  const correctedOpeningFloatAmount = parseDisplayAmountInput(
    correctedOpeningFloat,
  );
  const openingFloatDelta =
    registerSession && correctedOpeningFloatAmount !== undefined
      ? correctedOpeningFloatAmount - registerSession.openingFloat
      : null;
  const hasOpeningFloatCorrectionHistory = correctionTimeline.some(
    isOpeningFloatCorrectionEvent,
  );
  const openingFloatCorrectionCardTitle =
    hasCloseoutRejectionHistory &&
    !isClosedRegisterSession &&
    !isOpeningFloatCorrectionOpen &&
    !openingFloatCorrectionSuccess &&
    !hasOpeningFloatCorrectionHistory
      ? "Closeout correction needed"
      : "Opening float correction";
  const openingFloatCorrectionCardDescription =
    hasCloseoutRejectionHistory &&
    !isClosedRegisterSession &&
    !isOpeningFloatCorrectionOpen &&
    !openingFloatCorrectionSuccess &&
    !hasOpeningFloatCorrectionHistory
      ? "Review the rejected closeout, then recount or correct the drawer"
      : "Correct the starting cash amount without changing linked sales";
  const correctionHistoryLabel = hasCloseoutRejectionHistory
    ? "Closeout history"
    : "Correction history";
  const closeoutFollowUpMessage = needsCloseoutCorrection
    ? "Manager rejected this closeout. Recount or correct the drawer before submitting again."
    : formattedApprovalReason;
  const shouldShowProminentCorrectionPanel =
    Boolean(registerSession) &&
    (isOpeningFloatCorrectionOpen ||
      Boolean(openingFloatCorrectionSuccess) ||
      (correctionTimeline.length > 0 && !isClosedRegisterSession));
  const pendingCloseoutApprovalPanel =
    registerSession && hasPendingCloseoutApproval ? (
      <section className="space-y-4 rounded-[calc(var(--radius)*1.2)] border border-amber-200 bg-amber-50/40 p-layout-lg shadow-surface">
        <div className="space-y-2">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-amber-800">
              Manager approval required
            </p>
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Review closeout variance
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {formattedApprovalReason ??
                  formattedCloseoutReviewReason ??
                  "Review the submitted count before closing this drawer"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-amber-200/80 bg-background/70 p-4">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Expected
              </p>
              <p className="font-numeric tabular-nums text-base text-foreground">
                {formatCurrency(currency, expectedCash)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Counted
              </p>
              <p className="font-numeric tabular-nums text-base text-foreground">
                {formatCurrency(currency, registerSession.countedCash)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Variance
              </p>
              <p
                className={`font-numeric tabular-nums text-base ${getVarianceTone(registerSession.variance)}`}
              >
                {formatCurrency(currency, registerSession.variance ?? 0)}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3 border-t border-amber-200/70 pt-3 text-xs text-muted-foreground">
            <p>
              Requested by{" "}
              {registerSession.pendingApprovalRequest?.requestedByStaffName
                ? formatStaffDisplayName({
                    fullName:
                      registerSession.pendingApprovalRequest
                        .requestedByStaffName,
                  })
                : "staff not recorded"}
            </p>
            {closeoutRequestNotes ? (
              <div className="space-y-1 rounded-md bg-amber-50/60 px-3 py-2 text-muted-foreground">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-amber-900/70">
                  Request notes
                </p>
                <p className="text-sm leading-5 text-foreground">
                  {closeoutRequestNotes}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <label className="block w-[480px] space-y-2">
          <span className="text-sm font-medium text-foreground">
            Manager notes
          </span>
          <Textarea
            aria-label="Manager closeout notes"
            className="min-h-[112px] w-full border-input bg-background"
            onChange={(event) => setManagerNotes(event.target.value)}
            placeholder="Add approval or rejection notes."
            value={managerNotes}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <LoadingButton
            disabled={Boolean(pendingCloseoutAction)}
            isLoading={pendingCloseoutAction === "approved"}
            onClick={() => void handleReviewCloseout("approved")}
            type="button"
          >
            Approve variance
          </LoadingButton>
          <LoadingButton
            disabled={Boolean(pendingCloseoutAction)}
            isLoading={pendingCloseoutAction === "rejected"}
            onClick={() => void handleReviewCloseout("rejected")}
            type="button"
            variant="outline"
          >
            Reject variance
          </LoadingButton>
        </div>
      </section>
    ) : null;

  return (
    <View
      header={
        <ComposedPageHeader
          leadingContent={
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-foreground">
                {headerTitle}
              </span>
              {headerTerminalName ? (
                <span className="text-sm text-muted-foreground">
                  {headerTerminalName}
                </span>
              ) : null}
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
            </div>
          }
        />
      }
    >
      <StaffAuthenticationDialog
        copy={closeoutStaffAuthCopy}
        getSuccessMessage={(result) => {
          const staffDisplayName = formatStaffDisplayName(result.staffProfile);
          return staffDisplayName
            ? `Confirmed as ${staffDisplayName}`
            : "Staff credentials confirmed";
        }}
        onAuthenticate={(args) => {
          if (
            closeoutStaffAuthIntent?.kind === "review" &&
            onAuthenticateCloseoutReviewApproval
          ) {
            return onAuthenticateCloseoutReviewApproval({
              pinHash: args.pinHash,
              reason: closeoutStaffAuthIntent.decisionNotes,
              registerSessionId: closeoutStaffAuthIntent.registerSessionId,
              username: args.username,
            });
          }

          return Promise.resolve(
            onAuthenticateStaff({
              allowedRoles:
                closeoutStaffAuthIntent?.kind === "review"
                  ? ["manager"]
                  : ["cashier", "manager"],
              pinHash: args.pinHash,
              username: args.username,
            }),
          );
        }}
        onAuthenticated={(result, _mode, credentials) => {
          void handleAuthenticatedCloseoutStaff(result, credentials);
        }}
        onDismiss={() => setCloseoutStaffAuthIntent(null)}
        open={Boolean(closeoutStaffAuthIntent)}
      />
      {closeoutApprovalRunner.dialog}
      <CommandApprovalDialog
        approval={pendingOpeningFloatApproval}
        onAuthenticateForApproval={
          onAuthenticateForApproval ??
          (() =>
            Promise.resolve(
              userError({
                code: "unavailable",
                message:
                  "Manager approval is not available yet. Try again after the register tools refresh.",
              }),
            ))
        }
        onApproved={handleOpeningFloatApprovalApproved}
        onDismiss={() => {
          setPendingOpeningFloatApproval(null);
          setOpeningFloatCorrectionIntent(null);
        }}
        open={Boolean(pendingOpeningFloatApproval)}
        requestedByStaffProfileId={
          actorStaffProfileId as Id<"staffProfile"> | undefined
        }
        storeId={(storeId ?? "missing-store") as Id<"store">}
      />
      <CommandApprovalDialog
        approval={reopenCloseoutApproval}
        onAuthenticateForApproval={
          onAuthenticateForApproval ??
          (() =>
            Promise.resolve(
              userError({
                code: "unavailable",
                message:
                  "Manager approval is not available yet. Try again after the register tools refresh.",
              }),
            ))
        }
        onApproved={(result) => {
          void handleReopenCloseoutApproved(result);
        }}
        onDismiss={() => setIsReopenApprovalOpen(false)}
        open={isReopenApprovalOpen}
        requestedByStaffProfileId={
          actorStaffProfileId as Id<"staffProfile"> | undefined
        }
        storeId={(storeId ?? "missing-store") as Id<"store">}
      />
      <CommandApprovalDialog
        approval={reopenedCloseoutSubmitApproval}
        onAuthenticateForApproval={
          onAuthenticateForApproval ??
          (() =>
            Promise.resolve(
              userError({
                code: "unavailable",
                message:
                  "Manager approval is not available yet. Try again after the register tools refresh.",
              }),
            ))
        }
        onApproved={(result) => {
          void handleReopenedCloseoutSubmitApproved(result);
        }}
        onDismiss={() => {
          setIsReopenedCloseoutSubmitApprovalOpen(false);
          setReopenedCloseoutSubmitIntent(null);
        }}
        open={isReopenedCloseoutSubmitApprovalOpen}
        requestedByStaffProfileId={
          actorStaffProfileId as Id<"staffProfile"> | undefined
        }
        storeId={(storeId ?? "missing-store") as Id<"store">}
      />
      <FadeIn>
        <div className="container mx-auto space-y-6 p-6">
          <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border bg-surface shadow-surface">
            {isLoading ? null : !registerSession ? (
              <div className="px-layout-lg py-layout-xl">
                <EmptyState
                  description="Try re-opening the cash-controls workspace and selecting a register session again"
                  title="Register session not found"
                />
              </div>
            ) : (
              <div className="grid gap-0 xl:grid-cols-[380px_minmax(0,1fr)]">
                <aside className="border-b border-border/80 bg-muted/20 px-layout-lg py-layout-lg xl:border-b-0 xl:border-r">
                  <dl className="space-y-layout-md">
                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Cash position
                      </dt>
                      <dd className="mt-layout-sm space-y-2 pb-1">
                        <span className="block text-xs text-muted-foreground">
                          Expected cash
                        </span>
                        <span className="block font-numeric tabular-nums text-3xl text-foreground">
                          {formatCurrency(currency, expectedCash)}
                        </span>
                      </dd>
                      <div className="mt-layout-md divide-y divide-border/70 rounded-md border border-border/70 bg-muted/10">
                        <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Opening float
                          </dt>
                          <dd className="font-numeric tabular-nums text-sm text-foreground">
                            {formatCurrency(
                              currency,
                              registerSession.openingFloat,
                            )}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Counted
                          </dt>
                          <dd className="font-numeric tabular-nums text-sm text-foreground">
                            {formatCurrency(
                              currency,
                              registerSession.countedCash,
                            )}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Deposited
                          </dt>
                          <dd className="font-numeric tabular-nums text-sm text-foreground">
                            {formatCurrency(
                              currency,
                              registerSession.totalDeposited,
                            )}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Variance
                          </dt>
                          <dd
                            className={`font-numeric tabular-nums text-sm ${getVarianceTone(registerSession.variance)}`}
                          >
                            {formatCurrency(
                              currency,
                              registerSession.variance ?? 0,
                            )}
                          </dd>
                        </div>
                      </div>
                      {canCorrectOpeningFloat ||
                      showOpeningFloatCorrectionUnavailable ? (
                        <div className="mt-layout-md border-t border-border/70 pt-layout-md">
                          {canCorrectOpeningFloat ? (
                            <Button
                              className="w-full"
                              disabled={isOpeningFloatCorrectionOpen}
                              onClick={() => {
                                setIsOpeningFloatCorrectionOpen(
                                  (value) => !value,
                                );
                                setOpeningFloatCorrectionError("");
                                setOpeningFloatCorrectionSuccess("");
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Correct opening float
                            </Button>
                          ) : (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Opening float corrections are available before
                              closeout starts.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Session
                      </dt>
                      <dd className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Code
                        </span>
                        <span className="font-numeric tabular-nums text-sm text-foreground">
                          {sessionCode}
                        </span>
                      </dd>
                    </div>

                    <div className="divide-y divide-border rounded-lg border border-border bg-surface-raised">
                      <div className="grid gap-1 px-layout-md py-3">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Opened
                        </dt>
                        <dd className="text-sm font-medium text-foreground">
                          {formatTimestamp(registerSession.openedAt)}
                        </dd>
                        <dd className="text-xs text-muted-foreground">
                          {openedByLine}
                        </dd>
                      </div>
                      <div className="grid gap-1 px-layout-md py-3">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Activity
                        </dt>
                        <dd className="text-sm font-medium text-foreground">
                          {linkedSalesLabel}
                        </dd>
                        <dd className="text-xs text-muted-foreground">
                          {formatCurrency(currency, transactionTotal)} in linked
                          sales
                        </dd>
                      </div>
                      {shouldShowCloseoutSummary ? (
                        <div className="grid gap-1 px-layout-md py-3">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            {registerSession.status === "closed"
                              ? "Closed"
                              : "Closeout"}
                          </dt>
                          <dd className="text-sm font-medium text-foreground">
                            {closeoutTimestamp ?? closeoutState}
                          </dd>
                          {closeoutActorLine ? (
                            <dd className="text-xs text-muted-foreground">
                              {closeoutActorLine}
                            </dd>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </dl>

                  {closeoutFollowUpMessage ? (
                    <div className="mt-layout-lg border-t border-border/70 pt-layout-lg">
                      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        Manager follow-up
                      </p>
                      <p className="mt-2 text-sm text-foreground">
                        {closeoutFollowUpMessage}
                      </p>
                    </div>
                  ) : null}
                </aside>

                <div className="flex flex-col gap-layout-lg px-layout-lg py-layout-lg">
                  {pendingCloseoutApprovalPanel}

                  {shouldShowProminentCorrectionPanel ? (
                    <section
                      className={
                        isOpeningFloatCorrectionOpen ||
                        openingFloatCorrectionSuccess
                          ? "order-3 space-y-4 rounded-lg border border-border bg-surface-raised p-layout-md"
                          : "order-3 space-y-3 rounded-lg border border-border bg-muted/20 px-layout-md py-3"
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <h2
                            className={
                              isOpeningFloatCorrectionOpen ||
                              openingFloatCorrectionSuccess
                                ? "font-display text-xl font-semibold text-foreground"
                                : "font-display text-base font-semibold text-foreground"
                            }
                          >
                            {openingFloatCorrectionCardTitle}
                          </h2>
                          <p
                            className={
                              isOpeningFloatCorrectionOpen ||
                              openingFloatCorrectionSuccess
                                ? "text-sm text-muted-foreground"
                                : "text-xs text-muted-foreground"
                            }
                          >
                            {openingFloatCorrectionCardDescription}
                          </p>
                        </div>
                      </div>

                      {isOpeningFloatCorrectionOpen ? (
                        <div className="space-y-4">
                          <div className="grid gap-3 text-sm sm:grid-cols-3">
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Current
                              </p>
                              <p className="font-numeric tabular-nums text-foreground">
                                {formatCurrency(
                                  currency,
                                  registerSession.openingFloat,
                                )}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Corrected
                              </p>
                              <p className="font-numeric tabular-nums text-foreground">
                                {correctedOpeningFloatAmount === undefined
                                  ? "Pending"
                                  : formatCurrency(
                                      currency,
                                      correctedOpeningFloatAmount,
                                    )}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Drawer impact
                              </p>
                              <p className="font-numeric tabular-nums text-foreground">
                                {openingFloatDelta === null
                                  ? "Pending"
                                  : formatCurrency(currency, openingFloatDelta)}
                              </p>
                            </div>
                          </div>

                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-foreground">
                              Corrected amount
                            </span>
                            <Input
                              aria-label="Corrected opening float"
                              className="border-input bg-background"
                              min={0}
                              onChange={(event) => {
                                setCorrectedOpeningFloat(event.target.value);
                                setOpeningFloatCorrectionInfo("");
                              }}
                              step="0.01"
                              type="number"
                              value={correctedOpeningFloat}
                            />
                          </label>

                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-foreground">
                              Reason
                            </span>
                            <Textarea
                              aria-label="Opening float correction reason"
                              className="min-h-[88px] border-input bg-background"
                              onChange={(event) =>
                                setOpeningFloatCorrectionReason(
                                  event.target.value,
                                )
                              }
                              placeholder="Record why the starting cash amount changed."
                              value={openingFloatCorrectionReason}
                            />
                          </label>

                          {openingFloatCorrectionError ? (
                            <p
                              className="text-sm text-destructive"
                              role="alert"
                            >
                              {openingFloatCorrectionError}
                            </p>
                          ) : null}

                          {openingFloatCorrectionInfo ? (
                            <p
                              className="text-sm text-muted-foreground"
                              role="status"
                            >
                              {openingFloatCorrectionInfo}
                            </p>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-3">
                            <LoadingButton
                              disabled={isCorrectingOpeningFloat}
                              isLoading={isCorrectingOpeningFloat}
                              onClick={() =>
                                void handleSubmitOpeningFloatCorrection()
                              }
                              type="button"
                            >
                              Submit
                            </LoadingButton>
                            <Button
                              disabled={isCorrectingOpeningFloat}
                              onClick={() => {
                                setIsOpeningFloatCorrectionOpen(false);
                                setOpeningFloatCorrectionError("");
                                setOpeningFloatCorrectionInfo("");
                              }}
                              type="button"
                              variant="outline"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {openingFloatCorrectionSuccess ? (
                        <p
                          className="text-sm text-[hsl(var(--success))]"
                          role="status"
                        >
                          {openingFloatCorrectionSuccess}
                        </p>
                      ) : null}

                      {correctionTimeline.length > 0 ? (
                        <details className="group border-t border-border/70 pt-3">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            <span>{correctionHistoryLabel}</span>
                            <span className="inline-flex items-center gap-2">
                              {correctionTimeline.length}{" "}
                              {correctionTimeline.length === 1
                                ? "entry"
                                : "entries"}
                              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                            </span>
                          </summary>
                          <div className="space-y-3 pt-3">
                            {correctionTimeline.map((event) => {
                              const previousOpeningFloat =
                                getNumericEventMetadata(
                                  event,
                                  "previousOpeningFloat",
                                );
                              const correctedOpeningFloat =
                                getNumericEventMetadata(
                                  event,
                                  "correctedOpeningFloat",
                                );
                              const openingFloatDelta =
                                previousOpeningFloat !== null &&
                                correctedOpeningFloat !== null
                                  ? correctedOpeningFloat - previousOpeningFloat
                                  : null;

                              return (
                                <div
                                  className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-4"
                                  key={event._id}
                                >
                                  <div className="space-y-1.5">
                                    <p className="text-sm font-medium leading-6 text-foreground">
                                      {event.message ??
                                        formatStatusLabel(event.eventType)}
                                    </p>
                                    <p className="text-xs leading-5 text-muted-foreground">
                                      {formatTimestamp(event.createdAt)}
                                      {event.actorStaffName
                                        ? ` by ${formatStaffDisplayName({ fullName: event.actorStaffName })}`
                                        : ""}
                                    </p>
                                  </div>
                                  {previousOpeningFloat !== null &&
                                  correctedOpeningFloat !== null ? (
                                    <dl className="grid gap-3 border-t border-border/70 pt-3 text-sm sm:grid-cols-3">
                                      <div className="space-y-1">
                                        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Original float
                                        </dt>
                                        <dd className="font-numeric tabular-nums text-foreground">
                                          {formatCurrency(
                                            currency,
                                            previousOpeningFloat,
                                          )}
                                        </dd>
                                      </div>
                                      <div className="space-y-1">
                                        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Corrected float
                                        </dt>
                                        <dd className="font-numeric tabular-nums text-foreground">
                                          {formatCurrency(
                                            currency,
                                            correctedOpeningFloat,
                                          )}
                                        </dd>
                                      </div>
                                      <div className="space-y-1">
                                        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Drawer impact
                                        </dt>
                                        <dd className="font-numeric tabular-nums text-foreground">
                                          {openingFloatDelta === null
                                            ? "Not recorded"
                                            : formatCurrency(
                                                currency,
                                                openingFloatDelta,
                                              )}
                                        </dd>
                                      </div>
                                    </dl>
                                  ) : null}
                                  {event.reason ? (
                                    <div className="space-y-1 border-t border-border/70 pt-3">
                                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                        Notes
                                      </p>
                                      <p className="text-sm leading-6 text-muted-foreground">
                                        {event.reason}
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      ) : null}
                    </section>
                  ) : null}

                  <div
                    className={`order-2 flex flex-wrap items-start justify-between gap-layout-sm ${hasPendingCloseoutApproval ? "pt-4" : ""}`}
                  >
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
                    <div className="order-2 flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/25">
                      <EmptyState
                        icon={
                          <Receipt className="h-12 w-12 text-muted-foreground" />
                        }
                        description="Completed POS sales linked to this register will appear here"
                        title="No linked transactions"
                      />
                    </div>
                  ) : (
                    <div className="order-2 overflow-hidden rounded-lg border border-border bg-surface-raised">
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
                                <TableCell className="font-numeric tabular-nums text-foreground">
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

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_418px]">
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
                    description="Once a safe drop is recorded it will appear here with the staff name and reference"
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
                            <TableCell className="font-numeric tabular-nums text-foreground">
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
              {!hasPendingCloseoutApproval ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                      Closeout workflow
                    </p>
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      Count and close drawer
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Submit the cash count, then resolve any variance approval
                      before closing.
                    </p>
                  </div>

                  {registerSession?.status === "closed" ? (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          Closeout complete
                        </p>
                        <Badge
                          className="border-border bg-muted text-muted-foreground"
                          size="sm"
                          variant="outline"
                        >
                          Closed
                        </Badge>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                        <div className="space-y-1">
                          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Expected
                          </dt>
                          <dd className="font-numeric tabular-nums text-foreground">
                            {formatCurrency(currency, expectedCash)}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Counted
                          </dt>
                          <dd className="font-numeric tabular-nums text-foreground">
                            {formatCurrency(
                              currency,
                              registerSession.countedCash,
                            )}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Variance
                          </dt>
                          <dd
                            className={`font-numeric tabular-nums ${getVarianceTone(registerSession.variance)}`}
                          >
                            {formatCurrency(
                              currency,
                              registerSession.variance ?? 0,
                            )}
                          </dd>
                        </div>
                      </dl>
                      <div className="space-y-3 border-t border-border/70 pt-3">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          Reopen the closeout to submit a corrected count. The
                          saved closeout stays in the drawer history.
                        </p>
                        <LoadingButton
                          className="w-full justify-center"
                          disabled={pendingCloseoutAction === "reopen"}
                          isLoading={pendingCloseoutAction === "reopen"}
                          onClick={() => void handleReopenClosedCloseout()}
                          type="button"
                          variant="outline"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reopen closeout
                        </LoadingButton>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {registerSessionSnapshot?.closeoutReview ? (
                        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium text-foreground">
                              Submitted count
                            </p>
                            <p
                              className={`font-numeric tabular-nums text-lg ${getVarianceTone(registerSessionSnapshot.closeoutReview.variance)}`}
                            >
                              {formatCurrency(
                                currency,
                                registerSessionSnapshot.closeoutReview.variance,
                              )}
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Approval required:{" "}
                            {registerSessionSnapshot.closeoutReview
                              .requiresApproval
                              ? "Yes"
                              : "No"}
                          </p>
                          {formattedCloseoutReviewReason ? (
                            <p className="max-w-full overflow-hidden break-words text-sm leading-relaxed text-foreground">
                              {formattedCloseoutReviewReason}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-foreground">
                          Counted cash ({formattedCurrency})
                        </span>
                        <Input
                          aria-label="Closeout counted cash"
                          className="border-input bg-background"
                          min={0}
                          onChange={(event) =>
                            setCountedCash(event.target.value)
                          }
                          step="0.01"
                          type="number"
                          value={countedCash}
                        />
                      </label>

                      <div className="rounded-lg border border-border bg-muted/20 p-4">
                        <dl className="grid grid-cols-2 gap-3 text-sm">
                          <div className="space-y-1">
                            <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              Expected
                            </dt>
                            <dd className="font-numeric tabular-nums text-foreground">
                              {formatCurrency(currency, expectedCash)}
                            </dd>
                          </div>
                          <div className="space-y-1">
                            <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                              Draft variance
                            </dt>
                            <dd
                              className={`font-numeric tabular-nums ${getVarianceTone(draftVariance ?? undefined)}`}
                            >
                              {draftVariance === null
                                ? "Pending count"
                                : formatCurrency(currency, draftVariance)}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-foreground">
                          Closeout notes
                        </span>
                        <Textarea
                          aria-label="Closeout notes"
                          aria-required={closeoutNotesRequired}
                          className="min-h-[96px] border-input bg-background"
                          onChange={(event) =>
                            setCloseoutNotes(event.target.value)
                          }
                          placeholder="Add drawer notes if anything needs follow-up."
                          required={closeoutNotesRequired}
                          value={closeoutNotes}
                        />
                        {closeoutNotesRequired ? (
                          <p className="text-xs text-muted-foreground">
                            Notes are required when the count has variance.
                          </p>
                        ) : null}
                      </label>

                      <LoadingButton
                        disabled={pendingCloseoutAction === "submit"}
                        isLoading={pendingCloseoutAction === "submit"}
                        onClick={() => void handleSubmitCloseout()}
                        type="button"
                        variant="workflow"
                      >
                        Submit closeout
                      </LoadingButton>
                    </div>
                  )}

                  {closeoutErrorMessage ? (
                    <p className="text-sm text-destructive" role="alert">
                      {closeoutErrorMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div
                className={
                  hasPendingCloseoutApproval
                    ? ""
                    : "border-t border-border/70 pt-6"
                }
              >
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
                    disabled={isRecordingDeposit}
                    isLoading={isRecordingDeposit}
                    onClick={() => void handleRecordDeposit()}
                    type="button"
                    variant={"workflow"}
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
    canAccessProtectedSurface,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "store_day" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
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
  const submitRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.submitRegisterSessionCloseout,
  );
  const reviewRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.reviewRegisterSessionCloseout,
  );
  const reopenRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.reopenRegisterSessionCloseout,
  );
  const authenticateStaffCredential = useMutation(
    api.operations.staffCredentials.authenticateStaffCredential,
  );
  const authenticateStaffCredentialForApproval = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );
  const correctOpeningFloatReference = (
    api as unknown as {
      cashControls?: {
        closeouts?: {
          correctRegisterSessionOpeningFloat?: unknown;
        };
      };
    }
  ).cashControls?.closeouts?.correctRegisterSessionOpeningFloat;
  const correctOpeningFloatMutation = useMutation(
    (correctOpeningFloatReference ??
      api.operations.staffCredentials.authenticateStaffCredential) as never,
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

  async function onSubmitCloseout(args: RegisterCloseoutSubmitArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to submit a register closeout",
      });
    }

    const result = await runCommand(() =>
      submitRegisterSessionCloseout({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        actorUserId: user._id,
        approvalProofId: args.approvalProofId as
          | Id<"approvalProof">
          | undefined,
        closeoutModificationApprovalProofId:
          args.closeoutModificationApprovalProofId as
            | Id<"approvalProof">
            | undefined,
        countedCash: args.countedCash,
        notes: args.notes,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        requestedByStaffProfileId: args.requestedByStaffProfileId as
          | Id<"staffProfile">
          | undefined,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success("Register session closed");
    }

    return result;
  }

  async function onAuthenticateStaff(args: {
    allowedRoles: StaffAuthenticationRole[];
    pinHash: string;
    username: string;
  }) {
    if (!activeStore?._id) {
      return userError({
        code: "authentication_failed",
        message: "Select a store before confirming staff credentials",
      });
    }

    return runCommand(() =>
      authenticateStaffCredential({
        allowedRoles: args.allowedRoles,
        pinHash: args.pinHash,
        storeId: activeStore._id,
        username: args.username,
      }),
    );
  }

  async function onAuthenticateCloseoutReviewApproval(args: {
    pinHash: string;
    reason?: string;
    registerSessionId: string;
    requestedByStaffProfileId?: Id<"staffProfile">;
    username: string;
  }): Promise<CloseoutApprovalAuthenticationCommandResult> {
    if (!activeStore?._id) {
      return userError({
        code: "authentication_failed",
        message: "Select a store before confirming manager approval",
      });
    }

    const session = registerSessionSnapshot?.registerSession;
    const result = await runCommand(
      () =>
        authenticateStaffCredentialForApproval({
          actionKey: "cash_controls.register_session.review_variance",
          pinHash: args.pinHash,
          reason: args.reason,
          requiredRole: "manager",
          requestedByStaffProfileId: args.requestedByStaffProfileId,
          storeId: activeStore._id,
          subject: {
            id: args.registerSessionId,
            label: session?.registerNumber ?? undefined,
            type: "register_session",
          },
          username: args.username,
        }) as Promise<CommandResult<CommandApprovalProofResult>>,
    );

    if (result.kind !== "ok") {
      return result;
    }

    return {
      kind: "ok",
      data: {
        approvalProofId: result.data.approvalProofId,
        staffProfile: {},
        staffProfileId: result.data.approvedByStaffProfileId,
      },
    };
  }

  async function onAuthenticateForApproval(
    args: Parameters<
      NonNullable<RegisterSessionViewContentProps["onAuthenticateForApproval"]>
    >[0],
  ) {
    if (!activeStore?._id) {
      return userError({
        code: "authentication_failed",
        message: "Select a store before confirming manager approval",
      });
    }

    return runCommand(
      () =>
        authenticateStaffCredentialForApproval({
          actionKey: args.actionKey,
          pinHash: args.pinHash,
          reason: args.reason,
          requiredRole: args.requiredRole,
          requestedByStaffProfileId: args.requestedByStaffProfileId,
          storeId: activeStore._id,
          subject: args.subject,
          username: args.username,
        }) as Promise<CommandResult<CommandApprovalProofResult>>,
    );
  }

  async function onReviewCloseout(args: RegisterCloseoutReviewArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to review a register closeout",
      });
    }

    const result = await runCommand(() =>
      reviewRegisterSessionCloseout({
        approvalProofId: args.approvalProofId as Id<"approvalProof">,
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

  async function onReopenCloseout(args: {
    actorStaffProfileId: string;
    approvalProofId: string;
    registerSessionId: string;
    requestedByStaffProfileId?: string;
  }) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to reopen a register closeout",
      });
    }

    const result = await runCommand(() =>
      reopenRegisterSessionCloseout({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        actorUserId: user._id,
        approvalProofId: args.approvalProofId as Id<"approvalProof">,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        requestedByStaffProfileId: args.requestedByStaffProfileId as
          | Id<"staffProfile">
          | undefined,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success("Register closeout reopened");
    }

    return result;
  }

  async function onCorrectOpeningFloat(args: CorrectOpeningFloatArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to correct opening float",
      });
    }

    if (!correctOpeningFloatReference) {
      return userError({
        code: "unavailable",
        message:
          "Opening float correction is not available yet. Try again after the register tools refresh.",
      });
    }

    const result = (await runCommand(() =>
      (
        correctOpeningFloatMutation as unknown as (
          args: Record<string, unknown>,
        ) => Promise<
          | CommandResult<{ action?: "corrected" | "duplicate" }>
          | { kind: "approval_required"; approval: ApprovalRequirement }
        >
      )({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        actorUserId: user._id,
        approvalProofId: args.approvalProofId as
          | Id<"approvalProof">
          | undefined,
        correctedOpeningFloat: args.correctedOpeningFloat,
        reason: args.reason,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        storeId: activeStore._id,
      }),
    )) as CorrectOpeningFloatCommandResult;

    if (result.kind === "ok") {
      toast.success("Opening float corrected");
    }

    return result;
  }

  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before this register session can load protected cash-controls data" />
    );
  }

  if (!canAccessSurface) {
    return <NoPermissionView />;
  }

  if (!activeStore) {
    return null;
  }

  return (
    <RegisterSessionViewContent
      actorUserId={user?._id}
      currency={activeStore.currency || "USD"}
      isLoading={registerSessionSnapshot === undefined}
      onAuthenticateForApproval={onAuthenticateForApproval}
      onAuthenticateCloseoutReviewApproval={
        onAuthenticateCloseoutReviewApproval
      }
      onAuthenticateStaff={onAuthenticateStaff}
      onCorrectOpeningFloat={onCorrectOpeningFloat}
      onRecordDeposit={onRecordDeposit}
      onReopenCloseout={onReopenCloseout}
      onReviewCloseout={onReviewCloseout}
      onSubmitCloseout={onSubmitCloseout}
      orgUrlSlug={params?.orgUrlSlug}
      registerSessionSnapshot={registerSessionSnapshot ?? null}
      storeId={activeStore._id}
      storeUrlSlug={params?.storeUrlSlug}
    />
  );
}
