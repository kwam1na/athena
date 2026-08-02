import { act, renderHook } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userError } from "~/shared/commandResult";
import {
  NOTIFICATION_CATEGORY_COPY,
  NOTIFICATION_CATEGORY_KEYS,
  SUBSCRIPTION_CATEGORY_RECIPIENT_CAP,
  deriveCategoryState,
  isValidRecipientEmail,
  normalizeRecipientEmailInput,
  sortRecipientCandidates,
  useNotificationSubscriptions,
} from "./useNotificationSubscriptions";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    notifications: {
      subscriptions: {
        addSubscription: "addSubscription",
        listOrganizationMemberRecipientCandidates:
          "listOrganizationMemberRecipientCandidates",
        listSubscriptionsForOrganization: "listSubscriptionsForOrganization",
        removeSubscription: "removeSubscription",
        setSubscriptionEnabled: "setSubscriptionEnabled",
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

let mockActiveOrganization: { _id: string } | undefined;

vi.mock("~/src/hooks/useGetOrganizations", () => ({
  useGetActiveOrganization: () => ({
    activeOrganization: mockActiveOrganization,
  }),
}));

const addSubscription = vi.fn();
const setSubscriptionEnabled = vi.fn();
const removeSubscription = vi.fn();

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseMutation = vi.mocked(useMutation);

const mutationsByReference: Record<string, ReturnType<typeof vi.fn>> = {
  addSubscription,
  setSubscriptionEnabled,
  removeSubscription,
};

let listResult: unknown;
let candidatesResult: unknown;

function emptyList() {
  return {
    complete: true,
    categories: NOTIFICATION_CATEGORY_KEYS.map((category) => ({
      category,
      subscriptions: [],
    })),
  };
}

describe("useNotificationSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addSubscription.mockReset();
    setSubscriptionEnabled.mockReset();
    removeSubscription.mockReset();
    mockActiveOrganization = { _id: "org-1" };
    listResult = emptyList();
    candidatesResult = [];

    mockedUseMutation.mockImplementation(((reference: unknown) =>
      mutationsByReference[reference as string]) as never);
    mockedUseQuery.mockImplementation(((reference: unknown) => {
      if (reference === "listSubscriptionsForOrganization") {
        return listResult;
      }
      if (reference === "listOrganizationMemberRecipientCandidates") {
        return candidatesResult;
      }
      return undefined;
    }) as never);
  });

  it("derives its category list from the notification schema union", () => {
    expect([...NOTIFICATION_CATEGORY_KEYS].sort()).toEqual([
      "approvals",
      "cash_controls",
      "eod",
      "system_health",
    ]);

    for (const category of NOTIFICATION_CATEGORY_KEYS) {
      expect(NOTIFICATION_CATEGORY_COPY[category].label.length).toBeGreaterThan(
        0,
      );
      expect(
        NOTIFICATION_CATEGORY_COPY[category].description.length,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps an unresolved list query in the loading state instead of the zero-row fallback", () => {
    expect(deriveCategoryState({ isLoading: true, subscriptions: [] })).toBe(
      "loading",
    );
    expect(deriveCategoryState({ isLoading: false, subscriptions: [] })).toBe(
      "fallback",
    );
    expect(
      deriveCategoryState({
        isLoading: false,
        subscriptions: [{ enabled: false }, { enabled: false }],
      }),
    ).toBe("silenced");
    expect(
      deriveCategoryState({
        isLoading: false,
        subscriptions: [{ enabled: false }, { enabled: true }],
      }),
    ).toBe("active");
  });

  it("sorts recipient candidates managers-first, then by display name", () => {
    const sorted = sortRecipientCandidates([
      {
        userId: "u-3",
        displayName: "Zoe Adjei",
        email: "zoe@example.com",
        role: "pos_only",
        operationalRoles: ["cashier"],
      },
      {
        userId: "u-2",
        displayName: "Ama Boateng",
        email: "ama@example.com",
        role: "full_admin",
        operationalRoles: ["stylist"],
      },
      {
        userId: "u-1",
        displayName: "Yaw Mensah",
        email: "yaw@example.com",
        role: "pos_only",
        operationalRoles: ["cashier", "manager"],
      },
    ]);

    expect(sorted.map((candidate) => candidate.userId)).toEqual([
      "u-1",
      "u-2",
      "u-3",
    ]);
  });

  it("checks recipient email format client-side", () => {
    expect(normalizeRecipientEmailInput("  Ops@Example.COM ")).toBe(
      "ops@example.com",
    );
    expect(isValidRecipientEmail("ops@example.com")).toBe(true);
    expect(isValidRecipientEmail("ops@example")).toBe(false);
    expect(isValidRecipientEmail("ops example.com")).toBe(false);
    expect(isValidRecipientEmail("")).toBe(false);
  });

  it("reports loading while the list query is unresolved", () => {
    listResult = undefined;

    const { result } = renderHook(() => useNotificationSubscriptions());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.categories).toHaveLength(
      NOTIFICATION_CATEGORY_KEYS.length,
    );
    for (const category of result.current.categories) {
      expect(category.state).toBe("loading");
    }
  });

  it("surfaces truncated lists through the completeness flag", () => {
    listResult = {
      complete: false,
      categories: NOTIFICATION_CATEGORY_KEYS.map((category) => ({
        category,
        subscriptions:
          category === "approvals"
            ? [
                {
                  subscriptionId: "sub-1",
                  category,
                  channel: "email",
                  recipientEmail: "ops@example.com",
                  recipientName: "Ops",
                  enabled: true,
                  updatedAt: 1,
                },
              ]
            : [],
      })),
    };

    const { result } = renderHook(() => useNotificationSubscriptions());

    expect(result.current.isComplete).toBe(false);
    expect(result.current.loadedRecipientCount).toBe(1);
  });

  it("routes command user errors to the shared command toast", async () => {
    addSubscription.mockResolvedValue(
      userError({
        code: "conflict",
        message: "This recipient already receives these notifications.",
      }),
    );

    const { result } = renderHook(() => useNotificationSubscriptions());

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addRecipient({
        category: "approvals",
        email: "ops@example.com",
      });
    });

    expect(added).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "This recipient already receives these notifications.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts success and normalizes the recipient email on add", async () => {
    addSubscription.mockResolvedValue({
      kind: "ok",
      data: { subscriptionId: "sub-1" },
    });

    const { result } = renderHook(() => useNotificationSubscriptions());

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addRecipient({
        category: "approvals",
        email: "  Ops@Example.com ",
        name: " Ops Desk ",
      });
    });

    expect(added).toBe(true);
    expect(addSubscription).toHaveBeenCalledWith({
      organizationId: "org-1",
      category: "approvals",
      channel: "email",
      recipientEmail: "ops@example.com",
      recipientName: "Ops Desk",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Recipient added.",
      expect.objectContaining({ position: "top-right" }),
    );
  });

  it("rejects malformed emails before calling the server", async () => {
    const { result } = renderHook(() => useNotificationSubscriptions());

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addRecipient({
        category: "approvals",
        email: "not-an-email",
      });
    });

    expect(added).toBe(false);
    expect(addSubscription).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Enter a valid email address before adding a recipient.",
    );
  });

  it("toasts distinct copy when a recipient is disabled, enabled, or removed", async () => {
    setSubscriptionEnabled.mockResolvedValue({ kind: "ok", data: null });
    removeSubscription.mockResolvedValue({ kind: "ok", data: null });

    const { result } = renderHook(() => useNotificationSubscriptions());

    await act(async () => {
      await result.current.setRecipientEnabled({
        subscriptionId: "sub-1" as never,
        enabled: false,
      });
    });
    expect(setSubscriptionEnabled).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      enabled: false,
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Recipient disabled.",
      expect.objectContaining({ position: "top-right" }),
    );

    await act(async () => {
      await result.current.setRecipientEnabled({
        subscriptionId: "sub-1" as never,
        enabled: true,
      });
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Recipient enabled.",
      expect.objectContaining({ position: "top-right" }),
    );

    await act(async () => {
      await result.current.removeRecipient({
        subscriptionId: "sub-1" as never,
      });
    });
    expect(removeSubscription).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Recipient removed.",
      expect.objectContaining({ position: "top-right" }),
    );
  });

  it("routes unexpected mutation failures to the shared command toast", async () => {
    removeSubscription.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useNotificationSubscriptions());

    let removed: boolean | undefined;
    await act(async () => {
      removed = await result.current.removeRecipient({
        subscriptionId: "sub-1" as never,
      });
    });

    expect(removed).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("skips both queries when there is no active organization", () => {
    mockActiveOrganization = undefined;

    renderHook(() => useNotificationSubscriptions());

    expect(mockedUseQuery).toHaveBeenCalledWith(
      "listSubscriptionsForOrganization",
      "skip",
    );
    expect(mockedUseQuery).toHaveBeenCalledWith(
      "listOrganizationMemberRecipientCandidates",
      "skip",
    );
  });

  it("mirrors the server per-category recipient cap", () => {
    expect(SUBSCRIPTION_CATEGORY_RECIPIENT_CAP).toBe(200);
  });
});
