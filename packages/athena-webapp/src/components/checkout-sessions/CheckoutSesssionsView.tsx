import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { FadeIn } from "../common/FadeIn";
import View from "../View";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { EmptyState } from "../states/empty/empty-state";
import { ShoppingCart } from "lucide-react";
import { CheckoutSessionsTable } from "./CheckoutSessionsTable";

const Navigation = () => {
  return (
    <div className="container mx-auto flex justify-between items-center h-[40px]">
      <div className="flex items-center">
        <p className="text-xl font-medium">Active checkout sessions</p>
      </div>
    </div>
  );
};

export function CheckoutSesssionsView() {
  const { activeStore } = useGetActiveStore();

  const activeCheckoutSessions = useQuery(
    api.storeFront.checkoutSession.getActiveCheckoutSessionsForStore,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeCheckoutSessions) return null;

  const hasActiveCheckoutSessions =
    activeCheckoutSessions && activeCheckoutSessions.length > 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasActiveCheckoutSessions && <Navigation />}
    >
      <FadeIn className="space-y-8 py-8">
        {hasActiveCheckoutSessions && (
          <CheckoutSessionsTable data={activeCheckoutSessions} />
        )}

        {!hasActiveCheckoutSessions && (
          <div className="flex items-center justify-center min-h-[60vh] w-full">
            <EmptyState
              icon={
                <ShoppingCart className="w-16 h-16 text-muted-foreground" />
              }
              title={
                <div className="flex gap-1 text-sm">
                  <p className="text-muted-foreground">
                    No <b>active</b> checkout sessions
                  </p>
                </div>
              }
            />
          </div>
        )}
      </FadeIn>
    </View>
  );
}
