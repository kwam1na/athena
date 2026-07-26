import { StorefrontPage } from "@/components/common/StorefrontPage";
import { PageState } from "@/components/states/PageState";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export const CheckoutUnavailable = () => {
  return (
    <StorefrontPage as="section" spacing="relaxed">
      <PageState
        state="unavailable"
        title="Checkout is temporarily unavailable"
        description="Your bag is saved. Please try again in a few minutes."
        primaryAction={
          <Button asChild variant="outline">
            <Link to="/shop/bag">Return to bag</Link>
          </Button>
        }
      />
    </StorefrontPage>
  );
};
