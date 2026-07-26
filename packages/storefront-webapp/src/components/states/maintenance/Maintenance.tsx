import type { Store } from "@athena/webapp";
import { useOptionalStoreContext } from "@/contexts/StoreContext";
import { useCountdown } from "@/components/common/hooks";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import { StorefrontPage } from "@/components/common/StorefrontPage";

export const MaintenanceMode = ({ store }: { store?: Store }) => {
  const context = useOptionalStoreContext();
  const storeConfig = getStoreConfigV2(store ?? context?.store);
  const maintenanceConfig = storeConfig.operations.maintenance;

  const { timeLeft } = useCountdown(maintenanceConfig?.countdownEndsAt);

  // Use custom heading/message if provided, otherwise use defaults
  const heading = maintenanceConfig?.heading || "We're updating our store...";
  const message =
    maintenanceConfig?.message ||
    "We're working on bringing you amazing products. Check back soon!";

  return (
    <StorefrontPage className="flex min-h-dvh items-center justify-center bg-surface-subtle">
        <div className="space-y-12 text-center">
          <p className="text-3xl font-light uppercase tracking-widest text-brand">
            Wigclub
          </p>
          <div className="space-y-4">
            <h1 className="text-xl font-medium">{heading}</h1>

            <p className="text-muted-foreground text-center">{message}</p>

            {timeLeft && (
              <p className="text-lg text-center font-bold text-brand" role="timer">
                {timeLeft}
              </p>
            )}
          </div>
        </div>
    </StorefrontPage>
  );
};
