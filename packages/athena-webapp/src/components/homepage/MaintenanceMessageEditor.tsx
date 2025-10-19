import { useMutation } from "convex/react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Id } from "~/convex/_generated/dataModel";
import View from "../View";
import { DateTimePicker } from "../ui/date-time-picker";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";

interface MaintenanceMessageEditorProps {
  storeId: Id<"store">;
}

export function MaintenanceMessageEditor({
  storeId,
}: MaintenanceMessageEditorProps) {
  const { activeStore } = useGetActiveStore();
  const updateConfig = useMutation(api.inventory.stores.updateConfig);

  const [heading, setHeading] = useState("");
  const [message, setMessage] = useState("");
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | undefined>(
    undefined
  );
  const [countdownDate, setCountdownDate] = useState<Date | undefined>(
    undefined
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (activeStore?.config?.maintenance) {
      const maintenance = activeStore.config.maintenance;
      setHeading(maintenance.heading || "");
      setMessage(maintenance.message || "");
      setCountdownEndsAt(maintenance.countdownEndsAt);
      setCountdownDate(
        maintenance.countdownEndsAt
          ? new Date(maintenance.countdownEndsAt)
          : undefined
      );
    }
  }, [activeStore?.config?.maintenance]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateConfig({
        id: storeId,
        config: {
          ...activeStore?.config,
          maintenance: {
            heading: heading.trim() || undefined,
            message: message.trim() || undefined,
            countdownEndsAt,
          },
        },
      });
      toast.success("Maintenance message updated successfully");
    } catch (error) {
      toast.error("Failed to update maintenance message");
      console.error(error);
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
      (timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
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

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="py-4"
      header={
        <p className="text-sm text-muted-foreground">Maintenance Message</p>
      }
    >
      <div className="py-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="maintenance-heading">Heading (optional)</Label>
          <Input
            id="maintenance-heading"
            placeholder="e.g., We'll be back soon!"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Displayed as the main heading
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maintenance-message">Message (optional)</Label>
          <Input
            id="maintenance-message"
            placeholder="e.g., We're updating our store with amazing new products"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Displayed below the heading
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maintenance-countdown">Countdown (optional)</Label>
          <DateTimePicker
            value={countdownDate}
            onChange={handleCountdownChange}
            placeholder="Pick when maintenance ends"
          />
          {getCountdownStatus() && (
            <p className="text-xs text-muted-foreground">
              {getCountdownStatus()}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Shows a countdown timer on the maintenance page
          </p>
        </div>

        <Button
          onClick={handleSave}
          disabled={areBothFieldsEmpty || isSaving}
          variant={"outline"}
        >
          Save Maintenance Message
        </Button>
      </div>
    </View>
  );
}
