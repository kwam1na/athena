import { useMutation, useQuery } from "convex/react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Id } from "~/convex/_generated/dataModel";
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
        active,
        countdownEndsAt,
        currentTimeMs: Date.now(),
      });
      toast.success(active ? "Banner message saved." : "Banner draft saved.");
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
    if (checked && !heading.trim() && !message.trim()) {
      toast.error("Add a heading or message before activating the banner.");
      return;
    }

    setActive(checked);
    setIsSaving(true);
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
    } finally {
      setIsSaving(false);
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
  const canActivateBanner = Boolean(fieldsAreFilled);
  const cannotSaveActiveBanner = active && !canActivateBanner;

  return (
    <div className="space-y-layout-lg">
      <div className="flex flex-wrap gap-layout-xs">
        <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
          {active ? "Active" : "Inactive"}
        </span>
        <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
          {countdownEndsAt
            ? (getCountdownStatus() ?? "Countdown set")
            : "No countdown"}
        </span>
      </div>

      <div className="grid gap-x-layout-md gap-y-layout-xl md:grid-cols-2">
        <div className="space-y-layout-xs">
          <Label htmlFor="heading">Heading (optional)</Label>
          <Input
            id="heading"
            className="h-control-standard bg-background"
            placeholder="e.g., FLASH SALE"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Displayed in bold uppercase
          </p>
        </div>

        <div className="space-y-layout-xs">
          <Label htmlFor="message">Message (optional)</Label>
          <Input
            id="message"
            className="h-control-standard bg-background"
            placeholder="e.g., Get 50% off today only"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Displayed as regular text
          </p>
        </div>

        <div className="flex flex-col items-start gap-layout-xs md:col-span-2">
          <Label htmlFor="countdown">Countdown (optional)</Label>
          <DateTimePicker
            className="w-fit max-w-full"
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
      </div>

      <div className="w-fit max-w-full rounded-md border border-border bg-background p-layout-md">
        <div className="flex items-center justify-between gap-layout-md">
          <div className="space-y-0.5">
            <Label htmlFor="active">Active</Label>
            <p
              className="text-xs text-muted-foreground"
              id="banner-active-description"
            >
              {canActivateBanner
                ? "Banner message takes precedence over promo codes"
                : "Add a heading or message before activating the banner."}
            </p>
          </div>
          <Switch
            aria-describedby="banner-active-description"
            id="active"
            checked={active}
            disabled={isSaving || (!canActivateBanner && !active)}
            onCheckedChange={handleActiveToggle}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-layout-sm border-t border-border pt-layout-md">
        <Button
          onClick={handleSave}
          disabled={areBothFieldsEmpty || cannotSaveActiveBanner || isSaving}
          variant={"outline"}
        >
          {active ? "Save Banner Message" : "Save Banner Draft"}
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
  );
}
