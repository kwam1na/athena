import { Check } from "lucide-react";
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
  const potentialPoints = Math.floor(orderAmount / 10);

  return (
    <section className="mx-auto mt-8 max-w-md space-y-8 rounded-xl border border-border bg-surface-subtle p-8">
      <div className="flex flex-col items-center text-center space-y-8">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-medium text-foreground">
            Earn {potentialPoints.toLocaleString()} reward points!
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Just verify your email to claim your points.
        </p>
        <div className="inline-block rounded-full border border-border bg-surface px-5 py-2 text-sm font-medium text-foreground">
          {orderEmail}
        </div>
      </div>
      <div className="space-y-4 pb-4 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Check className="h-5 w-5 flex-shrink-0 text-success" />
          <span>Use this email to verify your account</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Check className="h-5 w-5 flex-shrink-0 text-success" />
          <span>Points will be credited automatically</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Check className="h-5 w-5 flex-shrink-0 text-success" />
          <span>Redeem for discounts</span>
        </div>
      </div>
      <div>
        <Link
          to="/login"
          search={{ origin: "guest-rewards", email: orderEmail }}
        >
          <Button className="w-full font-semibold">
            Claim my points
          </Button>
        </Link>
      </div>
    </section>
  );
}
