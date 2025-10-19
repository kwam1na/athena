import * as React from "react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface DateTimePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick a date and time",
  disabled = false,
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
    value
  );
  const [hours, setHours] = React.useState(
    value ? value.getHours().toString().padStart(2, "0") : "00"
  );
  const [minutes, setMinutes] = React.useState(
    value ? value.getMinutes().toString().padStart(2, "0") : "00"
  );

  React.useEffect(() => {
    if (value) {
      setSelectedDate(value);
      setHours(value.getHours().toString().padStart(2, "0"));
      setMinutes(value.getMinutes().toString().padStart(2, "0"));
    }
  }, [value]);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const newDate = new Date(date);
      newDate.setHours(parseInt(hours) || 0);
      newDate.setMinutes(parseInt(minutes) || 0);
      setSelectedDate(newDate);
      onChange(newDate);
    }
  };

  const handleTimeChange = (type: "hours" | "minutes", value: string) => {
    // Only allow numbers and limit length
    const numValue = value.replace(/\D/g, "").slice(0, 2);

    if (type === "hours") {
      // Allow empty or any value while typing
      setHours(numValue);
    } else {
      setMinutes(numValue);
    }
  };

  const handleTimeBlur = (type: "hours" | "minutes") => {
    if (type === "hours") {
      const h = Math.min(parseInt(hours) || 0, 23);
      const formattedHours = h.toString().padStart(2, "0");
      setHours(formattedHours);

      if (selectedDate) {
        const newDate = new Date(selectedDate);
        newDate.setHours(h);
        onChange(newDate);
      }
    } else {
      const m = Math.min(parseInt(minutes) || 0, 59);
      const formattedMinutes = m.toString().padStart(2, "0");
      setMinutes(formattedMinutes);

      if (selectedDate) {
        const newDate = new Date(selectedDate);
        newDate.setMinutes(m);
        onChange(newDate);
      }
    }
  };

  const handleClear = () => {
    setSelectedDate(undefined);
    setHours("00");
    setMinutes("00");
    onChange(undefined);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !selectedDate && "text-muted-foreground"
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selectedDate ? (
            format(selectedDate, "PPP 'at' HH:mm")
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          initialFocus
        />
        <div className="border-t p-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">Time</p>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="HH"
                value={hours}
                onChange={(e) => handleTimeChange("hours", e.target.value)}
                onBlur={() => handleTimeBlur("hours")}
                className="w-16 text-center"
                maxLength={2}
              />
              <span className="text-sm font-medium">:</span>
              <Input
                type="text"
                placeholder="MM"
                value={minutes}
                onChange={(e) => handleTimeChange("minutes", e.target.value)}
                onBlur={() => handleTimeBlur("minutes")}
                className="w-16 text-center"
                maxLength={2}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                // Ensure time is validated before closing
                handleTimeBlur("hours");
                handleTimeBlur("minutes");
                setIsOpen(false);
              }}
            >
              Done
            </Button>
            {selectedDate && (
              <Button size="sm" variant="outline" onClick={handleClear}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
