import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";

import {
  CommandApprovalDialog,
  type CommandApprovalDialogProps,
} from "./CommandApprovalDialog";

const mocks = vi.hoisted(() => ({
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
  },
}));

vi.mock("@/lib/security/pinHash", () => ({
  hashPin: mocks.hashPin,
}));

vi.mock("@/components/pos/PinInput", () => ({
  PinInput: ({
    disabled,
    onChange,
    onKeyDown,
    value,
  }: {
    disabled: boolean;
    onChange: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent) => void;
    value: string;
  }) => (
    <input
      aria-label="PIN"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  ),
}));

vi.mock("@/components/ui/dialog", () => {
  let onOpenChange: ((open: boolean) => void) | undefined;

  return {
    Dialog: ({
      children,
      onOpenChange: handleOpenChange,
      open,
    }: {
      children: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
      open: boolean;
    }) => {
      onOpenChange = handleOpenChange;
      return open ? <div>{children}</div> : null;
    },
    DialogContent: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => (
      <div className={className} data-testid="dialog-content">
        {children}
        <button type="button" onClick={() => onOpenChange?.(false)}>
          Close
        </button>
      </div>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <p>{children}</p>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
  };
});

const storeId = "store-1" as Id<"store">;
const staffProfileId = "staff-1" as Id<"staffProfile">;
const approvalProofId = "proof-1" as Id<"approvalProof">;

const inlineApproval = {
  action: {
    key: "transaction.payment_method_correction",
    label: "Update payment method",
  },
  copy: {
    title: "Manager approval required",
    message: "Payment method changes need manager approval.",
    primaryActionLabel: "Approve and continue",
  },
  reason: "Payment method changes need manager approval.",
  requiredRole: "manager",
  resolutionModes: [
    {
      kind: "inline_manager_proof",
    },
  ],
  subject: {
    id: "transaction-1",
    label: "Receipt #1001",
    type: "transaction",
  },
} satisfies CommandApprovalDialogProps["approval"];

function renderDialog(
  props: Partial<CommandApprovalDialogProps> = {},
): Required<
  Pick<
    CommandApprovalDialogProps,
    "onApproved" | "onAuthenticateForApproval" | "onDismiss"
  >
> & {
  user: ReturnType<typeof userEvent.setup>;
} {
  const onApproved = props.onApproved ?? vi.fn();
  const onAuthenticateForApproval =
    props.onAuthenticateForApproval ??
    vi.fn().mockResolvedValue(
      ok({
        approvalProofId,
        approvedByStaffProfileId: staffProfileId,
        expiresAt: 1234,
      }),
    );
  const onDismiss = props.onDismiss ?? vi.fn();

  render(
    <CommandApprovalDialog
      approval={props.approval ?? inlineApproval}
      onApproved={onApproved}
      onAuthenticateForApproval={onAuthenticateForApproval}
      onDismiss={onDismiss}
      open={props.open ?? true}
      requestedByStaffProfileId={props.requestedByStaffProfileId}
      storeId={props.storeId ?? storeId}
    />,
  );

  return {
    onApproved,
    onAuthenticateForApproval,
    onDismiss,
    user: userEvent.setup(),
  };
}

async function submitCredentials(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByLabelText(/username/i)).toHaveFocus());
  await user.type(screen.getByLabelText(/username/i), "manager");
  await user.type(screen.getByLabelText(/pin/i), "123456");
}

