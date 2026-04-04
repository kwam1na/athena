import { Link } from "@tanstack/react-router";

import { X } from "lucide-react";
import { AnimatedCard } from "../ui/AnimatedCard";
import { Button } from "../ui/button";
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
      className="fixed top-[80px] left-0 right-0 z-10 max-w-md border rounded-md p-4 px-6 mx-4 md:mx-auto shadow-lg transition-colors duration-300 bg-accent4/20 backdrop-blur-sm border-white/20"
    >
      <div className="relative">
        <button
          onClick={onRewardsAlertClose}
          className="absolute right-0 top-0 text-white"
          aria-label="Close alert"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-4">
          <div className="space-y-8">
            <p className="font-medium text-sm text-white">
              Welcome back, Deladem. Ready for your next slay?
            </p>
            <div className="space-y-8">
              <p className="text-sm text-white/80">
                Here's 10% off your next purchase as a thank you 💝 <br /> Use
                code <b className="text-accent2">SLAYYY</b> at checkout.
              </p>

              <div className="mt-2">
                <Link
                  to="/shop/$categorySlug"
                  params={{ categorySlug: "hair" }}
                  onClick={handleShopNow}
                >
                  <Button
                    variant="outline"
                    className="bg-white text-black hover:bg-white/90 border-transparent"
                  >
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
