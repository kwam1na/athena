import { Star } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../ui/tooltip";
import { STAR_LABELS } from "./types";

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
      {label} {!optional && <span className="text-red-500">*</span>}
    </p>
    <TooltipProvider>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Tooltip key={star}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onChange(star)}
                className="focus:outline-none"
                type="button"
              >
                <Star
                  className={`w-6 h-6 ${
                    star <= value
                      ? "fill-accent2 text-accent2"
                      : "text-gray-300"
                  }`}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{tooltipLabels[star - 1]}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  </div>
);
