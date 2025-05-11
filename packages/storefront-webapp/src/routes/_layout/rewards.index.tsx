import { FadeIn } from "@/components/common/FadeIn";
import { PastOrdersRewards } from "@/components/rewards/PastOrdersRewards";
import { RewardsPanel } from "@/components/rewards/RewardsPanel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useUserQueries } from "@/lib/queries/user";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/rewards/")({
  component: RewardsPage,
});

export default function RewardsPage() {
  const { user, isLoading } = useAuth();
  const userQueries = useUserQueries();
  const { data: userData } = useQuery(userQueries.me());

  // Redirect to login if not authenticated and not loading
  if (!isLoading && !user) {
    return <Navigate to="/login" />;
  }

  return (
    <FadeIn className="min-h-screen space-y-8 lg:space-y-24 pb-56">
      <div className="space-y-8">
        <div className="w-full bg-accent5">
          <div className="container mx-auto max-w-[1024px] space-y-4">
            <div className="flex items-center border-b py-2 px-6 lg:px-0">
              <p className="text-lg font-medium">Rewards</p>
            </div>

            <div className="px-6 lg:px-0">
              {user?.firstName ? (
                <p className="text-2xl font-medium pt-8 pb-4">{`Hi, ${user?.firstName}.`}</p>
              ) : (
                <p className="text-2xl font-medium pt-8 pb-4">Hi there.</p>
              )}
            </div>
          </div>
        </div>

        <div className="container mx-auto max-w-[1024px] space-y-16 px-6 lg:px-0">
          <p className="text-lg font-medium">Your Reward Points</p>

          <RewardsPanel />
        </div>
      </div>
    </FadeIn>
  );
}
