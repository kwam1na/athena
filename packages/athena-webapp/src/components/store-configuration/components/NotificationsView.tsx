import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import View from "../../View";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Skeleton } from "../../ui/skeleton";
import { Switch } from "../../ui/switch";
import { ActionModal } from "../../ui/modals/action-modal";
import {
  SUBSCRIPTION_CATEGORY_RECIPIENT_CAP,
  isValidRecipientEmail,
  normalizeRecipientEmailInput,
  useNotificationSubscriptions,
  type NotificationCategoryCard,
  type NotificationCategoryKey,
  type NotificationSubscriptionRow,
  type RecipientCandidate,
} from "../hooks/useNotificationSubscriptions";

const FALLBACK_BANNER =
  "Sent to platform defaults — adding a recipient takes over this category.";
const SILENCED_BANNER =
  "All recipients disabled — nothing is sent; the platform-defaults fallback does not apply.";
const ORG_WIDE_NOTE =
  "Recipients apply to every store in this organization. There are no per-store lists.";

type PendingConfirm =
  | {
      kind: "remove";
      isLastRow: boolean;
      categoryLabel: string;
      subscription: NotificationSubscriptionRow;
    }
  | {
      kind: "disable_last_enabled";
      categoryLabel: string;
      subscription: NotificationSubscriptionRow;
    };

function RecipientRow({
  categoryLabel,
  isBusy,
  onRemove,
  onToggle,
  subscription,
}: {
  categoryLabel: string;
  isBusy: boolean;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
  subscription: NotificationSubscriptionRow;
}) {
  return (
    <li
      className="flex items-center justify-between gap-4 py-2"
      data-testid={`recipient-row-${subscription.subscriptionId}`}
    >
      <div className="min-w-0">
        {subscription.recipientName && (
          <p className="truncate text-sm text-foreground">
            {subscription.recipientName}
          </p>
        )}
        <p className="truncate text-xs text-muted-foreground">
          {subscription.recipientEmail}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Switch
          aria-label={`Send ${categoryLabel} to ${subscription.recipientEmail}`}
          checked={subscription.enabled}
          disabled={isBusy}
          onCheckedChange={onToggle}
        />
        <Button
          aria-label={`Remove ${subscription.recipientEmail} from ${categoryLabel}`}
          disabled={isBusy}
          onClick={onRemove}
          size="icon"
          variant="ghost"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function RecipientPicker({
  candidates,
  isBusy,
  onDismiss,
  onSelectEmail,
  subscribedEmails,
}: {
  candidates: RecipientCandidate[];
  isBusy: boolean;
  onDismiss: () => void;
  onSelectEmail: (input: { email: string; name?: string }) => void;
  subscribedEmails: Set<string>;
}) {
  const [queryText, setQueryText] = useState("");

  const trimmedQuery = queryText.trim();
  const matches = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.displayName.toLowerCase().includes(needle) ||
        candidate.email.toLowerCase().includes(needle),
    );
  }, [candidates, trimmedQuery]);

  const showFreeFormRow = trimmedQuery.length > 0 && matches.length === 0;
  const freeFormEmail = normalizeRecipientEmailInput(trimmedQuery);
  const isFreeFormValid = isValidRecipientEmail(freeFormEmail);
  const isFreeFormAlreadyAdded = subscribedEmails.has(freeFormEmail);

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Input
        aria-expanded
        aria-label="Search members or enter an email"
        autoFocus
        onChange={(event) => setQueryText(event.target.value)}
        placeholder="Search members or enter an email"
        role="combobox"
        value={queryText}
      />

      <ul className="max-h-56 space-y-1 overflow-y-auto" role="listbox">
        {matches.map((candidate) => {
          const isAlreadyAdded = subscribedEmails.has(
            normalizeRecipientEmailInput(candidate.email),
          );
          const isDisabled = isAlreadyAdded || isBusy;

          return (
            <li
              aria-disabled={isDisabled}
              className={`flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm ${
                isDisabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:bg-accent"
              }`}
              key={candidate.userId}
              onClick={() => {
                if (isDisabled) return;
                onSelectEmail({
                  email: candidate.email,
                  name: candidate.displayName,
                });
              }}
              role="option"
              aria-selected={false}
            >
              <span className="min-w-0">
                <span className="block truncate">{candidate.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {candidate.email}
                </span>
              </span>
              {isAlreadyAdded && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  Already added
                </span>
              )}
            </li>
          );
        })}

        {showFreeFormRow && (
          <li
            aria-disabled={!isFreeFormValid || isFreeFormAlreadyAdded || isBusy}
            aria-selected={false}
            className={`flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm ${
              !isFreeFormValid || isFreeFormAlreadyAdded || isBusy
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:bg-accent"
            }`}
            onClick={() => {
              if (!isFreeFormValid || isFreeFormAlreadyAdded || isBusy) return;
              onSelectEmail({ email: freeFormEmail });
            }}
            role="option"
          >
            <span className="truncate">Use this email: {freeFormEmail}</span>
            {!isFreeFormValid && (
              <span className="shrink-0 text-xs text-muted-foreground">
                Enter a valid email address
              </span>
            )}
            {isFreeFormValid && isFreeFormAlreadyAdded && (
              <span className="shrink-0 text-xs text-muted-foreground">
                Already added
              </span>
            )}
          </li>
        )}

        {matches.length === 0 && !showFreeFormRow && (
          <li className="px-2 py-1.5 text-xs text-muted-foreground">
            No organization members to list. Enter an email address instead.
          </li>
        )}
      </ul>

      <Button onClick={onDismiss} size="sm" variant="ghost">
        Cancel
      </Button>
    </div>
  );
}

