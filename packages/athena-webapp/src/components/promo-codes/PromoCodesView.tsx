import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import PromoCodes from "./PromoCodes";
import { currencyFormatter } from "~/src/lib/utils";
import { PromoCode } from "~/types";
import { Button } from "../ui/button";
import { PlusIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WelcomeOfferModal,
  WelcomeOfferFormData,
} from "./modals/welcome-offer-modal";
import { toast } from "sonner";
import { convertImagesToWebp } from "@/lib/imageUtils";
import { WelcomeOfferCard } from "./welcome-offer-card";

// Mock data for welcome offers - in a real app, this would come from the database
const mockWelcomeOffers = [
  {
    id: "mock-offer-1",
    name: "Black Friday Welcome Back",
    heading: "Welcome back — here's a special offer for you",
    discountPercent: 15,
    isActive: true,
    requiresEmail: true,
    backgroundColor: "#1E293B",
    lastUpdated: new Date(2023, 10, 15),
    promoCodeName: "WELCOME15",
  },
  {
    id: "mock-offer-2",
    name: "Summer Sale Offer",
    heading: "Welcome back! Summer savings just for you",
    discountPercent: 10,
    isActive: false,
    requiresEmail: true,
    imageUrl:
      "https://images.unsplash.com/photo-1520443240718-fce21901db79?q=80&w=1287&auto=format&fit=crop",
    backgroundColor: "#4B5563",
    lastUpdated: new Date(2023, 5, 20),
  },
];

