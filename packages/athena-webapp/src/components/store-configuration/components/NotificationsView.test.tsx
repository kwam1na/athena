import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsView } from "./NotificationsView";
import {
  NOTIFICATION_CATEGORY_COPY,
  NOTIFICATION_CATEGORY_KEYS,
  SUBSCRIPTION_CATEGORY_RECIPIENT_CAP,
  type NotificationCategoryKey,
  type NotificationSubscriptionRow,
  type RecipientCandidate,
} from "../hooks/useNotificationSubscriptions";

const mocks = vi.hoisted(() => ({
  addRecipient: vi.fn(),
  removeRecipient: vi.fn(),
  setRecipientEnabled: vi.fn(),
  useNotificationSubscriptions: vi.fn(),
}));

vi.mock("../hooks/useNotificationSubscriptions", async () => {
  const actual = await vi.importActual<
    typeof import("../hooks/useNotificationSubscriptions")
  >("../hooks/useNotificationSubscriptions");

  return {
    ...actual,
    useNotificationSubscriptions: mocks.useNotificationSubscriptions,
  };
});

vi.mock("../../View", () => ({
  default: ({
    children,
    header,
  }: {
    children: React.ReactNode;
    header?: React.ReactNode;
  }) => (
    <section data-testid="notifications-view">
      <div>{header}</div>
      {children}
    </section>
  ),
}));

function row(
  overrides: Partial<Omit<NotificationSubscriptionRow, "subscriptionId">> & {
    subscriptionId: string;
  },
): NotificationSubscriptionRow {
  return {
    category: "approvals",
    channel: "email",
    enabled: true,
    recipientEmail: "ops@example.com",
    recipientName: "Ops Desk",
    updatedAt: 1,
    ...overrides,
  } as unknown as NotificationSubscriptionRow;
}

function buildState({
  isLoading = false,
  isComplete = true,
  loadedRecipientCount = 0,
  candidates = [] as RecipientCandidate[],
  rowsByCategory = {} as Partial<
    Record<NotificationCategoryKey, NotificationSubscriptionRow[]>
  >,
}) {
  return {
    addRecipient: mocks.addRecipient,
    candidates,
    categories: NOTIFICATION_CATEGORY_KEYS.map((category) => {
      const subscriptions = rowsByCategory[category] ?? [];
      const state = isLoading
        ? ("loading" as const)
        : subscriptions.length === 0
          ? ("fallback" as const)
          : subscriptions.some((subscription) => subscription.enabled)
            ? ("active" as const)
            : ("silenced" as const);

      return {
        category,
        description: NOTIFICATION_CATEGORY_COPY[category].description,
        isAtCap: subscriptions.length >= SUBSCRIPTION_CATEGORY_RECIPIENT_CAP,
        label: NOTIFICATION_CATEGORY_COPY[category].label,
        state,
        subscriptions,
      };
    }),
    isComplete,
    isLoading,
    isMutating: false,
    loadedRecipientCount,
    removeRecipient: mocks.removeRecipient,
    setRecipientEnabled: mocks.setRecipientEnabled,
  };
}

const FALLBACK_COPY =
  "Sent to platform defaults — adding a recipient takes over this category.";
const SILENCED_COPY =
  "All recipients disabled — nothing is sent; the platform-defaults fallback does not apply.";

