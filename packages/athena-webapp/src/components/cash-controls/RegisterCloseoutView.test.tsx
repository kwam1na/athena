import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  ok,
  userError,
} from "~/shared/commandResult";
import { RegisterCloseoutViewContent } from "./RegisterCloseoutView";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    to?: string;
  }) => (
    <a href={to ?? "#"} {...props}>
      {children}
    </a>
  ),
}));

const baseProps = {
  currency: "USD",
  isLoading: false,
  onReviewCloseout: vi.fn().mockResolvedValue(
    ok({
      action: "approved",
    }),
  ),
  onSubmitCloseout: vi.fn().mockResolvedValue(
    ok({
      action: "closed",
    }),
  ),
  registerSessions: [] as {
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
  }[],
};

describe("RegisterCloseoutViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
  });

  it("shows a loading state while closeouts are loading", () => {
    render(<RegisterCloseoutViewContent {...baseProps} isLoading />);

    expect(screen.getByText("Loading register closeouts...")).toBeInTheDocument();
  });

  it("renders an empty state when no register sessions need closeout", () => {
    render(<RegisterCloseoutViewContent {...baseProps} />);

    expect(screen.getByText("No active register closeouts")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open, active, and closing register sessions will appear here for manager closeout.",
      ),
    ).toBeInTheDocument();
  });

  it("renders closeout forms and pending variance review actions", () => {
    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        registerSessions={[
          {
            _id: "session-open",
            approvalRequest: null,
            closeoutReview: null,
            expectedCash: 120,
            openedAt: new Date("2026-04-21T10:00:00.000Z").getTime(),
            openedByStaffName: "Ama Mensah",
            registerNumber: "Register 2",
            status: "active",
            workflowTraceId: "register_session:reg-2",
          },
          {
            _id: "session-review",
            approvalRequest: {
              _id: "approval-1",
              createdAt: new Date("2026-04-21T12:00:00.000Z").getTime(),
              reason: "Variance of -20 exceeded the closeout approval threshold.",
              requestedByStaffName: "Mary Aidoo",
              status: "pending",
            },
            closeoutReview: {
              hasVariance: true,
              reason: "Variance of -20 exceeded the closeout approval threshold.",
              requiresApproval: true,
              variance: -20,
            },
            countedCash: 180,
            expectedCash: 200,
            notes: "Drawer recounted once.",
            openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
            openedByStaffName: "Adjoa Tetteh",
            registerNumber: "Register 4",
            status: "closing",
            workflowTraceId: "register_session:reg-4",
          },
        ]}
      />,
    );

    expect(screen.getByText("Register closeouts")).toBeInTheDocument();
    expect(screen.getByText("Register 2")).toBeInTheDocument();
    expect(screen.getByText("Register 4")).toBeInTheDocument();
    expect(screen.getByLabelText("Counted cash for Register 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit closeout" })).toBeInTheDocument();
    expect(screen.getByText("Variance review pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve variance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject variance" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View trace" }).length).toBeGreaterThan(0);
    expect(
      screen.getByText("Variance of -20 exceeded the closeout approval threshold."),
    ).toBeInTheDocument();
  });

  it("submits display counted cash as minor units with notes for a register session", async () => {
    const user = userEvent.setup();
    const onSubmitCloseout = vi.fn().mockResolvedValue(
      ok({
        action: "closed",
      }),
    );

    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        onSubmitCloseout={onSubmitCloseout}
        registerSessions={[
          {
            _id: "session-open",
            approvalRequest: null,
            closeoutReview: null,
            expectedCash: 120,
            openedAt: new Date("2026-04-21T10:00:00.000Z").getTime(),
            openedByStaffName: "Ama Mensah",
            registerNumber: "Register 2",
            status: "open",
          },
        ]}
      />,
    );

    await user.type(screen.getByLabelText("Counted cash for Register 2"), "145.00");
    await user.type(screen.getByLabelText("Closeout notes for Register 2"), "Drawer balanced at shift end.");
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));

    await waitFor(() => expect(onSubmitCloseout).toHaveBeenCalledTimes(1));
    expect(onSubmitCloseout).toHaveBeenCalledWith({
      countedCash: 14500,
      notes: "Drawer balanced at shift end.",
      registerSessionId: "session-open",
    });
  });

  it("shows stored counted cash in display units inside the editable closeout field", () => {
    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        registerSessions={[
          {
            _id: "session-open",
            approvalRequest: null,
            closeoutReview: null,
            countedCash: 14500,
            expectedCash: 12000,
            openedAt: new Date("2026-04-21T10:00:00.000Z").getTime(),
            openedByStaffName: "Ama Mensah",
            registerNumber: "Register 2",
            status: "open",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Counted cash for Register 2")).toHaveValue(145);
  });

  it("does not submit invalid display counted cash and shows the closeout error", async () => {
    const user = userEvent.setup();
    const onSubmitCloseout = vi.fn().mockResolvedValue(
      ok({
        action: "closed",
      }),
    );

    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        onSubmitCloseout={onSubmitCloseout}
        registerSessions={[
          {
            _id: "session-open",
            approvalRequest: null,
            closeoutReview: null,
            expectedCash: 12000,
            openedAt: new Date("2026-04-21T10:00:00.000Z").getTime(),
            openedByStaffName: "Ama Mensah",
            registerNumber: "Register 2",
            status: "open",
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Counted cash for Register 2"), {
      target: { value: "not an amount" },
    });
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));

    expect(onSubmitCloseout).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the counted cash before submitting the closeout.",
    );
  });

  it("does not submit negative display counted cash and shows the closeout error", async () => {
    const user = userEvent.setup();
    const onSubmitCloseout = vi.fn().mockResolvedValue(
      ok({
        action: "closed",
      }),
    );

    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        onSubmitCloseout={onSubmitCloseout}
        registerSessions={[
          {
            _id: "session-open",
            approvalRequest: null,
            closeoutReview: null,
            expectedCash: 12000,
            openedAt: new Date("2026-04-21T10:00:00.000Z").getTime(),
            openedByStaffName: "Ama Mensah",
            registerNumber: "Register 2",
            status: "open",
          },
        ]}
      />,
    );

    await user.type(screen.getByLabelText("Counted cash for Register 2"), "-1");
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));

    expect(onSubmitCloseout).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the counted cash before submitting the closeout.",
    );
  });

  it("sends manager approval decisions with optional notes", async () => {
    const user = userEvent.setup();
    const onReviewCloseout = vi.fn().mockResolvedValue(
      ok({
        action: "approved",
      }),
    );

    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        onReviewCloseout={onReviewCloseout}
        registerSessions={[
          {
            _id: "session-review",
            approvalRequest: {
              _id: "approval-1",
              createdAt: new Date("2026-04-21T12:00:00.000Z").getTime(),
              reason: "Variance of -20 exceeded the closeout approval threshold.",
              requestedByStaffName: "Mary Aidoo",
              status: "pending",
            },
            closeoutReview: {
              hasVariance: true,
              reason: "Variance of -20 exceeded the closeout approval threshold.",
              requiresApproval: true,
              variance: -20,
            },
            countedCash: 180,
            expectedCash: 200,
            openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
            registerNumber: "Register 4",
            status: "closing",
          },
        ]}
      />,
    );

    await user.type(
      screen.getByLabelText("Manager notes for Register 4"),
      "Variance reviewed against till count.",
    );
    await user.click(screen.getByRole("button", { name: "Approve variance" }));

    await waitFor(() => expect(onReviewCloseout).toHaveBeenCalledTimes(1));
    expect(onReviewCloseout).toHaveBeenCalledWith({
      decision: "approved",
      decisionNotes: "Variance reviewed against till count.",
      registerSessionId: "session-review",
    });
  });

  it("shows safe inline copy when closeout submission returns a user error", async () => {
    const user = userEvent.setup();
    const onSubmitCloseout = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message: "Register session is already closed.",
      }),
    );

    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        onSubmitCloseout={onSubmitCloseout}
        registerSessions={[
          {
            _id: "session-open",
            approvalRequest: null,
            closeoutReview: null,
            expectedCash: 120,
            openedAt: new Date("2026-04-21T10:00:00.000Z").getTime(),
            openedByStaffName: "Ama Mensah",
            registerNumber: "Register 2",
            status: "open",
          },
        ]}
      />
    );

    await user.type(screen.getByLabelText("Counted cash for Register 2"), "145");
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Register session is already closed.",
    );
  });

  it("shows generic inline copy when closeout review fails unexpectedly", async () => {
    const user = userEvent.setup();
    const onReviewCloseout = vi.fn().mockResolvedValue({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      },
    });

    render(
      <RegisterCloseoutViewContent
        {...baseProps}
        onReviewCloseout={onReviewCloseout}
        registerSessions={[
          {
            _id: "session-review",
            approvalRequest: {
              _id: "approval-1",
              createdAt: new Date("2026-04-21T12:00:00.000Z").getTime(),
              reason: "Variance of -20 exceeded the closeout approval threshold.",
              requestedByStaffName: "Mary Aidoo",
              status: "pending",
            },
            closeoutReview: {
              hasVariance: true,
              reason: "Variance of -20 exceeded the closeout approval threshold.",
              requiresApproval: true,
              variance: -20,
            },
            countedCash: 180,
            expectedCash: 200,
            openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
            registerNumber: "Register 4",
            status: "closing",
          },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Approve variance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      GENERIC_UNEXPECTED_ERROR_MESSAGE,
    );
  });
});
