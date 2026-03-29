import { useState, useEffect, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TvMinimalPlay, Image } from "lucide-react";
import { LandingPageReelVersion } from "./LandingPageReelVersion";
import { HeroHeaderImageUploader } from "./HeroHeaderImageUploader";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Switch } from "../ui/switch";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import { ReelUploader } from "./ReelUploader";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";

export const HeroSectionTabs: React.FC = () => {
  const { activeStore } = useGetActiveStore();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );
  const [heroHeaderImage, setHeroHeaderImage] = useState<string | undefined>(
    storeConfig.media.homeHero.headerImage,
  );

  const [heroDisplayType, setHeroDisplayType] = useState<
    "reel" | "image" | undefined
  >(storeConfig.media.homeHero.displayType as "reel" | "image");

  const [contentOptions, setContentOptions] = useState<{
    showOverlay: boolean;
    showText: boolean;
  }>({
    showOverlay: false,
    showText: false,
  });

  const patchConfig = useMutation(api.inventory.stores.patchConfigV2);

  // Update local state when store config changes
  useEffect(() => {
    const next = storeConfig.media.homeHero.headerImage;
    if (next) setHeroHeaderImage(next);
  }, [storeConfig.media.homeHero.headerImage]);

  useEffect(() => {
    const next: "reel" | "image" = storeConfig.media.homeHero.displayType;
    if (next) setHeroDisplayType(next);
  }, [storeConfig.media.homeHero.displayType]);

  useEffect(() => {
    setContentOptions({
      showOverlay: Boolean(storeConfig.media.homeHero.showOverlay),
      showText: Boolean(storeConfig.media.homeHero.showText),
    });
  }, [storeConfig.media.homeHero.showOverlay, storeConfig.media.homeHero.showText]);

  const handleImageUpdate = (newImageUrl: string) => {
    setHeroHeaderImage(newImageUrl);
  };

  const handleDisplayTypeChange = async (value: string) => {
    if (!activeStore) return;

    const newType = value as "reel" | "image";

    // Validate: if switching to "image", ensure an image is uploaded
    if (newType === "image" && !heroHeaderImage) {
      toast.error("Please upload a hero header image first");
      return;
    }

    setHeroDisplayType(newType);

    try {
      await patchConfig({
        id: activeStore._id,
        patch: {
          media: {
            homeHero: {
              ...contentOptions,
              headerImage: heroHeaderImage ?? null,
              displayType: newType,
            },
          },
        },
      });
      toast.success(
        `Hero display updated to ${newType === "reel" ? "video reel" : "header image"}`,
      );
    } catch (error) {
      console.error("Failed to update hero display type:", error);
      toast.error("Failed to update hero display type");
      // Revert on error
      setHeroDisplayType(storeConfig.media.homeHero.displayType || "reel");
    }
  };

  const handleOverlayToggle = async (checked: boolean) => {
    if (!activeStore) return;

    const newContentOptions = {
      ...contentOptions,
      showOverlay: checked,
    };

    try {
      const patch = {
        id: activeStore._id,
        patch: {
          media: {
            homeHero: {
              displayType: heroDisplayType || "reel",
              headerImage: heroHeaderImage ?? null,
              ...newContentOptions,
            },
          },
        },
      } as const;

      await patchConfig(patch);
      setContentOptions(newContentOptions);
      toast.success(`Hero overlay ${checked ? "enabled" : "disabled"}`);
    } catch (error) {
      console.error("Failed to update overlay setting:", error);
      toast.error("Failed to update overlay setting");
      // Revert on error
      setContentOptions({
        ...contentOptions,
        showOverlay: storeConfig.media.homeHero.showOverlay !== false,
      });
    }
  };

  const handleTextToggle = async (checked: boolean) => {
    if (!activeStore) return;

    const newContentOptions = {
      ...contentOptions,
      showText: checked,
    };

    try {
      const patch = {
        id: activeStore._id,
        patch: {
          media: {
            homeHero: {
              displayType: heroDisplayType || "reel",
              headerImage: heroHeaderImage ?? null,
              ...newContentOptions,
            },
          },
        },
      } as const;
      await patchConfig(patch);
      setContentOptions(newContentOptions);
      toast.success(`Hero text ${checked ? "enabled" : "disabled"}`);
    } catch (error) {
      console.error("Failed to update text setting:", error);
      toast.error("Failed to update text setting");
      // Revert on error
      setContentOptions({
        ...newContentOptions,
        showText: storeConfig.media.homeHero.showText !== false,
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Display Type Selector */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Homepage Hero Display</p>
        <ToggleGroup
          type="single"
          value={heroDisplayType}
          onValueChange={handleDisplayTypeChange}
          className="justify-start"
        >
          <ToggleGroupItem value="reel" aria-label="Video Reel">
            <TvMinimalPlay className="h-4 w-4 mr-2" />
            Video Reel
          </ToggleGroupItem>
          <ToggleGroupItem
            value="image"
            aria-label="Hero Image"
            disabled={!heroHeaderImage}
          >
            <Image className="h-4 w-4 mr-2" />
            Hero Image
          </ToggleGroupItem>
        </ToggleGroup>
        {!heroHeaderImage && (
          <p className="text-xs text-muted-foreground">
            Upload a hero image to enable this option
          </p>
        )}
      </div>

      {/* Overlay and Text Controls */}
      <div className="space-y-4 border-t pt-4">
        <p className="text-sm font-medium">Hero Content Options</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="overlay-toggle" className="text-sm">
                Show dark overlay
              </label>
              <p className="text-xs text-muted-foreground">
                Adds a dark overlay to improve text readability
              </p>
            </div>
            <Switch
              id="overlay-toggle"
              checked={contentOptions.showOverlay}
              onCheckedChange={handleOverlayToggle}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="text-toggle" className="text-sm">
                Show text content
              </label>
              <p className="text-xs text-muted-foreground">
                Display "Switch your look to match your mood"
              </p>
            </div>
            <Switch
              id="text-toggle"
              checked={contentOptions.showText}
              onCheckedChange={handleTextToggle}
            />
          </div>
        </div>
      </div>

      {heroDisplayType && (
        <Tabs defaultValue={heroDisplayType} className="flex flex-col gap-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="reel" className="flex items-center gap-2">
              <TvMinimalPlay className="h-4 w-4" />
              Landing Page Reel
            </TabsTrigger>
            <TabsTrigger value="image" className="flex items-center gap-2">
              <Image className="h-4 w-4" />
              Hero Header Image
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reel" className="space-y-4">
            <LandingPageReelVersion />
            <div className="flex items-center gap-2 text-muted-foreground">
              <TvMinimalPlay className="h-4 w-4" />
              <p className="text-sm">
                This is the video that loops on the landing page
              </p>
            </div>

            <ReelUploader />
          </TabsContent>

          <TabsContent value="image" className="space-y-4">
            <HeroHeaderImageUploader
              currentImageUrl={heroHeaderImage}
              onImageUpdate={handleImageUpdate}
              disabled={!activeStore}
            />
            <div className="flex items-center gap-2 text-muted-foreground">
              <Image className="h-4 w-4" />
              <p className="text-sm">
                This image appears as the hero header on your storefront
              </p>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};
