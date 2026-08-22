import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { SUBSCRIPTION_RESOLUTION_CAP } from "~/shared/notificationDeliveryPolicy";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "~/shared/notificationCategories";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";
import { useGetActiveOrganization } from "~/src/hooks/useGetOrganizations";

export type NotificationCategoryKey = NotificationCategory;

/**
 * Category list is derived from the shared category contract, never
 * hand-listed: adding a category to shared/notificationCategories.ts surfaces
 * it here (and in the Convex schema validator derived from the same list), and
 * the `Record` copy map below turns a missing label into a type error.
 */
export const NOTIFICATION_CATEGORY_KEYS: readonly NotificationCategoryKey[] =
  NOTIFICATION_CATEGORIES;

export const NOTIFICATION_CATEGORY_COPY: Record<
  NotificationCategoryKey,
  { label: string; description: string }
> = {
  approvals: {
    label: "Approvals",
    description: "Manager approval requests raised from the register.",
  },
  cash_controls: {
    label: "Cash controls",
    description: "Drawer opens, closes, and cash variances that need a look.",
  },
  eod: {
    label: "End of day",
    description: "Daily close summaries once a store finishes trading.",
  },
  system_health: {
    label: "System health",
    description: "Background jobs and integrations that stopped reporting.",
  },
};

/**
 * Re-exported from convex/notifications/deliveryPolicy.ts, which is pure
 * (no Convex server imports) and safe to pull into the browser bundle. The
 * server stays authoritative — this alias only lets the surface stop an
 * operator before a doomed write, under the name existing call sites use.
 */
export const SUBSCRIPTION_CATEGORY_RECIPIENT_CAP = SUBSCRIPTION_RESOLUTION_CAP;

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NotificationSubscriptionRow = {
  subscriptionId: Id<"notificationSubscription">;
  category: NotificationCategoryKey;
  channel: "email" | "in_app";
  recipientEmail: string;
  recipientName?: string;
  storeId?: Id<"store">;
  enabled: boolean;
  updatedAt: number;
};

export type RecipientCandidate = {
  userId: Id<"athenaUser">;
  displayName: string;
  email: string;
  role: "full_admin" | "pos_only";
  operationalRoles: Array<
    "manager" | "front_desk" | "stylist" | "technician" | "cashier"
  >;
};

export type NotificationCategoryState =
  | "loading"
  | "fallback"
  | "silenced"
  | "active";

export type NotificationCategoryCard = {
  category: NotificationCategoryKey;
  label: string;
  description: string;
  state: NotificationCategoryState;
  isAtCap: boolean;
  subscriptions: NotificationSubscriptionRow[];
};