describe("NotificationsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addRecipient.mockResolvedValue(true);
    mocks.removeRecipient.mockResolvedValue(true);
    mocks.setRecipientEnabled.mockResolvedValue(true);
    mocks.useNotificationSubscriptions.mockReturnValue(buildState({}));
  });

  it("renders one card per notification category with its recipients", () => {
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        loadedRecipientCount: 2,
        rowsByCategory: {
          approvals: [
            row({ subscriptionId: "sub-1" }),
            row({
              subscriptionId: "sub-2",
              enabled: false,
              recipientEmail: "eod@example.com",
              recipientName: "Eod Desk",
            }),
          ],
        },
      }),
    );

    render(<NotificationsView />);

    expect(screen.getAllByTestId(/^notification-category-/)).toHaveLength(4);
    for (const category of NOTIFICATION_CATEGORY_KEYS) {
      expect(
        screen.getByTestId(`notification-category-${category}`),
      ).toBeInTheDocument();
    }

    const approvals = screen.getByTestId("notification-category-approvals");
    expect(within(approvals).getByText("Ops Desk")).toBeInTheDocument();
    expect(within(approvals).getByText("ops@example.com")).toBeInTheDocument();
    expect(
      within(approvals).getByLabelText("Send Approvals to ops@example.com"),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(approvals).getByLabelText("Send Approvals to eod@example.com"),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("states that recipients apply to every store in the organization", () => {
    render(<NotificationsView />);

    expect(
      screen.getByText(/apply to every store in this organization/i),
    ).toBeInTheDocument();
  });

  it("shows the fallback, silenced, and active states distinctly", () => {
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        rowsByCategory: {
          approvals: [row({ subscriptionId: "sub-1" })],
          eod: [
            row({
              subscriptionId: "sub-2",
              category: "eod",
              enabled: false,
            }),
          ],
        },
      }),
    );

    render(<NotificationsView />);

    const approvals = screen.getByTestId("notification-category-approvals");
    expect(within(approvals).queryByText(FALLBACK_COPY)).not.toBeInTheDocument();
    expect(within(approvals).queryByText(SILENCED_COPY)).not.toBeInTheDocument();

    const eod = screen.getByTestId("notification-category-eod");
    expect(within(eod).getByText(SILENCED_COPY)).toBeInTheDocument();
    expect(within(eod).queryByText(FALLBACK_COPY)).not.toBeInTheDocument();

    const cashControls = screen.getByTestId(
      "notification-category-cash_controls",
    );
    expect(within(cashControls).getByText(FALLBACK_COPY)).toBeInTheDocument();
    expect(within(cashControls).queryByText(SILENCED_COPY)).not.toBeInTheDocument();
  });

  it("shows skeletons while the list query is unresolved and never the zero-row fallback", () => {
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({ isLoading: true }),
    );

    render(<NotificationsView />);

    expect(screen.getAllByTestId("notification-category-skeleton")).toHaveLength(
      4,
    );
    expect(screen.queryByText(FALLBACK_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(SILENCED_COPY)).not.toBeInTheDocument();
  });

  it("shows the truncated-list indicator when the query reports an incomplete read", () => {
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        isComplete: false,
        loadedRecipientCount: 400,
        rowsByCategory: { approvals: [row({ subscriptionId: "sub-1" })] },
      }),
    );

    render(<NotificationsView />);

    expect(
      screen.getByText("400+ recipients — list truncated"),
    ).toBeInTheDocument();
  });

  it("disables already-subscribed members in the picker with an explanatory hint", async () => {
    const user = userEvent.setup();
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        candidates: [
          {
            userId: "u-1" as never,
            displayName: "Ama Boateng",
            email: "Ops@Example.com",
            role: "full_admin",
            operationalRoles: ["manager"],
          },
          {
            userId: "u-2" as never,
            displayName: "Yaw Mensah",
            email: "yaw@example.com",
            role: "pos_only",
            operationalRoles: ["cashier"],
          },
        ],
        rowsByCategory: { approvals: [row({ subscriptionId: "sub-1" })] },
      }),
    );

    render(<NotificationsView />);

    const approvals = screen.getByTestId("notification-category-approvals");
    await user.click(within(approvals).getByRole("button", { name: /add recipient/i }));

    const already = within(approvals).getByRole("option", {
      name: /Ama Boateng/,
    });
    expect(already).toHaveAttribute("aria-disabled", "true");
    expect(within(already).getByText("Already added")).toBeInTheDocument();

    const available = within(approvals).getByRole("option", {
      name: /Yaw Mensah/,
    });
    expect(available).toHaveAttribute("aria-disabled", "false");
  });

  it("offers a free-form recipient row when the input matches no member", async () => {
    const user = userEvent.setup();
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        candidates: [
          {
            userId: "u-2" as never,
            displayName: "Yaw Mensah",
            email: "yaw@example.com",
            role: "pos_only",
            operationalRoles: ["cashier"],
          },
        ],
      }),
    );

    render(<NotificationsView />);

    const approvals = screen.getByTestId("notification-category-approvals");
    await user.click(
      within(approvals).getByRole("button", { name: /add recipient/i }),
    );
    await user.type(
      within(approvals).getByRole("combobox"),
      "alerts@example.com",
    );

    await user.click(
      within(approvals).getByRole("option", { name: /use this email/i }),
    );

    expect(mocks.addRecipient).toHaveBeenCalledWith({
      category: "approvals",
      email: "alerts@example.com",
    });
  });

  it("blocks the add control at the per-category cap and states the limit inline", () => {
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        rowsByCategory: {
          approvals: Array.from(
            { length: SUBSCRIPTION_CATEGORY_RECIPIENT_CAP },
            (_, index) =>
              row({
                subscriptionId: `sub-${index}`,
                recipientEmail: `ops${index}@example.com`,
              }),
          ),
        },
      }),
    );

    render(<NotificationsView />);

    const approvals = screen.getByTestId("notification-category-approvals");
    expect(
      within(approvals).getByRole("button", { name: /add recipient/i }),
    ).toBeDisabled();
    expect(
      within(approvals).getByText(
        `Category limit reached — ${SUBSCRIPTION_CATEGORY_RECIPIENT_CAP} recipients. Remove one before adding another.`,
      ),
    ).toBeInTheDocument();
  });

  it("warns that removing the last recipient re-arms the platform-defaults broadcast", async () => {
    const user = userEvent.setup();
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        rowsByCategory: { approvals: [row({ subscriptionId: "sub-1" })] },
      }),
    );

    render(<NotificationsView />);

    const approvals = screen.getByTestId("notification-category-approvals");
    await user.click(
      within(approvals).getByLabelText("Remove ops@example.com from Approvals"),
    );

    expect(
      await screen.findByText(
        /Approvals returns to platform defaults, and Athena broadcasts these alerts there again/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/nothing is sent for Approvals/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove recipient" }));

    expect(mocks.removeRecipient).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
    });
  });

  it("warns that disabling the last enabled recipient silences the category", async () => {
    const user = userEvent.setup();
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        rowsByCategory: {
          approvals: [
            row({ subscriptionId: "sub-1" }),
            row({
              subscriptionId: "sub-2",
              enabled: false,
              recipientEmail: "eod@example.com",
            }),
          ],
        },
      }),
    );

    render(<NotificationsView />);

    const approvals = screen.getByTestId("notification-category-approvals");
    await user.click(
      within(approvals).getByLabelText("Send Approvals to ops@example.com"),
    );

    expect(
      await screen.findByText(
        /nothing is sent for Approvals, and the platform-defaults fallback does not apply/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/returns to platform defaults/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Disable recipient" }));

    expect(mocks.setRecipientEnabled).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      enabled: false,
    });
  });

  it("disables a recipient without a confirm when other enabled recipients remain", async () => {
    const user = userEvent.setup();
    mocks.useNotificationSubscriptions.mockReturnValue(
      buildState({
        rowsByCategory: {
          approvals: [
            row({ subscriptionId: "sub-1" }),
            row({
              subscriptionId: "sub-2",
              recipientEmail: "eod@example.com",
            }),
          ],
        },
      }),
    );

    render(<NotificationsView />);

    const approvals = screen.getByTestId("notification-category-approvals");
    await user.click(
      within(approvals).getByLabelText("Send Approvals to ops@example.com"),
    );

    expect(mocks.setRecipientEnabled).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      enabled: false,
    });
    expect(
      screen.queryByRole("button", { name: "Disable recipient" }),
    ).not.toBeInTheDocument();
  });
});
