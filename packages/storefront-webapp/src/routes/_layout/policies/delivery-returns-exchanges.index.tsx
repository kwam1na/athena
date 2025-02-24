import { FadeIn } from "@/components/common/FadeIn";
import { useStoreContext } from "@/contexts/StoreContext";
import { capitalizeFirstLetter, capitalizeWords } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/policies/delivery-returns-exchanges/"
)({
  component: () => <OnlineOrderPolicy />,
});

const OnlineOrderPolicy = () => {
  const { store } = useStoreContext();

  if (!store) return <div className="h-screen" />;

  return (
    <FadeIn className="container mx-auto max-w-[1024px] pb-56 py-8 px-6 xl:px-0">
      <div className="space-y-8">
        <h1 className="text-lg">Deliveries, Returns and Exchanges</h1>

        <p className="text-sm">
          {`At ${store?.name && capitalizeWords(store?.name as string)}, we are committed to providing you with the best products
          and exceptional service. If your order doesn't meet your expectations,
          we're here to help with options for returns or exchanges to ensure
          your satisfaction`}
          .
        </p>
        <div className="space-y-8 text-sm">
          <div className="space-y-4">
            <p className="text-lg">Deliveries</p>
            <ul className="space-y-2">
              <li>
                <p>
                  Order processing: Online orders are processed within
                  <strong> 24 - 48 hours</strong> after purchase.
                </p>
              </li>

              <li>
                <p>
                  Local deliveries: Delivered the <strong>same day</strong> they
                  are dispatched.
                </p>
              </li>

              <li>
                <p>
                  International orders: Shipped via express delivery by default
                  for faster service.
                </p>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <p className="text-lg">Returns</p>
            <ul className="space-y-2">
              <li>
                <p>
                  Returns are accepted within <strong>7 days</strong> of
                  receipt.
                </p>
              </li>

              <li>
                <p>
                  Products must be unused and in their{" "}
                  <strong>original condition</strong> to qualify for a return.
                </p>
              </li>

              <li>
                <p>
                  Used products (e.g., wigs that have been worn) are not
                  eligible for returns.
                </p>
              </li>

              <li>
                <p>A valid receipt is required for all returns.</p>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <p className="text-lg">Exchanges</p>
            <ul className="space-y-2">
              <li>
                <p>
                  Exchanges are allowed within <strong>7 days</strong> of
                  receipt.
                </p>
              </li>

              <li>
                <p>
                  Products must be unused and in their{" "}
                  <strong>original condition</strong> to qualify for an
                  exchange.
                </p>
              </li>

              <li>
                <p>A valid receipt is required for all exchanges.</p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </FadeIn>
  );
};