export function normalizeRecipientEmailInput(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidRecipientEmail(email: string): boolean {
  return EMAIL_FORMAT.test(normalizeRecipientEmailInput(email));
}

/**
 * An unresolved query is `loading` and can never fall through to `fallback`:
 * the zero-row fallback banner claims platform defaults are receiving the
 * category, which would be a lie while rows are still loading.
 */
export function deriveCategoryState({
  isLoading,
  subscriptions,
}: {
  isLoading: boolean;
  subscriptions: ReadonlyArray<{ enabled: boolean }>;
}): NotificationCategoryState {
  if (isLoading) return "loading";
  if (subscriptions.length === 0) return "fallback";
  return subscriptions.some((subscription) => subscription.enabled)
    ? "active"
    : "silenced";
}

export function sortRecipientCandidates<
  T extends { displayName: string; operationalRoles: string[] },
>(candidates: readonly T[]): T[] {
  return [...candidates].sort((left, right) => {
    const leftManager = left.operationalRoles.includes("manager") ? 0 : 1;
    const rightManager = right.operationalRoles.includes("manager") ? 0 : 1;
    if (leftManager !== rightManager) return leftManager - rightManager;
    return left.displayName.localeCompare(right.displayName);
  });
}

export function useNotificationSubscriptions() {
  const { activeOrganization } = useGetActiveOrganization();
  const organizationId = activeOrganization?._id as
    | Id<"organization">
    | undefined;

  // Both reads are mounted by this component only — the notifications settings
  // surface is the only route that needs them.
  const list = useQuery(
    api.notifications.subscriptions.listSubscriptionsForOrganization,
    organizationId ? { organizationId } : "skip",
  );
  const candidateRows = useQuery(
    api.notifications.subscriptions.listOrganizationMemberRecipientCandidates,
    organizationId ? { organizationId } : "skip",
  );

  const addSubscription = useMutation(
    api.notifications.subscriptions.addSubscription,
  );
  const setSubscriptionEnabled = useMutation(
    api.notifications.subscriptions.setSubscriptionEnabled,
  );
  const removeSubscription = useMutation(
    api.notifications.subscriptions.removeSubscription,
  );

  const [isMutating, setIsMutating] = useState(false);

  const isLoading = list === undefined;

  const categories = useMemo<NotificationCategoryCard[]>(() => {
    const rowsByCategory = new Map<
      NotificationCategoryKey,
      NotificationSubscriptionRow[]
    >();
    for (const group of list?.categories ?? []) {
      rowsByCategory.set(
        group.category as NotificationCategoryKey,
        group.subscriptions as NotificationSubscriptionRow[],
      );
    }

    return NOTIFICATION_CATEGORY_KEYS.map((category) => {
      const subscriptions = rowsByCategory.get(category) ?? [];
      return {
        category,
        description: NOTIFICATION_CATEGORY_COPY[category].description,
        isAtCap: subscriptions.length >= SUBSCRIPTION_CATEGORY_RECIPIENT_CAP,
        label: NOTIFICATION_CATEGORY_COPY[category].label,
        state: deriveCategoryState({ isLoading, subscriptions }),
        subscriptions,
      };
    });
  }, [isLoading, list]);

  const loadedRecipientCount = useMemo(
    () =>
      categories.reduce(
        (total, category) => total + category.subscriptions.length,
        0,
      ),
    [categories],
  );

  const candidates = useMemo(
    () => sortRecipientCandidates((candidateRows ?? []) as RecipientCandidate[]),
    [candidateRows],
  );

  // No optimistic updates anywhere below: the list query is the single source
  // of truth, and a write only reports its own outcome.
  const addRecipient = async ({
    category,
    email,
    name,
  }: {
    category: NotificationCategoryKey;
    email: string;
    name?: string;
  }): Promise<boolean> => {
    if (!organizationId) {
      toast.error("No active organization. Reload and try again.");
      return false;
    }

    const recipientEmail = normalizeRecipientEmailInput(email);
    if (!isValidRecipientEmail(recipientEmail)) {
      toast.error("Enter a valid email address before adding a recipient.");
      return false;
    }

    setIsMutating(true);
    try {
      const result = await runCommand(() =>
        addSubscription({
          organizationId,
          category,
          channel: "email" as const,
          recipientEmail,
          recipientName: name?.trim() || undefined,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return false;
      }

      toast.success("Recipient added.", { position: "top-right" });
      return true;
    } finally {
      setIsMutating(false);
    }
  };

  const setRecipientEnabled = async ({
    subscriptionId,
    enabled,
  }: {
    subscriptionId: Id<"notificationSubscription">;
    enabled: boolean;
  }): Promise<boolean> => {
    setIsMutating(true);
    try {
      const result = await runCommand(() =>
        setSubscriptionEnabled({ subscriptionId, enabled }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return false;
      }

      toast.success(enabled ? "Recipient enabled." : "Recipient disabled.", {
        position: "top-right",
      });
      return true;
    } finally {
      setIsMutating(false);
    }
  };

  const removeRecipient = async ({
    subscriptionId,
  }: {
    subscriptionId: Id<"notificationSubscription">;
  }): Promise<boolean> => {
    setIsMutating(true);
    try {
      const result = await runCommand(() =>
        removeSubscription({ subscriptionId }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return false;
      }

      toast.success("Recipient removed.", { position: "top-right" });
      return true;
    } finally {
      setIsMutating(false);
    }
  };

  return {
    addRecipient,
    candidates,
    categories,
    isComplete: list?.complete ?? true,
    isLoading,
    isMutating,
    loadedRecipientCount,
    removeRecipient,
    setRecipientEnabled,
  };
}
