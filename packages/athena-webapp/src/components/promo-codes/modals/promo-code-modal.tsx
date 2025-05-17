import React, { useState } from "react";
import { CustomModal } from "../../ui/modals/custom-modal";
import { Button } from "../../ui/button";
import ImageUploader, { ImageFile } from "../../ui/image-uploader";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DollarSign, Percent } from "lucide-react";
import { getUploadImagesData } from "@/lib/imageUtils";
import { DiscountType, PromoCodeSpan } from "../types";

interface PromoCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (promoCodeData: PromoCodeFormData) => void;
}

export interface PromoCodeFormData {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: string;
  codeSpan: PromoCodeSpan;
  startDate: string;
  endDate: string;
  images: ImageFile[];
}

export const PromoCodeModal: React.FC<PromoCodeModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [formData, setFormData] = useState<PromoCodeFormData>({
    code: "",
    description: "",
    discountType: "percentage",
    discountValue: "",
    codeSpan: "entire-order",
    startDate: new Date().toISOString().split("T")[0],
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    images: [],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const updateImages = (newImages: ImageFile[]) => {
    setFormData((prev) => ({ ...prev, images: newImages }));
  };

  const handleSubmit = () => {
    setIsSubmitting(true);

    // Process images according to the codebase's pattern
    const { updatedImageUrls, imageUrlsToDelete, newImages } =
      getUploadImagesData(formData.images);

    // Pass processed image data to the parent component
    onSave({
      ...formData,
      // We keep the original images array for UI purposes
      // The parent component will use the processed image data for API calls
      _processedImageData: {
        updatedImageUrls,
        imageUrlsToDelete,
        newImages,
      },
    } as any);

    setTimeout(() => {
      setIsSubmitting(false);
      onClose();
    }, 1000);
  };

  const modalHeader = (
    <div>
      <h2 className="text-xl font-semibold">Create New Promo Code</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Add a new promotional code with custom imagery
      </p>
    </div>
  );

  // Custom ToggleGroup components for this modal
  const CustomDiscountTypeToggle = () => (
    <ToggleGroup
      type="single"
      value={formData.discountType}
      onValueChange={(value) => {
        if (value)
          setFormData((prev) => ({
            ...prev,
            discountType: value as DiscountType,
          }));
      }}
    >
      <ToggleGroupItem value="amount" aria-label="Toggle amount">
        <DollarSign className="w-4 h-4 mr-2" />
        Amount
      </ToggleGroupItem>
      <ToggleGroupItem value="percentage" aria-label="Toggle percentage">
        <Percent className="w-4 h-4 mr-2" />
        Percentage
      </ToggleGroupItem>
    </ToggleGroup>
  );

  const CustomPromoCodeSpanToggle = () => (
    <ToggleGroup
      type="single"
      value={formData.codeSpan}
      onValueChange={(value) => {
        if (value)
          setFormData((prev) => ({
            ...prev,
            codeSpan: value as PromoCodeSpan,
          }));
      }}
    >
      <ToggleGroupItem value="entire-order" aria-label="Toggle entire order">
        Entire order
      </ToggleGroupItem>
      <ToggleGroupItem
        value="selected-products"
        aria-label="Toggle select products"
      >
        Product
      </ToggleGroupItem>
    </ToggleGroup>
  );

  const modalBody = (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label htmlFor="code">Promo Code</Label>
        <Input
          id="code"
          name="code"
          placeholder="SUMMER25"
          value={formData.code}
          onChange={handleChange}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          placeholder="Summer sale discount"
          value={formData.description}
          onChange={handleChange}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Discount Type</Label>
          <CustomDiscountTypeToggle />
        </div>
        <div className="space-y-2">
          <Label htmlFor="discountValue">Discount Value</Label>
          <div className="flex items-center">
            <Input
              id="discountValue"
              name="discountValue"
              placeholder={
                formData.discountType === "percentage" ? "25" : "10.99"
              }
              value={formData.discountValue}
              onChange={handleChange}
              type="number"
              min="0"
            />
            <span className="ml-2">
              {formData.discountType === "percentage" ? "%" : "$"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Usage</Label>
        <CustomPromoCodeSpanToggle />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            value={formData.startDate}
            onChange={handleChange}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            value={formData.endDate}
            onChange={handleChange}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Promotional Images</Label>
        <div className="border rounded-md overflow-hidden">
          <ImageUploader images={formData.images} updateImages={updateImages} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Upload images to be shown in promotional emails and campaigns
        </p>
      </div>
    </div>
  );

  const modalFooter = (
    <div className="flex justify-end gap-3 w-full">
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || !formData.code || !formData.discountValue}
      >
        {isSubmitting ? "Saving..." : "Create Promo Code"}
      </Button>
    </div>
  );

  return (
    <CustomModal
      isOpen={isOpen}
      onClose={onClose}
      header={modalHeader}
      body={modalBody}
      footer={modalFooter}
      size="lg"
    />
  );
};
