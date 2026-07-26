import { Star } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../ui/tooltip";
import { STAR_LABELS } from "./types";
import { IconButton } from "../ui/icon-button";

interface RatingSelectorProps {
  label: string;
  value: number;
  onChange: (rating: number) => void;
  tooltipLabels?: string[];
  optional?: boolean;
}

export const RatingSelector = ({
  label,
  value,
  onChange,
  tooltipLabels = STAR_LABELS,
  optional = false,
}: RatingSelectorProps) => (
  <div className="space-y-1">
    <p className="text-sm text-muted-foreground">
      {label} {!optional && <span className="text-danger">*</span>}
    </p>
    <TooltipProvider>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Tooltip key={star}>
            <TooltipTrigger asChild>
              <IconButton
                label={`Rate ${label} ${star} out of 5`}
                onClick={() => onChange(star)}
                type="button"
                variant="ghost"
                className="rounded-full"
              >
                <Star
                  className={`w-6 h-6 ${
                    star <= value
                      ? "fill-brand text-brand"
                      : "text-muted-foreground"
                  }`}
                />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{tooltipLabels[star - 1]}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  </div>
);
