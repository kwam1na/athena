import { FadeIn } from "@/components/common/FadeIn";
import { RewardsPanel } from "@/components/rewards/RewardsPanel";
import { useAuth } from "@/hooks/useAuth";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { StorefrontPage } from "@/components/common/StorefrontPage";
import { PageState } from "@/components/states/PageState";

export const Route = createFileRoute("/_layout/rewards/")({
  component: RewardsPage,
});

export default function RewardsPage() {
  const { user, isLoading } = useAuth();

  // Redirect to login if not authenticated and not loading
  if (!isLoading && !user) {
    return <Navigate to="/login" />;
  }

  if (isLoading) {
    return (
      <PageState
        state="loading"
        title="Loading your rewards"
        description="We're checking your points and recent activity."
      />
    );
  }

  return (
    <StorefrontPage as="section" spacing="relaxed">
      <FadeIn className="space-y-16">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold">Rewards</h1>
          <p className="text-muted-foreground">
            {user?.firstName ? `Hi, ${user.firstName}.` : "Hi there."} View
            your points and reward activity.
          </p>
        </header>
        <section aria-labelledby="reward-points-heading" className="space-y-8">
          <h2 id="reward-points-heading" className="text-lg font-medium">
            Your reward points
          </h2>
          <RewardsPanel />
        </section>
      </FadeIn>
    </StorefrontPage>
  );
}
