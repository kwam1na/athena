import { Award, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

interface GuestRewardsPromptProps {
  orderAmount: number;
  orderEmail: string;
}

export function GuestRewardsPrompt({
  orderAmount,
  orderEmail,
}: GuestRewardsPromptProps) {
  // Calculate the potential points (1 point per dollar spent, rounded down)
  const potentialPoints = Math.floor(orderAmount / 1000);

  return (
    <div className="mt-8 rounded-xl border border-accent5 bg-accent5/40 p-8 space-y-8 max-w-md mx-auto">
      <div className="flex flex-col items-center text-center space-y-8">
        <div className="flex items-center gap-2">
          <Award className="w-7 h-7 text-primary" />
          <span className="text-2xl font-bold text-gray-900">
            Earn {potentialPoints.toLocaleString()} reward points!
          </span>
        </div>
        <p className="text-gray-700 text-sm">
          Just verify your email to claim your points.
        </p>
        <div className="bg-white/80 text-sm border border-accent5 rounded-full px-5 py-2 font-medium text-gray-900 inline-block">
          {orderEmail}
        </div>
      </div>
      <div className="space-y-4 pb-4 text-sm">
        <div className="flex items-center gap-2 text-gray-700">
          <Check className="w-5 h-5 text-accent2 flex-shrink-0" />
          <span>Use this email to verify your account</span>
        </div>
        <div className="flex items-center gap-2 text-gray-700">
          <Check className="w-5 h-5 text-accent2 flex-shrink-0" />
          <span>Points will be credited automatically</span>
        </div>
        <div className="flex items-center gap-2 text-gray-700">
          <Check className="w-5 h-5 text-accent2 flex-shrink-0" />
          <span>Redeem for discounts</span>
        </div>
      </div>
      <div>
        <Link
          to="/login"
          search={{ origin: "guest-rewards", email: orderEmail }}
        >
          <Button className="w-full py-4 font-semibold bg-accent2/90 hover:bg-accent2 text-white transition">
            Claim My Points
          </Button>
        </Link>
      </div>
    </div>
  );
}