describe("CommandApprovalDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens inline manager approval with required role and reason copy", () => {
    renderDialog();

    expect(
      screen.getByRole("heading", { name: "Manager approval required" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dialog-content")).toHaveClass(
      "flex",
      "max-h-[calc(100dvh-2rem)]",
      "overflow-hidden",
    );
    expect(
      screen.getByText(/payment method changes need manager approval/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Receipt #1001")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Enter manager credentials" }),
    ).toBeInTheDocument();
  });

  it("formats closeout variance approval copy as stored currency", () => {
    renderDialog({
      approval: {
        ...inlineApproval,
        action: {
          key: "register.closeout.submit",
          label: "Submit register closeout",
        },
        copy: {
          title: "Manager approval required",
          message:
            "Variance of -20000 exceeded the closeout approval threshold.",
          primaryActionLabel: "Approve closeout",
        },
        reason:
          "Variance of -20000 exceeded the closeout approval threshold.",
        subject: {
          id: "3",
          label: "3",
          type: "register_session",
        },
      },
    });

    expect(
      screen.getByText(
        "Variance of GH₵-200 exceeded the closeout approval threshold",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Variance of -20000 exceeded the closeout approval threshold.",
      ),
    ).not.toBeInTheDocument();
  });

  it("authenticates a manager, creates an approval proof, and returns proof id for retry", async () => {
    const { user, onAuthenticateForApproval, onApproved } = renderDialog();

    await submitCredentials(user);

    await waitFor(() =>
      expect(onAuthenticateForApproval).toHaveBeenCalledWith({
        actionKey: "transaction.payment_method_correction",
        pinHash: "hashed:123456",
        reason: "Payment method changes need manager approval.",
        requiredRole: "manager",
        requestedByStaffProfileId: undefined,
        storeId,
        subject: inlineApproval.subject,
        username: "manager",
      }),
    );
    expect(onApproved).toHaveBeenCalledWith({
      approval: inlineApproval,
      approvalProofId,
      approvedByStaffProfileId: staffProfileId,
      expiresAt: 1234,
    });
  });

  it("dismisses without reporting an approval proof", async () => {
    const { user, onApproved, onAuthenticateForApproval, onDismiss } =
      renderDialog();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onDismiss).toHaveBeenCalled();
    expect(onAuthenticateForApproval).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it("preserves the approval requirement and clears the PIN after invalid credentials", async () => {
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      userError({
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      }),
    );
    const { user, onApproved } = renderDialog({
      onAuthenticateForApproval,
    });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Sign-in details not recognized. Enter the username and PIN again.",
      ),
    );
    await waitFor(() => expect(screen.getByLabelText(/pin/i)).toHaveValue(""));
    expect(
      screen.getByRole("heading", { name: "Manager approval required" }),
    ).toBeInTheDocument();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it("shows guided copy for async-only approvals without manager authentication", async () => {
    const asyncApproval = {
      ...inlineApproval,
      copy: {
        title: "Manager review required",
        message: "Manager review is required before this closeout can finish.",
      },
      resolutionModes: [
        {
          approvalRequestId: "approval-1",
          kind: "async_request",
          requestType: "register_closeout_variance",
        },
      ],
    } satisfies CommandApprovalDialogProps["approval"];
    const { user, onAuthenticateForApproval, onDismiss } = renderDialog({
      approval: asyncApproval,
    });

    expect(
      screen.getByRole("heading", { name: "Manager review required" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Manager review is required before this closeout can finish.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/approval request approval-1/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Got it" }));

    expect(onDismiss).toHaveBeenCalled();
    expect(onAuthenticateForApproval).not.toHaveBeenCalled();
  });

  it("shows guided copy for unsupported approvals without manager authentication", async () => {
    const unsupportedApproval = {
      ...inlineApproval,
      copy: {
        title: "Approval unavailable",
        message:
          "This correction cannot be approved here. Use refund or exchange instead.",
      },
      resolutionModes: [],
    } satisfies CommandApprovalDialogProps["approval"];
    const { user, onAuthenticateForApproval, onDismiss } = renderDialog({
      approval: unsupportedApproval,
    });

    expect(
      screen.getByRole("heading", { name: "Approval unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This correction cannot be approved here. Use refund or exchange instead.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Got it" }));

    expect(onDismiss).toHaveBeenCalled();
    expect(onAuthenticateForApproval).not.toHaveBeenCalled();
  });
});
