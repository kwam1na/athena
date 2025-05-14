import { Link } from "@tanstack/react-router";

import { X } from "lucide-react";
import { AnimatedCard } from "../ui/AnimatedCard";
import { Button } from "../ui/button";
import { postAnalytics } from "@/api/analytics";
import { useTrackEvent } from "@/hooks/useTrackEvent";

interface RewardsAlertProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RewardsAlert({ isOpen, onClose }: RewardsAlertProps) {
  // useTrackEvent({
  //   action: "viewed_rewards_alert",
  //   data: {},
  //   isReady: isOpen,
  // });

  const onRewardsAlertClose = () => {
    onClose();

    postAnalytics({
      action: "dismissed_rewards_alert",
      data: {},
    });
  };

  // Track when the alert is actioned on
  const handleShopNow = () => {
    onClose();

    postAnalytics({
      action: "clicked_shop_now",
      origin: "rewards_alert",
      data: {},
    });
  };

  return (
    <AnimatedCard
      isOpen={isOpen}
      className="fixed top-[80px] left-0 right-0 z-10 max-w-md border rounded-md p-4 px-6 mx-4 md:mx-auto shadow-lg transition-colors duration-300 bg-accent4/30 backdrop-blur-sm border-white/20"
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
          <div className="space-y-2">
            <p className="font-medium text-sm text-white">
              🥳 Introducing Wigclub Rewards
            </p>
            <div className="space-y-4">
              <p className="text-sm text-white/80">
                Earn 10 points for every GHS 1 you spend. Redeem points for
                discounts on future purchases.
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
