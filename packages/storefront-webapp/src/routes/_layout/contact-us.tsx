import { createFileRoute } from "@tanstack/react-router";
import { useStoreContext } from "@/contexts/StoreContext";
import { capitalizeWords } from "@/lib/utils";
import { FadeIn } from "@/components/common/FadeIn";
import { WIGLUB_HAIR_STUDIO_LOCATION_URL } from "@/lib/constants";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import { useScrollToTop } from "@/hooks/useScrollToTop";
import { StorefrontPage } from "@/components/common/StorefrontPage";
import { PageState } from "@/components/states/PageState";
import { StorefrontImage } from "@/components/ui/storefront-image";

export const Route = createFileRoute("/_layout/contact-us")({
  component: () => <ContactUs />,
});

const ContactUs = () => {
  const { store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);

  useScrollToTop();

  if (!store) {
    return (
      <PageState
        state="loading"
        title="Loading contact details"
        description="We're getting the latest store information."
      />
    );
  }

  return (
    <StorefrontPage as="section" spacing="relaxed">
      <FadeIn>
      <div className="space-y-16">
        <div className="space-y-8">
          <h1 className="text-2xl font-semibold">Contact us</h1>

          <p className="text-sm">
            {`At ${store?.name && capitalizeWords(store?.name as string)}, we're committed to exceptional service and premium
            products. Visit our showroom or contact us—we're here to ensure your
            experience is nothing short of perfect.`}
          </p>
        </div>

        <StorefrontImage
          src={storeConfig.media.images.showroomImage}
          alt={`${capitalizeWords(store.name)} showroom`}
          aspectRatio="4 / 3"
          wrapperClassName="max-w-content rounded-lg"
        />

        <div className="flex flex-col gap-8 md:grid md:grid-cols-2">
          <div className="space-y-4 text-sm">
            <p className="font-medium">Address</p>

            <div className="space-y-2">
              <p>{storeConfig.contact.location}</p>
              <div>
                <a
                  href={`tel:${storeConfig.contact.phoneNumber}`}
                  className="hover:underline font-medium"
                >
                  {storeConfig.contact.phoneNumber}
                </a>
              </div>
            </div>

            <div>
              <a
                href={WIGLUB_HAIR_STUDIO_LOCATION_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline-offset-4 hover:underline"
              >
                See map and directions
              </a>
            </div>
          </div>

          <div className="space-y-4 text-sm">
            <p className="font-medium">Store hours</p>

            <div className="space-y-2">
              <p>Monday - Saturday: 9am - 7pm</p>
              <p>Sunday: Closed</p>
            </div>
          </div>
        </div>
      </div>
      </FadeIn>
    </StorefrontPage>
  );
};
