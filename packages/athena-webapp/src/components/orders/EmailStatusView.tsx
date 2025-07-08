import { Check, CheckIcon, Send } from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import {
  currencyFormatter,
  getRelativeTime,
  slugToWords,
} from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { LoadingButton } from "../ui/loading-button";
import { useState } from "react";
import { toast } from "sonner";

export function EmailStatusView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  const [sendingUpdateEmail, setSendingUpdateEmail] = useState(false);

  const sendOrderEmail = useAction(
    api.storeFront.onlineOrderUtilFns.sendOrderUpdateEmail
  );

  if (!order || !activeStore) return null;

  const shouldShowOutForDelivery =
    order.status === "out-for-delivery" && !order.didSendReadyEmail;

  const shouldShowReadyForPickup =
    order.status === "ready-for-pickup" && !order.didSendReadyEmail;

  const shouldShowCompleted =
    ["delivered", "picked-up"].includes(order.status) &&
    !order.didSendCompletedEmail;

  const shouldShowCancelled =
    order.status === "cancelled" && !order.didSendCancelledEmail;

  const handleSendOrderEmail = async () => {
    let orderStatus = "open";

    if (shouldShowOutForDelivery) {
      orderStatus = "out-for-delivery";
    }

    if (shouldShowReadyForPickup) {
      orderStatus = "ready-for-pickup";
    }

    if (shouldShowCompleted) {
      orderStatus = "completed";
    }

    if (shouldShowCancelled) {
      orderStatus = "cancelled";
    }

    try {
      setSendingUpdateEmail(true);

      await sendOrderEmail({
        orderId: order._id,
        newStatus: orderStatus,
      });

      toast.success("Email sent successfully");
    } catch (e) {
      toast.error("Failed to send email", {
        description: (e as Error).message,
      });
    } finally {
      setSendingUpdateEmail(false);
    }
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <p className="text-sm text-sm text-muted-foreground">
          Email communications
        </p>
      }
    >
      <div className="py-4 grid grid-cols-1 gap-8">
        {order.didSendConfirmationEmail && (
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm">order received</p>
            <div className="flex items-center gap-2 text-muted-foreground">
              <p className="text-xs">Sent</p>
              <CheckIcon className="h-3.5 w-3.5" />
            </div>
          </div>
        )}

        {!order.didSendConfirmationEmail && (
          <div>
            <LoadingButton
              variant={"outline"}
              isLoading={sendingUpdateEmail}
              onClick={() => handleSendOrderEmail()}
            >
              <Send className="h-4 w-4 mr-2" />
              Send order received email
            </LoadingButton>
          </div>
        )}

        {order.didSendReadyEmail && (
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm">
              order{" "}
              {order.deliveryMethod == "pickup"
                ? "ready for pickup"
                : "out for delivery"}
            </p>
            <div className="flex items-center gap-2 text-muted-foreground">
              <p className="text-xs">Sent</p>
              <CheckIcon className="h-3.5 w-3.5" />
            </div>
          </div>
        )}

        {(shouldShowOutForDelivery || shouldShowReadyForPickup) && (
          <div>
            <LoadingButton
              variant={"outline"}
              isLoading={sendingUpdateEmail}
              onClick={() => handleSendOrderEmail()}
            >
              <Send className="h-4 w-4 mr-2" />
              Send order ready email
            </LoadingButton>
          </div>
        )}

        {order.didSendCompletedEmail && (
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm">order {slugToWords(order.status)}</p>
            <div className="flex items-center gap-2 text-muted-foreground">
              <p className="text-xs">Sent</p>
              <CheckIcon className="h-3.5 w-3.5" />
            </div>
          </div>
        )}

        {shouldShowCompleted && (
          <div>
            <LoadingButton
              variant={"outline"}
              isLoading={sendingUpdateEmail}
              onClick={() => handleSendOrderEmail()}
            >
              <Send className="h-4 w-4 mr-2" />
              Send order complete email
            </LoadingButton>
          </div>
        )}

        {order.didSendCancelledEmail && (
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm">order cancelled</p>
            <div className="flex items-center gap-2 text-muted-foreground">
              <p className="text-xs">Sent</p>
              <CheckIcon className="h-3.5 w-3.5" />
            </div>
          </div>
        )}

        {shouldShowCancelled && (
          <div>
            <LoadingButton
              variant={"outline"}
              isLoading={sendingUpdateEmail}
              onClick={() => handleSendOrderEmail()}
            >
              <Send className="h-4 w-4 mr-2" />
              Send order cancelled email
            </LoadingButton>
          </div>
        )}
      </div>
    </View>
  );
}
