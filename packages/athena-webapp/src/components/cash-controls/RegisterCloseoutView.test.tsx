import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterCloseoutViewContent } from "./RegisterCloseoutView";

const baseProps = {
  currency: "USD",
  isLoading: false,
  onReviewCloseout: vi.fn().mockResolvedValue(undefined),
  onSubmitCloseout: vi.fn().mockResolvedValue(undefined),
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
    expect(
      screen.getByText("Variance of -20 exceeded the closeout approval threshold."),
    ).toBeInTheDocument();
  });

  it("submits counted cash and notes for a register session", async () => {
    const user = userEvent.setup();
    const onSubmitCloseout = vi.fn().mockResolvedValue(undefined);

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

    await user.type(screen.getByLabelText("Counted cash for Register 2"), "145");
    await user.type(screen.getByLabelText("Closeout notes for Register 2"), "Drawer balanced at shift end.");
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));

    await waitFor(() => expect(onSubmitCloseout).toHaveBeenCalledTimes(1));
    expect(onSubmitCloseout).toHaveBeenCalledWith({
      countedCash: 145,
      notes: "Drawer balanced at shift end.",
      registerSessionId: "session-open",
    });
  });

  it("sends manager approval decisions with optional notes", async () => {
    const user = userEvent.setup();
    const onReviewCloseout = vi.fn().mockResolvedValue(undefined);

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
});
