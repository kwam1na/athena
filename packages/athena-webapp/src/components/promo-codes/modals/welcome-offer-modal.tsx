import React, { useState } from "react";
import { CustomModal } from "../../ui/modals/custom-modal";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ImageUploader, { ImageFile } from "../../ui/image-uploader";
import { ColorPicker } from "./color-picker";
import { Switch } from "../../ui/switch";
import { getUploadImagesData } from "@/lib/imageUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WelcomeOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (offerData: WelcomeOfferFormData) => void;
}

export interface WelcomeOfferFormData {
  name: string;
  heading: string;
  subheading: string;
  discountPercent: number;
  buttonText: string;
  noThanksText: string;
  backgroundColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  autoShow: boolean;
  delaySeconds: number;
  requiresEmail: boolean;
  showMobileVersion: boolean;
  promoCodeId?: string;
  images: ImageFile[];
  _processedImageData?: any;
}

export const WelcomeOfferModal: React.FC<WelcomeOfferModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [formData, setFormData] = useState<WelcomeOfferFormData>({
    name: "Welcome Back Offer",
    heading: "Welcome back — this one's for you.",
    subheading:
      "Take 10% off your first order, just for stopping by again. Enter your email and we'll send you discount code to use at checkout.",
    discountPercent: 10,
    buttonText: "Send My Code",
    noThanksText: "No thanks",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    textColor: "#FFFFFF",
    buttonColor: "#F97316", // Orange color
    buttonTextColor: "#FFFFFF",
    autoShow: true,
    delaySeconds: 3,
    requiresEmail: true,
    showMobileVersion: true,
    images: [],
  });

  const [activeTab, setActiveTab] = useState("content");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop"
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: Number(value) }));
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [name]: checked }));
  };

  const handleColorChange = (name: string, color: string) => {
    setFormData((prev) => ({ ...prev, [name]: color }));
  };

  const handleSelectChange = (name: string, value: string) => {
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
      _processedImageData: {
        updatedImageUrls,
        imageUrlsToDelete,
        newImages,
      },
    });

    setTimeout(() => {
      setIsSubmitting(false);
      onClose();
    }, 1000);
  };

  const modalHeader = (
    <div>
      <h2 className="text-xl font-semibold">Create Welcome Offer Modal</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Customize your welcome back offer modal to engage returning customers
      </p>
    </div>
  );

  const modalBody = (
    <div>
      <div className="flex justify-between items-center mb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Internal Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Welcome Back Offer"
                value={formData.name}
                onChange={handleChange}
              />
              <p className="text-xs text-muted-foreground">
                For your reference only. Not shown to customers.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="heading">Heading</Label>
              <Input
                id="heading"
                name="heading"
                placeholder="Welcome back — this one's for you."
                value={formData.heading}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subheading">Subheading</Label>
              <Textarea
                id="subheading"
                name="subheading"
                placeholder="Take 10% off your first order, just for stopping by again."
                value={formData.subheading}
                onChange={handleChange}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="discountPercent">Discount Percentage</Label>
              <Input
                id="discountPercent"
                name="discountPercent"
                type="number"
                min="1"
                max="100"
                value={formData.discountPercent}
                onChange={handleNumberChange}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="buttonText">Button Text</Label>
                <Input
                  id="buttonText"
                  name="buttonText"
                  placeholder="Send My Code"
                  value={formData.buttonText}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="noThanksText">Dismiss Text</Label>
                <Input
                  id="noThanksText"
                  name="noThanksText"
                  placeholder="No thanks"
                  value={formData.noThanksText}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Link to Promo Code</Label>
              <Select
                value={formData.promoCodeId}
                onValueChange={(value) =>
                  handleSelectChange("promoCodeId", value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a promo code (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="code1">WELCOME10</SelectItem>
                  <SelectItem value="code2">NEWCUSTOMER</SelectItem>
                  <SelectItem value="code3">COMEBACK15</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Connect this modal to an existing promo code
              </p>
            </div>
          </TabsContent>

          <TabsContent value="design" className="space-y-6 mt-4">
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Colors</h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Background Color</Label>
                  <ColorPicker
                    color={formData.backgroundColor}
                    onChange={(color) =>
                      handleColorChange("backgroundColor", color)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Text Color</Label>
                  <ColorPicker
                    color={formData.textColor}
                    onChange={(color) => handleColorChange("textColor", color)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Button Color</Label>
                  <ColorPicker
                    color={formData.buttonColor}
                    onChange={(color) =>
                      handleColorChange("buttonColor", color)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Button Text Color</Label>
                  <ColorPicker
                    color={formData.buttonTextColor}
                    onChange={(color) =>
                      handleColorChange("buttonTextColor", color)
                    }
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Background Image</Label>
              <div className="border rounded-md overflow-hidden">
                <ImageUploader
                  images={formData.images}
                  updateImages={updateImages}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a background image for your modal
              </p>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="autoShow" className="text-base">
                  Auto-show Modal
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically show this modal to returning visitors
                </p>
              </div>
              <Switch
                id="autoShow"
                checked={formData.autoShow}
                onCheckedChange={(checked) =>
                  handleSwitchChange("autoShow", checked)
                }
              />
            </div>

            {formData.autoShow && (
              <div className="space-y-2">
                <Label htmlFor="delaySeconds">Display Delay (seconds)</Label>
                <Input
                  id="delaySeconds"
                  name="delaySeconds"
                  type="number"
                  min="0"
                  max="60"
                  value={formData.delaySeconds}
                  onChange={handleNumberChange}
                />
                <p className="text-xs text-muted-foreground">
                  Time to wait before showing the modal
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="requiresEmail" className="text-base">
                  Require Email
                </Label>
                <p className="text-xs text-muted-foreground">
                  Require customers to enter their email to get the discount
                </p>
              </div>
              <Switch
                id="requiresEmail"
                checked={formData.requiresEmail}
                onCheckedChange={(checked) =>
                  handleSwitchChange("requiresEmail", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="showMobileVersion" className="text-base">
                  Show on Mobile
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable the modal on mobile devices
                </p>
              </div>
              <Switch
                id="showMobileVersion"
                checked={formData.showMobileVersion}
                onCheckedChange={(checked) =>
                  handleSwitchChange("showMobileVersion", checked)
                }
              />
            </div>
          </TabsContent>

          <TabsContent value="preview" className="space-y-4 mt-4">
            <div className="flex justify-center gap-4 mb-6">
              <Button
                variant={previewMode === "desktop" ? "default" : "outline"}
                size="sm"
                onClick={() => setPreviewMode("desktop")}
              >
                Desktop
              </Button>
              <Button
                variant={previewMode === "mobile" ? "default" : "outline"}
                size="sm"
                onClick={() => setPreviewMode("mobile")}
              >
                Mobile
              </Button>
            </div>

            <div
              className={`border rounded-lg overflow-hidden mx-auto ${previewMode === "desktop" ? "w-[600px] h-[400px]" : "w-[320px] h-[500px]"}`}
            >
              <div
                className="relative w-full h-full flex flex-col items-center justify-center text-center p-8"
                style={{
                  backgroundColor: formData.backgroundColor,
                  color: formData.textColor,
                  backgroundImage: formData.images[0]?.preview
                    ? `url(${formData.images[0].preview})`
                    : "none",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                <div className="absolute inset-0 bg-black bg-opacity-40" />

                <div className="relative z-10 max-w-md mx-auto">
                  <h2 className="text-3xl font-serif mb-4">
                    {formData.heading}
                  </h2>
                  <p className="mb-6">{formData.subheading}</p>

                  {formData.requiresEmail && (
                    <div className="mb-4">
                      <input
                        type="email"
                        placeholder="Email address"
                        className="w-full p-3 rounded-md border text-black"
                      />
                    </div>
                  )}

                  <button
                    className="w-full py-3 px-4 rounded-md font-medium text-center mb-3"
                    style={{
                      backgroundColor: formData.buttonColor,
                      color: formData.buttonTextColor,
                    }}
                  >
                    {formData.buttonText}
                  </button>

                  <button className="text-sm opacity-80 hover:opacity-100">
                    {formData.noThanksText}
                  </button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
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
        disabled={isSubmitting || !formData.heading}
      >
        {isSubmitting ? "Saving..." : "Create Welcome Offer"}
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
      size="xl"
    />
  );
};
