import { Link } from "@tanstack/react-router";

import { X } from "lucide-react";
import { AnimatedCard } from "../ui/AnimatedCard";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import {
  createRewardsAlertDismissedEvent,
  createRewardsAlertShopNowEvent,
} from "@/lib/storefrontJourneyEvents";

interface RewardsAlertProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RewardsAlert({ isOpen, onClose }: RewardsAlertProps) {
  const { track } = useStorefrontObservability();

  const onRewardsAlertClose = () => {
    onClose();
    void track(createRewardsAlertDismissedEvent());
  };

  const handleShopNow = () => {
    onClose();
    void track(createRewardsAlertShopNowEvent());
  };

  return (
    <AnimatedCard
      isOpen={isOpen}
      className="fixed left-0 right-0 top-20 z-10 mx-4 max-w-md rounded-card border border-border bg-surface-raised p-layout-md text-foreground shadow-overlay md:mx-auto"
    >
      <div className="relative">
        <IconButton
          label="Close alert"
          onClick={onRewardsAlertClose}
          className="absolute right-0 top-0"
          variant="clear"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </IconButton>

        <div className="flex items-center gap-4">
          <div className="space-y-8">
            <p className="font-medium text-sm">
              Welcome back, Deladem. Ready for your next slay?
            </p>
            <div className="space-y-8">
              <p className="text-sm text-muted-foreground">
                Here's 10% off your next purchase as a thank you 💝 <br /> Use
                code <b className="text-foreground">SLAYYY</b> at checkout.
              </p>

              <div className="mt-2">
                <Link
                  to="/shop/$categorySlug"
                  params={{ categorySlug: "hair" }}
                  onClick={handleShopNow}
                >
                  <Button variant="outline">
                    Shop Now
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AnimatedCard>
  );
}
