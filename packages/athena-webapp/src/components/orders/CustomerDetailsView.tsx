import { AtSign, Phone, Send, UserRound } from "lucide-react";
import View from "../View";
import { Button } from "../ui/button";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";

export function CustomerDetailsView() {
  const { order } = useOnlineOrder();

  if (!order) return null;

  const { customerDetails } = order;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Customer</p>}
    >
      <div className="p-8 space-y-12">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <UserRound className="h-4 w-4" />
            <p className="text-sm">{`${customerDetails.firstName} ${customerDetails.lastName}`}</p>
          </div>

          <div className="flex items-center gap-4">
            <AtSign className="h-4 w-4" />
            <p className="text-sm">{customerDetails.email}</p>
          </div>

          <div className="flex items-center gap-4">
            <Phone className="h-4 w-4" />
            <p className="text-sm">{customerDetails.phoneNumber}</p>
          </div>
        </div>

        <div className="flex items-center w-[50%] gap-4">
          <Button variant="outline">
            <Phone className="h-4 w-4 mr-2" />
            Call
          </Button>

          <Button variant="outline">
            <Send className="h-4 w-4 mr-2" />
            Send message
          </Button>
        </div>
      </div>
    </View>
  );
}