export default function PromoCodesView() {
  const { activeStore } = useGetActiveStore();
  const [activeTab, setActiveTab] = useState("codes");
  const [isWelcomeOfferModalOpen, setIsWelcomeOfferModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [welcomeOffers, setWelcomeOffers] = useState(mockWelcomeOffers);

  // Action hooks for handling images
  const uploadImages = useAction(api.inventory.stores.uploadImageAssets);
  const deleteImages = useAction(api.inventory.productSku.deleteImages);

  const promoCodes = useQuery(
    api.inventory.promoCode.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const handleSaveWelcomeOffer = async (offerData: WelcomeOfferFormData) => {
    if (!activeStore) return;

    setIsProcessing(true);

    try {
      // Extract the processed image data
      const { _processedImageData } = offerData;

      // Handle image deletion if needed
      if (_processedImageData?.imageUrlsToDelete?.length > 0) {
        await deleteImages({
          imageUrls: _processedImageData.imageUrlsToDelete,
        });
      }

      // Handle new image uploads
      let imageUrls = [...(_processedImageData?.updatedImageUrls || [])];

      if (_processedImageData?.newImages?.length > 0) {
        // Convert images to WebP format
        const imageBuffers = await convertImagesToWebp(
          _processedImageData.newImages
        );

        // Upload the images to S3
        const uploadResult = await uploadImages({
          images: imageBuffers,
          storeId: activeStore._id,
        });

        if (uploadResult.success && uploadResult.images) {
          imageUrls = [...imageUrls, ...uploadResult.images];
        }
      }

      // Create the welcome offer with the image URLs
      // This is where you would call your Convex mutation to save the welcome offer
      console.log("Creating welcome offer with data:", {
        ...offerData,
        imageUrls,
        storeId: activeStore._id,
      });

      // For demo purposes, add the offer to our local state
      // In a real app, you'd use the data returned from the backend
      const newOffer = {
        id: `new-offer-${Date.now()}`,
        name: offerData.name,
        heading: offerData.heading,
        discountPercent: offerData.discountPercent,
        isActive: offerData.autoShow,
        requiresEmail: offerData.requiresEmail,
        imageUrl: imageUrls[0] || undefined,
        backgroundColor: offerData.backgroundColor,
        lastUpdated: new Date(),
        promoCodeId: offerData.promoCodeId,
      };

      setWelcomeOffers((prev) => [newOffer, ...prev]);

      toast.success("Welcome offer created successfully!");
    } catch (error) {
      console.error("Error saving welcome offer:", error);
      toast.error("Failed to create welcome offer");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEditOffer = (id: string) => {
    toast.info(`Editing offer ${id}`);
    // In a real implementation, this would open the modal with the offer data pre-filled
  };

  const handlePreviewOffer = (id: string) => {
    toast.info(`Previewing offer ${id}`);
    // In a real implementation, this would open a preview window
  };

  const handleDeleteOffer = (id: string) => {
    if (confirm("Are you sure you want to delete this welcome offer?")) {
      // In a real implementation, this would call a backend API
      setWelcomeOffers((prev) => prev.filter((offer) => offer.id !== id));
      toast.success("Welcome offer deleted successfully");
    }
  };

  const handleToggleOfferActive = (id: string, active: boolean) => {
    // Update the local state
    setWelcomeOffers((prev) =>
      prev.map((offer) =>
        offer.id === id ? { ...offer, isActive: active } : offer
      )
    );

    // In a real implementation, you'd also update the backend
    toast.success(`Offer ${active ? "activated" : "deactivated"}`);
  };

  if (!activeStore || !promoCodes) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const hasCodes = promoCodes.length > 0;

  const promoCodesFormatted = promoCodes.map((promoCode: PromoCode) => {
    return {
      ...promoCode,
      discountValue:
        promoCode.discountType === "amount"
          ? formatter.format(promoCode.discountValue)
          : `${promoCode.discountValue}%`,
    };
  });

  const Navigation = () => {
    return (
      <div className="container mx-auto flex justify-between items-center h-[40px]">
        <div className="flex items-center">
          <p className="text-xl font-medium">Promo codes</p>
        </div>
      </div>
    );
  };

  return (
    <>
      <View
        hideBorder
        hideHeaderBottomBorder
        className="bg-background"
        header={<Navigation />}
      >
        <div className="container mx-auto py-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="codes">Promo Codes</TabsTrigger>
              <TabsTrigger value="welcome-offers">Welcome Offers</TabsTrigger>
            </TabsList>

            <TabsContent value="codes">
              <PromoCodes promoCodes={promoCodesFormatted} />
            </TabsContent>

            <TabsContent value="welcome-offers">
              <div className="py-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-medium">Welcome Offer Modals</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsWelcomeOfferModalOpen(true)}
                    disabled={isProcessing}
                  >
                    <PlusIcon className="w-4 h-4 mr-2" />
                    {isProcessing ? "Processing..." : "Create Welcome Offer"}
                  </Button>
                </div>

                {/* If no welcome offers exist yet */}
                {welcomeOffers.length === 0 && (
                  <div className="bg-slate-50 border rounded-lg p-8 text-center">
                    <p className="text-muted-foreground">
                      No welcome offer modals found. Create one to engage
                      returning customers.
                    </p>
                  </div>
                )}

                {/* Display welcome offers */}
                {welcomeOffers.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {welcomeOffers.map((offer) => (
                      <WelcomeOfferCard
                        key={offer.id}
                        id={offer.id}
                        name={offer.name}
                        heading={offer.heading}
                        discountPercent={offer.discountPercent}
                        isActive={offer.isActive}
                        requiresEmail={offer.requiresEmail}
                        imageUrl={offer.imageUrl}
                        backgroundColor={offer.backgroundColor}
                        lastUpdated={offer.lastUpdated}
                        promoCodeName={offer.promoCodeName}
                        onEdit={handleEditOffer}
                        onPreview={handlePreviewOffer}
                        onDelete={handleDeleteOffer}
                        onToggleActive={handleToggleOfferActive}
                      />
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </View>

      <WelcomeOfferModal
        isOpen={isWelcomeOfferModalOpen}
        onClose={() => setIsWelcomeOfferModalOpen(false)}
        onSave={handleSaveWelcomeOffer}
      />
    </>
  );
}
