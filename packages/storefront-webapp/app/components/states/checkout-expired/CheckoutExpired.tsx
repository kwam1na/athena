import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@tanstack/react-router";

export function CheckoutExpired() {
  return (
    <div className="h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-3xl font-light">
            Your checkout session has expired
          </p>

          <p className="text-xs">
            You've been inactive for a while, so we ended your session to secure
            your information.
          </p>
        </div>

        <Link to="/shop/bag">
          <Button className="lg:w-[320px]">Return to bag</Button>
        </Link>
      </div>
    </div>
  );
}

export function CheckoutCompleted() {
  return (
    <div className="h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-3xl font-light">
            Your checkout session is complete
          </p>
        </div>

        <div className="space-x-12">
          <Link to="/">
            <Button className="lg:w-[320px]">Continue shopping</Button>
          </Link>

          <Link to="/shop/orders">
            <Button variant={"clear"}>View orders</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function CheckoutMissingPayment() {
  return (
    <div className="h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-sm">This checkout session is missing payment</p>
        </div>

        <div className="space-x-12">
          <Link to="/shop/checkout">
            <Button className="lg:w-[320px]">Return to checkout</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function CheckoutNotComplete() {
  return (
    <div className="h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-sm">This checkout session is not complete</p>
        </div>

        <div className="space-x-12">
          <Button
            className="lg:w-[320px] flex items-center"
            onClick={() => window.history.back()}
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}
