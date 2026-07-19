import { AtSign, Phone, UserRound } from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { useSharedDemoContext } from "~/src/hooks/useSharedDemoContext";

export function CustomerDetailsView() {
  const { order } = useOnlineOrder();
  const sharedDemo = useSharedDemoContext();

  if (!order) return null;

  const { customerDetails } = order;
  const customerIdentity = (
    <>
      <UserRound className="h-4 w-4" />
      <p className="text-sm">{`${customerDetails.firstName} ${customerDetails.lastName}`}</p>
    </>
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Customer</p>}
    >
      <div className="py-4 space-y-12">
        <div className="space-y-4">
          {sharedDemo ? (
            <div className="flex items-center gap-4">{customerIdentity}</div>
          ) : (
            <Link
              to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
              params={(p) => ({
                ...p,
                orgUrlSlug: p.orgUrlSlug!,
                storeUrlSlug: p.storeUrlSlug!,
                userId: order.storeFrontUserId,
              })}
              search={{ o: getOrigin() }}
              className="flex items-center gap-4"
            >
              {customerIdentity}
            </Link>
          )}

          <div className="flex items-center gap-4">
            <AtSign className="h-4 w-4" />
            <p className="text-sm">{customerDetails.email}</p>
          </div>

          <div className="flex items-center gap-4">
            <Phone className="h-4 w-4" />
            <p className="text-sm">{customerDetails.phoneNumber}</p>
          </div>
        </div>

        {/* <div className="flex items-center w-[50%] gap-4">
          <Button variant="outline">
            <Phone className="h-4 w-4 mr-2" />
            Call
          </Button>

          <Button variant="outline">
            <Send className="h-4 w-4 mr-2" />
            Send message
          </Button>
        </div> */}
      </div>
    </View>
  );
}
