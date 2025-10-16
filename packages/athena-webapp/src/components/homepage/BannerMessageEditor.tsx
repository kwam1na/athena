import { useMutation, useQuery } from "convex/react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { LoadingButton } from "../ui/loading-button";
import { Id } from "~/convex/_generated/dataModel";
import View from "../View";
import { Button } from "../ui/button";

interface BannerMessageEditorProps {
  storeId: Id<"store">;
}

export function BannerMessageEditor({ storeId }: BannerMessageEditorProps) {
  const bannerMessage = useQuery(api.inventory.bannerMessage.get, { storeId });
  const upsertBannerMessage = useMutation(api.inventory.bannerMessage.upsert);

  const [heading, setHeading] = useState("");
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (bannerMessage) {
      setHeading(bannerMessage.heading || "");
      setMessage(bannerMessage.message || "");
      setActive(bannerMessage.active);
    }
  }, [bannerMessage]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await upsertBannerMessage({
        storeId,
        heading: heading.trim() || undefined,
        message: message.trim() || undefined,
        active,
      });
      toast.success("Banner message updated successfully");
    } catch (error) {
      toast.error("Failed to update banner message");
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleActiveToggle = async (checked: boolean) => {
    setActive(checked);
    try {
      await upsertBannerMessage({
        storeId,
        heading: heading.trim() || undefined,
        message: message.trim() || undefined,
        active: checked,
      });
      toast.success(
        checked ? "Banner message activated" : "Banner message deactivated"
      );
    } catch (error) {
      toast.error("Failed to update active status");
      console.error(error);
      // Revert the toggle on error
      setActive(!checked);
    }
  };

  const areBothFieldsEmpty = !heading.trim() && !message.trim();

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="py-4"
      header={<p className="text-sm text-muted-foreground">Site Banner</p>}
    >
      <div className="py-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="heading">Heading (optional)</Label>
          <Input
            id="heading"
            placeholder="e.g., FLASH SALE"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Displayed in bold uppercase
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="message">Message (optional)</Label>
          <Input
            id="message"
            placeholder="e.g., Get 50% off today only"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Displayed as regular text
          </p>
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label htmlFor="active">Active</Label>
            <p className="text-xs text-muted-foreground">
              Banner message takes precedence over promo codes
            </p>
          </div>
          <Switch
            id="active"
            checked={active}
            onCheckedChange={handleActiveToggle}
          />
        </div>

        <Button
          onClick={handleSave}
          disabled={areBothFieldsEmpty || isSaving}
          variant={"outline"}
        >
          Save Banner Message
        </Button>
      </div>
    </View>
  );
}
