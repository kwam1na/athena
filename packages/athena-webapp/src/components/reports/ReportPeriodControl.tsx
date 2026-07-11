import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ReportPeriodPreset =
  "wtd" | "today" | "prior_week" | "trailing_30" | "custom";

const PERIOD_LABELS: Record<ReportPeriodPreset, string> = {
  wtd: "Week to date",
  today: "Today",
  prior_week: "Prior week",
  trailing_30: "Trailing 30 days",
  custom: "Custom range",
};

export function ReportPeriodControl({
  end,
  onCustomRangeSubmit,
  onEndChange,
  onPresetChange,
  onStartChange,
  preset,
  start,
}: {
  end?: string;
  onCustomRangeSubmit?: () => void;
  onEndChange?: (value: string) => void;
  onPresetChange: (preset: ReportPeriodPreset) => void;
  onStartChange?: (value: string) => void;
  preset: ReportPeriodPreset;
  start?: string;
}) {
  return (
    <div className="w-full space-y-2 sm:w-56">
      <Label htmlFor="reports-period">Reporting period</Label>
      <Select
        onValueChange={(value) => onPresetChange(value as ReportPeriodPreset)}
        value={preset}
      >
        <SelectTrigger id="reports-period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(
            Object.entries(PERIOD_LABELS) as Array<[ReportPeriodPreset, string]>
          ).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" ? (
        <div
          className="grid gap-3 pt-2 sm:grid-cols-2"
          data-testid="custom-range-fields"
        >
          <div className="space-y-2">
            <Label htmlFor="reports-start-date">Start date</Label>
            <Input
              id="reports-start-date"
              max={end}
              onChange={(event) => onStartChange?.(event.target.value)}
              type="date"
              value={start ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reports-end-date">End date</Label>
            <Input
              id="reports-end-date"
              min={start}
              onChange={(event) => onEndChange?.(event.target.value)}
              type="date"
              value={end ?? ""}
            />
          </div>
          <Button
            className="min-h-10 sm:col-span-2"
            disabled={!start || !end || start > end}
            onClick={onCustomRangeSubmit}
            type="button"
          >
            Build report
          </Button>
        </div>
      ) : null}
    </div>
  );
}