function CategoryCard({
  candidates,
  card,
  isBusy,
  onAdd,
  onRequestConfirm,
  onToggleEnabled,
}: {
  candidates: RecipientCandidate[];
  card: NotificationCategoryCard;
  isBusy: boolean;
  onAdd: (input: {
    category: NotificationCategoryKey;
    email: string;
    name?: string;
  }) => Promise<boolean>;
  onRequestConfirm: (confirm: PendingConfirm) => void;
  onToggleEnabled: (input: {
    subscription: NotificationSubscriptionRow;
    enabled: boolean;
  }) => void;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const subscribedEmails = useMemo(
    () =>
      new Set(
        card.subscriptions.map((subscription) =>
          normalizeRecipientEmailInput(subscription.recipientEmail),
        ),
      ),
    [card.subscriptions],
  );

  return (
    <div
      className="space-y-3 rounded-lg border border-border p-4"
      data-testid={`notification-category-${card.category}`}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{card.label}</p>
        <p className="text-xs text-muted-foreground">{card.description}</p>
      </div>

      {card.state === "loading" && (
        <div
          className="space-y-2"
          data-testid="notification-category-skeleton"
          aria-busy
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}

      {card.state === "fallback" && (
        <p
          className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          {FALLBACK_BANNER}
        </p>
      )}

      {card.state === "silenced" && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground"
          role="status"
        >
          {SILENCED_BANNER}
        </p>
      )}

      {card.state !== "loading" && card.subscriptions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Recipients (org-wide)
          </p>
          <ul className="divide-y divide-border">
            {card.subscriptions.map((subscription) => (
              <RecipientRow
                categoryLabel={card.label}
                isBusy={isBusy}
                key={subscription.subscriptionId}
                onRemove={() =>
                  onRequestConfirm({
                    kind: "remove",
                    isLastRow: card.subscriptions.length === 1,
                    categoryLabel: card.label,
                    subscription,
                  })
                }
                onToggle={(enabled) =>
                  onToggleEnabled({ enabled, subscription })
                }
                subscription={subscription}
              />
            ))}
          </ul>
        </div>
      )}

      {card.state !== "loading" && (
        <div className="space-y-2">
          {isPickerOpen ? (
            <RecipientPicker
              candidates={candidates}
              isBusy={isBusy}
              onDismiss={() => setIsPickerOpen(false)}
              onSelectEmail={async ({ email, name }) => {
                const added = await onAdd({
                  category: card.category,
                  email,
                  ...(name ? { name } : {}),
                });
                if (added) setIsPickerOpen(false);
              }}
              subscribedEmails={subscribedEmails}
            />
          ) : (
            <Button
              disabled={card.isAtCap || isBusy}
              onClick={() => setIsPickerOpen(true)}
              size="sm"
              variant="ghost"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add recipient
            </Button>
          )}

          {card.isAtCap && (
            <p className="text-xs text-muted-foreground">
              {`Category limit reached — ${SUBSCRIPTION_CATEGORY_RECIPIENT_CAP} recipients. Remove one before adding another.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function confirmCopy(confirm: PendingConfirm) {
  if (confirm.kind === "disable_last_enabled") {
    return {
      title: `Silence ${confirm.categoryLabel}?`,
      description: `${confirm.subscription.recipientEmail} is the last enabled recipient. Nothing is sent for ${confirm.categoryLabel}, and the platform-defaults fallback does not apply.`,
      confirmText: "Disable recipient",
    };
  }

  if (confirm.isLastRow) {
    return {
      title: "Remove the last recipient?",
      description: `${confirm.categoryLabel} returns to platform defaults, and Athena broadcasts these alerts there again.`,
      confirmText: "Remove recipient",
    };
  }

  return {
    title: "Remove recipient?",
    description: `${confirm.subscription.recipientEmail} stops receiving ${confirm.categoryLabel}. The remaining recipients are unchanged.`,
    confirmText: "Remove recipient",
  };
}

export const NotificationsView = () => {
  const {
    addRecipient,
    candidates,
    categories,
    isComplete,
    isLoading,
    isMutating,
    loadedRecipientCount,
    removeRecipient,
    setRecipientEnabled,
  } = useNotificationSubscriptions();

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );

  const handleToggleEnabled = ({
    enabled,
    subscription,
  }: {
    enabled: boolean;
    subscription: NotificationSubscriptionRow;
  }) => {
    const card = categories.find(
      (candidate) => candidate.category === subscription.category,
    );
    const enabledCount =
      card?.subscriptions.filter((row) => row.enabled).length ?? 0;

    if (!enabled && enabledCount <= 1) {
      setPendingConfirm({
        kind: "disable_last_enabled",
        categoryLabel: card?.label ?? subscription.category,
        subscription,
      });
      return;
    }

    void setRecipientEnabled({
      subscriptionId: subscription.subscriptionId,
      enabled,
    });
  };

  const handleConfirm = async () => {
    if (!pendingConfirm) return;

    if (pendingConfirm.kind === "remove") {
      await removeRecipient({
        subscriptionId: pendingConfirm.subscription.subscriptionId,
      });
    } else {
      await setRecipientEnabled({
        subscriptionId: pendingConfirm.subscription.subscriptionId,
        enabled: false,
      });
    }

    setPendingConfirm(null);
  };

  const copy = pendingConfirm ? confirmCopy(pendingConfirm) : null;

  return (
    <View
      className="w-full lg:col-span-2"
      fullHeight={false}
      hideBorder
      hideHeaderBottomBorder
      lockDocumentScroll={false}
      header={<p className="text-sm text-muted-foreground">Notifications</p>}
    >
      <div className="container mx-auto space-y-4 py-8">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{ORG_WIDE_NOTE}</p>
          {!isLoading && !isComplete && (
            <p className="text-xs text-muted-foreground" role="status">
              {`${loadedRecipientCount}+ recipients — list truncated`}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {categories.map((card) => (
            <CategoryCard
              candidates={candidates}
              card={card}
              isBusy={isMutating}
              key={card.category}
              onAdd={addRecipient}
              onRequestConfirm={setPendingConfirm}
              onToggleEnabled={handleToggleEnabled}
            />
          ))}
        </div>
      </div>

      {copy && (
        <ActionModal
          confirmText={copy.confirmText}
          ctaButtonVariant="destructive"
          description={copy.description}
          isOpen
          loading={isMutating}
          onClose={() => setPendingConfirm(null)}
          onConfirm={handleConfirm}
          title={copy.title}
        />
      )}
    </View>
  );
};
