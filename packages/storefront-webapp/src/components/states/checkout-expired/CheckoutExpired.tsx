import { useCheckout } from "@/components/checkout/CheckoutProvider";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function CheckoutExpired() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-2xl">Your checkout session has expired</p>

          <p>
            You've been inactive for a while, so we ended your session to secure
            your information.
          </p>
        </div>

        <Link to="/shop/bag">
          <Button variant={"clear"} className="group px-0">
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Return to bag
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function CheckoutSessionNotFound() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">This checkout session does not exists</p>
        </div>

        <Link to="/shop/bag">
          <Button variant={"clear"} className="group px-0">
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Return to bag
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function CheckoutSessionGeneric({ message }: { message: string }) {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">{message}</p>
        </div>

        <Link to="/shop/bag">
          <Button variant={"clear"} className="group px-0">
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Return to bag
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function CheckoutCompleted() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">Your checkout session is complete</p>
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
  const { activeSession } = useCheckout();

  // const createSupportTicket =
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p>
            This checkout session is missing payment. If you think this is
            incorrect, contact us for support.
          </p>

          <p className="font-medium">{`Reference: ${activeSession.externalReference || activeSession._id}`}</p>
        </div>

        <div className="flex gap-8">
          <Link to="/shop/checkout">
            <Button variant={"clear"} className="group px-0">
              <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
              Return to checkout
            </Button>
          </Link>

          {/* <Link to="/shop/checkout">
            <Button variant={"clear"} className="group px-0 items-center">
              Send message to support
              <ArrowRight className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link> */}
        </div>
      </div>
    </div>
  );
}

export function CheckoutNotComplete() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p>This checkout session is not complete</p>
        </div>

        <div className="space-x-12">
          <Button
            variant={"clear"}
            className="group px-0"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}
