import { useMutation, useQuery } from "convex/react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Id } from "~/convex/_generated/dataModel";
import View from "../View";
import { Button } from "../ui/button";
import { DateTimePicker } from "../ui/date-time-picker";

interface BannerMessageEditorProps {
  storeId: Id<"store">;
}

export function BannerMessageEditor({ storeId }: BannerMessageEditorProps) {
  const bannerMessage = useQuery(api.inventory.bannerMessage.get, { storeId });
  const upsertBannerMessage = useMutation(api.inventory.bannerMessage.upsert);

  const [heading, setHeading] = useState("");
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(false);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | undefined>(
    undefined,
  );
  const [countdownDate, setCountdownDate] = useState<Date | undefined>(
    undefined,
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (bannerMessage) {
      setHeading(bannerMessage.heading || "");
      setMessage(bannerMessage.message || "");
      setActive(bannerMessage.active);
      setCountdownEndsAt(bannerMessage.countdownEndsAt);
      setCountdownDate(
        bannerMessage.countdownEndsAt
          ? new Date(bannerMessage.countdownEndsAt)
          : undefined,
      );
    }
  }, [bannerMessage]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await upsertBannerMessage({
        storeId,
        heading: heading.trim() || undefined,
        message: message.trim() || undefined,
        active: true,
        countdownEndsAt,
        currentTimeMs: Date.now(),
      });
      toast.success("Banner message updated successfully");
    } catch (error) {
      toast.error("Failed to update banner message");
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      setIsSaving(true);
      await upsertBannerMessage({
        storeId,
        heading: undefined,
        message: undefined,
        active: false,
        countdownEndsAt: undefined,
        currentTimeMs: Date.now(),
      });
      setHeading("");
      setMessage("");
      setCountdownEndsAt(undefined);
      setCountdownDate(undefined);
      setActive(false);
      toast.success("Banner message cleared");
    } catch (error) {
      toast.error("Failed to clear banner message");
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
        countdownEndsAt,
        currentTimeMs: Date.now(),
      });
      toast.success(
        checked ? "Banner message activated" : "Banner message deactivated",
      );
    } catch (error) {
      toast.error("Failed to update active status");
      console.error(error);
      // Revert the toggle on error
      setActive(!checked);
    }
  };

  const handleCountdownChange = (date: Date | undefined) => {
    if (date) {
      setCountdownDate(date);
      setCountdownEndsAt(date.getTime());
    } else {
      setCountdownDate(undefined);
      setCountdownEndsAt(undefined);
    }
  };

  const getCountdownStatus = () => {
    if (!countdownEndsAt) return null;
    const now = Date.now();
    const timeLeft = countdownEndsAt - now;

    if (timeLeft < 0) {
      return "Expired";
    }

    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
    );
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `${days}d ${hours}h remaining`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    } else {
      return `${minutes}m remaining`;
    }
  };

  const areBothFieldsEmpty = !heading.trim() && !message.trim();
  const fieldsAreFilled = heading.trim() || message.trim();

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

        <div className="space-y-2">
          <Label htmlFor="countdown">Countdown (optional)</Label>
          <DateTimePicker
            value={countdownDate}
            onChange={handleCountdownChange}
            placeholder="Pick countdown end date and time"
          />
          {getCountdownStatus() && (
            <p className="text-xs text-muted-foreground">
              {getCountdownStatus()}
            </p>
          )}
          {/* <p className="text-xs text-muted-foreground">
            Banner will automatically hide when countdown reaches zero
          </p> */}
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

        <div className="flex gap-4">
          <Button
            onClick={handleSave}
            disabled={areBothFieldsEmpty || isSaving}
            variant={"outline"}
          >
            Save Banner Message
          </Button>

          <Button
            onClick={handleClear}
            disabled={isSaving || !fieldsAreFilled}
            variant={"outline"}
          >
            Clear Banner Message
          </Button>
        </div>
      </div>
    </View>
  );
}
