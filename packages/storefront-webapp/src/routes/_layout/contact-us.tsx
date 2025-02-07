import { createFileRoute } from "@tanstack/react-router";
import { useStoreContext } from "@/contexts/StoreContext";
import { capitalizeWords } from "@/lib/utils";
import { FadeIn } from "@/components/common/FadeIn";
import { WIGLUB_HAIR_STUDIO_LOCATION_URL } from "@/lib/constants";

export const Route = createFileRoute("/_layout/contact-us")({
  component: () => <ContactUs />,
});

const ContactUs = () => {
  const { store } = useStoreContext();

  if (!store) return <div className="h-screen" />;

  return (
    <FadeIn className="container mx-auto max-w-[1024px] pb-56 py-8 px-6 xl:px-0">
      <div className="space-y-16">
        <div className="space-y-8">
          <p className="text-lg">Contact us</p>

          <p className="text-sm">
            {`At ${store?.name && capitalizeWords(store?.name as string)}, we're committed to exceptional service and premium
            products. Visit our showroom or contact us—we're here to ensure your
            experience is nothing short of perfect.`}
          </p>
        </div>

        <img
          className="w-150 h-150 object-cover"
          src={store.config?.showroomImage}
          alt="showroom"
        />

        <div className="flex flex-col gap-8 md:grid md:grid-cols-2">
          <div className="space-y-4 text-sm">
            <p className="font-medium">Address</p>

            <div className="space-y-2">
              <p>2 Jungle Avenue</p>
              <p>East Legon, Accra, Ghana</p>
              <div>
                <a
                  href="tel:+233249771887"
                  className="hover:underline font-medium"
                >
                  +233249771887
                </a>
              </div>
            </div>

            <div>
              <a
                href={WIGLUB_HAIR_STUDIO_LOCATION_URL}
                target="_blank"
                className="font-medium"
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
  );
};
