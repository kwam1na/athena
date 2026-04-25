import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  ok,
  userError,
} from "~/shared/commandResult";

import { RegisterSessionViewContent } from "./RegisterSessionView";

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

vi.mock("../common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
    trailingContent,
  }: {
    leadingContent: React.ReactNode;
    trailingContent?: React.ReactNode;
  }) => (
    <div>
      <div>{leadingContent}</div>
      <div>{trailingContent}</div>
    </div>
  ),
}));

const baseSnapshot = {
  closeoutReview: null as
    | {
        hasVariance: boolean;
        reason?: string | null;
        requiresApproval: boolean;
        variance: number;
      }
    | null,
  deposits: [] as Array<{
    _id: string;
    amount: number;
    notes?: string | null;
    recordedAt: number;
    recordedByStaffName?: string | null;
    reference?: string | null;
    registerSessionId?: string | null;
  }>,
  registerSession: {
    _id: "session-1",
    countedCash: 17100,
    expectedCash: 17600,
    netExpectedCash: 17600,
    openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
    openedByStaffName: "Ama Mensah",
    openingFloat: 5000,
    pendingApprovalRequest: null,
    registerNumber: "Register 3",
    status: "closing",
    totalDeposited: 2400,
    variance: -500,
    workflowTraceId: "register_session:reg-3",
  },
};

describe("RegisterSessionViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  it("shows a loading state while the register session is loading", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading
        onRecordDeposit={vi.fn()}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    expect(screen.getByText("Loading register session...")).toBeInTheDocument();
  });

  it("renders the register summary, closeout review, and deposits", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        registerSessionSnapshot={{
          closeoutReview: {
            hasVariance: true,
            reason: "Variance review required.",
            requiresApproval: true,
            variance: -500,
          },
          deposits: [
            {
              _id: "deposit-1",
              amount: 2400,
              notes: "Evening drop",
              recordedAt: new Date("2026-04-21T18:10:00.000Z").getTime(),
              recordedByStaffName: "Kojo Mensimah",
              reference: "BANK-339",
              registerSessionId: "session-1",
            },
          ],
          registerSession: baseSnapshot.registerSession,
        }}
        storeId="store-1"
      />,
    );

    expect(screen.getAllByText("Register 3").length).toBeGreaterThan(0);
    expect(screen.getByText("Variance review required.")).toBeInTheDocument();
    expect(screen.getByText("Record cash deposit")).toBeInTheDocument();
    expect(screen.getByText("BANK-339")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View trace" })).toBeInTheDocument();
  });

  it("submits a deposit with store, session, and actor context", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);

    const user = userEvent.setup();
    const onRecordDeposit = vi.fn().mockResolvedValue(
      ok({
        action: "recorded",
      }),
    );

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={onRecordDeposit}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.type(screen.getByLabelText("Deposit amount"), "2500");
    await user.type(screen.getByLabelText("Deposit reference"), "BANK-440");
    await user.type(screen.getByLabelText("Deposit notes"), "Safe drop before final closeout.");
    await user.click(screen.getByRole("button", { name: "Record deposit" }));

    await waitFor(() =>
      expect(onRecordDeposit).toHaveBeenCalledWith({
        actorStaffProfileId: undefined,
        actorUserId: "user-1",
        amount: 2500,
        notes: "Safe drop before final closeout.",
        reference: "BANK-440",
        registerSessionId: "session-1",
        storeId: "store-1",
        submissionKey: "register-session-deposit-session-1-rs",
      }),
    );
  });

  it("shows safe inline errors for deposit user_error results", async () => {
    const user = userEvent.setup();
    const onRecordDeposit = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message: "Register session is not accepting new deposits.",
      }),
    );

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={onRecordDeposit}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.type(screen.getByLabelText("Deposit amount"), "2500");
    await user.click(screen.getByRole("button", { name: "Record deposit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Register session is not accepting new deposits.",
    );
    expect(screen.getByLabelText("Deposit amount")).toHaveValue(2500);
  });

  it("shows generic inline errors for unexpected deposit failures", async () => {
    const user = userEvent.setup();
    const onRecordDeposit = vi.fn().mockResolvedValue({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      },
    });

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={onRecordDeposit}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.type(screen.getByLabelText("Deposit amount"), "2500");
    await user.click(screen.getByRole("button", { name: "Record deposit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      GENERIC_UNEXPECTED_ERROR_MESSAGE,
    );
  });
});
