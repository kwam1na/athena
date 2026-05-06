import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { CheckCircle2, MessageCircle, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runCommand } from "@/lib/errors/runCommand";
import { cn } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";

export type ReceiptDeliveryHistoryEntry = {
  _id?: string;
  createdAt?: number;
  deliveredAt?: number;
  failedAt?: number;
  failureMessage?: string | null;
  recipientDisplay?: string | null;
  sentAt?: number;
  status?: string;
  updatedAt?: number;
};

export type ReceiptMessagingConfig = {
  actorStaffProfileId?: Id<"staffProfile"> | string | null;
  customerPhone?: string | null;
  deliveryHistory?: ReceiptDeliveryHistoryEntry[] | null;
  transactionId?: Id<"posTransaction"> | string | null;
  transactionNumber?: string | null;
};

type SendReceiptLinkArgs = {
  actorStaffProfileId?: Id<"staffProfile">;
  recipientPhone: string;
  transactionId: Id<"posTransaction">;
};

type SendReceiptLinkData = {
  deliveryId?: string;
  receiptUrl?: string;
  status?: string;
};

type SendReceiptLinkAction = FunctionReference<
  "action",
  "public",
  SendReceiptLinkArgs,
  CommandResult<SendReceiptLinkData>
>;

interface PosReceiptShareControlProps {
  className?: string;
  compact?: boolean;
  messaging: ReceiptMessagingConfig;
}

function getSendReceiptLinkAction() {
  return (
    api as unknown as {
      customerMessaging: {
        public: {
          sendPosReceiptLink: SendReceiptLinkAction;
        };
      };
    }
  ).customerMessaging.public.sendPosReceiptLink;
}

function normalizePhone(value?: string | null) {
  return value?.trim() ?? "";
}

function formatDeliveryStatus(status?: string) {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "sent":
      return "Sent";
    case "queued":
      return "Queued";
    case "pending":
      return "Pending";
    default:
      return "Not sent";
  }
}

function getDeliveryTimestamp(entry: ReceiptDeliveryHistoryEntry) {
  return entry.deliveredAt ?? entry.sentAt ?? entry.createdAt;
}

function formatDeliveryTimestamp(timestamp?: number) {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getLatestReceiptDelivery(
  history?: ReceiptDeliveryHistoryEntry[] | null,
) {
  if (!history?.length) {
    return null;
  }

  return [...history].sort(
    (left, right) =>
      (getDeliveryTimestamp(right) ?? 0) - (getDeliveryTimestamp(left) ?? 0),
  )[0];
}

export function PosReceiptShareControl({
  className,
  compact = false,
  messaging,
}: PosReceiptShareControlProps) {
  const sendReceiptLink = useAction(getSendReceiptLinkAction());
  const initialPhone = normalizePhone(messaging.customerPhone);
  const [phoneDraft, setPhoneDraft] = useState(initialPhone);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const latestDelivery = useMemo(
    () => getLatestReceiptDelivery(messaging.deliveryHistory),
    [messaging.deliveryHistory],
  );
  const deliveryTimestamp = formatDeliveryTimestamp(
    latestDelivery ? getDeliveryTimestamp(latestDelivery) : undefined,
  );
  const phoneNumber = normalizePhone(phoneDraft);
  const canSend = Boolean(messaging.transactionId && phoneNumber);
  const sendLabel = latestDelivery ? "Resend link" : "Send link";

  async function handleSendReceiptLink() {
    if (!messaging.transactionId) {
      setErrorMessage(
        "Receipt link unavailable. Open the transaction details and try again.",
      );
      return;
    }

    if (!phoneNumber) {
      setErrorMessage("Customer phone required. Enter a WhatsApp number.");
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    const result = await runCommand(() =>
      sendReceiptLink({
        actorStaffProfileId: messaging.actorStaffProfileId
          ? (messaging.actorStaffProfileId as Id<"staffProfile">)
          : undefined,
        recipientPhone: phoneNumber,
        transactionId: messaging.transactionId as Id<"posTransaction">,
      }),
    );

    setIsSending(false);

    if (result.kind === "ok") {
      toast.success("Receipt link sent.");
      return;
    }

    setErrorMessage(result.error.message);
  }

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/80 bg-surface-raised p-4",
        compact ? "space-y-3" : "space-y-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp receipt
          </p>
          <p className="text-sm text-muted-foreground">
            Send this receipt link to the customer.
          </p>
        </div>
        {latestDelivery ? (
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {formatDeliveryStatus(latestDelivery.status)}
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "grid gap-2",
          compact
            ? "sm:grid-cols-[1fr_auto]"
            : "sm:grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        <Input
          aria-label="Customer WhatsApp number"
          className="h-11"
          onChange={(event) => {
            setPhoneDraft(event.target.value);
            setErrorMessage(null);
          }}
          placeholder="Customer WhatsApp number"
          value={phoneDraft}
        />
        <Button
          className="h-11 whitespace-nowrap"
          disabled={!canSend || isSending}
          onClick={handleSendReceiptLink}
          type="button"
          variant={latestDelivery ? "outline" : "default"}
        >
          {isSending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {isSending ? "Sending" : sendLabel}
        </Button>
      </div>

      {errorMessage ? (
        <p className="text-sm text-destructive">{errorMessage}</p>
      ) : null}

      {latestDelivery ? (
        <div className="rounded-xl border border-border/70 bg-background p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Last attempt</span>
            <span className="font-medium text-foreground">
              {formatDeliveryStatus(latestDelivery.status)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{latestDelivery.recipientDisplay ?? phoneNumber}</span>
            {deliveryTimestamp ? <span>{deliveryTimestamp}</span> : null}
          </div>
          {latestDelivery.failureMessage ? (
            <p className="mt-2 text-xs text-destructive">
              {latestDelivery.failureMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
