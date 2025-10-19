import { useStoreContext } from "@/contexts/StoreContext";
import { useCountdown } from "@/components/common/hooks";

export const MaintenanceMode = () => {
  const { store } = useStoreContext();
  const maintenanceConfig = store?.config?.maintenance;

  const { timeLeft } = useCountdown(maintenanceConfig?.countdownEndsAt);

  // Use custom heading/message if provided, otherwise use defaults
  const heading = maintenanceConfig?.heading || "We're updating our store...";
  const message =
    maintenanceConfig?.message ||
    "We're working on bringing you amazing products. Check back soon!";

  return (
    <div className="container mx-auto px-4 lg:px-0 overflow-hidden bg-accent5 md:bg-background">
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="space-y-12">
          <h1 className="text-3xl text-accent2 font-light uppercase flex items-center justify-center w-full tracking-widest py-4">
            Wigclub
          </h1>
          <div className="space-y-4">
            <p className="text-lg text-center font-medium">{heading}</p>

            <p className="text-muted-foreground text-center">{message}</p>

            {timeLeft && (
              <p className="text-lg text-center font-bold text-accent2">
                {timeLeft}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
