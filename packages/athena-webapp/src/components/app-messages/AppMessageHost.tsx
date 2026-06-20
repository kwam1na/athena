import { useEffect, useRef } from "react";
import { Download, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAppMessages,
  useAppActionBlockers,
  usePreferredAppMessageCommunicationVariant,
  type AppMessage,
} from "@/lib/app-messages";
import { cn } from "@/lib/utils";

const actionButtonClassName =
  "min-h-10 shrink-0 px-layout-md text-action-commit hover:bg-action-commit-soft hover:text-action-commit";

export function AppMessageHost() {
  const messages = useAppMessages();
  const communicationVariant = usePreferredAppMessageCommunicationVariant();
  const message = messages[0];
  const actionBlockers = useAppActionBlockers(message?.action?.actionId ?? "");
  const selectedBlocker = actionBlockers[0];
  const presentedMessage = selectedBlocker?.guidance ?? message?.message;
  const presentedAction = selectedBlocker ? undefined : message?.action;
  const shouldShowToast = Boolean(message) && communicationVariant === "toast";
  const ghostButtonLabel =
    selectedBlocker?.guidance ?? message?.compactLabel ?? message?.message;
  const activeToastIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (activeToastIdRef.current) {
        toast.dismiss(activeToastIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!message || !shouldShowToast) {
      if (activeToastIdRef.current) {
        toast.dismiss(activeToastIdRef.current);
        activeToastIdRef.current = null;
      }
      return;
    }

    const toastId = getToastId(message);
    if (activeToastIdRef.current && activeToastIdRef.current !== toastId) {
      toast.dismiss(activeToastIdRef.current);
    }
    activeToastIdRef.current = toastId;
    toast.message(presentedMessage, {
      id: toastId,
      closeButton: false,
      dismissible: false,
      duration: Number.POSITIVE_INFINITY,
      position: "top-right",
      className: "min-w-80",
      classNames: {
        toast: "justify-between",
        content: "min-w-0 flex-1",
      },
      action: presentedAction ? (
        <AppMessageActionButton
          action={presentedAction}
          className="ml-auto"
          size="sm"
        />
      ) : undefined,
    });
  }, [message, presentedAction, presentedMessage, shouldShowToast]);

  if (!message) {
    return null;
  }

  if (communicationVariant === "ghost") {
    return (
      <section
        aria-label={message.label}
        aria-live="polite"
        className="fixed bottom-layout-md left-layout-md z-50"
      >
        <Button
          aria-label={ghostButtonLabel}
          className="min-h-10 rounded-full border border-border/70 bg-foreground/10 px-layout-md text-sm font-semibold text-foreground shadow-surface backdrop-blur transition-colors hover:border-border hover:bg-foreground/15 hover:text-foreground supports-[backdrop-filter]:bg-foreground/10"
          disabled={!presentedAction || presentedAction.disabled}
          onClick={() => {
            presentedAction?.onInvoke();
          }}
          title={presentedMessage}
          type="button"
          variant="ghost"
        >
          {ghostButtonLabel}
        </Button>
      </section>
    );
  }

  if (communicationVariant !== "banner") {
    return null;
  }

  return (
    <section
      aria-label={message.label}
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 border-b border-border/80 bg-surface/95 px-layout-md py-layout-sm shadow-surface backdrop-blur supports-[backdrop-filter]:bg-surface/85"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-layout-lg text-center sm:flex-row sm:text-left">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center justify-center gap-layout-xs truncate text-sm font-medium text-foreground sm:justify-start">
            <span className="truncate">{presentedMessage}</span>
            {message.details ? <AppMessageDetails message={message} /> : null}
          </div>
        </div>
        {presentedAction ? (
          <AppMessageActionButton action={presentedAction} size="sm" />
        ) : null}
      </div>
    </section>
  );
}

function AppMessageDetails({ message }: { message: AppMessage }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={message.detailsLabel ?? `${message.label} details`}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            type="button"
          >
            <Info aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="w-72 max-w-[calc(100vw-2rem)] whitespace-normal text-left text-xs leading-5">
          {message.details}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getToastId(message: AppMessage) {
  return message.toastId ?? `athena-app-message-${message.id}`;
}

function AppMessageActionButton({
  action,
  className,
  size,
}: {
  action: NonNullable<AppMessage["action"]>;
  className?: string;
  size?: "sm";
}) {
  return (
    <Button
      className={cn(actionButtonClassName, className)}
      disabled={action.disabled}
      onClick={action.onInvoke}
      size={size}
      type="button"
      variant="ghost"
    >
      {action.iconName === "download" ? <Download aria-hidden="true" /> : null}
      {action.label}
    </Button>
  );
}
